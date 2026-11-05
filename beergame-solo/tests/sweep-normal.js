"use strict";
/* 重新标定普通档（订单信号恢复之后）：
   目标 easy > normal > hard 平均成本单调，且普通档逐局多胜简单档。 */
const path = require("path");
const G = require(path.join(__dirname, "..", "src", "game-logic.js"));

const SEEDS = [7, 11, 13, 19, 22, 29, 33, 41, 44, 55, 57, 71];
const MODES = ["stable", "step", "random"];

function evaluate(tuning) {
  const avg = {};
  let normalWins = 0;
  let total = 0;
  for (const mode of MODES) {
    let e = 0, n = 0, h = 0;
    for (const seed of SEEDS) {
      const base = { periods: 36, demandMode: mode, playerRole: "none", seed };
      const ce = G.runAuto(Object.assign({}, base, { botLevel: "easy" })).totalCost;
      const cn = G.runAuto(Object.assign({}, base, { botLevel: "normal", botTuning: tuning })).totalCost;
      const ch = G.runAuto(Object.assign({}, base, { botLevel: "hard" })).totalCost;
      e += ce; n += cn; h += ch;
      total += 1;
      if (cn < ce) normalWins += 1;
    }
    avg[mode] = { easy: e / SEEDS.length, normal: n / SEEDS.length, hard: h / SEEDS.length };
  }
  const monotone = MODES.every((m) => avg[m].hard < avg[m].normal && avg[m].normal < avg[m].easy);
  return { avg, monotone, normalWins, total };
}

const VARIANTS = [
  { name: "pipe0.4 g0.6 (现状)", tuning: {} },
  { name: "pipe0.3 g0.4", tuning: { normalPipeTrust: 0.3, normalSafetyGain: 0.4 } },
  { name: "pipe0.5 g0.4", tuning: { normalPipeTrust: 0.5, normalSafetyGain: 0.4 } },
  { name: "pipe0.5 g0.5", tuning: { normalPipeTrust: 0.5, normalSafetyGain: 0.5 } },
  { name: "pipe0.6 g0.4", tuning: { normalPipeTrust: 0.6, normalSafetyGain: 0.4 } },
  { name: "pipe0.6 g0.6", tuning: { normalPipeTrust: 0.6, normalSafetyGain: 0.6 } },
  { name: "pipe0.7 g0.4", tuning: { normalPipeTrust: 0.7, normalSafetyGain: 0.4 } },
  { name: "pipe0.7 g0.6", tuning: { normalPipeTrust: 0.7, normalSafetyGain: 0.6 } },
  { name: "pipe0.8 g0.5", tuning: { normalPipeTrust: 0.8, normalSafetyGain: 0.5 } },
  { name: "pipe1.0 g0.5", tuning: { normalPipeTrust: 1.0, normalSafetyGain: 0.5 } },
];

console.log("普通档候选（需要：单调 + 逐局胜简单档比例高）：");
for (const v of VARIANTS) {
  const r = evaluate(v.tuning);
  console.log(
    `  ${v.name.padEnd(20)} easy=${MODES.map((m) => r.avg[m].easy.toFixed(0).padStart(5)).join("/")}` +
    ` normal=${MODES.map((m) => r.avg[m].normal.toFixed(0).padStart(5)).join("/")}` +
    ` hard=${MODES.map((m) => r.avg[m].hard.toFixed(0).padStart(5)).join("/")}` +
    ` 单调=${r.monotone ? "✓" : "✗"} 胜简单=${r.normalWins}/${r.total}`
  );
}
