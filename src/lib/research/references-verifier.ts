/**
 * 参考文献真实性核查模块
 *
 * 流程：
 * 1. 解析每条参考文献：DOI/ISBN/标题/作者/年份/类型
 * 2. 查重（按 title+第一作者+year 哈希）
 * 3. 核查：DOI → Crossref 精确查询；无 DOI → 标题 + 作者 → Crossref 标题搜索
 *    官方文献（课程标准/政策文件）→ 关键词白名单
 * 4. 不可核实者一律删除（按用户要求）
 * 5. 输出：保留的 [N] 列表 + oldToNew 重排映射 + 审计报告
 *
 * 网络说明：
 * - Crossref REST API（公共，免费，建议带 mailto 礼貌池）
 * - 超时：DOI 查询 5s，标题查询 6s
 * - 失败：视为查不到（保守策略，避免误判）
 */

export type RefType = "J" | "M" | "D" | "N" | "S" | "R" | "EB" | "C" | "P" | "DB" | "CP" | "Z";

export interface ParsedReference {
  /** 原始编号（来自 AI 输出时的 [N]） */
  oldIndex: number;
  /** 去除 [N] 后的纯文本 */
  raw: string;
  doi?: string;
  isbn?: string;
  title: string;
  authors: string[];
  year?: number;
  type?: RefType;
  journal?: string;
  publisher?: string;
}

export type RefStatus = "VERIFIED" | "OFFICIAL" | "REMOVED_DUPLICATE" | "REMOVED";

export interface ReferenceAuditItem {
  /** AI 输出时的原始 [N] 编号 */
  index: number;
  raw: string;
  status: RefStatus;
  /** 人类可读的解释（删除原因、命中来源等） */
  reason?: string;
  matchedDoi?: string;
  matchedTitle?: string;
  source?: "crossref" | "openalex" | "official" | "duplicate";
  /** 0-1，标题匹配的相似度 */
  confidence?: number;
}

export interface ReferencesAuditReport {
  total: number;
  verified: number;
  official: number;
  duplicates: number;
  removed: number;
  items: ReferenceAuditItem[];
  checkedAt: string;
}

export interface VerificationResult {
  /** 重排后的 [N] 文本列表（已剔除查不到的） */
  kept: string[];
  report: ReferencesAuditReport;
  /** 旧编号 → 新编号（仅保留的文献有映射，被删的不在表中） */
  oldToNew: Map<number, number>;
}

// ── 解析 ─────────────────────────────────────────────

/**
 * 解析单条参考文献文本（带或不带 [N] 前缀均可）
 */
export function parseReference(input: string, oldIndex: number): ParsedReference {
  // 去掉 [N] 前缀
  const cleaned = input.replace(/^\s*\[\d+\]\s*/, "").trim();

  // DOI: 10.NNNN/...
  const doiMatch = cleaned.match(/10\.\d{4,9}\/[-._;()\/:A-Z0-9]+/i);
  const doi = doiMatch ? doiMatch[0].replace(/[.,;)\]]+$/g, "") : undefined;

  // ISBN: 978-... 或 10 位
  const isbnMatch = cleaned.match(
    /(?:ISBN[:：]?\s*)?(?:97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d|\d{9}[\dXx])\b/i,
  );
  const isbn = isbnMatch
    ? isbnMatch[0].replace(/ISBN[:：]?\s*/i, "").replace(/[-\s]/g, "")
    : undefined;

  // 文献类型
  const typeMatch = cleaned.match(/\[([JMDNSREBCPZ])\]/);
  const type = typeMatch ? (typeMatch[1] as RefType) : undefined;

  // 年份（4 位数字，1900-2099）
  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined;

  // 作者 + 标题
  // 形如: "王某, 张某. 标题[J]. 期刊, 2023, 10(2): 12-18."
  // 或:   "王某. 标题[M]. 北京: 出版社, 2023."
  let authors: string[] = [];
  let title = "";
  const titlePattern = /^[^\.\n]{2,200}\.\s*([^\n\.\[]+?)\s*\[([JMDNSREBCPZ])\]/;
  const titleMatch = cleaned.match(titlePattern);
  if (titleMatch) {
    title = titleMatch[1].trim();
    const authorPart = cleaned.substring(0, cleaned.indexOf(".")).trim();
    // 拆分作者：中文"，"/"，"/","/" 英文","/";" 分隔
    authors = authorPart
      .split(/[,，;；]\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 30);
  } else {
    // fallback：取前 80 字符作为标题
    title = cleaned.substring(0, 80);
    const dotIdx = cleaned.indexOf(".");
    if (dotIdx > 0) {
      authors = cleaned
        .substring(0, dotIdx)
        .split(/[,，;；]\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 30);
    }
  }

  // 期刊
  let journal: string | undefined;
  if (type === "J") {
    const jMatch = cleaned.match(/\[[J]\]\s*([^,，\.\n]{2,80})[,，\s]/);
    if (jMatch) journal = jMatch[1].trim();
  }

  // 出版社
  let publisher: string | undefined;
  if (type === "M") {
    const mMatch = cleaned.match(/\[[M]\]\s*([^:：\n]{2,60})[:：]\s*([^,，\n]{2,60})/);
    if (mMatch) publisher = `${mMatch[1].trim()}: ${mMatch[2].trim()}`;
  }

  return { oldIndex, raw: cleaned, doi, isbn, title, authors, year, type, journal, publisher };
}

// ── 官方文献识别 ───────────────────────────────────

const OFFICIAL_KEYWORDS = [
  "中华人民共和国",
  "教育部",
  "国务院",
  "中共中央",
  "国家教育",
  "国家卫生",
  "办公厅",
  "省教育厅",
  "市教育局",
  "课程方案",
  "课程标准",
  "教学大纲",
  "国家中长期",
  "中国教育现代化",
];

function isLikelyOfficial(p: ParsedReference): boolean {
  // 标准文献强制为官方
  if (p.type === "S") return true;
  // 文件编号模式："教育部令第40号"
  if (/[部厅局]令第?\s*\d+\s*号/.test(p.raw)) return true;
  // 关键字命中
  if (OFFICIAL_KEYWORDS.some((k) => p.raw.includes(k))) return true;
  return false;
}

// ── 外部查询（Crossref）─────────────────────────────

const CROSSREF_HEADERS = {
  "User-Agent":
    "QuickClass-ResearchVerifier/1.0 (mailto:support@quickclass.local)",
  Accept: "application/json",
};

interface CrossrefWork {
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  found: boolean;
}

async function queryCrossrefByDoi(doi: string): Promise<CrossrefWork> {
  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const resp = await fetch(url, {
      headers: CROSSREF_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status === 404) return { found: false };
    if (!resp.ok) return { found: false };
    const data = await resp.json();
    const work = data.message;
    if (!work) return { found: false };
    return {
      found: true,
      title: Array.isArray(work.title) ? work.title[0]?.trim() : undefined,
      authors: (work.author || [])
        .map((a: any) => [a.given, a.family].filter(Boolean).join(" ").trim())
        .filter(Boolean),
      year: work.issued?.["date-parts"]?.[0]?.[0],
      doi: work.DOI,
    };
  } catch {
    return { found: false };
  }
}

async function queryCrossrefByTitle(
  title: string,
  authors: string[],
): Promise<CrossrefWork & { confidence: number }> {
  try {
    const params = new URLSearchParams();
    params.set("query.title", title.slice(0, 200));
    if (authors[0]) params.set("query.author", authors[0].slice(0, 80));
    params.set("rows", "5");
    const url = `https://api.crossref.org/works?${params.toString()}`;
    const resp = await fetch(url, {
      headers: CROSSREF_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return { found: false, confidence: 0 };
    const data = await resp.json();
    const items = data.message?.items || [];
    if (items.length === 0) return { found: false, confidence: 0 };

    const titleLower = title.toLowerCase().replace(/\s+/g, "");
    let best: any = null;
    let bestSim = 0;
    for (const item of items) {
      const itemTitle = (Array.isArray(item.title) ? item.title[0] : "") || "";
      const itemTitleClean = itemTitle.toLowerCase().replace(/\s+/g, "");
      if (!itemTitleClean) continue;
      const sim = titleSimilarity(titleLower, itemTitleClean);
      if (sim > bestSim) {
        bestSim = sim;
        best = item;
      }
    }
    // 阈值 0.78
    if (best && bestSim >= 0.78) {
      return {
        found: true,
        confidence: bestSim,
        title: best.title?.[0]?.trim(),
        authors: (best.author || [])
          .map((a: any) => [a.given, a.family].filter(Boolean).join(" ").trim())
          .filter(Boolean),
        year: best.issued?.["date-parts"]?.[0]?.[0],
        doi: best.DOI,
      };
    }
    return { found: false, confidence: bestSim };
  } catch {
    return { found: false, confidence: 0 };
  }
}

/**
 * 字符 bigram Jaccard 相似度
 * 对中英文都鲁棒
 */
function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2));
    return set;
  };
  const aSet = bigrams(a);
  const bSet = bigrams(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const union = aSet.size + bSet.size - inter;
  return inter / union;
}

// ── 主入口 ────────────────────────────────────────

export async function verifyAndFilterReferences(
  refs: string[],
  options?: { concurrency?: number; skipNetwork?: boolean },
): Promise<VerificationResult> {
  const concurrency = options?.concurrency ?? 4;
  const skipNetwork = options?.skipNetwork ?? false;

  // 1. 解析
  const parsed = refs.map((r, i) => {
    const m = r.match(/^\s*\[(\d+)\]\s*([\s\S]*)$/);
    const oldIndex = m ? parseInt(m[1], 10) : i + 1;
    const raw = m ? m[2].trim() : r.trim();
    return parseReference(raw, oldIndex);
  });

  // 2. 去重（保留首次出现的）
  const seen = new Map<string, number>(); // key → master oldIndex
  const dupMap = new Map<number, number>(); // oldIndex → master oldIndex
  for (const p of parsed) {
    const key = `${normalizeKey(p.title)}|${normalizeKey(p.authors[0] || "")}|${p.year || ""}`;
    if (seen.has(key)) {
      dupMap.set(p.oldIndex, seen.get(key)!);
    } else {
      seen.set(key, p.oldIndex);
    }
  }

  // 3. 逐条核查（并发）
  const audit: ReferenceAuditItem[] = [];
  const oldToNew = new Map<number, number>();
  const kept: string[] = [];
  let newIdx = 1;
  let verified = 0,
    official = 0,
    duplicates = 0,
    removed = 0;

  // 主任务队列
  type Task = { p: typeof parsed[number]; master?: number };
  const tasks: Task[] = parsed.map((p) => ({ p, master: dupMap.get(p.oldIndex) }));

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((t) => processOne(t.p, t.master, skipNetwork)));
    for (const r of results) {
      audit.push(r.audit);
      if (r.drop) {
        if (r.audit.status === "REMOVED_DUPLICATE") duplicates++;
        removed++;
      } else {
        oldToNew.set(r.audit.index, newIdx);
        kept.push(`[${newIdx}] ${r.audit.raw}`);
        newIdx++;
        if (r.audit.status === "VERIFIED") verified++;
        if (r.audit.status === "OFFICIAL") official++;
      }
    }
  }

  return {
    kept,
    report: {
      total: parsed.length,
      verified,
      official,
      duplicates,
      removed,
      items: audit,
      checkedAt: new Date().toISOString(),
    },
    oldToNew,
  };
}

interface ProcessOneResult {
  audit: ReferenceAuditItem;
  drop: boolean;
}

async function processOne(
  p: ParsedReference,
  masterOldIdx: number | undefined,
  skipNetwork: boolean,
): Promise<ProcessOneResult> {
  // 重复
  if (masterOldIdx !== undefined) {
    return {
      audit: {
        index: p.oldIndex,
        raw: p.raw,
        status: "REMOVED_DUPLICATE",
        reason: `与 [${masterOldIdx}] 重复（标题+作者+年份相同）`,
      },
      drop: true,
    };
  }

  // 官方文献
  if (isLikelyOfficial(p)) {
    return {
      audit: {
        index: p.oldIndex,
        raw: p.raw,
        status: "OFFICIAL",
        reason: "命中官方文件/课程标准/政策文件白名单",
        source: "official",
        confidence: 1,
      },
      drop: false,
    };
  }

  // 跳过网络（仅用于测试）
  if (skipNetwork) {
    return {
      audit: {
        index: p.oldIndex,
        raw: p.raw,
        status: "REMOVED",
        reason: "跳过网络核查（测试模式）",
      },
      drop: true,
    };
  }

  // DOI 精确核查
  if (p.doi) {
    const r = await queryCrossrefByDoi(p.doi);
    if (r.found && r.title) {
      // 标题再核对一次
      const sim = titleSimilarity(
        (p.title || "").toLowerCase().replace(/\s+/g, ""),
        r.title.toLowerCase().replace(/\s+/g, ""),
      );
      if (sim >= 0.6) {
        return {
          audit: {
            index: p.oldIndex,
            raw: p.raw,
            status: "VERIFIED",
            reason: `DOI 精确命中（${p.doi}，标题相似度 ${(sim * 100).toFixed(0)}%）`,
            matchedDoi: p.doi,
            matchedTitle: r.title,
            source: "crossref",
            confidence: sim,
          },
          drop: false,
        };
      }
    }
  }

  // 标题模糊匹配
  if (p.title && p.title.length >= 6) {
    const r = await queryCrossrefByTitle(p.title, p.authors);
    if (r.found) {
      return {
        audit: {
          index: p.oldIndex,
          raw: p.raw,
          status: "VERIFIED",
          reason: `标题模糊匹配（相似度 ${(r.confidence * 100).toFixed(0)}%）`,
          matchedTitle: r.title,
          matchedDoi: r.doi,
          source: "crossref",
          confidence: r.confidence,
        },
        drop: false,
      };
    }
  }

  // 查不到 → 删除
  return {
    audit: {
      index: p.oldIndex,
      raw: p.raw,
      status: "REMOVED",
      reason: p.doi
        ? `DOI ${p.doi} 在 Crossref 查无此文，疑似虚构`
        : "未在 Crossref 找到匹配文献，按规则删除（避免假文献）",
    },
    drop: true,
  };
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s,.，。；;,、:：'"""''!?！？《》()()\[\]\-—_]/g, "").slice(0, 60);
}

// ── 正文引用重写 ─────────────────────────────────

/**
 * 重写正文中的 [N] 引用：
 * - 旧编号在 oldToNew 中：替换为新编号
 * - 旧编号不在 oldToNew 中（即对应文献被删）：删除该 [N] 标记
 * - 支持 [1,2]、[1, 2]、[1-3] 复合引用
 * - 即使 oldToNew 为空，仍会执行清理（防御被删的引用残留）
 */
export function renumberBodyText(text: string, oldToNew: Map<number, number>): string {
  if (!text) return text;
  // 处理 [N]、[N,M]、[N-M] 三种
  let result = text.replace(/\[(\d+(?:\s*[,，\-–—]\s*\d+)*)\]/g, (m, inner) => {
    const nums = parseComplexCitation(inner);
    if (!nums) return m;
    const newNums: number[] = [];
    for (const n of nums) {
      const m2 = oldToNew.get(n);
      if (m2 !== undefined) newNums.push(m2);
    }
    if (newNums.length === 0) return ""; // 全部被删
    // 去重并升序
    newNums.sort((a, b) => a - b);
    return `[${newNums.join(",")}]`;
  });
  // 清理：多空格 → 单空格、中文标点前的空格、防御空方括号
  result = result
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([。，；）)、])/g, "$1")
    .replace(/\[\s*\]/g, "");
  return result;
}

function parseComplexCitation(s: string): number[] | null {
  const result = new Set<number>();
  const parts = s.split(/[,，]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (/[-–—]/.test(part)) {
      const [a, b] = part.split(/[-–—]/).map((p) => parseInt(p.trim(), 10));
      if (isNaN(a) || isNaN(b) || a > b || a < 1 || b > 999) return null;
      for (let i = a; i <= b; i++) result.add(i);
    } else {
      const n = parseInt(part, 10);
      if (isNaN(n) || n < 1 || n > 999) return null;
      result.add(n);
    }
  }
  return Array.from(result);
}
