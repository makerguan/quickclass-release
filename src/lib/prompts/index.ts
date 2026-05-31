/**
 * 学情分析提示词统一导出
 */

// 核心模板渲染（新版）
export {
  renderInsightTemplate,
  renderPCClassTemplate,
  renderPCStudentTemplate,
  renderTaskClassTemplate,
  renderTaskStudentTemplate,
  buildConstraintsSection,
  getDefaultConstraints,
  getTemplateCategory,
  validateTemplate,
} from "./insight";

// 模板变量
export {
  replaceTemplateVars,
  replaceConversationVars,
  replaceTaskVars,
  type ConversationTemplateVars,
  type TaskTemplateVars,
  type InsightConstraints,
} from "./insight";

// 兼容层（保留用于基础分析 api/ai-analysis/route.ts）
export {
  buildConversationClassPrompt,
  buildConversationStudentPrompt,
  buildTaskClassPrompt,
  buildTaskStudentPrompt,
} from "./insight";

// 兼容导出（旧代码需要）
export {
  ANALYST_SYSTEM,
  getWordLimitPrompt,
  CLASS_OUTLINE,
  STUDENT_OUTLINE,
  buildBasicClassPrompt,
  buildBasicStudentPrompt,
  type InsightConfig,
  type BasicClassPromptParams,
  type BasicStudentPromptParams,
} from "./compat";

// chat.ts 导出
export {
  CLASS_AI_PROMPTS,
  getClassPromptByStrategy,
  BEHAVIOR_GUIDELINES,
  KNOWLEDGE_BASE_RULE,
  IMAGE_NOTICE,
  MATERIAL_CONTENT_PREFIX,
} from "./chat";