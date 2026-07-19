/**
 * 课堂作业提示词模板变量替换
 */

export interface QuizTemplateVars {
  task: {
    title: string;
    grade?: string | null;
    subject?: string | null;
    objectives: string;
    knowledgeBase?: string | null;
  };
  presetConv: {
    description?: string | null;
  };
  knowledgeBases?: Array<{ name: string; content: string }>;
  teacherName?: string;
  quizCount?: number;
  /** 教师预设对话描述（供模板变量 {convDescription} 使用） */
  convDescription?: string;
  /** 格式化的知识库列表文本（供模板变量 {kbList} 使用） */
  kbList?: string;
}

/**
 * 替换模板中的变量占位符（统一使用 {} 单大括号格式）
 */
export function replaceQuizTemplateVars(
  template: string,
  vars: QuizTemplateVars
): string {
  let result = template;

  // 1. 移除所有 {{#if}}...{{/if}} 条件块（统一用 {} 后不再需要）
  result = result.replace(/\{\{#if [^}]+\}\}[\s\S]*?\{\{\/if\}\}/g, "");

  // 2. 清理所有 {{}} 双括号残留（统一用 {} 后不再需要）
  result = result.replace(/\{\{[^}]+\}\}/g, "");

  // 3. 课堂信息变量
  result = result.replace(/\{taskTitle\}/g, vars.task.title || "");
  result = result.replace(/\{taskObjectives\}/g, vars.task.objectives || "");
  result = result.replace(/\{taskGrade\}/g, vars.task.grade || "");
  result = result.replace(/\{taskSubject\}/g, vars.task.subject || "");
  result = result.replace(/\{teacherName\}/g, vars.teacherName || "");

  // 4. 对话描述
  result = result.replace(/\{convDescription\}/g, vars.convDescription || "");

  // 5. 知识库内容（{kbContent} 旧格式保留兼容，{kbList} 新格式）
  if (vars.knowledgeBases && vars.knowledgeBases.length > 0) {
    const kbText = vars.knowledgeBases
      .map((kb) => `【${kb.name}】：\n${kb.content}`)
      .join("\n\n");
    result = result.replace(/\{kbContent\}/g, kbText);
    result = result.replace(/\{kbList\}/g, kbText);
  } else {
    result = result.replace(/\{kbContent\}/g, "");
    result = result.replace(/\{kbList\}/g, "");
  }

  // 6. quizCount
  result = result.replace(
    /\{quizCount\}/g,
    String(vars.quizCount || 5)
  );

  // 7. 清理残留的未替换变量（保留 A/B/C/D/T/F 选项占位符）
  result = result.replace(/\{[^}]+\}/g, (match) => {
    const known = ["A","B","C","D","T","F"];
    if (known.includes(match)) return match;
    return "";
  });

  return result;
}

/**
 * 构建出题用的完整 Prompt
 */
export function buildQuizGeneratePrompt(
  templateContent: string,
  vars: QuizTemplateVars
): string {
  var base = replaceQuizTemplateVars(templateContent, vars);
  // 自动追加统一的输出格式要求
  if (base.indexOf("输出格式") < 0) {
    base += QUIZ_FORMAT_INSTRUCTIONS;
  }
  return base;
}

/**
 * 对话活动提示词模板变量替换
 * 变量格式使用 {} 单括号，与 Conversation 模板保持一致
 */
export interface ConversationTemplateVars {
  task: {
    title: string;
    grade?: string | null;
    subject?: string | null;
    objectives: string;
    requirements?: string;
  };
  teacherName?: string;
  /** 对话数量，由 AI 根据内容自主决定（2-4个） */
  conversationCount?: number;
}

/**
 * 替换对话模板中的变量占位符
 * 统一使用驼峰格式 {taskTitle}，同时兼容旧点号格式 {task.title}
 */
export function replaceConversationTemplateVars(
  template: string,
  vars: ConversationTemplateVars
): string {
  let result = template;

  // 驼峰格式（推荐）
  result = result.replace(/\{taskTitle\}/g, vars.task.title || "");
  result = result.replace(/\{taskGrade\}/g, vars.task.grade || "");
  result = result.replace(/\{taskSubject\}/g, vars.task.subject || "");
  result = result.replace(/\{taskObjectives\}/g, vars.task.objectives || "");
  result = result.replace(/\{taskRequirements\}/g, vars.task.requirements || "");
  result = result.replace(/\{teacherName\}/g, vars.teacherName || "");
  result = result.replace(
    /\{conversationCount\}/g,
    String(vars.conversationCount || 3)
  );

  // 旧点号格式（兼容，逐步废弃）
  result = result.replace(/\{task\.title\}/g, vars.task.title || "");
  result = result.replace(/\{task\.grade\}/g, vars.task.grade || "");
  result = result.replace(/\{task\.subject\}/g, vars.task.subject || "");
  result = result.replace(/\{task\.objectives\}/g, vars.task.objectives || "");
  result = result.replace(/\{task\.requirements\}/g, vars.task.requirements || "");

  // 清理残留的未替换变量
  result = result.replace(/\{[^}]+\}/g, "");

  return result;
}

/**
 * 构建对话设计用的完整 Prompt
 * 输出多个对话活动的 JSON 数组
 */
export function buildConversationGeneratePrompt(
  templateContent: string,
  vars: ConversationTemplateVars
): string {
  return replaceConversationTemplateVars(templateContent, vars);
}

/**
 * 解析 AI 返回的对话活动 JSON 数组
 */
export function parseConversationsFromAIResponse(
  response: string
): Array<{
  title: string;
  description: string;
  systemPrompt: string;
  analysisPrompt: string;
}> {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("AI 输出中未找到 JSON 数组");
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * 从题目内容中解析选项文本
 * 例如："下列列式正确的是（单选题）（ ）A. 3×4×5 B. 3×4×5 C. 3×4×5 D. 3×4×5"
 * 返回 { "A": "3×4×5", "B": "3×4×5", ... }
 */
function extractOptionsFromContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  // 匹配 A. xxx B. xxx C. xxx D. xxx 格式
  const optionPattern = /([A-D])\.\s*([^A-D\n]+?)(?=[A-D]\.|$)/g;
  let match;
  while ((match = optionPattern.exec(content)) !== null) {
    result[match[1]] = match[2].trim();
  }
  return result;
}

/**
 * 解析 AI 返回的 JSON 题目数组
 */
export function parseQuestionsFromAIResponse(
  response: string
): Array<{
  type: string;
  content: string;
  options: Record<string, string>;
  answer: string;
  difficulty: string;
  explanation?: string;
}> {
  // 尝试提取 JSON 数组
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("AI 输出中未找到 JSON 数组");
  }
  // 清理 AI 返回的特殊字符（换行、制表等）避免 JSON 解析失败
  let cleaned = jsonMatch[0]
    .replace(/[\n\r\t]/g, " ")
    .replace(/\s+/g, " ");
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // 如果还是失败，尝试更激进地清理不可见字符
    cleaned = jsonMatch[0].replace(/[^\x20-\x7E]/g, " ");
    parsed = JSON.parse(cleaned);
  }
  // 标准化题目格式
  return parsed.map((q: any) => {
    // 1. 字段名兼容：question -> content
    const content = q.question || q.content || "";

    // 2. 选项格式兼容：数组 -> 对象
    let options: Record<string, string> = {};
    if (Array.isArray(q.options)) {
      if (q.options.length === 2) {
        // 判断题：选项为 ["A","B"] 或 ["T","F"]，转为 T/F
        options = { "T": "正确", "F": "错误" };
      } else {
        // 选择题：尝试从题目内容中解析选项文本
        const optionTexts = extractOptionsFromContent(content);
        q.options.forEach((opt: string) => {
          // 优先使用解析出的选项文本，否则用选项字母
          options[opt] = optionTexts[opt] || opt;
        });
      }
    } else if (typeof q.options === "object" && q.options !== null) {
      options = q.options;
    }

    // 3. 自动判断题型
    let type = q.type || "SINGLE_CHOICE";
    let answer = String(q.answer || "").toUpperCase().trim();

    // 如果答案只有 T/F 或选项有 T/F，判定为判断题
    if (answer === "T" || answer === "F" || answer === "TRUE" || answer === "FALSE") {
      type = "TRUE_FALSE";
      // 标准化答案为 T/F
      if (answer === "TRUE") answer = "T";
      else if (answer === "FALSE") answer = "F";
    }
    // 如果答案含多个字母（逗号分隔或连续），判定为多选题
    else if (answer.length > 1 && !["A","B","C","D"].includes(answer)) {
      type = "MULTIPLE_CHOICE";
      // 答案可能是 "ABC" 或 "A,B,C"，统一为逗号分隔
      answer = answer.split("").filter(c => /[A-Z]/.test(c)).join(",");
    }

    return {
      type,
      content,
      options,
      answer,
      difficulty: q.difficulty || "BASIC",
      explanation: q.explanation || null,
    };
  });
}

/**
 * 统一输出格式要求 - 由程序控制，教师模板不包含此内容
 */
export const QUIZ_FORMAT_INSTRUCTIONS = `
## 输出格式（必须严格遵守）
每道题必须包含以下字段的JSON对象，总分数必须等于100：
- type: SINGLE_CHOICE | MULTIPLE_CHOICE（多选答案用逗号如"A,B"） | TRUE_FALSE（答案 T 或 F） | FILL_BLANK（填空）
- content: 题目文本
- options: 选择题和判断题的选项对象，格式如 {"A":"选项A","B":"选项B"}
- answer: 正确答案（多选用逗号分隔）
- score: 分值，所有题目分值之和必须等于100
- difficulty: BASIC | INTERMEDIATE | ADVANCED
- explanation: 答案解析

输出JSON数组格式示例：
[
  {"type":"SINGLE_CHOICE","content":"题目","options":{"A":"A"},"answer":"A","score":20,"difficulty":"BASIC","explanation":"解析"},
  {"type":"MULTIPLE_CHOICE","content":"多选","options":{"A":"A"},"answer":"A,B","score":20,"difficulty":"BASIC","explanation":"解析"},
  {"type":"TRUE_FALSE","content":"判断","answer":"T","score":20,"difficulty":"BASIC"},
  {"type":"FILL_BLANK","content":"填空","answer":"答案","score":20,"difficulty":"BASIC"}
]
请直接输出JSON数组，不要使用代码块包裹，不要添加任何解释性文字。只需输出纯JSON数组。
`;
