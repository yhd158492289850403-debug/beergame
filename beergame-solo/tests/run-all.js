"use strict";
/* =========================================================================
 * beergame-solo / tests/run-all.js
 * 一次跑完全部验证。任一项失败则以非零码退出。
 *
 *   node tests/run-all.js
 * ====================================================================== */

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const STEPS = [
  { name: "新手教程交互与对局隔离", file: "check-tutorial.js", needBrowser: true },
  { name: "联机服务器回归", file: "online.test.js", needBrowser: false },
  { name: "联机界面与音乐开关", file: "check-online.js", needBrowser: true },
  { name: "逻辑单元测试", file: "logic.test.js", needBrowser: false },
  { name: "AI 订单账本与信息隔离回归", file: "ai-regression.test.js", needBrowser: false },
  { name: "货物流动不变量（增减/发货/收货）", file: "check-flow.js", needBrowser: false },
  { name: "配置矩阵回归", file: "check-configs.js", needBrowser: false },
  { name: "设计规范审计（简约中性风）", file: "check-design.js", needBrowser: false },
  { name: "浏览器端验证（桌面 + 窄屏）", file: "run-browser-check.js", needBrowser: true },
  { name: "file:// 直开验证", file: "check-file-protocol.js", needBrowser: true },
  { name: "新版建议、导出与三种宽度验证", file: "check-upgrade.js", needBrowser: true },
];

const results = [];

for (const step of STEPS) {
  console.log("\n" + "=".repeat(64));
  console.log("▶ " + step.name + "  (" + step.file + ")");
  console.log("=".repeat(64));

  const res = spawnSync(process.execPath, [path.join(__dirname, step.file)], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });

  const code = res.status === null ? 1 : res.status;
  results.push({ name: step.name, code });

  if (code !== 0 && step.needBrowser) {
    console.log("\n[提示] 该步骤需要本机已安装 Chrome 或 Edge。");
  }
}

console.log("\n" + "=".repeat(64));
console.log("汇总");
console.log("=".repeat(64));
let failed = 0;
for (const r of results) {
  const mark = r.code === 0 ? "PASS" : "FAIL";
  if (r.code !== 0) failed += 1;
  console.log(`  [${mark}] ${r.name}  (exit=${r.code})`);
}
console.log("=".repeat(64));
console.log(failed === 0 ? "全部验证通过。" : `有 ${failed} 项验证失败。`);
process.exit(failed === 0 ? 0 : 1);
