'use strict';
const assert = require('node:assert/strict');
const {createServer} = require('../server');
(async () => {
 const server = createServer(); await new Promise(r => server.listen(0,'127.0.0.1',r));
 const base = 'http://127.0.0.1:' + server.address().port;
 async function api(action,data,expected=200) { const r = await fetch(base+'/api/'+action,{method:'POST',body:JSON.stringify(data)}); assert.equal(r.status,expected); return r.json(); }
 try {
  const a = await api('create',{role:'retailer',config:{periods:18}});
  const b = await api('join',{code:a.code,role:'factory'});
  await api('join',{code:a.code,role:'factory'},409); await api('start',b,409);
  let s = await api('start',a); assert.equal(s.state.period,1);
  s = await api('order',{...a,period:1,order:13}); assert.equal(s.state.period,1);
  await api('order',{...a,period:1,order:99});
  s = await api('order',{...b,period:1,order:7}); assert.equal(s.state.period,2); assert.equal(s.state.lastTurn.orders.retailer,13); assert.equal(s.state.lastTurn.orders.factory,7);
  await api('order',{...b,period:1,order:7},409); await api('order',{...b,period:2,order:-1},400);
  s = await api('poll',a); assert.equal(s.state.config.playerRole,'retailer');
  await api('poll',{code:a.code,token:'bad'},401);
  await api('order',{...a,period:2,order:4}); await api('leave',b);
  s = await api('poll',a); assert.equal(s.state.period,3);
  while (!s.state.ended) s = await api('order',{...a,period:s.state.period,order:4});
  assert.equal(s.state.roles.retailer.history.length,18); assert.equal((await fetch(base+'/server.js')).status,404);
  console.log('联机验证通过：角色互斥、房主权限、同步结算、重复/过期订单、身份验证、离开后 AI 接手及完整对局。');
 } finally { await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode=1; });

