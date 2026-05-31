/**
 * 学情分析提示词构建参数类型（旧的兼容接口）
 * 这些接口保留用于旧代码兼容，新代码应使用 renderInsightTemplate
 */

export interface InsightConfig {
  insightLevel?: string;
  studentWordLimit?: number | null;
  classWordLimit?: number | null;
  starCount?: number;
  requireStarRating?: boolean;
  isHtmlOutput?: boolean;
}

export interface BuildConversationClassParams {
  pcTitle: string;
  pcDescription?: string;
  spTitle: string;
  spObjectives: string;
  spRequirements: string;
  activeCount: number;
  totalStudents: number;
  dialogContents: string;
  customSection?: string;
  taskInfo?: { taskTitle: string; taskObjectives?: string; grade?: string; subject?: string };
  config: InsightConfig;
}

export interface BuildConversationStudentParams {
  pcTitle: string;
  pcDescription?: string;
  spTitle: string;
  spObjectives: string;
  spRequirements: string;
  activeCount?: number;
  totalStudents?: number;
  studentName: string;
  dialogContent: string;
  customSection?: string;
  taskInfo?: { taskTitle: string; taskObjectives?: string; grade?: string; subject?: string };
  config: InsightConfig;
}

export interface BuildTaskClassParams {
  taskTitle: string;
  taskObjectives: string;
  taskRequirements: string;
  knowledgeBase?: string;
  pcClassInsights: { pcTitle: string; content: string }[];
  pcStudentInsights: { studentName: string; pcTitle: string; content: string }[];
  customSection?: string;
  useSubInsights: boolean;
  dialogContents?: string;
  /** 作业统计数据 */
  quizStats?: string;
  /** 个人对话分析报告 */
  personalDialogAnalysisReport?: string;
  /** 班级对话分析报告 */
  classDialogAnalysisReport?: string;
  /** 全班作业数据 */
  classQuizStats?: string;
  rawData?: {
    students: { name: string; convCount: number; msgCount: number; completedPresets: number; totalPresets: number }[];
    recentQuestions: string;
    subProjectSummary: string;
  };
  taskInfo?: { taskTitle: string; taskObjectives?: string; grade?: string; subject?: string };
  config: InsightConfig;
}

export interface BuildTaskStudentParams {
  taskTitle: string;
  taskObjectives: string;
  taskRequirements: string;
  knowledgeBase?: string;
  studentName: string;
  pcStudentInsights: { pcTitle: string; content: string; studentName?: string }[];
  dialogContents: string;
  presetCompletion: string;
  customSection?: string;
  useSubInsights: boolean;
  /** 个人作业统计数据 */
  quizStats?: string;
  /** 全班作业统计数据（用于对比） */
  classQuizStats?: string;
  pcClassInsights?: { pcTitle: string; content: string }[];
  taskInfo?: { taskTitle: string; taskObjectives?: string; grade?: string; subject?: string };
  config: InsightConfig;
}