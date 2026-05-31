/**
 * 提示词兼容层
 * 在模板驱动架构下，部分旧代码仍引用已删除的导出
 * 这里提供临时兼容实现，确保系统可运行
 */

export const ANALYST_SYSTEM = `你是一位资深学情分析师，分析对象为中小学生，分析报告供教师参考。请严格基于提供的对话数据进行分析，不做无证据的推断，建议应具体可操作。评价学生时应考虑其年龄阶段的特点，避免用成人标准衡量。直接输出结果，没有开场白。`;

export interface InsightConfig {
  insightLevel?: string;
  studentWordLimit?: number | null;
  classWordLimit?: number | null;
  starCount?: number;
  requireStarRating?: boolean;
}

// 简化的字数限制提示词（调用新的约束系统）
import { buildConstraintsSection } from "./insight";

export function getWordLimitPrompt(
  type: "student" | "class",
  config: InsightConfig,
): string {
  return buildConstraintsSection(type, {
    requireStarRating: config.requireStarRating ?? false,
    studentWordLimit: config.studentWordLimit,
    classWordLimit: config.classWordLimit,
  });
}

// 班级 outline
const CLASS_OUTLINE = {
  basic: "### 一、班级学情总览\n### 二、学习热点分析\n### 三、学生个体洞察\n### 四、教学建议",
  conversation: "### 一、对话活动参与情况\n### 二、学生学习表现分析\n### 三、知识点掌握与常见误区\n### 四、教学建议",
  subProject: "### 一、学习活动目标达成情况\n### 二、各对话活动表现对比\n### 三、共性问题与突出表现\n### 四、教学建议",
  task: "### 一、课堂目标达成情况\n### 二、各学习活动进展分析\n### 三、对话质量与互动深度分析\n### 四、知识点掌握情况\n### 五、学生分层与个体关注\n### 六、教学改进建议",
};

const STUDENT_OUTLINE = {
  basic: "### 一、学习画像\n### 二、知识掌握分析\n### 三、学习优势\n### 四、薄弱环节\n### 五、个性化学习建议",
  conversation: "### 一、学习表现\n### 二、知识点掌握\n### 三、优势与不足\n### 四、改进建议",
  subProject: "### 一、学习表现总评\n### 二、各活动优劣势分析\n### 三、个性化改进建议",
  task: "### 一、课堂参与度\n### 二、课堂目标达成评估\n### 三、各对话活动学习表现\n### 四、学习优势\n### 五、薄弱环节与改进建议",
};

export { CLASS_OUTLINE, STUDENT_OUTLINE };

// 兼容层：提供旧的构建函数（用于 api/ai-analysis/route.ts）
// 这些函数使用硬编码格式，在新的模板驱动架构下应该逐步废弃

export interface BasicClassPromptParams {
  students: { name: string; convCount: number; msgCount: number; topics: string[] }[];
  recentQuestions: string;
  totalAttempts: number;
  accuracy: number;
  evalSummary: string;
  dialogContents?: string;
  taskInfo?: { taskTitle?: string; grade?: string; subject?: string };
  config: InsightConfig;
}

export interface BasicStudentPromptParams {
  studentName: string;
  dialogSummaries: string;
  totalAttempts: number;
  accuracy: number;
  attemptDetails: string;
  evalInfo: string;
  historyContent?: string;
  taskInfo?: { taskTitle?: string; grade?: string; subject?: string };
  config: InsightConfig;
}

export function buildBasicClassPrompt(params: BasicClassPromptParams): string {
  const studentSummary = params.students
    .filter((s) => s.convCount > 0)
    .map((s) => `${s.name}：${s.convCount}次对话，${s.msgCount}条消息`)
    .join("\n");

  const dataSection = `## 班级基本情况
- 学生人数：${params.students.length}人
- 有对话记录的学生：${params.students.filter((s) => s.convCount > 0).length}人

## 学生对话情况
${studentSummary || "暂无对话记录"}

## 学生近期提问
${params.recentQuestions || "暂无提问"}
${params.dialogContents ? `\n## 学生对话记录\n${params.dialogContents}` : ""}`;

  return `${ANALYST_SYSTEM}

${dataSection}
---
请按以下格式输出：
${CLASS_OUTLINE.basic}
${getWordLimitPrompt("class", params.config)}`;
}

export function buildBasicStudentPrompt(params: BasicStudentPromptParams): string {
  const dataSection = `## 学生信息
姓名：${params.studentName}

## AI 对话记录
${params.dialogSummaries || "暂无"}

## 答题情况
- 总答题次数：${params.totalAttempts}次
- 正确率：${params.accuracy}%

${params.attemptDetails}
${params.evalInfo ? `## 评估得分\n${params.evalInfo}` : ""}
${params.historyContent ? `\n### 六、与上次分析对比\n${params.historyContent}` : ""}`;

  return `${ANALYST_SYSTEM}
${dataSection}
---
请按以下格式输出：
${STUDENT_OUTLINE.basic}
${getWordLimitPrompt("student", params.config)}`;
}
