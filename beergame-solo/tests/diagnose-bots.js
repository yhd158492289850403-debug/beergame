/* 诊断脚本（非交付物）：比较三档机器人的成本结构，定位过度订货来源 */
"use strict";
const path = require("path");
const G = require(path.join(__dirname, "..", "src", "game-logic.js"));

function breakdown(state) {
  const out = {};
  for (const role of G.ROLES) {
    const rows = state.roles[role].history;
    out[role] = {
      inv: Math.round(rows.reduce((a, r) => a + r.inventoryCost, 0) * 10) / 10,
      bl: Math.round(rows.reduce((a, r) => a + r.backlogCost, 0) * 10) / 10,
      avgInv: Math.round((rows.reduce((a, r) => a + r.inventoryEnd, 0) / rows.length) * 10) / 10,
      avgOrder: Math.round((rows.reduce((a, r) => a + r.order, 0) / rows.length) * 10) / 10,
    };
  }
  return out;
}

for (const mode of ["stable", "step", "random"]) {
  console.log(`\n########## 需求模式: ${mode} ##########`);
  for (const level of ["easy", "normal", "hard"]) {
    let total = 0;
    const agg = {};
    const seeds = [11, 22, 33, 44, 55];
    for (const seed of seeds) {
      const st = G.runAuto({ periods: 36, demandMode: mode, botLevel: level, seed });
      total += st.totalCost;
      const b = breakdown(st);
      for (const role of G.ROLES) {
        agg[role] = agg[role] || { inv: 0, bl: 0, avgInv: 0, avgOrder: 0 };
        agg[role].inv += b[role].inv / seeds.length;
        agg[role].bl += b[role].bl / seeds.length;
        agg[role].avgInv += b[role].avgInv / seeds.length;
        agg[role].avgOrder += b[role].avgOrder / seeds.length;
      }
    }
    console.log(`\n--- botLevel=${level}  平均总成本=${(total / seeds.length).toFixed(1)} ---`);
    for (const role of G.ROLES) {
      const a = agg[role];
      console.log(
        `  ${G.ROLE_LABELS[role]}  库存成本=${a.inv.toFixed(1).padStart(7)}  缺货成本=${a.bl
          .toFixed(1)
          .padStart(7)}  平均库存=${a.avgInv.toFixed(1).padStart(6)}  平均订单=${a.avgOrder.toFixed(1).padStart(6)}`
      );
    }
  }
}
