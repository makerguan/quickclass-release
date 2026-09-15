/**
 * AI 批阅服务 - 互动探究 & 课堂作业 共用
 * 支持：单选题/判断题（精确匹配）、填空题（AI语义评分）、简答题（AI评分）
 */

import { getAIConfig } from "./ai";
import {
  normalizeQuestionType,
  isOptionKeyAnswer,
  guessObjectiveType,
  OBJECTIVE_TYPES,
  SUBJECTIVE_TYPES,
} from "./question-type";
import { MATH_OUTPUT_RULES, fixInvalidJsonEscapes } from "./math-format";

export interface GradingQuestion {
  id: string;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "JUDGEMENT" | "FILL_BLANK" | "SHORT_ANSWER";
  content: string;
  options?: string; // JSON, for choice questions
  answer: string;   // 正确答案
  score: number;    // 满分
}

export interface StudentAnswer {
  questionId: string;
  selectedAnswer: string;
}

export interface GradingResult {
  questionId: string;
  score: number;
  maxScore: number;
  comment: string;
  isCorrect: boolean;
}

export interface AIGradingOutput {
  results: GradingResult[];
  learningAdvice?: string;
}

/**
 * 精确匹配（选择题/判断题）
 */
function gradeObjective(q: GradingQuestion, answer: string): GradingResult {
  var correct = q.answer.trim().toUpperCase();
  var selected = answer.trim().toUpperCase();
  var isCorrect = selected === correct;
  // 多选题：全对满分，不全对0分
  if (q.type === "MULTIPLE_CHOICE") {
    var correctSet = correct.split(",").map(function(s) { return s.trim(); }).filter(Boolean).sort().join(",");
    var selectedSet = selected.split(",").map(function(s) { return s.trim(); }).filter(Boolean).sort().join(",");
    var isCorrect = correctSet === selectedSet;
    return {
      questionId: q.id,
      score: isCorrect ? q.score : 0,
      maxScore: q.score,
      comment: isCorrect ? "正确" : "错误",
      isCorrect: isCorrect
    };
  }

  return {
    questionId: q.id,
    score: isCorrect ? q.score : 0,
    maxScore: q.score,
    comment: isCorrect ? "正确" : "错误",
    isCorrect: isCorrect
  };
}

/**
 * 把 AI 给的得分转成合法数值：非数字/负数一律记 0，且不超过该题满分
 */
function toScore(raw: unknown, maxScore: number): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, maxScore);
}

/**
 * 定位 AI 返回项对应的题目：精确 id → 忽略大小写 → 数字序号
 */
function resolveQuestionById(
  rawId: unknown,
  questions: GradingQuestion[],
  used: Set<string>
): GradingQuestion | undefined {
  if (rawId == null) return undefined;
  const id = String(rawId).trim();
  if (!id) return undefined;

  const direct = questions.find((q) => q.id === id && !used.has(q.id));
  if (direct) return direct;

  const lower = id.toLowerCase();
  const ignoreCase = questions.find((q) => q.id.toLowerCase() === lower && !used.has(q.id));
  if (ignoreCase) return ignoreCase;

  const numMatch = id.match(/(\d+)/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    const byIndex = questions[idx];
    if (byIndex && !used.has(byIndex.id)) return byIndex;
  }
  return undefined;
}

/**
 * 调用 AI 批阅填空/简答题
 */
async function gradeByAI(
  questions: GradingQuestion[],
  answers: StudentAnswer[],
  generateAdvice: boolean,
  studentName?: string
): Promise<{ results: GradingResult[]; learningAdvice?: string }> {
  const aiConfig = await getAIConfig();

  // 分离填空和简答
  const fillQuestions = questions.filter((q) => q.type === "FILL_BLANK");
  const shortQuestions = questions.filter((q) => q.type === "SHORT_ANSWER");

  const fillAnswers = answers.filter((a) => fillQuestions.find((q) => q.id === a.questionId));
  const shortAnswers = answers.filter((a) => shortQuestions.find((q) => q.id === a.questionId));

  // 构建 AI prompt
  const studentContext = studentName ? `学生姓名：${studentName}\n` : "";

  let prompt = `${studentContext}你是一位资深教师，请对以下主观题进行评分。\n\n`;

  // 注意：必须把 questionId 明确告诉 AI，否则 AI 无从得知（id 是 cuid），
  // 返回的结果会全部对不上号而被丢弃，导致主观题一律 0 分。
  let seq = 0;
  if (fillAnswers.length > 0) {
    prompt += "【填空题】\n";
    fillAnswers.forEach((a) => {
      const q = fillQuestions.find((q) => q.id === a.questionId)!;
      seq += 1;
      prompt += `第${seq}题 questionId：${q.id}\n题目：${q.content}\n学生答案：${a.selectedAnswer}\n正确答案：${q.answer}\n分值：${q.score}分\n\n`;
    });
  }

  if (shortAnswers.length > 0) {
    prompt += "【简答题】\n";
    shortAnswers.forEach((a) => {
      const q = shortQuestions.find((q) => q.id === a.questionId)!;
      seq += 1;
      prompt += `第${seq}题 questionId：${q.id}\n题目：${q.content}\n学生答案：${a.selectedAnswer}\n参考答案：${q.answer}\n分值：${q.score}分\n\n`;
    });
  }

  if (generateAdvice) {
    prompt += `请对每位学生的答题情况给出简洁的个性化学习建议（50字以内），格式：学习建议：xxx\n`;
  }

  // 统一数学公式输出格式：评语/学习建议里的数学内容需在前端正常显示
  prompt += `\n\n${MATH_OUTPUT_RULES}\n注意：结果以 JSON 输出，公式里的反斜杠在 JSON 字符串中必须写成双反斜杠，例如 $\\pi$ 在 JSON 中应写作 $\\\\pi$。`;

  prompt += `\n请严格按以下JSON格式输出评分结果（不要输出任何其他内容）：\n{\n  "results": [\n    {\n      "questionId": "题目ID",\n      "score": 得分,\n      "comment": "评语"\n    }\n  ]{{if generateAdvice}},"learningAdvice": "学习建议"{{/if}}\n}`;

  const response = await fetch(`${aiConfig.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages: [{ role: "user", content: prompt }],
      // 统一输出上限 64K（原生 fetch 走 OpenAI 兼容字段名）
      max_tokens: 65536,
    }),
  });

  if (!response.ok) {
    throw new Error("AI 批阅失败");
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  // 解析 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI 批阅返回格式错误");

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    // AI 常在评语里直接写 LaTeX（如 $\pi$），\p 不是合法 JSON 转义，补成 \\ 再解析一次
    parsed = JSON.parse(fixInvalidJsonEscapes(jsonMatch[0]));
  }

  const parsedList: any[] = Array.isArray(parsed.results) ? parsed.results : [];
  const results: GradingResult[] = [];
  const usedIds = new Set<string>();

  const pushResult = (r: any, q: GradingQuestion) => {
    const score = toScore(r?.score, q.score);
    results.push({
      questionId: q.id,
      score,
      maxScore: q.score,
      comment: r?.comment || "",
      isCorrect: score >= q.score * 0.6, // 60%以上算基本正确
    });
    usedIds.add(q.id);
  };

  for (const r of parsedList) {
    const q = resolveQuestionById(r?.questionId, questions, usedIds);
    if (q) pushResult(r, q);
  }

  // 兜底：AI 返回的 questionId 一个都对不上（编造 ID / 只给序号）时，按顺序配对，
  // 避免整份主观题被静默丢弃记 0 分
  if (results.length === 0 && parsedList.length === questions.length && questions.length > 0) {
    console.warn("[aiGrade] AI 返回的 questionId 全部无法匹配，已按题目顺序兜底配对");
    parsedList.forEach((r: any, i: number) => {
      const q = questions[i];
      if (q) pushResult(r, q);
    });
  }

  const missing = questions.filter((q) => !usedIds.has(q.id));
  if (missing.length > 0) {
    console.error(
      `[aiGrade] 以下题目 AI 未返回评分（将记为待批改）：${missing.map((q) => q.id).join(", ")}`
    );
  }

  return { results, learningAdvice: parsed.learningAdvice };
}

/**
 * 主函数：批量 AI 批阅
 * @param questions 题目列表
 * @param answers 学生答案列表
 * @param generateAdvice 是否生成学习建议（仅学生提交时需要）
 * @param studentName 学生姓名（可选）
 */
export async function aiGrade(
  questions: GradingQuestion[],
  answers: StudentAnswer[],
  generateAdvice = false,
  studentName?: string
): Promise<AIGradingOutput> {
  // 题型先归一化（"single" / "多选" 等脏值 → 规范类型），
  // 仍无法识别的按答案形态兜底分流，绝不静默跳过——
  // 历史 bug：非规范题型被两个名单同时排除，整题不批改却记为 0 分。
  const objectiveQuestions: GradingQuestion[] = [];
  const subjectiveQuestions: GradingQuestion[] = [];

  for (const q of questions) {
    const type = normalizeQuestionType(q.type);
    if (type && (OBJECTIVE_TYPES as readonly string[]).includes(type)) {
      objectiveQuestions.push({ ...q, type: type as GradingQuestion["type"] });
    } else if (type && (SUBJECTIVE_TYPES as readonly string[]).includes(type)) {
      subjectiveQuestions.push({ ...q, type: type as GradingQuestion["type"] });
    } else if (isOptionKeyAnswer(q.answer)) {
      // 答案是纯选项字母（A-D / T / F）→ 按客观题精确匹配
      const guessed = guessObjectiveType(q);
      console.warn(
        `[aiGrade] 题型无法识别（"${q.type}"），按${guessed}批改。题目ID：${q.id}`
      );
      objectiveQuestions.push({ ...q, type: guessed as GradingQuestion["type"] });
    } else {
      // 其余（含答案为文本的填空题）交给 AI 语义评分
      console.warn(`[aiGrade] 题型无法识别（"${q.type}"），按主观题批改。题目ID：${q.id}`);
      subjectiveQuestions.push({ ...q, type: "SHORT_ANSWER" });
    }
  }

  const results: GradingResult[] = [];
  let learningAdvice: string | undefined;

  // 客观题精确匹配
  for (const q of objectiveQuestions) {
    const ans = answers.find((a) => a.questionId === q.id);
    if (ans) results.push(gradeObjective(q, ans.selectedAnswer));
  }

  // 主观题 AI 批阅
  if (subjectiveQuestions.length > 0) {
    const subAnswers = answers.filter((a) =>
      subjectiveQuestions.find((q) => q.id === a.questionId)
    );
    if (subAnswers.length > 0) {
      try {
        const aiResult = await gradeByAI(subjectiveQuestions, subAnswers, generateAdvice, studentName);
        results.push(...aiResult.results);
        if (aiResult.learningAdvice) {
          learningAdvice = aiResult.learningAdvice;
        }
      } catch (aiErr) {
        // AI 批阅失败时，主观题默认 0 分，但不阻塞整体提交
        console.error("AI 主观题批阅失败:", aiErr);
      }
    }
  }

  return { results, learningAdvice };
}

/**
 * 生成教学建议（基于全班答题统计数据）
 */
export async function generateTeachingAdvice(
  questions: GradingQuestion[],
  questionStats: Array<{
    questionId: string;
    correctRate: number;
    avgScore: number;
  }>,
  className?: string
): Promise<string> {
  const aiConfig = await getAIConfig();

  const classContext = className ? `班级：${className}\n` : "";

  let prompt = `${classContext}你是一位资深学科教师，请根据以下答题统计数据，为教师提供教学改进建议。\n\n【题目统计】\n`;
  questionStats.forEach((stat) => {
    const q = questions.find((q) => q.id === stat.questionId);
    if (q) {
      prompt += `- ${q.content.substring(0, 50)}... 正确率：${(stat.correctRate * 100).toFixed(0)}%，平均分：${stat.avgScore.toFixed(1)}/${q.score}\n`;
    }
  });

  prompt += `\n请给出2-3条具体的教学改进建议，每条50字以内，格式：建议：xxx`;

  const response = await fetch(`${aiConfig.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages: [{ role: "user", content: prompt }],
      // 统一输出上限 64K（原生 fetch 走 OpenAI 兼容字段名）
      max_tokens: 65536,
    }),
  });

  if (!response.ok) throw new Error("AI 生成教学建议失败");

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return content.replace(/^[\s\n]+|[\s\n]+$/g, "");
}