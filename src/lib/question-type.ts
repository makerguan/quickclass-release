/**
 * 题目类型归一化工具
 *
 * 背景：AI 出题可能返回 "single" / "多选" / "truefalse" 等非规范写法，
 * 历史数据里也存在此类脏值。而 aiGrade() 的客观题/主观题分组用的是
 * 白名单精确匹配，非规范类型会被两个名单同时排除 → 整题不批改 →
 * 静默记 0 分（学生答案明明正确）。
 *
 * 统一在此收口：出题解析、入库保存、批改分组三处都调用它。
 */

/** 客观题（精确匹配判分） */
export const OBJECTIVE_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "JUDGEMENT",
] as const;

/** 主观题（AI 语义评分） */
export const SUBJECTIVE_TYPES = ["FILL_BLANK", "SHORT_ANSWER"] as const;

/** 非规范写法 → 规范类型的别名表（key 需大写、空格/连字符已转下划线） */
const TYPE_ALIASES: Record<string, string> = {
  // 单选
  SINGLE: "SINGLE_CHOICE",
  SINGLE_CHOICE: "SINGLE_CHOICE",
  SINGLECHOICE: "SINGLE_CHOICE",
  CHOICE: "SINGLE_CHOICE",
  RADIO: "SINGLE_CHOICE",
  "单选": "SINGLE_CHOICE",
  "单选题": "SINGLE_CHOICE",
  "选择题": "SINGLE_CHOICE",
  // 多选
  MULTIPLE: "MULTIPLE_CHOICE",
  MULTIPLE_CHOICE: "MULTIPLE_CHOICE",
  MULTIPLECHOICE: "MULTIPLE_CHOICE",
  MULTI: "MULTIPLE_CHOICE",
  MULTIPLECHOICES: "MULTIPLE_CHOICE",
  CHECKBOX: "MULTIPLE_CHOICE",
  "多选": "MULTIPLE_CHOICE",
  "多选题": "MULTIPLE_CHOICE",
  // 判断
  TRUE_FALSE: "TRUE_FALSE",
  TRUEFALSE: "TRUE_FALSE",
  TRUE_OR_FALSE: "TRUE_FALSE",
  BOOLEAN: "TRUE_FALSE",
  JUDGEMENT: "JUDGEMENT",
  JUDGMENT: "JUDGEMENT",
  JUDGE: "JUDGEMENT",
  "判断": "TRUE_FALSE",
  "判断题": "TRUE_FALSE",
  // 填空
  FILL_BLANK: "FILL_BLANK",
  FILLBLANK: "FILL_BLANK",
  FILL_IN_BLANK: "FILL_BLANK",
  FILL: "FILL_BLANK",
  BLANK: "FILL_BLANK",
  CLOZE: "FILL_BLANK",
  "填空": "FILL_BLANK",
  "填空题": "FILL_BLANK",
  // 简答
  SHORT_ANSWER: "SHORT_ANSWER",
  SHORTANSWER: "SHORT_ANSWER",
  SHORT: "SHORT_ANSWER",
  ESSAY: "SHORT_ANSWER",
  "简答": "SHORT_ANSWER",
  "简答题": "SHORT_ANSWER",
  "问答": "SHORT_ANSWER",
  "解答": "SHORT_ANSWER",
};

/**
 * 归一化题目类型
 * @returns 规范类型；无法识别时返回 null（调用方需兜底，绝不能静默跳过）
 */
export function normalizeQuestionType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 先查原文（兼容中文，中文无大小写之分）
  if (TYPE_ALIASES[trimmed]) return TYPE_ALIASES[trimmed];

  // 再查规范化后的 key：大写 + 空格/连字符转下划线
  const key = trimmed.toUpperCase().replace(/[\s\-]+/g, "_");
  return TYPE_ALIASES[key] || null;
}

/** 答案归一化（去空格 + 大写），用于选项字母比较 */
export function normalizeChoiceAnswer(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

/**
 * 答案是否为纯选项字母（A-D / T / F，可逗号分隔）
 * 用于判断题型无法识别时，该题应按客观题还是主观题处理
 */
export function isOptionKeyAnswer(raw: unknown): boolean {
  const answer = normalizeChoiceAnswer(raw);
  if (!answer) return false;
  const parts = answer
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => /^[A-D]$/.test(p) || p === "T" || p === "F");
}

/**
 * 根据答案形态推断客观题的具体类型（仅在题型无法识别时兜底使用）
 */
export function guessObjectiveType(question: {
  answer: string;
  options?: string;
}): "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" {
  const parts = normalizeChoiceAnswer(question.answer)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 1 && (parts[0] === "T" || parts[0] === "F")) {
    return "TRUE_FALSE";
  }
  if (parts.length > 1) return "MULTIPLE_CHOICE";
  return "SINGLE_CHOICE";
}
