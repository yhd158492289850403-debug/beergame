"use strict";
/* =========================================================================
 * beergame-solo / tests/check-flow.js
 * 货物流动与记账不变量（针对"增减货物 / 上下游发货 / 收货"的计算正确性）：
 *   1. 库存记账恒等式：期末库存 == 期初库存 + 到货 - 发货
 *   2. 到货时点：本期到货 == 上期期末在途近段
 *   3. 在途连续性：发货经两段在途后原样到达下游
 *   4. 全链货物守恒：期初库存+期初在途+累计生产 == 顾客收货+期末库存+期末在途
 *   5. 缺货与发货互斥、发货不超过可用量
 *
 *   node tests/check-flow.js
 * ====================================================================== */

"use strict";

const path = require("path");
const G = require(path.join(__dirname, "..", "src", "game-logic.js"));

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass += 1; console.log("  ✓ " + name + (detail ? "  |  " + detail : "")); }
  else { fails.push(name + (detail ? " -> " + detail : "")); console.log("  ✗ " + name + (detail ? "  ->  " + detail : "")); }
};

const BASE = {
  periods: 30,
  demandMode: "step",
  botLevel: "normal",
  playerRole: "none",
  initialInventory: 12,
  initialPipeline: 4,
  seed: 7,
};

/** 跑一局并返回每期快照 */
function playTurns(overrides) {
  let s = G.createGame(Object.assign({}, BASE, overrides));
  const turns = [];
  while (!s.ended) {
    s = G.step(s, 0);
    turns.push(s.lastTurn);
  }
  return { state: s, turns };
}

console.log("== 1. 库存记账恒等式 ==");
{
  let bad = null;
  for (const over of [{}, { extraOrderDelay: true }, { demandMode: "random" }, { botLevel: "hard" }, { initialInventory: 0, initialPipeline: 0 }]) {
    const { turns } = playTurns(over);
    for (const t of turns) {
      for (const r of G.ROLES) {
        const expect = t.before[r].inventory + t.receipts[r] - t.shipments[r];
        if (expect !== t.after[r].inventory) {
          bad = `周期${t.period} ${r}: ${t.before[r].inventory}+${t.receipts[r]}-${t.shipments[r]}=${expect} 实际=${t.after[r].inventory}`;
        }
      }
    }
  }
  ok("期末库存 == 期初库存 + 到货 - 发货（多种配置）", bad === null, bad || "全部一致");
}

console.log("\n== 2. 到货时点（在途近段入库）==");
{
  let bad = null;
  for (const over of [{}, { extraOrderDelay: true }, { initialPipeline: 0 }]) {
    const { turns } = playTurns(over);
    for (let i = 1; i < turns.length; i += 1) {
      for (const r of G.ROLES) {
        const prevNear = turns[i - 1].after[r].pipeline[0];
        if (turns[i].receipts[r] !== prevNear) {
          bad = `周期${turns[i].period} ${r}: 到货=${turns[i].receipts[r]} 上期近段=${prevNear}`;
        }
      }
    }
  }
  ok("本期到货 == 上期期末在途近段", bad === null, bad || "全部一致");
}

console.log("\n== 3. 在途连续性（发货 2 期后原样到达下游）==");
{
  // 逐角色追踪：某角色在 t 期的发货，应完整出现在下游 t+2 期的到货中
  let bad = null;
  const { turns } = playTurns({ demandMode: "step", botLevel: "hard", periods: 30 });
  for (let i = 0; i < turns.length; i += 1) {
    const t = turns[i];
    const target = turns.find((x) => x.period === t.period + 2);
    if (!target) continue;
    for (const r of G.ROLES) {
      const down = G.DOWNSTREAM[r];
      if (!down) continue;
      // 下游只有一个上游，因此到货应 >= 该上游本期发货
      if (target.receipts[down] < t.shipments[r]) {
        bad = `周期${t.period} ${r} 发货${t.shipments[r]}，${down} 在周期${target.period} 仅到货${target.receipts[down]}`;
      }
      // 且下游到货不应超过"所有上游发货"（只有一个上游，故应相等）
      if (target.receipts[down] !== t.shipments[r]) {
        bad = `周期${t.period} ${r} 发货${t.shipments[r]}，但 ${down} 在周期${target.period} 到货${target.receipts[down]}（应为相等）`;
      }
    }
  }
  ok("发货在 2 期后原样到达下游（一一对应）", bad === null, bad || "全部一致");
}

console.log("\n== 4. 全链货物守恒 ==");
{
  let bad = null;
  for (const over of [{}, { extraOrderDelay: true }, { demandMode: "random" }, { initialInventory: 0, initialPipeline: 0 }, { initialPipeline: 9 }]) {
    const cfg = Object.assign({}, BASE, over);
    const { state } = playTurns(over);
    const initInv = G.ROLES.length * cfg.initialInventory;
    const initPipe = G.ROLES.length * cfg.initialPipeline * 2;
    const produced = state.roles.factory.history.reduce((a, h) => a + h.order, 0);
    const custReceived = state.roles.retailer.history.reduce((a, h) => a + h.shipped, 0);
    const endInv = G.ROLES.reduce((a, r) => a + state.roles[r].inventory, 0);
    const endPipe = G.ROLES.reduce((a, r) => a + state.roles[r].pipeline[0] + state.roles[r].pipeline[1], 0);
    const lhs = initInv + initPipe + produced;
    const rhs = custReceived + endInv + endPipe;
    if (lhs !== rhs) bad = `LHS=${lhs} RHS=${rhs} 差=${lhs - rhs}`;
  }
  ok("期初库存+期初在途+累计生产 == 顾客收货+期末库存+期末在途", bad === null, bad || "全部一致");
}

console.log("\n== 5. 发货约束 ==");
{
  let overship = null;
  let coexist = null;
  for (const over of [{}, { demandMode: "random", botLevel: "hard" }, { initialInventory: 0, initialPipeline: 0 }]) {
    const { turns } = playTurns(over);
    for (const t of turns) {
      for (const r of G.ROLES) {
        const available = t.before[r].inventory + t.receipts[r];
        if (t.shipments[r] > available) {
          overship = `周期${t.period} ${r} 发货${t.shipments[r]} > 可用${available}`;
        }
        // 有库存却仍有缺货 = 记账矛盾
        if (t.after[r].inventory > 0 && t.after[r].backlog > 0) {
          coexist = `周期${t.period} ${r} 同时有库存${t.after[r].inventory}与缺货${t.after[r].backlog}`;
        }
      }
    }
  }
  ok("发货不超过可用量（期初库存 + 到货）", overship === null, overship || "全部一致");
  ok("期末不会同时存在库存与缺货", coexist === null, coexist || "全部一致");
}

console.log("\n== 6. 缺货结转：期末缺货 == 期初缺货 + 本期需求 - 本期发货 ==");
{
  let bad = null;
  for (const over of [
    { initialInventory: 0, initialPipeline: 0 },
    { initialInventory: 0, initialPipeline: 0, demandMode: "stable", demandStart: 6 },
    { demandMode: "step", botLevel: "easy" },
    { demandMode: "random", botLevel: "hard" },
  ]) {
    const { state } = playTurns(over);
    for (const r of G.ROLES) {
      const rows = state.roles[r].history;
      for (let i = 0; i < rows.length; i += 1) {
        const prevBacklog = i === 0 ? 0 : rows[i - 1].backlogEnd;
        // 注意：config.initialBacklog 默认 0，这里用首期的期初缺货补齐
        const opening = i === 0 ? (over.initialBacklog || 0) : prevBacklog;
        const expect = opening + rows[i].demand - rows[i].shipped;
        if (expect !== rows[i].backlogEnd) {
          bad = `周期${rows[i].period} ${r}: ${opening}+${rows[i].demand}-${rows[i].shipped}=${expect} 实际期末缺货=${rows[i].backlogEnd}`;
        }
      }
    }
  }
  ok("期末缺货 == 期初缺货 + 本期需求 - 本期发货", bad === null, bad || "全部一致");
}

console.log("\n" + "=".repeat(60));
if (fails.length === 0) {
  console.log(`货物流动审计通过：${pass} 项不变量全部成立。`);
  process.exit(0);
} else {
  console.log(`货物流动审计失败 ${fails.length} 项：`);
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
