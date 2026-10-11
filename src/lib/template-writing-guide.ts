/**
 * 模板写作知识库（"AI 帮我写模板"功能的生成规则源）
 *
 * 为什么：教师反馈"模板不怎么会写"，新增 AI 生成/优化模板能力。生成质量取决于
 * 注入的领域知识：变量清单（硬约束）、模板消费方式说明、写作骨架（目标导向）、
 * few-shot 范例。本文件把这些知识结构化，供 /api/analysis-templates/generate
 * 拼装 system prompt，并提供输出校验工具。
 *
 * ⚠️ GOTCHA：知识不来自运行时读仓库根目录的 .md 文档（教师模板修改指南.md /
 * 模板变量说明文档.md）——生产构建（next standalone）后根目录 .md 不保证存在，
 * 必须沉淀为代码常量。两份 .md 是给人看的教程，本文件是给 AI 看的浓缩规则。
 *
 * 📐 CONTRACT：变量清单是硬约束——生成结果中的 {变量} 必须全部在清单内，
 * 否则运行时替换为空字符串（分析 API 的 replace*Vars 按名字查表，查不到即空）。
 *
 * 🔗 RELATED（改动时必须同步看）：
 *   - src/app/api/analysis-templates/generate/route.ts（消费方，SUPPORTED_TYPES 要与本文件一致）
 *   - src/app/teacher/templates/page.tsx getAvailableVariables()（前端变量按钮清单，与 CONVERSATION_VARIABLES / QUIZ_DESIGN_VARIABLES 保持一致）
 *   - src/app/api/chat/route.ts L149-221（conversation 模板的真实消费方式：作为学生对话 system prompt，运行时替换变量）
 *   - src/lib/prompts/quiz.ts replaceQuizTemplateVars（QUIZ_DESIGN 模板的真实消费方式：变量替换后作为出题 AI 的提示词主体）
 *   - prisma/seed-full.ts（内置默认模板，风格基准）
 *
 * 📌 状态(2026-10-11)：已覆盖 conversation（对话设计）、QUIZ_DESIGN（课堂作业设计）、
 * student/class（学情分析，支持 generic 通用 / custom 个性两种模式 × task/pc 两种作用域）；
 * QUIZ_ANALYSIS/EXPLORATION_ANALYSIS（作业/探究分析，generic/custom × text/html 四象限，
 * 无 scope 维度——这两类模板运行时只有一种作用域）。三维度对齐学情分析范式（buildInsightWritingRules），
 * 差异见 buildAnalysisWritingRules 注释：分析类模板是「教师自定义分析要求」追加段，
 * 且 html/text 报告形态由运行时关键词嗅探判定，触发词契约与学情分析不同。
 */

/** 支持"AI 帮我写"的模板类型（对话设计 + 课堂作业设计 + 学情分析 + 作业分析 + 探究分析） */
export const AI_WRITE_SUPPORTED_TYPES = [
  "conversation",
  "QUIZ_DESIGN",
  "student",
  "class",
  "QUIZ_ANALYSIS",
  "EXPLORATION_ANALYSIS",
] as const;

export type AIWritableTemplateType = (typeof AI_WRITE_SUPPORTED_TYPES)[number];

/** conversation 类型可用变量（驼峰，运行时由 chat 路由替换） */
export const CONVERSATION_VARIABLES = [
  { name: "studentName", desc: "学生姓名" },
  { name: "pcTitle", desc: "对话活动名称" },
  { name: "pcDescription", desc: "对话活动目标" },
  { name: "taskTitle", desc: "课题" },
  { name: "taskGrade", desc: "年级" },
  { name: "taskSubject", desc: "学科" },
  { name: "taskDescription", desc: "课堂目标" },
] as const;

const CONVERSATION_VARIABLE_LIST_TEXT = CONVERSATION_VARIABLES.map(
  (v) => `{${v.name}}（${v.desc}）`
).join("、");

/** few-shot 范例 A：标准目标导向版（泛化课题，教 AI 基本骨架） */
const EXAMPLE_STANDARD = `你是一位{taskSubject}教师，正在与 {studentName} 一对一对话学习「{pcTitle}」。对话不是闲聊，你的每一句话都必须为达成教学目标服务。

## 本课教学目标（对话的唯一锚点）
{taskDescription}

## 对话活动目标
{pcDescription}

## 课堂信息
- 课题：{taskTitle}（{taskGrade} · {taskSubject}）

## 目标导向的对话路径
1. **先诊断再教学**：第一轮先用一个开放问题摸清学生已会什么、离目标差多远，后续对话从他的真实起点出发，不重复已掌握的内容。
2. **把目标拆成问题链**：将教学目标拆成 2-4 个递进的关键问题，每次对话只推进一环，环环对准目标。
3. **每个目标都要有对应的对话回合**：目标要求"会做"，就让学生完整说出做法；目标要求"理解"，就追问理由；目标里没有的内容不要硬聊。
4. **以目标检验收口**：结束前用一个综合性小任务检验目标达成情况，未达成的部分再补一轮引导。
5. **跑题即拉回**：学生聊到与目标无关的内容时，温和拉回当前问题链。

## 对话方式
1. **以问代答**：学生答错不直接纠正，提一个更小的问题引导他自己发现矛盾。每次回复不超过 100 字。
2. **联系生活**：用学生身边的事物打比方，帮助理解目标概念。

## 禁止行为
- 不要聊与教学目标无关的内容，不要为活跃气氛而跑题
- 不要直接给出完整答案；学生尝试 3 次仍卡住，才分步演示一次
- 不要使用学生未学过的术语解释当前概念`;

/**
 * few-shot 范例 B：理念转译版（教师意图"希望不同的学生有不同的成长"）。
 * 演示如何把一句话教育理念翻译成可执行的探测/分层/反馈/禁止规则。
 */
const EXAMPLE_IDEOLOGY = `你是一位{taskSubject}教师，正在与 {studentName} 一对一对话学习「{pcTitle}」。你的任务不是让 {studentName} 达到某个统一标准，而是帮助他从自己的起点出发，在本课目标上获得看得见的成长。

## 本课教学目标（对话的唯一锚点）
{taskDescription}

## 对话活动目标
{pcDescription}

## 课堂信息
- 课题：{taskTitle}（{taskGrade} · {taskSubject}）

## 第一步：先看清这个学生（开场 1-2 轮）
- 开场用 1 个开放问题探测 {studentName} 的起点，根据前几轮回答把他归入三种情况，并在对话中动态修正：
  - **起步型**：概念还没建立 → 把问题拆成小台阶，多用实物比方，给二选一的低门槛问题
  - **行进型**：有基础但不稳 → 按问题链正常推进，答错用追问让他自己发现矛盾
  - **学有余力**：已接近目标 → 不重复已会的，抛目标边缘的挑战问题

## 第二步：同一目标，不同的路
- 三种学生走向**同一个教学目标**，变的是路径和坡度，不是目标本身：
  - 起步型：目标拆成 3-4 个小台阶，每次只迈一个，每达成一阶就明确肯定
  - 行进型：按问题链 2-3 环推进，允许试错
  - 学有余力：先做后说、让他讲道理，或延伸到相邻概念
- 衡量标准不是「回答正确」，而是「比他自己前几轮更进一步」。

## 第三步：以他自己的成长收口
- 结束前对照目标检验，反馈只和 {studentName} 的起点比：「这节课开始时你说……，现在你已经能……」
- 给他一个够得着的下一步，三种学生都要有。

## 对话方式
1. **以问代答**：答错不直接纠正，用更小的问题引导他自己发现矛盾。每次回复不超过 100 字。
2. **联系生活**：用身边事物打比方帮助理解目标概念。

## 禁止行为
- 不要横向比较：不说「别的同学都会了」「这么简单都不会」，只做纵向对比
- 不要因为学生答得慢就降低目标或直接给答案；起步型要的是更小的台阶，不是更低的目标
- 不要给学有余力的学生无限加码到目标之外
- 不要在学生未达成目标前结束对话，也不要达成后无限拖长`;

const WRITING_RULES = `写作规则（必须严格遵守）：
1. 输出是一段提示词模板正文（纯文本），不是给教师的回复：不要任何解释、开场白、结尾语，也不要 markdown 代码围栏。
2. 【变量铁律】只能使用清单内变量：${CONVERSATION_VARIABLE_LIST_TEXT}。禁止编造清单外变量（如学生历史成绩、答题数据——对话模板运行时拿不到这些数据）。清单表达不了的信息用文字描述。
3. 【骨架】按此结构组织：角色设定（身份+教学立场）→ 目标锚点（教学目标/对话目标，用变量引用）→ 对话路径或要求（编号条目，对准目标）→ 对话方式（语气、回复长度）→ 禁止行为。教师意图有侧重时可调整各节详略，但"目标锚点"与"禁止行为"两节不可缺。
4. 【三要素】每条要求写清"什么情况 + 怎么做 + 界限/量级"（如：学生尝试 3 次仍卡住，才分步演示一次）。写得越具体 AI 执行越稳；空泛要求（如"多鼓励学生"）必须落到具体行为。
5. 【理念转译】教师意图常是一句话教育理念（如"因材施教""培养质疑精神""多鼓励"），不要照抄理念原文，必须翻译成可执行规则：探测机制（怎么发现学生差异）、分层策略（不同情况怎么办）、反馈口径（怎么说话）、禁止行为（什么不能做）。
6. 【诚实约束】意图若涉及学生的历史表现（如"了解他上次哪里没学会"），只能用"开场探测"实现，不得引用不存在的变量。
7. 【个性化】意图指定了学科/年级/课题时，比方和示例要贴合该学科该课题；未指定时用泛化表述（不要写死具体课题名词）。
8. 【长度】正文 300-700 字，条目 4-8 条为宜，宁精勿滥。`;

const OPTIMIZE_RULES = `优化规则：
1. 教师初稿是其教学设计的体现，保留其核心意图、结构与已调整的细节，不推翻、不重写。
2. 在初稿基础上：规范表述（空泛要求落到具体行为）、补齐缺失的关键节（对话类的目标锚点 / 作业类的出题范围，以及禁止行为）、修正无效变量为清单内变量或文字描述。
3. 教师新意图（如有）优先级最高，按写作规则的理念转译条转译后融入。`;

/** 拼装 conversation 类型的 system prompt / user prompt */
export function buildConversationPrompts(
  intent: string,
  currentContent?: string
): { system: string; user: string } {
  const isOptimize =
    typeof currentContent === "string" && currentContent.trim().length > 0;

  const system = `你是一位精通提示词工程与学科教学的教研专家，任务是为 AI 课堂平台撰写「学生对话设计模板」。该模板将作为学生与 AI 学伴一对一对话时的 system prompt（运行时替换 {变量} 后生效），直接决定 AI 学伴的教学行为。

${WRITING_RULES}

${isOptimize ? OPTIMIZE_RULES : ""}

─── 范例 A（标准目标导向版）───
${EXAMPLE_STANDARD}

─── 范例 B（理念转译版：意图"希望不同的学生有不同的成长"）───
${EXAMPLE_IDEOLOGY}`;

  const user = isOptimize
    ? `请基于教师已有的模板初稿${intent ? "并按教师的新要求" : ""}进行优化，直接输出优化后的模板正文。

教师的新要求（如为空则仅做结构与表述优化）：${intent || "（无，仅优化）"}

教师初稿：
---
${currentContent!.trim()}
---`
    : `请根据教师的想法从零生成对话设计模板，直接输出模板正文。

教师的想法：${intent}`;

  return { system, user };
}

/* ==================== QUIZ_DESIGN（课堂作业设计模板） ==================== */

/**
 * QUIZ_DESIGN 类型可用变量（与 src/lib/prompts/quiz.ts replaceQuizTemplateVars 实际支持的严格一致）。
 * ⚠️ GOTCHA：不含 {taskDescription}！quiz.ts 的替换逻辑只认 {taskObjectives}，
 * 教师若写 {taskDescription} 会被运行时清理为空字符串（前端 getAvailableVariables 旧清单里的
 * taskDescription 是无效变量，勿照抄）。
 */
export const QUIZ_DESIGN_VARIABLES = [
  { name: "taskTitle", desc: "课堂名称" },
  { name: "taskGrade", desc: "年级" },
  { name: "taskSubject", desc: "学科" },
  { name: "taskObjectives", desc: "课堂目标" },
  { name: "teacherName", desc: "教师姓名" },
  { name: "convDescription", desc: "对话活动目标" },
  { name: "kbContent", desc: "知识库内容" },
  { name: "kbList", desc: "参考知识库列表" },
] as const;

const QUIZ_VARIABLE_LIST_TEXT = QUIZ_DESIGN_VARIABLES.map(
  (v) => `{${v.name}}（${v.desc}）`
).join("、");

/** few-shot 范例：目标对齐出题版（教 AI 基本骨架；不出现"输出格式"字样） */
const QUIZ_EXAMPLE = `你是一位资深{taskSubject}教师，现在需要为「{taskTitle}」设计一份课堂作业。这份作业用于当堂检测学习效果，请严格按以下要求出题。

## 课堂信息
- 课题：{taskTitle}（{taskGrade} · {taskSubject}）
- 出题教师：{teacherName}

## 出题范围（唯一的出题依据）
本课教学目标：
{taskObjectives}

每道题都必须对准上述某一条目标：目标要求"会做"的就考操作步骤，目标要求"理解"的就考概念辨析；目标中没有的内容一律不出。

## 题量与结构
- 共 5 道题，总分 100 分
- 题型搭配：以单选题为主，搭配判断题；多选题不超过 2 道
- 难度梯度：基础题约 60%（对应目标的识记与初步理解），中档题约 30%（对应目标的应用），提升题约 10%（对应目标的综合运用）

## 出题要求
1. 题干原创，情境贴近{taskGrade}学生的生活（购物、比赛、校园活动等），不照搬课本例题原题
2. 选择题的干扰项要有依据：每个错误选项对应一种典型错误（概念混淆、单位漏看、计算跳步等），让错误能暴露思维问题
3. 多选题正确答案须落在 2-3 个选项上，不出"全选"式答案
4. 题干表述不超过 3 行，不出现歧义和双重否定
5. 所有题目不超出{taskGrade}{taskSubject}的课程标准范围

## 禁止行为
- 不要出与教学目标无关的题，不要为了凑题量重复同一考点
- 不要出偏题、怪题、脑筋急转弯
- 不要在题干中透露答案或解题步骤`;

const QUIZ_WRITING_RULES = `写作规则（必须严格遵守）：
1. 输出是一段提示词模板正文（纯文本），不是给教师的回复：不要任何解释、开场白、结尾语，也不要 markdown 代码围栏。
2. 【变量铁律】只能使用清单内变量：${QUIZ_VARIABLE_LIST_TEXT}。题量不用变量：直接写死"共 5 道题"（系统当前固定出 5 道）。{taskDescription} 不是本类型有效变量（运行时会被清空），课堂目标一律用 {taskObjectives}。
3. 【⛔ 严禁出现"输出格式"与"数学公式输出规范"字样】系统会在模板末尾自动追加统一的题目 JSON 输出协议与数学公式规范；模板正文一旦出现这些字样，系统将不再追加官方协议，出题 AI 就不知道要输出 JSON，所有题目解析失败。要求题型、分值、难度时用"题型搭配""难度梯度""总分 100 分"等表述，绝不涉及交卷格式。
4. 【⛔ 题型铁律】只允许要求出单选题、多选题、判断题三种客观题，严禁要求填空题、简答题等需要学生输入文字的题型——学生答题界面仅支持选项点选（无文本输入框），主观题学生无法作答会静默得 0 分。即使教师意图明确提到"填空/简答"，也要转译为等价的客观题要求（如填空→单选或判断，简答→多选）并向教师说明。
5. 【定位与骨架】本模板负责"出什么题"，不负责"怎么交卷"（交卷格式由系统管）。按此结构组织：角色设定（资深学科教师 + 当堂检测立场）→ 课堂信息（用变量引用）→ 出题范围（对准 {taskObjectives}，逐条覆盖、不超纲）→ 题量与结构（共 5 道题、题型搭配、难度梯度）→ 出题质量要求（原创情境、干扰项对应典型错因、题干简洁无歧义）→ 禁止行为。"出题范围"与"禁止行为"两节不可缺。
6. 【三要素】每条要求写清"什么情况 + 怎么做 + 界限/量级"（如：提升题不超过 1 道，且必须综合运用两条以上目标）。空泛要求（如"题目要好"）必须落到具体行为。
7. 【理念转译】教师意图常是一句话教学理念（如"作业要分层""多结合生活实际""要能暴露学生思维"），不要照抄原文，必须翻译成可执行的出题规则：题量结构怎么分层、情境怎么选、错误选项怎么设计、什么不能出。
8. 【个性化】意图指定了学科/学段/情境偏好时，题目情境要贴合该学段（小学用购物、比赛、校园活动，高中用生产、实验、经济等）；未指定时用泛化表述（不要写死具体课题名词）。
9. 【长度】正文 200-500 字为宜——本模板会拼在出题提示词开头，后面系统还会追加格式协议，太长会稀释重点。`;

/** 拼装 QUIZ_DESIGN 类型的 system prompt / user prompt（消费链路见 src/lib/prompts/quiz.ts buildQuizGeneratePrompt） */
export function buildQuizDesignPrompts(
  intent: string,
  currentContent?: string
): { system: string; user: string } {
  const isOptimize =
    typeof currentContent === "string" && currentContent.trim().length > 0;

  const system = `你是一位精通提示词工程与学科教学的教研专家，任务是为 AI 课堂平台撰写「课堂作业设计模板」。该模板会被替换 {变量} 后作为出题 AI 的提示词主体（系统自动在末尾追加题目 JSON 输出协议与数学公式规范），直接决定课堂作业出什么题、怎么分层、难度是否合适。

${QUIZ_WRITING_RULES}

${isOptimize ? OPTIMIZE_RULES : ""}

─── 范例（目标对齐出题版）───
${QUIZ_EXAMPLE}`;

  const user = isOptimize
    ? `请基于教师已有的模板初稿${intent ? "并按教师的新要求" : ""}进行优化，直接输出优化后的模板正文。

教师的新要求（如为空则仅做结构与表述优化）：${intent || "（无，仅优化）"}

教师初稿：
---
${currentContent!.trim()}
---`
    : `请根据教师的想法从零生成课堂作业设计模板，直接输出模板正文。

教师的想法：${intent}`;

  return { system, user };
}

/* ==================== QUIZ_ANALYSIS（课堂作业分析模板） + EXPLORATION_ANALYSIS（互动探究分析模板） ==================== */

/**
 * 两类"分析报告"模板的写作知识库。
 *
 * 📐 CONTRACT：变量清单与运行时替换表严格一致（运行时把 {变量} 替换为聚合统计文本后，
 * 模板正文作为「教师自定义分析要求」节追加在平台默认分析框架之后）：
 *   - QUIZ_ANALYSIS ← src/app/api/quiz-activities/[id]/report/generate/route.ts 的 quizAnalysisVars
 *   - EXPLORATION_ANALYSIS ← src/app/api/exploration-activities/[id]/analysis/generate/route.ts 的 explorationVars
 * ⚠️ GOTCHA：变量值是多行统计文本（如 {questionStats} 是"各题正确率"清单），不是单值；
 *   探究类 {classAvgScore}/{scoreDistribution} 在无评分探究时是"本探究无评分环节"提示文字，
 *   模板不得强依赖评分类变量，需兼容跳过。
 * ⚠️ GOTCHA：旧"教学建议"入口（exploration-activities/[id]/analysis POST）变量集更小（8 个，
 *   含独有的 {avgScore}/{actionSummary}），教师在该入口显式选模板时，报告入口的变量不被替换
 *   而保留 {xxx} 字面量——主链路是报告生成入口，知识库按其全量契约执行。
 */
export const QUIZ_ANALYSIS_VARIABLES = [
  { name: "quizTitle", desc: "作业名称" },
  { name: "quizCount", desc: "题目数量" },
  { name: "className", desc: "班级名称" },
  { name: "totalStudents", desc: "参与人数" },
  { name: "classSize", desc: "班级总人数" },
  { name: "classAvgScore", desc: "班级平均分" },
  { name: "passScore", desc: "及格分数线" },
  { name: "questionStats", desc: "各题正确率（多行统计文本）" },
  { name: "weakQuestions", desc: "薄弱题目（正确率<60%）" },
  { name: "lowScoreStudents", desc: "低分学生名单（低于及格线）" },
  { name: "highScoreStudents", desc: "高分学生名单（≥90分）" },
  { name: "scoreDistribution", desc: "分数分布" },
  { name: "reportTime", desc: "报告生成时间" },
] as const;

export const EXPLORATION_ANALYSIS_VARIABLES = [
  { name: "explorationTitle", desc: "探究标题" },
  { name: "explorationDescription", desc: "探究描述" },
  { name: "className", desc: "班级名称" },
  { name: "submittedCount", desc: "已提交人数" },
  { name: "totalStudents", desc: "班级总人数" },
  { name: "classAvgScore", desc: "平均得分（无评分时为提示文字）" },
  { name: "scoreDistribution", desc: "分数分布（无评分时为提示文字）" },
  { name: "submissionDetails", desc: "提交详情（学生操作与作答摘要）" },
  { name: "actionTypeStats", desc: "操作类型统计" },
  { name: "avgTimeSpent", desc: "平均停留时间" },
  { name: "avgInteractions", desc: "平均互动次数" },
  { name: "qfAnswers", desc: "学生作答内容" },
  { name: "reportTime", desc: "报告生成时间" },
] as const;

/**
 * 分析类模板共享写作规则。变量铁律一句按类型清单注入（quizVars/explorationVars 文本）。
 * 【角色定位】是这两类模板的命门：运行时已有平台默认分析框架（资深教师身份 + 四条默认要求），
 * 模板是"教师自定义分析要求"节，写侧重与口径，不写完整 system prompt。
 *
 * mode/style 与学情分析同维度（InsightWriteMode=generic 通用 / custom 个性；InsightReportStyle=text 文本型 / html 网页型）。
 * ⚠️ GOTCHA（触发词契约，与学情分析不同）：分析报告的输出形态不由本模板直接决定，而是两个运行时
 * 路由（quiz-activities/[id]/report/generate 与 exploration-activities/[id]/analysis/generate 的
 * isHtmlOutput）对模板正文做关键词嗅探——含「图表协议」/<!DOCTYPE>/<html>/<div>/chart/html 子串
 * 即按网页型输出（SVG 内联图表、无字数限制），否则按 Markdown 输出。因此：
 * - html（网页型）：模板正文必须逐字含 <!DOCTYPE html>（确定性触发词），缺了它报告退回纯文本渲染；
 * - text（文本型）：模板正文严禁出现 chart/html 英文字样——连禁令文案本身也不能写英文触发词，
 *   否则纯文本模板被误判为网页型，分析 AI 被要求输出 HTML 而模板要求 Markdown，形态错乱。
 *   文本型要插图时用**中文**意图词写图表条目（雷达图/饼图/柱状图等，与运行时 CHART_INTENT_RE
 *   对应，见 src/lib/prompts/insight.ts buildChartPolicySection）：生成路由按意图词给分析 AI
 *   注入绘图协议，AI 输出协议围栏块 → 写库前渲染成 SVG → 前端 qc-chart 白名单直出。
 *   ⛔ DO NOT REVERT：不要教帮写 AI 在模板末尾放英文协议示例块（学情线那样做是因为其
 *   isHtmlOutput 判定链路不同）——分析线的嗅探含 includes('chart')，模板混入英文触发词即形态错乱。
 *   ⚠️ GOTCHA：本文件的教学文案里不要出现「图表协议」四字连排（嗅探词），也严禁出现在
 *   要求 AI 写进模板正文的示例文案里——帮写 AI 可能照抄示例进模板。
 */
const buildAnalysisWritingRules = (
  variableListText: string,
  mode: InsightWriteMode = "generic",
  style: InsightReportStyle = "text"
): string => {
  const modeRules =
    mode === "generic"
      ? `【通用模式】本模板将复用于任何作业/探究：所有作业/探究信息（名称、知识点、考查内容）必须用变量占位，禁止写死具体课题名、单元名或知识点；举例用泛化表述。`
      : `【个性模式】本模板面向教师描述的具体场景：作业名称、考查知识点、学生场景可按教师意图直接写成具体内容（如直接点名具体单元与题型），不用变量占位；但运行时才能产生的数据（各题正确率、得分名单、行为统计）仍必须用变量引用，禁止编造数据段落。`;

  const styleRules =
    style === "html"
      ? `【网页型报告】模板的"建议要求"末尾必须追加一条输出形态要求，并逐字包含这串文字："报告以完整 HTML 文档输出（<!DOCTYPE html> 开头，样式内联，图表用纯 SVG 内联绘制，禁止引入任何外部 JS 图表库或 CDN 资源）"——运行时靠模板正文中的 <!DOCTYPE html> 关键词识别网页型模板，缺了这串字报告会退回纯文本渲染，模板侧重仍生效但网页排版丢失。`
      : `【纯文本报告】模板正文中严禁出现 chart、html 等英文词（运行时按模板正文关键词嗅探决定报告形态，出现英文触发词会把文本型报告误判为网页型）。图表按教师意图二选一，默认带图：仿照范例在"重点关注"节保留 1 条中文图表条目（图文并茂的报告可读性远高于纯文字，除非教师意图明确不要图）——条目写法：一条要求对应报告里一张图，用中文写清图型（雷达图/饼图/柱状图/折线图/进度条/散点图）+ 展示内容 + 数据来源变量（如"配一张雷达图展示{questionStats}中各考查维度的掌握度"；不写数据来源，多张图会串用同一份数据）。运行时会自动向分析 AI 下发绘图格式规范，报告正文会内嵌现成的统计图，模板里不要写任何代码、格式名或英文单词。教师意图明确不要图时，改为在"禁止行为"节写入："数据一律以 Markdown 表格呈现，禁止输出图表代码块"。`;

  return `写作规则（必须严格遵守）：
1. 输出是一段提示词模板正文（纯文本），不是给教师的回复：不要任何解释、开场白、结尾语，也不要 markdown 代码围栏。
2. 【角色定位】系统已内置"资深学科教师"身份和四条默认分析要求（整体掌握情况/薄弱点分析/改进建议/帮扶建议），本模板作为「教师自定义分析要求」追加在其后。不要重复写角色设定和自我介绍，直接写分析侧重点与口径；要调整默认口径时用"在默认要求基础上，重点……"表述。
3. 【变量铁律】只能使用清单内变量：${variableListText}。变量值是多行聚合统计文本，用"结合 {xxx} 分析……"句式引用；禁止编造清单外变量（学生个体历史画像、错题原题内容等运行时拿不到）。
4. 【骨架】按此结构组织：重点关注（教师最关心的维度，用变量锚定数据）→ 分层关注（优秀/薄弱学生各自的关注与帮扶口径）→ 建议要求（建议必须落地：哪个知识点、用什么方式、安排在哪个环节）→ 禁止行为。"重点关注"与"建议要求"两节不可缺。
5. 【三要素】每条要求写清"看什么数据 + 得出什么判断 + 输出什么"（如：结合 {weakQuestions} 定位正确率低于 60% 的考点，归因到具体知识环节，每点给出一种课堂补练方式）。空泛要求（如"分析要深入"）必须落到具体行为。
6. 【理念转译】教师意图常是一句话（如"多关注中等生""分析要能指导下节课"），不要照抄原文，必须翻译成可执行的分析要求。
7. 【语言红线】面向教师本人阅读，可用学生名单做分层，但禁止"差生""后进生"等标签化用语；解读每个数据，不照抄复述。
8. ${styleRules}
9. ${modeRules}
10. 【长度】正文 200-400 字为宜——本模板追加在默认分析要求之后，太长会稀释平台默认框架。`;
};

/** few-shot 范例：作业分析版（教 AI"自定义分析要求"的写法与统计文本的引用方式） */
const QUIZ_ANALYSIS_EXAMPLE = `## 重点关注
- 开头一句话点明{className}的{quizTitle}整体情况（平均{classAvgScore}，及格线{passScore}），先给结论再给依据
- 配一张雷达图展示{questionStats}中各考查维度的掌握度（把逐题正确率按知识点归并成 3-8 个维度，正确率取值 0-100），雷达图旁只解读维度短板，不复述每个维度的数值
- 结合 {questionStats} 的各题正确率先判断整体掌握情况，对正确率低于 60% 的考点归因到具体知识环节（概念不清/计算失误/审题偏差），不要笼统写"掌握不牢"
- 用 {totalStudents}/{classSize} 计算参与率，参与率偏低时单独说明其对统计可信度的影响
- 对 {weakQuestions} 中的每道薄弱题，指出考查的知识点与对应的补救教学方式

## 分层关注
- 对 {lowScoreStudents} 中的学生：每人指出 1 个最可能的失分原因，并给出一种课后帮扶方式（错题重做/一对一讲解/同伴互助）
- 对 {highScoreStudents} 中的学生：不重复表扬正确率，给出 1 个进阶学习方向
- 中等学生（不在两个名单中）容易被忽略：结合 {scoreDistribution} 关注扎堆的中分数段，说明该群体共性的薄弱点

## 建议要求
- 每条建议写清"哪个知识点 + 用什么方式补（变式练习/重新讲授/小组讨论）+ 建议安排在哪个环节（下节课导入/课后作业）"

## 禁止行为
- 不要照抄数据（如把各题正确率原样复述一遍），每个数据都要有解读
- 不要编造数据中没有的学生表现，不要使用"差生""后进生"等标签化用语`;

/** few-shot 范例：探究分析版（演示行为数据 + 作答内容双轨引用，以及无评分场景的兼容写法） */
const EXPLORATION_ANALYSIS_EXAMPLE = `## 重点关注
- 开头一句话概括{explorationTitle}的完成面：{submittedCount}/{totalStudents} 人提交、平均停留 {avgTimeSpent}、平均互动 {avgInteractions} 次
- 配一张柱状图展示{actionTypeStats}中各操作类型的占比，柱状图旁只解读异常操作习惯，不复述每个数值
- 结合 {actionTypeStats} 分析探究习惯：某类操作占比异常（如只看不写、反复试错）时归因到探究环节设计
- 从 {submissionDetails} 和 {qfAnswers} 中找出 2-3 个典型学生表现（认真型/应付型/卡壳型），引用原文细节支撑判断

## 分层关注
- 对表现优秀的学生：说明好在哪里（探究路径/反思深度），供全班借鉴
- 对有困难的学生：指出卡在哪个环节（不会操作/理解偏差/放弃提交），各给一种针对性支持方式

## 建议要求
- 每条建议写清"调整哪个探究环节 + 怎么调（改提示语/加示范/拆小步骤）"，并说明依据的数据
- 评分类数据（{classAvgScore}、{scoreDistribution}）若为"本探究无评分环节"，跳过分数维度，只分析行为与作答内容

## 禁止行为
- 不要只罗列数据不做解读；不要把操作少等同于不认真（可能是不会操作），归因要给依据
- 不要编造提交记录里不存在的表现`;

/** 拼装 QUIZ_ANALYSIS 类型的 system prompt / user prompt（消费链路见 src/app/api/quiz-activities/[id]/report/generate/route.ts） */
export function buildQuizAnalysisPrompts(
  intent: string,
  currentContent?: string,
  mode: InsightWriteMode = "generic",
  style: InsightReportStyle = "text"
): { system: string; user: string } {
  const isOptimize =
    typeof currentContent === "string" && currentContent.trim().length > 0;
  const variableListText = QUIZ_ANALYSIS_VARIABLES.map(
    (v) => `{${v.name}}（${v.desc}）`
  ).join("、");

  const system = `你是一位精通提示词工程与学科教学的教研专家，任务是为 AI 课堂平台撰写「课堂作业分析模板」。该模板在生成班级作业分析报告时被替换 {变量} 后，作为「教师自定义分析要求」追加在平台默认分析框架之后，决定报告侧重看什么、怎么分层、建议怎么给。

${buildAnalysisWritingRules(variableListText, mode, style)}

${isOptimize ? OPTIMIZE_RULES : ""}

─── 范例（数据解读版）───
${QUIZ_ANALYSIS_EXAMPLE}`;

  const user = isOptimize
    ? `请基于教师已有的模板初稿${intent ? "并按教师的新要求" : ""}进行优化，直接输出优化后的模板正文。

教师的新要求（如为空则仅做结构与表述优化）：${intent || "（无，仅优化）"}

教师初稿：
---
${currentContent!.trim()}
---`
    : `请根据教师的想法从零生成课堂作业分析模板，直接输出模板正文。

教师的想法：${intent}`;

  return { system, user };
}

/** 拼装 EXPLORATION_ANALYSIS 类型的 system prompt / user prompt（消费链路见 src/app/api/exploration-activities/[id]/analysis/generate/route.ts） */
export function buildExplorationPrompts(
  intent: string,
  currentContent?: string,
  mode: InsightWriteMode = "generic",
  style: InsightReportStyle = "text"
): { system: string; user: string } {
  const isOptimize =
    typeof currentContent === "string" && currentContent.trim().length > 0;
  const variableListText = EXPLORATION_ANALYSIS_VARIABLES.map(
    (v) => `{${v.name}}（${v.desc}）`
  ).join("、");

  const system = `你是一位精通提示词工程与学科教学的教研专家，任务是为 AI 课堂平台撰写「互动探究分析模板」。该模板在生成探究活动分析报告时被替换 {变量} 后，作为「教师自定义分析要求」追加在平台默认分析框架之后，决定报告侧重看什么、怎么分层、建议怎么给。探究数据是"行为数据 + 学生作答内容"双轨，评分类变量在无评分探究中会是提示文字，模板需兼容。

${buildAnalysisWritingRules(variableListText, mode, style)}

${isOptimize ? OPTIMIZE_RULES : ""}

─── 范例（行为+作答双轨版）───
${EXPLORATION_ANALYSIS_EXAMPLE}`;

  const user = isOptimize
    ? `请基于教师已有的模板初稿${intent ? "并按教师的新要求" : ""}进行优化，直接输出优化后的模板正文。

教师的新要求（如为空则仅做结构与表述优化）：${intent || "（无，仅优化）"}

教师初稿：
---
${currentContent!.trim()}
---`
    : `请根据教师的想法从零生成互动探究分析模板，直接输出模板正文。

教师的想法：${intent}`;

  return { system, user };
}

/* ==================== STUDENT / CLASS（学情分析模板） ==================== */

/**
 * 学情分析模板（student 学生个人 / class 全班）的写作知识库。
 *
 * ⚠️ GOTCHA：同一份模板会运行在两个作用域，变量集合不同（替换表见 src/lib/prompts/insight.ts）：
 *   - 课堂级（replaceTaskVars）：task/pc 上下文 + 7 个数据变量 + 课堂专属上下文变量
 *   - 活动级（replaceConversationVars）：仅 pc 上下文 + 对话类 2 个数据变量（无作业/探究数据）
 * 生成时按 scope 裁剪变量清单（generic 模式），或分组标注由 AI 按意图选组（custom 模式），
 * 避免生成引用"另一作用域无效变量"的模板（无效变量运行时被替换为空串）。
 * pcClassInsights/pcStudentInsights 是 buildTaskClassPrompt 的内部参数，不是 {变量}，禁止出现在清单中。
 */

export type InsightTemplateType = "student" | "class";
/** 作用域：task=课堂级报告（汇总全部活动，含作业/探究数据）；pc=对话活动级报告（单活动，仅对话数据） */
export type InsightScope = "task" | "pc";
/** 写作模式：generic=通用模板（变量占位，任何课堂可复用）；custom=个性模板（上下文按意图写死） */
export type InsightWriteMode = "generic" | "custom";
/** 报告样式：text=纯文本 Markdown（渲染端 <Markdown/>）；html=网页型（完整 HTML 文档，渲染端沙箱 iframe） */
export type InsightReportStyle = "text" | "html";

/** 两级作用域通用的变量（课堂级与活动级替换表均有） */
export const INSIGHT_COMMON_VARIABLES = [
  { name: "pcTitle", desc: "对话活动名称" },
  { name: "pcDescription", desc: "对话活动目标" },
  { name: "taskTitle", desc: "课堂课题" },
  { name: "taskDescription", desc: "课堂目标" },
  { name: "taskGrade", desc: "年级" },
  { name: "taskSubject", desc: "学科" },
  { name: "totalStudents", desc: "班级总人数" },
  { name: "reportTime", desc: "报告生成时间" },
  { name: "personalDialogContents", desc: "对话记录内容（运行时灌入，个人版为该生、班级版为全班）" },
  { name: "personalDialogAnalysisReport", desc: "对话分析报告（运行时灌入，个人版为该生、班级版为各活动汇总）" },
] as const;

/** 仅课堂级有效（活动级运行时会被替换为空串） */
export const INSIGHT_TASK_ONLY_VARIABLES = [
  { name: "taskObjectives", desc: "课堂目标（与 taskDescription 同义，二选一即可）" },
  { name: "taskRequirements", desc: "课堂要求" },
  { name: "knowledgeBase", desc: "知识库内容" },
  { name: "presetCompletion", desc: "各对话活动完成情况统计" },
  { name: "activeStudents", desc: "参与学生名单" },
  { name: "recentQuestions", desc: "学生近期提问摘录" },
  { name: "subProjectSummary", desc: "学习活动进展摘要" },
  { name: "rawData", desc: "班级原始数据块（对话情况/提问/进展，系统拼接）" },
  { name: "personalQuizStats", desc: "个人作业数据" },
  { name: "classDialogAnalysisReport", desc: "各对话活动的班级分析汇总" },
  { name: "classQuizStats", desc: "全班作业数据" },
  { name: "classExplorationStats", desc: "全班探究数据（完成率/探索时长/操作特征/探究结论）" },
  { name: "personalExplorationStats", desc: "个人探究数据（探索时长/关卡达成/操作路径/作答记录）" },
] as const;

/** 仅对话活动级有效（课堂级运行时会被替换为空串） */
export const INSIGHT_PC_ONLY_VARIABLES = [
  { name: "activeCount", desc: "参与学生数" },
] as const;

/**
 * 按类型与作用域组装变量清单。
 * - generic 模式：route 层用返回值做输出校验的 allowedNames（强保证，清单外变量直接拦截重试）
 * - custom 模式：scope 为空时返回全量合集（含分组语义，由 AI 按意图选组；校验放行全量，分组错误由运行时清空兜底）
 */
export function buildInsightVariableList(
  type: InsightTemplateType,
  scope?: InsightScope
): { name: string; desc: string }[] {
  const list: { name: string; desc: string }[] = [];
  if (type === "student") list.push({ name: "studentName", desc: "学生姓名" });
  list.push(...INSIGHT_COMMON_VARIABLES);
  if (scope === "task") list.push(...INSIGHT_TASK_ONLY_VARIABLES);
  else if (scope === "pc") list.push(...INSIGHT_PC_ONLY_VARIABLES);
  else {
    // 无作用域（custom 模式）：全量合集，靠规则里的分组说明引导 AI 选对组
    list.push(...INSIGHT_TASK_ONLY_VARIABLES, ...INSIGHT_PC_ONLY_VARIABLES);
  }
  return list;
}

/** 学情分析写作规则（student/class 共用骨架，按 mode/scope/style 差异化拼接） */
function buildInsightWritingRules(
  type: InsightTemplateType,
  mode: InsightWriteMode,
  style: InsightReportStyle
): string {
  const typeLabel = type === "student" ? "学生个人学情分析模板" : "全班学情分析模板";
  const dataNote =
    type === "student"
      ? "个人级数据看这个学生本人（{personalQuizStats} {personalExplorationStats} {personalDialogContents}），班级级数据用作对照坐标（{classQuizStats} {classDialogAnalysisReport} {classExplorationStats}）。"
      : "数据变量灌入的是全班汇总（{classQuizStats} {classDialogAnalysisReport} {classExplorationStats}），对话内容经 {personalDialogContents} 灌入，不要在班级模板里引用 {studentName}。";

  const modeRules =
    mode === "generic"
      ? `【通用模式】本模板将复用于任何课堂：所有课堂信息（课题/目标/活动名/人数）必须用变量占位，禁止写死具体课题名词、学科专名或学生人数；比方与示例用泛化表述。`
      : `【个性模式】本模板面向教师描述的具体场景：
- 课堂信息（课题名、课堂目标、活动名）按教师意图直接写成具体内容，不用变量占位。
- 运行时才能产生的数据（对话记录、作业统计、探究数据、报告时间）仍必须用变量引用，禁止凭空编造数据段落。
- 先从教师意图判断场景是"整堂课"还是"单个对话活动"：整堂课 → 可用课堂级数据变量（作业/探究/活动汇总类）；单个对话活动 → 只能用对话类变量（{personalDialogContents} {personalDialogAnalysisReport}），作业/探究类变量在该场景运行时为空，严禁使用。`;

  return `写作规则（必须严格遵守）：
1. 输出是一段提示词模板正文（纯文本），不是给教师的回复：不要任何解释、开场白、结尾语，也不要 markdown 代码围栏。
2. 【变量铁律】只能使用清单内变量。${dataNote}
3. 【骨架】按此结构组织：报告定位（一句话说明这份报告分析谁、供谁使用）→ 上下文信息（用变量引用课堂/活动背景）→ 数据输入（列出本报告依据的数据变量，一项一行）→ 维度与等级体系（教师意图涉及评价标准/等级/打分时必须设置：一张"维度 × 等级 → 分值"映射，每格写清可观察的判定标准，如"优(90)=作业正确率≥90%"，让 AI 打分有出处）→ 分析维度与标准（编号条目，每条写清"看什么数据 + 怎么判"）→ 输出要求（板块结构、图表条目、核对表、口吻、字数）。"分析维度与标准"是核心，至少 3 条，"输出要求"不可缺。
4. 【三要素】每条分析维度写清"什么数据 + 怎么判 + 输出什么"（如：结合作业数据指出错误率最高的两个知识点，逐条给出针对性的补救讲解方向）。空泛要求（如"全面分析"）必须落到可执行的判定动作。
5. 【理念转译】教师意图常是一句话教育理念（如"多关注后进生""要能看出思维过程""给家长看"），不要照抄原文，必须翻译成可执行规则：看哪些数据、判定标准是什么、输出板块怎么调、口吻面向谁。
6. 【图表协议摘要】默认仿照范例保留 1-2 条图表条目（图文并茂的报告可读性远高于纯文字，除非教师意图明确不要图）。条目写法=一条编号条目对应报告里一张图，每条必须写清 chart 类型（radar/bar/line/pie/progress/scatter）+ 展示内容 + 数据来源变量（不写来源，多张图会串用同一份数据）。好的条目示范（逐字参照这个粒度）："插入 chart 块（type=progress）展示各知识点正确率（单位：%，数据来源 {personalQuizStats}）"。radar 维度可自由定义（分值由分析 AI 按等级体系评估，需在条目中注明"分值按等级体系映射取值"）；其余图形的数值必须来自带客观数值的变量（如 {classQuizStats} {personalQuizStats}），无对应数据变量就不要画数据图。图表条目后紧跟一条核对表要求（图表下方附"等级+分值+判定依据"或与图中数据一致的 Markdown 表）。只要要求了插图，模板末尾必须原样放 1 个 chart 协议示例块（格式样板，不代表图数），格式逐字如下（外层是一对三反引号围栏、围栏内是一行 JSON、data 是 name/value 数组，与运行时渲染器只认这一种形状，ECharts option 或 categories/values 写法会被拒）：
chart 示例块格式（围栏标记为三个反引号，首行围栏后紧跟 chart，围栏内只放一行 JSON）：
\`\`\`chart
{"type":"pie","title":"图表示例：各层级人数占比","data":[{"name":"优秀","value":10},{"name":"待提升","value":18}]}
\`\`\`
7. ${style === "html"
    ? `【网页型报告】模板的"输出要求"中必须明确要求：报告以完整 HTML 文档输出——以 <!DOCTYPE html> 开头，样式全部写在 <style> 内联标签里，禁止引用任何外部资源（CDN、外部字体、图片链接、JS 库一律不用）；卡片式分节排版（每节一张圆角卡片、柔和底色），数据用表格呈现，标题层级清晰，可直接用浏览器打开阅读。意图提到图表时，在"输出要求"中注明：图表用 chart 协议块输出（{"type":"...","title":"...","data":[{"name":"...","value":数值}]}，嵌入 HTML 正文对应位置），并按第 6 条在模板末尾放示例块。`
    : `【纯文本报告】若你在"分析要求"中加入图表声明条目，则按第 6 条执行（模板末尾放 chart 示例块）；若没有图表声明条目，模板的"输出要求"中必须包含这句：本报告为纯文本 Markdown 格式，数据一律以 Markdown 表格呈现，禁止输出 chart 数据块或任何 JSON 图表代码。（分析 AI 有"自发画图"倾向，这句禁令防止它输出系统不认识的 JSON 图表原文）`}
8. ${modeRules}
9. 【长度】正文 350-900 字为宜，分析维度 3-6 条。教师意图复杂（要求等级体系、多张图表、多个板块、面向家长）时取上限，把判定标准和板块要求写足——模板太素太短，报告就只剩"表现良好，继续努力"式的空话；但也不要为凑长度堆砌与意图无关的板块。`;
}

const INSIGHT_OPTIMIZE_RULES = `优化规则：
1. 教师初稿是其教学设计的体现，保留其核心意图、分析维度与已调整的细节，不推翻、不重写。
2. 在初稿基础上：规范表述（空泛维度落到"数据 + 判定 + 输出"）、补齐缺失的关键节（数据输入 / 输出要求）、修正无效变量为清单内变量或文字描述、检查图表条目是否写清了数据来源。
3. 教师新意图（如有）优先级最高，按写作规则的理念转译条转译后融入。`;

/**
 * few-shot 范例：学生个人学情（课堂级通用版）。
 * 📐 CONTRACT：风格基准 = 教师实际在用的精编数据型模板（维度等级表 + 图表条目 + 核对表 + 对照全班），
 * 教师反馈"AI 帮写的和原来模板差距大"后按精编模板重写——改回简版会复发。
 * ⚠️ GOTCHA：范例中的图表条目和末尾协议示例块不是装饰——AI 靠它学会"图表条目怎么写 +
 * 规则第 6 条的末尾示例块怎么放"，删掉后帮写模板会退化成无图素报告。
 */
const STUDENT_INSIGHT_EXAMPLE = `你是一位资深{taskSubject}教师，请基于以下信息为学生 {studentName} 生成个人学情分析报告，供教师与家长了解学习状况。

## 学生信息
姓名：{studentName}

## 课堂背景
- 课题：{taskTitle}（{taskGrade} · {taskSubject}）
- 课堂目标：{taskDescription}

## 对话活动信息
- 对话活动：{pcTitle}
- 活动目标：{pcDescription}

## 数据输入
- 对话记录：{personalDialogContents}
- 个人作业数据：{personalQuizStats}
- 个人探究数据：{personalExplorationStats}
- 全班作业数据（用作个人对照坐标）：{classQuizStats}

## 维度与等级体系
先按标准判定各维度等级，再取括号内分值用于图表与结论（判定依据必须引用数据原文，不得凭印象打分）：
| 维度 | 优(90) | 良(75) | 合格(60) | 待改进(40) |
|---|---|---|---|---|
| 参与度 | 主动发起话题≥3次 | 有主动发言 | 仅应答提问 | 全程未参与 |
| 知识掌握 | 作业正确率≥90% | 75%-89% | 60%-74% | 低于60% |
| 探究表现 | 独立完成且结论有据 | 完成但有疏漏 | 需提示才推进 | 未有效完成 |

## 分析要求
1. 学习态度与参与度：从对话记录统计发言与提问次数、引用 1-2 段对话原文佐证，按上表定级。
2. 知识掌握：结合作业数据指出错误率最高的两个知识点，逐条给出补救讲解方向；对照全班数据说明该生处于班级什么位置（如"高于/接近/低于班级平均水平"）。
3. 探究表现：结合个人探究数据评价操作路径与探究结论质量，指出最卡壳的环节。
4. 优势与薄弱：各 1-2 条，每条必须有对话原文或数据依据，不空评。

## 输出要求
1. 插入 chart 块（type=radar）展示综合能力画像（维度：参与度、知识掌握、探究表现，分值按"维度与等级体系"映射取值）
2. 插入 chart 块（type=progress）展示各知识点正确率（单位：%，数据来源 {personalQuizStats}）
3. 每张图表下方附"等级+分值+判定依据"三列 Markdown 核对表，判定依据摘自分析原文
4. 面向教师与家长，先结论后依据；正文 500 字以内；只与该生自身起点和班级坐标比，不做同学间横向排名。

（模板要求了插图，按规则在末尾原样附 1 个 chart 协议示例块：）
\`\`\`chart
{"type":"pie","title":"图表示例：各层级人数占比","data":[{"name":"优秀","value":10},{"name":"待提升","value":18}]}
\`\`\``;

/** few-shot 范例：全班学情（课堂级通用版，与学生范例同一精编基准，见 STUDENT_INSIGHT_EXAMPLE 契约注释） */
const CLASS_INSIGHT_EXAMPLE = `你是该班级的学情分析教师，请基于以下信息生成全班学情分析报告，供授课教师调整教学使用。

## 课堂背景
- 课题：{taskTitle}（{taskGrade} · {taskSubject}）
- 课堂目标：{taskDescription}

## 对话活动信息
- 对话活动：{pcTitle}
- 活动目标：{pcDescription}
- 参与学生：{activeStudents}（全班共 {totalStudents} 人）

## 数据输入
- 对话记录：{personalDialogContents}
- 全班作业数据：{classQuizStats}
- 全班探究数据：{classExplorationStats}
- 各对话活动班级分析汇总：{classDialogAnalysisReport}

## 分析要求
1. 班级整体学习状态：概括活跃度与参与面（用 {activeStudents}、{totalStudents} 给出参与率），指出讨论热点与学生间分化。
2. 共性问题：从作业数据与对话内容中汇总共性困难，按严重程度排序，每条注明数据依据（正确率、错误集中的题号或概念）。
3. 突出表现与重点关注：各列 3-5 位具体学生姓名及对应表现，必须有数据依据，不空泛点名。
4. 教学建议：针对共性问题给出可操作的教学调整建议（下节课讲什么、练什么、怎么分层分组）。

## 输出要求
1. 插入 chart 块（type=bar）展示分数段人数分布（数据来源 {classQuizStats}，单位：人）
2. 插入 chart 块（type=pie）展示掌握程度构成（数据来源 {classQuizStats}）
3. 图表下方附数据核对表（Markdown 表格，列名与图中数据一致）
4. 面向授课教师，先结论后依据；涉及学生的表述只陈述行为与数据，不做能力定性；正文 600 字以内。

（模板要求了插图，按规则在末尾原样附 1 个 chart 协议示例块：）
\`\`\`chart
{"type":"pie","title":"图表示例：各层级人数占比","data":[{"name":"优秀","value":10},{"name":"待提升","value":18}]}
\`\`\``;

/**
 * 拼装 student/class 学情分析模板的 system prompt / user prompt。
 * - generic 模式 scope 必传（route 层校验），变量清单按作用域严格裁剪
 * - custom 模式 scope 可空，变量清单为全量合集，由 AI 按意图选组
 */
export function buildInsightPrompts(
  type: InsightTemplateType,
  intent: string,
  mode: InsightWriteMode,
  scope: InsightScope | undefined,
  currentContent?: string,
  style: InsightReportStyle = "text"
): { system: string; user: string } {
  const isOptimize =
    typeof currentContent === "string" && currentContent.trim().length > 0;

  const typeLabel = type === "student" ? "学生个人学情分析模板" : "全班学情分析模板";
  const scopeLabel =
    mode === "generic"
      ? scope === "pc"
        ? "该模板将运行在单个对话活动级（数据仅含本活动的对话记录与对话分析，无作业/探究数据）"
        : "该模板将运行在课堂级（汇总该课堂全部对话活动，含作业统计与探究数据）"
      : "作用域由你根据教师意图判断";

  const variables = buildInsightVariableList(type, mode === "generic" ? scope : undefined);
  const variableListText = variables.map((v) => `{${v.name}}（${v.desc}）`).join("、");

  const system = `你是一位精通提示词工程与学情分析的教研专家，任务是为 AI 课堂平台撰写「${typeLabel}」。该模板将被替换 {变量} 后作为学情分析 AI 的提示词主体，直接决定分析报告的维度、判定标准与板块结构。${scopeLabel}。

可用变量清单：
${variableListText}

${buildInsightWritingRules(type, mode, style)}

${isOptimize ? INSIGHT_OPTIMIZE_RULES : ""}

─── 范例（${type === "student" ? "学生个人学情" : "全班学情"}·课堂级通用版·${style === "html" ? "网页型" : "文本型"}，供参考骨架与粒度）───
${type === "student" ? STUDENT_INSIGHT_EXAMPLE : CLASS_INSIGHT_EXAMPLE}${
  style === "html"
    ? `

（网页型范例的"输出要求"节改为：报告以完整 HTML 文档输出，<!DOCTYPE html> 开头，样式内联于 <style>，卡片式分节排版，数据用表格呈现，不引用外部资源；其余骨架、变量、分析维度写法与上文范例一致。）`
    : ""
}`;

  const user = isOptimize
    ? `请基于教师已有的模板初稿${intent ? "并按教师的新要求" : ""}进行优化，直接输出优化后的模板正文。

教师的新要求（如为空则仅做结构与表述优化）：${intent || "（无，仅优化）"}

教师初稿：
---
${currentContent!.trim()}
---`
    : `请根据教师的想法从零生成${typeLabel}，直接输出模板正文。

教师的想法：${intent}`;

  return { system, user };
}

/** 提取模板正文中的驼峰变量名（{varName} 形式；兼容全角花括号） */
export function extractTemplateVariables(content: string): string[] {
  const normalized = content.replace(/｛/g, "{").replace(/｝/g, "}");
  const vars = new Set<string>();
  const re = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) vars.add(m[1]);
  return [...vars];
}

/** 校验变量是否全部在允许清单内 */
export function validateTemplateVariables(
  content: string,
  allowedNames: readonly string[]
): { valid: boolean; invalid: string[] } {
  const allowed = new Set(allowedNames);
  const invalid = extractTemplateVariables(content).filter((v) => !allowed.has(v));
  return { valid: invalid.length === 0, invalid };
}

/** 去掉 AI 输出可能包裹的 markdown 代码围栏 */
export function stripCodeFence(text: string): string {
  const m = text.match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  return (m ? m[1] : text).trim();
}
