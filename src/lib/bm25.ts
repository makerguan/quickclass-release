/**
 * BM25 文本检索引擎
 * 纯 JavaScript 实现，无需任何 ML 模型，100% 可靠
 * 支持中文分词（基于字符 n-gram + 常用词切分）
 */

// 中文停用词
const STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
  "自己", "这", "他", "她", "它", "们", "那", "些", "什么", "如何", "怎么", "为什么",
  "哪", "哪些", "可以", "能", "吗", "呢", "吧", "啊", "哦", "呀", "嗯",
]);

/**
 * 简易中文分词：混合策略
 * 1. 提取英文单词
 * 2. 提取数字
 * 3. 中文按 2-gram（bigram）切分
 * 4. 过滤停用词和单字符
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  // 提取英文单词和数字
  const alphaNums = text.match(/[a-zA-Z][a-zA-Z0-9]*/g) || [];
  tokens.push(...alphaNums.map((t) => t.toLowerCase()));

  // 提取数字
  const nums = text.match(/\d+(\.\d+)?/g) || [];
  tokens.push(...nums);

  // 提取中文字符序列，做 bigram
  const chineseChunks = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const chunk of chineseChunks) {
    // 单字直接跳过（停用词过滤）
    if (chunk.length === 1) continue;
    // 2 字组合
    for (let i = 0; i < chunk.length - 1; i++) {
      const bigram = chunk.slice(i, i + 2);
      if (!STOP_WORDS.has(bigram)) {
        tokens.push(bigram);
      }
    }
    // 3 字组合（对专业术语更精准）
    for (let i = 0; i < chunk.length - 2; i++) {
      const trigram = chunk.slice(i, i + 3);
      if (!STOP_WORDS.has(trigram)) {
        tokens.push(trigram);
      }
    }
    // 4 字组合（成语、专业术语）
    for (let i = 0; i < chunk.length - 3; i++) {
      const fourgram = chunk.slice(i, i + 4);
      tokens.push(fourgram);
    }
  }

  return tokens;
}

/**
 * 计算 BM25 分数
 */
export interface BM25Options {
  k1?: number;  // 词频饱和参数，默认 1.5
  b?: number;   // 文档长度归一化参数，默认 0.75
}

export class BM25Index {
  private docs: { id: string | number; tokens: string[]; text: string }[] = [];
  private df: Map<string, number> = new Map(); // 文档频率
  private avgDocLen: number = 0;
  private k1: number;
  private b: number;

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
  }

  /**
   * 添加文档到索引
   */
  addDoc(id: string | number, text: string) {
    const tokens = tokenize(text);
    this.docs.push({ id, tokens, text });

    // 更新文档频率
    const uniqueTokens = Array.from(new Set(tokens));
    for (const t of uniqueTokens) {
      this.df.set(t, (this.df.get(t) || 0) + 1);
    }

    // 更新平均文档长度
    const totalLen = this.docs.reduce((sum, d) => sum + d.tokens.length, 0);
    this.avgDocLen = totalLen / this.docs.length;
  }

  /**
   * 搜索最相关的文档
   */
  search(query: string, topK: number = 3): { id: string | number; text: string; score: number }[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.length === 0) return [];

    const N = this.docs.length;
    const scores: { id: string | number; text: string; score: number }[] = [];

    for (const doc of this.docs) {
      let score = 0;

      // 计算文档中每个 token 的词频
      const tfMap = new Map<string, number>();
      for (const t of doc.tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }

      for (const qt of queryTokens) {
        const tf = tfMap.get(qt) || 0;
        if (tf === 0) continue;

        const dfVal = this.df.get(qt) || 0;
        // IDF 公式
        const idf = Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1);

        // BM25 词频饱和公式
        const docLenNorm = 1 - this.b + this.b * (doc.tokens.length / this.avgDocLen);
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * docLenNorm);

        score += idf * tfNorm;
      }

      if (score > 0) {
        scores.push({ id: doc.id, text: doc.text, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  /**
   * 获取文档数量
   */
  get size() {
    return this.docs.length;
  }
}

/**
 * 便捷函数：对一组文本做 BM25 检索
 */
export function bm25Search(
  query: string,
  documents: string[],
  topK: number = 3
): { text: string; score: number }[] {
  const index = new BM25Index();
  documents.forEach((doc, i) => index.addDoc(i, doc));
  return index.search(query, topK).map((r) => ({ text: r.text, score: r.score }));
}

/**
 * 便捷函数：对知识库内容做 BM25 检索（先分块再检索）
 */
export function bm25SearchKnowledgeBase(
  query: string,
  content: string,
  topK: number = 3,
  chunkSize: number = 600
): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chunkText } = require("./chunker");
  const chunks = chunkText(content, { chunkSize, overlap: 100 });
  if (chunks.length === 0) return [];
  if (chunks.length === 1) return chunks;

  const results = bm25Search(query, chunks, topK);
  return results.map((r) => r.text);
}
