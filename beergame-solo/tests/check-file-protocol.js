"use strict";
/* =========================================================================
 * beergame-solo / tests/check-file-protocol.js
 * 验证"直接用浏览器打开本地 index.html（file://）"也能正常玩：
 * 这一点决定了交付物是否真的零服务器依赖。
 *
 *   node tests/check-file-protocol.js
 * ====================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const cdp = require("./cdp.js");

const ROOT = path.join(__dirname, "..");
const EVIDENCE = path.join(ROOT, "evidence");

function toFileUrl(p) {
  return "file:///" + p.replace(/\\/g, "/").replace(/ /g, "%20");
}

(async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const session = await cdp.launch({ port: 9348, width: 1440, height: 1000 });
  const lines = [];
  let fails = 0;
  const ok = (name, cond, detail) => {
    lines.push((cond ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
    if (!cond) fails += 1;
  };

  try {
    const url = toFileUrl(path.join(ROOT, "index.html"));
    console.log("打开: " + url);
    await session.send("Page.navigate", { url });
    await session.waitFor('document.body && document.body.getAttribute("data-app-ready") === "1"', {
      timeoutMs: 20000,
      label: "file:// 下应用启动",
    });

    const env = await session.evaluate(`
      JSON.stringify({
        protocol: location.protocol,
        hasLogic: !!window.BeerGame,
        hasUI: !!window.BeerGameUI,
        roleChoices: document.querySelectorAll("#roleChoices .choice").length
      })
    `);
    const e = JSON.parse(env);
    ok("协议为 file:", e.protocol === "file:", e.protocol);
    ok("game-logic.js 在 file:// 下加载成功", e.hasLogic);
    ok("game.js 在 file:// 下加载成功", e.hasUI);
    ok("设置界面渲染完成（4 个角色选项）", e.roleChoices === 4, "count=" + e.roleChoices);

    // 样式表是否真的生效：检查关键设计令牌已应用
    const tokenOk = await session.evaluate(`
      (function () {
        var cs = getComputedStyle(document.documentElement);
        return JSON.stringify({
          canvas: cs.getPropertyValue("--canvas").trim(),
          accent: cs.getPropertyValue("--accent").trim(),
          bodyBg: getComputedStyle(document.body).backgroundColor
        });
      })()
    `);
    const t = JSON.parse(tokenOk);
    ok("styles.css 在 file:// 下生效（设计变量可解析）",
      !!t.canvas && !!t.accent, `canvas=${t.canvas} accent=${t.accent}`);

    // 完整玩一局（不带动画），确认逻辑在 file:// 下也跑得通
    await session.evaluate("window.BeerGameUI.start(); true");
    await session.evaluate("window.BeerGameUI.autoPlay(500)", { awaitPromise: true });
    const done = await session.evaluate(`
      JSON.stringify({
        ended: window.BeerGameUI.getState().ended,
        period: window.BeerGameUI.getState().period,
        total: Math.round(window.BeerGameUI.getState().totalCost),
        resultVisible: document.getElementById("resultScreen").hidden === false
      })
    `);
    const d = JSON.parse(done);
    ok("file:// 下可完整玩完一局", d.ended === true, "period=" + d.period);
    ok("file:// 下结算界面正常显示", d.resultVisible === true);

    // 网络请求检查：file:// 下不应有任何 http(s) 请求
    const perf = await session.evaluate(`
      JSON.stringify((performance.getEntriesByType("resource") || []).map(function (r) {
        return r.name;
      }).filter(function (n) { return /^https?:/.test(n); }))
    `);
    const remote = JSON.parse(perf);
    ok("无任何远程 http(s) 资源请求（完全离线）", remote.length === 0,
      remote.length ? remote.slice(0, 3).join(" ; ") : "0 个远程请求");

    ok("运行期间无未捕获异常", session.consoleErrors.length === 0, session.consoleErrors.join(" ; "));

    await session.screenshot(path.join(EVIDENCE, "shot-file-protocol.png"), { fullPage: true });

    const body = lines.join("\n") + "\n---\nFAILURES=" + fails;
    fs.writeFileSync(path.join(EVIDENCE, "file-protocol-check.txt"), body, "utf8");
    console.log("=============== file:// 检查结果 ===============");
    console.log(body);
    console.log("==============================================");
    process.exitCode = fails > 0 ? 1 : 0;
  } catch (err) {
    console.error("file:// 检查失败: " + (err && err.message));
    process.exitCode = 2;
  } finally {
    session.close();
  }
})();
