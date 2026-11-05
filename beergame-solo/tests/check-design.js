"use strict";
/* =========================================================================
 * beergame-solo / tests/check-design.js
 * 设计规范审计：把"简约中性风格"固化为可复核的自动断言。
 *
 *   node tests/check-design.js
 *
 * 依据 minimalist-ui 协议：
 *   · 禁止渐变 / 玻璃模糊 / 重阴影
 *   · 禁止 pill 形状的大容器与主按钮
 *   · 禁止 emoji
 *   · 文字不得为纯黑；强调色保持低饱和
 *   · 数字使用等宽数字（tabular-nums）
 * ====================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "src", "game.js"), "utf8");

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass += 1; console.log("  ✓ " + name); }
  else { fails.push(name + (detail ? " -> " + detail : "")); console.log("  ✗ " + name + (detail ? "  ->  " + detail : "")); }
};

// 去掉注释后审计，避免把说明文字当代码
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

console.log("== 表面与装饰 ==");
ok("样式表不含渐变（linear/radial-gradient）", !/gradient\(/i.test(cssCode));
ok("样式表不含玻璃模糊（backdrop-filter）", !/backdrop-filter/i.test(cssCode));
ok("样式表不含 filter: blur", !/filter:\s*blur/i.test(cssCode));

const shadowDecls = (cssCode.match(/box-shadow\s*:\s*([^;]+);/gi) || [])
  .map((s) => s.replace(/box-shadow\s*:/i, "").replace(";", "").trim())
  .filter((v) => v !== "none");
ok("不存在实质 box-shadow（简约风要求近乎无阴影）", shadowDecls.length === 0,
  shadowDecls.slice(0, 3).join(" | "));

ok("HTML 中的 SVG 不再引用渐变/滤镜 id",
  !/url\(#(areaGrad|nodeGrad|nodeGradMe|custGrad|laneGrad|softGlow)\)/.test(html));
ok("game.js 中不再引用渐变/滤镜 id",
  !/url\(#(areaGrad|nodeGrad|nodeGradMe|custGrad|laneGrad|softGlow)\)/.test(js));

console.log("\n== 形状与圆角 ==");
const radii = (cssCode.match(/border-radius\s*:\s*([^;]+);/gi) || []).map((s) =>
  s.replace(/border-radius\s*:/i, "").replace(";", "").trim()
);
ok("大容器圆角不超过 12px（--r-lg）", /--r-lg:\s*12px/.test(cssCode));
ok("不存在 9999px / 999px 的 pill 圆角", !radii.some((r) => /999\d?px|50rem/.test(r)),
  radii.filter((r) => /999/.test(r)).join(" | "));
ok("按钮圆角为 6px（--r-sm）", /--r-sm:\s*6px/.test(cssCode));

console.log("\n== 配色 ==");
ok("文字不使用纯黑 #000", !/#000000|#000\b/i.test(cssCode));
ok("存在暖中性画布色（#fafaf9）", /--canvas:\s*#fafaf9/i.test(cssCode));
ok("存在单一强调色变量（--accent）", /--accent:\s*#[0-9a-f]{6}/i.test(cssCode));

// 强调色的饱和度审计：主强调色必须低饱和
const accentMatch = /--accent:\s*#([0-9a-f]{6})/i.exec(cssCode);
let accentSat = null;
if (accentMatch) {
  const hex = accentMatch[1];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  accentSat = max === 0 ? 0 : (max - min) / max;
}
ok("强调色饱和度低于 80%", accentSat !== null && accentSat < 0.8,
  accentSat === null ? "未找到 --accent" : "saturation=" + (accentSat * 100).toFixed(0) + "%");

// 强调色出现次数应克制：检查 CSS 里以强调色作为大面积的填充用途
const accentUses = (cssCode.match(/var\(--accent\)/g) || []).length;
ok("强调色使用克制（不超过 30 处）", accentUses <= 30, "uses=" + accentUses);

console.log("\n== 字体与数字 ==");
ok("声明了等宽数字（tabular-nums）", /tabular-nums/.test(cssCode));
ok("正文行高 >= 1.5（易读）", /line-height:\s*1\.(5|6|7)/.test(cssCode));
ok("中文回退字体已声明", /PingFang SC|Microsoft YaHei/.test(cssCode));
ok("未把 Inter / Roboto 作为首选字体",
  !/font-family:[^;]*\b(Inter|Roboto|Open Sans)\b/i.test(cssCode));

console.log("\n== 内容 ==");
const emojiRe = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/u;
ok("index.html 不含 emoji", !emojiRe.test(html));
ok("game.js 不含 emoji", !emojiRe.test(js));
ok("成功提示不使用感叹号", !/成功[^"']*！/.test(js) && !/已[^"']*！/.test(js));

console.log("\n" + "=".repeat(60));
if (fails.length === 0) {
  console.log(`设计规范审计通过：${pass} 项全部符合简约中性风格。`);
  process.exit(0);
} else {
  console.log(`设计规范审计失败 ${fails.length} 项：`);
  fails.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
