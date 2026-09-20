/**
 * 「AI 重排数据大屏」的预置提示词 + 字段摘要构造 + 配置校验（纯函数，无 React）。
 *
 * 设计红线（不可违反）：
 *   1. **AI 只出图表配置 JSON，绝不出 HTML**。数据源是学生自由输入，
 *      让 AI 产出 HTML 再渲染 = 存储型 XSS。前端只按配置渲染图表。
 *   2. **只给 AI 字段摘要 + 聚合统计，不给原始记录** —— 既控上下文，也避免学生原文外泄。
 *   3. AI 返回的字段名必须真实存在于数据中（白名单校验），类型必须在允许集合内，超限一律丢弃。
 *
 * 成本量级：单次提示词约 2~4 KB，老师手动触发、低频，用平台兜底模型接近 0 元。
 */

/** 字段摘要（发给 AI 的形态，不含原始数据） */
export interface FieldSummary {
  name: string;
  /** number 数值 / option 选项(低基数) / text 自由文本 / multi 多选数组 */
  type: "number" | "option" | "text" | "multi";
  count: number;
  unique: number;
  /** option / text / multi：Top 取值与次数 */
  top?: { value: string; count: number }[];
  /** number：统计量 */
  min?: number;
  max?: number;
  avg?: number;
}

export interface AiDashboardKpi {
  label: string;
  field: string | null;
  agg: "count" | "unique" | "avg" | "sum" | "max" | "min";
}

export type AiChartType = "bar" | "line" | "hbar" | "pie" | "roster" | "list";

/** 强调色（AI 只能从中选择；渲染器为白底统一基调，此色仅决定图表主色，不允许 AI 自造颜色/样式）
 *  ⚠️ 旧配置的深色主题名（aurora 等）不在白名单内，sanitize 自动落回默认蓝，无需迁移。 */
export type AiDashboardTheme = "blue" | "teal" | "green" | "amber";

export const ALLOWED_THEMES: AiDashboardTheme[] = ["blue", "teal", "green", "amber"];
/** 默认强调色：QuickClass 品牌蓝 */
export const DEFAULT_THEME: AiDashboardTheme = "blue";

export interface AiDashboardChart {
  title: string;
  field: string;
  type: AiChartType;
  limit?: number;
  /** 主视觉：2 = 占双栏（每屏最多 1 个） */
  span?: 1 | 2;
  note?: string;
}

export interface AiDashboardConfig {
  title?: string;
  subtitle?: string;
  theme?: AiDashboardTheme;
  kpis?: AiDashboardKpi[];
  charts?: AiDashboardChart[];
}

const ALLOWED_AGGS: AiDashboardKpi["agg"][] = ["count", "unique", "avg", "sum", "max", "min"];
const ALLOWED_TYPES: AiChartType[] = ["bar", "line", "hbar", "pie", "roster", "list"];

/** 最多发给 AI 的字段数（控上下文） */
const MAX_FIELDS = 20;
/** 每个字段最多带的 Top 取值数（控上下文） */
const MAX_TOP = 8;

function isNumericValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n);
  }
  return false;
}

function toCounter(values: unknown[], limit: number): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = String(v);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/**
 * 从 QF 记录里构造字段摘要。入参 records 只用到 data 字段。
 * 与前端 QuickFormDashboard 的归类口径保持一致：跳过 `_` 保留字段与空值。
 */
export function buildFieldSummaries(records: { data?: Record<string, unknown> }[]): FieldSummary[] {
  const fieldMap = new Map<string, unknown[]>();
  for (const r of records) {
    const data = r?.data || {};
    for (const [k, v] of Object.entries(data)) {
      if (!k || k.startsWith("_")) continue;
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (!fieldMap.has(k)) fieldMap.set(k, []);
      fieldMap.get(k)!.push(v);
    }
  }

  const out: FieldSummary[] = [];
  for (const [name, raw] of fieldMap.entries()) {
    const values = raw.filter(
      (v) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")
    );
    if (values.length === 0) continue;

    if (values.every((v) => Array.isArray(v))) {
      out.push({
        name,
        type: "multi",
        count: values.length,
        unique: new Set(values.flat().map((v) => String(v))).size,
        top: toCounter(values.flat(), MAX_TOP),
      });
      continue;
    }

    if (values.every(isNumericValue)) {
      const nums = values.map((v) => Number(v));
      const sum = nums.reduce((a, b) => a + b, 0);
      out.push({
        name,
        type: "number",
        count: nums.length,
        unique: new Set(nums.map((v) => String(v))).size,
        min: Math.min(...nums),
        max: Math.max(...nums),
        avg: Math.round((sum / nums.length) * 100) / 100,
      });
      continue;
    }

    const unique = new Set(values.map((v) => String(v))).size;
    out.push({
      name,
      type: unique <= 8 ? "option" : "text",
      count: values.length,
      unique,
      top: toCounter(values, MAX_TOP),
    });
  }

  return out.slice(0, MAX_FIELDS);
}

/** 系统提示词（预置，老师的额外要求作为 user 消息追加） */
export const DASHBOARD_SYSTEM_PROMPT = `你是「课堂数据大屏」的排版设计师兼配置生成器。你会收到一份学生提交数据的【字段摘要】——只有字段名与聚合统计，没有任何原始学生数据。
你的任务：为老师端「统计信息」页**规划一块好看的数据大屏**，输出一份 JSON 配置。
渲染引擎是白底白卡片的「数据平台」风格（与网站风格统一），图表由引擎统一绘制，你负责**选字段、选图型、排布局**。

【强调色】从以下白名单选一个填入 theme（这是整块大屏的图表主色，底色固定为白，请勿要求换底色）：
- blue   品牌蓝（默认首选，最稳）
- teal   青色（清爽）
- green  绿色（生机）
- amber  琥珀（温暖）
老师额外要求里若点名颜色倾向，选最接近的一个；没提则默认 blue。

【可用图表类型】
- bar    垂直柱状图（适合数值分布，最常用）
- line   折线图（适合数值走势）
- hbar   横向条形图（适合选项题占比，取值多时比饼图清晰）
- pie    环形图（仅适合取值 3~4 种的选项占比）
- roster 名单（适合姓名/学号等标识字段，不做统计，通栏展示）
- list   标签列表（适合自由文本，展示高频取值）

【输出格式】只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字：
{
  "title": "大屏标题（不超过 12 字）",
  "subtitle": "一句话副标题（不超过 30 字）",
  "theme": "blue",
  "kpis": [ { "label": "指标名（不超过 6 字）", "field": "字段名或 null", "agg": "count" } ],
  "charts": [ { "title": "卡片标题（不超过 10 字）", "field": "字段名", "type": "bar", "limit": 8, "span": 2, "note": "一句话解读（不超过 20 字）" } ]
}

【布局是关键 —— 排版设计原则】
1. span=2 表示该卡片占整行通栏（主视觉），应留给最重要、最抓眼球的图表，最多 1 个；其余不填 span 或填 1。
2. 图表组合要有节奏：一张通栏主视觉 + 若干不同图型的小卡（bar/pie/hbar/list 混搭，避免全是同一种图型）。
3. 名单（roster）会通栏展示；数值字段优先 bar；取值 3~4 种的选项用 pie、5 种以上用 hbar；自由文本用 list。
4. 标题和解读要像大屏文案：短、有洞察（如"姓名分布"不如"他们是谁"），但不许夸张编造结论。

【硬性规则】
1. field 必须是字段摘要中出现过的字段名，禁止编造；field 为 null 表示统计全部提交。
2. kpis 给 3~4 个；charts 给 2~6 个。
3. 数据很少（仅 1~2 条）时减少图表数量，不要硬凑，宁可只给 KPI。
4. 若老师给了额外要求，在不违反以上规则的前提下优先满足。
5. 绝不输出 HTML、脚本或样式，只输出 JSON。`;

/** 从模型返回文本里抠出 JSON 对象（容忍 ```json 包裹与前后废话） */
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampStr(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * 校验并裁剪 AI 返回的配置：
 *   - field 必须在 validFields 白名单内（防编造字段）
 *   - type / agg 必须在允许集合内
 *   - limit 夹在 3~20
 * 非法条目直接丢弃，不报错（宁可少画一张图，也不让页面崩）。
 */
export function sanitizeDashboardConfig(raw: unknown, validFields: string[]): AiDashboardConfig {
  const valid = new Set(validFields);
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const kpis: AiDashboardKpi[] = [];
  if (Array.isArray(o.kpis)) {
    for (const item of o.kpis) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const label = clampStr(it.label, 10);
      if (!label) continue;
      const agg = ALLOWED_AGGS.includes(it.agg as AiDashboardKpi["agg"])
        ? (it.agg as AiDashboardKpi["agg"])
        : "count";
      let field: string | null = null;
      if (typeof it.field === "string" && valid.has(it.field)) field = it.field;
      kpis.push({ label, field, agg });
      if (kpis.length >= 4) break;
    }
  }

  const charts: AiDashboardChart[] = [];
  let heroUsed = false;
  if (Array.isArray(o.charts)) {
    for (const item of o.charts) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const field = typeof it.field === "string" && valid.has(it.field) ? it.field : null;
      if (!field) continue;
      const type = ALLOWED_TYPES.includes(it.type as AiChartType) ? (it.type as AiChartType) : "bar";
      const limitRaw = Number(it.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(3, Math.round(limitRaw))) : 8;
      // 主视觉：AI 请求 span=2 且还没人占用时才给；否则降为普通卡
      const span: 1 | 2 = it.span === 2 && !heroUsed ? 2 : 1;
      if (span === 2) heroUsed = true;
      charts.push({
        title: clampStr(it.title, 14) || field,
        field,
        type,
        limit,
        span,
        note: clampStr(it.note, 30),
      });
      if (charts.length >= 6) break;
    }
  }

  return {
    title: clampStr(o.title, 16),
    subtitle: clampStr(o.subtitle, 40),
    theme: ALLOWED_THEMES.includes(o.theme as AiDashboardTheme)
      ? (o.theme as AiDashboardTheme)
      : DEFAULT_THEME,
    kpis,
    charts,
  };
}
