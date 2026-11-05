/* =========================================================================
 * beergame-solo / tests/serve.js
 * 仅用于本地验证的极简静态服务器（交付的游戏本身不需要它）。
 *   node tests/serve.js [port]
 * ====================================================================== */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2] || 8971);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // 测试结果回传端点（无头浏览器把断言结果 POST 回来，避免依赖 --virtual-time-budget）
  if (req.method === "POST" && (req.url || "").split("?")[0] === "/__result") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const outName = (req.url.split("name=")[1] || "result.txt").replace(/[^a-zA-Z0-9_.-]/g, "");
      fs.writeFileSync(path.join(ROOT, "evidence", outName), body, "utf8");
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    });
    return;
  }

  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const full = path.join(ROOT, urlPath);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found: " + urlPath);
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`static server: http://127.0.0.1:${PORT}/  (root=${ROOT})`);
});
