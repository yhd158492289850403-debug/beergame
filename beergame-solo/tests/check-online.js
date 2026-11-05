'use strict';
const assert = require('node:assert/strict');
const {createServer} = require('../server');
const cdp = require('./cdp');
(async () => {
 const server = createServer(); await new Promise(r => server.listen(0,'127.0.0.1',r));
 let browser;
 try {
  browser = await cdp.launch({port:9348,width:1440,height:1000});
  const base='http://127.0.0.1:'+server.address().port;
  await browser.send('Page.navigate',{url:base}); await browser.waitFor('document.body.dataset.appReady === "1"');
  await browser.evaluate('document.getElementById("roomCreate").click()'); await browser.waitFor('!document.getElementById("roomStart").hidden');
  const code=await browser.evaluate('JSON.parse(sessionStorage.getItem("beer-room")).code');
  async function api(action,data) { const r=await fetch(base+'/api/'+action,{method:'POST',body:JSON.stringify(data)}); assert.equal(r.status,200); return r.json(); }
  const friend=await api('join',{code,role:'factory'});
  await browser.evaluate('document.getElementById("roomStart").click()'); await browser.waitFor('BeerGameUI.getState() && BeerGameUI.getState().period === 1');
  await browser.evaluate('document.getElementById("orderInput").value=12; document.getElementById("btnConfirm").click()'); await browser.waitFor('document.getElementById("btnConfirm").disabled');
  await api('order',{...friend,period:1,order:6}); await browser.waitFor('BeerGameUI.getState().period === 2');
  await browser.send('Page.reload'); await browser.waitFor('window.BeerGameUI && BeerGameUI.getState() && BeerGameUI.getState().period === 2');
  await browser.evaluate('document.getElementById("musicToggle").click()'); await browser.waitFor('document.getElementById("musicToggle").getAttribute("aria-pressed") === "true"');
  await browser.evaluate('document.getElementById("musicToggle").click()'); await browser.waitFor('document.getElementById("musicToggle").getAttribute("aria-pressed") === "false"');
  await browser.screenshot(require('node:path').resolve('evidence/online-desktop.png'),{fullPage:true});
  await browser.send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  assert.ok(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  await browser.screenshot(require('node:path').resolve('evidence/online-mobile.png'),{fullPage:true});
  assert.equal(browser.consoleErrors.length,0,browser.consoleErrors.join('\n'));
  console.log('联机浏览器通过：创建、开始、等待、同步、刷新恢复、音乐开关、窄屏布局。');
 } finally { if(browser) browser.close(); await new Promise(r => server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
