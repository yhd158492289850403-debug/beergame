/* =========================================================================
 * beergame-solo / tests/shots.js
 * 生成用于人工复核的截图（真实页面 + CDP，可精确定格动画中间态）。
 *
 *   node tests/shots.js
 * 产出：evidence/shot-setup.png, shot-early.png, shot-mid-flight.png,
 *       shot-mid.png, shot-end.png
 * ====================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const cdp = require("./cdp.js");

const ROOT = path.join(__dirname, "..");
const EVIDENCE = path.join(ROOT, "evidence");
const PORT = Number(process.env.BEERGAME_PORT || 8974);

function waitServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/index.html`, (res) => { res.resume(); resolve(true); });
      req.on("error", () => (Date.now() > deadline ? reject(new Error("no server")) : setTimeout(attempt, 150)));
    };
    attempt();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, "serve.js"), String(PORT)], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  let session = null;
  try {
    await waitServer(PORT, 12000);

    // ---------- A. 桌面视口 ----------
    session = await cdp.launch({ port: 9335, width: 1440, height: 1000 });
    await session.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    await session.waitFor('window.BeerGameUI != null', { timeoutMs: 15000, label: "BeerGameUI" });

    // 1) 设置界面
    await session.screenshot(path.join(EVIDENCE, "shot-setup.png"), { fullPage: true });
    console.log("shot-setup.png");

    // 2) 开局早期（默认设置：零售商 / 普通机器人 / 36 周期 / 阶梯需求）
    await session.evaluate(`
      (function () {
        document.querySelectorAll("#botChoices .choice")[1].click(); // 普通
        document.querySelectorAll("#roleChoices .choice")[0].click(); // 零售商
        window.BeerGameUI.start();
        return true;
      })()
    `);
    await session.screenshot(path.join(EVIDENCE, "shot-early.png"), { fullPage: true });
    console.log("shot-early.png");

    // 3) 动画飞行中：发起一回合，延迟一小段后在动画中途定格
    await session.evaluate('document.getElementById("orderInput").value = "6"; window.BeerGameUI.confirm(); true');
    await wait(430);
    const motion = await session.evaluate(`
      JSON.stringify({
        trucks: document.querySelectorAll("#motionLayer .motion-truck").length,
        orders: document.querySelectorAll("#motionLayer .motion-order").length,
        animating: window.BeerGameUI.isAnimating()
      })
    `);
    console.log("飞行中运动元素: " + motion);
    await session.screenshot(path.join(EVIDENCE, "shot-mid-flight.png"), { fullPage: true });
    console.log("shot-mid-flight.png");

    // 等本回合动画结束
    await session.waitFor("window.BeerGameUI.isAnimating() === false", { timeoutMs: 20000, label: "动画结束" });

    // 4) 对局中段（推进到约第 20 周期，带少量动画以生成真实历史）
    await session.evaluate("window.BeerGameUI.playTurns(19)");
    await session.screenshot(path.join(EVIDENCE, "shot-mid.png"), { fullPage: true });
    console.log("shot-mid.png");

    // 4.5) 关闭"显示其他节点库存"后的界面（信息隔离模式）
    await session.evaluate(`
      (function () {
        var t = document.getElementById("inputShowOtherInventory");
        t.checked = false;
        t.dispatchEvent(new Event("change"));
        window.BeerGameUI.start();
        window.BeerGameUI.autoPlay(16);
        return true;
      })()
    `);
    await wait(700);
    await session.screenshot(path.join(EVIDENCE, "shot-masked.png"), { fullPage: true });
    console.log("shot-masked.png（隐藏其他节点库存）");

    // 5) 结算（带动画推完剩余周期；动画需要真实时间，故给足预算）
    await session.evaluate("window.BeerGameUI.playTurns(200)");
    await session.waitFor(
      'document.getElementById("resultScreen").hidden === false && window.BeerGameUI.getState().ended === true',
      { timeoutMs: 300000, label: "对局结束并显示结算界面" }
    );
    // 等结算卡片的错峰入场动画结束，避免截到半透明的中间态
    await wait(1200);
    await session.screenshot(path.join(EVIDENCE, "shot-end.png"), { fullPage: true });
    console.log("shot-end.png");

    const summary = await session.evaluate(
      "JSON.stringify({period: window.BeerGameUI.getState().period, total: Math.round(window.BeerGameUI.getState().totalCost)})"
    );
    console.log("最终状态: " + summary);

    // ---------- B. 移动端视口（响应式检查） ----------
    session.close();
    session = await cdp.launch({ port: 9335, width: 414, height: 900 });
    await session.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    await session.waitFor('window.BeerGameUI != null', { timeoutMs: 15000, label: "BeerGameUI(移动端)" });

    await session.screenshot(path.join(EVIDENCE, "shot-mobile-setup.png"), { fullPage: true });
    console.log("shot-mobile-setup.png");

    await session.evaluate(`
      (function () {
        document.querySelectorAll("#roleChoices .choice")[0].click();
        window.BeerGameUI.start();
        window.BeerGameUI.autoPlay(9);
        return true;
      })()
    `);
    // 等待入场动效结束，避免截到半透明的中间态
    await wait(1400);
    await session.screenshot(path.join(EVIDENCE, "shot-mobile-game.png"), { fullPage: true });
    console.log("shot-mobile-game.png");

    // 窄屏下把全景图横向滚动到中间，确认图内文字在滚动后清晰可读
    await session.evaluate(`
      (function () {
        var box = document.querySelector(".board-scroll");
        box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
        return box.scrollLeft;
      })()
    `);
    await wait(300);
    const boardBox = await session.evaluate(`
      (function () {
        var r = document.querySelector(".board-wrap").getBoundingClientRect();
        return JSON.stringify({ x: 0, y: Math.max(0, r.top + window.scrollY), w: 414, h: Math.ceil(r.height) });
      })()
    `);
    const bb = JSON.parse(boardBox);
    await session.screenshot(path.join(EVIDENCE, "shot-mobile-board.png"), {
      clip: { x: bb.x, y: bb.y, width: bb.w, height: bb.h, scale: 1 },
    });
    console.log("shot-mobile-board.png（全景图滚动后，检查文字可读性）");
  } catch (err) {
    console.error("截图失败: " + (err && err.message));
    process.exitCode = 1;
  } finally {
    if (session) session.close();
    try { server.kill(); } catch (e) { /* ignore */ }
  }
})();
