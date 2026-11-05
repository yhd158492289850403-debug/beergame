(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let session = null, busy = false, timer, revision = '';
  const status = text => { $('onlineStatus').textContent = text; };
  try { session = JSON.parse(sessionStorage.getItem('beer-room')); } catch (_) {}
  function save() { try { sessionStorage.setItem('beer-room', JSON.stringify(session)); } catch (_) {} }
  async function request(action, extra) {
    const response = await fetch('/api/' + action, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.assign({},session,extra)), signal:AbortSignal.timeout(8000)});
    const data = await response.json();
    if (!response.ok) { if (session && (response.status === 401 || response.status === 404)) { session = null; save(); location.reload(); } throw new Error(data.error); }
    return data;
  }
  function display(data) {
    session = {code:data.code, token:data.token}; save();
    $('roomActions').hidden = true; $('roomLeave').hidden = false;
    $('roomStart').hidden = !data.host || !!data.state;
    $('btnStart').disabled = true;
    status('房间 ' + data.code + ' · ' + data.players.map(p => BeerGame.ROLE_LABELS[p.role] + (p.submitted ? '：已提交' : '：已加入')).join(' / ') + (data.state ? '' : ' · 空位由 AI 补齐，房主点击开始。'));
    if (data.state) {
      const nextRevision = data.code + ':' + data.state.period;
      BeerGameUI.receiveOnline(data.state);
      if (revision !== nextRevision) { revision = nextRevision; $('orderInput').value = BeerGame.currentDemand(data.state, data.role); }
      const mine = data.players.find(p => p.role === data.role);
      $('btnConfirm').disabled = mine.submitted || data.state.ended;
      $('btnConfirm').textContent = mine.submitted ? '已提交 · 等待其他玩家' : '确认订单';
      $('controlHint').textContent = '所有玩家提交后自动结算；离开或断线 90 秒后由 AI 接手。';
    }
  }
  async function run(action, extra) {
    if (busy) return;
    if ((action === 'create' || action === 'join') && BeerGameUI.getState()) { status('请先返回设置，再创建或加入房间。'); return; }
    busy = true;
    try { display(await request(action, extra)); }
    catch (error) { status(error.message || '连接中断，正在重试'); }
    finally { busy = false; }
  }
  function reset() {
    session = null; save(); revision = ''; $('roomActions').hidden = false; $('roomLeave').hidden = true; $('roomStart').hidden = true; $('btnStart').disabled = false; $('btnConfirm').textContent = '确认订单';
  }
  async function leave() {
    if (!session) return;
    try { await request('leave'); } catch (_) {}
    reset(); location.reload();
  }
  window.BeerOnline = {active:() => !!session, submit:() => {
    if ($('btnConfirm').disabled) return Promise.resolve();
    const order = Number($('orderInput').value);
    if (!Number.isInteger(order) || order < 0 || order > 200) { status('请输入 0–200 的整数'); return Promise.resolve(); }
    return run('order',{order, period:BeerGameUI.getState().period});
  }};
  $('roomCreate').onclick = () => run('create',{config:BeerGameUI.getDraft(),role:BeerGameUI.getDraft().playerRole});
  $('roomJoin').onclick = () => run('join',{code:$('roomCode').value.trim().toUpperCase(),role:BeerGameUI.getDraft().playerRole});
  $('roomStart').onclick = () => run('start'); $('roomLeave').onclick = leave;
  ['btnGameSetup','btnAgain','btnBackToSetup'].forEach(id => $(id).addEventListener('click', event => {
    if (session) { event.stopImmediatePropagation(); leave(); }
  },true));
  if (location.protocol === 'file:') {
    $('roomCreate').disabled = $('roomJoin').disabled = true;
    status('联机：在项目目录运行 node server.js，再打开 http://localhost:3000。单人游戏可直接开始。');
    reset();
  } else {
    const invited = new URLSearchParams(location.search).get('room'); if (invited) $('roomCode').value = invited;
    if (session) run('poll');
    timer = setInterval(() => { if (session) run('poll'); }, 1000);
  }
})();
