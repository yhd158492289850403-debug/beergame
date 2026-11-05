"use strict";
/* 重新标定困难档（需求信号修正 + 在途全额计入之后）：
   目标：（1）单调分档（2）各初始库存下都不出现长期零订单停摆 */
const path = require("path");
const G = require(path.join(__dirname, "..", "src", "game-logic.js"));

const SEEDS = [11, 22, 33, 44, 55];
const MODES = ["stable", "step", "random"];

function avgCost(level, tuning) {
  return MODES.map((mode) => {
    let t = 0;
    for (const seed of SEEDS) {
      t += G.runAuto({ periods: 36, demandMode: mode, botLevel: level, playerRole: "none", seed, botTuning: tuning }).totalCost;
    }
    return t / SEEDS.length;
  });
}

function stallStats(tuning) {
  let maxRun = 0;
  let totalZero = 0;
  for (const inv of [12, 20, 26]) {
    for (const mode of MODES) {
      const st = G.runAuto({
        periods: 36, demandMode: mode, botLevel: "hard", playerRole: "none",
        initialInventory: inv, initialPipeline: 4, seed: 20240517, botTuning: tuning,
      });
      for (const role of G.ROLES) {
        let run = 0;
        for (const row of st.roles[role].history) {
          if (row.order === 0) { run += 1; totalZero += 1; maxRun = Math.max(maxRun, run); }
          else run = 0;
        }
      }
    }
  }
  return { maxRun, totalZero };
}

const easy = avgCost("easy");
const normal = avgCost("normal");
console.log(`easy   = ${easy.map((v) => v.toFixed(0)).join(" / ")}`);
console.log(`normal = ${normal.map((v) => v.toFixed(0)).join(" / ")}   (stable / step / random)\n`);

const VARIANTS = [
  { name: "cov1.8 g0.6", tuning: {} },
  { name: "cov1.4 g0.5", tuning: { hardCoverage: 1.4, safetyGain: 0.5 } },
  { name: "cov1.8 g0.5", tuning: { hardCoverage: 1.8, safetyGain: 0.5 } },
  { name: "cov2.0 g0.5", tuning: { hardCoverage: 2, safetyGain: 0.5 } },
  { name: "cov2.0 g0.6", tuning: { hardCoverage: 2, safetyGain: 0.6 } },
  { name: "cov2.2 g0.6", tuning: { hardCoverage: 2.2, safetyGain: 0.6 } },
  { name: "cov2.0 g0.8", tuning: { hardCoverage: 2, safetyGain: 0.8 } },
  { name: "cov2.5 g0.8", tuning: { hardCoverage: 2.5, safetyGain: 0.8 } },
];

console.log("困难档候选（高库存停摆需为 0）：");
for (const v of VARIANTS) {
  const h = avgCost("hard", v.tuning);
  const s = stallStats(v.tuning);
  const be = h.map((x, i) => (x < easy[i] ? "胜" : "负")).join("");
  const bn = h.map((x, i) => (x < normal[i] ? "胜" : "负")).join("");
  console.log(
    `  ${v.name.padEnd(14)} hard=${h.map((x) => x.toFixed(0).padStart(5)).join("/")}` +
    `  vsEasy[${be}] vsNormal[${bn}]  最长零订单连串=${String(s.maxRun).padStart(3)} 零订单总数=${String(s.totalZero).padStart(4)}`
  );
}
