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
 * 📌 TODO(2026-10-10)：已覆盖 conversation（对话设计）与 QUIZ_DESIGN（课堂作业设计），负责人：待定。
 * 扩展其他类型（student/class/QUIZ_ANALYSIS/EXPLORATION_ANALYSIS）时的触发条件
 * 与步骤：1) 各类型补 VARIABLES + GUIDE + EXAMPLE（分析类必须注入 chart 块协议摘要：
 * 「报告要求」条目数=图数、每图写清数据来源变量、示例块恒为 1 个，详见 教师模板修改指南.md 附录）；
 * 2) generate/route.ts 的类型校验同步放开；3) page.tsx 弹窗 AI 区块的禁用态同步放开。
 */

/** 支持"AI 帮我写"的模板类型（对话设计 + 课堂作业设计） */
export const AI_WRITE_SUPPORTED_TYPES = ["conversation", "QUIZ_DESIGN"] as const;

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
