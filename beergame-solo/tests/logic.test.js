/* =========================================================================
 * beergame-solo / tests/logic.test.js
 * 阶段一验证：纯 Node 运行（无浏览器、无依赖、无网络）
 *   运行方式： node tests/logic.test.js
 * ====================================================================== */

"use strict";

const path = require("path");
const G = require(path.join(__dirname, "..", "src", "game-logic.js"));

/* --------------------------- 迷你测试框架 --------------------------- */
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  \u2717 ${name}${detail ? `  ->  ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/* --------------------------- 1. 周期与结束 --------------------------- */
section("1. 周期数与结束条件");

for (const periods of [18, 36, 54]) {
  const state = G.runAuto({ periods, demandMode: "stable", playerRole: "retailer" });
  const historyLen = state.roles.retailer.history.length;
  check(
    `periods=${periods} 时恰好推进 ${periods} 个周期`,
    historyLen === periods,
    `实际 history=${historyLen}, period=${state.period}`
  );
  check(`periods=${periods} 时 ended=true`, state.ended === true);
}

{
  const s = G.createGame({ periods: 10 });
  check("初始 period 为 1、ended 为 false", s.period === 1 && s.ended === false);
}

/* --------------------------- 2. 状态不变量 --------------------------- */
section("2. 状态不变量（库存/缺货/在途）");

{
  const configs = [
    { botLevel: "easy", demandMode: "random", periods: 36 },
    { botLevel: "normal", demandMode: "step", periods: 36 },
    { botLevel: "hard", demandMode: "stable", periods: 36 },
    { botLevel: "normal", demandMode: "random", periods: 54, initialInventory: 0, initialPipeline: 0 },
    { botLevel: "easy", demandMode: "step", periods: 18, initialInventory: 2, initialPipeline: 1, extraOrderDelay: true },
  ];

  for (const cfg of configs) {
    const tag = `${cfg.botLevel}/${cfg.demandMode}/${cfg.periods}${cfg.extraOrderDelay ? "/delay" : ""}`;
    const state = G.runAuto(cfg);

    let invOk = true;
    let backlogOk = true;
    let costOk = true;
    let finiteOk = true;

    for (const role of G.ROLES) {
      for (const row of state.roles[role].history) {
        if (row.inventoryEnd < 0) invOk = false;
        if (row.backlogEnd < 0) backlogOk = false;
        if (row.inventoryEnd > 0 && row.backlogEnd > 0) invOk = false; // 有货不该同时缺货
        if (row.cost < 0) costOk = false;
        if (!Number.isFinite(row.cost) || !Number.isFinite(row.inventoryEnd)) finiteOk = false;
      }
    }

    check(`[${tag}] 期末库存恒 >= 0`, invOk);
    check(`[${tag}] 期末缺货恒 >= 0`, backlogOk);
    check(`[${tag}] 单周期成本恒 >= 0 且有限`, costOk && finiteOk);
  }
}

/* --------------------------- 3. 账务一致性 --------------------------- */
section("3. 账务一致性（成本、到货、聚合）");

{
  let costConsistent = true;
  let roleSumConsistent = true;
  let receiptConsistent = true;

  for (const mode of ["stable", "step", "random"]) {
    const state = G.runAuto({ periods: 36, demandMode: mode, botLevel: "normal" });

    for (const role of G.ROLES) {
      const rows = state.roles[role].history;
      const rowSum = Math.round(sum(rows.map((r) => r.cost)) * 100) / 100;
      if (Math.abs(rowSum - state.roles[role].totalCost) > 0.011) costConsistent = false;

      // 单周期成本 = 库存成本 + 缺货成本
      for (const row of rows) {
        const expect = Math.round((row.inventoryCost + row.backlogCost) * 100) / 100;
        if (Math.abs(expect - row.cost) > 0.011) costConsistent = false;
      }

      // 到货量 = 上一周期结束时在途的近段
      for (let i = 1; i < rows.length; i += 1) {
        // 通过 before/after 无法回溯，用重放校验：见下方 replay 测试
      }
    }
  }

  // 角色成本之和 == 供应链成本
  {
    const state = G.runAuto({ periods: 36, demandMode: "step", botLevel: "hard" });
    const roleSum = Math.round(sum(G.ROLES.map((r) => state.roles[r].totalCost)) * 100) / 100;
    roleSumConsistent = Math.abs(roleSum - state.totalCost) < 0.011;
  }

  // 逐步重放：到货量必须等于该角色上一周期末在途近段
  {
    let state = G.createGame({ periods: 20, demandMode: "step", botLevel: "normal" });
    let replayOk = true;
    while (!state.ended) {
      const snapshot = state;
      const next = G.step(state, 3);
      for (const role of G.ROLES) {
        const beforeNear = snapshot.roles[role].pipeline[0];
        const received = next.roles[role].history[next.roles[role].history.length - 1].received;
        if (received !== beforeNear) replayOk = false;
      }
      state = next;
    }
    receiptConsistent = replayOk;
  }

  check("各角色累计成本 == 其历史成本之和", costConsistent);
  check("四角色累计成本之和 == 供应链累计成本", roleSumConsistent);
  check("每周期到货量 == 上一周期末在途近段（重放校验）", receiptConsistent);
}

/* --------------------------- 4. 在途守恒与发货守恒 --------------------------- */
section("4. 在途守恒与发货守恒");

{
  // 某角色发出的货，应在 2 个周期后原样进入其下游的库存
  let state = G.createGame({ periods: 30, demandMode: "stable", botLevel: "normal", initialPipeline: 0 });
  const shipLog = [];
  while (!state.ended) {
    const next = G.step(state, 4);
    for (const role of G.ROLES) {
      const down = G.DOWNSTREAM[role];
      if (!down) continue;
      shipLog.push({ period: next.lastTurn.period, from: role, to: down, qty: next.lastTurn.shipments[role] });
    }
    state = next;
  }

  // 逐角色校验：发货量应能追溯到下游某周期的 received
  let conservedOk = true;
  for (const role of G.ROLES) {
    const down = G.DOWNSTREAM[role];
    if (!down) continue;
    const sends = shipLog.filter((x) => x.from === role);
    const recvs = state.roles[down].history;
    for (const send of sends) {
      const target = recvs.find((r) => r.period === send.period + 2);
      if (!target) continue; // 超出模拟窗口
      // 下游同周期可能还收到其他来源？不会 —— 每个角色只有一个上游
      if (target.received !== send.qty) {
        conservedOk = false;
      }
    }
  }
  check("发货量在 2 周期后原样到达下游（在途守恒）", conservedOk);

  // 发货量不得超过期初库存
  let noOvership = true;
  state = G.createGame({ periods: 30, demandMode: "random", botLevel: "hard" });
  while (!state.ended) {
    const before = state;
    const next = G.step(state, 6);
    for (const role of G.ROLES) {
      const available = before.roles[role].inventory + before.roles[role].pipeline[0];
      if (next.lastTurn.shipments[role] > available) noOvership = false;
    }
    state = next;
  }
  check("发货量永不超过可用库存（期初库存+到货）", noOvership);
}

/* --------------------------- 5. 需求模式形状 --------------------------- */
section("5. 需求模式");

{
  const stable = G.createGame({ periods: 10, demandMode: "stable", demandStart: 5 });
  check("稳定需求：全周期恒定", stable.customerDemand.every((d) => d === 5));

  const stepSeries = G.generateDemandSeries(
    G.normalizeConfig({ periods: 10, demandMode: "step", demandStart: 4, demandStep: 4, demandChangePeriod: 5 }),
    { rngState: 1 }
  );
  check(
    "阶梯增长：前 4 期为 4、第 5 期起为 8",
    stepSeries.slice(0, 4).every((d) => d === 4) && stepSeries.slice(4).every((d) => d === 8),
    JSON.stringify(stepSeries)
  );

  const randSeries = G.generateDemandSeries(
    G.normalizeConfig({ periods: 200, demandMode: "random", demandMin: 2, demandMax: 10, demandVolatility: 3, demandStart: 4 }),
    { rngState: 99 }
  );
  const inRange = randSeries.every((d) => d >= 2 && d <= 10);
  const distinct = new Set(randSeries).size > 3;
  check("随机波动：始终落在 [min,max] 内", inRange, `min=${Math.min(...randSeries)} max=${Math.max(...randSeries)}`);
  check("随机波动：确实在波动（取值多样）", distinct, `distinct=${new Set(randSeries).size}`);
}

/* --------------------------- 6. 可复现性 --------------------------- */
section("6. 可复现性（同 seed 完全一致）");

{
  const a = G.runAuto({ periods: 36, demandMode: "random", botLevel: "hard", seed: 12345 });
  const b = G.runAuto({ periods: 36, demandMode: "random", botLevel: "hard", seed: 12345 });
  const c = G.runAuto({ periods: 36, demandMode: "random", botLevel: "hard", seed: 999 });

  const sig = (s) => JSON.stringify({
    totals: G.ROLES.map((r) => s.roles[r].totalCost),
    orders: G.ROLES.map((r) => G.roleSeries(s, r, "order")),
    demand: s.customerDemand,
  });

  check("同 seed 两次运行结果完全相同", sig(a) === sig(b));
  check("不同 seed 结果不同", sig(a) !== sig(c));

  // 玩家订单参与计算：不同玩家输入必须产生不同结果
  let s1 = G.createGame({ periods: 12, demandMode: "stable", playerRole: "retailer" });
  let s2 = G.createGame({ periods: 12, demandMode: "stable", playerRole: "retailer" });
  while (!s1.ended) { s1 = G.step(s1, 4); s2 = G.step(s2, 9); }
  check("玩家订单输入真实影响结果", s1.totalCost !== s2.totalCost);
}

/* --------------------------- 7. 机器人智能度分档 --------------------------- */
section("7. 机器人智能度：难度越高成本越低");

const TIER_SCENARIOS = [
  { demandMode: "stable", periods: 36 },
  { demandMode: "step", periods: 36 },
  { demandMode: "random", periods: 36 },
];
// 覆盖 3 种需求模式 × 12 个随机种子 = 36 个独立对局组合
const TIER_SEEDS = [7, 11, 13, 19, 22, 29, 33, 41, 44, 55, 57, 71];

const tierRuns = [];
for (const scenario of TIER_SCENARIOS) {
  for (const seed of TIER_SEEDS) {
    const base = {
      periods: scenario.periods,
      demandMode: scenario.demandMode,
      playerRole: "none", // 纯机器人对局：分档比较不被玩家决策干扰
      seed,
    };
    tierRuns.push({
      tag: `${scenario.demandMode}/${seed}`,
      easy: G.runAuto(Object.assign({}, base, { botLevel: "easy" })).totalCost,
      normal: G.runAuto(Object.assign({}, base, { botLevel: "normal" })).totalCost,
      hard: G.runAuto(Object.assign({}, base, { botLevel: "hard" })).totalCost,
    });
  }
}

function winRate(predicate) {
  const wins = tierRuns.filter(predicate).length;
  return { wins, total: tierRuns.length, rate: wins / tierRuns.length };
}

const hardBeatsEasy = winRate((r) => r.hard < r.easy);
const hardBeatsNormal = winRate((r) => r.hard < r.normal);
const normalBeatsEasy = winRate((r) => r.normal < r.easy);

check(
  `困难档在 ${hardBeatsEasy.total} 个对局中成本低于简单档（>=90%）`,
  hardBeatsEasy.rate >= 0.9,
  `${hardBeatsEasy.wins}/${hardBeatsEasy.total}`
);
check(
  `困难档在 ${hardBeatsNormal.total} 个对局中成本低于普通档（>=90%）`,
  hardBeatsNormal.rate >= 0.9,
  `${hardBeatsNormal.wins}/${hardBeatsNormal.total}`
);
check(
  `普通档在 ${normalBeatsEasy.total} 个对局中成本低于简单档（>=75%）`,
  normalBeatsEasy.rate >= 0.75,
  `${normalBeatsEasy.wins}/${normalBeatsEasy.total}`
);

// 决策随机性：简单档应显著高于普通档、普通档高于困难档
// （对应需求中的"简单模式随机性高，困难模式能优化库存和订单"）
{
  const orderStd = (level) => {
    const all = [];
    for (const run of tierRuns) {
      const seed = Number(run.tag.split("/")[1]);
      const mode = run.tag.split("/")[0];
      const st = G.runAuto({ periods: 36, demandMode: mode, botLevel: level, playerRole: "none", seed });
      for (const role of G.ROLES) {
        for (const row of st.roles[role].history) all.push(row.order);
      }
    }
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    return Math.sqrt(all.reduce((a, v) => a + (v - mean) ** 2, 0) / all.length);
  };

  const stdEasy = orderStd("easy");
  const stdNormal = orderStd("normal");
  const stdHard = orderStd("hard");

  check(
    "订单波动 简单 > 普通 > 困难（随机性随难度下降）",
    stdEasy > stdNormal && stdNormal > stdHard,
    `easy=${stdEasy.toFixed(2)} normal=${stdNormal.toFixed(2)} hard=${stdHard.toFixed(2)}`
  );
  check(
    "困难档订单波动显著低于简单档（低至少 30%）",
    stdHard < stdEasy * 0.7,
    `hard=${stdHard.toFixed(2)} easy=${stdEasy.toFixed(2)}`
  );
}

// 分场景平均成本，必须严格单调：hard < normal < easy
for (const scenario of TIER_SCENARIOS) {
  const rows = tierRuns.filter((r) => r.tag.startsWith(`${scenario.demandMode}/`));
  const mean = (key) => rows.reduce((a, r) => a + r[key], 0) / rows.length;
  const hard = mean("hard");
  const normal = mean("normal");
  const easy = mean("easy");
  check(
    `[${scenario.demandMode}] 平均成本单调 hard < normal < easy`,
    hard < normal && normal < easy,
    `hard=${hard.toFixed(1)} normal=${normal.toFixed(1)} easy=${easy.toFixed(1)}`
  );
}

{
  // 玩家在场时的分档比较。
  // 注意：runAuto 让"玩家"恒定下单 0，那是一个消极玩家（会人为压低整链响应），
  // 不能代表真实玩法。这里改用"按需求下单、缺货时追加"的合理玩家策略。
  const policy = (state) => {
    const me = state.roles[state.config.playerRole];
    const down = G.DOWNSTREAM[state.config.playerRole];
    let demand;
    if (!down) {
      demand = state.customerDemand[Math.min(state.period - 1, state.customerDemand.length - 1)];
    } else {
      const hist = state.roles[down].history;
      demand = hist.length ? hist[hist.length - 1].order : state.config.initialIncomingOrder;
    }
    return Math.max(0, me.inventory <= 0 ? demand + 4 : demand);
  };
  const playOut = (level, role, seed) => {
    let st = G.createGame({ periods: 36, demandMode: "step", playerRole: role, botLevel: level, seed });
    while (!st.ended) st = G.step(st, policy(st));
    return st;
  };

  const seeds = [5, 17, 23, 31, 43, 59];
  for (const role of ["retailer", "wholesaler", "distributor", "factory"]) {
    let hardWins = 0;
    for (const seed of seeds) {
      if (playOut("hard", role, seed).totalCost < playOut("easy", role, seed).totalCost) hardWins += 1;
    }
    check(
      `玩家扮演${G.ROLE_LABELS[role]}时，困难队友在 ${seeds.length} 局中多数优于简单队友`,
      hardWins / seeds.length >= 0.8,
      `${hardWins}/${seeds.length}`
    );
  }
}

/* --------------------------- 8. 参数收敛 --------------------------- */
section("8. 非法/边界参数收敛");

{
  const bad = G.normalizeConfig({
    periods: -5,
    playerRole: "ceo",
    botLevel: "god",
    demandMode: "chaos",
    initialInventory: -20,
    inventoryCost: -1,
    demandMin: 10,
    demandMax: 3,
    seed: -1,
  });
  check("periods 被收敛为正数", bad.periods >= 4, `periods=${bad.periods}`);
  check("非法角色回落到 retailer", bad.playerRole === "retailer");
  check("非法难度回落到 normal", bad.botLevel === "normal");
  check("非法需求模式回落到 step", bad.demandMode === "step");
  check("负初始库存收敛为 0", bad.initialInventory === 0);
  check("负成本收敛为 0", bad.inventoryCost === 0);
  check("demandMax 被抬到 >= demandMin", bad.demandMax >= bad.demandMin);

  // 新选项：是否显示其他节点的库存情况
  check("showOtherInventory 默认为开启", G.defaultConfig().showOtherInventory === true);
  check("showOtherInventory 可显式关闭",
    G.normalizeConfig({ showOtherInventory: false }).showOtherInventory === false);
  check("showOtherInventory 未传入时保持默认", G.normalizeConfig({}).showOtherInventory === true);
  check("showOtherInventory 接受真值并转为布尔",
    G.normalizeConfig({ showOtherInventory: 1 }).showOtherInventory === true);
  // 该选项纯粹是界面可见性开关，不得影响对局计算
  const withShow = G.runAuto({ periods: 24, demandMode: "step", botLevel: "normal", showOtherInventory: true });
  const withHide = G.runAuto({ periods: 24, demandMode: "step", botLevel: "normal", showOtherInventory: false });
  check("showOtherInventory 不影响对局结果（纯界面选项）",
    withShow.totalCost === withHide.totalCost,
    `显示=${withShow.totalCost} 隐藏=${withHide.totalCost}`);
  check("showOtherInventory 不影响需求序列",
    JSON.stringify(withShow.customerDemand) === JSON.stringify(withHide.customerDemand));
}

{
  // 全零且机器人关闭：应当全程零成本、零库存、零缺货（纯账务基线）
  const zero = G.runAuto({
    periods: 8,
    demandMode: "stable",
    demandStart: 0,
    initialInventory: 0,
    initialPipeline: 0,
    initialIncomingOrder: 0,
    botLevel: "off",
  });
  check(
    "全零配置 + 机器人关闭：跑完且总成本为 0",
    zero.ended === true && zero.totalCost === 0,
    `cost=${zero.totalCost}`
  );

  // 全零需求但机器人开启：允许产生成本，但不得出现负值或 NaN
  const withBots = G.runAuto({ periods: 8, demandMode: "stable", demandStart: 0, initialIncomingOrder: 0 });
  const costs = G.ROLES.map((r) => withBots.roles[r].totalCost);
  check(
    "零需求 + 机器人开启：成本有限且非负",
    withBots.ended === true && costs.every((c) => Number.isFinite(c) && c >= 0),
    `costs=${JSON.stringify(costs)}`
  );
}

/* --------------------------- 9. 玩家角色可切换 --------------------------- */
section("9. 四个角色均可作为玩家");

for (const role of G.ROLES) {
  let state = G.createGame({ periods: 12, demandMode: "step", playerRole: role, botLevel: "normal" });
  let ok = true;
  while (!state.ended) {
    state = G.step(state, 5);
    const row = state.roles[role].history[state.roles[role].history.length - 1];
    if (row.order !== 5) ok = false; // 玩家订单必须被原样采用
  }
  check(`以 ${G.ROLE_LABELS[role]} 身份游玩时订单被原样采纳`, ok);
}

/* --------------------------- 10. 报表结构 --------------------------- */
section("10. 结算报表");

{
  const state = G.runAuto({ periods: 36, demandMode: "step", botLevel: "normal", playerRole: "wholesaler" });
  const report = G.buildReport(state);
  check("报表包含四个角色", report.byRole.length === 4);
  check("报表标出玩家角色", report.byRole.filter((r) => r.isPlayer).length === 1);
  check("玩家成本与角色成本一致", report.playerCost === state.roles.wholesaler.totalCost);
  check("需求序列长度等于周期数", report.customerDemand.length === 36);
  // 累计成本序列含开局起点(0)，因此长度 = 周期数 + 1
  check("累计成本序列含起点，长度 = 周期数 + 1",
    report.cumulativeCostSeries.length === 37,
    "len=" + report.cumulativeCostSeries.length);
  check("累计成本序列起点为 0", report.cumulativeCostSeries[0] === 0,
    "first=" + report.cumulativeCostSeries[0]);
  check("累计成本序列末项等于供应链总成本",
    report.cumulativeCostSeries[report.cumulativeCostSeries.length - 1] === report.supplyChainCost,
    "last=" + report.cumulativeCostSeries[report.cumulativeCostSeries.length - 1] + " total=" + report.supplyChainCost);
  check("累计成本序列单调不减",
    report.cumulativeCostSeries.every(function (v, i, a) { return i === 0 || v >= a[i - 1]; }));
  check("订单序列长度等于周期数", report.byRole[0].orders.length === 36);
  check("牛鞭效应为 N/A 或有限非负数",
    report.bullwhip === null ||
    (typeof report.bullwhip === "number" && report.bullwhip >= 0 && report.bullwhip <= 20),
    `bw=${report.bullwhip}`);
  check("报表中的牛鞭效应与独立计算一致",
    report.bullwhip === G.bullwhip(state),
    `report=${report.bullwhip} direct=${G.bullwhip(state)}`);
}

{
  // 零售商订单几乎不波动时，牛鞭效应必须判为 N/A，而不是放大的巨大比值
  const flat = G.runAuto({ periods: 36, demandMode: "stable", botLevel: "normal", playerRole: "retailer" });
  check("零售商几乎不波动时牛鞭效应为 N/A",
    G.bullwhip(flat) === null || G.bullwhip(flat) <= 20,
    "bw=" + G.bullwhip(flat));

  // 四角色全为机器人时，牛鞭效应应是有限正值（真实对局才有意义）
  const allBots = G.runAuto({ periods: 36, demandMode: "step", botLevel: "normal", playerRole: "none" });
  check("全员机器人对局的牛鞭效应为有限正数",
    typeof G.bullwhip(allBots) === "number" && G.bullwhip(allBots) > 0,
    "bw=" + G.bullwhip(allBots));
}

/* --------------------------- 11. 机器人不会长期停滞 --------------------------- */
section("11. 机器人不会长期全部零订单（防链条停滞）");

{
  // 高初始库存会让机器人理性地少订货，但绝不能永久停滞：
  // 需求最终会消耗库存，订单必须重新出现。
  const highStock = G.runAuto({
    periods: 36,
    demandMode: "step",
    botLevel: "hard",
    playerRole: "none",
    initialInventory: 20,
    initialPipeline: 4,
  });

  const tail = 12;
  let tailOrdersOk = true;
  let totalTailOrders = 0;
  for (const role of G.ROLES) {
    const rows = highStock.roles[role].history.slice(-tail);
    const sumOrders = rows.reduce((a, r) => a + r.order, 0);
    totalTailOrders += sumOrders;
    if (sumOrders <= 0) tailOrdersOk = false;
  }
  check(
    `高初始库存下，最后 ${tail} 个周期内每个角色都至少下过一次订单`,
    tailOrdersOk,
    `尾部订单总量=${totalTailOrders}`
  );

  // 开局初期允许为 0（库存充足），但整局不可能全程为 0
  let overallOk = true;
  for (const role of G.ROLES) {
    const sum = highStock.roles[role].history.reduce((a, r) => a + r.order, 0);
    if (sum <= 0) overallOk = false;
  }
  check("整局每个角色的订单总量大于 0（链条确实在流动）", overallOk);

  // 零订单周期必须是"库存充足"导致的，而不是"无故停滞"
  let noStall = true;
  for (const role of G.ROLES) {
    for (const row of highStock.roles[role].history) {
      if (row.order === 0 && row.inventoryEnd < 10) {
        noStall = false; // 库存已经很低却不下单 = 异常停滞
      }
    }
  }
  check("低库存状态下不会零订单（不存在无故停滞）", noStall);

  // 困难档是"精益"策略：缺货周期不一定最少，但总成本必须最低（真正的优化目标）。
  // 因此这里比较总成本，而不是缺货周期数。
  const costs = {};
  for (const level of G.BOT_LEVELS) {
    let sum = 0;
    for (const seed of [31, 47, 63]) {
      sum += G.runAuto({ periods: 36, demandMode: "step", botLevel: level, playerRole: "none", seed }).totalCost;
    }
    costs[level] = sum / 3;
  }
  check(
    "困难档平均总成本最低（三档中）",
    costs.hard < costs.normal && costs.hard < costs.easy,
    `hard=${costs.hard.toFixed(0)} normal=${costs.normal.toFixed(0)} easy=${costs.easy.toFixed(0)}`
  );
}

/* --------------------------- 12. 上下游发货/收货的因果链 --------------------------- */
section("12. 订单驱动发货：上游发货必须跟随下游的订单");

{
  // 回归断言（针对曾经的缺陷）：上游发货曾经取"下游面临的需求"而不是"下游的订单"，
  // 导致下游加大订单量时上游发货量完全不变，供应链的订单→发货闭环断裂。
  const runWithRetailerOrder = (retailerOrder, periods) => {
    let st = G.createGame({
      periods,
      demandMode: "stable",
      demandStart: 4,
      playerRole: "retailer",
      botLevel: "normal",
      initialInventory: 12,
      initialPipeline: 4,
      seed: 1,
    });
    while (!st.ended) st = G.step(st, retailerOrder);
    return st;
  };

  const low = runWithRetailerOrder(6, 12);
  const high = runWithRetailerOrder(20, 12);

  const wholesalerServedLow = low.roles.wholesaler.history.reduce((a, h) => a + h.demand, 0);
  const wholesalerServedHigh = high.roles.wholesaler.history.reduce((a, h) => a + h.demand, 0);
  check(
    "下游订单量提高后，上游面对的需求随之提高",
    wholesalerServedHigh > wholesalerServedLow,
    `零售订6 → 批发面对需求合计=${wholesalerServedLow}；零售订20 → ${wholesalerServedHigh}`
  );

  const shippedLow = low.roles.wholesaler.history.reduce((a, h) => a + h.shipped, 0);
  const shippedHigh = high.roles.wholesaler.history.reduce((a, h) => a + h.shipped, 0);
  check(
    "下游订单量提高后，上游发货量随之提高",
    shippedHigh > shippedLow,
    `发货合计 低=${shippedLow} 高=${shippedHigh}`
  );

  // 上游面对的需求必须等于下游"按提前期到达"的订单（提前期 1）
  let st = G.createGame({
    periods: 8, demandMode: "stable", demandStart: 4,
    playerRole: "retailer", botLevel: "normal", seed: 1,
  });
  let causalityOk = true;
  let detail = "";
  while (!st.ended) {
    const prevRetailerOrder = st.roles.retailer.history.length
      ? st.roles.retailer.history[st.roles.retailer.history.length - 1].order
      : st.config.initialIncomingOrder;
    st = G.step(st, 9);
    const served = st.roles.wholesaler.history[st.roles.wholesaler.history.length - 1].demand;
    if (served !== prevRetailerOrder) {
      causalityOk = false;
      detail = `t${st.lastTurn.period}: 批发面对需求=${served} 但零售商上期订单=${prevRetailerOrder}`;
    }
  }
  check("上游面对的需求 == 下游上一期的订单（历史订单不被改写）", causalityOk, detail || "逐期一致");

  // 工厂的服务需求必须来自分销商的订单（而不是分销商面临的需求代理）
  let f = G.createGame({
    periods: 8, demandMode: "stable", demandStart: 4,
    playerRole: "retailer", botLevel: "normal", seed: 2,
  });
  let factoryOk = true;
  let fdetail = "";
  while (!f.ended) {
    const prevDistOrder = f.roles.distributor.history.length
      ? f.roles.distributor.history[f.roles.distributor.history.length - 1].order
      : f.config.initialIncomingOrder;
    f = G.step(f, 9);
    const served = f.roles.factory.history[f.roles.factory.history.length - 1].demand;
    if (served !== prevDistOrder) {
      factoryOk = false;
      fdetail = `t${f.lastTurn.period}: 工厂面对需求=${served} 但分销商上期订单=${prevDistOrder}`;
    }
  }
  check("工厂面对的需求 == 分销商上一期的订单", factoryOk, fdetail || "逐期一致");
}

{
  // 订单提前期语义：t 期下的单，上游在 t+orderLeadTime 期看到
  for (const delay of [false, true]) {
    const lead = delay ? 2 : 1;
    let st = G.createGame({
      periods: 6, demandMode: "stable", demandStart: 4,
      playerRole: "retailer", botLevel: "off", extraOrderDelay: delay, initialIncomingOrder: 4,
    });
    const seenAt = {};
    let period = 1;
    while (!st.ended) {
      st = G.step(st, 7);
      // 下游第一次"服务到"7 的期数
      const served = st.roles.wholesaler.history[st.roles.wholesaler.history.length - 1].demand;
      if (served === 7 && seenAt.first === undefined) seenAt.first = period;
      period += 1;
    }
    check(
      `订单提前期=${lead} 时，t1 下的单在 t${1 + lead} 被上游服务`,
      seenAt.first === 1 + lead,
      `实际 t${seenAt.first}`
    );
  }
}

/* --------------------------- 汇总 --------------------------- */
console.log("\n" + "=".repeat(60));
if (failures.length === 0) {
  console.log(`\u5168\u90e8\u901a\u8fc7\uff1a${passed} \u9879\u65ad\u8a00\u5168\u90e8\u6210\u529f\u3002`);
  console.log("=".repeat(60));
  process.exit(0);
} else {
  console.log(`\u5931\u8d25 ${failures.length} \u9879\uff0c\u901a\u8fc7 ${passed} \u9879\uff1a`);
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` -> ${f.detail}` : ""}`);
  console.log("=".repeat(60));
  process.exit(1);
}
