/**
 * AI 批阅服务 - 互动探究 & 课堂作业 共用
 * 支持：单选题/判断题（精确匹配）、填空题（AI语义评分）、简答题（AI评分）
 */

import { getAIConfig } from "./ai";

export interface GradingQuestion {
  id: string;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "FILL_BLANK" | "SHORT_ANSWER";
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
  // 多选题：比较集合，全对满分，漏选一半分，错选不得分
  if (q.type === "MULTIPLE_CHOICE") {
    var correctSet = correct.split(",").map(function(s) { return s.trim(); }).sort().join(",");
    var selectedSet = selected.split(",").map(function(s) { return s.trim(); }).sort().join(",");
    var fullMatch = correctSet === selectedSet;
    var partialMatch = selectedSet !== "" && selectedSet.split(",").every(function(s) { return correctSet.indexOf(s) >= 0; });
    if (fullMatch) {
      return {
        questionId: q.id,
        score: q.score,
        maxScore: q.score,
        comment: "全对",
        isCorrect: true
      };
    } else if (partialMatch) {
      var halfScore = Math.round(q.score / 2);
      return {
        questionId: q.id,
        score: halfScore,
        maxScore: q.score,
        comment: "漏选，得一半分",
        isCorrect: false
      };
    } else {
      return {
        questionId: q.id,
        score: 0,
        maxScore: q.score,
        comment: "选错，不得分",
        isCorrect: false
      };
    }
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

  if (fillAnswers.length > 0) {
    prompt += "【填空题】\n";
    fillAnswers.forEach((a) => {
      const q = fillQuestions.find((q) => q.id === a.questionId)!;
      prompt += `题目：${q.content}\n学生答案：${a.selectedAnswer}\n正确答案：${q.answer}\n分值：${q.score}分\n\n`;
    });
  }

  if (shortAnswers.length > 0) {
    prompt += "【简答题】\n";
    shortAnswers.forEach((a) => {
      const q = shortQuestions.find((q) => q.id === a.questionId)!;
      prompt += `题目：${q.content}\n学生答案：${a.selectedAnswer}\n参考答案：${q.answer}\n分值：${q.score}分\n\n`;
    });
  }

  if (generateAdvice) {
    prompt += `请对每位学生的答题情况给出简洁的个性化学习建议（50字以内），格式：学习建议：xxx\n`;
  }

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
      max_tokens: 2000,
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

  const parsed = JSON.parse(jsonMatch[0]);

  const results: GradingResult[] = parsed.results.map((r: any) => {
    const q = questions.find((q) => q.id === r.questionId)!;
    return {
      questionId: r.questionId,
      score: Math.min(r.score, q.score), // 不超过满分
      maxScore: q.score,
      comment: r.comment || "",
      isCorrect: r.score >= q.score * 0.6, // 60%以上算基本正确
    };
  });

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
  const objectiveQuestions = questions.filter((q) =>
    q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE"
  );
  const subjectiveQuestions = questions.filter((q) =>
    q.type === "FILL_BLANK" || q.type === "SHORT_ANSWER"
  );

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
      const aiResult = await gradeByAI(subjectiveQuestions, subAnswers, generateAdvice, studentName);
      results.push(...aiResult.results);
      if (aiResult.learningAdvice) {
        learningAdvice = aiResult.learningAdvice;
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
      max_tokens: 1500,
    }),
  });

  if (!response.ok) throw new Error("AI 生成教学建议失败");

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return content.replace(/^[\s\n]+|[\s\n]+$/g, "");
}