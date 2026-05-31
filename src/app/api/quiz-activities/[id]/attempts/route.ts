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

    // 查找或创建答题记录
    let attempt = await prisma.quizAttempt.findFirst({
      where: { userId, quizActivityId: id },
    });
    if (!attempt) {
      attempt = await prisma.quizAttempt.create({
        data: { userId, quizActivityId: id },
      });
    }

    // 删除旧记录（如果重新提交）
    await prisma.questionAttempt.deleteMany({ where: { quizAttemptId: attempt.id } });

    // 写入逐题记录
    let correctCount = 0;
    let totalRawScore = 0;
    let maxTotalScore = 0;

    await Promise.all(
      answers.map(async (a: { questionId: string; selectedAnswer: string }) => {
        const question = quiz.Question.find((q) => q.id === a.questionId);
        if (!question) return;

        const grading = gradingResult.results.find((r) => r.questionId === a.questionId);
        const isCorrect = grading?.isCorrect ?? false;
        if (isCorrect) correctCount++;

        const score = grading?.score ?? (isCorrect ? (question.score || 25) : 0);
        const maxScore = grading?.maxScore ?? (question.score || Math.round(100 / quiz.Question.length));
        totalRawScore += score;
        maxTotalScore += maxScore;

        return prisma.questionAttempt.create({
          data: {
            quizAttemptId: attempt!.id,
            questionId: a.questionId,
            selectedAnswer: a.selectedAnswer,
            isCorrect,
            score,
            maxScore,
            comment: grading?.comment,
            gradedBy: isCorrect ? "ai" : "ai", // 选择题和主观题都是 AI 批阅
          },
        });
      })
    );

    // 计算百分制分数
    const percentScore = maxTotalScore > 0
      ? Math.round((totalRawScore / maxTotalScore) * 100)
      : 0;

    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        score: percentScore,
        totalQuestions: quiz.Question.length,
        correctCount,
        totalScore: totalRawScore,
        maxTotalScore,
        submittedAt: new Date(),
      },
    });

    return NextResponse.json({
      attemptId: attempt.id,
      score: percentScore,
      totalScore: totalRawScore,
      maxTotalScore,
      totalQuestions: quiz.Question.length,
      correctCount,
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
