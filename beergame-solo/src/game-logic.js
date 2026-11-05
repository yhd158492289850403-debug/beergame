/* =========================================================================
 * beergame-solo / src/game-logic.js
 * -------------------------------------------------------------------------
 * 单人啤酒游戏 —— 纯逻辑核心（无 DOM / 无网络 / 无依赖）
 *
 * 设计原则：
 *   1. 所有函数对状态都是纯的：step() 返回全新 state，不修改传入对象。
 *   2. 随机性来自 state.rngState（seeded PRNG），因此同 seed 完全可复现。
 *   3. 同一份文件同时供浏览器（<script> 挂到 globalThis.BeerGame）与
 *      Node 测试（module.exports）使用，零分支、零重复实现。
 *
 * 供应链：customer -> retailer -> wholesaler -> distributor -> factory -> 生产
 *   订单沿链路上传（提前期 orderLeadTime，默认 1）
 *   货物沿链路下发（两段在途 pipeline[0] / pipeline[1]，默认共 2 周期）
 * ====================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BeerGame = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 供应链角色，顺序即链路顺序（上游在后） */
  const ROLES = ["retailer", "wholesaler", "distributor", "factory"];

  const ROLE_LABELS = {
    retailer: "零售商",
    wholesaler: "批发商",
    distributor: "分销商",
    factory: "工厂",
  };

  /** 角色之下游（收货方）；工厂的下游是市场，为 null */
  const DOWNSTREAM = {
    retailer: null,
    wholesaler: "retailer",
    distributor: "wholesaler",
    factory: "distributor",
  };

  /** 角色之上游（供货方）；零售商的上游是批发商，工厂上游为 null（自产） */
  const UPSTREAM = {
    retailer: "wholesaler",
    wholesaler: "distributor",
    distributor: "factory",
    factory: null,
  };

  const DEMAND_MODES = ["stable", "step", "random"];

  const DEMAND_MODE_LABELS = {
    stable: "稳定需求",
    step: "阶梯式增长",
    random: "随机波动",
  };

  const BOT_LEVELS = ["easy", "normal", "hard"];

  const BOT_LABELS = {
    easy: "简单",
    normal: "普通",
    hard: "困难",
    off: "关闭（测试用）",
  };

  /* ---------------------------------------------------------------------
   * 默认配置
   * ------------------------------------------------------------------ */
  function defaultConfig() {
    return {
      periods: 36, // 游戏周期（周）数
      playerRole: "retailer", // 玩家扮演的角色
      botLevel: "normal", // 机器人智能度
      initialInventory: 12, // 所有角色初始库存
      initialPipeline: 4, // 所有角色初始在途订单量（每段在途）
      initialBacklog: 0, // 所有角色初始缺货
      initialIncomingOrder: 4, // 开局前各角色"看到"的初始需求/订单
      inventoryCost: 0.5, // 每周期每单位库存成本
      backlogCost: 1.0, // 每周期每单位缺货成本
      orderLeadTime: 1, // 订单上传到上游的提前期
      extraOrderDelay: false, // 订单延迟一周期（额外一周延迟选项）
      // 是否显示"其他节点"的库存情况（库存 / 缺货 / 在途）。关闭后只显示你自己的，
      // 更接近真实啤酒游戏中"信息隔离"的体验；你自己的数据始终可见。
      showOtherInventory: true,
      demandMode: "step", // 需求模式
      demandStart: 4, // 稳定 / 阶梯模式的起始需求
      demandStep: 4, // 阶梯模式的增量
      demandChangePeriod: 5, // 阶梯模式在第几个周期发生变化
      demandMin: 0, // 随机模式下限
      demandMax: 12, // 随机模式上限
      demandVolatility: 3, // 随机模式波动幅度（随机游走步长）
      seed: 20240517, // 随机种子
    };
  }

  /* ---------------------------------------------------------------------
   * 工具
   * ------------------------------------------------------------------ */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const toInt = (v, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : fallback;
  };
  const toNum = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const round2 = (v) => Math.round(v * 100) / 100;

  /** 把任意（可能来自 UI 的）配置收敛为合法配置 */
  function normalizeConfig(partial) {
    const d = defaultConfig();
    const c = Object.assign({}, d, partial || {});

    c.periods = clamp(toInt(c.periods, d.periods), 4, 200);
    // "none" = 四个角色全部由机器人控制（纯 AI 对局，用于分档测试与演示）
    c.playerRole =
      c.playerRole === "none" || ROLES.indexOf(c.playerRole) >= 0 ? c.playerRole : d.playerRole;
    // "off" 不对外暴露，仅用于测试与故障排查（所有非玩家角色固定订 0）
    c.botLevel = ["easy", "normal", "hard", "off"].indexOf(c.botLevel) >= 0 ? c.botLevel : d.botLevel;
    c.initialInventory = clamp(toInt(c.initialInventory, d.initialInventory), 0, 999);
    c.initialPipeline = clamp(toInt(c.initialPipeline, d.initialPipeline), 0, 999);
    c.initialBacklog = clamp(toInt(c.initialBacklog, d.initialBacklog), 0, 999);
    c.initialIncomingOrder = clamp(toInt(c.initialIncomingOrder, d.initialIncomingOrder), 0, 999);
    c.inventoryCost = clamp(toNum(c.inventoryCost, d.inventoryCost), 0, 100);
    c.backlogCost = clamp(toNum(c.backlogCost, d.backlogCost), 0, 100);
    c.orderLeadTime = clamp(toInt(c.orderLeadTime, d.orderLeadTime), 1, 2);
    c.extraOrderDelay = Boolean(c.extraOrderDelay);
    c.showOtherInventory = c.showOtherInventory === undefined
      ? d.showOtherInventory
      : Boolean(c.showOtherInventory);
    c.demandMode = DEMAND_MODES.indexOf(c.demandMode) >= 0 ? c.demandMode : d.demandMode;
    c.demandStart = clamp(toInt(c.demandStart, d.demandStart), 0, 999);
    c.demandStep = clamp(toInt(c.demandStep, d.demandStep), 0, 999);
    c.demandChangePeriod = clamp(toInt(c.demandChangePeriod, d.demandChangePeriod), 1, c.periods);
    c.demandMin = clamp(toInt(c.demandMin, d.demandMin), 0, 999);
    c.demandMax = clamp(toInt(c.demandMax, d.demandMax), c.demandMin, 999);
    c.demandVolatility = clamp(toInt(c.demandVolatility, d.demandVolatility), 0, 99);
    c.seed = toInt(c.seed, d.seed) >>> 0;
    return c;
  }

  /* ---------------------------------------------------------------------
   * seeded PRNG (mulberry32) —— 保证可复现
   * ------------------------------------------------------------------ */
  function nextRandom(state) {
    state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
    let t = state.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randomInt(state, lo, hi) {
    if (hi <= lo) return lo;
    return lo + Math.floor(nextRandom(state) * (hi - lo + 1));
  }

  /* ---------------------------------------------------------------------
   * 需求模式
   * ------------------------------------------------------------------ */
  /**
   * 生成外部（顾客）需求序列。纯算术模式（stable / step）不消耗随机数，
   * 只有 random 模式推进 rngState，便于测试隔离。
   */
  function generateDemandSeries(config, rngHolder) {
    const out = [];
    const n = config.periods;

    if (config.demandMode === "stable") {
      for (let i = 0; i < n; i += 1) out.push(config.demandStart);
      return out;
    }

    if (config.demandMode === "step") {
      for (let i = 0; i < n; i += 1) {
        const bumped = i + 1 >= config.demandChangePeriod;
        out.push(config.demandStart + (bumped ? config.demandStep : 0));
      }
      return out;
    }

    // random：有界随机游走，并按概率向中位回归，避免长期跑飞
    const mid = Math.round((config.demandMin + config.demandMax) / 2);
    let current = clamp(config.demandStart, config.demandMin, config.demandMax);
    for (let i = 0; i < n; i += 1) {
      const drift = randomInt(rngHolder, -config.demandVolatility, config.demandVolatility);
      let next = current + drift;
      if (next < config.demandMin || next > config.demandMax) {
        next = current - drift; // 触界则反向
      }
      if (next < config.demandMin || next > config.demandMax) {
        next = mid; // 仍越界则回到中位
      }
      current = clamp(next, config.demandMin, config.demandMax);
      out.push(current);
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * 初始状态
   * ------------------------------------------------------------------ */
  function roleStateFromConfig(config) {
    const roles = {};
    for (const role of ROLES) {
      roles[role] = {
        role,
        inventory: config.initialInventory,
        backlog: config.initialBacklog,
        // pipeline[0] 本周期末到货，pipeline[1] 下周期末到货
        pipeline: [config.initialPipeline, config.initialPipeline],
        lastOrder: config.initialIncomingOrder,
        outstanding: role === "factory" ? 0 : (config.orderLeadTime + Number(config.extraOrderDelay)) * config.initialIncomingOrder + config.initialBacklog,
        totalCost: 0,
        history: [],
      };
    }
    return roles;
  }

  function createGame(options) {
    const config = normalizeConfig(options);

    // 需求与机器人随机性使用独立的 RNG 流，互不干扰
    const demandHolder = { rngState: config.seed >>> 0 };
    const rngHolder = { rngState: ((config.seed >>> 0) ^ 0x9e3779b9) >>> 0 };

    const state = {
      config,
      period: 1,
      ended: false,
      roles: roleStateFromConfig(config),
      customerDemand: generateDemandSeries(config, demandHolder),
      // customerDemand[period-1] 即本周期顾客需求
      roleOrderQueue: { retailer: [], wholesaler: [], distributor: [], factory: [] },
      lastTurn: null,
      totalCost: 0,
      demandSeries: [],
      cumulativeCostSeries: [],
      rngState: rngHolder.rngState,
    };

    state.demandSeries.push(state.customerDemand[0]);
    // 开局即写入起点，保证成本趋势图从第一屏就有可绘制的数据
    state.cumulativeCostSeries.push(0);
    return state;
  }

  /* ---------------------------------------------------------------------
   * 机器人 AI
   * ------------------------------------------------------------------ */

  /** 本周已到达的需求；UI、预测和发货共用同一提前期语义。 */
  function currentDemand(state, role) {
    if (state.ended) return 0;
    if (role === "retailer") return state.customerDemand[state.period - 1];
    const lead = state.config.orderLeadTime + Number(state.config.extraOrderDelay);
    const history = state.roles[DOWNSTREAM[role]].history;
    const entry = history[history.length - lead];
    return entry ? entry.order : state.config.initialIncomingOrder;
  }

  /** 只使用本节点已观察的需求和自己的订单账本，不读取未来或上游库存。 */
  function recommendOrder(state, role, level) {
    role = role || state.config.playerRole;
    level = level || state.config.botLevel;
    const rs = state.roles[role];
    const config = state.config;
    const observed = currentDemand(state, role);
    const history = rs.history.slice(-12).map(row => row.demand);
    const seen = history.concat(observed);
    const alpha = level === "hard" ? 0.85 : level === "normal" ? 0.3 : 0.55;
    let forecast = seen[0];
    for (let i = 1; i < seen.length; i++) forecast += alpha * (seen[i] - forecast);
    const lead = role === "factory" ? 0 : config.orderLeadTime + Number(config.extraOrderDelay);
    const coverage = lead + 3; // 本周需求 + 订单提前期 + 两周运输/生产
    const deviation = Math.sqrt(variance(seen.slice(-6)));
    const costRatio = config.backlogCost / Math.max(0.01, config.inventoryCost + config.backlogCost);
    const safety = deviation * Math.sqrt(coverage) * costRatio + (level === "easy" ? forecast * 2 : 0);
    const target = forecast * coverage + safety;
    const outstanding = rs.outstanding || 0;
    const position = rs.inventory - rs.backlog + rs.pipeline[0] + rs.pipeline[1] + outstanding;
    const gain = level === "hard" ? 0.25 : level === "normal" ? 0.65 : 1;
    const raw = forecast + gain * (target - position - forecast);
    return {
      order: state.ended ? 0 : clamp(Math.round(raw), 0, 200),
      forecast: round2(forecast), target: round2(target), position,
      outstanding, coverage, observed, safety: round2(safety),
    };
  }

  function collectOrders(state, playerOrder) {
    const orders = {};
    for (const role of ROLES) {
      if (playerOrder && typeof playerOrder === "object" && Object.prototype.hasOwnProperty.call(playerOrder, role)) {
        orders[role] = clamp(toInt(playerOrder[role], 0), 0, 200);
      } else if (role === state.config.playerRole && typeof playerOrder !== "object") {
        orders[role] = clamp(toInt(playerOrder, 0), 0, 200);
      } else if (state.config.botLevel === "off") {
        orders[role] = 0;
      } else {
        orders[role] = recommendOrder(state, role).order;
      }
    }
    return orders;
  }

  /** 把本周期订单写入上游角色的观察队列 */
  function deliverOrdersToQueue(roleOrderQueue, orders, period, config) {
    const delay = config.extraOrderDelay ? config.orderLeadTime + 1 : config.orderLeadTime;
    const deliverPeriod = period + delay;
    for (const role of ROLES) {
      const up = UPSTREAM[role];
      if (!up) continue;
      roleOrderQueue[up].push({ period: deliverPeriod, quantity: orders[role], from: role });
    }
  }

  /* ---------------------------------------------------------------------
   * 单周期主循环
   * ------------------------------------------------------------------ */
  /**
   * 推进一个周期。
   * @param {object} state  当前状态
   * @param {number} playerOrder 玩家本周期订单量
   * @returns {object} 新的 state（原 state 不被修改）
   */
  function step(state, playerOrder) {
    if (state.ended) return state;

    const { config } = state;
    const period = state.period;

    // 深拷贝（结构化数据，无函数，JSON 足够）
    const next = JSON.parse(JSON.stringify(state));
    const demandThisPeriod = next.customerDemand[period - 1];

    const before = {};
    for (const role of ROLES) {
      const rs = next.roles[role];
      before[role] = {
        inventory: rs.inventory,
        backlog: rs.backlog,
        pipeline: rs.pipeline.slice(),
      };
    }

    // 0) 需求确认 + 生成订单
    const orders = collectOrders(next, playerOrder);

    // 1) 到货：pipeline[0] 入库，pipeline[1] 前移
    for (const role of ROLES) {
      const rs = next.roles[role];
      rs.inventory += rs.pipeline[0];
      rs.pipeline = [rs.pipeline[1], 0];
    }

    // 2) 发货：上游发货依据"下游按提前期到达的订单" + 自身缺货
    //    顾客需求只直接作用于零售商。
    //    提前期语义：t 期下的订单在 t+orderLeadTime 期被上游看到并服务。
    const shipments = {};
    const unmet = {}; // 上游未能满足的需求量
    const demandFaced = {}; // 各角色本周实际面对的需求量（供记账/UI）
    for (const role of ROLES) {
      const rs = next.roles[role];
      const down = DOWNSTREAM[role];

      const demandToServe = currentDemand(state, role);

      const total = demandToServe + rs.backlog;
      const shipped = Math.min(rs.inventory, total);
      shipments[role] = shipped;
      unmet[role] = total - shipped;
      demandFaced[role] = demandToServe;

      rs.inventory -= shipped;
      rs.backlog = total - shipped;
    }

    // 3) 送到下游：本周期发出的货进入下游 pipeline[1]（两段在途）
    for (const role of ROLES) {
      const down = DOWNSTREAM[role];
      if (!down) continue;
      next.roles[down].pipeline[1] += shipments[role];
    }
    // 工厂生产：本周期生产订单进入自己的在途（2 周期后入库）
    next.roles.factory.pipeline[1] += orders.factory;

    // 已下单未发货与运输中的货分别记账，避免补同一缺口两次。
    for (const role of ROLES) {
      const up = UPSTREAM[role];
      if (up) next.roles[role].outstanding = Math.max(0,
        (next.roles[role].outstanding || 0) + orders[role] - shipments[up]);
    }

    // 4) 订单进入上游观察队列（保留用于记录订单在途；发货与预测已直接读取 history）
    deliverOrdersToQueue(next.roleOrderQueue, orders, period, config);
    for (const role of ROLES) {
      next.roles[role].demandReference = demandFaced[role];
    }

    // 5) 成本结算与历史记录
    const receipts = {};
    for (const role of ROLES) {
      const rs = next.roles[role];
      const invCost = round2(config.inventoryCost * rs.inventory);
      const blCost = round2(config.backlogCost * rs.backlog);
      const cost = round2(invCost + blCost);
      rs.totalCost = round2(rs.totalCost + cost);
      receipts[role] = before[role].pipeline[0];

      rs.history.push({
        period,
        demand: demandFaced[role],
        order: orders[role],
        received: receipts[role],
        shipped: shipments[role],
        inventoryEnd: rs.inventory,
        backlogEnd: rs.backlog,
        inventoryCost: invCost,
        backlogCost: blCost,
        cost,
      });
      rs.lastOrder = orders[role];
    }

    // 6) 汇总
    const supplyChainCost = round2(
      ROLES.reduce((sum, role) => sum + next.roles[role].history[period - 1].cost, 0)
    );
    next.totalCost = round2(next.totalCost + supplyChainCost);
    next.cumulativeCostSeries.push(next.totalCost);

    next.lastTurn = {
      period,
      customerDemand: demandThisPeriod,
      orders,
      shipments,
      receipts,
      unmet,
      supplyChainCost,
      before,
      after: ROLES.reduce((acc, role) => {
        acc[role] = {
          inventory: next.roles[role].inventory,
          backlog: next.roles[role].backlog,
          pipeline: next.roles[role].pipeline.slice(),
        };
        return acc;
      }, {}),
    };

    // 8) 推进周期
    next.period = period + 1;
    if (next.period > config.periods) {
      next.ended = true;
    } else {
      next.demandSeries.push(next.customerDemand[next.period - 1]);
    }

    return next;
  }

  /* ---------------------------------------------------------------------
   * 报表 / 结算
   * ------------------------------------------------------------------ */
  function roleSeries(state, role, key) {
    const rs = state.roles[role];
    if (!rs) return [];
    return rs.history.map((row) => row[key]);
  }

  function variance(values) {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  }

  /**
   * 牛鞭效应 = var(工厂订单) / var(零售商订单)。
   *
   * 零售商方差极小时（例如玩家一直按需求下单）该比值会被放大到无意义的大数，
   * 因此设一个方差下限：比值超过阈值时判定为"零售商几乎不波动"，返回 null，
   * 由界面显示为 N/A 而不是一个误导性的巨大数字。
   */
  const MIN_RETAILER_VARIANCE = 0.5;
  const MAX_BULLWHIP = 20;

  function bullwhip(state) {
    const factoryVar = variance(roleSeries(state, "factory", "order"));
    const retailerVar = variance(roleSeries(state, "retailer", "order"));
    if (retailerVar < MIN_RETAILER_VARIANCE) return null;
    const ratio = factoryVar / retailerVar;
    if (!Number.isFinite(ratio) || ratio > MAX_BULLWHIP) return null;
    return ratio;
  }

  function buildReport(state) {
    const bullwhipValue = bullwhip(state);
    const rows = ROLES.map((role) => {
      const rs = state.roles[role];
      return {
        role,
        label: ROLE_LABELS[role],
        isPlayer: role === state.config.playerRole,
        totalCost: round2(rs.totalCost),
        inventoryEnd: rs.inventory,
        backlogEnd: rs.backlog,
        orders: roleSeries(state, role, "order"),
        inventorySeries: roleSeries(state, role, "inventoryEnd"),
        backlogSeries: roleSeries(state, role, "backlogEnd"),
        costSeries: roleSeries(state, role, "cost"),
      };
    });

    return {
      periods: state.config.periods,
      playerRole: state.config.playerRole,
      playerCost: round2(state.roles[state.config.playerRole].totalCost),
      supplyChainCost: round2(state.totalCost),
      byRole: rows,
      bullwhip: bullwhipValue,
      customerDemand: state.customerDemand.slice(0, state.config.periods),
      cumulativeCostSeries: state.cumulativeCostSeries.slice(),
    };
  }

  /* ---------------------------------------------------------------------
   * 控制台无界面自跑（阶段一产出验证用）
   * ------------------------------------------------------------------ */
  function runAuto(options) {
    let state = createGame(options);
    while (!state.ended) {
      state = step(state, 0);
    }
    return state;
  }

  /** 人类可读的对局摘要文本 */
  function describeState(state) {
    const lines = [];
    const cfg = state.config;
    lines.push(
      `周期 ${Math.min(state.period, cfg.periods)}/${cfg.periods} | 角色=${ROLE_LABELS[cfg.playerRole]} | 机器人=${BOT_LABELS[cfg.botLevel]} | 需求模式=${DEMAND_MODE_LABELS[cfg.demandMode]}`
    );
    lines.push(
      "角色      期末库存  期末缺货   在途(近/远)   累计成本"
    );
    for (const role of ROLES) {
      const rs = state.roles[role];
      lines.push(
        `${ROLE_LABELS[role].padEnd(4, "　")}  ${String(rs.inventory).padStart(7)}  ${String(
          rs.backlog
        ).padStart(8)}   ${String(rs.pipeline[0]).padStart(4)}/${String(rs.pipeline[1]).padEnd(
          4
        )}  ${String(round2(rs.totalCost)).padStart(9)}`
      );
    }
    lines.push(`供应链累计总成本: ${round2(state.totalCost)}`);
    const bw = bullwhip(state);
    lines.push(`牛鞭效应 (factory var / retailer var): ${bw === null ? "N/A" : round2(bw)}`);
    return lines.join("\n");
  }

  return {
    ROLES,
    ROLE_LABELS,
    DOWNSTREAM,
    UPSTREAM,
    DEMAND_MODES,
    DEMAND_MODE_LABELS,
    BOT_LEVELS,
    BOT_LABELS,
    defaultConfig,
    normalizeConfig,
    createGame,
    step,
    currentDemand,
    recommendOrder,
    generateDemandSeries,
    buildReport,
    bullwhip,
    roleSeries,
    variance,
    runAuto,
    describeState,
    nextRandom,
  };
});
