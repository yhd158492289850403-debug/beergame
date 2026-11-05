/* =========================================================================
 * beergame-solo / tests/run-browser-check.js
 * 通过 CDP 在真实页面 /index.html 上执行浏览器验证 harness，并输出结果。
 *
 *   node tests/run-browser-check.js
 *
 * 依赖：Node 22+（内置 WebSocket）、本地已安装 Chrome/Edge。
 * ====================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const cdp = require("./cdp.js");

const ROOT = path.join(__dirname, "..");
const EVIDENCE = path.join(ROOT, "evidence");
const PORT = Number(process.env.BEERGAME_PORT || 8973);

function startServer() {
  const proc = spawn(process.execPath, [path.join(__dirname, "serve.js"), String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return proc;
}

function waitServer(port, timeoutMs) {
  const http = require("http");
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/index.html`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("静态服务器未就绪"));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

(async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const server = startServer();
  let session = null;

  try {
    await waitServer(PORT, 12000);
    console.log(`静态服务器就绪: http://127.0.0.1:${PORT}/`);

    session = await cdp.launch({ port: 9334, width: 1440, height: 1100 });
    console.log("Chrome 已启动（CDP）");

    await session.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    await session.waitFor('document.body && document.body.getAttribute("data-app-ready") === "1"', {
      timeoutMs: 20000,
      label: "应用启动完成 data-app-ready=1",
    });
    console.log("应用已启动，开始注入验证 harness");

    const harness = fs.readFileSync(path.join(__dirname, "app-check.harness.js"), "utf8");

    // ---------- 阶段 1：桌面视口完整验证 ----------
    // 注入 harness（不依赖表达式的完成值），并等待全局结果变量
    await session.evaluate(harness, { awaitPromise: false });
    await session.waitFor("window.__CHECK_RESULT__ != null", {
      timeoutMs: 180000,
      intervalMs: 200,
      label: "harness 完成并写入 __CHECK_RESULT__",
    });

    const result = await session.evaluate("window.__CHECK_RESULT__");
    console.log("harness 完成，返回值类型: " + typeof result + (result && result.lines ? " (有 lines)" : " (无 lines)"));

    const lines = (result && result.lines) || [];
    const fails = result && typeof result.fails === "number" ? result.fails : 1;

    if (!lines.length) {
      // 绝不在没有断言结果时报告"通过"
      lines.push("FAIL | harness 未返回任何断言结果（返回值: " + JSON.stringify(result) + "）");
    }

    const body = lines.join("\n") + "\n---\nFAILURES=" + fails;

    fs.writeFileSync(path.join(EVIDENCE, "browser-check.txt"), body, "utf8");
    console.log("=============== BROWSER CHECK RESULT ===============");
    console.log(body);
    console.log("===================================================");

    // 截取结算界面（带动画跑到结束后的状态）
    await session.screenshot(path.join(EVIDENCE, "shot-end.png"), { fullPage: true });
    console.log("已保存截图: evidence/shot-end.png");

    // ---------- 阶段 2：窄屏视口（检查响应式与全景图可读性） ----------
    session.close();
    session = await cdp.launch({ port: 9334, width: 414, height: 900 });
    await session.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    await session.waitFor('document.body && document.body.getAttribute("data-app-ready") === "1"', {
      timeoutMs: 20000,
      label: "窄屏应用启动",
    });
    await session.evaluate(`
      (function () {
        document.querySelectorAll("#roleChoices .choice")[0].click();
        window.BeerGameUI.start();
        window.BeerGameUI.autoPlay(9);
        return true;
      })()
    `);

    const mobile = await session.evaluate(`
      (function () {
        var out = [];
        var overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
        out.push((overflow ? "FAIL" : "PASS") + " | 窄屏无整页横向溢出 | docWidth=" +
          document.documentElement.scrollWidth + " viewport=" + window.innerWidth);

        var svg = document.getElementById("supplySvg");
        var t = svg.querySelector(".node-stat");
        var declared = parseFloat(getComputedStyle(t).fontSize);
        var scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        var effective = declared * scale;
        out.push((effective >= 8 ? "PASS" : "FAIL") + " | 窄屏全景图文字可读 | effective=" +
          effective.toFixed(1) + "px scale=" + scale.toFixed(2));

        var box = document.querySelector(".board-scroll");
        var canScroll = box.scrollWidth > box.clientWidth + 1;
        out.push((canScroll ? "PASS" : "FAIL") + " | 窄屏全景图可横向滚动 | " +
          box.clientWidth + " -> " + box.scrollWidth);

        // 主要区块都应可见
        ["#gameScreen", ".board-wrap", ".control-card", ".info-card"].forEach(function (sel) {
          var el = document.querySelector(sel);
          var r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
          out.push((r.width > 0 && r.height > 0 ? "PASS" : "FAIL") + " | 窄屏区块可见 " + sel +
            " | w=" + Math.round(r.width) + " h=" + Math.round(r.height));
        });
        return out.join("\\n");
      })()
    `);
    console.log("=============== 窄屏（414px）检查 ===============");
    console.log(mobile);
    const mobileFails = (mobile.match(/^FAIL/gm) || []).length;
    console.log("窄屏 FAILURES=" + mobileFails);
    fs.writeFileSync(path.join(EVIDENCE, "browser-check-mobile.txt"), mobile + "\n---\nFAILURES=" + mobileFails, "utf8");

    const totalFails = fails + mobileFails;

    if (session.consoleErrors.length) {
      console.log("页面控制台错误:");
      session.consoleErrors.forEach((e) => console.log("  - " + e));
    } else {
      console.log("页面控制台无错误");
    }

    console.log("=============== 合计 ===============");
    console.log(`桌面断言失败=${fails}  窄屏断言失败=${mobileFails}  总计=${totalFails}`);

    process.exitCode = totalFails > 0 || session.consoleErrors.length > 0 ? 1 : 0;
  } catch (err) {
    console.error("浏览器验证失败: " + (err && err.message));
    process.exitCode = 2;
  } finally {
    if (session) session.close();
    try { server.kill(); } catch (e) { /* ignore */ }
  }
})();
