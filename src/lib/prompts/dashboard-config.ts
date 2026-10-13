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

export type AiChartType =
  | "bar"
  | "line"
  | "hbar"
  | "pie"
  | "roster"
  | "list"
  | "ranking"
  | "wordcloud"
  | "scatter";

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
  /** 占几列（1..gridCols），= gridCols 即整行通栏；默认 1。旧配置 span=2 在 2 列下仍通栏，向后兼容。 */
  span?: 1 | 2 | 3 | 4;
  note?: string;
  /** 排行榜 ranking：按哪个字段排名次（缺省回退 field） */
  sortField?: string;
  /** 排行榜 ranking：榜单上显示谁（缺省回退 sortField）；散点 scatter：hover 标签 */
  labelField?: string;
  /** 排行榜 ranking：升降序，默认 desc（高分在前） */
  order?: "desc" | "asc";
  /** 散点 scatter：X 轴字段 */
  xField?: string;
  /** 散点 scatter：Y 轴字段 */
  yField?: string;
}

/** 图表栅格列数（白名单 2/3/4，默认 2） */
export type AiDashboardGridCols = 2 | 3 | 4;

export interface AiDashboardConfig {
  title?: string;
  subtitle?: string;
  theme?: AiDashboardTheme;
  /** 图表栅格一行放几个图（默认 2） */
  gridCols?: AiDashboardGridCols;
  kpis?: AiDashboardKpi[];
  charts?: AiDashboardChart[];
}

/**
 * 「提交时间」虚拟字段名：映射到 QfRecordItem.submittedAt（记录元数据，不在 data 内）。
 * ⚠️ GOTCHA：前端字段下拉（page.tsx）、渲染端 collectValues / 排行榜取值（QuickFormAiDashboard）、
 * 后端 sanitize 白名单（route.ts PUT）三处必须共用这个名字，否则选了「提交时间」会被 sanitize
 * 当作「不在白名单」整条丢弃 → 排行榜/图表消失（历史 bug：用户选「提交时间」做排行榜不显示）。
 * ⛔ DO NOT REVERT：这是让「提交时间」能被编辑/保存/渲染的关键契约。
 */
export const SUBMITTED_AT_FIELD = "提交时间";

const ALLOWED_AGGS: AiDashboardKpi["agg"][] = ["count", "unique", "avg", "sum", "max", "min"];
const ALLOWED_TYPES: AiChartType[] = [
  "bar",
  "line",
  "hbar",
  "pie",
  "roster",
  "list",
  "ranking",
  "wordcloud",
  "scatter",
];
const ALLOWED_GRID_COLS: AiDashboardGridCols[] = [2, 3, 4];

/** 最多发给 AI 的字段数（控上下文） */
const MAX_FIELDS = 20;
/** 每个字段最多带的 Top 取值数（控上下文） */
const MAX_TOP = 8;
/** 图表卡片数量上限（AI 生成截断 & 编辑器添加按钮共用） */
export const MAX_CHARTS = 12;

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

/* ------------------------------ 兜底图表生成 ------------------------------ */

/** 「标识类」字段名提示（与 QuickFormDashboard.IDENTIFIER_KEY_HINTS 保持一致，改时同步两处） */
const IDENTIFIER_KEY_HINTS = [
  "姓名",
  "名字",
  "学号",
  "学籍",
  "昵称",
  "name",
  "学生",
  "成员",
  "参与人",
  "报名人",
];

function isIdentifierName(name: string): boolean {
  const lower = name.toLowerCase();
  return IDENTIFIER_KEY_HINTS.some((h) => lower.includes(h.toLowerCase()));
}

/**
 * 兜底：AI 在「数据很少」时可能只返回 KPI、charts 为空（历史上 prompt 曾写「宁可只给 KPI」），
 * 直接落库会导致大屏出现「没有可渲染的图表」空态，且老师点「编辑」进去也没有图表可修（死循环）。
 * 这里据字段摘要自动生成基础图表，保证 charts 非空。字段名即摘要里的真实 key，前端可直接匹配。
 * ⛔ DO NOT REVERT：这是「AI 重排后点编辑出现空态」的兜底修复，删掉会退回空态死循环。
 */
export function buildFallbackCharts(summaries: FieldSummary[]): AiDashboardChart[] {
  const charts: AiDashboardChart[] = [];
  // 标识字段（姓名/学号）优先放最前做通栏名单，避免被 slice 截断
  for (const s of summaries) {
    if (isIdentifierName(s.name)) {
      charts.push({ title: s.name, field: s.name, type: "roster" });
    }
  }
  for (const s of summaries) {
    if (isIdentifierName(s.name)) continue;
    if (s.type === "number") {
      charts.push({ title: s.name, field: s.name, type: "bar", limit: 8 });
    } else if (s.type === "option") {
      charts.push({
        title: s.name,
        field: s.name,
        type: s.unique <= 4 ? "pie" : "hbar",
        limit: 8,
      });
    } else if (s.type === "multi") {
      charts.push({ title: s.name, field: s.name, type: "hbar", limit: 8 });
    } else {
      charts.push({ title: s.name, field: s.name, type: "wordcloud", limit: 12 });
    }
  }
  return charts.slice(0, MAX_CHARTS);
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
- ranking  排行榜（按某字段值给个体排名，如按分数排榜单，通栏展示）
- wordcloud 词云（适合自由文本 / 多选的视觉化，词越大出现越多）
- scatter  散点图（两个数值字段的相关性，如「练习时长 × 得分」）

【KPI 指标（大屏顶部的统计数字卡）】
KPI 给 3~4 个，每个含三要素：label（指标名，≤6 字）、field（统计的字段名；null 表示统计「全部提交」）、agg（聚合方式）。
agg 六种语义：
- count  计数：field=null → 提交总人数；field=某字段 → 该字段填写人次
- unique 去重个数
- avg    均值（仅数值字段）
- sum    求和（仅数值字段）
- max    最大值（仅数值字段）
- min    最小值（仅数值字段）
默认：先给「提交总人数」（field=null, agg=count），再按数值字段补 1~2 个均值/最值，最后可用高频选项计数收尾。
⚠️ 若老师额外要求里带了【KPI 硬约束】（出现在用户消息里），必须逐一兑现：每个指定的 agg 都要有对应 KPI、放在靠前位置，label 沿用老师原词（≤6 字）。

【输出格式】只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字：
{
  "title": "大屏标题（不超过 12 字）",
  "subtitle": "一句话副标题（不超过 30 字）",
  "theme": "blue",
  "gridCols": 4,
  "kpis": [ { "label": "指标名（不超过 6 字）", "field": "字段名或 null", "agg": "count" } ],
  "charts": [
    { "title": "卡片标题", "field": "字段名", "type": "bar", "limit": 8, "span": 1, "note": "一句话解读" },
    { "title": "分数排行", "type": "ranking", "field": "分数", "sortField": "分数", "labelField": "姓名", "order": "desc" },
    { "title": "时长×得分", "type": "scatter", "xField": "练习时长", "yField": "分数", "labelField": "姓名" },
    { "title": "关键词", "type": "wordcloud", "field": "自由文本字段" }
  ]
}

【布局是关键 —— 排版设计原则】
1. gridCols 决定一行放几个图（2 / 3 / 4）。字段少（≤3 个）用 2；中等（4~6 个）用 3 或 4；老师点名"一行四个"就用 4。省略时按字段数量自选。
2. span 表示该图占几列（1..gridCols）。span=gridCols 即整行通栏（主视觉，留给最重要、最抓眼球的图，最多 1 个通栏）；其余填 1（或 2 表示占半行）。每行 span 之和凑到 gridCols 就自动换行。
3. 图表组合要有节奏：一张通栏主视觉 + 若干不同图型的小卡（bar/pie/hbar/list 混搭，避免全是同一种图型）。
4. 名单（roster）永远通栏展示（引擎自动处理，无需给它 span）；数值字段优先 bar；取值 3~4 种的选项用 pie、5 种以上用 hbar；自由文本用 list。
5. 标题和解读要像大屏文案：短、有洞察（如"姓名分布"不如"他们是谁"），但不许夸张编造结论。

【特殊图型的字段约束】
- ranking：sortField 填「排名次的字段」（必须数值，如分数）；labelField 填「显示谁的字段」（姓名/学号等标识字段）。两个都要给。
- scatter：xField、yField 填两个不同的数值字段；labelField 可选（hover 显示标识）。
- wordcloud：field 只填自由文本或低基数多选字段；选项题（3~4 种）优先用 pie/hbar，不要用词云。

【硬性规则】
1. field 必须是字段摘要中出现过的字段名，禁止编造；field 为 null 表示统计全部提交。
2. kpis 给 3~4 个；charts 给 2~10 个。
3. 数据很少（仅 1~2 条）时减少图表数量，但**至少保留 1 个简单图表**（如「名单」或「数值柱状」）；KPI 照给，禁止返回空 charts。
4. 若老师给了额外要求，在不违反以上规则的前提下优先满足。
5. 绝不输出 HTML、脚本或样式，只输出 JSON。`;

/* ------------------------------ KPI 意图关键词预判（方案 B） ------------------------------ */

/**
 * 老师在「自定义要求」输入框里的口语化指标 → 对应聚合方式。
 * 只做「agg 类型」粗判，具体字段仍交给 AI 按字段摘要挑选 —— 但这层强约束让
 * 「平均分→avg」「提交人数→count」「最高分→max」这类映射不再依赖 AI 瞎猜。
 * ⚠️ 词序有讲究：「提交人数」排在「人数」之前，保证长词先命中语义更准。
 */
const KPI_AGG_KEYWORDS: { agg: AiDashboardKpi["agg"]; words: string[] }[] = [
  { agg: "avg", words: ["平均", "均值", "均分"] },
  { agg: "max", words: ["最高", "最大", "最多"] },
  { agg: "min", words: ["最低", "最小", "最少"] },
  { agg: "sum", words: ["总和", "合计", "总分", "总得分", "加总"] },
  { agg: "count", words: ["提交人数", "人数", "多少人", "提交数"] },
  { agg: "unique", words: ["去重", "种类", "多少种", "不同取值", "种类数"] },
];

/** 识别老师点名的 KPI 聚合意图（按表序、去重）。空指令 / 没命中 → 空数组。 */
export function detectKpiAggIntents(instruction: string): AiDashboardKpi["agg"][] {
  if (!instruction) return [];
  const out: AiDashboardKpi["agg"][] = [];
  for (const { agg, words } of KPI_AGG_KEYWORDS) {
    if (out.includes(agg)) continue;
    if (words.some((w) => instruction.includes(w))) out.push(agg);
  }
  return out;
}

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
 * 字段名归一化：只保留中日韩文字、字母、数字（其余标点/符号/空白全去掉），转小写。
 * ⚠️ GOTCHA：quickform 的字段 key 常带全角标点（如「总分：」「第1题（24 + 37 =）」）。
 * AI 输出 field 时会把末尾「：」当成格式分隔符丢掉（写「总分」），严格 Set.has 匹配不上
 * → chart 被整条丢弃 → 大屏被判「无可用图表」。归一化后「总分：」↔「总分」可互认。
 * 注意：题目类字段（「第1题（24+37=）」）归一化后是「第1题2437」，AI 若只写「第1题」
 * 不会误匹配（主体不同），这是期望行为。
 * 实现用「保留白名单」而非「删除标点清单」：避免枚举不全（全角冒号/括号/数学符号等），
 * 也避免 \p{...} Unicode 属性转义需要 es6+ target（本项目 target 默认 es5，\p 会报 TS1501）。
 */
function normalizeFieldName(s: string): string {
  return s.replace(/[^\u3400-\u9FFF\u3040-\u30FFa-zA-Z0-9]/g, "").toLowerCase();
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
  // 归一化字段名 → 真实 key 的兜底映射：AI 常丢掉字段名里的全角标点（见 normalizeFieldName），
  // 精确匹配不上时用它找回真实 key，避免合法图表被整条丢弃。
  const validByNorm = new Map<string, string>();
  for (const f of validFields) validByNorm.set(normalizeFieldName(f), f);
  const resolveField = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const t = raw.trim();
    if (!t) return null;
    if (valid.has(t)) return t; // 精确匹配优先，命中即原样返回
    return validByNorm.get(normalizeFieldName(t)) ?? null;
  };
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // 栅格列数：白名单 2/3/4，默认 2（旧配置无此字段回退 2 列，向后兼容）
  const gridColsRaw = Number(o.gridCols);
  const gridCols: AiDashboardGridCols = ALLOWED_GRID_COLS.includes(gridColsRaw as AiDashboardGridCols)
    ? (gridColsRaw as AiDashboardGridCols)
    : 2;

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
      const field = resolveField(it.field);
      kpis.push({ label, field, agg });
      if (kpis.length >= 4) break;
    }
  }

  const charts: AiDashboardChart[] = [];
  if (Array.isArray(o.charts)) {
    for (const item of o.charts) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const type = ALLOWED_TYPES.includes(it.type as AiChartType) ? (it.type as AiChartType) : "bar";
      // 占列数：夹到 1..gridCols（=gridCols 即通栏；旧配置 span=2 在 2 列下仍通栏）
      const spanRaw = Number(it.span);
      const span = (Number.isFinite(spanRaw)
        ? (Math.min(gridCols, Math.max(1, Math.round(spanRaw))) as 1 | 2 | 3 | 4)
        : 1);

      // 散点图：需要 xField / yField 两个数值字段（field 可为空，此处回退 xField 仅作兼容）
      if (type === "scatter") {
        const xField = resolveField(it.xField);
        const yField = resolveField(it.yField);
        // 降级兜底：AI 输出 scatter 但没给全 xField/yField 时，若 field 有效则退化为 bar，
        // 避免把整条丢弃（宁可少一种图，也不让配置被判「无可用图表」）。
        if (!xField || !yField || xField === yField) {
          const fbField = resolveField(it.field);
          if (!fbField) continue;
          charts.push({
            title: clampStr(it.title, 14) || fbField,
            field: fbField,
            type: "bar",
            span,
            note: clampStr(it.note, 30),
          });
          if (charts.length >= MAX_CHARTS) break;
          continue;
        }
        const labelField = resolveField(it.labelField) ?? undefined;
        charts.push({
          title: clampStr(it.title, 14) || `${xField} × ${yField}`,
          field: xField,
          type,
          span,
          note: clampStr(it.note, 30),
          xField,
          yField,
          labelField,
        });
        if (charts.length >= MAX_CHARTS) break;
        continue;
      }

      let field = resolveField(it.field);
      // ⚠️ ranking 的 field 缺省回退 sortField：AI 可能只给 sortField/labelField 而漏掉 field，
      // 若仍判 field 必填会把合法榜单整条丢弃（「AI 未返回可用图表配置」的诱因之一）。
      if (!field && type === "ranking") {
        field = resolveField(it.sortField);
      }
      if (!field) continue;
      const limitRaw = Number(it.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(3, Math.round(limitRaw))) : 8;
      const sortField = resolveField(it.sortField) ?? undefined;
      const labelField = resolveField(it.labelField) ?? undefined;
      const order = it.order === "asc" ? "asc" : "desc";
      charts.push({
        title: clampStr(it.title, 14) || field,
        field,
        type,
        limit,
        span,
        note: clampStr(it.note, 30),
        sortField: type === "ranking" ? sortField : undefined,
        labelField: type === "ranking" ? labelField : undefined,
        order: type === "ranking" ? order : undefined,
      });
      if (charts.length >= MAX_CHARTS) break;
    }
  }

  return {
    title: clampStr(o.title, 16),
    subtitle: clampStr(o.subtitle, 40),
    theme: ALLOWED_THEMES.includes(o.theme as AiDashboardTheme)
      ? (o.theme as AiDashboardTheme)
      : DEFAULT_THEME,
    gridCols,
    kpis,
    charts,
  };
}

/* ------------------------------ 修订模式（在当前配置上小幅修改，方案 A） ------------------------------ */

/**
 * 修订模式附录：拼在 DASHBOARD_SYSTEM_PROMPT 后，约束 AI 只改老师指令提到的部分，
 * 未提及的卡片原样保留 —— 这是「自然语言编辑」区别于「整屏重排」的关键。
 */
const DASHBOARD_REVISE_APPENDIX = `

【修订模式规则】用户消息里带了【当前大屏配置】，本次是在现有配置上做**小幅修订**：
1. 未被老师修改指令提到的卡片，必须原样保留（标题/字段/图型/limit/span/note/顺序都不变），禁止整屏重新设计。
2. 只执行指令明确提到的修改：换主题色、移动某卡片位置、删除某卡片、修改标题或图型、按指令新增卡片。
3. 老师说"重新排布 / 重新设计 / 推倒重来"时才允许整体调整布局。
4. 其余规则（字段白名单、图型约束、输出格式）照常生效，只输出修订后的完整 JSON 配置。`;

/** 生成系统提示词；revise 模式在原版后追加修订规则 */
export function buildDashboardSystemPrompt(mode: "create" | "revise" = "create"): string {
  return mode === "revise"
    ? DASHBOARD_SYSTEM_PROMPT + DASHBOARD_REVISE_APPENDIX
    : DASHBOARD_SYSTEM_PROMPT;
}

/* ------------------------------ 本地快速指令（不耗 AI 的简单编辑，方案 C） ------------------------------ */

/** 主色别名 → theme（口语词，如「青色」「琥珀」） */
const QUICK_THEME_COLORS: { theme: AiDashboardTheme; label: string; words: string[] }[] = [
  { theme: "blue", label: "品牌蓝", words: ["蓝"] },
  { theme: "teal", label: "青色", words: ["青"] },
  { theme: "green", label: "绿色", words: ["绿"] },
  { theme: "amber", label: "琥珀", words: ["琥珀", "橙", "黄"] },
];

/** 图型中文名 → type：关键词匹配不到标题时用图型名兜底（如「删掉词云」） */
const QUICK_TYPE_WORDS: { type: AiChartType; label: string }[] = [
  { type: "ranking", label: "排行榜" },
  { type: "wordcloud", label: "词云" },
  { type: "bar", label: "柱状图" },
  { type: "line", label: "折线图" },
  { type: "hbar", label: "条形图" },
  { type: "pie", label: "饼图" },
  { type: "roster", label: "名单" },
  { type: "scatter", label: "散点图" },
  { type: "list", label: "标签列表" },
];

/** 与 normalizeFieldName 同口径的模糊包含（双向）：「分数排行榜」↔「分数排行」可互认 */
function quickIncludes(a: string, b: string): boolean {
  const na = normalizeFieldName(a);
  const nb = normalizeFieldName(b);
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na));
}

/** 找 charts 里命中的卡片下标：先标题/字段名双向包含，再用图型中文名兜底 */
function findQuickChartTargets(charts: AiDashboardChart[], keyword: string): number[] {
  const byText = charts
    .map((_, i) => i)
    .filter((i) => quickIncludes(charts[i].title, keyword) || quickIncludes(charts[i].field, keyword));
  if (byText.length) return byText;
  for (const { type, label } of QUICK_TYPE_WORDS) {
    if (quickIncludes(label, keyword)) {
      const byType = charts.map((c, i) => (c.type === type ? i : -1)).filter((i) => i >= 0);
      if (byType.length) return byType;
    }
  }
  return [];
}

/** 找 kpis 里命中的下标（按 label 模糊匹配） */
function findQuickKpiTargets(kpis: AiDashboardKpi[], keyword: string): number[] {
  return kpis.map((_, i) => i).filter((i) => quickIncludes(kpis[i].label, keyword));
}

/** 清理指令里的指代词，留下卡片关键词：「把这个词云」→「词云」 */
function stripQuickKeyword(raw: string): string {
  return raw
    .replace(/^(?:把|将|这|那)(?:个|张|块|项)?/, "")
    .replace(/(?:这|那)(?:个|张|块|项)$/, "")
    .trim();
}

/** 解析出的主题色核心词（如「换成青色」→「青」）；整段不像换色短语时返回 null */
function matchQuickTheme(seg: string): { theme: AiDashboardTheme; label: string } | null {
  const core = seg
    .replace(/^(?:把|将)?(?:主题|主色|配色|色调|风格)?(?:换成?|改为?|调成为?|调成|设为?|设置成?|用|要)/, "")
    .replace(/(?:色系|色调|主题|风格)$/, "")
    .replace(/色$/, "");
  if (core === seg || !core) return null; // 没剥掉任何动词/后缀 = 不是换色短语
  const hit = QUICK_THEME_COLORS.find((t) => t.words.some((w) => core === w));
  return hit ? { theme: hit.theme, label: hit.label } : null;
}

/** 对单个指令片段执行本地修改；返回人话描述（如「主色换为青色」），不认识返回 null */
function applyOneQuickEdit(config: AiDashboardConfig, seg: string): string | null {
  const s = seg.trim();
  if (!s || s.length > 24) return null;

  // 1) 换主题色（整段必须是换色短语，避免把「绿色的分布」这类普通句子误当换色）
  const themeHit = matchQuickTheme(s);
  if (themeHit) {
    config.theme = themeHit.theme;
    return `主色换为${themeHit.label}`;
  }

  // 2) 移位：「X 放最前 / X 放最后」（先 charts，后 kpis）
  const moveFront = s.match(
    /^(.+?)(?:卡片|图|图表)?放(?:在|到|至)?(?:第?一(?:位|名)?|最前(?:面)?|首位|开头|前面)$/
  );
  const moveEnd = s.match(/^(.+?)(?:卡片|图|图表)?放(?:在|到|至)?(?:最后|末尾|末位|最后面)$/);
  if (moveFront || moveEnd) {
    const keyword = stripQuickKeyword((moveFront ? moveFront[1] : moveEnd![1]) || "");
    if (!keyword) return null;
    const toFront = Boolean(moveFront);
    const chartTargets = findQuickChartTargets(config.charts || [], keyword);
    if (chartTargets.length > 0) {
      const charts = [...(config.charts || [])];
      const moved = chartTargets.map((i) => charts[i]);
      const rest = charts.filter((_, i) => !chartTargets.includes(i));
      config.charts = toFront ? [...moved, ...rest] : [...rest, ...moved];
      return `「${moved.map((c) => c.title).join("」「")}」已移到${toFront ? "最前" : "最后"}`;
    }
    const kpiTargets = findQuickKpiTargets(config.kpis || [], keyword);
    if (kpiTargets.length > 0) {
      const kpis = [...(config.kpis || [])];
      const moved = kpiTargets.map((i) => kpis[i]);
      const rest = kpis.filter((_, i) => !kpiTargets.includes(i));
      config.kpis = toFront ? [...moved, ...rest] : [...rest, ...moved];
      return `「${moved.map((k) => k.label).join("」「")}」已移到${toFront ? "最前" : "最后"}`;
    }
    return null; // 找不到卡片 → 交给 AI 修订
  }

  // 3) 删除：「删掉X / X删掉 / X不要了」（charts 不能删光，否则大屏空态）
  const delMatch =
    s.match(/^删(?:掉|除|去)(?:这(?:个|张|块))?(.+)$/) ||
    s.match(/^去(?:掉|除)(?:这(?:个|张|块))?(.+)$/) ||
    s.match(/^(.+?)(?:这(?:个|张|块))?(?:给)?删(?:掉|除|去)$/) ||
    s.match(/^(.+?)(?:这(?:个|张|块))?不要(?:了|这个|这张)$/);
  if (delMatch) {
    const keyword = stripQuickKeyword(delMatch[1] || "");
    if (!keyword) return null;
    const chartTargets = findQuickChartTargets(config.charts || [], keyword);
    if (chartTargets.length > 0) {
      if ((config.charts?.length || 0) - chartTargets.length === 0) return null;
      const removed = chartTargets.map((i) => config.charts![i]);
      config.charts = (config.charts || []).filter((_, i) => !chartTargets.includes(i));
      return `已删除「${removed.map((c) => c.title).join("」「")}」`;
    }
    const kpiTargets = findQuickKpiTargets(config.kpis || [], keyword);
    if (kpiTargets.length > 0) {
      if ((config.kpis?.length || 0) - kpiTargets.length === 0 && (config.charts?.length || 0) === 0)
        return null;
      const removed = kpiTargets.map((i) => config.kpis![i]);
      config.kpis = (config.kpis || []).filter((_, i) => !kpiTargets.includes(i));
      return `已删除「${removed.map((k) => k.label).join("」「")}」`;
    }
    return null;
  }

  return null; // 其他片段 → 交给 AI 修订
}

/**
 * 方案 C：本地快速指令 —— 换色 / 移位 / 删除这类确定性修改直接在本地改配置，不耗 AI。
 * 指令按标点拆成片段，**全部片段**都认识才执行（返回新配置 + 应用描述）；
 * 只要有一个片段不认识，返回 null → 整条交给 AI 修订模式（避免半本地半 AI 的不一致）。
 */
export function applyQuickEdits(
  config: AiDashboardConfig,
  instruction: string
): { config: AiDashboardConfig; applied: string[] } | null {
  const text = (instruction || "").trim();
  if (!text || text.length > 60) return null;
  const segments = text
    .split(/[，,。;；、！!？?\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;
  const next: AiDashboardConfig = JSON.parse(JSON.stringify(config));
  const applied: string[] = [];
  for (const seg of segments) {
    const done = applyOneQuickEdit(next, seg);
    if (!done) return null;
    applied.push(done);
  }
  return { config: next, applied };
}
