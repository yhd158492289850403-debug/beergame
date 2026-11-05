'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const cdp = require('./cdp');
(async () => {
  const browser = await cdp.launch({port:9351,width:1440,height:1000});
  const root = path.resolve(__dirname,'..');
  try {
    await browser.send('Page.navigate',{url:pathToFileURL(path.join(root,'index.html')).href});
    await browser.waitFor('document.body.dataset.appReady === "1"');
    const evaluate = code => browser.evaluate(code);
    await evaluate('document.getElementById("btnStart").click(); document.getElementById("orderInput").value = 17; window.beforeTutorial = JSON.stringify(BeerGameUI.getState()); document.getElementById("tutorialOpen").click()');
    assert.ok(await evaluate('document.getElementById("tutorialDialog").open'));
    assert.equal(await evaluate('document.activeElement.id'),'tutorialTitle');
    await browser.screenshot(path.join(root,'evidence/tutorial-desktop.png'),{fullPage:true});
    await evaluate('for (let i=0;i<3;i++) document.getElementById("tutorialNext").click()');
    assert.ok(await evaluate('document.getElementById("tutorialNext").disabled'));
    for (const value of ['', '-1', '201', '2.5']) {
      await evaluate('document.getElementById("tutorialOrder").value = ' + JSON.stringify(value) + '; document.getElementById("tutorialSubmit").click()');
      assert.ok(await evaluate('document.getElementById("tutorialNext").disabled'));
    }
    await evaluate('document.getElementById("tutorialOrder").value = 9; document.getElementById("tutorialSubmit").click(); document.getElementById("tutorialNext").click()');
    assert.ok(await evaluate('document.getElementById("tutorialContent").textContent.includes("9 箱")'));
    assert.equal(await evaluate('JSON.stringify(BeerGameUI.getState())'),await evaluate('window.beforeTutorial'));
    assert.equal(await evaluate('document.getElementById("orderInput").value'),'17');
    await evaluate('document.getElementById("tutorialPrevious").click()');
    assert.equal(await evaluate('document.getElementById("tutorialOrder").value'),'9');
    await evaluate('document.getElementById("tutorialOrder").value = 0; document.getElementById("tutorialSubmit").click(); document.getElementById("tutorialNext").click()');
    assert.ok(await evaluate('document.getElementById("tutorialContent").textContent.includes("0 箱")'));
    await evaluate('document.getElementById("tutorialNext").click()');
    await browser.waitFor('!document.getElementById("tutorialDialog").open && document.activeElement.id === "tutorialOpen"');
    await evaluate('document.getElementById("tutorialOpen").click()');
    assert.ok(await evaluate('document.getElementById("tutorialProgress").textContent.includes("1 / 5")'));
    await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await browser.waitFor('!document.getElementById("tutorialDialog").open');
    await browser.send('Emulation.setDeviceMetricsOverride',{width:375,height:740,deviceScaleFactor:1,mobile:true});
    await evaluate('document.getElementById("tutorialOpen").click()');
    for (let i=0;i<4;i++) {
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1 && document.getElementById("tutorialDialog").scrollWidth <= document.getElementById("tutorialDialog").clientWidth + 1'));
      if (i<3) await evaluate('document.getElementById("tutorialNext").click()');
    }
    await browser.screenshot(path.join(root,'evidence/tutorial-mobile.png'),{fullPage:true});
    assert.equal(browser.consoleErrors.length,0,browser.consoleErrors.join('\n'));
    console.log('教程验证通过：五步练习、输入校验、真实结算、重试、退出及焦点、重看、对局隔离、375px 布局。');
  } finally { browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
