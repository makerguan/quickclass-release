/**
 * AI 洞察内容清理：在生成端（写库前）剥离模型偶发输出的无效信息。
 *
 * 处理两类问题：
 * 1. markdown 代码块围栏包裹（```html ... ```）
 * 2. HTML 文档前后的多余文本（如"这是xxx的HTML学情报告……"等开场白/结尾说明）
 *
 * 铁律：识别不了就不动——未检测到围栏或 HTML 文档标记时原样返回，
 * 纯文本分析（含星星评分、markdown 段落）完全不受影响。
 */
export function cleanInsightContent(raw: string): string {
  if (!raw) return raw;

  let text = raw;

  // 1. 剥离 markdown 围栏：优先整块匹配（首尾恰好是围栏）
  const mdBlock = text.match(/^\s*```(?:html|HTML)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (mdBlock) {
    text = mdBlock[1];
  } else {
    // 容错：只剥离首尾散落的围栏标记
    text = text
      .replace(/^\s*```(?:html|HTML)?\s*\n?/, "")
      .replace(/\n?\s*```\s*$/, "");
  }

  text = text.trim();

  // 2. 截取 HTML 文档主体：定位首个 <!DOCTYPE / <html 到最后一个 </html>
  const doctypeIdx = text.search(/<!doctype\s+html/i);
  const htmlOpenIdx = text.search(/<html[\s>]/i);
  const startIdx =
    doctypeIdx >= 0 && htmlOpenIdx >= 0
      ? Math.min(doctypeIdx, htmlOpenIdx)
      : Math.max(doctypeIdx, htmlOpenIdx);

  // 无 HTML 文档标记：纯文本内容，原样返回
  if (startIdx < 0) return text;

  const endIdx = text.toLowerCase().lastIndexOf("</html>");
  if (endIdx >= 0 && endIdx > startIdx) {
    return text.slice(startIdx, endIdx + "</html>".length).trim();
  }
  // 有开头无 </html>（输出被截断）：从标记开始取到底
  return text.slice(startIdx).trim();
}
