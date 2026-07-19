import { streamText } from "ai";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import type { ResearchDataSnapshot } from "./data-collector";

export interface PaperContent {
  docType: "PAPER";
  title: string;
  abstract: string;
  keywords: string[];
  sections: { title: string; content: string }[];
  references: string[];
}

export interface ProposalContent {
  docType: "PROPOSAL";
  title: string;
  sections: { title: string; content: string }[];
  references: string[];
}

// ── Token 估算（中文约 1.8 字符/token，英文约 4 字符/token） ──
const CHARS_PER_TOKEN = 1.8;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── 模型上下文窗口上限 ──
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "qwen-turbo": 1_000_000,
  "qwen-plus": 131_072,
  "qwen-max": 32_768,
};

// 从系统配置读取实际模型名，以此决定安全上限
async function getEffectiveModelLimit(): Promise<number> {
  try {
    const { getAIConfig } = await import("@/lib/ai");
    const config = await getAIConfig();
    const model = config.model || "qwen-turbo";
    return MODEL_CONTEXT_LIMITS[model] || 32_768;
  } catch {
    return 1_000_000; // 失败时取最大安全值
  }
}

// 留给系统提示词 + 生成输出的 token 余量
const OUTPUT_TOKEN_BUFFER = 12_000;

export async function* streamPaperGeneration(
  title: string,
  data: ResearchDataSnapshot,
  paperStyle?: "PRACTICE_RESEARCH" | "CASE_ANALYSIS"
): AsyncGenerator<string, PaperContent, void> {
  const { chatModel } = await createDashScopeClient();
  const prompt = await buildPaperPrompt(title, data, paperStyle);

  const result = await aiQueue.enqueue(async () => {
    return streamText({
      model: chatModel,
      system: "你是教育学领域资深学者，擅长撰写实证研究论文。",
      prompt,
    });
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    yield chunk;
  }

  return parsePaperContent(fullText, title);
}

export async function* streamProposalGeneration(
  title: string,
  data: ResearchDataSnapshot,
  researchMethod?: string
): AsyncGenerator<string, ProposalContent, void> {
  const { chatModel } = await createDashScopeClient();
  const prompt = await buildProposalPrompt(title, data, researchMethod);

  const result = await aiQueue.enqueue(async () => {
    return streamText({
      model: chatModel,
      system: "你是资深教育研究专家，擅长撰写课题研究方案。",
      prompt,
      maxOutputTokens: 14000, // 保障 8500-10000 中文字输出不被截断（AI SDK v6 字段名）
    });
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    yield chunk;
  }

  return parseProposalContent(fullText, title);
}

// ── 数据节构建（mode = "full" 全量 / "stats-only" 仅统计摘要） ──
type SectionMode = "full" | "stats-only";

function buildDataSections(data: ResearchDataSnapshot, mode: SectionMode): string {
  const { scope, quizData, conversationData, quizReports, conversationReports, dataQuality } = data;
  const parts: string[] = [];

  // ── 范围信息（不受 mode 影响） ──
  const typeLabels: Record<string, string> = {
    quiz: "作业数据", conversation: "对话数据",
    quizReport: "作业报告", conversationReport: "对话报告",
  };
  parts.push(`## 数据来源范围
- 选中的课堂：${scope.classNames.join("、") || "（无）"}
- 覆盖学生数：${scope.studentCount} 人
- 选中的数据类：${scope.selectedDataTypes.map(t => typeLabels[t] || t).join("、")}
`);

  // ── 作业数据 ──
  if (quizData && quizData.perQuizStats.length > 0) {
    const lines: string[] = [`## 作业数据`];
    lines.push(``);
    lines.push(`### 总体统计`);
    lines.push(`- 总提交次数：${quizData.totalAttempts}`);
    lines.push(`- 已完成提交：${quizData.completedAttempts}`);
    lines.push(`- 未完成提交：${quizData.incompleteAttempts}`);
    lines.push(``);
    lines.push(`### 各作业统计`);
    for (const q of quizData.perQuizStats) {
      lines.push(`#### ${q.taskTitle} — ${q.quizTitle}`);
      lines.push(`- 题目数：${q.questionCount}，提交数：${q.totalSubmissions}`);
      lines.push(`- 完成率：${q.completionRate}%，平均分：${q.avgScorePercent}分，及格线：${q.passScore}分，及格率：${q.passRate}%`);
      lines.push(`- 分数分布：优秀≥90分${q.scoreDistribution.excellent}人 / 良好≥75分${q.scoreDistribution.good}人 / 及格≥60分${q.scoreDistribution.average}人 / 不及格${q.scoreDistribution.poor}人`);
      lines.push(`- 各题正确率：${q.questionStats.map(qs => `"${qs.content}"（${qs.type}）${qs.correctRate}%`).join("；")}`);
      lines.push(``);
    }
    // 全量模式下包含答题样本；stats-only 跳过
    if (mode === "full" && quizData.attempts.length > 0) {
      lines.push(`### 学生答题样本（共 ${quizData.attempts.length} 条）`);
      for (const a of quizData.attempts) {
        lines.push(`- ${a.studentName} | ${a.quizTitle} | 得分：${a.scorePercent}% | 正确 ${a.correctCount}/${a.totalQuestions}`);
      }
    }
    parts.push(lines.join("\n"));
  }

  // ── 对话数据 ──
  if (conversationData) {
    const lines: string[] = [`## 对话数据`];
    lines.push(``);
    lines.push(`### 总体统计`);
    lines.push(`- 总对话数：${conversationData.totalConversations}`);
    lines.push(`- 总消息数：${conversationData.totalMessages}`);
    lines.push(``);
    lines.push(`### 各对话活动统计`);
    for (const p of conversationData.perPreset) {
      lines.push(`#### ${p.presetTitle}`);
      lines.push(`- 对话数：${p.conversationCount}，消息数：${p.messageCount}`);
      if (p.topicSamples.length > 0) {
        const sampleStrs = p.topicSamples.map(t =>
          `"${t.title}"（${t.studentName}，${t.messageCount}条消息）`
        );
        lines.push(`- 主题样本：${sampleStrs.join("、")}`);
      }
      lines.push(``);
    }
    // 全量模式包含对话原文；stats-only 跳过
    if (mode === "full" && conversationData.conversations.length > 0) {
      lines.push(`### 对话原文（共 ${conversationData.conversations.length} 个对话）`);
      for (const c of conversationData.conversations) {
        lines.push(`#### [${c.studentName}] ${c.title}（${c.presetTitle || "无预设"}，共${c.messageCount}条消息）`);
        for (const m of c.messages) {
          const roleLabel = m.role === "student" ? "学生" : "AI";
          lines.push(`${roleLabel}：${m.content}`);
        }
        lines.push(``);
      }
    }
    parts.push(lines.join("\n"));
  }

  // ── 作业报告（全量 / stats-only 均包含正文，因为报告本身已是摘要） ──
  if (quizReports && quizReports.length > 0) {
    const lines: string[] = [`## 作业报告（AI 班级分析报告）`];
    lines.push(``);
    for (const r of quizReports) {
      lines.push(`### ${r.taskTitle} — ${r.quizTitle}（版本 ${r.version}，生成于 ${r.createdAt}）`);
      lines.push(`#### 统计快照`);
      lines.push(`- 参与人数：${r.stats.participantCount}，完成率：${r.stats.completionRate}%，及格率：${r.stats.passRate}%，平均分：${r.stats.avgScorePercent}`);
      if (mode === "full") {
        lines.push(`#### 报告正文`);
        lines.push(r.content);
      }
      lines.push(``);
    }
    parts.push(lines.join("\n"));
  }

  // ── 对话报告（同上，报告正文本身已是摘要） ──
  if (conversationReports && conversationReports.length > 0) {
    const lines: string[] = [`## 对话报告（AI 班级分析报告）`];
    lines.push(``);
    for (const r of conversationReports) {
      lines.push(`### ${r.taskTitle} — ${r.presetTitle}（版本 ${r.version}，生成于 ${r.createdAt}）`);
      lines.push(`- 相关对话数：${r.conversationCount}`);
      if (mode === "full") {
        lines.push(`#### 报告正文`);
        lines.push(r.content);
      }
      lines.push(``);
    }
    parts.push(lines.join("\n"));
  }

  // ── 数据质量 ──
  if (dataQuality.warnings.length > 0) {
    parts.push(`## 数据质量说明\n${dataQuality.warnings.map(w => `- ⚠️ ${w}`).join("\n")}\n`);
  }

  return parts.join("\n\n");
}

// ── 自适应：先尝试全量，超限则降级到统计摘要 ──
async function buildDataSectionsAdaptive(data: ResearchDataSnapshot): Promise<{
  text: string;
  mode: "full" | "stats-only";
}> {
  const modelLimit = await getEffectiveModelLimit();
  const safeLimit = modelLimit - OUTPUT_TOKEN_BUFFER;

  // 先建统计摘要版（体积很小）
  const statsText = buildDataSections(data, "stats-only");
  const statsTokens = estimateTokens(statsText);

  // 如果连统计摘要都超限（极端情况），直接返回统计摘要
  if (statsTokens > safeLimit) {
    return { text: statsText, mode: "stats-only" };
  }

  // 尝试全量版
  const fullText = buildDataSections(data, "full");
  const fullTokens = estimateTokens(fullText);

  if (fullTokens <= safeLimit) {
    return { text: fullText, mode: "full" };
  }

  // 超限 → 降级到 stats-only，并在数据质量段说明
  const warningLine = `\n## 数据量提示\n- 全量数据估算约 ${fullTokens.toLocaleString()} token，超出模型窗口（${modelLimit.toLocaleString()} token）安全限值，已自动降级为统计摘要模式。\n- 如需使用全量数据，建议减少选中的课堂或数据类型。\n`;
  return { text: statsText + warningLine, mode: "stats-only" };
}

async function buildPaperPrompt(
  title: string,
  data: ResearchDataSnapshot,
  paperStyle?: "PRACTICE_RESEARCH" | "CASE_ANALYSIS"
): Promise<string> {
  const { text: dataSection, mode } = await buildDataSectionsAdaptive(data);
  const modeNote = mode === "stats-only"
    ? "\n> 注：以下数据为统计摘要版。对话原文和报告正文因超出模型窗口上限未包含。论文中的具体案例可基于统计特征合理推导。"
    : "";

  if (paperStyle === "CASE_ANALYSIS") {
    return buildPracticeCasePaperPrompt(title, dataSection, modeNote);
  }
  // 默认为 PRACTICE_RESEARCH（含未指定）
  return buildPracticeResearchPaperPrompt(title, dataSection, modeNote);
}

// ── 实践研究类（6 要素：引言→理论依据→实施路径→案例分析→效果评价→结语） ──
function buildPracticeResearchPaperPrompt(title: string, dataSection: string, modeNote: string): string {
  return `基于以下真实数据和选定题目，撰写一份完整的"实践研究类"教育学术论文初稿。
本论文适用于整体性教学改革（学段/单元/课程层级的实践探索），需呈现完整的研究过程与教学效果。

# 论文题目
${title}

# 数据基础
${dataSection}${modeNote}

# 论文结构（8500-10000字）

## 摘要（约300字）

## 一、引言（约1600字）
- 1. 问题提出（政策背景、学科现状、教学痛点）
- 2. 研究目的与意义
- 3. 核心概念界定

## 二、理论依据（约900字）
- 1. 理论基础（引用课标/课程标准/学科素养框架）
- 2. 国内外相关研究综述

## 三、实施路径（约1600字）
- 1. 研究设计（对象、周期、变量）
- 2. 具体策略与实施步骤（按时间或教学阶段展开）
- 3. 教学案例实施片段（呈现典型课例的关键教学环节）

## 四、案例分析（约2200字）
- 1. 案例1：[具体课例] — 教学设计、教学过程、学生表现、教学效果
- 2. 案例2：[可选：另一典型课例]
- 3. 案例共性提炼与差异分析

## 五、效果评价（约1500字）
- 1. 数据结果（学生作业、对话、课堂表现等量化指标）
- 2. 学生反馈与教师反思
- 3. 存在问题与改进方向

## 六、结语（约800字）
- 研究结论
- 教学启示
- 研究局限

## 参考文献
不少于20篇，GB/T 7714 格式。

# 输出格式（严格遵守标记）
[ABSTRACT_START]
摘要内容...
[ABSTRACT_END]
[KEYWORDS_START]
关键词1；关键词2；...
[KEYWORDS_END]
[SECTION_START]
一、引言
章节内容...
[SECTION_END]
[SECTION_START]
二、理论依据
章节内容...
[SECTION_END]
[SECTION_START]
三、实施路径
章节内容...
[SECTION_END]
[SECTION_START]
四、案例分析
章节内容...
[SECTION_END]
[SECTION_START]
五、效果评价
章节内容...
[SECTION_END]
[SECTION_START]
六、结语
章节内容...
[SECTION_END]
[REFERENCES_START]
[1] 参考文献1
[2] 参考文献2
...
[REFERENCES_END]

# 写作要求
- 学术语言严谨
- 数据引用真实具体
- 必须呈现真实可复现的教学案例（含师生对话或学生活动）
- 案例需具体到教材版本/单元/板块
- 必须基于上述提供的数据撰写分析，不能编造数据

## ⚠️ 字数硬性规定（必须遵守）
- **全文总字数不得少于 8500 字**（约 9 段，每段约 950-1000 字）
- 摘要 300 + 引言 1600 + 理论 900 + 实施 1600 + 案例 2200 + 评价 1500 + 结语 800 ≈ **8900 字**
- 不足 8500 字将被判定为不合格，必须扩写充实每一章节

## ⚠️ 文中引用与参考文献规范（必须遵守）
- **正文中所有引用观点、数据、理论的句子末尾，必须用上标格式标注**，如：「……核心素养导向下的教学实践[1]……」「……深度学习理论认为[2]……」
- **每条引用至少在正文中出现 1-3 次**，确保引用真实被使用
- 参考文献必须使用 **GB/T 7714 格式**，每条独立成行
- 参考文献必须包含 20-30 篇，覆盖：课程标准文件、教育学经典著作、学科教学期刊、近 5 年实证研究
- 编号规则：从 [1] 开始严格递增，禁止重复编号（如 [1][1]）、禁止跳号（如 [1][3]）
- 参考文献示例：
  - 期刊：[1] 王蔷. 英语课程标准的关键能力解读[J]. 中小学外语教学, 2022, 45(3): 1-8.
  - 著作：[2] 皮亚杰. 儿童智力的起源[M]. 北京: 教育科学出版社, 1990: 25.
  - 课标：[3] 中华人民共和国教育部. 义务教育英语课程标准(2022年版)[S]. 北京: 北京师范大学出版社, 2022.

# 关于图示的建议
- 论文的图没有统一标准，AI 应根据内容判断是否需要插入图示（如研究框架图、技术路线图、概念模型图、案例实施流程图、效果对比图等）
- **只在确实需要图示的章节**插入，不要每章都加
- 如需要图示，**在对应章节的正文内容中**输出占位标记：
  [FIGURE_PLACEHOLDER_START]图示内容描述（30-80字）[FIGURE_PLACEHOLDER_END]
- 描述要具体：说明图要表达什么内容、关键要素、视觉布局
- 示例：研究框架图，呈现"理论构建→研究设计→数据收集→效果分析→结论提炼"五阶段逻辑
- 实际图片由作者根据描述自行绘制后插入对应位置
- 如论文不需要图示，则**不输出任何占位标记**`;
}

// ── 案例分析类（6 章节：引言→理论依据→教学设计原则→教学案例展示→教学反思→结语） ──
function buildPracticeCasePaperPrompt(title: string, dataSection: string, modeNote: string): string {
  return `基于以下真实数据和选定题目，撰写一份完整的"案例分析类"教育学术论文初稿。
本论文适用于单课时/单案例的精读与剖析，聚焦一个或数个典型教学案例的深度分析。

# 论文题目
${title}

# 数据基础
${dataSection}${modeNote}

# 论文结构（8500-9500字）

## 摘要（约300字）
简述案例背景、教学设计与主要发现。

## 一、引言（约1200字）
- 案例选取缘由（典型性、代表性、问题指向）
- 案例背景（学科、学段、教材版本、单元）

## 二、理论依据（约1000字）
- 核心概念界定
- 理论框架（指导本案例分析的关键理论）

## 三、教学设计原则（约1100字）
- 教学设计的基本理念
- 教学目标设定（基于课标）
- 教学策略选择
- 评价方式设计

## 四、教学案例展示（约2800字）

【案例】教材版本 + 单元 + 板块 + 教学对象
- 教学目标
- 教学过程：
  - 教学环节 1（教师活动、学生活动）
  - 教学片段实录（T 教师话语 / S 学生话语 / Ss 集体 / (动作/活动)）
  - 教学环节 2 ...
- 学生作品/成果展示
- 设计意图说明

【可选：第二个对比案例】

## 五、教学反思（约1300字）
- 案例成功之处
- 学生反馈与效果评估
- 教学中的问题与改进方向
- 对同类型教学的启示

## 六、结语（约800字）
- 核心结论
- 推广价值

## 参考文献
不少于15篇，GB/T 7714 格式。

# 输出格式（严格遵守标记）
[ABSTRACT_START]
摘要内容...
[ABSTRACT_END]
[KEYWORDS_START]
关键词1；关键词2；...
[KEYWORDS_END]
[SECTION_START]
一、引言
章节内容...
[SECTION_END]
[SECTION_START]
二、理论依据
章节内容...
[SECTION_END]
[SECTION_START]
三、教学设计原则
章节内容...
[SECTION_END]
[SECTION_START]
四、教学案例展示
章节内容...
[SECTION_END]
[SECTION_START]
五、教学反思
章节内容...
[SECTION_END]
[SECTION_START]
六、结语
章节内容...
[SECTION_END]
[REFERENCES_START]
[1] 参考文献1
[2] 参考文献2
...
[REFERENCES_END]

# 写作要求
- 学术语言严谨
- 案例描述具体、真实、可复现
- 师生对话必须呈现原貌（T: ... / S: ... / Ss: ... 标注）
- 案例中所有学生姓名模糊化（用 S1、S2 或化名）
- 必须基于上述提供的数据撰写分析，不能编造数据

## ⚠️ 字数硬性规定（必须遵守）
- **全文总字数不得少于 8500 字**
- 摘要 300 + 引言 1200 + 理论 1000 + 设计原则 1100 + 案例展示 2800 + 反思 1300 + 结语 800 ≈ **8500 字**
- 不足 8500 字将被判定为不合格，必须充分展开案例实录（师生对话 ≥ 800 字）与教学反思

## ⚠️ 文中引用与参考文献规范（必须遵守）
- **正文中所有引用观点、理论的句子末尾，必须用上标格式标注**，如：「……案例分析法认为[1]……」「……具身认知理论强调[2]……」
- **每条引用至少在正文中出现 1-2 次**
- 参考文献必须使用 **GB/T 7714 格式**，每条独立成行
- 参考文献必须包含 15-25 篇，覆盖：课标文件、教育学经典著作、案例研究方法论、学科教学期刊
- 编号规则：从 [1] 开始严格递增，禁止重复编号（如 [1][1]）、禁止跳号
- 参考文献示例：
  - 期刊：[1] 王蔷. 英语课程标准的关键能力解读[J]. 中小学外语教学, 2022, 45(3): 1-8.
  - 著作：[2] Stake R E. The Art of Case Study Research[M]. Thousand Oaks: SAGE, 1995: 25.
  - 课标：[3] 中华人民共和国教育部. 义务教育英语课程标准(2022年版)[S]. 北京: 北京师范大学出版社, 2022.

# 关于图示的建议
- 论文的图没有统一标准，AI 应根据内容判断是否需要插入图示（如教学设计流程图、案例实录示意图、教学反思关系图、对比分析图等）
- **只在确实需要图示的章节**插入，不要每章都加
- 如需要图示，**在对应章节的正文内容中**输出占位标记：
  [FIGURE_PLACEHOLDER_START]图示内容描述（30-80字）[FIGURE_PLACEHOLDER_END]
- 描述要具体：说明图要表达什么内容、关键要素、视觉布局
- 示例：教学流程图，呈现"导入→新授→练习→小结→作业"五环节，含师生互动箭头
- 实际图片由作者根据描述自行绘制后插入对应位置
- 如论文不需要图示，则**不输出任何占位标记**`;
}

async function buildProposalPrompt(
  title: string,
  data: ResearchDataSnapshot,
  researchMethod?: string
): Promise<string> {
  const { text: dataSection, mode } = await buildDataSectionsAdaptive(data);
  const modeNote = mode === "stats-only"
    ? "\n> 注：以下数据为统计摘要版。对话原文和报告正文因超出模型窗口上限未包含。方案中的具体案例可基于统计特征合理推导。"
    : "";

  const methodGuide = researchMethod ? getMethodGuide(researchMethod) : "";

  // 计算申报年份与成果截止时间
  const now = new Date();
  const applyMonth = now.getMonth() + 1;
  const applyYear = applyMonth <= 6 ? now.getFullYear() : now.getFullYear() + 1;
  const deadlineYear = applyYear + 3;
  const deadlineStr = `${deadlineYear}.12`;
  const applyYearStr = `${applyYear}`;

  return `基于以下真实数据和选定题目，撰写一份完整的课题研究方案（教育科学规划课题评审活页格式）。

**核心定位**：这是课题设计方案，不是课题结题报告。方案面向未来研究，描述"将要研究什么、为什么研究、怎么研究"，而非"已经做了什么、得到了什么结论"。课堂数据用于论证研究缘起和可行性，不作为研究结论。教师将基于此方案继续开展后续研究。

# 课题题目
${title}

# 数据基础
${dataSection}${modeNote}

# 方案结构（**8500-10000 中文字**，每节下限必须达到，严格按以下标题与编号执行）

> **重要：全文中文字数（不含标点/数字/英文/JSON 块/参考文献）必须落在 8500-10000 之间。**
> 提示词末尾有"中文字数硬性规定"清单，请在写每一节时严格对照章节字数下限执行。

## （一）研究缘起
**写法要求**：从「操作性问题」上升为「解释性问题」，语气客观严谨。

1. 宏观背景与政策导向
导入国家相关政策文件，如《教育数字化战略》《人工智能+行动》《义务教育课程方案(2022年版)》等，明确政策依据。

2. 现实教学痛点与问题剖析
剖析当前教学中的具体问题（如师资不专业、施教不精细、模式单一、反馈滞后等），引用课堂真实数据佐证。

3. 理论与实践研究缺口
基于文献梳理，指出当前研究未能解决的具体空白。

4. 研究目的与实践意义
简述本课题为什么值得研究，能带来什么改变。

## （二）课题的核心概念及其界定
**写法要求**：拒绝抽象泛谈，必须提供「操作性定义」。
**编号格式**：序号后直接概念名称（如「1. 教育数字化转型：定义...」），不要写"核心概念A"等占位词。

1. 概念名称A（如「教育数字化转型」）
- 【内涵界定】：学术本质概括（1-2 句）
- 【构成要素】：拆解 2-3 个核心维度/变量
- 【表现形态】：实践中的具体存在形式
- 【概念辨析】：与相近概念的根本区别

2. 概念名称B
同上结构

3. 概念名称C
同上结构

4. 核心概念间的逻辑关系模型
简述三个概念之间的关系结构（如「情境—变量—方法」「基础—中介—目标」等逻辑链）。

## （三）国内外同一研究领域现状与研究的价值
**写法要求**：分为「国内研究现状」「国外研究现状」「研究综述」三个子部分，每个部分用一段完整论述展开。

1. 国内研究现状
聚焦国内学界对本课题相关主题的研究进展，引用具体文献、实证数据、政策文件，描述研究规模、热点、特征。

2. 国外研究现状
聚焦国外学界（欧美、日韩、东南亚等区域）的研究框架、典型成果、实践经验，与国内研究形成对照。

3. 研究综述与本研究的价值
归纳研究缺口（理论缺口、实践缺口、方法缺口），明确本课题的切入点、研究意义（理论价值+实践价值）。

## （四）研究的目标、内容（或子课题设计）与重点

1. 研究目标
**数量**：3-4 条。
**格式**：每个目标直接用"（序号）目标标题。一段描述。"的结构，**不要出现"阐述：""目标："等前缀**。句式参考「基于【现实问题】，构建【产品/策略】，通过【验证】，实现【育人终点】」。

**示例**：
（1）搭建双轨数据采集基座。基于课堂 AI 对话与手动评价数据双轨并行采集的现状，构建统一的数据采集与清洗管道，通过自动化日志与教师评分双通道融合，实现多模态课堂教学数据的标准化入库。
（2）构建学情智能分析模型。基于课堂对话数据与作业数据，构建融合认知诊断与情感分析的学情评估模型，通过多维度特征提取与深度学习推理，实现学生个性化学习状态的精准画像。
（3）开发课堂即时反馈系统。基于教师实时获取学情分析结果的需求，开发课堂可视化诊断仪表盘，通过实时数据更新与智能预警推送，实现教学决策的即时性支撑。

2. 研究内容
**数量**：3-5 个子任务。
**格式**：每个子任务直接用「（序号）子任务名称——标题说明。一段描述。」的结构，**不要出现"阐述：""子任务："等前缀**。描述涵盖「具体研究动作」与「预期产出」两个维度，不分小标签。

**示例**：
（1）AI辅助几何学习的初始认知状态诊断——基于前测数据与课堂提问记录的诊断方案设计。详细描述该子任务的研究方法、数据来源、操作步骤、预期成果。
（2）概念习得阶段性路径理论框架搭建——基于认知诊断结果与学习轨迹分析的理论构建。详细描述该子任务的理论依据、构建步骤、产出物形态。
（3）差异化辅导策略的课堂嵌入与迭代——基于课堂即时反馈的个性化教学策略优化。详细描述策略实施路径、迭代机制、效果跟踪方式。
（4）习得成效的多维验证与路径修正——基于前后测对比与对话分析的效果评估。详细描述验证方法、数据分析、模型修正策略。

## （五）研究的思路、过程与方法
**写法要求**：区分研究思路（文字逻辑）与技术路线（图示流程）。
${methodGuide || ""}
${researchMethod ? `> 重要：本课题采用 \`${researchMethod}\` 方法，请在「五」中详细给出该方法的实施路径、数据收集与分析策略。` : ""}

1. 研究方法选择及其对应任务
说明：明确如文献法、行动研究法、扎根理论、问卷调查法等，并说明「该方法用于解决哪项具体任务」。

2. 研究实施过程
- 第一阶段：理论调研与现状摸底阶段（……）
- 第二阶段：体系开发与内容设计阶段（……）
- 第三阶段：课堂实践与策略优化阶段（……）

3. 技术路线图
文字版层级结构描述：现状分析[文献+问卷] → 问题诊断[痛点提炼] → 策略设计 → 实践研究 → 数据分析 → 成果形成

4. 研究/理论框架
文字版维度结构描述：如三维分析框架，包含维度1、维度2、维度3及其交互关系。

**必须在「五」末尾包含框架图 JSON（结构化数据）**：

[FRAMEWORK_JSON_START]
{
  "rows": [
    {
      "phase": "阶段名（≤ 6 字）",
      "content": "该阶段对应的研究内容（一句话，≤ 50 字）",
      "subPoints": ["子要点1（≤12字）", "子要点2（≤12字）", "子要点3（≤12字）"],
      "methods": ["方法1（≤12字）", "方法2（≤12字）"]
    }
  ]
}
[FRAMEWORK_JSON_END]

要求：rows 必须正好 3-5 个，按研究时间顺序排列。

## （六）主要观点与可能的创新之处
**写法要求**：观点揭示机制，创新点必须用对比显出「新」。

1. 主要观点
**数量**：3 条有论据支撑的论点。
**要求**：禁用「主张式理论」。每条观点表述为一个**完整的判断句**（即"XX 通过 YY 作用于 ZZ"式的因果/机制表述），**不能只是一个名词化标题**。
**格式**：每条观点用"序号 + 完整的判断句。一段论证。"的结构。

**正确示例**：
1. **双轨数据融合驱动机制能够实时诊断学生认知盲区**。课前预习数据与课堂互动数据通过双轨融合模型，将不同来源的学习行为数据对齐到统一分析框架，为教师精准教学干预提供实时数据支撑。
2. **AI 伴学对话通过苏格拉底式追问策略促进深度反思学习**。AI 通过层层递进的问题设计引导学生从浅层记忆走向高阶思维，将机械问答转化为具有反思特征的学习对话，显著提升学生的批判性思维水平。
3. **课堂即时诊断数据通过可视化反馈形成教学决策闭环**。实时生成的学情数据通过仪表盘直观呈现给教师，使教师能够即时调整教学策略，形成"诊断-反馈-调整"的动态循环，大幅提升课堂教学的精准性与时效性。

**错误示例**（禁止使用，因为只是名词，不是完整观点）：
- ❌ **双轨数据驱动机制**。课前预习数据与课堂互动数据通过双轨融合模型...
- ❌ **AI 对话反思支架**。AI 伴学通过苏格拉底式追问...

2. 创新点（结构化对比表达）
**格式**：每条创新点用"序号 + 完整的判断句。一段论证（含对比）。"的结构，**同样不能只是名词化标题**。

**示例**：
1. **从"人机对话分析"视角切入课堂学情研究，突破了传统课堂观察仅关注师生对话的局限**。将 AI 对话数据纳入学情分析框架，揭示技术赋能下的新型学习生态，为理解人机协同教学提供了全新分析视角。
2. **构建"认知-情感-行为"三维对话分析模型，相较于传统"提问-回答"二元编码框架，能更全面刻画学生的深度参与状态**。该模型将 AI 对话互动中的多维特征纳入统一分析，弥补了传统编码体系无法捕捉情感与认知维度的不足。
3. **形成"数据采集-智能分析-精准干预-效果评估"的闭环实践路径，改变了传统"课后分析滞后"的教研模式**。该路径实现了课堂教学的即时性诊断与改进，使教研活动从"回顾式"走向"伴随式"。

## （七）预期研究成果
**注**：部分匿名活页视具体评审要求决定是否详写。

> **成果完成时间硬约束**：本课题申报年度为 ${applyYearStr} 年，研究周期为 3 年，所有成果的完成时间必须在 ${applyYearStr}.01 至 ${deadlineStr} 之间，**禁止出现超出 ${deadlineStr} 的时间**。早期成果可安排在 ${applyYearStr}.06-${applyYearStr}.12，中期成果在 ${applyYearStr + 1} 年，最终成果不晚于 ${deadlineStr}。

1. 理论性成果
研究报告、学术论文、案例是主要的研究成果形式。每条 30-40 字，**直接写成果名**（无需"产出1/2/3"等前缀），格式：「成果名（形式：研究报告/论文/案例，完成时间：YYYY.MM）」。
- 研究报告《XX课题研究报告》（形式：研究报告，完成时间：${applyYear}.06）
- 学术论文《XX视角下的XX研究》（形式：论文，完成时间：${applyYear + 1}.12）
- 教学案例《XX单元XX课时教学案例》（形式：案例，完成时间：${applyYear + 1}.03）

2. 实践性成果
教学案例集、评价指标体系、智能体应用平台等实践性补充成果。每条 30-40 字，直接写成果名，格式同上。
- 教学案例集《XX学科XX主题教学案例集》（形式：案例集，完成时间：YYYY.MM）
- 智能体应用平台《XX课堂教学智能反馈平台》（形式：平台，完成时间：YYYY.MM）

3. 最终成果
**从上述 5 项研究成果中选出 3 项最重要的**，每条 30-40 字，格式同上。
- 研究报告《XX课题研究报告》（形式：研究报告，完成时间：YYYY.MM）
- 学术论文《XX视角下的XX研究》（形式：论文，完成时间：YYYY.MM）
- 教学案例集《XX学科XX主题教学案例集》（形式：案例集，完成时间：YYYY.MM）

## （八）完成研究任务的可行性分析
**注**：包含①课题组核心成员的学术背景、研究经历、研究能力、研究成果；②研究基础（文献、调研、论文等）；③完成研究任务的保障条件（资料、经费、时间等）。

1. 课题组核心成员的学术背景与研究能力
已发表的论文、已结题的课题、获奖情况等（用通用表述「课题组」「前期研究」代指，不出现真实姓名和单位）。

2. 研究基础
围绕本课题所开展的文献搜集、调研和相关论文等。

3. 完成研究任务的保障条件
研究资料的获得、研究经费的筹措、研究时间的保障等。

## ⚠️ 文中引用与参考文献规范（必须遵守）
- **正文中所有引用观点、数据、理论的句子末尾，必须用上标格式标注**，如：「……核心素养导向下的教学实践[1]……」「……深度学习理论认为[2]……」
- **每条引用至少在正文中出现 1-3 次**，确保引用真实被使用
- 参考文献必须使用 **GB/T 7714 格式**，每条独立成行
- 参考文献必须包含 **10 篇**（3 条国外文献 + 7 条国内文献），覆盖：课程标准文件、教育学经典著作、学科教学期刊、近 5 年实证研究
- 编号规则：从 [1] 开始严格递增，**禁止重复编号**（如 [1][1]）、**禁止跳号**（如 [1][3]）
- 参考文献示例：
  - 期刊：[1] 王蔷. 英语课程标准的关键能力解读[J]. 中小学外语教学, 2022, 45(3): 1-8.
  - 著作：[2] 皮亚杰. 儿童智力的起源[M]. 北京: 教育科学出版社, 1990: 25.
  - 课标：[3] 中华人民共和国教育部. 义务教育英语课程标准(2022年版)[S]. 北京: 北京师范大学出版社, 2022.

# ⚠️ 各章节中文字数下限（每节**必须达到**下限，留 15% 缩水空间）

| 章节 | 中文字数下限 | 中文字数上限 |
|---|---|---|
| （一）研究缘起 | **600** | 800 |
| （二）核心概念界定 | **950** | 1200 |
| （三）国内外研究现状 | **1400** | 1800 |
| （四）研究目标 | **600** | 850 |
| （四）研究内容 | **1750** | 2100 |
| （五）思路过程与方法 | **1150** | 1400 |
| （六）主要观点 | **400** | 600 |
| （六）创新之处 | **300** | 450 |
| （七）预期研究成果 | **350** | 600 |
| （八）可行性分析 | **950** | 1200 |
| **全文合计** | **8500** | **10000** |

> **每写完一节，请自检**：本节中文字符数（仅汉字，不含标点数字英文）是否≥下限？若未达到，**继续展开**具体细节（增加例子、数据、对比、操作步骤），**禁止**用"在XX背景下""通过XX可以"等无意义套话凑字数。

# 输出格式（严格遵守标记）
[SECTION_START]
（一）研究缘起
1. 宏观背景与政策导向
……
2. 现实教学痛点与问题剖析
……
3. 理论与实践研究缺口
……
4. 研究目的与实践意义
……
[SECTION_END]
[SECTION_START]
（一）课题的核心概念及其界定
1. 概念名称A
概念A的内涵界定……
2. 概念名称B
概念B的内涵界定……
3. 概念名称C
概念C的内涵界定……
4. 核心概念间的逻辑关系模型
……
[SECTION_END]
[SECTION_START]
（三）国内外同一研究领域现状与研究的价值
1. 国内研究现状
……
2. 国外研究现状
……
3. 研究综述与本研究的价值
……
[SECTION_END]
[SECTION_START]
（四）研究的目标、内容（或子课题设计）与重点
1. 研究目标
（1）搭建双轨数据采集基座。基于课堂 AI 对话与手动评价数据双轨并行采集的现状，构建统一的数据采集与清洗管道，通过自动化日志与教师评分双通道融合，实现多模态课堂教学数据的标准化入库。
（2）构建学情智能分析模型。基于课堂对话数据与作业数据，构建融合认知诊断与情感分析的学情评估模型，通过多维度特征提取与深度学习推理，实现学生个性化学习状态的精准画像。
（3）开发课堂即时反馈系统。基于教师实时获取学情分析结果的需求，开发课堂可视化诊断仪表盘，通过实时数据更新与智能预警推送，实现教学决策的即时性支撑。
2. 研究内容
（1）子任务名称1——基于文献调研与课堂观察的双轨数据采集方案设计。该子任务的研究方法、数据来源、操作步骤与预期产出。
（2）子任务名称2——融合认知诊断与情感分析的学情评估模型构建。该子任务的理论依据、构建步骤、产出物形态。
（3）子任务名称3——课堂可视化诊断仪表盘的开发与迭代优化。该子任务的实施路径、迭代机制、效果跟踪方式。
（4）子任务名称4——多学科教学场景下的模型推广与成效验证。该子任务的验证方法、数据分析、模型修正策略。
[SECTION_END]
[SECTION_START]
（五）研究的思路、过程与方法
1. 研究方法选择及其对应任务
……
2. 研究实施过程
第一阶段：理论调研与现状摸底阶段
……
第二阶段：体系开发与内容设计阶段
……
第三阶段：课堂实践与策略优化阶段
……
3. 技术路线图
……
4. 研究/理论框架
……
[FRAMEWORK_JSON_START]
{...}
[FRAMEWORK_JSON_END]
[SECTION_END]
[SECTION_START]
（六）主要观点与可能的创新之处
1. 主要观点
1. **双轨数据融合驱动机制能够实时诊断学生认知盲区**。课前预习数据与课堂互动数据通过双轨融合模型，将不同来源的学习行为数据对齐到统一分析框架，为教师精准教学干预提供实时数据支撑。
2. **AI 伴学对话通过苏格拉底式追问策略促进深度反思学习**。AI 通过层层递进的问题设计引导学生从浅层记忆走向高阶思维，将机械问答转化为具有反思特征的学习对话，显著提升学生的批判性思维水平。
3. **课堂即时诊断数据通过可视化反馈形成教学决策闭环**。实时生成的学情数据通过仪表盘直观呈现给教师，使教师能够即时调整教学策略，形成"诊断-反馈-调整"的动态循环，大幅提升课堂教学的精准性与时效性。
2. 创新点（结构化对比表达）
1. **从"人机对话分析"视角切入课堂学情研究，突破了传统课堂观察仅关注师生对话的局限**。将 AI 对话数据纳入学情分析框架，揭示技术赋能下的新型学习生态，为理解人机协同教学提供了全新分析视角。
2. **构建"认知-情感-行为"三维对话分析模型，相较于传统"提问-回答"二元编码框架，能更全面刻画学生的深度参与状态**。该模型将 AI 对话互动中的多维特征纳入统一分析，弥补了传统编码体系无法捕捉情感与认知维度的不足。
3. **形成"数据采集-智能分析-精准干预-效果评估"的闭环实践路径，改变了传统"课后分析滞后"的教研模式**。该路径实现了课堂教学的即时性诊断与改进，使教研活动从"回顾式"走向"伴随式"。
[SECTION_END]
[SECTION_START]
（七）预期研究成果
1. 理论性成果
- 研究报告《XX课题研究报告》（形式：研究报告，完成时间：${applyYear}.12）
- 学术论文《XX视角下的XX研究》（形式：论文，完成时间：${applyYear + 1}.06）
- 教学案例《XX单元XX课时教学案例》（形式：案例，完成时间：${applyYear + 1}.12）
2. 实践性成果
- 教学案例集《XX学科XX主题教学案例集》（形式：案例集，完成时间：${applyYear + 2}.06）
- 智能体应用平台《XX课堂教学智能反馈平台》（形式：平台，完成时间：${applyYear + 2}.06）
3. 最终成果
- 研究报告《XX课题研究报告》（形式：研究报告，完成时间：${applyYear + 2}.12）
- 学术论文《XX视角下的XX研究》（形式：论文，完成时间：${applyYear + 2}.12）
- 教学案例集《XX学科XX主题教学案例集》（形式：案例集，完成时间：${deadlineStr}）
[SECTION_END]
[SECTION_START]
（八）完成研究任务的可行性分析
1. 课题组核心成员的学术背景与研究能力
……
2. 研究基础
……
3. 完成研究任务的保障条件
……
[SECTION_END]
[REFERENCES_START]
[1] 文献1
[2] 文献2
...
[10] 文献10
[REFERENCES_END]

# 写作要求

## 严禁的"AI 味"表达（违反任何一条都视为不合格）
1. **禁止套话开头**：不用"在XX时代背景下「随着XX的快速发展」本文聚焦「本文旨在」XX是XX发展的必然趋势"等
2. **禁止空话结尾**：不用"为XX提供理论支撑「具有重要的理论和实践意义」值得进一步研究和推广"
3. **禁止空泛形容词**：不用"系统化「一体化」科学化「多元化」深入推进""全面落实"
4. **禁止主语缺失**：每段必须有明确主语，不要"通过对...的分析表明"这种被动态堆砌
5. **禁止过渡套话**：不用"首先...其次...最后...综上所述..."等机械结构

## 必须做到的（贴近真实课题申报书的语言风格）
1. **直接陈述事实**：第一句就是"XX是指..."、或者"在XX课堂中观察到..."，不要铺垫
2. **引用具体**：引政策写文件名+年份（如《义务教育课程方案(2022年版)》）；引文献写作者+年份+期刊；引数据写精确数字（如"307篇「53」70"）
3. **省级视角**：体现省级或地市级课题研究的视野，避免"中国教育""全球教育"等过大表述
4. **用第三人称叙述**：避免"我们""笔者"，统一用"本课题""该研究"
5. **直接呈现数据**：不写"较高的完成率"，直接写"完成率 78%"
6. **不使用 AI 味动词**：避免"赋能「重塑」革新""优化升级"等

## 其他基本要求
- **核心定位**：这是课题设计方案，不是结题报告。全文使用"拟「将」计划"等将来时态
- 不得出现学校名、课题组成员名等个人信息
- 必须基于上述提供的数据撰写分析，不能编造数据
- 研究目标、内容、方法应面向未来，描述"将要研究什么"

# ⚠️ 必须附加输出的结构化数据（在所有 [SECTION_END] 之后）
[FRAMEWORK_JSON_START]
{
  "rows": [
    {
      "phase": "阶段名（≤ 6 字）",
      "content": "该阶段对应的研究内容（一句话，≤ 50 字）",
      "subPoints": ["子要点1（≤12字）", "子要点2（≤12字）", "子要点3（≤12字）"],
      "methods": ["方法1（≤12字）", "方法2（≤12字）"]
    }
  ]
}
[FRAMEWORK_JSON_END]

要求：
1. rows 必须正好 3-5 个，按研究时间顺序排列
2. JSON 部分直接以 [FRAMEWORK_JSON_START] 开头，不要写代码块标记
3. 绝对不要在 JSON 内部加注释
4. JSON 之外的所有正文必须严格遵守上面的 [SECTION_START]...[SECTION_END] 格式
5. 子要点 2-4 个，方法 1-4 个

## ⚠️ 字数硬性规定（必须遵守，否则视为不合格）

> **"字数"特指中文字数（不含标点符号、数字、英文单词、Markdown 标记、JSON 块、参考文献列表）。**
> 示例：「该研究聚焦学生核心素养」共 10 个中文字。标点「，。、」不计入。

**每个章节的实际中文字数（不含 SECTION 标记本身、不含 JSON 块、不含参考文献）必须落在下表区间内。**

（一）研究缘起：700-900 中文字
（二）核心概念界定：1000-1300 中文字
（三）文献综述：1500-1900 中文字
（四）研究目标：700-900 中文字
（四）研究内容：1800-2200 中文字
（五）思路过程方法：1200-1500 中文字
（六）主要观点：500-700 中文字
（六）创新之处：350-500 中文字
（七）预期研究成果：400-600 中文字
（八）可行性分析：1000-1300 中文字
**全文合计：8500-10000 中文字（硬约束）**

**强制写作策略**（每节都按此策略保证中文字数）：

1. **（一）研究缘起 800 中文字**：政策 150 + 现状 300 + 缺口 200 + 目的 150
2. **（二）核心概念 1100 中文字**：每个概念 330（内涵界定 80 + 构成要素 100 + 表现形态 90 + 概念辨析 60），逻辑关系 110
3. **（三）文献综述 1600 中文字**：话语分类 250 + 主题聚类 500 + 分歧诊断 280 + 缺口探测 280 + 学术缝合 290
4. **（四）研究目标 800 中文字**：4 条目标，每条 200（背景 50 + 策略 70 + 验证 40 + 终点 40）
5. **（四）研究内容 1900 中文字**：4 个内容，每条 475（子任务 80 + 研究动作 260 + 预期产出 135）
6. **（五）过程方法 1300 中文字**：方法 320 + 过程 380 + 技术路线 280 + 分析框架 320
7. **（六）主要观点 550 中文字**：3 条观点，每条 180
8. **（六）创新之处 400 中文字**：3 条创新，每条 130
9. **（七）预期成果 500 中文字**：阶段成果 5 行 × 50 + 最终成果 3 行 × 50 + 表格表头
10. **（八）可行性 1100 中文字**：(一)团队 400 + (二)基础 380 + (三)保障 320

**严禁**：
1. 严禁为凑中文字数堆砌「在XX背景下」「通过XX可以」等无意义套话
2. 严禁为减中文字数删除必要概念定义、研究内容、可行性论证
3. 严禁用英文单词、数字、标点堆叠凑字数（不算中文字）

**全文中文字数必须达到 8500-10000 之间（不含 SECTION/REFERENCES/FRAMEWORK_JSON 标记本身）**`;
}

/**
 * 根据研究方法返回对应的方法学实施指引（注入到「（五）研究的思路、过程与方法」）
 */
function getMethodGuide(method: string): string {
  const guides: Record<string, string> = {
    ACTION_RESEARCH: `**本课题采用"行动研究法"**，核心范式：计划→行动→观察→反思（螺旋循环）。

应包含以下要点：
1. **方法选择理由**：为何选择行动研究（教师即研究者，实践改进螺旋）
2. **研究对象与情境**：教学班级的学科、学段、人数、教学现状
3. **螺旋循环计划**：至少 2 轮完整循环（每轮均含计划-行动-观察-反思）
   - 第 1 轮：起始问题诊断 → 第一轮干预 → 课堂观察 → 反思改进点
   - 第 2 轮：基于第 1 轮反思的二次干预 → 观察 → 深度反思
4. **数据收集**：教学日志、学生作品、课堂录像、同行观课记录、学生访谈
5. **数据分析**：从反思日志中归纳教学改进点；用前后对比验证效果`,

    CASE_STUDY: `**本课题采用"案例分析法"**，核心范式：选取典型案例→多源数据收集→深度描述与主题分析。

应包含以下要点：
1. **方法选择理由**：为何案例研究适合本课题（深描单一现象/事件）
2. **案例选取标准**：典型性、代表性、独特性
3. **案例数量与边界**：单案例 vs 多案例的说明
4. **数据收集**：课堂观察、深度访谈、文档资料（教案、学生作业）、视频
5. **数据分析**：主题分析（编码 → 类属 → 核心主题）、模式识别、情境还原`,

    SURVEY: `**本课题采用"调查研究法"**，核心范式：现状摸底→问卷/访谈设计→样本选取→数据分析。

应包含以下要点：
1. **方法选择理由**：为何需要先摸底现状（数据缺口、需求识别）
2. **工具设计**：
   - 问卷设计（维度、题项、计分方式、信效度检验）
   - 访谈提纲（半结构化访谈设计）
3. **样本**：抽样方法、样本量、代表性论证
4. **实施流程**：预调查 → 修改 → 正式调查 → 数据清洗
5. **数据分析**：描述统计、相关分析、回归分析；访谈的主题编码`,

    EXPERIMENT: `**本课题采用"实验研究法"**，核心范式：前测→干预→后测，验证因果关系。

应包含以下要点：
1. **方法选择理由**：为何需要实验设计验证因果
2. **实验设计**：被试间设计/被试内设计；前测-干预-后测时间线
3. **变量控制**：
   - 自变量（教学干预）
   - 因变量（学习效果指标）
   - 控制变量（无关变量如何控制）
4. **实验组与对照组**：分组方法（随机）、样本量、组间等同性检验
5. **数据分析**：独立样本 t 检验 / 配对样本 t 检验 / 协方差分析、效应量（d）`,

    QUASI_EXPERIMENT: `**本课题采用"准实验研究法"**，核心范式：自然班级非随机分组的前后测对比。

应包含以下要点：
1. **方法选择理由**：为何无法采用随机分组（伦理/现实限制）
2. **设计类型**：非等值对照组设计、时间序列设计、中断时间序列设计
3. **被试选取**：自然班级情况、组间相似性论证
4. **协变量控制**：前测作为协变量；教师、教材等额外变量
5. **数据分析**：协方差分析（ANCOVA）、多元分析、效应量；威胁内部效度的因素与应对`,

    NARRATIVE: `**本课题采用"叙事研究法"**，核心范式：讲述故事→还原情境→提炼主题。

应包含以下要点：
1. **方法选择理由**：为何叙事研究适合（挖掘实践智慧、关注个体经验）
2. **叙事对象**：教师自身成长叙事 / 学生学习叙事 / 师生互动叙事
3. **故事收集**：深度访谈、生活史访谈、田野笔记、轶事记录
4. **叙事分析**：还原情境、识别关键事件、提炼主题、保留"故事感"
5. **伦理考量**：叙事授权、化名处理、隐私保护`,

    CONTENT_ANALYSIS: `**本课题采用"内容分析法"**，核心范式：编码体系→信度检验→频次/类别统计。

应包含以下要点：
1. **方法选择理由**：为何适合挖掘对话/作业中的隐藏模式
2. **分析对象**：课堂对话、学生作业文本、教学反思日志等
3. **编码体系建立**：
   - 初始编码（开放编码）→ 主轴编码 → 选择性编码
   - 编码表（每类编码的定义、判断标准、典型示例）
4. **信度检验**：多人独立编码 → 计算 Cohen's Kappa（≥0.7 接受）
5. **数据分析**：频次统计、类别分布、关联规则、共现分析`,

    DESIGN_BASED: `**本课题采用"设计本位研究法"（DBR）**，核心范式：迭代设计→实施→分析→再设计。

应包含以下要点：
1. **方法选择理由**：为何需要迭代设计（理论与实践双向精化）
2. **迭代周期**：至少 3 轮完整迭代
3. **设计原型**：第 1 轮的设计假设、教学干预原型
4. **微观分析**：每轮迭代的设计决策、实施过程、产生的数据、关键发现
5. **理论精化**：从迭代中提炼可迁移的设计原则；与课堂数据结合`,

    MIXED_METHODS: `**本课题采用"混合研究法"**，核心范式：定量 + 定性三角互证。

应包含以下要点：
1. **方法选择理由**：为何需要三角互证（弥补单一方法的局限）
2. **定量部分**：问卷、测试、行为数据等；样本量与统计分析
3. **定性部分**：访谈、课堂观察、文本分析等；样本选取与编码
4. **整合策略**：
   - 三角互证（convergent）：两种方法并行，结论交叉验证
   - 嵌入式（embedded）：定量为主，定性辅助解释
   - 探索性（exploratory）：先用定性探索，再用定量验证
5. **整合报告**：如何在论文中呈现两种方法的一致与差异`,
  };
  return guides[method] || "";
}

function extractText(text: string, start: string, end: string): string {
  const s = text.indexOf(start); if (s === -1) return "";
  const e = text.indexOf(end, s); if (e === -1) return "";
  return text.substring(s + start.length, e).trim();
}

function parsePaperContent(text: string, title: string): PaperContent {
  const abstract = extractText(text, "[ABSTRACT_START]", "[ABSTRACT_END]");
  const keywordsRaw = extractText(text, "[KEYWORDS_START]", "[KEYWORDS_END]");
  const keywords = keywordsRaw.split("；").map(s => s.trim()).filter(Boolean);

  // 先解析 sections（用于后续按引用顺序重排）
  const sections: { title: string; content: string }[] = [];
  const sectionRegex = /\[SECTION_START\]([\s\S]*?)\[SECTION_END\]/g;
  let match;
  while ((match = sectionRegex.exec(text)) !== null) {
    const block = match[1].trim();
    const nl = block.indexOf("\n");
    if (nl > 0) {
      sections.push({ title: block.substring(0, nl).trim(), content: block.substring(nl + 1).trim() });
    }
  }

  // 解析参考文献：用 [N] 编号拆分，去重
  const referencesRaw = parseReferences(extractText(text, "[REFERENCES_START]", "[REFERENCES_END]"));

  // 按"文中引用顺序"重排 references + 重写正文 [N] 编号
  const { reorderedRefs, newSections, replacedExtras } = sortReferencesByCitation(
    referencesRaw, sections, [abstract, ...keywords]
  );

  return {
    docType: "PAPER",
    title,
    abstract: replacedExtras[0] || abstract,
    keywords: replacedExtras.slice(1).length > 0
      ? replacedExtras.slice(1).join("；").split("；").map(s => s.trim()).filter(Boolean)
      : keywords,
    sections: newSections,
    references: reorderedRefs,
  };
}

/**
 * 解析参考文献文本：
 * - 用 [N] 编号正则匹配每条记录
 * - 处理同一行多条记录的异常情况（[1]...[2]...）
 * - 去重（按编号）
 * - 按编号升序排序
 * - 过滤空记录和异常片段
 */
function parseReferences(raw: string): string[] {
  if (!raw) return [];

  // 用 [N] 编号作为分隔符拆分
  const parts = raw.split(/\n(?=\[\d+\])/);
  const map = new Map<number, string>();

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // 提取第一个编号（不依赖 /s flag）
    const firstNewline = trimmed.indexOf("\n");
    const firstLine = firstNewline >= 0 ? trimmed.substring(0, firstNewline) : trimmed;
    const numMatch = firstLine.match(/^\[(\d+)\]\s*(.*)$/);
    if (!numMatch) continue;

    const num = parseInt(numMatch[1], 10);
    let content = numMatch[2].trim();
    // 清洗：如果内容开头有连续的 [N] 编号（AI 偶发 "[1][1] xxx" 格式），只保留第一个
    content = content.replace(/^\[(\d+)\]\s*/, (m, innerNum) => {
      // 第二个 [N] 与首编号重复则去除
      return "";
    });
    // 如果原文有更多行，附加
    if (firstNewline >= 0) {
      const rest = trimmed.substring(firstNewline + 1).trim();
      if (rest) content = content + " " + rest;
    }

    // 处理内容中可能包含的其他 [N] 标记（如 "正文内容[2]..."）
    // 只保留首个编号后到结尾的内容
    const nextRefIdx = content.search(/\n\[\d+\]/);
    if (nextRefIdx >= 0) {
      content = content.substring(0, nextRefIdx).trim();
    }

    // 只接受合理长度（至少 10 字符）
    if (content.length < 10) continue;

    // 只接受合理编号（1-999）
    if (num < 1 || num > 999) continue;

    // 去重：保留第一次出现的
    if (!map.has(num)) {
      map.set(num, `[${num}] ${content}`);
    }
  }

  // 按编号升序排序
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([_, v]) => v);
}

/**
 * 扫描所有 section.content，提取 [N] 引用按"首次出现顺序"排列（去重）
 * 例：正文 [3][1][5][1] → 返回 [3, 1, 5]
 */
function extractCitationOrder(sections: { content: string }[]): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const re = /\[(\d+)\]/g;
  for (const sec of sections) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sec.content)) !== null) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= 999 && !seen.has(num)) {
        seen.add(num);
        order.push(num);
      }
    }
  }
  return order;
}

/**
 * 按"文中引用顺序"重排参考文献列表 + 重写正文 [N] 编号
 *
 * 规则：
 * 1. 已引用的：按正文中首次出现顺序排
 * 2. 未引用的：按原编号升序排最后
 * 3. 编号重新分配为 1,2,3... 连续
 * 4. 正文（含 section.title/content）和 keywords/abstract 里的旧 [N] 全部按 oldToNew 替换
 *
 * 返回：
 * - reorderedRefs: 按新顺序、重新编号的参考文献列表
 * - newSections: 替换 [N] 后的章节数组
 * - newAbstract/newKeywords: 替换 [N] 后的摘要/关键词（按需）
 */
function sortReferencesByCitation(
  references: string[],
  sections: { title: string; content: string }[],
  extraTexts: string[] = []
): {
  reorderedRefs: string[];
  newSections: { title: string; content: string }[];
  replacedExtras: string[];
} {
  // 解析 references → oldNum → content
  const refMap = new Map<number, string>();
  for (const r of references) {
    const m = r.match(/^\[(\d+)\]\s*([\s\S]*)$/);
    if (m) refMap.set(parseInt(m[1], 10), m[2].trim());
  }

  // 文中引用顺序
  const order = extractCitationOrder(sections);
  const orderSet = new Set(order);

  // 已引用 vs 未引用
  const citedOldNums = order.filter(n => refMap.has(n));
  const uncitedOldNums = Array.from(refMap.keys()).filter(n => !orderSet.has(n)).sort((a, b) => a - b);

  // 重新分配编号：oldNum → newNum
  const oldToNew = new Map<number, number>();
  const reorderedRefs: string[] = [];
  let newNum = 1;
  for (const oldNum of citedOldNums) {
    oldToNew.set(oldNum, newNum);
    reorderedRefs.push(`[${newNum}] ${refMap.get(oldNum)}`);
    newNum++;
  }
  for (const oldNum of uncitedOldNums) {
    oldToNew.set(oldNum, newNum);
    reorderedRefs.push(`[${newNum}] ${refMap.get(oldNum)}`);
    newNum++;
  }

  // 替换 section 里的 [N]
  const replaceInText = (s: string): string => {
    if (oldToNew.size === 0) return s;
    return s.replace(/\[(\d+)\]/g, (m, n) => {
      const oldNum = parseInt(n, 10);
      const mapped = oldToNew.get(oldNum);
      return mapped !== undefined ? `[${mapped}]` : m;
    });
  };

  const newSections = sections.map(s => ({
    title: replaceInText(s.title),
    content: replaceInText(s.content),
  }));

  const replacedExtras = extraTexts.map(replaceInText);

  return { reorderedRefs, newSections, replacedExtras };
}

function parseProposalContent(text: string, title: string): ProposalContent {
  const sections: { title: string; content: string }[] = [];

  // 容错解析：以 [SECTION_START] 作为强分隔符，每个 SECTION_START 后内容直到下一个 [SECTION_START] 或 [REFERENCES_START] 或文末
  const startRegex = /\[SECTION_START\]/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRegex.exec(text)) !== null) {
    starts.push(m.index + "[SECTION_START]".length);
  }

  // 同时收集 [REFERENCES_START] 和 [FRAMEWORK_FIGURE_START]/[FRAMEWORK_FIGURE_END] 的位置，避免被截断
  const refIdx = text.indexOf("[REFERENCES_START]");
  const fwStartIdx = text.indexOf("[FRAMEWORK_FIGURE_START]");
  const fwEndIdx = text.indexOf("[FRAMEWORK_FIGURE_END]");

  for (let i = 0; i < starts.length; i++) {
    const sectionStart = starts[i];
    // 找到下一个 SECTION_START 位置
    const nextSectionStart = i + 1 < starts.length ? starts[i + 1] - "[SECTION_START]".length : Infinity;
    // 该 section 的有效结束 = 下一个 section 开始、REFERENCES 开始、或文末
    let sectionEnd = nextSectionStart;
    if (refIdx > 0 && refIdx < sectionEnd) sectionEnd = refIdx;
    if (fwEndIdx > 0 && fwEndIdx < sectionEnd) sectionEnd = fwEndIdx;

    let block = text.substring(sectionStart, sectionEnd).trim();
    // 清除协议标记：[SECTION_END]、[SECTION_START]、[FRAMEWORK_JSON_START]...[FRAMEWORK_JSON_END]
    block = block.replace(/\[FRAMEWORK_JSON_START\][\s\S]*?\[FRAMEWORK_JSON_END\]/g, "");
    block = block.replace(/\[SECTION_END\]/g, "");
    block = block.replace(/\[SECTION_START\]/g, "");
    block = block.trim();
    const nl = block.indexOf("\n");
    if (nl > 0) {
      sections.push({ title: block.substring(0, nl).trim(), content: block.substring(nl + 1).trim() });
    }
  }

  // 解析参考文献
  const refsRaw = extractText(text, "[REFERENCES_START]", "[REFERENCES_END]");
  const referencesRaw = refsRaw ? parseReferences(refsRaw) : [];

  // 按"文中引用顺序"重排 references + 重写正文 [N] 编号
  const { reorderedRefs, newSections } = sortReferencesByCitation(referencesRaw, sections);

  return { docType: "PROPOSAL", title, sections: newSections, references: reorderedRefs };
}