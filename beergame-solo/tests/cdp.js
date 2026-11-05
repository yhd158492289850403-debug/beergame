/* =========================================================================
 * beergame-solo / tests/cdp.js
 * 极简 Chrome DevTools Protocol 驱动（无第三方依赖，Node 22+ 内置 WebSocket）。
 *
 * 提供：启动无头 Chrome、求值、等待条件、截图、关闭。
 * 用于替代不可靠的 --dump-dom / --virtual-time-budget 组合。
 * ====================================================================== */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("未找到 Chrome/Edge 可执行文件");
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("timeout")));
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message + " " + JSON.stringify(msg.error.data || "")));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params && msg.params.exceptionDetails;
        this.consoleErrors.push(d && d.exception ? String(d.exception.description || d.exception.value) : "exception");
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.consoleErrors.push((msg.params.args || []).map((a) => String(a.value)).join(" "));
      }
    });
  }

  send(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params || {} });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("CDP timeout: " + method));
        }
      }, 60000);
    });
  }

  /** 求值表达式；expression 可为立即执行的函数字符串或返回值字面量 */
  async evaluate(expression, { awaitPromise = false, returnByValue = true } = {}) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error("页面求值异常: " + (d.exception ? d.exception.description || d.exception.value : d.text));
    }
    return res.result ? res.result.value : undefined;
  }

  async waitFor(expression, { timeoutMs = 30000, intervalMs = 100, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const v = await this.evaluate("!!(" + expression + ")");
        if (v) return true;
      } catch (e) { lastErr = e; }
      await wait(intervalMs);
    }
    throw new Error("等待超时: " + label + (lastErr ? " (last error: " + lastErr.message + ")" : ""));
  }

  async screenshot(filePath, { fullPage = false } = {}) {
    let clip;
    if (fullPage) {
      const metrics = await this.send("Page.getLayoutMetrics");
      const size = metrics.cssContentSize || metrics.contentSize;
      clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
    }
    const shot = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: !!fullPage,
      ...(clip ? { clip } : {}),
    });
    fs.writeFileSync(filePath, Buffer.from(shot.data, "base64"));
    return filePath;
  }

  close(code) {
    try { this.ws.close(); } catch (e) { /* ignore */ }
    if (this.proc) {
      try { this.proc.kill(); } catch (e) { /* ignore */ }
    }
    return code;
  }
}

async function launch({ port = 9333, width = 1440, height = 1100 } = {}) {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "beergame-cdp-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--allow-running-insecure-content",
    `--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ];
  const proc = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderrBuf = "";
  proc.stderr.on("data", (d) => { stderrBuf += d.toString(); });

  // 等待调试端口就绪
  const deadline = Date.now() + 20000;
  let targets = null;
  while (Date.now() < deadline) {
    try {
      targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
      if (targets && targets.some((t) => t.type === "page")) break;
    } catch (e) { /* 继续等待 */ }
    await wait(150);
  }
  if (!targets) {
    try { proc.kill(); } catch (e) { /* ignore */ }
    throw new Error("Chrome 调试端口未就绪。stderr: " + stderrBuf.slice(0, 500));
  }

  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", (e) => reject(new Error("WebSocket 连接失败: " + (e.message || "unknown"))));
  });

  const session = new CdpSession(ws);
  session.proc = proc;
  session.profile = profile;

  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  return session;
}

module.exports = { launch, findChrome };
