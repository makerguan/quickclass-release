/**
 * 学情分析提示词统一管理 - 模板驱动架构
 *
 * 核心变化（2026-05-03）：
 * - 删除硬编码的 ANALYST_SYSTEM、CLASS_OUTLINE、STUDENT_OUTLINE、getWordLimitPrompt
 * - 模板内容由数据库 InsightTemplate 表提供，或由教师自定义
 * - 约束（星星评分、字数限制）通过 buildConstraintsSection 独立追加
 * - 数据内容（对话记录 / 已存在报告）由软件自动注入，模板不需要写 {dialogContents} 等变量
 *
 * 提示词结构顺序：
 *   教师自定义模板（只有分析方法和输出格式）
 *   ↓
 *   数据内容（软件自动追加，根据 insightDataSource 决定用对话还是已有报告）
 *   ↓
 *   约束条件（星星评分、字数限制）
 */

import type { BuildConversationClassParams, BuildConversationStudentParams, BuildTaskClassParams, BuildTaskStudentParams, InsightConfig } from "./insight-old";

// ─────────────────────────────────────────────
// 0. 约束结构定义
// ─────────────────────────────────────────────

export interface InsightConstraints {
  /**
   * 指数评价开关。true = 学生分析只输出 6-10 个 ★、不写报告正文
   * （产品决策 2026-10-11 用户拍板："无论网页版还是文本版，启用指数就只算星星"）。
   * ⛔ DO NOT ADD REPORT GENERATION BACK WHEN THIS IS TRUE。
   */
  requireStarRating: boolean;
  studentWordLimit?: number | null;
  classWordLimit?: number | null;
  /** 生成 HTML 输出时跳过字数限制和 Markdown 格式约束（requireStarRating=true 时整段短路，不生效） */
  isHtmlOutput?: boolean;
}

/** 根据系统配置获取默认约束 */
export function getDefaultConstraints(config: {
  requireStarRating?: boolean;
  studentWordLimit?: number | null;
  classWordLimit?: number | null;
  isHtmlOutput?: boolean;
}): InsightConstraints {
  return {
    requireStarRating: config.requireStarRating ?? false,
    studentWordLimit: config.studentWordLimit ?? null,
    classWordLimit: config.classWordLimit ?? null,
    isHtmlOutput: config.isHtmlOutput ?? false,
  };
}

/**
 * 📐 CONTRACT：图表输出协议（分析 AI 侧的唯一注入点）
 *
 * 为什么：渲染端 src/lib/report-charts.ts 的 CHART_RE 只认 ```chart 围栏块 +
 * {"type":"...","data":[{"name","value"}]} 格式（写库前 cleanInsightContent 渲染成确定性 SVG）。
 * 历史 bug（2026-10-11）：分析 AI 收不到协议 → 按训练语料里的 ECharts 习惯自发输出
 * {"chart":"pie","data":{"categories":[..],"values":[..]}} 裸 JSON 行 → 渲染失败，报告里出现 JSON 源码。
 *
 * ⛔ DO NOT CHANGE FORMAT WITHOUT SYNCING report-charts.ts 的 validateChartSpec：
 * type 枚举、data 形状（name/value 数组、scatter 的 x/y）与校验器逐字对应，改一处必须同步另一处。
 * 🔗 RELATED：写作端模板协议说明 src/lib/template-writing-guide.ts（第 6/7 条）；
 * 渲染管线 src/lib/insight-clean.ts（processChartBlocks）。
 */
const CHART_PROTOCOL_SECTION = (htmlMode: boolean): string => `## 图表输出协议（强制）
仅当教师模板（"分析要求/输出要求"）明确要求报告插图时才画图；模板未要求插图时，禁止输出任何 chart 块或 JSON 图表代码。
要求插图时，图表一律用 \`\`\`chart 围栏块输出，其余任何图表格式一律禁止（禁止 ECharts option JSON、禁止裸 JSON 行、禁止图片链接、禁止 ASCII 画图）。一个图一个块，${htmlMode ? "嵌入 HTML 正文对应位置（渲染端会把围栏块替换成现成 SVG 图）" : "紧跟对应小节之后独立成段"}：
\`\`\`chart
{"type":"pie","title":"各层级人数占比","data":[{"name":"优秀","value":1},{"name":"待观察","value":20},{"name":"待提升","value":18}]}
\`\`\`
规则：
1. type 只能是：pie（占比）/ bar（对比）/ line（趋势）/ progress（达成度，value 取 0-100）/ radar（多维评估）/ scatter（两维分布，data 改用 {"name":"...","x":数值,"y":数值}）。
1a. radar 维度必须 3-8 个：维度多于 8 个时先把逐题/逐项数据按知识维度归并（如 15 道题按考查知识点归并成 4-6 个维度）再画；超过 12 维渲染端会直接降级为表格，图就没了（2026-10-11 实测：15 题逐题进 radar → 「雷达图维度超过 12 个」降级）。
2. data 必须是 {"name":"类目","value":数值} 数组，数值必须取自本提示词注入的真实数据变量，禁止编造、估算不存在的数据。
3. 图标题写进 JSON 的 title 字段，正文不要再写"图1 xxx"标题行，也不要在图后重复罗列同一份数据；数值单位用 style:{"unit":"分"}，低于某值预警用 style:{"warnBelow":60}。`;

/**
 * 📐 CONTRACT：图表意图检测词表（text 报告线共享，学情分析 + 作业分析 + 探究分析三线同一口径）
 *
 * 意图词表宁宽勿严：漏判会让"要求插图"的模板收到画图禁令（直接不画图，后果更糟）；
 * 误判无害——协议首句有"仅当模板明确要求插图时才画图"守卫。
 *
 * ⚠️ GOTCHA：词表里的英文 chart 是给手写/历史模板兜底的。作业/探究分析线帮写产物必须
 * 纯中文（buildAnalysisWritingRules 已严禁英文 chart/html 字样）——因为那两条生成路由的
 * isHtmlOutput 用 includes('chart') 嗅探模板正文，模板含英文 chart 会被误判为网页型输出，
 * 与模板要求的 Markdown 形态错乱。中文意图词（雷达图/饼图/柱状图等）均不含嗅探子串
 * （嗅探词是「图表协议」四字连排，不是「图表」二字），安全。
 */
export const CHART_INTENT_RE =
  /chart|图表|插图|配图|画图|画一张|绘制|饼图|柱状图|折线图|雷达图|散点图|趋势图|进度条/i;

/** text 报告未要求插图时的画图禁令（防分析 AI 自发画图输出系统不认识的 JSON 图表原文，历史 bug 见 CHART_PROTOCOL_SECTION 注释） */
const TEXT_CHART_BAN_SECTION = `## 图表输出禁令\n本报告为纯文本 Markdown 格式，数据一律以 Markdown 表格呈现，禁止输出 chart 数据块或任何 JSON 图表代码。`;

/**
 * text（纯文本 Markdown）报告的图表策略段：按模板正文是否含图表意图词分流。
 * 要求插图 → 注入 chart 协议（分析 AI 输出 ```chart 块，写库前 cleanInsightContent
 * 渲染成确定性 SVG，前端 Markdown 组件直出雷达图等，qc-chart 白名单放行）；
 * 未要求 → 注入画图禁令。不传模板视为未要求（老兼容链路安全）。
 *
 * 🔗 RELATED：学情线 buildConstraintsSection 内部复用；作业/探究分析线
 * quiz-activities/[id]/report/generate 与 exploration-activities/[id]/analysis/generate
 * 的 text outputFormat 分支直接调用（html 分支不走这里，网页型由 CHART_PROTOCOL_SECTION(true) 覆盖）。
 */
export function buildChartPolicySection(templateContent?: string): string {
  const wantsCharts = !!templateContent && CHART_INTENT_RE.test(templateContent);
  return wantsCharts ? CHART_PROTOCOL_SECTION(false) : TEXT_CHART_BAN_SECTION;
}

/**
 * 学生分析的"指数模式"强约束段（只输出 ★，不写报告）。
 * 📐 CONTRACT：单一定义，buildConstraintsSection 两处引用（顶部短路 + 非 HTML 分支），
 * 改星星数量区间/措辞必须改这一处，禁止复制字面量。
 *
 * ⚠️ GOTCHA（2026-10-11 实测）：HTML 型模板正文写着"生成 HTML 可视化报告"时，
 * 仅靠"只输出星星、禁止其他文字"会被模板正文压过——AI 仍生成 9000 字符完整报告。
 * 必须显式声明"忽略上文模板的输出格式要求 + 本规则最高优先级"，实测才服从。
 */
const STAR_ONLY_SECTION = `## 评分输出规则（最高优先级，强制）
本次只做指数评分，不生成任何报告。
1. 忽略上文模板中关于输出形态的一切要求（包括"生成 HTML 网页报告/网页文件/图表"等），模板内容只作为评分维度参考
2. 你的全部输出必须只有一行五角星（★），数量 6-10 个，例如：★★★★★★（6个星）到 ★★★★★★★★★★（10个星）
3. 禁止输出 HTML、Markdown、JSON、解释文字、标题、换行说明等任何其他内容
4. 星星数量代表本次对话整体表现评分`;

/**
 * 根据约束类型构建约束段落（追加到提示词末尾）
 * 当 isHtmlOutput 为 true 时，跳过字数限制和输出格式约束
 *
 * 指数模式（type=student 且 requireStarRating=true）在最前面短路返回 STAR_ONLY_SECTION：
 * HTML 分支与报告/字数/格式约束全部跳过——产品决策（2026-10-11 用户拍板）：
 * "无论网页版还是文本版，启用指数就只算星星，不写报告"。
 * 实测（2026-10-11）：此前 HTML 模板 + 指数模式仍生成 8998 字符完整 HTML 报告落库，
 * 而前端学情页在 requireStarRating=true 时隐藏正文展开区（tasks/[taskId]/insights/page.tsx
 * 学生行 isExpanded && !requireStarRating），报告生成即扔，浪费约 1-2 分钟/人。
 *
 * templateContent（可选）：教师模板原文，用于判断模板是否要求插图——
 * 要求 → 注入图表协议；未要求 → 注入自发画图禁令（分析 AI 有自发画图倾向，见 CHART_PROTOCOL_SECTION 注释）。
 * 不传时视为未要求（老兼容链路 getWordLimitPrompt 的硬编码模板均无图表概念，注入禁令安全）。
 *
 * 🔗 RELATED：前端指数解析 tasks/[taskId]/insights/page.tsx 与
 * preset-conversations/[id]/insights/route.ts GET 的 parseStarCount（从落库正文解析 ★）；
 * 前端正文隐藏条件 tasks/[taskId]/insights/page.tsx 学生行（指数模式仍只显示指数星）。
 */
export function buildConstraintsSection(
  type: "student" | "class",
  constraints: InsightConstraints,
  templateContent?: string
): string {
  // ⛔ DO NOT REVERT：指数模式必须先于 isHtmlOutput 分支短路。
  // 历史教训：此前 HTML 分支在指数模式下仍返回"报告 + 末尾★"约束，AI 生成
  // 8998 字符完整报告落库（库中 2026-10-11 前的 pc_student 记录可证），前端却
  // 只显示星星。现在短路后 AI 只输出一行 ★，落库即指数，parseStarCount 照常解析。
  if (type === "student" && constraints.requireStarRating) {
    return STAR_ONLY_SECTION;
  }

  if (constraints.isHtmlOutput) {
    // HTML 输出跳过字数/Markdown 约束，但图表协议必须注入：
    // HTML 型模板未必带示例块，AI 仍会自发画图，协议是渲染成功的唯一保障
    // ⚠️ GOTCHA（2026-10-11）：星星评分不能跟着跳过——前端学生行指数由
    // parseStarCount(content) 从正文字面 ★ 实时解析（AIInsight 无 starCount
    // 落库字段），此前 HTML 分支整段 return 后，HTML 型模板的学生报告全部
    // 无 ★，课堂学情页学生行指数全空（对话活动链路 config 不传 isHtmlOutput
    // 故一直正常，仅课堂 HTML 型模板必现）。student 报告必须在可见位置附加
    // 一行纯文本 ★ 评分。
    // （2026-10-11 起 requireStarRating=true 时已在函数开头短路返回 STAR_ONLY_SECTION，
    // 本 HTML 分支只会被"HTML 模板 + 未启用指数"走到，报告+末尾★ 行为保持不变。）
    // 🔗 RELATED：tasks/[taskId]/insights/route.ts GET 的 parseStarCount、
    // preset-conversations/[id]/insights/route.ts GET 同名函数（同一解析口径）。
    const starSection = type === "student"
      ? `

## 评分输出规则（强制）
报告末尾（</body> 标签之前）必须附加一行可见的五角星评分，例如：★★★★★★（6 个）到 ★★★★★★★★★★（10 个）。
星星数量代表本次分析整体表现评分；这一行必须是纯文本 ★ 字符（禁止用 CSS、图标或图片实现），星星前后禁止添加说明文字。`
      : "";
    return CHART_PROTOCOL_SECTION(true) + starSection;
  }

  const parts: string[] = [];

  // 图表意图分流：要求插图 → 协议；没要求 → 禁令（防纯文本报告里出现系统不认识的 JSON 图表原文）
  parts.push(buildChartPolicySection(templateContent));

  // 星星评分约束（指数模式已在函数开头短路，这里 requireStarRating 恒为 false，
  // 保留原分支仅为类型完整性；约束文本与顶部短路共用 STAR_ONLY_SECTION 单一定义）
  if (type === "student") {
    if (constraints.requireStarRating) {
      parts.push(STAR_ONLY_SECTION);
    } else {
      parts.push(`## 评分输出规则\n学生分析报告末尾必须附加 6-10 个五角星（★）评分，例如：★★★★★★\n星星数量代表本次对话整体表现评分。`);
    }
  }

  // 字数限制（强制约束）
  if (type === "student" && constraints.studentWordLimit) {
    parts.push(`## 字数限制\n学生分析报告必须控制在 ${constraints.studentWordLimit} 字以内，禁止超出。`);
  } else if (type === "class" && constraints.classWordLimit) {
    parts.push(`## 字数限制\n班级分析报告必须控制在 ${constraints.classWordLimit} 字以内，禁止超出。`);
  }

  // 输出格式强制约束（通用）
  parts.push(`## 输出格式规则（强制）
1. 必须严格按教师模板中的分析方法和输出格式输出，禁止偏离
2. 直接输出分析内容，禁止添加"以下是分析报告"等开场白
3. 报告主体内容完成后不得追加额外说明`);

  return parts.join("\n\n");
}



// ─────────────────────────────────────────────
// 0.2 模板变量类型定义
// ─────────────────────────────────────────────

/** 对话活动层级的变量 */
export interface ConversationTemplateVars {
  pcTitle: string;
  pcDescription?: string;
  activeCount: number;
  totalStudents: number;
  studentName?: string;
  /** 个人对话记录 */
  personalDialogContents?: string;
  /** 学生个人对话分析报告汇总（间接数据：PC 层全班分析时注入本活动下各学生最新个人分析） */
  personalDialogAnalysisReport?: string;
  /** 课堂名称（来自 task.title） */
  taskTitle?: string;
  /** 课堂目标（= taskObjectives 的别名） */
  taskDescription?: string;
  /** 年级 */
  taskGrade?: string;
  /** 学科 */
  taskSubject?: string;
}

/** 课堂层级的变量 */
export interface TaskTemplateVars {
  taskTitle: string;
  taskObjectives: string;
  taskRequirements: string;
  knowledgeBase?: string;
  pcClassInsights: { pcTitle: string; content: string }[];
  pcStudentInsights: { studentName: string; pcTitle: string; content: string }[];
  useSubInsights: boolean;
  studentName?: string;
  presetCompletion?: string;
  rawData?: {
    students: { name: string; convCount: number; msgCount: number; completedPresets: number; totalPresets: number }[];
    recentQuestions: string;
    subProjectSummary: string;
  };
  /** 个人对话记录 */
  personalDialogContents?: string;
  /** 个人作业数据 */
  personalQuizStats?: string;
  /** 个人对话分析报告（格式化文本） */
  personalDialogAnalysisReport?: string;
  /** 班级对话分析报告（格式化文本） */
  classDialogAnalysisReport?: string;
  /** 全班作业数据 */
  classQuizStats?: string;
  /** 全班探究数据（完成率/探索时长/操作特征/探究结论） */
  classExplorationStats?: string;
  /** 个人探究数据（探索时长/关卡达成/操作路径/作答记录） */
  personalExplorationStats?: string;
  /** 课堂目标（= taskObjectives 的别名） */
  taskDescription?: string;
  /** 年级 */
  taskGrade?: string;
  /** 学科 */
  taskSubject?: string;
  /** 对话活动名称 */
  pcTitle?: string;
  /** 对话活动目标 */
  pcDescription?: string;
  /** 参与学生数 */
  activeStudents?: string;
  /** 班级总学生数 */
  totalStudents?: number;
}

// ─────────────────────────────────────────────
// 0.4 报告生成时间（时间唯一真源）
// ─────────────────────────────────────────────

/**
 * 服务器真实时间，注入模板 {reportTime} 占位符。
 * AI 不感知当前时间，报告中出现的时间只能来自此处，防止模型编造日期。
 */
export function getReportTime(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ─────────────────────────────────────────────
// 0.3 模板变量替换函数
// ─────────────────────────────────────────────

/**
 * 通用变量替换：支持 {varName} 格式
 */
export function replaceTemplateVars(
  template: string,
  vars: Record<string, string | number | boolean | undefined>
): string {
  return template.replace(/\{(\w+)\}/g, (match, varName) => {
    const value = vars[varName];
    if (value === undefined || value === null) {
      return ""; // 未匹配的变量替换为空
    }
    return String(value);
  });
}

/**
 * 对话活动变量替换（不含 dialogContents，由软件自动追加）
 */
export function replaceConversationVars(
  template: string,
  vars: ConversationTemplateVars,
  isStudent: boolean
): string {
  const base: Record<string, string | number> = {
    pcTitle: vars.pcTitle,
    pcDescription: vars.pcDescription || "",
    activeCount: vars.activeCount,
    totalStudents: vars.totalStudents,
    // 数据变量（模板引用）
    personalDialogContents: vars.personalDialogContents || "",
    personalDialogAnalysisReport: vars.personalDialogAnalysisReport || "",
    // 课堂信息变量
    taskTitle: vars.taskTitle || "",
    taskDescription: vars.taskDescription || vars.taskTitle ? (vars.taskDescription || "") : "",
    taskObjectives: vars.taskDescription || "",
    taskGrade: vars.taskGrade || "",
    taskSubject: vars.taskSubject || "",
    reportTime: getReportTime(),
  };

  if (isStudent) {
    base.studentName = vars.studentName || "";
  }

  return replaceTemplateVars(template, base);
}

/**
 * 课堂活动变量替换（不含 dialogContents，由软件自动追加）
 */
export function replaceTaskVars(template: string, vars: TaskTemplateVars): string {
  // 构建活跃学生列表
  let activeStudentsStr = "";
  if (vars.rawData?.students) {
    const activeStudentsList = vars.rawData.students.filter((s) => s.convCount > 0);
    activeStudentsStr = activeStudentsList.map((s) => s.name).join("、") || "无活跃学生";
  }

  // 构建原始数据字符串（不含对话内容，对话内容由软件自动追加）
  let rawDataStr = "";
  if (vars.rawData) {
    const activeStudentsList = vars.rawData.students.filter((s) => s.convCount > 0);
    const studentsDetail = activeStudentsList
      .map((s) => `${s.name}：${s.convCount}次对话，${s.msgCount}条消息`)
      .join("\n");
    rawDataStr = `## 班级学生对话情况\n${studentsDetail || "暂无对话记录"}\n\n## 学生近期提问\n${vars.rawData.recentQuestions || "暂无提问记录"}\n\n## 学习活动进展\n${vars.rawData.subProjectSummary}`;
  }

  return replaceTemplateVars(template, {
    taskTitle: vars.taskTitle || "",
    taskObjectives: vars.taskObjectives || "",
    taskDescription: vars.taskDescription || vars.taskObjectives || "",
    taskRequirements: vars.taskRequirements || "",
    taskGrade: vars.taskGrade || "",
    taskSubject: vars.taskSubject || "",
    knowledgeBase: vars.knowledgeBase || "",
    reportTime: getReportTime(),
    studentName: vars.studentName || "",
    presetCompletion: vars.presetCompletion || "",
    activeStudents: activeStudentsStr,
    totalStudents: vars.totalStudents ?? 0,
    pcTitle: vars.pcTitle || "",
    pcDescription: vars.pcDescription || "",
    recentQuestions: vars.rawData?.recentQuestions || "",
    subProjectSummary: vars.rawData?.subProjectSummary || "",
    rawData: rawDataStr,
    // 数据变量（模板引用）
    personalDialogContents: vars.personalDialogContents || "",
    personalQuizStats: vars.personalQuizStats || "",
    personalDialogAnalysisReport: vars.personalDialogAnalysisReport || "",
    classDialogAnalysisReport: vars.classDialogAnalysisReport || "",
    classQuizStats: vars.classQuizStats || "",
    classExplorationStats: vars.classExplorationStats || "",
    personalExplorationStats: vars.personalExplorationStats || "",
  });
}

// ─────────────────────────────────────────────
// 1. 模板渲染函数
// ─────────────────────────────────────────────

export interface TemplateRenderOptions {
  templateContent: string;
  vars: ConversationTemplateVars | TaskTemplateVars;
  level: "pc" | "task";
  isStudent: boolean;
  constraints: InsightConstraints;
}

/**
 * 渲染完整提示词：变量替换 + 约束追加
 *
 * 顺序：教师自定义模板 → 约束条件
 */
export function renderInsightTemplate(options: TemplateRenderOptions): string {
  const { templateContent, vars, level, isStudent, constraints } = options;

  // 变量替换
  let content: string;
  if (level === "pc") {
    content = replaceConversationVars(templateContent, vars as ConversationTemplateVars, isStudent);
    // 兜底：模板未引用 {personalDialogContents} 但确有对话数据时自动追加，防止空模板/缺占位符导致对话数据丢失
    const dlg = (vars as ConversationTemplateVars).personalDialogContents;
    if (dlg && !templateContent.includes("{personalDialogContents}")) {
      content += (content ? "\n\n" : "") + "## 学生对话数据\n" + dlg;
    }
  } else {
    content = replaceTaskVars(templateContent, vars as TaskTemplateVars);
    // 兜底：若有探究数据但模板未显式包含对应变量占位符，自动追加在数据段后，防止探究学情丢失
    const tVars = vars as TaskTemplateVars;
    if (isStudent && tVars.personalExplorationStats && !templateContent.includes("{personalExplorationStats}")) {
      content += (content ? "\n\n" : "") + "## 个人交互探究数据\n" + tVars.personalExplorationStats;
    } else if (!isStudent && tVars.classExplorationStats && !templateContent.includes("{classExplorationStats}")) {
      content += (content ? "\n\n" : "") + "## 全班交互探究数据\n" + tVars.classExplorationStats;
    }
  }

  // 追加约束条件（传原始模板原文供图表意图判断——渲染后的 content 已混入数据段，会误判关键词）
  const constraintSection = buildConstraintsSection(
    isStudent ? "student" : "class",
    constraints,
    templateContent
  );
  if (constraintSection) {
    content += "\n\n---\n\n" + constraintSection;
  }

  return content;
}

/**
 * 快捷函数：渲染对话活动班级提示词
 */
export function renderPCClassTemplate(
  templateContent: string,
  vars: ConversationTemplateVars,
  constraints: InsightConstraints,
): string {
  return renderInsightTemplate({
    templateContent,
    vars,
    level: "pc",
    isStudent: false,
    constraints,
  });
}

/**
 * 快捷函数：渲染对话活动学生提示词
 */
export function renderPCStudentTemplate(
  templateContent: string,
  vars: ConversationTemplateVars,
  constraints: InsightConstraints,
): string {
  return renderInsightTemplate({
    templateContent,
    vars,
    level: "pc",
    isStudent: true,
    constraints,
  });
}

/**
 * 快捷函数：渲染课堂班级提示词
 */
export function renderTaskClassTemplate(
  templateContent: string,
  vars: TaskTemplateVars,
  constraints: InsightConstraints,
): string {
  return renderInsightTemplate({
    templateContent,
    vars,
    level: "task",
    isStudent: false,
    constraints,
  });
}

/**
 * 快捷函数：渲染课堂学生提示词
 */
export function renderTaskStudentTemplate(
  templateContent: string,
  vars: TaskTemplateVars,
  constraints: InsightConstraints,
): string {
  return renderInsightTemplate({
    templateContent,
    vars,
    level: "task",
    isStudent: true,
    constraints,
  });
}

// ─────────────────────────────────────────────
// 2. 兼容层：旧 buildXxxPrompt 函数（逐步废弃）
// 为已存在的调用提供兼容，过渡期使用
// 新代码应直接使用 renderInsightTemplate
// ─────────────────────────────────────────────

/** @deprecated 请使用 renderPCClassTemplate */
export function buildConversationClassPrompt(params: BuildConversationClassParams): string {
  const { customSection, ...rest } = params;
  return renderPCClassTemplate(
    customSection || "",
    {
      pcTitle: params.pcTitle,
      pcDescription: params.pcDescription,
      activeCount: params.activeCount,
      totalStudents: params.totalStudents,
      // 旧参数映射到新变量（模板引用 {班级对话活动分析报告}）
      personalDialogContents: params.dialogContents || "",
      // 间接数据：学生个人对话分析报告汇总
      personalDialogAnalysisReport: params.personalDialogAnalysisReport || "",
      // 课堂信息变量
      taskTitle: params.taskInfo?.taskTitle,
      taskDescription: params.taskInfo?.taskObjectives,
      taskGrade: params.taskInfo?.grade,
      taskSubject: params.taskInfo?.subject,
    },
    {
      requireStarRating: params.config?.requireStarRating ?? false,
      studentWordLimit: null,
      classWordLimit: params.config?.classWordLimit || null,
      isHtmlOutput: params.config?.isHtmlOutput ?? false,
    },
  );
}

/** @deprecated 请使用 renderPCStudentTemplate */
export function buildConversationStudentPrompt(params: BuildConversationStudentParams): string {
  return renderPCStudentTemplate(
    params.customSection || "",
    {
      pcTitle: params.pcTitle,
      pcDescription: params.pcDescription,
      activeCount: params.activeCount ?? 1,
      totalStudents: params.totalStudents ?? 1,
      studentName: params.studentName,
      // 旧参数映射到新变量（模板引用 {个人对话活动分析报告}）
      personalDialogContents: params.dialogContent || "",
      // 课堂信息变量
      taskTitle: params.taskInfo?.taskTitle,
      taskDescription: params.taskInfo?.taskObjectives,
      taskGrade: params.taskInfo?.grade,
      taskSubject: params.taskInfo?.subject,
    },
    {
      requireStarRating: params.config?.requireStarRating ?? false,
      studentWordLimit: params.config?.studentWordLimit || null,
      classWordLimit: null,
    },
  );
}

/** @deprecated 请使用 renderTaskClassTemplate */
export function buildTaskClassPrompt(params: BuildTaskClassParams): string {
  return renderTaskClassTemplate(
    params.customSection || "",
    {
      taskTitle: params.taskTitle,
      taskObjectives: params.taskObjectives,
      taskDescription: params.taskInfo?.taskObjectives || params.taskObjectives,
      taskRequirements: params.taskRequirements,
      taskGrade: params.taskInfo?.grade,
      taskSubject: params.taskInfo?.subject,
      knowledgeBase: params.knowledgeBase,
      pcClassInsights: params.pcClassInsights,
      pcStudentInsights: params.pcStudentInsights,
      useSubInsights: params.useSubInsights,
      totalStudents: params.totalStudents ?? 0,
      rawData: params.rawData,
      // 旧参数映射到新变量
      personalDialogContents: params.dialogContents || "",
      personalQuizStats: params.quizStats || "",
      personalDialogAnalysisReport: params.personalDialogAnalysisReport || "",
      classDialogAnalysisReport: params.classDialogAnalysisReport || "",
      classQuizStats: params.classQuizStats || "",
      classExplorationStats: params.classExplorationStats || "",
    },
    {
      requireStarRating: params.config?.requireStarRating ?? false,
      studentWordLimit: null,
      classWordLimit: params.config?.classWordLimit || null,
      isHtmlOutput: params.config?.isHtmlOutput ?? false,
    },
  );
}

/** @deprecated 请使用 renderTaskStudentPrompt */
export function buildTaskStudentPrompt(params: BuildTaskStudentParams): string {
  return renderTaskStudentTemplate(
    params.customSection || "",
    {
      taskTitle: params.taskTitle,
      taskObjectives: params.taskObjectives,
      taskDescription: params.taskInfo?.taskObjectives || params.taskObjectives,
      taskRequirements: params.taskRequirements,
      taskGrade: params.taskInfo?.grade,
      taskSubject: params.taskInfo?.subject,
      knowledgeBase: params.knowledgeBase,
      pcClassInsights: [],
      pcStudentInsights: params.pcStudentInsights.map(p => ({
        studentName: p.studentName || "",
        pcTitle: p.pcTitle,
        content: p.content,
      })),
      useSubInsights: params.useSubInsights,
      studentName: params.studentName,
      presetCompletion: params.presetCompletion,
      // 旧参数映射到新变量（模板引用 {个人对话活动分析报告}）
      personalDialogContents: params.dialogContents || "",
      personalQuizStats: params.quizStats || "",
      classQuizStats: params.classQuizStats || "",
      personalExplorationStats: params.personalExplorationStats || "",
    },
    {
      requireStarRating: params.config?.requireStarRating ?? false,
      studentWordLimit: params.config?.studentWordLimit || null,
      classWordLimit: null,
      isHtmlOutput: params.config?.isHtmlOutput ?? false,
    },
  );
}

// ─────────────────────────────────────────────
// 3. 工具函数
// ─────────────────────────────────────────────

/**
 * 获取指定层级的默认模板分类
 */
export function getTemplateCategory(level: "pc" | "task", isStudent: boolean): string {
  if (level === "pc") {
    return isStudent ? "pc_student" : "pc_class";
  }
  return isStudent ? "task_student" : "task_class";
}

/**
 * 验证模板内容是否包含必要变量（防止教师写了空模板）
 */
export function validateTemplate(templateContent: string, level: "pc" | "task", isStudent: boolean): { valid: boolean; missingVars: string[] } {
  // 数据内容由软件自动注入，模板不需要写这些变量
  const requiredVars: string[] = level === "pc"
    ? (isStudent ? ["pcTitle", "studentName"] : ["pcTitle"])
    : (isStudent ? ["taskTitle", "studentName"] : ["taskTitle"]);

  const missingVars: string[] = [];
  for (const v of requiredVars) {
    if (!templateContent.includes(`{${v}}`)) {
      missingVars.push(v);
    }
  }

  return {
    valid: missingVars.length === 0,
    missingVars,
  };
}