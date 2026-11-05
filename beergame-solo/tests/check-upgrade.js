"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const cdp = require("./cdp.js");
const root = path.resolve(__dirname, "..");

(async () => {
  const session = await cdp.launch({ port: 9342, width: 1440, height: 1000 });
  try {
    await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await session.send("Page.navigate", { url: pathToFileURL(path.join(root, "index.html")).href });
    await session.waitFor('document.body.getAttribute("data-app-ready") === "1"');
    const evaluate = expression => session.evaluate(expression);
    const evidence = path.join(root, "evidence");
    fs.mkdirSync(evidence, { recursive: true });
    await session.screenshot(path.join(evidence, "upgrade-setup.png"), { fullPage: true });
    await evaluate('document.getElementById("btnStart").click()');
    assert.ok(await evaluate('document.getElementById("adviceOrder").textContent.endsWith(" 箱")'));
    await evaluate('document.getElementById("btnUseAdvice").click()');
    assert.ok(await evaluate('Number(document.getElementById("orderInput").value) === BeerGame.recommendOrder(BeerGameUI.getState(), "retailer", "hard").order'));
    await session.screenshot(path.join(evidence, "upgrade-game.png"), { fullPage: true });
    await session.evaluate('BeerGameUI.confirm()', { awaitPromise: true });
    assert.equal(await evaluate('Number(document.getElementById("weekProgress").getAttribute("aria-valuenow"))'), 1);
    await evaluate('BeerGameUI.setAnimationLock(true)');
    assert.ok(await evaluate('document.getElementById("btnUseAdvice").disabled && [...document.querySelectorAll(".quick-btn")].every(b => b.disabled)'));
    await evaluate('BeerGameUI.setAnimationLock(false)');

    // 不触发真实下载，截获 Blob 并校验中文编码、列数与逐周记录数量。
    await evaluate('BeerGameUI.autoPlay(200); window.__exportBlob = null; URL.createObjectURL = function(blob) { window.__exportBlob = blob; return "blob:test"; }; HTMLAnchorElement.prototype.click = function() {}; document.getElementById("btnExport").click()');
    const csv = await session.evaluate('window.__exportBlob.text()', { awaitPromise: true });
    const rows = csv.trim().split(/\r?\n/);
    assert.equal(rows.length, 1 + 36 * 4);
    assert.ok(rows.every(row => row.split(",").length === 11));
    assert.ok(rows[0].includes("周期,角色"));
    await session.screenshot(path.join(evidence, "upgrade-result.png"), { fullPage: true });

    for (const width of [375, 768, 1440]) {
      await session.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const screen of ["setup", "game", "result"]) {
        await evaluate('document.getElementById("btnBackToSetup").click()');
        if (screen !== "setup") {
          await evaluate('document.getElementById("btnStart").click()');
          if (screen === "result") await evaluate('BeerGameUI.autoPlay(200)');
        }
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `${width}px ${screen} 页面溢出`);
        if (width === 375) await session.screenshot(path.join(evidence, `upgrade-mobile-${screen}.png`), { fullPage: true });
      }
    }
    await evaluate('document.getElementById("btnBackToSetup").click(); document.querySelectorAll("#roleChoices .choice")[1].click(); var delay = document.getElementById("inputExtraDelay"); delay.checked = true; delay.dispatchEvent(new Event("change")); document.getElementById("btnStart").click(); BeerGameUI.autoPlay(3)');
    assert.ok(await evaluate('Number(document.getElementById("demandValue").textContent) === BeerGame.currentDemand(BeerGameUI.getState(), "wholesaler")'));
    assert.equal(session.consoleErrors.length, 0, session.consoleErrors.join("\n"));
    console.log("界面回归通过：建议填入、回合锁定、进度、CSV、三种宽度的三屏布局与延迟需求一致。");
  } finally {
    session.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
