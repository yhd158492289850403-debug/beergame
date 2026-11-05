/* =========================================================================
 * beergame-solo / tests/run-console.js
 * 阶段一产出：无界面、纯控制台的游戏逻辑演示。
 *
 *   node tests/run-console.js
 *   node tests/run-console.js --periods=18 --bot=hard --role=wholesaler --demand=random
 * ====================================================================== */

"use strict";

const path = require("path");
const G = require(path.join(__dirname, "..", "src", "game-logic.js"));

/* ------------------------------ 参数解析 ------------------------------ */
const args = {};
for (const raw of process.argv.slice(2)) {
  const m = /^--([a-zA-Z]+)(?:=(.*))?$/.exec(raw);
  if (m) args[m[1]] = m[2] === undefined ? "true" : m[2];
}

const options = {
  periods: args.periods ? Number(args.periods) : 36,
  botLevel: args.bot || "normal",
  playerRole: args.role || "retailer",
  demandMode: args.demand || "step",
  seed: args.seed ? Number(args.seed) : 20240517,
};

const HEADER = "周期  需求  零订  批订  分订  厂订 |   零库存  批库存  分库存  厂库存 | 本周成本  累计成本";
const RULE = "-".repeat(HEADER.length);

console.log("=".repeat(HEADER.length));
console.log("单人啤酒游戏 —— 逻辑核心控制台演示");
console.log(
  `参数：周期=${options.periods}  机器人=${G.BOT_LABELS[options.botLevel]}  玩家角色=${
    G.ROLE_LABELS[options.playerRole]
  }  需求模式=${G.DEMAND_MODE_LABELS[options.demandMode]}  种子=${options.seed}`
);
console.log("=".repeat(HEADER.length));
console.log("玩家策略：每周期下单 4（固定）——仅用于演示控制器接入方式");
console.log(RULE);
console.log(HEADER);
console.log(RULE);

let state = G.createGame(options);
const PLAYER_ORDER = 4;

// 初始状态
{
  const r = state.roles;
  console.log(
    `${String(0).padStart(4)}  ${String(state.customerDemand[0]).padStart(4)}  ${G.ROLES.map(() =>
      "   -"
    ).join("")} | ${G.ROLES.map((x) => String(r[x].inventory).padStart(7)).join(" ")} | ${" ".repeat(
      9
    )}${String(0).padStart(10)}`
  );
}

while (!state.ended) {
  state = G.step(state, PLAYER_ORDER);
  const t = state.lastTurn;
  const p = t.period;
  const orders = G.ROLES.map((r) => String(t.orders[r]).padStart(4)).join("  ");
  const invs = G.ROLES.map((r) => String(state.roles[r].inventory).padStart(7)).join(" ");
  console.log(
    `${String(p).padStart(4)}  ${String(t.customerDemand).padStart(4)}  ${orders} | ${invs} | ${String(
      t.supplyChainCost
    ).padStart(9)}${String(state.totalCost).padStart(10)}`
  );
}

console.log(RULE);
console.log(G.describeState(state));

const report = G.buildReport(state);
console.log("\n各角色成本明细：");
for (const row of report.byRole) {
  console.log(
    `  ${row.label}${row.isPlayer ? "(玩家)" : "     "}  总成本=${String(row.totalCost).padStart(8)}  期末库存=${String(
      row.inventoryEnd
    ).padStart(4)}  期末缺货=${String(row.backlogEnd).padStart(4)}`
  );
}
console.log(
  `\n牛鞭效应 = var(工厂订单)/var(零售商订单) = ${
    report.bullwhip === null ? "N/A" : report.bullwhip.toFixed(2)
  }`
);
console.log(`供应链累计总成本 = ${report.supplyChainCost}`);
