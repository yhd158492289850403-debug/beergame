'use strict';
const os = require('node:os');
const {createServer} = require('./server');
const server = createServer();
server.listen(0, '0.0.0.0', () => {
  const port = server.address().port;
  const addresses = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => `http://${n.address}:${port}`);
  console.log(JSON.stringify({port, addresses}));
});
process.stdin.resume();
process.stdin.on('end', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
