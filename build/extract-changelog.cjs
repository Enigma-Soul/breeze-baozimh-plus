// 从 CHANGELOG.md 提取指定版本的段落，写入 release-notes.md 作为 GitHub Release 正文。
// 仅 h1（# 版本号）作为版本边界，h2/h3 等内容一并纳入。
// 用法：VERSION=0.1.0 node build/extract-changelog.cjs
// 找不到段落时输出 warning 并写空文件（由调用方回退到自动生成）。
const fs = require("node:fs");

const ver = process.env.VERSION;
if (!ver) {
  console.error("[changelog] VERSION 环境变量未设置");
  process.exit(1);
}

const md = fs.readFileSync("CHANGELOG.md", "utf8");
const esc = ver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = new RegExp(`^#\\s*v?${esc}\\b`);
const lines = md.split(/\r?\n/);

let capturing = false;
const out = [];
for (const raw of lines) {
  if (/^#\s/.test(raw.trim())) {
    // h1 = 版本边界
    if (capturing) break; // 下一个版本 → 结束
    capturing = re.test(raw.trim());
    continue;
  }
  if (capturing) out.push(raw);
}

const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
fs.writeFileSync("release-notes.md", body ? `${body}\n` : "");

if (body) {
  console.log(`[changelog] 提取 ${ver} 段落，${body.length} 字符`);
} else {
  console.log(`::warning::CHANGELOG.md 无 ${ver} 段落，将回退到自动生成`);
}
