/**
 * 文本分块工具
 * 按语义边界（段落、句子）切分文本，支持重叠
 */

export interface ChunkOptions {
  chunkSize?: number;   // 每块最大字符数，默认 800
  overlap?: number;     // 相邻块重叠字符数，默认 100
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { chunkSize = 800, overlap = 100 } = options;
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const safeOverlap = Math.min(overlap, Math.floor(chunkSize / 3));
  const minChunkSize = Math.floor(chunkSize * 0.3); // 最小块大小

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    // 默认切到 start + chunkSize 或文本末尾
    let end = Math.min(start + chunkSize, trimmed.length);

    // 如果还没到结尾，尝试在语义边界处切断
    if (end < trimmed.length) {
      // 在 [start + minChunkSize, end] 范围内找最佳断点
      const searchStart = start + minChunkSize;

      // 优先找段落边界（\n\n）
      const paragraphBreak = trimmed.lastIndexOf("\n\n", end);
      if (paragraphBreak >= searchStart) {
        end = paragraphBreak + 2;
      } else {
        // 其次找句号、问号、感叹号
        let bestSentenceEnd = -1;
        for (const sep of ["。", "？", "！", ".", "?", "!"]) {
          const pos = trimmed.lastIndexOf(sep, end);
          if (pos >= searchStart && pos > bestSentenceEnd) {
            bestSentenceEnd = pos;
          }
        }
        if (bestSentenceEnd >= searchStart) {
          end = bestSentenceEnd + 1;
        } else {
          // 最后找空格
          const space = trimmed.lastIndexOf(" ", end);
          if (space >= searchStart) {
            end = space + 1;
          }
          // 如果都找不到，保持 end = start + chunkSize
        }
      }
    }

    // 安全检查：确保 end > start
    end = Math.max(end, start + 1);
    end = Math.min(end, trimmed.length);

    const chunk = trimmed.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // 前进：end - overlap，但至少前进 minChunkSize
    const nextStart = end - safeOverlap;
    start = Math.max(nextStart, start + minChunkSize);

    // 终极安全：如果 start 没前进（不应该发生），强制前进
    if (start <= end - trimmed.length + chunkSize) {
      // 正常
    }
    if (chunk.length === 0 || start >= trimmed.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}
