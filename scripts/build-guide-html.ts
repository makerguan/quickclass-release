/**
 * 教师模板修改指南 → 单文件 HTML 生成器
 *
 * 用法：npx tsx scripts/build-guide-html.ts
 * 输入：项目根目录「教师模板修改指南.md」
 * 输出：项目根目录「教师模板修改指南.html」（双击即可浏览器打开）
 *
 * 说明：
 * - Markdown 仍是唯一源文件（编辑、diff 友好），本脚本只负责生成可浏览的 HTML 产物。
 * - ```chart 块会调用 src/lib/report-charts 的 renderChartText() 渲染成真实雷达图 SVG，
 *   而不是只显示 JSON 代码。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderChartText } from "../src/lib/report-charts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const MD_PATH = resolve(ROOT, "教师模板修改指南.md");
const OUT_PATH = resolve(ROOT, "教师模板修改指南.html");

const md = readFileSync(MD_PATH, "utf8");
const lines = md.split(/\r?\n/);

// ---------- 行内 Markdown ----------

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 行内渲染：转义 → 行内代码 → 加粗 */
function inline(s: string): string {
  let out = escHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out;
}

/** 去掉行内 markdown 符号，用于目录/标题纯文本 */
function plain(s: string): string {
  return s.replace(/\*\*/g, "").replace(/`/g, "");
}

// ---------- 块级识别 ----------

function isTableSep(line: string): boolean {
  return /^\s*\|(\s*:?-{1,}:?\s*\|)+\s*$/.test(line);
}

function parseRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** 某行是否属于新的块级元素起始（用于终止段落累积） */
function isBlockStart(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (t.startsWith("```")) return true;
  if (t.startsWith("|")) return true;
  if (/^#{1,6}\s+/.test(t)) return true;
  if (/^(-{3,}|\*{3,})$/.test(t)) return true;
  if (t.startsWith(">")) return true;
  if (/^[-*+]\s+/.test(t)) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

// ---------- 主循环 ----------

const toc: { level: number; text: string; id: string }[] = [];
let body = "";
let i = 0;

while (i < lines.length) {
  const raw = lines[i];
  const t = raw.trim();

  // 空行
  if (t === "") {
    i++;
    continue;
  }

  // 代码块（含 ```chart）
  if (raw.trimStart().startsWith("```")) {
    const lang = raw.trim().slice(3).trim();
    i++;
    const buf: string[] = [];
    while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
      buf.push(lines[i]);
      i++;
    }
    if (i < lines.length) i++; // 跳过结束 ```
    const code = buf.join("\n").trim();
    if (lang === "chart") {
      body += renderChartText(code);
    } else {
      body += `<pre><code>${escHtml(code)}</code></pre>`;
    }
    continue;
  }

  // 表格（表头行 + 分隔行）
  if (t.startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
    const header = parseRow(raw);
    i += 2;
    const rows: string[][] = [];
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      rows.push(parseRow(lines[i]));
      i++;
    }
    const headHtml = `<tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>`;
    const bodyRows = rows
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
      .join("");
    body += `<table><thead>${headHtml}</thead><tbody>${bodyRows}</tbody></table>`;
    continue;
  }

  // 标题
  const h = /^(#{1,6})\s+(.*)$/.exec(t);
  if (h) {
    const level = h[1].length;
    const text = h[2].trim();
    const id = `sec-${toc.length + 1}`;
    if (level >= 2) toc.push({ level, text, id });
    body += `<h${level} id="${id}">${inline(text)}</h${level}>`;
    i++;
    continue;
  }

  // 分隔线
  if (/^(-{3,}|\*{3,})$/.test(t)) {
    body += `<hr>`;
    i++;
    continue;
  }

  // 引用块
  if (raw.trimStart().startsWith(">")) {
    const quoteLines: string[] = [];
    while (i < lines.length && lines[i].trimStart().startsWith(">")) {
      quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
      i++;
    }
    const groups: string[][] = [];
    let cur: string[] = [];
    for (const q of quoteLines) {
      if (q.trim() === "") {
        if (cur.length) {
          groups.push(cur);
          cur = [];
        }
      } else {
        cur.push(q);
      }
    }
    if (cur.length) groups.push(cur);
    const inner = groups.map((g) => `<p>${g.map(inline).join("<br>")}</p>`).join("");
    body += `<blockquote>${inner}</blockquote>`;
    continue;
  }

  // 无序列表
  if (/^[-*+]\s+/.test(t)) {
    const items: string[] = [];
    while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
      items.push(lines[i].replace(/^[-*+]\s+/, ""));
      i++;
    }
    body += `<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`;
    continue;
  }

  // 有序列表
  if (/^\d+\.\s+/.test(t)) {
    const items: string[] = [];
    while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
      items.push(lines[i].replace(/^\d+\.\s+/, ""));
      i++;
    }
    body += `<ol>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ol>`;
    continue;
  }

  // 普通段落
  const buf: string[] = [];
  while (i < lines.length && !isBlockStart(lines[i])) {
    buf.push(lines[i].trim());
    i++;
  }
  if (buf.length) body += `<p>${buf.map(inline).join("<br>")}</p>`;
}

// ---------- 组装 HTML ----------

const title = "学情分析模板定制指南（教师版）";
const tocHtml = toc
  .map(
    (t) =>
      `<a class="toc-item toc-${t.level}" href="#${t.id}">${escHtml(plain(t.text))}</a>`
  )
  .join("");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
:root {
  --brand: #0052D9;
  --brand-soft: #E8F0FF;
  --text: #1F2937;
  --muted: #6B7280;
  --border: #E5E7EB;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: var(--text);
  background: #F8FAFC;
  line-height: 1.75;
}
.layout { display: flex; max-width: 1120px; margin: 0 auto; align-items: flex-start; }
.toc {
  width: 250px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  padding: 32px 16px 48px;
  border-right: 1px solid var(--border);
  background: #fff;
}
.toc-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  margin: 0 10px 12px;
  letter-spacing: 2px;
}
.toc-item {
  display: block;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--muted);
  text-decoration: none;
  font-size: 14px;
  line-height: 1.5;
}
.toc-item:hover { background: var(--brand-soft); color: var(--brand); }
.toc-3 { padding-left: 26px; font-size: 13px; }
.content {
  flex: 1;
  min-width: 0;
  max-width: 860px;
  margin: 0 auto;
  padding: 48px 48px 96px;
  background: #fff;
}
h1 { font-size: 30px; margin: 0 0 24px; padding-bottom: 16px; border-bottom: 2px solid var(--brand); }
h2 { font-size: 22px; margin: 52px 0 16px; padding-left: 12px; border-left: 4px solid var(--brand); }
h3 { font-size: 18px; margin: 36px 0 12px; color: var(--brand); }
p { margin: 14px 0; }
strong { color: var(--brand); }
table { border-collapse: collapse; margin: 18px 0; width: 100%; font-size: 14px; }
th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: #F3F6FC; font-weight: 700; }
tbody tr:nth-child(even) td { background: #FAFBFF; }
blockquote {
  margin: 18px 0;
  padding: 12px 20px;
  background: var(--brand-soft);
  border-left: 4px solid var(--brand);
  border-radius: 0 8px 8px 0;
  color: #334155;
}
blockquote p { margin: 6px 0; }
pre {
  background: #1F2937;
  color: #E5E7EB;
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.7;
}
pre code { background: none; color: inherit; padding: 0; }
code {
  background: #EFF2F7;
  color: #C7254E;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: "SF Mono", Menlo, Consolas, "Courier New", monospace;
  font-size: 0.9em;
}
ul, ol { padding-left: 26px; margin: 14px 0; }
li { margin: 6px 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 44px 0; }
@media (max-width: 900px) {
  .toc { display: none; }
  .content { padding: 28px 20px 64px; }
}
</style>
</head>
<body>
<div class="layout">
  <aside class="toc">
    <div class="toc-title">目录</div>
    ${tocHtml}
  </aside>
  <main class="content">
${body}
  </main>
</div>
</body>
</html>`;

writeFileSync(OUT_PATH, html, "utf8");
console.log(`已生成：${OUT_PATH}`);
console.log(`目录条目：${toc.length} 条`);
