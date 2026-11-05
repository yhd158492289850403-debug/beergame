'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const G = require('./src/game-logic');
function createServer() {
  const rooms = new Map();
  function advance(room) {
    if (room.state && !room.state.ended && room.players.length && room.players.every(p => Object.hasOwn(room.orders, p.role))) {
      room.state = G.step(room.state, room.orders); room.orders = {};
    }
  }
  const cleanup = setInterval(() => {
    for (const [code, room] of rooms) {
      room.players = room.players.filter(p => Date.now() - p.seen < 90000);
      if (!room.players.length) rooms.delete(code); else advance(room);
    }
  }, 5000);
  cleanup.unref();
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'POST') return reply(405, {error:'请使用 POST'});
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403,{error:'来源不匹配'});
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 16384) return reply(413,{error:'请求过大'}); }
        const data = JSON.parse(body || '{}');
        const action = url.pathname.slice(5);
        let room = rooms.get(String(data.code || '').toUpperCase());
        let player;
        if (action === 'create') {
          if (rooms.size >= 200) return reply(503,{error:'房间已满，请稍后重试'});
          let code; do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          room = {code, config:G.normalizeConfig(data.config), players:[], orders:{}, state:null}; rooms.set(code, room);
        }
        if (!room) return reply(404,{error:'房间不存在或已过期'});
        if (action === 'create' || action === 'join') {
          if (room.state) return reply(409,{error:'对局已经开始'});
          if (!G.ROLES.includes(data.role) || room.players.some(p => p.role === data.role)) return reply(409,{error:'这个角色已有人，请换一个角色'});
          player = {token:crypto.randomBytes(24).toString('hex'), role:data.role, seen:Date.now()}; room.players.push(player);
        } else {
          player = room.players.find(p => p.token === data.token);
          if (!player) return reply(401,{error:'席位已离开或过期，请重新加入'});
          player.seen = Date.now();
          if (action === 'leave') { room.players = room.players.filter(p => p !== player); advance(room); return reply(200,{ok:true}); }
          if (action === 'start') {
            if (room.players[0] !== player || room.state) return reply(409,{error:'仅房主可开始新局'});
            room.state = G.createGame(room.config);
          } else if (action === 'order') {
            if (!room.state || room.state.ended || data.period !== room.state.period) return reply(409,{error:'周期已变化，请等待同步'});
            if (!Number.isInteger(data.order) || data.order < 0 || data.order > 200) return reply(400,{error:'订单须为 0–200 的整数'});
            if (!Object.hasOwn(room.orders, player.role)) room.orders[player.role] = data.order;
            advance(room);
          } else if (action !== 'poll') return reply(404,{error:'未知操作'});
        }
        const state = room.state ? JSON.parse(JSON.stringify(room.state)) : null;
        if (state) { state.config.playerRole = player.role; /* 与离线模式相同，隐藏库存为界面开关。 */ }
        return reply(200,{code:room.code, token:player.token, role:player.role, host:room.players[0] === player, players:room.players.map(p => ({role:p.role, submitted:Object.hasOwn(room.orders,p.role)})), state});
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^(index\.html|styles\.css|favicon\.svg|src\/[a-z-]+\.js)$/.test(file)) { res.writeHead(404); return res.end(); }
      const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
      const content = await fs.promises.readFile(path.join(__dirname,file));
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-cache'}); res.end(content);
    } catch (error) { reply(400,{error:'请求无法处理，请重试'}); }
  });
  server.on('close', () => clearInterval(cleanup));
  return server;
}
module.exports = {createServer};
if (require.main === module) createServer().listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('啤酒游戏已启动：http://localhost:' + (process.env.PORT || 3000) + '，同一局域网的朋友请使用本机局域网 IP。'));
