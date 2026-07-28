/**
 * 真实文献候选预取模块
 *
 * 在生成论文/课题前，先调 Crossref 学术数据库，按"论文标题 + 关键字"
 * 检索一批已经确认存在的真实文献，注入到 prompt，让 AI 优先引用这些。
 *
 * 目标：把"AI 虚构参考文献"的发生率从 ~70% 降到 ~10~20%。
 *
 * 特性：
 * - 内部缓存：相同 query 1 小时内不重复请求
 * - 失败兜底：网络/Crossref 异常时返回空数组，不阻塞生成
 * - GB/T 7714 格式输出
 * - 优先 journal-article，过滤 has-doi
 */

import { createHash } from "crypto";

export interface RealReferenceCandidate {
  /** 候选文献全文本（GB/T 7714 格式，前缀为 [候选N]） */
  formatted: string;
  /** DOI（如果有） */
  doi?: string;
  /** 标题（英文） */
  title: string;
  /** 作者列表（姓 + 名） */
  authors: string[];
  /** 出版年份 */
  year?: number;
  /** 期刊名 */
  journal?: string;
}

const CROSSREF_HEADERS = {
  "User-Agent":
    "QuickClass-ReferenceFetcher/1.0 (mailto:support@quickclass.local)",
  Accept: "application/json",
};

interface CacheEntry {
  candidates: RealReferenceCandidate[];
  ts: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时

function buildCacheKey(title: string, keywords: string, count: number): string {
  const raw = `${title}|${keywords}|${count}`;
  return createHash("md5").update(raw).digest("hex");
}

/**
 * 从 Crossref 检索真实文献候选
 *
 * @param title 论文/课题题目
 * @param keywords 用户输入的关键词（可空）
 * @param count 期望返回的条数（实际可能更少）
 * @param options.timeoutMs 超时（默认 8000ms）
 */
export async function fetchCandidateReferences(
  title: string,
  keywords: string,
  count: number = 15,
  options?: { timeoutMs?: number },
): Promise<RealReferenceCandidate[]> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const cacheKey = buildCacheKey(title || "", keywords || "", count);

  // 命中缓存
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.candidates;
  }

  const query = [title, keywords].filter(Boolean).join(" ").trim();
  if (!query) {
    cache.set(cacheKey, { candidates: [], ts: Date.now() });
    return [];
  }

  try {
    const url = new URL("https://api.crossref.org/works");
    // 用 bibliographic 查询同时匹配标题/作者/摘要
    // 追加中文教育关键词，提高中文期刊匹配率
    const enrichedQuery = [query, "教育", "教学", "课堂", "学生", "教师", "课程"]
      .filter(Boolean)
      .join(" ");
    url.searchParams.set("query.bibliographic", enrichedQuery.slice(0, 300));
    // 多取一些再过滤（去重 + 缺字段会丢失）
    url.searchParams.set("rows", String(Math.min(count * 2, 40)));
    url.searchParams.set("sort", "relevance");
    // 过滤：仅期刊论文（Crossref works 路由不支持 has-doi 过滤器）
    url.searchParams.set("filter", "type:journal-article");

    const resp = await fetch(url.toString(), {
      headers: CROSSREF_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      cache.set(cacheKey, { candidates: [], ts: Date.now() });
      return [];
    }
    const data = await resp.json();
    const items: any[] = data.message?.items || [];

    const candidates: RealReferenceCandidate[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      if (candidates.length >= count) break;
      const formatted = formatAsGBT7714(item);
      if (!formatted) continue;
      // 标题去重
      const key = formatted.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        formatted,
        doi: typeof item.DOI === "string" ? item.DOI : undefined,
        title: Array.isArray(item.title) ? (item.title[0] || "").trim() : "",
        authors: (item.author || [])
          .map((a: any) => [a.family, a.given].filter(Boolean).join(" ").trim())
          .filter(Boolean),
        year: item.issued?.["date-parts"]?.[0]?.[0],
        journal: Array.isArray(item["container-title"])
          ? (item["container-title"][0] || "").trim()
          : "",
      });
    }

    cache.set(cacheKey, { candidates, ts: Date.now() });
    return candidates;
  } catch {
    // 网络/Crossref 失败：兜底返回空数组，不阻塞生成
    cache.set(cacheKey, { candidates: [], ts: Date.now() });
    return [];
  }
}

/**
 * 把 Crossref 的一条 work 格式化为 GB/T 7714 风格
 * 例：[候选1] Wang Q, Chen L. Core literacy in English education[J]. ELT Journal, 2022, 76(3): 1-12. DOI: 10.1093/elt/ccab045
 */
function formatAsGBT7714(item: any): string | null {
  const title = Array.isArray(item.title) ? (item.title[0] || "").trim() : "";
  const authors = (item.author || [])
    .map((a: any) =>
      [a.family, a.given].filter(Boolean).join(" ").trim(),
    )
    .filter((s: string) => s.length > 0);
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  const journal = Array.isArray(item["container-title"])
    ? (item["container-title"][0] || "").trim()
    : "";
  const volume = item.volume?.trim?.() || "";
  const issue = item.issue?.trim?.() || "";
  const pages = item.page?.trim?.() || "";
  const doi = item.DOI;

  if (!title || authors.length === 0) return null;

  // 截断作者：超过 5 个加"等"
  const authorStr =
    authors.length > 5
      ? authors.slice(0, 5).join(", ") + ", 等"
      : authors.join(", ");

  let formatted = `${authorStr}. ${title}`;
  if (journal) formatted += `[J]. ${journal}`;
  if (year) formatted += `, ${year}`;
  if (volume) formatted += `, ${volume}`;
  if (issue) formatted += `(${issue})`;
  if (pages) formatted += `: ${pages}`;
  formatted += ".";
  if (doi) formatted += ` DOI: ${doi}`;
  return formatted;
}

/**
 * 把候选文献拼成一段 prompt 文本（注入到生成 prompt 中）
 * - 没有候选时返回空字符串（不污染 prompt）
 */
export function buildCandidatePromptSection(
  candidates: RealReferenceCandidate[],
): string {
  if (!candidates || candidates.length === 0) {
    return "";
  }
  // 直接输出 [1] 格式的文献列表，会被放在 [REFERENCES_START] 和 [REFERENCES_END] 之间
  return candidates
    .map((c, i) => `[${i + 1}] ${c.formatted}`)
    .join("\n");
}
