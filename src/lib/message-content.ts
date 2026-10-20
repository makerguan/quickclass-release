/**
 * 从数据库存储的消息 content 中提取纯文本（供学情分析 / 教学研究等分析链路使用）。
 *
 * - 普通字符串：原样返回
 * - 多模态 JSON 数组：只取 text part，剥离 image_url / audio_url
 *   （base64 体积巨大且分析模型用不到，直接丢弃）
 *
 * 2026-10-15：语音消息经全媒体模型转写后，转写文字存于 text part；
 * 分析只读文字、忽略音频文件（用户需求：记录可看文字可听声音，分析忽略声音）。
 */
export function extractMessageText(content: string): string {
  if (!content.startsWith("[")) return content;
  try {
    const parts = JSON.parse(content) as Array<{ type: string; text?: string }>;
    if (!Array.isArray(parts)) return content;
    const text = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join(" ")
      .trim();
    return text || content;
  } catch {
    return content;
  }
}
