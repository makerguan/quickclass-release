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
 * - 学科注入：subjectHints 的学科英文词置入检索词最前（Crossref 英文库为主），
 *   返回前按学科相关性排序（学科相关候选排前，AI 优先引用小编号）
 *
 * ⛔ DO NOT REVERT: 学科注入是文献学科相关性 ≥80% 的治本环节——
 * 不注入学科词时 Crossref 检索天然偏向通用教育学文献，候选列表学科性低，
 * 提示词"优先使用候选"条款会被通用文献绑架（2026-09 实测确认）。
 * 🔗 RELATED: quality-check.ts DISCIPLINE_WORDS（检测端词表）、
 * data-collector.ts subjectKeywords（17 学科来源）、document-generator.ts 三处学科条款。
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

function buildCacheKey(title: string, keywords: string, count: number, subjectHints: string[] = []): string {
  // ⚠️ 学科词必须入 key：不同学科的相同标题若共享缓存会互相污染候选列表
  const raw = `${title}|${keywords}|${count}|${subjectHints.join(",")}`;
  return createHash("md5").update(raw).digest("hex");
}

/**
 * 学科 → Crossref 英文检索词映射。
 * 🔗 RELATED: key 与 data-collector.ts subjectKeywords / quality-check.ts DISCIPLINE_WORDS
 * 的学科取值保持一致，修改任一处必须同步三处。
 * ⚠️ GOTCHA: Crossref 以英文文献为主，中文学科名检索命中率极低，必须映射为英文词。
 * ⚠️ GOTCHA: "信息技术"是旧课名兼容键（2022 课标改名"信息科技"，旧快照 subjectHints
 * 可能仍存旧词），两个 key 指向同一检索词，删旧键会让旧数据学科注入静默失效。
 */
const SUBJECT_QUERY_TERMS: Record<string, string> = {
  数学: "mathematics education",
  语文: "Chinese language education",
  英语: "English language teaching",
  物理: "physics education",
  化学: "chemistry education",
  生物: "biology education",
  历史: "history education",
  地理: "geography education",
  政治: "civic education",
  科学: "science education",
  信息科技: "computer science education",
  信息技术: "computer science education",
  美术: "art education",
  音乐: "music education",
  体育: "physical education",
  心理: "mental health education",
  道德: "moral education",
  法治: "legal education",
};

/**
 * 学科 → 候选文献标题/期刊名匹配正则（学科相关性排序用）。
 * ⚠️ GOTCHA: 英文必须用完整词组避免子串误匹配（如裸 art 会命中 start/partner）；
 * 中文直接用学科名（≥2 字无误匹配风险）。期刊名一并匹配——
 * 如 Physics Education 期刊上的文献标题可能不含学科词。
 * ⚠️ GOTCHA: "信息技术"是旧课名兼容键，与"信息科技"同值（见 SUBJECT_QUERY_TERMS 注释）。
 */
const SUBJECT_TITLE_RE: Record<string, RegExp> = {
  数学: /mathemat|数学/i,
  语文: /Chinese language|reading instruction|writing instruction|literacy|语文|阅读教学|写作教学/i,
  英语: /English|ELT|EFL|ESL|外语|英语/i,
  物理: /physics|物理/i,
  化学: /chemis|化学/i,
  生物: /biolog|生物/i,
  历史: /histor|历史/i,
  地理: /geograph|地理/i,
  政治: /civic|politic|思政|政治/i,
  科学: /science education|science teaching|science learning|science instruct|科学/i,
  信息科技: /computer|computing|informat|algorithm|编程|信息科技|计算思维/i,
  信息技术: /computer|computing|informat|algorithm|编程|信息科技|计算思维/i,
  美术: /art education|visual art|fine art|aesthetic|美术|绘画/i,
  音乐: /music|音乐/i,
  体育: /physical education|sports education|体育/i,
  心理: /psycholog|mental health|心理/i,
  道德: /moral|德育|道德/i,
  法治: /legal education|law education|法治|法律/i,
};

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
  options?: { timeoutMs?: number; subjectHints?: string[] },
): Promise<RealReferenceCandidate[]> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const subjectHints = options?.subjectHints || [];
  const cacheKey = buildCacheKey(title || "", keywords || "", count, subjectHints);

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
    // 学科英文词置前（提高相关性权重），再拼标题/关键词 + 中文教育通用词
    const subjectTerms = subjectHints
      .map((s) => SUBJECT_QUERY_TERMS[s])
      .filter(Boolean);
    const enrichedQuery = [...subjectTerms, query, "教育", "教学", "课堂", "学生", "教师", "课程"]
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

    // 学科相关性排序：学科相关的候选排前（编号靠前，AI 优先引用）
    // ⚠️ 只排序不过滤——过滤会导致候选不足，排序已足以让学科相关文献占据优先位
    const subjectRes = subjectHints
      .map((s) => SUBJECT_TITLE_RE[s])
      .filter(Boolean);
    if (subjectRes.length > 0) {
      const isRelevant = (c: RealReferenceCandidate) =>
        subjectRes.some((re) => re.test(c.title) || re.test(c.journal || ""));
      candidates.sort((a, b) => Number(isRelevant(b)) - Number(isRelevant(a)));
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
