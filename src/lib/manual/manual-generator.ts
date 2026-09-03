/**
 * 教学手册生成器（移植自 quickclass-lesson-converter skill 的 generate_lesson_guide.py）
 *
 * 依据课堂 JSON 中实际配置的四类活动（对话 / 探究 / 作业 / 项目）逐条生成教学流程，
 * 并给出每个活动在 QuickClass 上的操作指引，形成一份可照着上课的教师指南。
 *
 * 手册结构：
 *  封面（教师 · 单位 / 年级 · 学科 · 来源）
 *  一、教学目标（一节式：N. 素养名称，具体目标描述）
 *  二、教学活动（活动目标 / 活动内容 / 教师指导 / 学生反馈应对 / QuickClass操作指导 + 活动间过渡语）
 *  三、课堂作业设计（逐题内容）
 *  四、教学反思（教师自我评价与记录框架）
 *  五、备用活动（超出 30 分钟活动限时被移出的活动）
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Footer,
  PageNumber,
  AlignmentType,
  BorderStyle,
  ShadingType,
  LineRuleType,
} from "docx";
import { CORE_COMPETENCIES } from "./core-competencies";

// ---------------------------------------------------------------------------
// 常量与配置
// ---------------------------------------------------------------------------

const DIFFICULTY_CN: Record<string, string> = {
  BASIC: "基础",
  INTERMEDIATE: "中等",
  ADVANCED: "较难",
  EXPANDED: "拓展",
};

const TYPE_CN: Record<string, string> = {
  SINGLE_CHOICE: "单选题",
  MULTIPLE_CHOICE: "多选题",
  TRUE_FALSE: "判断题",
};

const DIFFICULTY_GUIDANCE: Record<string, string> = {
  BASIC:
    "教师快速呈现题目，让学生独立作答后口述答案和理由，重点确认概念理解是否准确。对出现的共性问题简要讲解，不展开讨论。",
  INTERMEDIATE:
    "教师先让学生独立思考1-2分钟，再组织同桌讨论。巡视时关注不同层次学生的思路，选取有代表性的发言引导全班归纳解题方法，对易错点进行对比辨析。",
  ADVANCED:
    "教师组织分组讨论3-5分钟，各组派代表分享解题思路。重点讲解关键推理步骤和思维障碍，对学有余力的学生引导深入思考，对基础薄弱学生适当搭桥铺垫。",
  EXPANDED:
    "教师简要点拨思路后，留给学有余力的学生课内挑战，不统一讲解；收尾时花1-2分钟分享优秀解答，展示创意方案。",
};

const TYPE_COMMON_MISTAKES: Record<string, string> = {
  SINGLE_CHOICE:
    "学生可能被干扰项迷惑，尤其与正确答案近义的选项。建议引导学生逐一排除，说明每个错误选项为何不对。",
  MULTIPLE_CHOICE:
    "学生可能漏选或多选。建议引导对每个选项独立判断，标注“对”或“错”再汇总，避免凭直觉选择。",
  TRUE_FALSE:
    "学生可能将部分正确的内容判断为全对，或因关键词遗漏而误判。建议引导圈出题目中的关键词，判断是否存在“以偏概全”或“绝对化”表述。",
};

const HIGH_ONLY_SUBJECTS = new Set(["信息技术", "思想政治"]);
const BASIC_ONLY_SUBJECTS = new Set([
  "信息科技",
  "道德与法治",
  "科学",
  "劳动",
  "艺术",
]);

// 核心素养维度 -> 教学目标生成模板（每条 50-100 字，结合课题内容）
const LESSON_GOAL_TEMPLATES: Record<string, string> = {
  信息意识:
    "通过“{topic}”的学习，学生能主动识别相关信息要素，评估网络素材的可靠性与时效性，形成信息真伪辨别意识。",
  计算思维:
    "在“{topic}”的制作过程中，学生能将复杂任务分解为规划、制作、评价等步骤，运用算法化思维设计解决流程，提升问题分解与建模能力。",
  数字化学习与创新:
    "学生能选用合适的数字工具完成“{topic}”，在制作中尝试新方法与新工具，创造性地表达个人想法，提升数字化实践与创新能力。",
  信息社会责任:
    "在“{topic}”中，学生能尊重知识产权，合法使用网络素材，遵守信息道德规范，形成信息安全意识与社会责任意识。",
  文化自信:
    "通过“{topic}”的学习，学生感受语言文字承载的文化内涵，认同中华优秀传统文化，增强文化自信与文化传承意识。",
  语言运用:
    "在“{topic}”的学习中，学生能正确规范运用语言文字表达思想，在具体情境中有效交流，积累语言经验，提升语感与表达能力。",
  思维能力:
    "通过“{topic}”的学习，学生能进行比较、归纳、判断等思维活动，发展逻辑思维与创造思维，养成积极思考、勇于探究的习惯。",
  审美创造:
    "在“{topic}”的学习中，学生能感受语言文字之美，运用语言表现美、创造美，涵养健康审美意识与高雅情趣。",
  语言建构与运用:
    "通过“{topic}”的学习，学生在丰富语言实践中积累与整合语言规律，发展有效运用语言文字进行交流沟通的能力。",
  思维发展与提升:
    "通过“{topic}”的学习，学生获得逻辑思维、辩证思维和创造思维的发展，提升思维的深刻性、灵活性和批判性。",
  审美鉴赏与创造:
    "在“{topic}”的学习中，学生通过审美体验与评价形成正确审美意识，逐步掌握表现美与创造美的方法。",
  文化传承与理解:
    "通过“{topic}”的学习，学生继承与弘扬中华优秀文化，理解多元文化，拓展文化视野，增强文化自觉与自信。",
  会用数学的眼光观察现实世界:
    "通过“{topic}”的学习，学生能从现实情境中发现数量关系与空间形式，提出有意义的数学问题，发展观察意识与好奇心。",
  会用数学的思维思考现实世界:
    "在“{topic}”的学习中，学生能运用逻辑推理分析问题，合乎逻辑地推出结论，培养重论据、有条理的思维品质。",
  会用数学的语言表达现实世界:
    "通过“{topic}”的学习，学生能用数学语言精确描述数量关系，构建数学模型表达和解决问题，发展应用意识与实践能力。",
  数学抽象:
    "通过“{topic}”的学习，学生能对数量关系与空间形式进行抽象，形成数学概念与方法，提升从具体到抽象的概括能力。",
  逻辑推理:
    "在“{topic}”的学习中，学生能依据规则进行归纳、演绎与类比推理，从已知事实推出结论，发展逻辑推理能力。",
  数学建模:
    "通过“{topic}”的学习，学生能用数学语言表达实际问题，构建模型求解并验证，提升数学建模素养。",
  直观想象:
    "在“{topic}”的学习中，学生能借助几何直观与空间想象感知事物形态与变化，利用图形理解与解决问题。",
  数学运算:
    "通过“{topic}”的学习，学生能明晰运算对象，依据法则进行运算，提升运算的准确性与灵活性。",
  数据分析:
    "在“{topic}”的学习中，学生能获取与整理数据，运用统计方法分析与推断，形成基于数据的判断与决策能力。",
  学习能力:
    "通过“{topic}”的学习，学生积极运用学习策略，拓展学习渠道，提升自主学习与合作学习的能力与效率。",
  政治认同:
    "通过“{topic}”的学习，学生增强热爱祖国与中华民族的情感，自觉践行社会主义核心价值观，坚定政治认同。",
  道德修养:
    "在“{topic}”的学习中，学生将道德规范内化于心、外化于行，养成良好品德与行为习惯。",
  法治观念:
    "通过“{topic}”的学习，学生树立宪法法律至上理念，知晓基本法律常识，使尊法守法成为自觉行为。",
  健全人格:
    "在“{topic}”的学习中，学生形成正确自我认知与积极生活态度，做到自尊自信、理性平和、积极向上。",
  责任意识:
    "通过“{topic}”的学习，学生增强主人翁意识与担当精神，将责任认知转化为实际行动，提升社会责任感。",
  科学精神:
    "通过“{topic}”的学习，学生坚持实事求是、求真务实，运用辩证唯物主义观点认识事物本质与发展规律。",
  法治意识:
    "在“{topic}”的学习中，学生树立尊法守法用法意识，自觉参加社会主义法治国家建设。",
  公共参与:
    "通过“{topic}”的学习，学生有序参与公共事务，承担社会责任，增强行使人民当家作主权利的实践能力。",
  唯物史观:
    "通过“{topic}”的学习，学生运用唯物史观认识历史发展规律，形成科学的历史观与方法论。",
  时空观念:
    "在“{topic}”的学习中，学生在特定时空联系中观察与分析事物，培养时空意识与历史地看问题的思维方式。",
  史料实证:
    "通过“{topic}”的学习，学生能辨析史料，运用可信史料重现历史真实，形成证据意识与实证能力。",
  历史解释:
    "在“{topic}”的学习中，学生能以史料为依据客观评判历史事物，发展理性分析与客观评判能力。",
  家国情怀:
    "通过“{topic}”的学习，学生增强对国家富强与人民幸福的情感认同，提升归属感、责任感与人文追求。",
  人地协调观:
    "通过“{topic}”的学习，学生树立人类活动与地理环境协调发展的正确价值观，形成人地和谐意识。",
  综合思维:
    "在“{topic}”的学习中，学生运用综合观点认识地理环境与人地关系，提升整体性、系统性的思维能力。",
  区域认知:
    "通过“{topic}”的学习，学生从空间—区域视角认识地理环境，发展区域分析与比较的思维方式。",
  地理实践力:
    "在“{topic}”的学习中，学生在地理实验、社会调查等实践活动中提升行动力与意志品质。",
  物理观念:
    "通过“{topic}”的学习，学生从物理学视角认识物质、运动与能量，形成物理概念与规律的提炼与升华。",
  科学探究:
    "在“{topic}”的学习中，学生经历提出问题、设计实验、获取证据、得出结论的探究过程，提升科学探究能力。",
  科学态度与责任:
    "通过“{topic}”的学习，学生形成严谨求实的科学态度，认识科学·技术·社会·环境关系，增强社会责任感。",
  化学观念:
    "通过“{topic}”的学习，学生认识物质组成、结构、性质与变化规律，形成化学基本观念与解决问题的能力。",
  科学探究与实践:
    "在“{topic}”的学习中，学生经历实验探究与跨学科实践，综合运用知识与方法解决真实情境问题。",
  科学探究与创新意识:
    "通过“{topic}”的学习，学生能发现有探究价值的问题，设计并实施实验方案，发展创新意识与实践能力。",
  宏观辨识与微观探析:
    "在“{topic}”的学习中，学生从宏观与微观不同层次认识物质及其变化，进行分类与表征。",
  变化观念与平衡思想:
    "通过“{topic}”的学习，学生认识物质是运动与变化的，理解化学变化需条件并遵循守恒规律。",
  证据推理与模型认知:
    "在“{topic}”的学习中，学生基于证据进行推理，建立认知模型解释化学现象，发展证据意识与建模能力。",
  生命观念:
    "通过“{topic}”的学习，学生从生物学视角认识生命现象，形成结构与功能观、进化与适应观等生命观念。",
  探究实践:
    "在“{topic}”的学习中，学生在探究生物世界与获取知识的过程中，形成科学探究与跨学科实践能力。",
  态度责任:
    "通过“{topic}”的学习，学生形成科学态度与责任感，理解科学·技术·社会·环境之间的关系。",
  社会责任:
    "在“{topic}”的学习中，学生基于生物学认识参与社会事务讨论，作出理性解释与判断。",
  科学观念:
    "通过“{topic}”的学习，学生在理解概念与规律的基础上形成对客观事物的总体认识，发展科学观念。",
  审美感知:
    "通过“{topic}”的学习，学生发现与感受自然、生活与艺术作品中美的特征，提升审美感知能力。",
  艺术表现:
    "在“{topic}”的学习中，学生运用艺术手段创造艺术形象、表达思想情感，提升艺术表现力。",
  创意实践:
    "通过“{topic}”的学习，学生综合运用多学科知识进行艺术创新与实际应用，发展创意实践能力。",
  文化理解:
    "在“{topic}”的学习中，学生理解艺术作品的人文内涵，提升文化领悟与阐释能力。",
  运动能力:
    "通过“{topic}”的学习，学生提升体能状况与技战术运用能力，发展运动认知与展示比赛能力。",
  健康行为:
    "在“{topic}”的学习中，学生养成体育锻炼习惯与健康生活方式，增进身心健康并积极适应环境。",
  体育品德:
    "通过“{topic}”的学习，学生表现体育精神与体育道德，形成良好的价值追求与行为规范。",
  劳动观念:
    "通过“{topic}”的学习，学生形成对劳动、劳动者与劳动成果的正确认知，养成尊重劳动的态度。",
  劳动能力:
    "在“{topic}”的学习中，学生掌握完成劳动任务所需的知识与技能，提升综合劳动能力。",
  劳动习惯和品质:
    "通过“{topic}”的学习，学生在经常性劳动实践中形成稳定的行为习惯与良好品质。",
  劳动精神:
    "在“{topic}”的学习中，学生培养热爱劳动、勤俭奋斗、创新奉献的劳动精神。",
};

const GENERIC_GOAL_TEMPLATE =
  "通过“{topic}”的学习与实践，引导学生在具体任务中体验和迁移“{comp_name}”这一核心素养，提升相关能力与素养。";

// 对话活动：按教学阶段给出差异化的目标 / 指导 / 反馈
interface StageGuideItem {
  time: number;
  goal: string;
  guidance: string;
  feedback: string;
}

const STAGE_GUIDE: Record<string, StageGuideItem> = {
  导入: {
    time: 6,
    goal:
      "从学生已有的生活经验出发引出本课主题，激发学习兴趣，暴露学生的前概念与困惑，为后续新授建立学习期待。",
    guidance:
      "教师以开放式问题开场，不急于给出答案；鼓励多个学生发言，捕捉学生回答中的关键词并板书记录。注意控制节奏，避免个别学生独占发言。对话结束前要点明本课要解决的问题。",
    feedback:
      "若学生发言积极：及时肯定，选取有代表性的回答追问“为什么”。\n若学生回答偏离主题：用“如果从本课角度看……”把话题拉回。\n若无人发言：教师先给出一个简单示例或反例，再抛出问题。\n若出现典型迷思概念：不要当场否定，记录下来作为新授环节的切入点。",
  },
  新授: {
    time: 8,
    goal:
      "围绕本课核心概念组织师生对话，引导学生从已知推未知，在表达与辩驳中完成概念建构，形成可迁移的思路方法。",
    guidance:
      "教师以承上启下的过渡语开场，一次只推进一个关键点；每追问一轮就留出思考时间，要求学生说清“理由”而不只报结果。把学生说出的关键步骤或依据板书出来，形成全班共有的思维支架。",
    feedback:
      "若学生能说清理由：请其向同桌复述一遍，固化表达。\n若学生只报结论：追问“你是怎么想的”，逼出思维过程。\n若出现分歧：不急于裁判，让双方各陈理由，在碰撞中澄清。\n若多数学生卡住：退回上一个已解决的问题，用类比搭桥。",
  },
  练习总结: {
    time: 6,
    goal:
      "引导学生对本课学习过程进行回顾与反思，梳理易错点与方法策略，检验教学目标的达成情况，为后续迁移应用打基础。",
    guidance:
      "教师以反思型问题开场，如“这节课你学到的最关键的一点是什么”。要求学生结合自己做过的具体题目或任务来说明，避免空泛表态。教师根据学生回答判断目标达成度，未达成的要点当场补讲。",
    feedback:
      "若学生能举出具体例子：请其说明当时是怎么改正的，供全班借鉴。\n若学生总结空泛：提供支架“我在……题上错过了……，后来发现……”。\n若学生暴露出普遍性错误：当场组织一次针对性小练习。\n若时间不足：把总结改为书面，让学生用一句话写在作业本上。",
  },
};

const DEFAULT_STAGE_GUIDE = STAGE_GUIDE["新授"];

// 对话活动：QuickClass 操作要点按教学阶段差异化
const CONV_OPERATIONS: Record<string, string> = {
  导入:
    "① 在平台创建对话活动，引导提示词侧重让学生说出自己已有的经验与疑问；\n② 设置学生个人分析与全班分析模板；\n③ 学生登录后按提示词自由发言，气氛轻松些；\n④ 教师端查看个人报告与全班观点分布，捕捉学生前概念与困惑，记下作为新授切入点。",
  新授:
    "① 在平台创建对话活动，引导提示词侧重追问概念与理由（\"你怎么想的？为什么？\"）；\n② 设置个人与全班分析模板；\n③ 学生逐轮发言，回答须说明理由，不只要结论；\n④ 教师端对照报告把握概念建构进度，针对分歧点组织全班辩驳、澄清。",
  练习总结:
    "① 在平台创建对话活动，引导提示词侧重回顾反思（\"这节课最关键的一点是什么？哪里最容易错？\"）；\n② 设置个人与全班分析模板；\n③ 学生按提示词总结收获、说出易错点；\n④ 教师端查看报告核对本课教学目标达成度，未达成的要点当场补讲。",
};

// 探究活动通用模板
const INQUIRY_ACT_TEMPLATE = {
  type: "探究",
  goal:
    "学生在交互页面中动手操作、观察变化、提出猜想并验证，在“做”的过程中自主建构概念，教师通过探究数据把握学生的思维路径。",
  guidance:
    "教师先明确探究任务与完成标志，再放手让学生操作，不要提前演示结论。巡视时重点看学生是否真的在尝试不同做法，而不是等着要答案。探究结束后必须留出汇报环节，请学生用自己的话说清“发现了什么”。",
  feedback:
    "若学生顺利得出结论：追问“换一个条件还成立吗”，推向迁移。\n若学生只顾操作不观察：给出具体的观察任务单，限定观察点。\n若学生求助AI伴学：事后请其复述AI说了什么，避免直接抄答案。\n若学生进度差异大：让先完成的学生当小老师，协助同伴。",
  quickclass_guide:
    "① 在平台创建交互探究活动，粘贴或由AI生成可交互的HTML页面；\n② 设置是否开启AI伴学、是否要求提交探究结果；\n③ 学生登录后操作页面探究，卡住时点AI伴学提问；\n④ 教师端查看探究进度、操作轨迹与AI对话记录，调整讲解重点。",
  estimated_time: 8,
};

// 课堂作业通用模板
const QUIZ_ACT_TEMPLATE = {
  type: "作业",
  goal:
    "通过分层题目的独立作答与即时反馈，检测学生对本课核心知识的掌握程度，暴露典型错误，为教师的下一步讲解与个别辅导提供数据依据。",
  guidance:
    "教师先发布全部题目让学生独立作答，不要边做边讲。巡视时只看进度不提示答案，等后台出现错误率统计后，再针对错误率高的题目组织全班讨论，其余题目由学生对照解析自行订正。",
  feedback:
    "若多数学生答对：快速确认后进入下一环节，不必逐题讲解。\n若某题错误率较高：暂停讲解，引导学生回顾相关概念，用更简单的例子重建认知。\n若学生完成速度快：布置进阶追问“你还能想到什么不同的解法”。\n若个别学生有困难：课后个别辅导，不拖慢全班进度。",
  quickclass_guide:
    "① 在平台创建课堂作业，从教案提取或由AI生成题目；\n② 发布给全班，学生逐题作答后提交，平台自动判分并给解析；\n③ 教师端查看全班答题进度、逐题错误率与学情分析报告；\n④ 错误率高的题目统一讲评，个别困难学生课后单独辅导。",
  estimated_time: 15,
};

// 项目提交通用模板（课内完成）
const PROJECT_ACT_TEMPLATE = {
  type: "项目",
  goal:
    "将课堂所学迁移到真实任务的完成中，让学生在课内经历从规划、制作到评价修改的完整过程，产出可见的作品或方案，实现能力的综合应用。",
  guidance:
    "教师在布置时讲清要求、格式与完成标志，并给出评价要点，让学生知道“做好”的标准是什么。留出足够课内时间，收齐后当场组织同伴互评，再选代表性作品全班讲评，重点关注完成过程而非仅看成品效果。",
  feedback:
    "若作品完成度高：当场展示，请作者分享制作过程与修改经历。\n若作品有瑕疵：肯定已完成的部分，指出一处最值得改进的点，引导当场修改。\n若学生未完成：当场了解原因（不会做、没时间、不理解要求），针对性帮助并限时补齐。\n若出现创意方案：大力表扬，并鼓励其当场继续完善后再展示。",
  quickclass_guide:
    "① 在平台创建项目提交活动，设置作品类型（文本/图片/视频等）、大小上限、是否全班可见、是否允许点赞；\n② 学生课内登录提交作品，可浏览同学作品并点赞；\n③ 教师端查看提交清单与点赞情况，当场组织展示互评。",
  estimated_time: 8,
};

const CATEGORY_CN: Record<string, string> = {
  TEXT: "文本",
  IMAGE: "图片",
  VIDEO: "视频",
  AUDIO: "音频",
  FILE: "文件",
  DOCUMENT: "文档",
};

// ---------------------------------------------------------------------------
// 输入类型
// ---------------------------------------------------------------------------

export interface ManualQuestion {
  type?: string;
  content?: string;
  options?: string;
  answer?: string;
  difficulty?: string;
  explanation?: string;
  order?: number;
}

export interface ManualQuizActivity {
  title?: string;
  description?: string;
  analysisPrompt?: string;
  questions?: ManualQuestion[];
}

export interface ManualConversation {
  title?: string;
  description?: string;
  systemPrompt?: string;
  analysisPrompt?: string;
  classAnalysisPrompt?: string;
}

export interface ManualExploration {
  title?: string;
  description?: string;
  htmlContent?: string;
  enableSubmission?: boolean;
  enableAiCompanion?: boolean;
  aiCompanionPrompt?: string;
}

export interface ManualProject {
  title?: string;
  description?: string;
  category?: string;
  visibleToClass?: boolean;
  allowLike?: boolean;
  fileSizeLimit?: number;
}

export interface ManualTaskInput {
  title?: string;
  description?: string;
  grade?: string;
  subject?: string;
  teacher?: string;
  school?: string;
  presetConversations?: ManualConversation[];
  quizActivities?: ManualQuizActivity[];
  explorations?: ManualExploration[];
  projectSubmissions?: ManualProject[];
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 从题目内容中提取高频关键词（2-4 字片段），用于教学目标的具体化 */
function extractKeywords(questions: ManualQuestion[]): string[] {
  const stopwords = new Set([
    "以下", "哪个", "哪些", "正确", "错误", "属于", "不属", "哪种",
    "关于", "什么", "如何", "应该", "需要", "可以", "能够",
    "在", "的", "了", "是", "和", "与", "或", "及", "以",
    "一个", "一种", "这", "那", "以下哪些", "属于以下",
    "制作", "数字", "作品", "学生", "教师", "课堂",
  ]);
  const allText = (questions || [])
    .map((q) => q.content || "")
    .join(" ");
  const segments = allText.split(/[\s，。、；：？！（）()\[\]【】“”《》"']+/);
  const wordFreq: Record<string, number> = {};
  for (const seg of segments) {
    const s = seg.trim();
    if (s.length >= 2 && s.length <= 4 && !stopwords.has(s)) {
      wordFreq[s] = (wordFreq[s] || 0) + 1;
    }
  }
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

/** 根据核心素养维度名称和课题标题，生成结合本课内容的教学目标（50-100 字） */
function generateLessonGoal(
  compName: string,
  taskTitle: string,
  questions: ManualQuestion[]
): string {
  let goal = (LESSON_GOAL_TEMPLATES[compName] || GENERIC_GOAL_TEMPLATE).replace(
    "{topic}",
    taskTitle
  );
  if (goal.includes("{comp_name}")) {
    goal = goal.replace("{comp_name}", compName);
  }
  if (goal.length < 50) {
    const keywords = extractKeywords(questions);
    if (keywords.length > 0) {
      goal += `重点关照${keywords.slice(0, 3).join("、")}等核心知识点。`;
    }
  }
  if (goal.length > 100) {
    const truncated = goal.slice(0, 100);
    const lastStop = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("，"),
      truncated.lastIndexOf("；"),
      truncated.lastIndexOf("、")
    );
    if (lastStop > 50) {
      goal = truncated.slice(0, lastStop + 1);
    } else {
      goal = truncated.slice(0, 98) + "。";
    }
  }
  return goal;
}

/** 推断学段：义务教育 / 普通高中 */
function inferStage(grade: string, subject: string): string {
  if (BASIC_ONLY_SUBJECTS.has(subject)) return "义务教育";
  if (HIGH_ONLY_SUBJECTS.has(subject)) return "普通高中";
  if (grade) {
    if (
      /小学|初中|七年级|八年级|九年级|一年级|二年级|三年级|四年级|五年级|六年级/.test(
        grade
      )
    ) {
      return "义务教育";
    }
    if (/高一|高二|高三|高中/.test(grade)) return "普通高中";
  }
  return "义务教育";
}

/** 按学段返回标准课时：小学 40 分钟，中学（初中/高中）45 分钟 */
function lessonMinutes(grade: string): number {
  if (/小学|一年级|二年级|三年级|四年级|五年级|六年级/.test(grade || "")) {
    return 40;
  }
  return 45;
}

/** 选择该学科在对应学段的核心素养维度（全部维度） */
function selectCompetencies(
  subject: string,
  stage: string
): [string, string][] {
  const stageData = CORE_COMPETENCIES[stage] || {};
  const allComps = stageData[subject] || {};
  return Object.entries(allComps);
}

/** 解析选项 JSON 字符串（如 '{"A":"xxx","B":"yyy"}'），返回按字母排序的 [字母, 文本] 数组 */
function parseOptions(optionsStr: string, qType: string): [string, string][] {
  if (qType === "TRUE_FALSE" || !optionsStr) return [];
  try {
    const opts =
      typeof optionsStr === "string" ? JSON.parse(optionsStr) : optionsStr;
    if (opts && typeof opts === "object") {
      return Object.entries(opts).sort((a, b) => a[0].localeCompare(b[0]));
    }
  } catch {
    // ignore
  }
  return [];
}

/** 判断题答案 T/F -> 正确/错误 */
function formatAnswer(answer: string, qType: string): string {
  if (qType === "TRUE_FALSE") {
    return answer === "T" ? "正确" : "错误";
  }
  return answer || "";
}

/** 从探究活动的 HTML 内容中提取纯文本摘要 */
function htmlToText(html: string, limit = 200): string {
  if (!html) return "";
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > limit) {
    text = text.slice(0, limit) + "……";
  }
  return text;
}

/** 推断每个对话活动的教学阶段：首=导入，末=练习总结，其余=新授；单个=新授 */
function inferConversationStages(convs: ManualConversation[]): string[] {
  const n = convs.length;
  const stages: string[] = [];
  for (let i = 0; i < n; i++) {
    if (n === 1) stages.push("新授");
    else if (i === 0) stages.push("导入");
    else if (i === n - 1) stages.push("练习总结");
    else stages.push("新授");
  }
  return stages;
}

interface ManualActivity {
  type: string;
  stage: string;
  name: string;
  goal: string;
  content: string;
  guidance: string;
  feedback: string;
  quickclass_guide: string;
  questions: ManualQuestion[];
  estimated_time: number;
}

/** 依据课堂 JSON 中的真实活动构建教学流程（顺序：对话 → 探究 → 作业 → 项目） */
function buildLessonActivities(
  data: ManualTaskInput,
  taskTitle: string
): ManualActivity[] {
  const activities: ManualActivity[] = [];
  const convs = data.presetConversations || [];
  const exps = data.explorations || [];
  const quizzes = data.quizActivities || [];
  const projects = data.projectSubmissions || [];

  // 1. 对话活动（按教学阶段生成差异化指导）
  const stages = inferConversationStages(convs);
  for (let ci = 0; ci < convs.length; ci++) {
    const conv = convs[ci];
    const stage = stages[ci] || "新授";
    const guide = STAGE_GUIDE[stage] || DEFAULT_STAGE_GUIDE;
    const title = conv.title || `对话活动${activities.length + 1}`;
    const desc = conv.description || "";
    activities.push({
      type: "对话",
      stage,
      name: `对话活动：${title}（${stage}环节，约${guide.time}分钟）`,
      goal: guide.goal,
      content:
        `活动主题：${title}\n` +
        (desc ? `内容说明：${desc}\n` : "") +
        `教学阶段：${stage}。教师按上述阶段策略组织师生对话，要求学生在回答时说清理由，而不只给出结论。`,
      guidance: guide.guidance,
      feedback: guide.feedback,
      quickclass_guide: CONV_OPERATIONS[stage] || CONV_OPERATIONS["新授"],
      questions: [],
      estimated_time: guide.time,
    });
  }

  // 2. 交互探究
  for (const exp of exps) {
    const title = exp.title || `探究活动${activities.length + 1}`;
    const summary = htmlToText(exp.htmlContent || "");
    const aiOn = exp.enableAiCompanion !== false;
    const submitOn = exp.enableSubmission === true;
    const aiPrompt = htmlToText(exp.aiCompanionPrompt || "", 150);
    let content = `活动主题：${title}\n`;
    if (summary) content += `页面要点：${summary}\n`;
    content += `平台配置：${aiOn ? "已开启" : "未开启"}AI伴学；${
      submitOn ? "要求提交探究结果" : "不要求提交探究结果"
    }。\n`;
    if (aiOn && aiPrompt) content += `AI伴学引导语：${aiPrompt}\n`;
    content +=
      "课堂组织：教师先抛出探究任务与完成标志，学生独立操作页面，观察现象、记录发现，最后用自己的话汇报结论。";
    activities.push({
      ...INQUIRY_ACT_TEMPLATE,
      stage: "探究",
      name: `探究活动：${title}（约${INQUIRY_ACT_TEMPLATE.estimated_time}分钟）`,
      content,
      questions: [],
    } as ManualActivity);
  }

  // 3. 课堂作业
  for (const quiz of quizzes) {
    const title = quiz.title || `课堂作业${activities.length + 1}`;
    const questions = quiz.questions || [];
    const qCount = questions.length;
    const est = Math.min(20, Math.max(6, Math.round(qCount * 1.5)));
    const diffCount: Record<string, number> = {};
    const typeCount: Record<string, number> = {};
    for (const q of questions) {
      const d = q.difficulty || "BASIC";
      const t = q.type || "SINGLE_CHOICE";
      diffCount[d] = (diffCount[d] || 0) + 1;
      typeCount[t] = (typeCount[t] || 0) + 1;
    }
    const diffSummary = Object.entries(diffCount)
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => `${DIFFICULTY_CN[d] || d}${n}题`)
      .join("、");
    const typeSummary = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${TYPE_CN[t] || t}${n}题`)
      .join("、");
    const content =
      `作业名称：${title}\n` +
      `题目构成：共${qCount}题（${typeSummary}）\n` +
      (diffSummary ? `难度构成：${diffSummary}\n` : "") +
      "课堂组织：教师一次性发布，学生独立作答；教师根据后台错误率统计，对高错误率题目统一讲评，其余题目由学生对照解析自行订正。";
    activities.push({
      ...QUIZ_ACT_TEMPLATE,
      stage: "作业",
      name: `课堂作业：${title}（${qCount}题，约${est}分钟）`,
      content,
      questions: [...questions],
      estimated_time: est,
    } as ManualActivity);
  }

  // 4. 项目提交
  for (const proj of projects) {
    const title = proj.title || `项目提交${activities.length + 1}`;
    const desc = proj.description || "";
    const category = proj.category || "TEXT";
    const sizeLimit = proj.fileSizeLimit ?? 10;
    const visible = proj.visibleToClass !== false;
    const allowLike = proj.allowLike === true;
    const est = PROJECT_ACT_TEMPLATE.estimated_time;
    const content =
      `任务名称：${title}\n` +
      (desc ? `任务说明：${desc}\n` : "") +
      `提交形式：${CATEGORY_CN[category] || category}；单个文件大小不超过${sizeLimit}MB。\n` +
      `可见范围：${visible ? "全班可见" : "仅教师可见"}；${
        allowLike ? "允许同学点赞互评" : "不开放点赞"
      }。\n` +
      `课内完成（约${est}分钟）：先规划再动手，完成后请同桌或小组同学看一遍，根据反馈修改后提交，当场展示互评。`;
    activities.push({
      ...PROJECT_ACT_TEMPLATE,
      stage: "项目",
      name: `项目提交：${title}（课内完成，约${est}分钟）`,
      content,
      questions: [],
    } as ManualActivity);
  }

  return activities;
}

/** 补齐段末句号 */
function ensurePeriod(text: string): string {
  const t = (text || "").trimEnd();
  if (!t) return t;
  // 防御：结尾连续句号只保留一个（AI 生成内容可能自带重复句号）
  const deduped = t.replace(/[。．]{2,}$/, (m) => m[m.length - 1]);
  if (/[。．.！？!?；;：:…~～”』」）)\]】>》]$/.test(deduped)) return deduped;
  return deduped + "。";
}

/** 去掉活动名称里的类型前缀与尾部括号说明，取纯标题 */
function cleanActTitle(name: string): string {
  let t = name || "";
  for (const pre of ["对话活动：", "探究活动：", "课堂作业：", "项目提交："]) {
    if (t.startsWith(pre)) {
      t = t.slice(pre.length);
      break;
    }
  }
  t = t.replace(/（[^）]*）$/, "");
  return t.trim();
}

/** 兜底模板：生成吸引学生继续学习的过渡语（50-100 字） */
function buildTransition(prev: ManualActivity, next: ManualActivity): string {
  const pt = cleanActTitle(prev.name);
  const nt = cleanActTitle(next.name);
  const ptype = prev.type;
  const ntype = next.type;
  const pstage = prev.stage;
  const nstage = next.stage;
  let prevOutcome: string;
  if (ptype === "对话") {
    prevOutcome = (
      {
        导入: `学生围绕「${pt}」畅所欲言，说出了自己的经历与疑问`,
        新授: `学生在「${pt}」的交流中初步理解了本课的核心内容`,
        练习总结: `「${pt}」带着学生回顾梳理了本课要点`,
      } as Record<string, string>
    )[pstage] || `学生围绕「${pt}」充分表达了自己的想法`;
  } else {
    prevOutcome = (
      {
        探究: `学生通过操作「${pt}」，亲身体验了知识形成的过程`,
        作业: `「${pt}」检验了学生对核心知识的掌握情况`,
        项目: `「${pt}」把课堂所学延伸到了真实任务中`,
      } as Record<string, string>
    )[ptype] || `「${pt}」顺利完成`;
  }
  let nextHook: string;
  if (ntype === "对话") {
    nextHook = (
      {
        导入: `先别急着翻篇，还有更有意思的在等着大家——进入「${nt}」，咱们接着聊`,
        新授: `不过，老师心里还有个疑问，答案就藏在接下来的对话里——进入「${nt}」，一起把它找出来`,
        练习总结: `学到这里，该收个尾了——进入「${nt}」，把这节课最要紧的东西记牢`,
      } as Record<string, string>
    )[nstage] || `进入「${nt}」，看看这一话题还能带给我们什么惊喜`;
  } else if (ntype === "探究") {
    nextHook = `纸上得来终觉浅，亲自试一试才知道其中的门道——进入「${nt}」，动手验证刚才的想法`;
  } else if (ntype === "作业") {
    nextHook = `说得好不如做得好，现在轮到大显身手的时候了——进入「${nt}」，检验一下今天的收获`;
  } else {
    nextHook = `终于到了最考验本领的环节——课内完成「${nt}」，让作品替你说话`;
  }
  return `${prevOutcome}。${nextHook}。`;
}

// ---------------------------------------------------------------------------
// Word 文档生成
// ---------------------------------------------------------------------------

// 样式常量（与 python 版一致）
const FONT_EAST = "宋体";
const FONT_ASCII = "Times New Roman";
const TITLE_SIZE = 52; // 26pt
const H1_SIZE = 32; // 16pt
const H2_SIZE = 26; // 13pt
const BODY_SIZE = 24; // 12pt
const SMALL_SIZE = 21; // 10.5pt

const COLOR_TITLE = "143256"; // 封面深蓝
const COLOR_HEADING = "1A3C6E"; // 标题深蓝
const COLOR_ACCENT = "2B6CB0"; // 冷蓝（编号/点缀）
const COLOR_HINT = "6B7A90"; // 提示：冷灰
const COLOR_ANSWER = "1A8C3A"; // 答案绿
const COLOR_BODY = "000000";
const COLOR_COVER_ACCENT = "7FB3D5"; // 封面装饰线（亮冷蓝）
const SHADE_H1 = "EAF0F8"; // 章节标题底（浅蓝）
const SHADE_H2 = "EDF4FB"; // 活动标题底（浅冷蓝）
const SHADE_OP = "F1F7FD"; // 操作要点卡片底
const LINE_H1 = "1A3C6E";
const LINE_OP = "2B6CB0";
const LINE_WRITE = "B9C4CF"; // 反思填写线

/** 半磅换算：Pt(x) -> 半磅 */
const pt = (v: number) => v * 2;

export async function generateManualDocx(
  data: ManualTaskInput
): Promise<Buffer> {
  // ---- 解析输入 ----
  let rawTitle = data.title || "";
  let source = "";
  let taskTitle = rawTitle;
  if (rawTitle.includes("_来源于_")) {
    const parts = rawTitle.split("_来源于_");
    taskTitle = parts[0];
    source = parts[1] || "";
  }
  const teacher = data.teacher || "";
  const school = data.school || "";
  const grade = data.grade || "";
  const subject = data.subject || "";
  const objectives = data.description || "";

  // 汇总所有题目
  const questions: ManualQuestion[] = [];
  for (const quiz of data.quizActivities || []) {
    questions.push(...(quiz.questions || []));
  }
  const total = questions.length;

  // 确定学段与核心素养维度
  const stage = inferStage(grade, subject);
  const selectedComps = selectCompetencies(subject, stage);

  // 构建教学活动
  const activities = buildLessonActivities(data, taskTitle);

  // 课堂目标条目拆分（按分号/换行）
  const objItems = objectives
    .split(/[\n；;]+/)
    .map((l) => l.replace(/^[ 　·\-]+|[ 　·\-]+$/g, ""))
    .filter(Boolean);

  // 按序号选取目标条目（越界或空时回退）
  const pickGoal = (...indices: number[]): string => {
    if (objItems.length === 0) return "";
    const picked = indices
      .filter((i) => i >= 1 && i <= objItems.length)
      .map((i) => objItems[i - 1]);
    return (picked.length > 0 ? picked : objItems).join("；");
  };

  // ---- 活动时长约束：总时长不超过 30 分钟，放不下的移入备用 ----
  const standard = lessonMinutes(grade);
  const ACTIVITY_LIMIT = 30;
  let totalMinutes = activities.reduce((s, a) => s + a.estimated_time, 0);
  const nActs = activities.length;
  let compressed = false;
  let backup: ManualActivity[] = [];
  if (totalMinutes > ACTIVITY_LIMIT) {
    if (nActs * 6 > ACTIVITY_LIMIT) {
      const maxKeep = Math.floor(ACTIVITY_LIMIT / 6);
      const convs = activities.filter((a) => a.type === "对话");
      const others = activities.filter((a) => a.type !== "对话");
      const ordered = (convs.length ? [convs[0]] : []).concat(others, convs.slice(1));
      if (ordered.length > maxKeep) {
        backup = ordered.slice(maxKeep);
        ordered.length = maxKeep;
      }
      activities.length = 0;
      activities.push(...ordered);
      totalMinutes = activities.reduce((s, a) => s + a.estimated_time, 0);
      compressed = true;
    }
    if (totalMinutes > ACTIVITY_LIMIT) {
      compressed = true;
      const remain = ACTIVITY_LIMIT - 6 * activities.length;
      const orig = activities.map((a) => a.estimated_time);
      const totalOrig = orig.reduce((s, v) => s + v, 0);
      activities.forEach((a, i) => {
        const share = totalOrig ? Math.round((remain * orig[i]) / totalOrig) : 0;
        a.estimated_time = 6 + Math.max(0, share);
      });
      totalMinutes = activities.reduce((s, a) => s + a.estimated_time, 0);
      while (totalMinutes > ACTIVITY_LIMIT) {
        const biggest = activities.reduce((m, a) =>
          a.estimated_time > m.estimated_time ? a : m
        );
        if (biggest.estimated_time <= 6) break;
        biggest.estimated_time -= 1;
        totalMinutes = activities.reduce((s, a) => s + a.estimated_time, 0);
      }
      while (totalMinutes < ACTIVITY_LIMIT) {
        const smallest = activities.reduce((m, a) =>
          a.estimated_time < m.estimated_time ? a : m
        );
        if (smallest.estimated_time >= 6) break;
        smallest.estimated_time += 1;
        totalMinutes = activities.reduce((s, a) => s + a.estimated_time, 0);
      }
      // 压缩后同步活动名称里的时长标注
      for (const a of activities) {
        const t = a.estimated_time;
        if (t) {
          a.name = a.name.replace(/约\d+分钟/, `约${t}分钟`);
        } else {
          a.name = a.name.replace(/（[^）]*）$/, "");
        }
      }
    }
  }
  const typeCount: Record<string, number> = {};
  for (const a of activities) typeCount[a.type] = (typeCount[a.type] || 0) + 1;
  const typeSummary = Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}活动${n}个`)
    .join("、");
  const freeTime = standard - totalMinutes;
  let warnText = "";
  if (compressed && backup.length > 0) {
    warnText = `其中${backup.length}个活动超出30分钟限时，已列为备用（见文末「备用活动」）。`;
  } else if (compressed) {
    warnText = "已按活动不超过30分钟的要求自动压缩各环节时长。";
  }

  // ---- 构建 Word 段落 ----
  const children: Paragraph[] = [];

  const addParagraph = (
    text = "",
    opts: {
      size?: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
      before?: number;
      after?: number;
      line?: number;
      leftIndent?: number;
      firstLine?: number;
      shading?: string;
      borderLeft?: { color: string; size: number; space?: number };
      borderBottom?: { color: string; size: number; space?: number };
    } = {}
  ): Paragraph => {
    const paragraph = new Paragraph({
      children: [
        new TextRun({
          text,
          font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
          size: opts.size ?? BODY_SIZE,
          bold: opts.bold ?? false,
          italics: opts.italic ?? false,
          color: opts.color ?? COLOR_BODY,
        }),
      ],
      alignment: opts.align,
      spacing: {
        before: opts.before,
        after: opts.after,
        line: opts.line ?? 276,
        lineRule: LineRuleType.AUTO,
      },
      indent:
        opts.leftIndent !== undefined || opts.firstLine !== undefined
          ? {
              left: opts.leftIndent,
              firstLine: opts.firstLine,
            }
          : undefined,
      shading: opts.shading
        ? { type: ShadingType.CLEAR, fill: opts.shading }
        : undefined,
      border:
        opts.borderLeft || opts.borderBottom
          ? {
              left: opts.borderLeft
                ? {
                    style: BorderStyle.SINGLE,
                    size: opts.borderLeft.size,
                    color: opts.borderLeft.color,
                    space: opts.borderLeft.space ?? 4,
                  }
                : undefined,
              bottom: opts.borderBottom
                ? {
                    style: BorderStyle.SINGLE,
                    size: opts.borderBottom.size,
                    color: opts.borderBottom.color,
                    space: opts.borderBottom.space ?? 1,
                  }
                : undefined,
            }
          : undefined,
    });
    children.push(paragraph);
    return paragraph;
  };

  // 带多个 TextRun 的段落（活动标题等）
  const addRuns = (
    runs: { text: string; size: number; bold: boolean; color: string }[],
    opts: {
      before?: number;
      after?: number;
      leftIndent?: number;
      shading?: string;
      borderLeft?: { color: string; size: number; space?: number };
    } = {}
  ): Paragraph => {
    const paragraph = new Paragraph({
      children: runs.map(
        (r) =>
          new TextRun({
            text: r.text,
            font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
            size: r.size,
            bold: r.bold,
            color: r.color,
          })
      ),
      spacing: {
        before: opts.before,
        after: opts.after,
        line: 276,
        lineRule: LineRuleType.AUTO,
      },
      indent: opts.leftIndent !== undefined ? { left: opts.leftIndent } : undefined,
      shading: opts.shading
        ? { type: ShadingType.CLEAR, fill: opts.shading }
        : undefined,
      border: opts.borderLeft
        ? {
            left: {
              style: BorderStyle.SINGLE,
              size: opts.borderLeft.size,
              color: opts.borderLeft.color,
              space: opts.borderLeft.space ?? 4,
            },
          }
        : undefined,
    });
    children.push(paragraph);
    return paragraph;
  };

  // 章节标题（杂志栏目头：左竖条 + 浅蓝底 + 大号标题）
  const addH1 = (text: string) => {
    addParagraph(text, {
      size: H1_SIZE,
      bold: true,
      color: COLOR_HEADING,
      before: pt(16),
      after: pt(8),
      leftIndent: 102,
      shading: SHADE_H1,
      borderLeft: { color: LINE_H1, size: 28 },
    });
  };

  // 活动标题（编号 + 名称 + 浅冷蓝底）
  const addH2 = (text: string) => {
    const m = text.match(/^(活动\d+)\s*(.*)$/);
    if (m) {
      addRuns(
        [
          { text: m[1] + "　", size: pt(16), bold: true, color: COLOR_ACCENT },
          { text: m[2], size: H2_SIZE, bold: true, color: COLOR_HEADING },
        ],
        {
          before: pt(14),
          after: pt(6),
          leftIndent: 85,
          shading: SHADE_H2,
          borderLeft: { color: COLOR_COVER_ACCENT, size: 20 },
        }
      );
    } else {
      addParagraph(text, {
        size: H2_SIZE,
        bold: true,
        color: COLOR_HEADING,
        before: pt(14),
        after: pt(6),
        leftIndent: 85,
        shading: SHADE_H2,
        borderLeft: { color: COLOR_COVER_ACCENT, size: 20 },
      });
    }
  };

  // 正文段落
  const addBody = (
    text: string,
    opts: { bold?: boolean; italic?: boolean; color?: string; indent?: boolean } = {}
  ) => {
    addParagraph(text, {
      size: BODY_SIZE,
      bold: opts.bold ?? false,
      italic: opts.italic ?? false,
      color: opts.color ?? COLOR_BODY,
      after: pt(5),
      firstLine: opts.indent ? 420 : undefined,
    });
  };

  // 封面信息行（居中）
  const addCoverLine = (text: string, size: number, bold: boolean, color: string) => {
    addParagraph(text, {
      size,
      bold,
      color,
      align: AlignmentType.CENTER,
      after: pt(4),
    });
  };

  // 过渡语（灰色斜体 + 左侧竖线）
  const addTransition = (text: string) => {
    addParagraph(ensurePeriod(text), {
      size: BODY_SIZE,
      italic: true,
      color: COLOR_HINT,
      before: pt(10),
      after: pt(8),
      leftIndent: 283,
      borderLeft: { color: COLOR_COVER_ACCENT, size: 14 },
    });
  };

  // 标签 + 正文
  const addLabelBody = (
    label: string,
    text: string,
    opts: { labelColor?: string; bodyColor?: string; period?: boolean } = {}
  ) => {
    const paragraph = new Paragraph({
      children: [
        new TextRun({
          text: label,
          font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
          size: BODY_SIZE,
          bold: true,
          color: opts.labelColor ?? COLOR_BODY,
        }),
        new TextRun({
          text: opts.period === false ? text : ensurePeriod(text),
          font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
          size: BODY_SIZE,
          color: opts.bodyColor ?? COLOR_BODY,
        }),
      ],
      spacing: { after: pt(3), line: 276, lineRule: LineRuleType.AUTO },
    });
    children.push(paragraph);
  };

  // 标签 + 多行正文（每行单独段落）
  const addMultilineBody = (label: string, text: string, labelColor?: string) => {
    const lines = (text || "").split("\n").map((l) => l.trim());
    lines.forEach((line, i) => {
      if (i === 0) {
        addLabelBody(label, line, { labelColor });
      } else if (line) {
        addBody(ensurePeriod(line), { indent: true });
      }
    });
  };

  // 操作要点卡片：标题段（浅蓝底 + 左竖线）+ 缩进步骤行
  const addOperationsBlock = (title: string, text: string) => {
    addParagraph(title, {
      size: BODY_SIZE,
      bold: true,
      color: COLOR_HEADING,
      before: pt(10),
      after: pt(2),
      leftIndent: 142,
      shading: SHADE_OP,
      borderLeft: { color: LINE_OP, size: 18 },
    });
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      addParagraph(ensurePeriod(line.trim()), {
        size: BODY_SIZE,
        after: pt(2),
        leftIndent: 283,
      });
    }
  };

  // 章节间距占位段
  const addSeparator = () => {
    addParagraph("", { after: pt(1), line: 276 });
  };

  const addDots = () => {
    addParagraph("", { after: pt(2), line: 276 });
  };

  // 反思填写线（段落底边框）
  const addWriteLine = () => {
    addParagraph("", {
      before: pt(8),
      after: 0,
      borderBottom: { color: LINE_WRITE, size: 8, space: 1 },
    });
  };

  // ===================================================================
  // 封面
  // ===================================================================
  const coverTitle = `${taskTitle} 教学手册`;
  addParagraph(coverTitle, {
    size: TITLE_SIZE,
    bold: true,
    color: COLOR_TITLE,
    align: AlignmentType.CENTER,
    before: pt(6),
    after: pt(6),
  });
  // 装饰线（段落底边框）
  addParagraph("", {
    before: pt(4),
    after: pt(8),
    borderBottom: { color: COLOR_COVER_ACCENT, size: 14, space: 1 },
  });
  const whoLine = `${teacher || "（待填写）"} · ${school || "（待填写）"}`;
  let verLine = `${grade || "年级待定"} · ${subject || "学科待定"}`;
  if (source) verLine += ` · ${source}`;
  addCoverLine(whoLine, pt(13), true, COLOR_HEADING);
  addCoverLine(verLine, pt(11), false, COLOR_HINT);
  addSeparator();

  // ===================================================================
  // 一、教学目标
  // ===================================================================
  addH1("一、教学目标");
  if (selectedComps.length > 0) {
    const useObjMap =
      Boolean(objectives) && objItems.length === selectedComps.length;
    selectedComps.forEach(([compName], i) => {
      const goal = useObjMap ? objItems[i] : generateLessonGoal(compName, taskTitle, questions);
      addBody(ensurePeriod(`${i + 1}. ${compName}，${goal}`), { indent: true });
    });
  } else if (objItems.length > 0) {
    objItems.forEach((line, i) => {
      addBody(ensurePeriod(`${i + 1}. ${line}`), { indent: true });
    });
  } else {
    addBody(
      `（未找到${subject}学科在${stage}阶段的核心素养参考，请手动补充教学目标）`,
      { italic: true, color: COLOR_HINT, indent: true }
    );
  }

  // ===================================================================
  // 二、教学活动
  // ===================================================================
  addH1("二、教学活动");
  addBody(
    `本课共${activities.length}个活动：${typeSummary}，活动共约${totalMinutes}分钟（不超过30分钟，尽量不排满），全部在课内完成、无课后任务。` +
      (warnText || "") +
      `另预留约${freeTime}分钟（${standard}分钟课时）供师生自由交流。顺序可根据实际学情调整。`,
    { indent: true }
  );
  addSeparator();

  activities.forEach((activity, ai) => {
    const typeTag = `【${activity.type}】`;
    addH2(`活动${ai + 1}　${typeTag} ${activity.name}`);

    // 活动目标：与课堂教学目标一致（按环节引用目标条目）
    const actType = activity.type;
    const actStage = activity.stage;
    let goalText = "";
    if (actType === "对话" && actStage === "导入") goalText = pickGoal(1);
    else if (actType === "对话" && actStage === "练习总结")
      goalText = objItems.length ? pickGoal(objItems.length) : "";
    else if (actType === "对话") goalText = pickGoal(2);
    else if (actType === "探究") goalText = pickGoal(2, 3);
    else if (actType === "作业") goalText = objItems.join("；");
    else if (actType === "项目")
      goalText = objItems.length ? pickGoal(objItems.length) : "";
    if (goalText) {
      addLabelBody("【活动目标】", "指向本课教学目标：" + goalText, {
        labelColor: COLOR_ACCENT,
      });
    } else {
      addLabelBody("【活动目标】", activity.goal, { labelColor: COLOR_ACCENT });
    }

    addMultilineBody("【活动内容】", activity.content, COLOR_ACCENT);
    addLabelBody("【教师指导】", activity.guidance, { labelColor: COLOR_ACCENT });
    addMultilineBody("【学生反馈应对】", activity.feedback, COLOR_ACCENT);

    if (activity.quickclass_guide) {
      addOperationsBlock("▶ 操作要点（QuickClass）", activity.quickclass_guide);
    }

    // 本活动涉及的题目
    if (activity.questions && activity.questions.length > 0) {
      addBody("本活动涉及题目：", { bold: true, color: COLOR_BODY });
      for (const q of activity.questions) {
        const qOrder = (q.order ?? 0) + 1;
        const qTypeCn = TYPE_CN[q.type || "SINGLE_CHOICE"] || q.type || "";
        const qDiffCn = DIFFICULTY_CN[q.difficulty || "BASIC"] || q.difficulty || "";
        const qContent = q.content || "";
        const preview = qContent.length > 50 ? qContent.slice(0, 50) + "..." : qContent;
        addBody(`第${qOrder}题（${qTypeCn} · ${qDiffCn}）：${preview}`, {
          indent: true,
        });
      }
    }

    // 活动间过渡语
    if (ai < activities.length - 1) {
      addTransition(buildTransition(activity, activities[ai + 1]));
      addDots();
    }
  });

  // ===================================================================
  // 三、课堂作业设计
  // ===================================================================
  addH1("三、课堂作业设计");
  if (total === 0) {
    addBody(
      "本课未配置课堂作业题目。如需检测学习效果，可在 QuickClass 平台的课堂中补充课堂作业活动后重新生成本手册。",
      { italic: true, color: COLOR_HINT, indent: true }
    );
  }
  addBody("（一）逐题内容", { bold: true, color: COLOR_BODY });
  addBody("每题已标注题型与难度，参考答案及教学建议供教师参考。", {
    indent: true,
  });
  addSeparator();

  const sortedQuestions = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const q of sortedQuestions) {
    const qOrder = (q.order ?? 0) + 1;
    const qType = q.type || "SINGLE_CHOICE";
    const qTypeCn = TYPE_CN[qType] || qType;
    const qContent = q.content || "";
    const qOptions = q.options || "";
    const qAnswer = q.answer || "";
    const qDifficulty = q.difficulty || "BASIC";
    const qDifficultyCn = DIFFICULTY_CN[qDifficulty] || qDifficulty;
    const qExplanation = q.explanation || "";
    const optsList = parseOptions(qOptions, qType);

    // 题目标题（左竖线 + 题号 + 类型难度）
    addRuns(
      [
        { text: `第 ${qOrder} 题  `, size: pt(14), bold: true, color: COLOR_ACCENT },
        { text: `（${qTypeCn} · ${qDifficultyCn}）`, size: BODY_SIZE, bold: false, color: COLOR_HINT },
      ],
      {
        before: pt(12),
        after: pt(4),
        leftIndent: 142,
        borderLeft: { color: LINE_OP, size: 18 },
      }
    );

    addLabelBody("【题目】", qContent);
    if (optsList.length > 0) {
      for (const [letter, optText] of optsList) {
        addParagraph(`${letter}. ${optText}`, {
          size: BODY_SIZE,
          leftIndent: 567,
        });
      }
    }
    addLabelBody("【参考答案】", formatAnswer(qAnswer, qType), {
      labelColor: COLOR_ANSWER,
      bodyColor: COLOR_ANSWER,
      period: false,
    });
    if (qExplanation) {
      addLabelBody("【解析】", qExplanation);
    }
    addLabelBody(
      "【教学建议】",
      DIFFICULTY_GUIDANCE[qDifficulty] || DIFFICULTY_GUIDANCE["BASIC"],
      { labelColor: COLOR_ACCENT }
    );
    const mistakes = TYPE_COMMON_MISTAKES[qType];
    if (mistakes) {
      addLabelBody("【常见错误】", mistakes, { labelColor: COLOR_ACCENT });
    }
    addDots();
  }

  // ===================================================================
  // 四、教学反思
  // ===================================================================
  addH1("四、教学反思");
  addBody("课后按以下维度自评并记录，供下次备课参考。", { indent: true });

  const reflectionItems: [string, string][] = [
    [
      "核心素养达成度",
      "检视学生在核心素养各维度上的表现是否达到预期目标。结合作业正确率和课堂表现评估，记录哪些维度达标、哪些需加强。",
    ],
    [
      "教学活动实效",
      "反思各活动的设计是否合理：时间分配是否适当、学生参与度如何、分层指导是否落实。记录最成功和最待改进的活动。",
    ],
    [
      "作业设计合理性",
      "评估题目难度梯度是否合理、题型覆盖是否齐全、是否覆盖了核心知识点。记录错误率最高的题目，分析原因（概念不清/方法不会/审题失误）。",
    ],
    [
      "学生反馈与差异化教学",
      "记录不同层次学生的表现差异，反思是否对基础薄弱学生给予了足够支持，对学有余力学生提供了拓展空间。设想下节课的分层调整方案。",
    ],
    [
      "教师自我评价",
      "反思本节课的教学节奏、语言表达、问题设计、师生互动等方面。记录最满意和最遗憾的环节，制定下节课改进计划。",
    ],
  ];

  for (const [label, content] of reflectionItems) {
    addBody(`${label}：`, { bold: true, color: COLOR_ACCENT, indent: true });
    addBody(content, { indent: true });
    addWriteLine();
    addWriteLine();
    addParagraph("", { after: pt(0) });
  }
  addSeparator();

  // ===================================================================
  // 五、备用活动
  // ===================================================================
  if (backup.length > 0) {
    addH1("五、备用活动");
    addBody(
      `以下 ${backup.length} 个活动超出 30 分钟活动限时，已从本课常规流程中移出，列为备用。课时充裕、学生兴趣高或当堂任务完成较快时，可从中选用，不作常规安排。`,
      { indent: true }
    );
    backup.forEach((b, bi) => {
      addH2(`备用${bi + 1}　${b.name}`);
      if (b.goal) addLabelBody("【活动目标】", b.goal);
      if (b.content) addMultilineBody("【活动内容】", b.content);
      if (b.quickclass_guide) {
        addOperationsBlock("▶ 操作要点（QuickClass）", b.quickclass_guide);
      }
      if (bi < backup.length - 1) addDots();
    });
    addSeparator();
  }

  // 末尾说明
  addParagraph(
    "说明：本教学手册由 QuickClass 课堂 JSON 自动生成，教学目标按学科核心素养描写，教学流程依据课堂中配置的四类活动逐条生成，教师可根据实际学情灵活调整。",
    {
      size: SMALL_SIZE,
      italic: true,
      color: COLOR_HINT,
      align: AlignmentType.LEFT,
      after: pt(5),
    }
  );

  // ---- 页脚页码 ----
  const footer = new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            children: [PageNumber.CURRENT],
            font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
            size: pt(9),
            color: COLOR_HINT,
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });

  const docxDoc = new Document({
    creator: "QuickClass",
    title: coverTitle,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1797,
              right: 1797,
              footer: 720,
            },
          },
        },
        footers: { default: footer },
        children,
      },
    ],
  });

  return await Packer.toBuffer(docxDoc);
}
