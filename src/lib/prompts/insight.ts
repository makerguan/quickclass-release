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
  requireStarRating: boolean;
  studentWordLimit?: number | null;
  classWordLimit?: number | null;
  /** 生成 HTML 输出时跳过字数限制和 Markdown 格式约束 */
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
 * 根据约束类型构建约束段落（追加到提示词末尾）
 * 当 isHtmlOutput 为 true 时，跳过字数限制和输出格式约束
 */
export function buildConstraintsSection(
  type: "student" | "class",
  constraints: InsightConstraints
): string {
  if (constraints.isHtmlOutput) return ""; // HTML 输出不受约束

  const parts: string[] = [];

  // 星星评分约束
  if (type === "student") {
    if (constraints.requireStarRating) {
      parts.push(`## 评分输出规则（强制）\n学生分析必须按以下规则输出：\n1. 只输出 6-10 个五角星（★），禁止输出任何其他文字\n2. 示例：★★★★★★（6个星）到 ★★★★★★★★★★（10个星）\n3. 星星数量代表本次对话整体表现评分\n4. 禁止在星星前后添加任何说明文字`);
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
  spTitle: string;
  spObjectives: string;
  spRequirements: string;
  activeCount: number;
  totalStudents: number;
  studentName?: string;
  /** 个人对话记录 */
  personalDialogContents?: string;
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
    spTitle: vars.spTitle,
    spObjectives: vars.spObjectives,
    spRequirements: vars.spRequirements,
    activeCount: vars.activeCount,
    totalStudents: vars.totalStudents,
    // 数据变量（模板引用）
    personalDialogContents: vars.personalDialogContents || "",
    // 课堂信息变量
    taskTitle: vars.taskTitle || "",
    taskDescription: vars.taskDescription || vars.taskTitle ? (vars.taskDescription || "") : "",
    taskGrade: vars.taskGrade || "",
    taskSubject: vars.taskSubject || "",
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
  } else {
    content = replaceTaskVars(templateContent, vars as TaskTemplateVars);
  }

  // 追加约束条件
  const constraintSection = buildConstraintsSection(isStudent ? "student" : "class", constraints);
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
      spTitle: params.spTitle,
      spObjectives: params.spObjectives,
      spRequirements: params.spRequirements,
      activeCount: params.activeCount,
      totalStudents: params.totalStudents,
      // 旧参数映射到新变量（模板引用 {班级对话活动分析报告}）
      personalDialogContents: params.dialogContents || "",
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
      spTitle: params.spTitle,
      spObjectives: params.spObjectives,
      spRequirements: params.spRequirements,
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
      rawData: params.rawData,
      // 旧参数映射到新变量
      personalDialogContents: params.dialogContents || "",
      personalQuizStats: params.quizStats || "",
      personalDialogAnalysisReport: params.personalDialogAnalysisReport || "",
      classDialogAnalysisReport: params.classDialogAnalysisReport || "",
      classQuizStats: params.classQuizStats || "",
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
    },
    {
      requireStarRating: params.config?.requireStarRating ?? false,
      studentWordLimit: params.config?.studentWordLimit || null,
      classWordLimit: null,
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