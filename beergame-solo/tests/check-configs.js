"use strict";
/* =========================================================================
 * beergame-solo / tests/check-configs.js
 * 对局配置矩阵回归：4 个角色 × 3 档难度 × 3 种周期 × 3 种需求模式，
 * 全部在游戏逻辑层跑完整局，校验不变量（无负库存/无 NaN/周期数正确）。
 *
 *   node tests/check-configs.js
 * ====================================================================== */

"use strict";

const path = require("path");
const G = require(path.join(__dirname, "..", "src", "game-logic.js"));

let cases = 0;
let fails = 0;
const problems = [];

const ROLES = G.ROLES.concat(["none"]);
const LEVELS = G.BOT_LEVELS;
const PERIODS = [18, 36, 54];
const MODES = ["stable", "step", "random"];
const DELAYS = [false, true];

for (const role of ROLES) {
  for (const level of LEVELS) {
    for (const periods of PERIODS) {
      for (const mode of MODES) {
        for (const delay of DELAYS) {
          cases += 1;
          const cfg = {
            periods,
            playerRole: role,
            botLevel: level,
            demandMode: mode,
            extraOrderDelay: delay,
            seed: 4242,
          };
          let st;
          try {
            st = G.runAuto(cfg);
          } catch (e) {
            fails += 1;
            problems.push(`${role}/${level}/${periods}/${mode}/delay=${delay} 抛异常: ${e.message}`);
            continue;
          }

          const label = `${role}/${level}/${periods}/${mode}/delay=${delay}`;
          const expectTurns = periods;
          const historyLen = st.roles[st.config.playerRole === "none" ? "retailer" : st.config.playerRole].history.length;

          if (!st.ended) { fails += 1; problems.push(label + " 未正常结束"); continue; }
          if (historyLen !== expectTurns) { fails += 1; problems.push(`${label} 周期数 ${historyLen} != ${expectTurns}`); }

          for (const r of G.ROLES) {
            for (const row of st.roles[r].history) {
              if (row.inventoryEnd < 0 || row.backlogEnd < 0) {
                fails += 1; problems.push(`${label} ${r} 出现负库存/负缺货`);
                break;
              }
              if (!Number.isFinite(row.cost) || row.cost < 0) {
                fails += 1; problems.push(`${label} ${r} 成本异常 (${row.cost})`);
                break;
              }
            }
          }
          if (!Number.isFinite(st.totalCost) || st.totalCost < 0) {
            fails += 1; problems.push(`${label} 总成本异常 (${st.totalCost})`);
          }
        }
      }
    }
  }
}

console.log(`配置矩阵回归：共 ${cases} 个配置组合`);
if (fails === 0) {
  console.log("全部通过：所有配置都能完整跑完且不违反状态不变量。");
  process.exit(0);
} else {
  console.log(`失败 ${fails} 项：`);
  problems.slice(0, 25).forEach((p) => console.log("  - " + p));
  process.exit(1);
}
