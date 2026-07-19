import { generateText } from "ai";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import type { ResearchDataSnapshot } from "./data-collector";
import { PAPER_STYLES, RESEARCH_METHODS } from "./constants";

// ── 8 个有效 category（替代原 5 个）──
const VALID_CATEGORIES = [
  "教学效果", "学习行为", "认知发展", "AI应用", "教学模式",
  "教研模式", "教师发展", "评价改革",
];

// ── 9 种研究方法（按固定种子打乱，强制分配给 9 个题目）──
function shuffleBySeed<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  let s = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function getFixedMethodOrder(seed: string = "default"): string[] {
  return shuffleBySeed(
    [
      "ACTION_RESEARCH", "CASE_STUDY", "SURVEY", "EXPERIMENT",
      "QUASI_EXPERIMENT", "NARRATIVE", "CONTENT_ANALYSIS",
      "DESIGN_BASED", "MIXED_METHODS",
    ],
    seed
  );
}

export interface ResearchTitle {
  index: number;
  title: string;
  description: string;
  category: string;
  /** 论文类型：仅 PAPER 类型适用 */
  paperStyle?: "PRACTICE_RESEARCH" | "CASE_ANALYSIS";
  /** 研究方法：仅 PROPOSAL 类型适用 */
  researchMethod?: string;
  score: number;
  evidence: string[];
}

export async function generateTitles(
  data: ResearchDataSnapshot,
  projectType: "PAPER" | "PROPOSAL",
  keywords: string,
  count: number = 10,
  seed: string = "default"
): Promise<ResearchTitle[]> {
  const prompt = buildTitlesPrompt(data, projectType, keywords, count, seed);
  const { chatModel } = await createDashScopeClient();

  const result = await aiQueue.enqueue(async () => {
    return generateText({
      model: chatModel,
      system: "你是资深教育研究方法论专家，擅长从教学数据中发现可立项的研究题目。",
      prompt,
    });
  });

  return parseTitles(result.text, count, projectType);
}

function buildTitlesPrompt(
  data: ResearchDataSnapshot,
  projectType: string,
  keywords: string,
  count: number,
  seed: string = "default"
): string {
  const types = data.scope.selectedDataTypes;
  const hasQuiz = types.includes("quiz");
  const hasConv = types.includes("conversation");
  const hasQuizR = types.includes("quizReport");
  const hasConvR = types.includes("conversationReport");

  const sections: string[] = [];

  // 范围
  sections.push(`## 数据来源范围
- 已选课堂：${data.scope.taskTitles.join("、") || "(无)"}
- 班级：${data.scope.classNames.join("、") || "(无)"}
- 学生数：${data.scope.studentCount}人
- 已勾选数据类型：${types.join("、") || "(无)"}`);

  // 作业数据
  if (hasQuiz && data.quizData) {
    sections.push(`## 作业数据（所有学生）
- 总提交次数：${data.quizData.totalAttempts}
- 完成提交：${data.quizData.completedAttempts}
${data.quizData.perQuizStats.slice(0, 5).map((q, i) => `
### 作业 ${i + 1}：${q.taskTitle} - ${q.quizTitle}
- 题数：${q.questionCount}，参与：${q.totalSubmissions} 人次
- 完成率：${q.completionRate}%，平均分：${q.avgScorePercent}%
- 合格率：${q.passRate}%（合格线 ${q.passScore}）
- 分数段分布：优秀(>=90):${q.scoreDistribution.excellent} 良好(>=75):${q.scoreDistribution.good} 中等(>=60):${q.scoreDistribution.average} 较差(<60):${q.scoreDistribution.poor}
- 各题正确率：${q.questionStats.slice(0, 3).map((qq) => `[${qq.type}] ${qq.content.slice(0, 20)} 正确率${qq.correctRate}%`).join("；")}`).join("\n")}`);
  }

  // 对话数据
  if (hasConv && data.conversationData) {
    const sampleConvs = data.conversationData.conversations.slice(0, 5);
    sections.push(`## 对话数据（所有学生）
- 对话总轮次：${data.conversationData.totalConversations}
- 总消息数：${data.conversationData.totalMessages}
- 对话活动分布：${data.conversationData.perPreset.map((p) => `${p.presetTitle}(${p.conversationCount}轮/${p.messageCount}消息)`).join("；")}

### 学生对话节选（前 5 组）
${sampleConvs.map((c, i) => `
对话 ${i + 1}：${c.studentName} - "${c.title}" (${c.presetTitle || ""}, ${c.messageCount}条消息)
${c.messages.slice(0, 4).map((m) => `  [${m.role === "user" ? "学生" : "AI"}] ${m.content.slice(0, 100)}...`).join("\n")}`).join("\n")}`);
  }

  // 作业报告
  if (hasQuizR && data.quizReports && data.quizReports.length > 0) {
    sections.push(`## 作业报告（班级 AI 分析）
${data.quizReports.slice(0, 5).map((r, i) => `
### 报告 ${i + 1}：${r.taskTitle} - ${r.quizTitle} (v${r.version})
参与人数：${r.stats.participantCount}，完成率：${r.stats.completionRate}%，合格率：${r.stats.passRate}%，平均分：${r.stats.avgScorePercent}%

${r.content.slice(0, 600)}...`).join("\n")}`);
  }

  // 对话报告
  if (hasConvR && data.conversationReports && data.conversationReports.length > 0) {
    sections.push(`## 对话报告（班级 AI 分析）
${data.conversationReports.slice(0, 5).map((r, i) => `
### 报告 ${i + 1}：${r.taskTitle} - ${r.presetTitle} (v${r.version}, ${r.conversationCount}组对话)

${r.content.slice(0, 500)}...`).join("\n")}`);
  }

  // 数据质量
  if (data.dataQuality.warnings.length > 0) {
    sections.push(`## 数据质量警告
${data.dataQuality.warnings.map((w) => `- ⚠ ${w}`).join("\n")}`);
  }

  if (keywords) {
    sections.push(`## 教师关键字
${keywords}`);
  }

  // ── 根据 projectType 决定题目分布要求 ──
  let distributionReq: string;
  let outputFields: string;
  let contextIntro: string;

  if (projectType === "PAPER") {
    contextIntro = `请基于上述真实教学数据，生成 ${count} 个可立项的学术论文题目。`;
    distributionReq = `## 题目分布要求（重要）

**所有学科通用（不限于英语/语文等），生成 10 个论文题目时必须按 5+5 拆分：**

- **前 5 个（索引 0-4）：实践研究类**（paperStyle: "PRACTICE_RESEARCH"）
  - 结构：引言→理论依据→实施路径→案例分析→效果评价→结语
  - 适用于：整体性教学改革（学段/单元/课程层级的实践探索）
  - 标题特征：理论视角 + 学段 + 教学内容 + 实践研究/实施路径/实践探究
  - 例：核心素养导向下小学数学单元整体教学实践研究
  
- **后 5 个（索引 5-9）：案例分析类**（paperStyle: "CASE_ANALYSIS"）
  - 结构：引言→理论依据→教学设计原则→教学案例展示→教学反思→结语
  - 适用于：单课时/单案例的精读与剖析
  - 标题特征：理论视角 + 教学内容 + 案例 + 设计与实施/教学反思
  - 例：深度学习视角下初中英语读写结合教学案例分析

## ⚠️ 题目抽象提炼要求（强制）

**标题必须从具体课堂数据中抽象出一类普遍性研究问题，禁止直接使用课堂名称。**

- ❌ 错误示例："生成式人工智能视域下五年级**圆的认识**实践研究"（直接用了课堂名"圆的认识"）
- ✅ 正确示例："生成式人工智能视域下小学**几何概念教学**实践研究"（从"圆的认识"抽象出"几何概念教学"）

**抽象方法**：
1. 从课堂标题中识别教学内容的学科归属和知识类型
2. 将具体知识点上升为该类型的一般性表述
   - "圆的认识" → "几何概念教学" / "图形概念建构"
   - "方程的解" → "代数思维培养" / "符号意识发展"
   - "古诗三首" → "传统文化理解" / "经典文本阅读"
   - "Unit 5 Reading" → "读写整合教学" / "语篇能力发展"
3. 标题中使用抽象后的表述，evidence 中仍可引用具体课堂数据

**禁止**：标题中出现"圆的认识""方程的解"等具体课堂/知识点名称

## 分类分布要求

**10 个题目必须至少覆盖 5 个不同的 category，禁止全部集中在 1-2 类。**
建议分布：每类 1-2 个，确保研究视角多元。

## 分数要求

**所有题目的 score 字段必须为 90-100 分，统一为最高水平。**
评分维度：① 数据支撑度（evidence 是否充分）② 创新性（视角是否新颖）③ 可操作性（能否用已有数据完成研究）

**重要**：两类论文结构骨架对所有学科（语文/数学/英语/物理/化学/生物/历史/地理/政治等）通用，标题中的"理论视角词"应基于课堂数据所涉学科灵活替换。`;
    outputFields = `"paperStyle": "PRACTICE_RESEARCH" 或 "CASE_ANALYSIS",
      "category": "8 类之一（${VALID_CATEGORIES.join("/")}）"`;
  } else {
    // PROPOSAL —— 使用种子强制分配 9 种方法
    const methodOrder = getFixedMethodOrder(seed);
    const methodItems = methodOrder.map((code, i) => {
      const m = RESEARCH_METHODS.find((x) => x.value === code);
      return `${i + 1}. 题目 ${i + 1} → ${m?.label || code}（代码：${code}）`;
    }).join("\n");

    contextIntro = `请基于上述真实教学数据，生成 ${count} 个可立项的研究课题题目。

## ⚠️ 题目抽象提炼要求（强制）

**标题必须从具体课堂数据中抽象出一类普遍性研究问题，禁止直接使用课堂名称。**

- ❌ 错误示例："基于行动研究的五年级**圆的认识**教学实践"（直接用了课堂名"圆的认识"）
- ✅ 正确示例："基于行动研究的小学**几何概念教学**实践"（从"圆的认识"抽象出"几何概念教学"）

**抽象方法**：
1. 从课堂标题中识别教学内容的学科归属和知识类型
2. 将具体知识点上升为该类型的一般性表述
   - "圆的认识" → "几何概念教学" / "图形概念建构"
   - "方程的解" → "代数思维培养" / "符号意识发展"
   - "古诗三首" → "传统文化理解" / "经典文本阅读"
   - "Unit 5 Reading" → "读写整合教学" / "语篇能力发展"
3. 标题中使用抽象后的表述，evidence 中仍可引用具体课堂数据

**禁止**：标题中出现"圆的认识""方程的解"等具体课堂/知识点名称

## 分类分布要求

**10 个题目必须至少覆盖 5 个不同的 category，禁止全部集中在 1-2 类。**
建议分布：每类 1-2 个，确保研究视角多元。

## 分数要求

**所有题目的 score 字段必须为 90-100 分，统一为最高水平。**
评分维度：① 数据支撑度（evidence 是否充分）② 创新性（视角是否新颖）③ 可操作性（能否用已有数据完成研究）`;

    // ── P3：学科限定 ──
    const subjectHints = data.scope.subjectHints || [];
    const subjectLine = subjectHints.length > 0
      ? `\n## ⚠️ 学科限定（强制）\n\n本课题应聚焦于【${subjectHints.join("、")}】学科，标题与内容必须使用该学科的专业术语和视角，**不要泛化到不相关的学科**。\n`
      : `\n## 学科识别\n\n基于课堂标题与教师关键字智能识别学科，使用该学科的专业术语。\n`;

    // ── P1-2：可引用的数据字段 ──
    const allowedDataFields = `\n## ⚠️ 可引用的数据字段（evidence 字段只能从以下范围引用，禁止编造任何数字或姓名）

${hasQuiz ? `**作业数据**：
- 作业标题（如："《${data.quizData?.perQuizStats?.[0]?.quizTitle || 'XX'}》"）
- 完成率（0-100%）、平均分（0-100）、及格率（0-100%）
- 分数段分布：优秀(≥90) / 良好(≥75) / 及格(≥60) / 不及格(<60) 的人数
- 各题正确率（仅当题目有数据时引用）
` : ""}${hasConv ? `**对话数据**：
- 各对话活动标题、相关学生数（仅使用已提供数据中的）
- 对话样本主题（仅引用已展示的对话内容）
` : ""}${hasQuizR ? `**作业报告**：
- 报告标题、版本号
- 报告内已总结的结论（不要编造新结论）
` : ""}${hasConvR ? `**对话报告**：
- 报告标题、版本号
- 报告内已总结的结论
` : ""}
**禁止**：
- 编造任何具体数字（"200 轮对话"、"及格率 35%"等必须真实存在于数据中）
- 编造学生姓名（只引用数据中实际出现的）
- 引用未勾选数据类型中的内容
- evidence 字段使用"约""大约"等模糊数字

**evidence 推荐格式**：
["作业《圆的面积》完成率 78%，平均分 72", "对话活动《方程的解》学生提问 18 次"]
`;

    // ── P1-1：方法强制分配 + 学科 + 数据范围 ──
    distributionReq = `## ⚠️ 题目分布要求（强制！）

**生成 10 个课题时，researchMethod 字段必须严格按以下顺序使用这些方法代码，不可更改顺序、不可漏掉、不可错用中文名**：

${methodItems}

10. 题目 10 → 自由选择（建议从上述 9 种中复用 1 个）

**禁止**：
- 改变方法的顺序
- 漏掉任何一种方法（除第 10 个可自由）
- 用错方法的中文名称
${subjectLine}${allowedDataFields}
**要求**：
- 题目与方法强匹配（例："基于行动研究的 X 实践" / "X 案例的叙事研究" / "X 教学效果的调查研究"）
- 标题对所有学科通用，**但内容必须聚焦已识别学科**
- 每个题目的 evidence 至少包含 1 条来自上述"可引用的数据字段"
`;

    outputFields = `"researchMethod": "上述 9 种方法代码之一"`,
      `"category": "8 类之一（${VALID_CATEGORIES.join("/")}）"`;
  }

  return `${contextIntro}

${sections.join("\n\n")}

${distributionReq}

# 输出要求（JSON 数组，不要 markdown 代码块）
[
  {
    "title": "题目（15-30字）",
    "description": "简要说明（30-50字）",
    "category": "8 类之一（${VALID_CATEGORIES.join("/")}）",
    ${outputFields},
    "score": 0-100,
    "evidence": ["来自'可引用的数据字段'的引用1", "引用2"]
  }
]

要求：
1. **每个题目的 evidence 至少 1 条来自上方"可引用的数据字段"，禁止编造**
2. 题目分布均衡（学科内不同维度），避免重复或相近题目
3. ${projectType === "PROPOSAL" ? "适合作为课题" : "适合作为论文"}展开
4. ${projectType === "PROPOSAL" ? "**严格按方法分配表填写 researchMethod 字段**" : "合理选择 paperStyle"}`;
}

// ── 关键词提取：从标题中提取 2-4 字的中文词组 ──
function extractKeywords(title: string): Set<string> {
  // 去除标点和空格
  const cleaned = title.replace(/[\s\-—，。、：；""''《》（）\[\]·]/g, "");
  const keywords = new Set<string>();
  // 提取 2-4 字的滑动窗口词组（中文教育术语多为 2-4 字）
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= cleaned.length - len; i++) {
      keywords.add(cleaned.substring(i, i + len));
    }
  }
  return keywords;
}

// ── 关键词重叠去重：重叠率 > 0.5 视为重复 ──
function keywordOverlap(a: string, b: string): number {
  const aKw = extractKeywords(a);
  const bKw = extractKeywords(b);
  if (aKw.size === 0 && bKw.size === 0) return 1;
  let overlap = 0;
  for (const k of aKw) {
    if (bKw.has(k)) overlap++;
  }
  return overlap / Math.min(aKw.size, bKw.size);
}

// ── 题目去重：关键词重叠率 > 0.5 视为重复 ──
function deduplicateTitles(titles: ResearchTitle[]): ResearchTitle[] {
  const unique: ResearchTitle[] = [];
  for (const t of titles) {
    const isDup = unique.some((u) => keywordOverlap(t.title, u.title) > 0.5);
    if (!isDup) unique.push(t);
  }
  return unique;
}

function parseTitles(text: string, count: number, projectType: "PAPER" | "PROPOSAL"): ResearchTitle[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const arr = JSON.parse(jsonMatch[0]);
    const raw: ResearchTitle[] = arr.slice(0, count).map((t: any, i: number) => ({
      index: i,
      title: t.title || "",
      description: t.description || "",
      category: VALID_CATEGORIES.includes(t.category) ? t.category : VALID_CATEGORIES[0],
      paperStyle: t.paperStyle,
      researchMethod: t.researchMethod,
      score: t.score || 70,
      evidence: Array.isArray(t.evidence) ? t.evidence : [],
    }));

    // ── P4：去重 ──
    const deduped = deduplicateTitles(raw);

    // ── 警告：去重后不足 count 个时记录日志（上层可看到）──
    if (deduped.length < count) {
      console.warn(`[parseTitles] 题目去重后剩 ${deduped.length}/${count}，原 ${raw.length} 个`);
    }

    return deduped;
  } catch {
    return [];
  }
}

// 导出供其他地方使用
export { PAPER_STYLES, RESEARCH_METHODS };