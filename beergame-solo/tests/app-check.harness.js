/* =========================================================================
 * beergame-solo / tests/app-check.harness.js
 * 浏览器内验证 harness。由 tests/run-browser-check.js 通过 CDP 注入到
 * 真实游戏页面（/index.html）的顶层文档里执行，返回结构化结果。
 *
 * 不使用 iframe：iframe 的子资源加载会冻结 Chrome 的虚拟时间。
 * 不使用 --dump-dom：它在 load 事件时立即输出，早于异步断言完成。
 * ====================================================================== */

(async function () {
  "use strict";

  var lines = [];
  var fails = 0;

  function ok(name, cond, detail) {
    lines.push((cond ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
    if (!cond) fails += 1;
  }
  function info(msg) { lines.push("INFO | " + msg); }
  function wait(ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); }

  var UI = window.BeerGameUI;
  var G = window.BeerGame;
  if (!G) return { lines: ["FAIL | game-logic.js 未加载"], fails: 1 };
  if (!UI) return { lines: ["FAIL | game.js 未暴露 BeerGameUI"], fails: 1 };

  /* ================= 1. 设置界面结构 ================= */
  var setup = document.getElementById("setupScreen");
  var gameScreen = document.getElementById("gameScreen");
  var resultScreen = document.getElementById("resultScreen");

  ok("页面标记 data-app-ready", document.body.getAttribute("data-app-ready") === "1");
  ok("设置区存在且可见", !!setup && !setup.hidden);
  ok("游戏区初始隐藏", !!gameScreen && gameScreen.hidden);
  ok("结算区初始隐藏", !!resultScreen && resultScreen.hidden);
  ok("顶部数据条在设置页真正隐藏（hidden 未被 CSS 覆盖）",
    document.getElementById("headerStats").hidden === true &&
    window.getComputedStyle(document.getElementById("headerStats")).display === "none",
    "computed display=" + window.getComputedStyle(document.getElementById("headerStats")).display);

  ok("四个角色选项", document.querySelectorAll("#roleChoices .choice").length === 4,
    "count=" + document.querySelectorAll("#roleChoices .choice").length);
  ok("三个机器人档位", document.querySelectorAll("#botChoices .choice").length === 3);
  ok("三个周期选项", document.querySelectorAll("#periodChoices .choice").length === 3);
  ok("三个需求模式", document.querySelectorAll("#demandChoices .choice").length === 3);
  ok("初始库存滑块存在", !!document.getElementById("inputInitialInventory"));
  ok("初始在途滑块存在", !!document.getElementById("inputInitialPipeline"));
  ok("额外延迟开关存在", !!document.getElementById("inputExtraDelay"));
  ok("“显示其他节点库存”开关存在且默认开启",
    !!document.getElementById("inputShowOtherInventory") &&
    document.getElementById("inputShowOtherInventory").checked === true);
  ok("需求参数区默认渲染 3 项（阶梯增长）",
    document.querySelectorAll("#demandParams input").length === 3,
    "params=" + document.querySelectorAll("#demandParams input").length);

  /* ================= 2. 设置项写入配置 ================= */
  document.querySelectorAll("#periodChoices .choice")[0].click();
  document.querySelectorAll("#botChoices .choice")[2].click();
  document.querySelectorAll("#roleChoices .choice")[3].click();

  var draft = UI.getDraft();
  ok("draft.periods = 18", draft.periods === 18, "=" + draft.periods);
  ok("draft.botLevel = hard", draft.botLevel === "hard", "=" + draft.botLevel);
  ok("draft.playerRole = factory", draft.playerRole === "factory", "=" + draft.playerRole);

  document.querySelectorAll("#demandChoices .choice")[2].click();
  ok("切到随机波动后参数区为 4 项（起始/下限/上限/波动幅度）",
    document.querySelectorAll("#demandParams input").length === 4,
    "params=" + document.querySelectorAll("#demandParams input").length + " ids=" +
    Array.prototype.map.call(document.querySelectorAll("#demandParams input"), function (i) { return i.id; }).join(","));
  ok("随机模式参数包含 demandVolatility",
    !!document.getElementById("dp_demandVolatility"));
  document.querySelectorAll("#demandChoices .choice")[1].click();
  ok("切回阶梯增长后参数区为 3 项",
    document.querySelectorAll("#demandParams input").length === 3,
    "params=" + document.querySelectorAll("#demandParams input").length);

  var invInput = document.getElementById("inputInitialInventory");
  invInput.value = "20";
  invInput.dispatchEvent(new Event("input"));
  ok("初始库存滑块写入 draft = 20", UI.getDraft().initialInventory === 20, "=" + UI.getDraft().initialInventory);

  /* ================= 3. 开局与主视图 ================= */
  UI.start();
  var st = UI.getState();
  ok("开局后生成 state", !!st);
  ok("游戏区显示、设置区隐藏", !gameScreen.hidden && setup.hidden);
  ok("state.period 从 1 开始", st.period === 1, "=" + st.period);
  ok("配置生效：18 周期 / 工厂 / 困难",
    st.config.periods === 18 && st.config.playerRole === "factory" && st.config.botLevel === "hard");
  ok("初始库存 20 已生效", st.roles.retailer.inventory === 20, "=" + st.roles.retailer.inventory);

  ok("SVG 渲染 4 个角色节点", document.querySelectorAll("#nodeLayer .node").length === 4);
  ok("我的角色高亮唯一", document.querySelectorAll(".node-me").length === 1);
  ok("运输通道已渲染", document.querySelectorAll("#laneLayer line").length >= 4,
    "lines=" + document.querySelectorAll("#laneLayer line").length);
  ok("信息面板 5 行（4 角色 + 顾客）", document.querySelectorAll("#infoBody tr").length === 5);
  ok("顶部周期显示 1/18", document.getElementById("statPeriod").textContent === "1/18",
    document.getElementById("statPeriod").textContent);
  ok("成本趋势图已绘制", !!document.querySelector("#costChart polyline"));
  ok("成本趋势图为简洁折线（无渐变面积层）",
    !!document.querySelector("#costChart polyline") && !document.querySelector("#costChart polygon"));
  ok("4 个节点都有在途管道读数", document.querySelectorAll('#nodeLayer [data-stat="pipeline"]').length === 4);
  ok("全景图不含背景网格（简约风格）",
    document.querySelectorAll("#supplySvg #gridLayer").length === 0);

  // 全景图内文字的实际渲染字号：避免容器过窄导致文字被缩到不可读
  (function () {
    var svg = document.getElementById("supplySvg");
    var textEl = svg.querySelector(".node-stat");
    var declared = parseFloat(getComputedStyle(textEl).fontSize); // CSS 像素（未缩放）
    var rect = textEl.getBoundingClientRect();
    var svgRect = svg.getBoundingClientRect();
    // getBoundingClientRect 反映缩放后的实际高度，用它估算有效字号
    var scale = svg.viewBox.baseVal.width ? svgRect.width / svg.viewBox.baseVal.width : 1;
    var effective = declared * scale;

    var scrollBox = document.querySelector(".board-scroll");
    var canScroll = scrollBox && scrollBox.scrollWidth > scrollBox.clientWidth + 1;

    ok("全景图文字实际渲染字号 >= 8px（可读）",
      effective >= 8,
      `declared=${declared}px scale=${scale.toFixed(2)} effective=${effective.toFixed(1)}px` +
      (canScroll ? "（已启用横向滚动）" : ""));

    // 若字号偏小，必须能用横向滚动把它读出来
    ok("字号不足时提供横向滚动兜底",
      effective >= 8 || canScroll,
      `effective=${effective.toFixed(1)}px canScroll=${!!canScroll}`);
  })();

  // 全景图内的文本不得互相压叠（防止节点文字过长再次退化）
  (function () {
    var svg = document.getElementById("supplySvg");

    // 入场动效会让元素临时位移，测量前先清除动画类并强制重排，
    // 否则量到的是动画中间态而不是最终布局。
    Array.prototype.forEach.call(svg.querySelectorAll(".animate__animated"), function (el) {
      el.classList.remove("animate__animated", "animate__fadeInUp", "animate__pulse", "animate__headShake");
      el.style.animationDelay = "";
    });
    void svg.getBoundingClientRect();

    var boxes = Array.prototype.slice.call(svg.querySelectorAll("text")).map(function (t) {
      var r = t.getBoundingClientRect();
      return { s: (t.textContent || "").slice(0, 14), l: r.left, t: r.top, r: r.right, b: r.bottom };
    }).filter(function (b) { return b.r - b.l > 1 && b.b - b.t > 1; });

    var overlaps = [];
    for (var i = 0; i < boxes.length; i += 1) {
      for (var j = i + 1; j < boxes.length; j += 1) {
        var a = boxes[i];
        var c = boxes[j];
        var ox = Math.min(a.r, c.r) - Math.max(a.l, c.l);
        var oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        if (ox > 1 && oy > 1) overlaps.push(a.s + " <-> " + c.s);
      }
    }
    ok("全景图内文本无互相压叠（最终布局）", overlaps.length === 0,
      overlaps.length ? overlaps.slice(0, 4).join(" ; ") : boxes.length + " 段文本互不重叠");
  })();

  /* ================= 4. 一局可玩通（不带动画） ================= */
  var costBefore = UI.getState().totalCost;
  UI.autoPlay(999);
  var finalState = UI.getState();
  ok("autoPlay 跑到结束", finalState.ended === true);
  ok("历史长度等于周期数 18", finalState.roles[finalState.config.playerRole].history.length === 18,
    "history=" + finalState.roles[finalState.config.playerRole].history.length);
  ok("累计成本随对局增长", finalState.totalCost > costBefore,
    "before=" + costBefore + " after=" + finalState.totalCost);
  ok("结算区可见", !resultScreen.hidden);
  ok("游戏区已隐藏", gameScreen.hidden);
  ok("结算指标 5 项", document.querySelectorAll("#resultMetrics .metric").length === 5);
  ok("结算表 4 行", document.querySelectorAll("#resultBody tr").length === 4);
  ok("结算摘要含周期数 18",
    /18/.test(document.getElementById("resultSummary").textContent),
    document.getElementById("resultSummary").textContent.slice(0, 60));

  document.getElementById("btnAgain").click();
  ok("再玩一局：回到设置界面", !setup.hidden && resultScreen.hidden);
  ok("再玩后 state 已清空", UI.getState() === null);

  /* ============ 4.5 “显示其他节点库存”开关 ============ */
  {
    const readTable = () => {
      const rows = [];
      document.querySelectorAll("#infoBody tr").forEach((tr) => {
        rows.push(Array.from(tr.querySelectorAll("td")).map((td) => td.textContent));
      });
      return rows;
    };
    const fieldOf = (role, name) => {
      const g = document.querySelector('.node[data-role="' + role + '"]');
      const el = g && g.querySelector('[data-field="' + name + '"]');
      return el ? el.textContent : null;
    };
    const notice = document.getElementById("maskedNotice");
    // 前面的检查可能已把 state 置空（"再玩一局"），这里确保处于进行中的对局
    if (!UI.getState()) UI.start();
    const playerRole = UI.getState().config.playerRole;

    // 开启（默认）：所有节点都应显示数字
    let rows = readTable();
    ok("开关开启时：自己的库存为数字",
      /^\d+$/.test(rows.find((r) => r[0].indexOf("（你）") >= 0)[1]));
    ok("开关开启时：其他节点库存也是数字",
      G.ROLES.filter((r) => r !== playerRole).every((r) => {
        const row = rows.find((x) => x[0] === G.ROLE_LABELS[r]);
        return row && /^\d+$/.test(row[1]);
      }));
    ok("开关开启时：不显示隐藏提示", notice.hidden === true);

    // 关闭：其他节点打码，自己的仍然可见
    const toggle = document.getElementById("inputShowOtherInventory");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    UI.start();

    ok("关闭后 draft 记录为 false", UI.getDraft().showOtherInventory === false);
    ok("关闭后对局配置记录为 false", UI.getState().config.showOtherInventory === false);
    ok("关闭后显示隐藏提示", notice.hidden === false);

    rows = readTable();
    const meRow = rows.find((r) => r[0].indexOf("（你）") >= 0);
    ok("关闭后：自己的库存仍为数字", /^\d+$/.test(meRow[1]), "我的库存=" + meRow[1]);
    ok("关闭后：自己的在途仍为数字", /^\d+$/.test(meRow[3]), "我的在途=" + meRow[3]);
    ok("关闭后：自己的累计成本仍为数字", /^\d/.test(meRow[5]), "我的成本=" + meRow[5]);

    const otherRows = rows.filter((r) => r[0] !== "顾客 / 市场" && r[0].indexOf("（你）") < 0);
    ok("关闭后：其他节点的库存/缺货/在途全部打码",
      otherRows.length === 3 && otherRows.every((r) => r[1] === "—" && r[2] === "—" && r[3] === "—"),
      JSON.stringify(otherRows.map((r) => [r[0], r[1], r[2], r[3]])));
    ok("关闭后：其他节点仍显示累计成本（不属于库存情况）",
      otherRows.every((r) => /^\d/.test(r[5])), JSON.stringify(otherRows.map((r) => r[5])));

    // 看板节点也要打码
    ok("关闭后：看板中自己的库存仍为数字",
      /^\d+$/.test(fieldOf(playerRole, "inventory")), fieldOf(playerRole, "inventory"));
    ok("关闭后：看板中其他节点的库存打码",
      G.ROLES.filter((r) => r !== playerRole).every((r) => fieldOf(r, "inventory") === "—"));
    ok("关闭后：看板中其他节点的在途管道打码",
      G.ROLES.filter((r) => r !== playerRole).every((r) => fieldOf(r, "pipeNear") === "—"));
    ok("关闭后：看板中其他节点的成本仍可见",
      G.ROLES.filter((r) => r !== playerRole).every((r) => /^\d/.test(fieldOf(r, "cost"))));

    // 运输动画的数量标签也属于"在途信息"，隐藏时不应出现。
    // 注意：卡车在动画结束后会被移除，所以必须用 rAF 在播放期间取样，
    // 否则会"采到空数组"而空洞通过。
    document.getElementById("orderInput").value = "6";
    window.__truckLabelSamples = [];
    const truckSampler = function () {
      document.querySelectorAll("#motionLayer .motion-truck .motion-qty").forEach(function (t) {
        window.__truckLabelSamples.push(t.textContent.trim());
      });
      window.__truckSamplerId = window.requestAnimationFrame(truckSampler);
    };
    window.__truckSamplerId = window.requestAnimationFrame(truckSampler);
    await UI.confirm();
    window.cancelAnimationFrame(window.__truckSamplerId);

    const samples = window.__truckLabelSamples;
    const nonEmpty = samples.filter(function (s) { return s !== ""; });
    ok("关闭后：运输动画确实播放过（取样非空，排除空洞通过）",
      samples.length > 0, "samples=" + samples.length);
    ok("关闭后：运输动画不显示件数（不泄漏在途数量）",
      samples.length > 0 && nonEmpty.length === 0,
      "samples=" + samples.length + " 非空=" + JSON.stringify(nonEmpty.slice(0, 5)));

    // 恢复默认，避免影响后续检查
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    UI.start();
    ok("恢复开启后再次显示其他节点库存",
      readTable().find((r) => r[0] === G.ROLE_LABELS[playerRole === "retailer" ? "wholesaler" : "retailer"])[1] !== "—");
  }

  /* ================= 5. 动画回合（逐帧采样验证） ================= */
  // 用默认初始库存在"正常可玩状态"下验证动画（高库存时机器人会理性地少下单，
  // 订单卡可能为空，那不是动画缺陷）。
  UI.getDraft().initialInventory = 12;
  UI.getDraft().initialPipeline = 4;
  UI.start();
  ok("第二次开局 period = 1", UI.getState().period === 1);
  ok("第二次开局结算区隐藏", resultScreen.hidden);
  ok("第二次开局顶部数据条可见", document.getElementById("headerStats").hidden === false);

  var lockViolation = false;
  var sawTruck = false;
  var sawOrder = false;
  var truckXs = [];
  var orderXs = [];
  var orderTrack = null;   // { key: 元素标识, xs: [] } —— 只跟踪"同一张"订单卡
  var orderTrackCount = 0;

  var orderElsSeen = 0;
  var orderElsSeenWhenVisible = 0;
  var sampleIterations = 0;

  function sample() {
    sampleIterations += 1;
    if (UI.isAnimating() && document.getElementById("btnConfirm").disabled !== true) lockViolation = true;
    var trucks = document.querySelectorAll("#motionLayer .motion-truck");
    var orders = document.querySelectorAll("#motionLayer .motion-order");
    if (trucks.length > 0) sawTruck = true;
    if (orders.length > 0) {
      sawOrder = true;
      orderElsSeenWhenVisible += orders.length;
    }
    orderElsSeen += orders.length;
    var t = trucks[0];
    if (t) {
      var m = /translate\(([-\d.]+),/.exec(t.getAttribute("transform") || "");
      if (m) truckXs.push(Number(m[1]));
    }
    // 订单卡是多个元素同时存在，必须锁定同一个元素跟踪，否则会把
    // "不同卡片的起始位置"误读成"同一张卡在移动"。
    var o = orders[0];
    if (o) {
      var mo = /translate\(([-\d.]+),/.exec(o.getAttribute("transform") || "");
      var key = o.getAttribute("data-track") || "o" + (orderTrackCount += 1);
      if (!o.getAttribute("data-track")) o.setAttribute("data-track", key);
      if (!orderTrack || orderTrack.key !== key) {
        orderTrack = { key: key, xs: [] };
      }
      if (mo) {
        orderTrack.xs.push(Number(mo[1]));
        orderXs.push(Number(mo[1]));
      }
    }
  }

  document.getElementById("orderInput").value = "7";
  var animPromise = UI.confirm();
  info("confirm 已启动: animating=" + UI.isAnimating());
  var pollCount = 0;
  while (UI.isAnimating() && pollCount < 600) {
    sample();
    pollCount += 1;
    await wait(16);
  }
  sample();
  await animPromise;
  info("采样迭代=" + pollCount + " 采样次数=" + sampleIterations +
    " 订单元素累计命中=" + orderElsSeen +
    " 卡车样本=" + truckXs.length + " 订单样本=" + orderXs.length);
  var tracked = orderTrack ? orderTrack.xs : [];
  ok("动画期间出现订单卡元素", sawOrder);
  ok("卡车位置随帧推进（动画真实移动）",
    truckXs.length >= 2 && Math.abs(truckXs[0] - truckXs[truckXs.length - 1]) > 1,
    "samples=" + truckXs.length + " first=" + truckXs[0] + " last=" + truckXs[truckXs.length - 1]);
  // 同一张订单卡：起点在右侧（下游），终点在左侧（上游），故 x 递减
  ok("同一张订单卡向上游移动（x 递减）",
    tracked.length >= 2 && tracked[tracked.length - 1] < tracked[0],
    "trackedSamples=" + tracked.length + " first=" + tracked[0] + " last=" + tracked[tracked.length - 1]);

  ok("动画期间确认按钮被禁用（输入锁定）", !lockViolation);
  ok("动画期间出现卡车元素", sawTruck);
  ok("动画结束后解除锁定",
    UI.isAnimating() === false && document.getElementById("btnConfirm").disabled === false);
  ok("动画结束后运动元素被清理",
    document.querySelectorAll("#motionLayer .motion-truck").length === 0 &&
    document.querySelectorAll("#motionLayer .motion-order").length === 0);
  ok("动画后周期推进到 2", UI.getState().period === 2, "period=" + UI.getState().period);
  ok("玩家订单 7 被如实采纳",
    UI.getState().roles[UI.getState().config.playerRole].history[0].order === 7,
    "order=" + UI.getState().roles[UI.getState().config.playerRole].history[0].order);

  /* ================= 6. 带动画连续回合 ================= */
  var s3 = await UI.playTurns(3);
  ok("带动画连续 3 回合后 period = 5", s3.period === 5, "period=" + s3.period);
  ok("历史累积 4 条记录", s3.roles[s3.config.playerRole].history.length === 4,
    "history=" + s3.roles[s3.config.playerRole].history.length);
  ok("控制区需求数字已刷新为纯数字",
    /^\d+$/.test(document.getElementById("demandValue").textContent),
    document.getElementById("demandValue").textContent);
  ok("信息面板仍为 5 行", document.querySelectorAll("#infoBody tr").length === 5);

  /* ================= 7. 结算增量：从第 5 周期打到结束 ================= */
  await UI.playTurns(100);
  var done = UI.getState();
  ok("从第 5 周期带动画打到结束", done.ended === true, "period=" + done.period);
  ok("总历史长度 = 18", done.roles[done.config.playerRole].history.length === 18,
    "history=" + done.roles[done.config.playerRole].history.length);
  ok("结束时结算区可见", !resultScreen.hidden);

  // 通过全局变量回传结果：表达式本身的完成值不可靠，全局变量是确定性的
  window.__CHECK_RESULT__ = { lines: lines, fails: fails };
  return window.__CHECK_RESULT__;
})().catch(function (err) {
  window.__CHECK_RESULT__ = {
    lines: ["FAIL | harness 抛出异常: " + String(err && (err.stack || err.message || err))],
    fails: 1,
  };
});
