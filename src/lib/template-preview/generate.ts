import { createHash } from "node:crypto";
import { generateText } from "ai";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { cleanInsightContent } from "@/lib/insight-clean";
import { getSampleDataset, getSampleVars, replaceSampleVars } from "./samples";

/** 预览内容上限：防止把库撑爆（文本 20KB / 网页 200KB） */
export const PREVIEW_TEXT_LIMIT = 20000;
export const PREVIEW_HTML_LIMIT = 200000;

/**
 * 📐 CONTRACT —— JSON 整体输出的预览格式化（作业设计类模板专用通道）。
 *
 * 为什么：QUIZ_DESIGN 类模板要求 AI「直接输出 JSON 数组、不要代码块」（机器解析用），
 * 预览若照原样返回会被前端当 Markdown 渲染成一大坨无换行的源码（2026-10-21 老师实测反馈）。
 *
 * 现状约束：只处理「剥掉 markdown 围栏后整体就是一个 JSON 数组/对象」的输出 ——
 * 报告类模板正文里偶尔讨论 JSON 示例的，整体 parse 必然失败，走原 Markdown 通道，互不干扰。
 * 分色用后端拼好的内联样式 HTML（kind=html 走预览弹窗的沙箱 iframe），不引前端高亮库。
 *
 * 🔗 RELATED：TemplatePreviewButton.tsx（kind=html → iframe srcDoc 渲染）；本文件 generatePreview。
 * ⛔ DO NOT REVERT：不要改成把 JSON 包进 ```json 围栏走 Markdown —— 本项目 Markdown 组件
 *   无代码高亮（见 Markdown.tsx，未接 rehype-highlight），围栏只会得到无色源码块，等于没修。
 */
const JSON_TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 剥掉 markdown 代码围栏（AI 有时不听"不要代码块"的嘱托） */
function stripCodeFence(text: string): string {
  const m = text.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : text;
}

/** 整体输出是 JSON 时返回带分色样式的独立 HTML 文档；否则返回 null（调用方走原通道） */
function jsonPreviewHtml(raw: string): string | null {
  const body = stripCodeFence(raw).trim();
  if (!/^[[{]/.test(body) || !/[\]}]$/.test(body)) return null;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object") return null;

  // 单遍 tokenizer：key=蓝 / 字符串值=绿 / 数值·布尔·null=橙，其余（括号逗号）灰色
  const pretty = JSON.stringify(data, null, 2);
  const parts: string[] = [];
  let last = 0;
  for (const m of pretty.matchAll(JSON_TOKEN_RE)) {
    const idx = m.index ?? 0;
    parts.push(escapeHtml(pretty.slice(last, idx)));
    const [full, str, colon, bool, num] = m;
    const color = colon ? "#185FA5" : str ? "#2E7D32" : bool || num ? "#B26A00" : "#555";
    parts.push(`<span style="color:${color}">${escapeHtml(full)}</span>`);
    last = idx + full.length;
  }
  parts.push(escapeHtml(pretty.slice(last)));

  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
    "<style>body{margin:0;padding:20px 24px;background:#fafbfc;font:13px/1.85 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;color:#333}",
    "pre{margin:0;white-space:pre-wrap;word-break:break-all}</style></head><body>",
    `<pre>${parts.join("")}</pre></body></html>`,
  ].join("");
}

/** 模板正文哈希：只算正文，所以"只改模板名"不会让预览过期 */
export function hashTemplateContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 32);
}

/** 判断预览产物是网页还是文本 */
export function detectPreviewKind(text: string): "text" | "html" {
  const head = text.slice(0, 4000);
  return /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(head) ? "html" : "text";
}

/** 预览系统提示词：固定低温度、只出内容不出寒暄 */
const PREVIEW_SYSTEM_PROMPT = `你是一位课堂数据分析助手，正在帮老师"看一眼某个分析模板实际生成出来的效果"。

规则：
1. 严格按下面模板中提出的所有要求生成，不要自由发挥成别的形式；
2. 使用给定的示例数据，语气要像真实报告，不要出现"这是示例""演示数据"之类的说明；
3. 不要输出任何与结果无关的寒暄、解释或总结（例如"以下是生成内容"）；
4. 若模板要求输出网页/HTML，请输出一个完整可直接打开的 HTML 文档（含内联样式，不引用外部资源）；
5. 若模板未要求网页，请用 Markdown 输出结构化结果；
6. 全文使用正常的中文标点与文字，不要出现乱码或转义字符。

排版要求（目标是"看起来像一份真实交付的报告"）：
7. 分节组织：模板里若用编号列出了多项要求（如"1. … 2. …"），请逐条对应成节，
   每节给一个小标题（Markdown 用 "## 小标题"，网页用 <h2>），关键结论加粗点出。
   不要把数百字挤成一大段散文。
8. 图表：仅当输出网页、且内容涉及分数／占比／分布时，必须使用下面这种 chart 数据块，
   由前端做确定性渲染；不要自己写 SVG、canvas，也不要引用外部图表库：
   \`\`\`chart
   {"type":"bar","title":"标题","style":{"theme":"blue","showValues":true,"unit":"分"},"data":[{"name":"项目","value":80}]}
   \`\`\`
   可选 type：radar / bar / line / pie / progress / scatter；每类数据不超过 8 项；
   数值要与示例数据一致，不要另编量级。`;

/**
 * 用示例数据把模板跑一次，得到预览内容。
 * 只在这里调用 AI —— 调用方负责把结果缓存起来，后续预览直接读缓存。
 */
export async function generatePreview(params: {
  content: string;
  name: string;
  type: string;
}): Promise<{ kind: "text" | "html"; content: string; truncated: boolean; model: string | null }> {
  const { content, name, type } = params;

  const { filled, missingVars } = replaceSampleVars(content, getSampleVars(type));
  const dataset = getSampleDataset(type);

  const userPrompt = [
    `# 待预览的模板：${name}`,
    "",
    "## 模板正文（这是老师写的分析要求，请严格照做）",
    filled,
    "",
    "## 示例数据（正式使用时这里会是真实课堂数据）",
    dataset,
    missingVars.length > 0
      ? `\n## 说明\n模板中还引用了这些变量：${missingVars.map((v) => `{${v}}`).join("、")}。示例数据里没有对应内容，请按上下文合理推断，不要编造具体人名。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { chatModel } = await createDashScopeClient();

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel,
      system: PREVIEW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2, // 固定低温度：同一模板每次预览观感一致，便于对比
      maxOutputTokens: 65536,
    })
  );

  const raw = (result.text || "").trim();
  if (!raw) throw new Error("预览生成失败：模型没有返回内容");

  // JSON 整体输出（作业设计类模板）→ 直接产出格式化 HTML，跳过 Markdown/报告清洗管线
  const jsonHtml = jsonPreviewHtml(raw);
  if (jsonHtml) {
    const truncated = jsonHtml.length > PREVIEW_HTML_LIMIT;
    return {
      kind: "html",
      content: truncated ? `${jsonHtml.slice(0, PREVIEW_HTML_LIMIT)}<!-- 内容较长，预览已截断 -->` : jsonHtml,
      truncated,
      model: null,
    };
  }

  // 先按模型**原始输出**判类型（认 <!DOCTYPE html>/<html>/<body> 文档标记）
  const kind = detectPreviewKind(raw);

  // 再走项目既有的报告清洗管线（与真实学情报告页**完全同一套**）：
  //   ① ```chart 数据块 → 确定性 SVG 图表（不走这步，预览里只会看到一段 JSON 源码）
  //   ② 剥掉 markdown 围栏（```html … ```）
  //   ③ 抽出 HTML 文档主体、丢掉前后的寒暄与说明
  // cleanInsightContent 内部对失败做了兜底（最坏原样返回），不会把预览清没。
  const cleaned = cleanInsightContent(raw) || raw;

  const limit = kind === "html" ? PREVIEW_HTML_LIMIT : PREVIEW_TEXT_LIMIT;
  const truncated = cleaned.length > limit;
  const finalContent = truncated
    ? kind === "html"
      ? `${cleaned.slice(0, limit)}\n<!-- 内容较长，预览已截断 -->`
      : `${cleaned.slice(0, limit)}\n\n> 内容较长，预览已截断。`
    : cleaned;

  return { kind, content: finalContent, truncated, model: null };
}
