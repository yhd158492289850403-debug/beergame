"use strict";
const assert = require("node:assert/strict");
const G = require("../src/game-logic.js");

// 未发订单不能因货物还没到仓而被重复补单。
for (const extraOrderDelay of [false, true]) {
  let state = G.createGame({ playerRole: "retailer", botLevel: "off", initialInventory: 0,
    initialPipeline: 0, initialIncomingOrder: 0, demandMode: "stable", demandStart: 8, extraOrderDelay });
  state = G.step(state, 80);
  assert.equal(state.roles.retailer.outstanding, 80);
  assert.equal(G.recommendOrder(state, "retailer", "hard").order, 0);
}

// 库存过剩、零需求时允许完全停单，且不能凭初始需求虚构补货流。
let zero = G.createGame({ playerRole: "none", botLevel: "hard", demandMode: "stable",
  demandStart: 0, initialIncomingOrder: 0, initialInventory: 100, initialPipeline: 0 });
while (!zero.ended) {
  zero = G.step(zero, 0);
  assert.ok(Object.values(zero.lastTurn.orders).every(q => q === 0));
}

// 每个环节的未发订单 = 期初未发 + 本周订货 - 上游本周发货。
for (const orderLeadTime of [1, 2]) for (const extraOrderDelay of [false, true]) {
  let state = G.createGame({ playerRole: "none", demandMode: "random", seed: 71,
    initialInventory: 0, initialPipeline: 0, orderLeadTime, extraOrderDelay });
  while (!state.ended) {
    const before = state;
    state = G.step(state, 0);
    for (const role of G.ROLES) {
      const upstream = G.UPSTREAM[role];
      if (!upstream) continue;
      assert.equal(state.roles[role].outstanding, before.roles[role].outstanding +
        state.lastTurn.orders[role] - state.lastTurn.shipments[upstream]);
      assert.equal(state.roles[role].history.at(-1).demand, G.currentDemand(before, role));
    }
  }
}

// 在 AI 决策前改变未来需求、隐藏节点库存，不得影响当前本地建议。
let local = G.createGame({ playerRole: "retailer", botLevel: "hard" });
local = G.step(local, 4);
const expected = G.recommendOrder(local, "retailer", "hard");
const changed = JSON.parse(JSON.stringify(local));
changed.customerDemand.fill(999, changed.period);
changed.roles.factory.inventory = 99999;
changed.roles.wholesaler.backlog = 99999;
assert.deepEqual(G.recommendOrder(changed, "retailer", "hard"), expected);
for (const role of G.ROLES) {
  const isolated = JSON.parse(JSON.stringify(local));
  isolated.customerDemand.fill(999, isolated.period);
  for (const other of G.ROLES.filter(r => r !== role)) {
    isolated.roles[other].inventory = 99999;
    isolated.roles[other].backlog = 99999;
  }
  assert.deepEqual(G.recommendOrder(isolated, role, "hard"), G.recommendOrder(local, role, "hard"));
}
assert.equal(G.step(local, 9999).lastTurn.orders.retailer, 200);
console.log("AI 回归通过：重复补货、零需求、订单账本、提前期一致、信息隔离及订单上限。");
