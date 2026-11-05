/* =========================================================================
 * beergame-solo / src/game.js
 * UI 绑定层：设置界面、供应链主视图、控制区、信息面板、结算界面。
 *
 * 阶段二目标：功能完整、一局可玩通（动画与美化工夫留在阶段三/四）。
 * 逻辑全部来自 src/game-logic.js（globalThis.BeerGame），此文件只管呈现与交互。
 * ====================================================================== */

(function () {
  "use strict";

  var G = window.BeerGame;
  if (!G) {
    document.body.innerHTML =
      '<p style="color:#9f2f2d;padding:32px;font-family:sans-serif;font-size:15px">' +
      "逻辑核心 game-logic.js 未能加载，请确认 src/game-logic.js 与本页面在一起。</p>";
    return;
  }

  /* ===================================================================
   * 1. 静态文案与可选项
   * =================================================================== */

  var BOT_META = [
    { value: "easy", label: "简单", hint: "简单：多留两周安全库存，补货调整较急，适合观察过量备货。" },
    { value: "normal", label: "普通", hint: "普通：平滑预测需求，并计入运输在途与尚未发货的订单。" },
    { value: "hard", label: "困难", hint: "困难：结合补货提前期与需求波动，分步修正库存，减少重复订货。" }
  ];

  var ROLE_META = [
    { value: "retailer", label: "零售商", hint: "直接面对顾客，最能体会需求波动。" },
    { value: "wholesaler", label: "批发商", hint: "夹在零售商与分销商之间，订单被放大。" },
    { value: "distributor", label: "分销商", hint: "供应链中段，波动进一步放大。" },
    { value: "factory", label: "工厂", hint: "最上游，只能按订单生产，一步错步步错。" }
  ];

  var PERIOD_META = [
    { value: 18, label: "18 周期" },
    { value: 36, label: "36 周期" },
    { value: 54, label: "54 周期" }
  ];

  var DEMAND_META = [
    { value: "stable", label: "稳定需求", hint: "整局需求恒定，适合先熟悉规则。" },
    { value: "step", label: "阶梯式增长", hint: "需求在第 5 周期上跳，考验反应。" },
    { value: "random", label: "随机波动", hint: "需求随机游走，最贴近真实市场。" }
  ];

  var ROLE_ICON = {
    retailer: "M3 11h18l-2 8H5z M7 11V7a5 5 0 0 1 10 0v4",
    wholesaler: "M4 20V9l8-5 8 5v11z M9 20v-6h6v6",
    distributor: "M3 17h18v3H3z M6 17V8h12v9 M9 8V5h6v3",
    factory: "M4 20V10l5 3V10l5 3V7h6v13z"
  };

  /* ===================================================================
   * 2. 应用状态
   * =================================================================== */

  var draft = Object.assign(G.defaultConfig(), { periods: 36, botLevel: "normal" });
  var state = null;         // 当前对局状态（由 game-logic 生成）
  var isAnimating = false;  // 动画锁：播放期间不接受输入
  var activeTurn = null;    // 正在播放的回合动画 Promise（用于串行等待）

  /* ===================================================================
   * 3. 工具函数
   * =================================================================== */

  function $(id) { return document.getElementById(id); }

  function svgEl(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    }
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function round1(v) { return Math.round(v * 10) / 10; }

  function roleLabel(role) { return G.ROLE_LABELS[role] || role; }

  /** 是否隐藏"其他节点"的库存情况（库存 / 缺货 / 在途）；自己的始终可见 */
  function othersInventoryHidden() {
    return !!state && state.config.showOtherInventory === false;
  }

  /** 某角色的库存类数据是否应被打码 */
  function isMaskedFor(role) {
    return othersInventoryHidden() && role !== state.config.playerRole;
  }

  /** 打码占位：隐藏时用长破折号，保持与数字等宽的视觉节奏 */
  var MASK = "—";

  /** 触发一次性的 animate.css 动画（尊重系统的"减少动效"偏好） */
  function animateOnce(el, name, delayMs) {
    if (!el || prefersReducedMotion()) return;
    var cls = "animate__" + name;
    el.classList.remove("animate__animated", cls);
    void el.offsetWidth; // 强制重排，便于重复触发同一动画
    el.style.animationDelay = (delayMs || 0) + "ms";
    el.classList.add("animate__animated", cls);
    el.addEventListener("animationend", function () {
      el.classList.remove("animate__animated", cls);
      el.style.animationDelay = "";
    }, { once: true });
  }

  /* ===================================================================
   * 4. 设置界面
   * =================================================================== */

  function buildChoiceGroup(container, meta, current, onPick) {
    clear(container);
    meta.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice" + (String(item.value) === String(current) ? " is-active" : "");
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(String(item.value) === String(current)));
      btn.textContent = item.label;
      btn.addEventListener("click", function () { onPick(item); });
      container.appendChild(btn);
    });
  }

  function renderPeriodChoices() {
    buildChoiceGroup($("periodChoices"), PERIOD_META, draft.periods, function (item) {
      draft.periods = Number(item.value);
      // 阶梯变化的周期不能超过总局数
      if (draft.demandChangePeriod > draft.periods) draft.demandChangePeriod = draft.periods;
      renderPeriodChoices();
      renderDemandParams();
    });
  }

  function renderDemandParams() {
    var box = $("demandParams");
    clear(box);

    function addNumber(labelText, key, min, max, step) {
      var wrap = document.createElement("div");
      wrap.className = "param";
      var label = document.createElement("label");
      var inputId = "dp_" + key;
      label.setAttribute("for", inputId);
      label.textContent = labelText;
      var input = document.createElement("input");
      input.type = "number";
      input.id = inputId;
      input.min = min; input.max = max; input.step = step;
      input.value = draft[key];
      input.addEventListener("input", function () {
        draft[key] = Number(input.value);
      });
      wrap.appendChild(label);
      wrap.appendChild(input);
      box.appendChild(wrap);
    }

    if (draft.demandMode === "stable") {
      addNumber("恒定需求", "demandStart", 0, 50, 1);
    } else if (draft.demandMode === "step") {
      addNumber("起始需求", "demandStart", 0, 50, 1);
      addNumber("增量", "demandStep", 0, 50, 1);
      addNumber("变化周期", "demandChangePeriod", 1, draft.periods, 1);
    } else {
      addNumber("起始需求", "demandStart", 0, 50, 1);
      addNumber("下限", "demandMin", 0, 50, 1);
      addNumber("上限", "demandMax", 0, 50, 1);
      addNumber("波动幅度", "demandVolatility", 0, 20, 1);
    }
  }

  function initSetup() {
    buildChoiceGroup($("roleChoices"), ROLE_META, draft.playerRole, function (item) {
      draft.playerRole = item.value;
      renderRoleChoices();
    });
    renderRoleChoices();

    buildChoiceGroup($("botChoices"), BOT_META, draft.botLevel, function (item) {
      draft.botLevel = item.value;
      renderBotChoices();
    });
    renderBotChoices();

    renderPeriodChoices();

    buildChoiceGroup($("demandChoices"), DEMAND_META, draft.demandMode, function (item) {
      draft.demandMode = item.value;
      renderDemandChoices();
      renderDemandParams();
    });
    renderDemandChoices();
    renderDemandParams();

    var inv = $("inputInitialInventory");
    var invOut = $("outInitialInventory");
    inv.value = draft.initialInventory;
    invOut.textContent = draft.initialInventory;
    inv.addEventListener("input", function () {
      draft.initialInventory = Number(inv.value);
      invOut.textContent = inv.value;
    });

    var pipe = $("inputInitialPipeline");
    var pipeOut = $("outInitialPipeline");
    pipe.value = draft.initialPipeline;
    pipeOut.textContent = draft.initialPipeline;
    pipe.addEventListener("input", function () {
      draft.initialPipeline = Number(pipe.value);
      pipeOut.textContent = pipe.value;
    });

    $("inputExtraDelay").addEventListener("change", function (e) {
      draft.extraOrderDelay = e.target.checked;
    });

    var showOther = $("inputShowOtherInventory");
    showOther.checked = draft.showOtherInventory !== false;
    showOther.addEventListener("change", function (e) {
      draft.showOtherInventory = e.target.checked;
    });

    $("inputSeed").addEventListener("input", function (e) {
      draft.seed = Number(e.target.value) || 0;
    });

    $("btnStart").addEventListener("click", startGame);
  }

  function renderRoleChoices() {
    buildChoiceGroup($("roleChoices"), ROLE_META, draft.playerRole, function (item) {
      draft.playerRole = item.value;
      renderRoleChoices();
    });
  }

  function renderBotChoices() {
    buildChoiceGroup($("botChoices"), BOT_META, draft.botLevel, function (item) {
      draft.botLevel = item.value;
      renderBotChoices();
    });
    var meta = BOT_META.filter(function (m) { return m.value === draft.botLevel; })[0];
    $("botHint").textContent = meta ? meta.hint : "";
  }

  function renderDemandChoices() {
    buildChoiceGroup($("demandChoices"), DEMAND_META, draft.demandMode, function (item) {
      draft.demandMode = item.value;
      renderDemandChoices();
      renderDemandParams();
    });
  }

  /* ===================================================================
   * 5. 画面切换与开局
   * =================================================================== */

  function show(screen) {
    $("setupScreen").hidden = screen !== "setup";
    $("gameScreen").hidden = screen !== "game";
    $("resultScreen").hidden = screen !== "result";
    $("headerStats").hidden = screen === "setup";
  }

  function startGame() {
    state = G.createGame(draft);
    isAnimating = false;
    activeTurn = null;
    show("game");
    renderBoard();
    renderInfoPanel();
    renderCostChart();
    renderControl();
    // 入场动效：全景图逐个节点浮现（错峰要短，避免开局时节点长时间空缺）
    Array.prototype.forEach.call(document.querySelectorAll("#nodeLayer .node"), function (node, idx) {
      animateOnce(node, "fadeIn", idx * 55);
    });
  }

  /* ===================================================================
   * 6. 供应链主视图（SVG）
   * =================================================================== */

  var NODE_X = { customer: 1050, retailer: 830, wholesaler: 610, distributor: 390, factory: 170 };
  var NODE_Y = 190;
  var LANE_ORDER_Y = 380;
  var LANE_SHIP_Y = 76;
  var NODE_R = 44;
  var STOCK_BAR_W = 78;
  var VIEW_W = 1180;
  var VIEW_H = 460;

  // 每周期"在途"的两段所对应运送方 → 接收方（用于卡车动画）
  function renderBoard() {
    var laneLayer = $("laneLayer");
    var nodeLayer = $("nodeLayer");
    clear(laneLayer);
    clear(nodeLayer);
    clear($("motionLayer"));

    // --- 运输通道 ---
    var lanes = [
      { from: "factory", to: "distributor" },
      { from: "distributor", to: "wholesaler" },
      { from: "wholesaler", to: "retailer" }
    ];
    lanes.forEach(function (lane) {
      var x1 = NODE_X[lane.from] + NODE_R + 20;
      var x2 = NODE_X[lane.to] - NODE_R - 20;
      var xm = (x1 + x2) / 2;

      // 货物下行通道：浅色条带 + 细虚线
      laneLayer.appendChild(svgEl("rect", {
        x: x1, y: LANE_SHIP_Y - 14, width: x2 - x1, height: 28,
        rx: 2, fill: "#f7f7f6", stroke: "#eaeaea", "stroke-width": 1
      }));
      laneLayer.appendChild(svgEl("line", {
        x1: x1 + 8, y1: LANE_SHIP_Y, x2: x2 - 8, y2: LANE_SHIP_Y,
        stroke: "#b6bab3", "stroke-width": 1.2,
        "stroke-dasharray": "4 4", "marker-end": "url(#arrowDown)"
      }));
      var shipCap = svgEl("text", { x: xm, y: LANE_SHIP_Y - 22, "text-anchor": "middle", "class": "lane-caption" });
      shipCap.textContent = roleLabel(lane.from) + " → " + roleLabel(lane.to);
      laneLayer.appendChild(shipCap);

      // 订单上行通道
      laneLayer.appendChild(svgEl("line", {
        x1: x1 + 8, y1: LANE_ORDER_Y, x2: x2 - 8, y2: LANE_ORDER_Y,
        stroke: "#b6bab3", "stroke-width": 1.2,
        "stroke-dasharray": "4 4", "marker-end": "url(#arrowUp)"
      }));
      var orderCap = svgEl("text", { x: x1 + 4, y: LANE_ORDER_Y + 16, "text-anchor": "start", "class": "lane-caption" });
      orderCap.textContent = "订单上行 · " + roleLabel(lane.to) + " → " + roleLabel(lane.from);
      laneLayer.appendChild(orderCap);
    });

    // 顾客 → 零售商的需求传递
    laneLayer.appendChild(svgEl("line", {
      x1: NODE_X.retailer + NODE_R + 20, y1: LANE_SHIP_Y,
      x2: NODE_X.customer - 44, y2: LANE_SHIP_Y,
      stroke: "#b6bab3", "stroke-width": 1.2, "stroke-dasharray": "4 4"
    }));
    var custCap = svgEl("text", {
      x: (NODE_X.retailer + NODE_X.customer) / 2, y: LANE_SHIP_Y - 22,
      "text-anchor": "middle", "class": "lane-caption"
    });
    custCap.textContent = "顾客需求";
    laneLayer.appendChild(custCap);

    // --- 顾客节点 ---
    nodeLayer.appendChild(svgEl("circle", {
      cx: NODE_X.customer, cy: NODE_Y, r: 40, fill: "#ffffff", stroke: "#dcdcd9", "stroke-width": 1.5
    }));
    nodeLayer.appendChild(svgEl("path", {
      d: "M-10 8 a10 10 0 0 1 20 0 M0 -12 a7 7 0 1 0 0.1 0",
      transform: "translate(" + NODE_X.customer + "," + (NODE_Y - 6) + ")",
      fill: "none", stroke: "#6b6f72", "stroke-width": 1.6, "stroke-linecap": "round"
    }));
    var custLabel = svgEl("text", {
      x: NODE_X.customer, y: NODE_Y + 62, "text-anchor": "middle", "class": "node-name"
    });
    custLabel.textContent = "顾客 / 市场";
    nodeLayer.appendChild(custLabel);
    var custStat = svgEl("text", {
      x: NODE_X.customer, y: NODE_Y + 86, "text-anchor": "middle", "class": "node-stat"
    });
    custStat.setAttribute("data-stat", "customerDemand");
    nodeLayer.appendChild(custStat);

    // --- 角色节点 ---
    G.ROLES.forEach(function (role) {
      var isMe = role === state.config.playerRole;
      var g = svgEl("g", { "class": "node" + (isMe ? " node-me" : ""), "data-role": role });
      g.setAttribute("transform", "translate(" + NODE_X[role] + "," + NODE_Y + ")");

      if (isMe) {
        g.appendChild(svgEl("circle", {
          r: NODE_R + 7, fill: "none", stroke: "#303732", "stroke-width": 1.5
        }));
      }
      g.appendChild(svgEl("circle", {
        r: NODE_R, fill: isMe ? "#edf3ec" : "#ffffff",
        stroke: isMe ? "#303732" : "#dcdcd9", "stroke-width": 1.5
      }));
      g.appendChild(svgEl("path", {
        d: ROLE_ICON[role], fill: "none",
        stroke: isMe ? "#303732" : "#6b6f72",
        "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round",
        transform: "translate(-12,-12)"
      }));

      // 名称
      var name = svgEl("text", { y: 60, "text-anchor": "middle", "class": "node-name" });
      name.textContent = roleLabel(role) + (isMe ? "（你）" : "");
      g.appendChild(name);

      // 库存条：细条形，平色（库存 / 缺货共用一条）
      g.appendChild(svgEl("rect", {
        x: -STOCK_BAR_W / 2, y: 70, width: STOCK_BAR_W, height: 5, rx: 2.5, fill: "#f0f0ee"
      }));
      var stockBar = svgEl("rect", {
        x: -STOCK_BAR_W / 2, y: 70, width: 0, height: 5, rx: 2.5, fill: "#7f9f8b", "class": "stock-bar"
      });
      g.appendChild(stockBar);
      var backBar = svgEl("rect", {
        x: -STOCK_BAR_W / 2, y: 70, width: 0, height: 5, rx: 2.5, fill: "#c9807e", "class": "backlog-bar"
      });
      g.appendChild(backBar);

      // 库存 / 在途（拆成独立 tspan，便于"隐藏其他节点库存"时分别打码）
      var invText = svgEl("text", { y: 97, "text-anchor": "middle", "class": "node-stat" });
      invText.setAttribute("data-stat", "inventory");
      var invPrefix = svgEl("tspan", {});
      invPrefix.textContent = "存 ";
      var invValue = svgEl("tspan", { "data-field": "inventory" });
      var invMid = svgEl("tspan", {});
      invMid.textContent = " 途 ";
      var pipeValue = svgEl("tspan", { "data-field": "pipeline" });
      invText.appendChild(invPrefix);
      invText.appendChild(invValue);
      invText.appendChild(invMid);
      invText.appendChild(pipeValue);
      g.appendChild(invText);

      // 缺货 / 成本
      var subText = svgEl("text", { y: 113, "text-anchor": "middle", "class": "node-sub" });
      subText.setAttribute("data-stat", "sub");
      var backPrefix = svgEl("tspan", { "data-field": "backlogLabel" });
      var backValue = svgEl("tspan", { "data-field": "backlog" });
      var costPrefix = svgEl("tspan", { "data-field": "costLabel" });
      var costValue = svgEl("tspan", { "data-field": "cost" });
      subText.appendChild(backPrefix);
      subText.appendChild(backValue);
      subText.appendChild(costPrefix);
      subText.appendChild(costValue);
      g.appendChild(subText);

      // 在途管道读数（近段即将到货 / 远段再下一周期到货）
      var pipeText = svgEl("text", { y: 129, "text-anchor": "middle", "class": "node-pipe" });
      pipeText.setAttribute("data-stat", "pipeline");
      var pipePrefix = svgEl("tspan", {});
      pipePrefix.textContent = "管 ";
      var pipeNear = svgEl("tspan", { "data-field": "pipeNear" });
      var pipeArrow = svgEl("tspan", {});
      pipeArrow.textContent = "→";
      var pipeFar = svgEl("tspan", { "data-field": "pipeFar" });
      pipeText.appendChild(pipePrefix);
      pipeText.appendChild(pipeNear);
      pipeText.appendChild(pipeArrow);
      pipeText.appendChild(pipeFar);
      g.appendChild(pipeText);

      nodeLayer.appendChild(g);
    });

    updateBoard();
  }

  /** 根据当前 state 刷新主视图上的数字与条形（不涉及动画） */
  function updateBoard() {
    if (!state) return;
    var maxStock = Math.max(10, state.config.initialInventory * 2);

    var custStat = document.querySelector('[data-stat="customerDemand"]');
    if (custStat) {
      var upcoming = state.customerDemand[Math.min(state.period - 1, state.config.periods - 1)];
      custStat.textContent = "本周需求 " + upcoming;
    }

    G.ROLES.forEach(function (role) {
      var rs = state.roles[role];
      var g = document.querySelector('.node[data-role="' + role + '"]');
      if (!g) return;

      var field = function (name) { return g.querySelector('[data-field="' + name + '"]'); };
      var masked = isMaskedFor(role);
      var stockBar = g.querySelector(".stock-bar");
      var backBar = g.querySelector(".backlog-bar");

      g.classList.toggle("is-backlog", rs.backlog > 0);
      g.classList.toggle("is-masked", masked);

      // 库存 / 在途 / 缺货 / 在途管道：隐藏其他节点时统一打码
      field("inventory").textContent = masked ? MASK : String(rs.inventory);
      field("pipeline").textContent = masked ? MASK : String(rs.pipeline[0] + rs.pipeline[1]);
      field("pipeNear").textContent = masked ? MASK : String(rs.pipeline[0]);
      field("pipeFar").textContent = masked ? MASK : String(rs.pipeline[1]);

      // 缺货只在真正缺货时显示（对齐原表达）
      if (masked) {
        field("backlogLabel").textContent = "";
        field("backlog").textContent = "";
      } else if (rs.backlog > 0) {
        field("backlogLabel").textContent = "缺 ";
        field("backlog").textContent = String(rs.backlog) + " ";
      } else {
        field("backlogLabel").textContent = "";
        field("backlog").textContent = "";
      }

      // 累计成本不属于"库存情况"，始终显示
      field("costLabel").textContent = "成本 ";
      field("cost").textContent = String(round1(rs.totalCost));
      field("costLabel").classList.toggle("danger", rs.backlog > 0 && !masked);
      field("cost").classList.toggle("danger", rs.backlog > 0 && !masked);

      if (masked) {
        stockBar.setAttribute("width", "0");
        backBar.setAttribute("width", "0");
      } else {
        var invRatio = Math.min(1, rs.inventory / maxStock);
        stockBar.setAttribute("width", String(Math.round(STOCK_BAR_W * invRatio)));
        var backRatio = Math.min(1, rs.backlog / maxStock);
        backBar.setAttribute("width", String(Math.round(STOCK_BAR_W * backRatio)));
      }
    });

    updateMaskedNotice();
  }

  /** 同步"库存已隐藏"的提示文本 */
  function updateMaskedNotice() {
    var notice = $("maskedNotice");
    if (!notice) return;
    notice.hidden = !othersInventoryHidden();
  }

  /* ===================================================================
   * 7. 信息面板 + 成本趋势
   * =================================================================== */

  function renderInfoPanel() {
    var tbody = $("infoBody");
    clear(tbody);

    G.ROLES.forEach(function (role) {
      var rs = state.roles[role];
      var last = rs.history.length ? rs.history[rs.history.length - 1] : null;
      var tr = document.createElement("tr");
      if (role === state.config.playerRole) tr.className = "row-me";
      var masked = isMaskedFor(role);
      // 列序：节点 | 库存 | 缺货 | 在途 | 本周期需求 | 累计成本
      // 隐藏其他节点库存时，只打码"库存/缺货/在途"三列（需求与成本不属于库存情况）
      var cells = [
        { text: roleLabel(role) + (role === state.config.playerRole ? "（你）" : "") },
        { text: masked ? MASK : String(rs.inventory), cls: "col-stock" },
        { text: masked ? MASK : String(rs.backlog), cls: "col-stock" + (!masked && rs.backlog > 0 ? " danger" : "") },
        { text: masked ? MASK : String(rs.pipeline[0] + rs.pipeline[1]), cls: "col-stock" },
        { text: String(state.ended ? (last ? last.demand : 0) : G.currentDemand(state, role)) },
        { text: String(round1(rs.totalCost)) }
      ];
      cells.forEach(function (cell) {
        var td = document.createElement("td");
        td.textContent = cell.text;
        if (cell.cls) td.className = cell.cls;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    // 顾客这一行也展示出来，便于观察需求
    var trC = document.createElement("tr");
    trC.className = "row-customer";
    var nextDemand = state.customerDemand[Math.min(state.period - 1, state.config.periods - 1)];
    ["顾客 / 市场", MASK, MASK, MASK, String(nextDemand), MASK].forEach(function (text) {
      var td = document.createElement("td");
      td.textContent = text;
      trC.appendChild(td);
    });
    tbody.appendChild(trC);
  }

  function renderCostChart() {
    var svg = $("costChart");
    clear(svg);
    var series = state.cumulativeCostSeries;
    var W = 320, H = 90, pad = 10;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");

    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }));

    // 网格：极轻的水平参考线
    for (var i = 0; i <= 3; i += 1) {
      var y = pad + ((H - pad * 2) * i) / 3;
      svg.appendChild(svgEl("line", { x1: pad, y1: y, x2: W - pad, y2: y, stroke: "#f0f0ee", "stroke-width": 1 }));
    }

    if (series.length < 1) return;

    var maxV = Math.max.apply(null, series) || 1;
    // 只有一个数据点时复制一个点，保证始终有可见的折线（而不是空白图表）
    var plot = series.length === 1 ? [series[0], series[0]] : series;
    var n = Math.max(plot.length - 1, 1);
    var pts = plot.map(function (v, idx) {
      var x = pad + ((W - pad * 2) * idx) / n;
      var y = H - pad - ((H - pad * 2) * v) / maxV;
      return x.toFixed(1) + "," + y.toFixed(1);
    });

    svg.appendChild(svgEl("polyline", {
      points: pts.join(" "), fill: "none", stroke: "#303732", "stroke-width": 1.6,
      "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke"
    }));
  }

  /* ===================================================================
   * 8. 控制区
   * =================================================================== */

  function playerRoleState() { return state.roles[state.config.playerRole]; }

  /** 玩家本周面对的需求：零售商看顾客需求，其他角色看下游的订单 */
  function playerDemandThisPeriod() {
    return G.currentDemand(state, state.config.playerRole);
  }

  function renderControl() {
    if (!state) return;
    var rs = playerRoleState();
    var period = Math.min(state.period, state.config.periods);
    var demand = playerDemandThisPeriod();

    $("controlTitle").textContent = "第 " + period + " / " + state.config.periods + " 周期 · " +
      roleLabel(state.config.playerRole) + " 下单";
    $("demandValue").textContent = String(demand);
    $("myInventory").textContent = String(rs.inventory);
    $("myPipeline").textContent = String(rs.pipeline[0] + rs.pipeline[1]);
    $("myBacklog").textContent = String(rs.backlog);

    var input = $("orderInput");
    input.value = String(demand);
    input.max = "200";

    renderQuickOrders(demand);
    var advice = G.recommendOrder(state, state.config.playerRole, "hard");
    $("adviceOrder").textContent = advice.order + " 箱";
    $("adviceText").textContent = advice.order === 0 ? "现有库存与已订货量足以覆盖目标，先等补货，避免重复下单。" : "按近期需求估算补货目标，同时扣除运输在途和已下单未发出的货。";
    $("adviceFacts").textContent = "需求预测 " + advice.forecast + " / 周 · 库存位置 " + advice.position + " · 待发货 " + advice.outstanding + " · 覆盖 " + advice.coverage + " 周";
    $("sessionLabel").textContent = roleLabel(state.config.playerRole) + " / " + G.DEMAND_MODE_LABELS[state.config.demandMode] + " / " + G.BOT_LABELS[state.config.botLevel] + " AI";
    $("weekProgress").setAttribute("aria-valuemax", state.config.periods);
    $("weekProgress").setAttribute("aria-valuenow", state.period - 1);
    $("weekProgressFill").style.width = ((state.period - 1) / state.config.periods * 100) + "%";
    updateHeaderStats();
    $("turnBadge").textContent = "进行中";
    $("turnBadge").className = "turn-badge";
  }

  function renderQuickOrders(demand) {
    var box = $("quickOrders");
    clear(box);
    var options = [0, demand, demand + 2, demand + 5, demand + 10];
    var seen = {};
    options.forEach(function (v) {
      if (v < 0 || v > 200 || seen[v]) return;
      seen[v] = true;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "quick-btn";
      b.disabled = isAnimating;
      b.textContent = v === demand ? v + " (按需求)" : String(v);
      b.addEventListener("click", function () {
        $("orderInput").value = String(v);
      });
      box.appendChild(b);
    });
  }

  function updateHeaderStats(options) {
    var rs = playerRoleState();
    var period = Math.min(state.period, state.config.periods);
    var costEl = $("statCost");
    var totalEl = $("statTotalCost");
    var nextCost = String(round1(rs.totalCost));
    var nextTotal = String(round1(state.totalCost));
    var costChanged = costEl.textContent !== nextCost;
    var totalChanged = totalEl.textContent !== nextTotal;

    $("statPeriod").textContent = period + "/" + state.config.periods;
    $("statInventory").textContent = String(rs.inventory);
    $("statBacklog").textContent = String(rs.backlog);
    costEl.textContent = nextCost;
    totalEl.textContent = nextTotal;

    if (options && options.animate) {
      if (costChanged) animateOnce(costEl, "pulse");
      if (totalChanged) animateOnce(totalEl, "pulse");
      if (rs.backlog > 0) animateOnce($("statBacklog"), "pulse");
    }
  }

  /* ===================================================================
   * 9. 动画引擎
   * =================================================================== */

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function wait(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /** requestAnimationFrame 补间（不依赖 WAAPI，跨浏览器稳定） */
  function tween(duration, onFrame, onDone) {
    if (prefersReducedMotion() || duration <= 0) {
      onFrame(1);
      if (onDone) onDone();
      return;
    }
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      onFrame(easeInOutCubic(t));
      if (t < 1) {
        window.requestAnimationFrame(frame);
      } else if (onDone) {
        onDone();
      }
    }
    window.requestAnimationFrame(frame);
  }

  /** 沿直线移动一个 SVG 元素（transform 平移） */
  function glide(node, fromX, fromY, toX, toY, duration) {
    return new Promise(function (resolve) {
      tween(duration, function (p) {
        var x = fromX + (toX - fromX) * p;
        var y = fromY + (toY - fromY) * p;
        node.setAttribute("transform", "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ")");
      }, resolve);
    });
  }

  /** 数字滚动（成本等） */
  function rollNumber(el, from, to, duration, suffix) {
    if (!el) return Promise.resolve();
    return new Promise(function (resolve) {
      tween(duration, function (p) {
        el.textContent = round1(from + (to - from) * p) + (suffix || "");
      }, resolve);
    });
  }

  /** 卡车图标（货物下行）：浅色平涂，细描边 */
  function makeTruck(x, y, qty) {
    var g = svgEl("g", { transform: "translate(" + x + "," + y + ")", "class": "motion-truck" });
    g.appendChild(svgEl("line", { x1: -58, y1: 16, x2: 58, y2: 16, stroke: "#e0e0dd", "stroke-width": 1 }));
    g.appendChild(svgEl("rect", { x: -30, y: -11, width: 34, height: 21, rx: 2, fill: "#edf3ec", stroke: "#9fc0ae", "stroke-width": 1 }));
    g.appendChild(svgEl("path", { d: "M4 -4 h11 l7 7 v7 h-18 z", fill: "#edf3ec", stroke: "#9fc0ae", "stroke-width": 1 }));
    g.appendChild(svgEl("circle", { cx: -19, cy: 11, r: 4, fill: "#ffffff", stroke: "#9fc0ae", "stroke-width": 1 }));
    g.appendChild(svgEl("circle", { cx: 11, cy: 11, r: 4, fill: "#ffffff", stroke: "#9fc0ae", "stroke-width": 1 }));
    var label = svgEl("text", { x: 0, y: -18, "text-anchor": "middle", "class": "motion-qty" });
    label.textContent = qty + " 件";
    g.appendChild(label);
    return g;
  }

  /** 订单卡图标（订单上行）：浅色平涂，细描边 */
  function makeOrderCard(x, y, qty) {
    var g = svgEl("g", { transform: "translate(" + x + "," + y + ")", "class": "motion-order" });
    g.appendChild(svgEl("rect", { x: -26, y: -13, width: 52, height: 26, rx: 3, fill: "#f7f7f6", stroke: "#a2aaa1", "stroke-width": 1 }));
    g.appendChild(svgEl("path", { d: "M-15 -4 h18 M-15 3 h11", stroke: "#a2aaa1", "stroke-width": 1.4, "stroke-linecap": "round" }));
    var label = svgEl("text", { x: 0, y: 3.5, "text-anchor": "middle", "class": "motion-qty-dark" });
    label.textContent = String(qty);
    label.setAttribute("fill", "#303732");
    g.appendChild(label);
    var caption = svgEl("text", { x: 0, y: -22, "text-anchor": "middle", "class": "motion-caption" });
    caption.textContent = "订单 " + qty;
    g.appendChild(caption);
    return g;
  }

  /** 阶段一：订单卡沿链路上行（零售商 → 批发商 → 分销商 → 工厂） */
  function playOrderCards(record) {
    var layer = $("motionLayer");
    var promises = [];
    // 从下游到上游依次弹出，形成"订单逐级上传"的观感
    var seq = ["retailer", "wholesaler", "distributor", "factory"];
    seq.forEach(function (role, idx) {
      var qty = record.orders[role];
      if (!qty) return;
      var up = G.UPSTREAM[role];
      if (!up) return; // 工厂没有上游，订单即生产指令

      var x1 = NODE_X[role];
      var x2 = NODE_X[up];
      var card = makeOrderCard(x1, LANE_ORDER_Y, qty);
      layer.appendChild(card);

      promises.push(
        wait(idx * 140)
          .then(function () { return glide(card, x1, LANE_ORDER_Y, x2, LANE_ORDER_Y, 760); })
          .then(function () {
            if (card.parentNode) card.parentNode.removeChild(card);
          })
      );
    });
    return Promise.all(promises);
  }

  /** 阶段二：卡车沿链路下行（工厂 → 分销商 → 批发商 → 零售商） */
  function playTrucks(record) {
    var layer = $("motionLayer");
    var promises = [];
    G.ROLES.forEach(function (role) {
      var down = G.DOWNSTREAM[role];
      if (!down) return;
      var qty = record.shipments[role];
      if (!qty) return;

      var x1 = NODE_X[role];
      var x2 = NODE_X[down];
      var truck = makeTruck(x1, LANE_SHIP_Y, qty);
      layer.appendChild(truck);

      var distance = Math.abs(x2 - x1);
      var duration = 480 + distance * 0.45;
      // 隐藏其他节点库存时，不显示卡车的数量标签：发货量属于在途信息
      if (othersInventoryHidden()) {
        var qtyLabel = truck.querySelector(".motion-qty");
        if (qtyLabel) qtyLabel.textContent = "";
      }
      promises.push(
        wait(120)
          .then(function () { return glide(truck, x1, LANE_SHIP_Y, x2, LANE_SHIP_Y, duration); })
          .then(function () {
            if (truck.parentNode) truck.parentNode.removeChild(truck);
            var target = document.querySelector('.node[data-role="' + down + '"]');
            if (target) {
              target.classList.add("is-receiving");
              window.setTimeout(function () { target.classList.remove("is-receiving"); }, 700);
            }
            return wait(120);
          })
      );
    });
    return Promise.all(promises);
  }

  /** 库存条动画：从"本周期初"过渡到"本周期末" */
  function playStockBars(record, duration) {
    var maxStock = Math.max(10, state.config.initialInventory * 2);
    var promises = [];

    G.ROLES.forEach(function (role) {
      var g = document.querySelector('.node[data-role="' + role + '"]');
      if (!g) return;
      var stockBar = g.querySelector(".stock-bar");
      var backBar = g.querySelector(".backlog-bar");
      var before = record.before[role];
      var after = record.after[role];

      var fromW = Math.round(STOCK_BAR_W * Math.min(1, before.inventory / maxStock));
      var toW = Math.round(STOCK_BAR_W * Math.min(1, after.inventory / maxStock));
      var fromB = Math.round(STOCK_BAR_W * Math.min(1, before.backlog / maxStock));
      var toB = Math.round(STOCK_BAR_W * Math.min(1, after.backlog / maxStock));

      promises.push(new Promise(function (resolve) {
        tween(duration, function (p) {
          stockBar.setAttribute("width", String(Math.round(fromW + (toW - fromW) * p)));
          backBar.setAttribute("width", String(Math.round(fromB + (toB - fromB) * p)));
        }, resolve);
      }));
    });

    return Promise.all(promises);
  }

  function pointAt(svg, series, idx) {
    var W = 320, H = 90, pad = 10;
    var maxV = Math.max.apply(null, series) || 1;
    var n = Math.max(series.length - 1, 1);
    var x = pad + ((W - pad * 2) * idx) / n;
    var y = H - pad - ((H - pad * 2) * series[idx]) / maxV;
    return x.toFixed(1) + "," + y.toFixed(1);
  }

  /** 成本折线增量绘制（简约风格：只画折线，不做渐变面积） */
  function playCostChart(series, duration) {
    var svg = $("costChart");
    var line = svg.querySelector("polyline");
    if (!line || series.length < 2) return Promise.resolve();
    var total = series.length - 1;
    var from = Math.max(0, total - 1);

    return new Promise(function (resolve) {
      tween(duration, function (p) {
        var upto = Math.min(total, from + p * (total - from + 0.0001));
        var pts = [];
        for (var i = 0; i <= Math.floor(upto); i += 1) {
          pts.push(pointAt(svg, series, i));
        }
        var frac = upto - Math.floor(upto);
        if (frac > 0 && Math.floor(upto) < total) {
          var a = pointAt(svg, series, Math.floor(upto));
          var b = pointAt(svg, series, Math.floor(upto) + 1);
          var ax = Number(a.split(",")[0]), ay = Number(a.split(",")[1]);
          var bx = Number(b.split(",")[0]), by = Number(b.split(",")[1]);
          pts.push((ax + (bx - ax) * frac).toFixed(1) + "," + (ay + (by - ay) * frac).toFixed(1));
        }
        line.setAttribute("points", pts.join(" "));
      }, resolve);
    });
  }

  function setControlsLocked(locked) {
    isAnimating = !!locked;
    $("btnConfirm").disabled = !!locked;
    $("btnMinus").disabled = !!locked;
    $("btnPlus").disabled = !!locked;
    $("orderInput").disabled = !!locked;
    $("btnUseAdvice").disabled = !!locked;
    $("btnGameSetup").disabled = !!locked;
    document.querySelectorAll(".quick-btn").forEach(function (b) { b.disabled = !!locked; });
  }

  /** 播放一个完整回合：订单上行 → 卡车下行 → 数据收敛 */
  function playTurn(record) {
    var promises = [
      playOrderCards(record),
      playStockBars(record, 900),
      playCostChart(state.cumulativeCostSeries, 900)
    ];
    // 卡车在订单开始上传后紧接着出发（两个阶段部分重叠，观感更连贯）
    promises.push(wait(140).then(function () { return playTrucks(record); }));

    return Promise.all(promises).then(function () {
      // 最终以真实状态收敛，避免动画残留误差
      updateBoard();
      renderInfoPanel();
      $("statCost").textContent = String(round1(playerRoleState().totalCost));
      $("statTotalCost").textContent = String(round1(state.totalCost));
    });
  }

  /* ===================================================================
   * 10. 回合推进
   * =================================================================== */

  function handleConfirm() {
    if (window.BeerOnline && window.BeerOnline.active()) return window.BeerOnline.submit();
    // 动画未结束时不能静默丢弃这次点击（调用方会误判为已完成），
    // 改为返回"当前动画结束"的 Promise，便于串行等待。
    if (!state || state.ended) return Promise.resolve(state);
    if (isAnimating) return activeTurn || Promise.resolve(state);

    var raw = Number($("orderInput").value);
    if (!isFinite(raw) || raw < 0) raw = 0;
    var order = Math.min(200, Math.max(0, Math.round(raw)));

    var turn = G.step(state, order);
    var record = turn.lastTurn;
    var previousTotal = state.totalCost;
    state = turn;

    setControlsLocked(true);
    updateHeaderStats();
    // 面板与图表先按新状态重建，随后由动画接管视觉过程
    renderInfoPanel();
    renderCostChart();
    renderControlForNextTurn(record);

    var chain = playTurn(record);

    chain = chain.then(function () {
      // 总成本数字滚动结束后再刷新统计，保证脉冲动效真的能触发
      return rollNumber($("statTotalCost"), previousTotal, state.totalCost, 420, "");
    });

    chain = chain.then(function () {
      $("statCost").textContent = String(round1(playerRoleState().totalCost));
      $("statTotalCost").textContent = String(round1(state.totalCost));
      updateHeaderStats({ animate: false });
      setControlsLocked(false);
      renderResultIfOver();
      logTurn(record);
      if (!state.ended) {
        $("turnBadge").textContent = "周期 " + Math.min(state.period, state.config.periods);
        $("turnBadge").className = "turn-badge";
        renderControl();
      }
      animateOnce($("statTotalCost"), "pulse");
      if (state.roles[state.config.playerRole].backlog > 0) {
        animateOnce($("statBacklog"), "pulse");
      }
      activeTurn = null;
    });

    activeTurn = chain;
    return chain;
  }

  /** 动画期间提前把"下一周期"的需求与订单输入准备好 */
  function renderControlForNextTurn(record) {
    if (state.ended) return;
    var demand = playerDemandThisPeriod();
    $("demandValue").textContent = String(demand);
    var rs = playerRoleState();
    $("myInventory").textContent = String(rs.inventory);
    $("myPipeline").textContent = String(rs.pipeline[0] + rs.pipeline[1]);
    $("myBacklog").textContent = String(rs.backlog);
    $("controlTitle").textContent = "第 " + Math.min(state.period, state.config.periods) + " / " +
      state.config.periods + " 周期 · " + roleLabel(state.config.playerRole) + " 下单";
    $("controlHint").textContent =
      "第 " + record.period + " 周期：你的订单 " + record.orders[state.config.playerRole] +
      "，" + G.ROLES.map(function (r) { return roleLabel(r) + " " + record.orders[r]; }).join(" · ");
    renderQuickOrders(demand);
  }

  function renderResultIfOver() {
    if (!state.ended) return;
    var report = G.buildReport(state);
    $("turnBadge").textContent = "已结束";
    $("turnBadge").className = "turn-badge is-done";
    showResult(report);
  }

  /** 回合日志：把本周期四个角色的订单展示在控制区下方 */
  function logTurn(record) {
    if (!record) return;
    $("controlHint").textContent =
      "第 " + record.period + " 周期：你的订单 " + record.orders[state.config.playerRole] +
      "，" + G.ROLES.map(function (r) { return roleLabel(r) + " " + record.orders[r]; }).join(" · ");
  }

  /* ===================================================================
   * 10. 结算界面
   * =================================================================== */

  function showResult(report) {
    var me = report.byRole.filter(function (r) { return r.isPlayer; })[0];
    $("resultSummary").textContent =
      "你扮演" + roleLabel(report.playerRole) + "，共 " + report.periods +
      " 个周期。你的累计成本为 " + me.totalCost + "，整条供应链总成本为 " + report.supplyChainCost + "。";

    var metrics = $("resultMetrics");
    clear(metrics);
    var items = [
      { label: "我的成本", value: me.totalCost },
      { label: "供应链总成本", value: report.supplyChainCost },
      { label: "牛鞭效应", value: report.bullwhip === null ? "N/A" : report.bullwhip.toFixed(2) },
      { label: "我的期末库存", value: me.inventoryEnd },
      { label: "我的期末缺货", value: me.backlogEnd }
    ];
    items.forEach(function (item) {
      var div = document.createElement("div");
      div.className = "metric";
      var l = document.createElement("span");
      l.className = "metric-label";
      l.textContent = item.label;
      var v = document.createElement("span");
      v.className = "metric-value";
      v.textContent = String(item.value);
      div.appendChild(l);
      div.appendChild(v);
      metrics.appendChild(div);
    });

    var tbody = $("resultBody");
    clear(tbody);
    report.byRole.forEach(function (row) {
      var tr = document.createElement("tr");
      if (row.isPlayer) tr.className = "row-me";
      var invCost = 0;
      var blCost = 0;
      var rs = state.roles[row.role];
      rs.history.forEach(function (h) { invCost += h.inventoryCost; blCost += h.backlogCost; });
      [row.label + (row.isPlayer ? "（你）" : ""), row.totalCost, round1(invCost), round1(blCost), row.inventoryEnd, row.backlogEnd]
        .forEach(function (text) {
          var td = document.createElement("td");
          td.textContent = String(text);
          tr.appendChild(td);
        });
      tbody.appendChild(tr);
    });

    var shortageWeeks = playerRoleState().history.filter(function (h) { return h.backlogEnd > 0; }).length;
    $("reviewNote").textContent = "本局有 " + shortageWeeks + " 周发生缺货。复盘时先看需求变化之后的订单，确认是否重复补了同一批未到货的缺口。";
    show("result");
  }

  /* ===================================================================
   * 11. 事件绑定与启动
   * =================================================================== */

  function initControls() {
    $("btnUseAdvice").addEventListener("click", function () {
      if (!state || state.ended || isAnimating) return;
      $("orderInput").value = G.recommendOrder(state, state.config.playerRole, "hard").order;
      $("orderInput").focus();
    });
    $("btnGameSetup").addEventListener("click", function () { if (!isAnimating) { state = null; show("setup"); } });
    $("btnExport").addEventListener("click", function () {
      if (!state || !state.ended) return;
      var rows = [["周期", "角色", "需求", "订货", "到货", "发货", "期末库存", "期末缺货", "库存成本", "缺货成本", "总成本"]];
      G.ROLES.forEach(function (role) { state.roles[role].history.forEach(function (h) {
        rows.push([h.period, roleLabel(role), h.demand, h.order, h.received, h.shipped, h.inventoryEnd, h.backlogEnd, h.inventoryCost, h.backlogCost, h.cost]);
      }); });
      var url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(function (r) { return r.join(","); }).join("\r\n")], { type: "text/csv;charset=utf-8" }));
      var link = document.createElement("a"); link.href = url; link.download = "beer-game-" + state.config.seed + ".csv";
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $("btnConfirm").addEventListener("click", handleConfirm);

    $("btnMinus").addEventListener("click", function () {
      var input = $("orderInput");
      input.value = String(Math.max(0, Number(input.value) - 1));
    });
    $("btnPlus").addEventListener("click", function () {
      var input = $("orderInput");
      input.value = String(Math.min(200, Number(input.value) + 1));
    });
    $("orderInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") handleConfirm();
    });

    $("btnAgain").addEventListener("click", function () {
      state = null;
      show("setup");
    });
    $("btnBackToSetup").addEventListener("click", function () {
      state = null;
      show("setup");
    });
  }

  function boot() {
    initSetup();
    initControls();
    show("setup");
    document.body.setAttribute("data-app-ready", "1");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 暴露给自动化验证/调试使用（不影响正常玩法）
  window.BeerGameUI = {
    receiveOnline: function (next) {
      var changed = !state || state.period !== next.period || state.config.playerRole !== next.config.playerRole;
      state = next;
      if (!changed) return;
      setControlsLocked(false);
      show("game"); renderBoard(); updateBoard(); renderInfoPanel(); renderCostChart(); renderControl(); updateHeaderStats(); renderResultIfOver();
    },
    getState: function () { return state; },
    getDraft: function () { return draft; },
    isAnimating: function () { return isAnimating; },
    isReducedMotion: prefersReducedMotion,
    start: startGame,
    /** 点击"确认订单"并返回动画完成后的 Promise */
    confirm: handleConfirm,
    setAnimationLock: setControlsLocked,
    /** 逐个播放回合动画并等待完成（自动等待在播动画） */
    playTurns: async function (n) {
      for (var i = 0; i < n; i += 1) {
        if (!state || state.ended) break;
        if (isAnimating && activeTurn) await activeTurn;
        if (!state || state.ended) break;
        await handleConfirm();
      }
      return state;
    },
    /** 供无头测试/截图使用：不带动画地快速推进 n 个周期 */
    autoPlay: function (n, orderFn) {
      setControlsLocked(false);
      var count = 0;
      while (state && !state.ended && count < n) {
        var rs = state.roles[state.config.playerRole];
        var order = typeof orderFn === "function"
          ? orderFn(state, count)
          : Math.max(0, rs.inventory <= 0 ? playerDemandThisPeriod() + 4 : playerDemandThisPeriod());
        state = G.step(state, order);
        count += 1;
      }
      updateBoard();
      renderInfoPanel();
      renderCostChart();
      updateHeaderStats();
      renderResultIfOver();
      if (state && !state.ended) renderControl();
      return count;
    }
  };
})();
