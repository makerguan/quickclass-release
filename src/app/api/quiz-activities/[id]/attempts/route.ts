import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { aiGrade, GradingQuestion } from "@/lib/ai-grading";

// POST: 提交作业答案（含AI批阅主观题）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const quiz = await prisma.quizActivity.findFirst({
      where: { id, status: "ACTIVE" },
      include: { Question: { orderBy: { order: "asc" } } },
    });
    if (!quiz) return new Response("作业不存在或未发布", { status: 404 });

    const userId = String(payload.userId);
    const { answers } = await req.json(); // [{ questionId, selectedAnswer }]

    if (!Array.isArray(answers)) {
      return new Response("answers 必须是数组", { status: 400 });
    }

    // 检查是否已提交：只有 submittedAt 非空 且 答题记录完整 才算已提交
    // 脏数据（submittedAt 非空但 QuestionAttempt 不足）：允许覆盖重新提交
    const existingAttempt = await prisma.quizAttempt.findFirst({
      where: { userId, quizActivityId: id },
      include: { QuestionAttempt: { select: { id: true } } },
    });
    if (existingAttempt?.submittedAt && existingAttempt.QuestionAttempt.length === quiz.Question.length) {
      return NextResponse.json({ error: "作业已提交，不能重复提交" }, { status: 403 });
    }

    // 校验前端传来的 questionId 是否与当前题目匹配
    for (const a of answers) {
      if (!quiz.Question.find((q) => q.id === a.questionId)) {
        return NextResponse.json({ error: "题目已被修改，请刷新页面后重新作答" }, { status: 409 });
      }
    }

    // 转换为 AI 批阅格式
    const gradingQuestions: GradingQuestion[] = quiz.Question.map((q) => ({
      id: q.id,
      type: q.type as any,
      content: q.content,
      options: q.options || undefined,
      answer: q.answer,
      score: q.score || Math.round(100 / quiz.Question.length),
    }));

    // 调用 AI 批阅（选择题走精确匹配，填空简答走 AI）
    const gradingResult = await aiGrade(gradingQuestions, answers, false);

    // 确保 attempt 记录存在
    let attempt = existingAttempt;
    if (!attempt) {
      attempt = await prisma.quizAttempt.create({
        data: { userId, quizActivityId: id },
      });
    }

    // 在事务外预计算所有分数，事务内只做写入，确保原子性
    const questionResults = answers.map((a: { questionId: string; selectedAnswer: string }) => {
      const question = quiz.Question.find((q) => q.id === a.questionId)!;
      const grading = gradingResult.results.find((r) => r.questionId === a.questionId);
      const isCorrect = grading?.isCorrect ?? false;
      const perQuestionMax = question.score || Math.round(100 / quiz.Question.length);
      const score = grading?.score != null
        ? grading.score
        : (isCorrect ? perQuestionMax : 0);
      const maxScore = grading?.maxScore != null
        ? grading.maxScore
        : perQuestionMax;
      return { a, question, isCorrect, score, maxScore, grading };
    });

    const correctCount = questionResults.filter((r) => r.isCorrect).length;
    const totalRawScore = questionResults.reduce((s, r) => s + r.score, 0);
    const maxTotalScore = questionResults.reduce((s, r) => s + r.maxScore, 0);
    const percentScore = maxTotalScore > 0
      ? Math.round((totalRawScore / maxTotalScore) * 100)
      : 0;

    // 事务写入：deleteMany + create + update 同生同灭，避免脏数据
    await prisma.$transaction(async (tx) => {
      await tx.questionAttempt.deleteMany({ where: { quizAttemptId: attempt!.id } });

      for (const r of questionResults) {
        await tx.questionAttempt.create({
          data: {
            quizAttemptId: attempt!.id,
            questionId: r.a.questionId,
            selectedAnswer: r.a.selectedAnswer,
            isCorrect: r.isCorrect,
            score: r.score,
            maxScore: r.maxScore,
            comment: r.grading?.comment,
            gradedBy: "ai",
          },
        });
      }

      await tx.quizAttempt.update({
        where: { id: attempt!.id },
        data: {
          score: percentScore,
          totalQuestions: quiz.Question.length,
          correctCount,
          totalScore: totalRawScore,
          maxTotalScore,
          submittedAt: new Date(),
        },
      });
    });

    return NextResponse.json({
      attemptId: attempt.id,
      score: percentScore,
      totalScore: totalRawScore,
      maxTotalScore,
      totalQuestions: quiz.Question.length,
      correctCount,
      passScore: quiz.passScore ?? 60,
      results: gradingResult.results,
    });
  } catch (error) {
    console.error("提交作业失败:", error);
    return new Response("提交失败", { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const attempt = await prisma.quizAttempt.findFirst({
      where: {
        userId: String(payload.userId),
        quizActivityId: id,
      },
      include: {
        QuestionAttempt: {
          include: {
            Question: { select: { id: true, content: true, answer: true, type: true } },
          },
        },
      },
    });

    if (!attempt) return NextResponse.json(null);
    
    // 转换格式，添加 answers 数组（前端期望的格式）
    return NextResponse.json({
      id: attempt.id,
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      correctCount: attempt.correctCount,
      answers: attempt.QuestionAttempt.map((qa) => ({
        questionId: qa.questionId,
        selectedAnswer: qa.selectedAnswer,
        isCorrect: qa.isCorrect,
        score: qa.score,
        comment: qa.comment,
        // 包含题目信息（用于显示标准答案）
        question: qa.Question,
      })),
    });
  } catch (error) {
    console.error("查询答题记录失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}
