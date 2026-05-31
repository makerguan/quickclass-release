import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const filterClassId = searchParams.get("classId");
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const quiz = await prisma.quizActivity.findFirst({
      where: { id, SubProject: { task: { teacherId: String(payload.userId) } } },
      include: {
        Question: { orderBy: { order: "asc" } },
        QuizAttempt: {
          include: { User: { select: { id: true, name: true, classId: true } }, QuestionAttempt: true },
        },
        SubProject: {
          select: {
            task: { select: { teacherId: true, id: true } },
          },
        },
      },
    });
    if (!quiz) return new Response("作业不存在", { status: 404 });

    // 获取班级所有学生（用于统计未参加/未完成的学生）
    const classIds = filterClassId
      ? [filterClassId]
      : await prisma.learningTask.findFirst({
          where: { subProjects: { some: { QuizActivity: { some: { id } } } } },
          include: { assignments: { select: { classId: true } } },
        }).then(t => t?.assignments?.map(a => a.classId) || []);
    
    const allStudentsInClass = classIds.length > 0
      ? await prisma.user.findMany({
          where: { classId: { in: classIds }, role: "STUDENT" },
          select: { id: true, name: true, classId: true },
        })
      : [];
    
    // 按班级过滤 attempts
    const filteredAttempts = filterClassId
      ? quiz.QuizAttempt.filter(a => a.User.classId === filterClassId)
      : quiz.QuizAttempt;
    
    // 已参加作业的学生 ID 集合
    const attemptedUserIds = new Set(filteredAttempts.map(a => a.User.id));
    // 未完成作业的学生（参加了但没有完成所有题目）
    const incompleteStudents = filteredAttempts.filter(a => {
      const totalQuestions = quiz.Question.length;
      const answeredQuestions = a.QuestionAttempt.length;
      return answeredQuestions < totalQuestions;
    }).map(a => ({ name: a.User.name, score: a.score, answered: a.QuestionAttempt.length, total: quiz.Question.length }));
    
    // 未参加作业的学生
    const notAttemptedStudents = allStudentsInClass
      .filter(s => !attemptedUserIds.has(s.id))
      .map(s => ({ name: s.name, userId: s.id }));
    
    const totalStudents = filteredAttempts.length;
    const classAvgScore = totalStudents > 0
      ? Math.round(filteredAttempts.reduce((s, a) => s + a.score, 0) / totalStudents)
      : 0;

    // 各题正确率
    const questionStats = quiz.Question.map((q) => {
      const answered = filteredAttempts.flatMap((a) => a.QuestionAttempt.filter((ans) => ans.questionId === q.id));
      const correct = answered.filter((a) => a.isCorrect).length;
      return {
        questionId: q.id,
        content: q.content.substring(0, 20),
        type: q.type,
        difficulty: q.difficulty,
        correctRate: totalStudents > 0 ? Math.round((correct / totalStudents) * 100) : 0,
      };
    });

    // 薄弱题目（正确率 < 60%）
    const weakQuestions = questionStats
      .filter((qs) => qs.correctRate < 60)
      .map((qs) => `[${qs.difficulty}] ${qs.content}...（正确率${qs.correctRate}%）`)
      .join("\n");

    // 低分学生（< 60分）
    const lowScoreStudents = filteredAttempts
      .filter((a) => a.score < 60)
      .map((a) => `${a.User.name}（${a.score}分）`)
      .join("\n");

    // ========== 新增丰富数据 ==========

    // 学生分数列表（排序）
    const studentScores = filteredAttempts
      .map((a) => ({ name: a.User.name, score: a.score, userId: a.User.id }))
      .sort((a, b) => b.score - a.score);

    // 分数段分布
    const scoreBuckets = [
      { label: "90-100", min: 90, max: 100, count: 0 },
      { label: "70-89", min: 70, max: 89, count: 0 },
      { label: "60-69", min: 60, max: 69, count: 0 },
      { label: "40-59", min: 40, max: 59, count: 0 },
      { label: "<40", min: 0, max: 39, count: 0 },
    ];
    for (const a of filteredAttempts) {
      const bucket = scoreBuckets.find((b) => a.score >= b.min && a.score <= b.max);
      if (bucket) bucket.count++;
    }

    // 难度维度统计（雷达图数据）
    const difficultyMap: Record<string, { total: number; correct: number }> = {
      BASIC: { total: 0, correct: 0 },
      INTERMEDIATE: { total: 0, correct: 0 },
      ADVANCED: { total: 0, correct: 0 },
    };
    for (const q of quiz.Question) {
      const key = q.difficulty as keyof typeof difficultyMap;
      if (difficultyMap[key] !== undefined) {
        difficultyMap[key].total++;
        const correct = filteredAttempts.flatMap((a) => a.QuestionAttempt.filter((ans) => ans.questionId === q.id && ans.isCorrect)).length;
        difficultyMap[key].correct += correct;
      }
    }
    const difficultyStats = Object.entries(difficultyMap)
      .filter(([, v]) => v.total > 0)
      .map(([name, v]) => ({
        name: name === "BASIC" ? "基础" : name === "INTERMEDIATE" ? "提升" : "拓展",
        nameEn: name,
        correctRate: v.total > 0 ? Math.round((v.correct / (v.total * totalStudents)) * 100) : 0,
        total: v.total,
      }));

    // 每位学生在每题的表现
    const studentQuestionMatrix = filteredAttempts.map((a) => ({
      userId: a.User.id,
      name: a.User.name,
      score: a.score,
      answers: quiz.Question.map((q) => {
        const ans = a.QuestionAttempt.find((an) => an.questionId === q.id);
        return { questionId: q.id, isCorrect: ans?.isCorrect ?? false, selectedAnswer: ans?.selectedAnswer ?? "", questionType: q.type };
      }),
    }));
    
    // 添加未参加作业的学生（放在最后，不参与排序）
    const notAttemptedMatrix = notAttemptedStudents.map((s) => ({
      userId: s.userId,
      name: s.name,
      score: null, // 无分数
      notAttempted: true, // 标记未参加
      answers: quiz.Question.map((q) => ({
        questionId: q.id,
        isCorrect: false,
        selectedAnswer: "",
        questionType: q.type,
        notAttempted: true,
      })),
    }));

    const topStudents = studentScores.slice(0, 3);
    const lowScoreStudentsList = studentScores.filter((s) => s.score < 60);

    const sortedScores = studentScores.map((s) => s.score).sort((a, b) => a - b);
    const median = sortedScores.length > 0 ? sortedScores[Math.floor(sortedScores.length / 2)] : 0;
    const maxScore = sortedScores[sortedScores.length - 1] || 0;
    const minScore = sortedScores[0] || 0;
    const passRate = totalStudents > 0 ? Math.round(((totalStudents - lowScoreStudentsList.length) / totalStudents) * 100) : 0;

    // ========== 丰富统计指标 ==========

    // 标准差（衡量班级分数离散程度）
    const mean = classAvgScore;
    const variance = totalStudents > 0
      ? filteredAttempts.reduce((sum, a) => sum + Math.pow(a.score - mean, 2), 0) / totalStudents
      : 0;
    const stdDev = Math.round(Math.sqrt(variance) * 10) / 10;

    // 每题高频错选项统计
    const questionWrongOptions = quiz.Question.map((q) => {
      const optionCounts: Record<string, number> = {};
      for (const a of filteredAttempts) {
        const ans = a.QuestionAttempt.find((an) => an.questionId === q.id);
        if (ans && !ans.isCorrect && ans.selectedAnswer) {
          optionCounts[ans.selectedAnswer] = (optionCounts[ans.selectedAnswer] || 0) + 1;
        }
      }
      // 取最多人错的那个选项
      const sortedOptions = Object.entries(optionCounts).sort(([, a], [, b]) => b - a);
      return {
        questionId: q.id,
        content: q.content.substring(0, 15),
        topWrongOption: sortedOptions[0]?.[0] || null,
        topWrongCount: sortedOptions[0]?.[1] || 0,
      };
    });

    // 题目区分度（该题得分与总分相关系数，衡量题目区分高低分学生的能力）
    const questionDiscrimination = quiz.Question.map((q) => {
      const questionScores = filteredAttempts.map((a) => {
        const ans = a.QuestionAttempt.find((an) => an.questionId === q.id);
        if (!ans) return 0;
        const maxScore = q.score || 100 / quiz.Question.length;
        return ans.score !== undefined ? (ans.score / maxScore) * 100 : (ans.isCorrect ? 100 : 0);
      });
      const totalScores = filteredAttempts.map((a) => a.score);
      const n = questionScores.length;
      if (n === 0) return { questionId: q.id, discrimination: 0 };
      const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
      const meanQ = sum(questionScores) / n;
      const meanT = sum(totalScores) / n;
      const cov = questionScores.reduce((s, qScore, i) => s + (qScore - meanQ) * (totalScores[i] - meanT), 0) / n;
      const stdQ = Math.sqrt(questionScores.reduce((s, v) => s + Math.pow(v - meanQ, 2), 0) / n);
      const stdT = Math.sqrt(totalScores.reduce((s, v) => s + Math.pow(v - meanT, 2), 0) / n);
      const discrimination = stdQ > 0 && stdT > 0 ? Math.round((cov / (stdQ * stdT)) * 100) / 100 : 0;
      return { questionId: q.id, content: q.content.substring(0, 15), discrimination };
    });

    // 班级整体认知负荷指数（加权：题目难度 × 该题得分率，越高说明班级应对难题能力越强）
    const cognitiveLoadIndex = difficultyStats.length > 0 && totalStudents > 0
      ? Math.round(difficultyStats.reduce((s, d) => s + (d.nameEn === "ADVANCED" ? 3 : d.nameEn === "INTERMEDIATE" ? 2 : 1) * d.correctRate, 0) / difficultyStats.reduce((s, d) => s + (d.nameEn === "ADVANCED" ? 3 : d.nameEn === "INTERMEDIATE" ? 2 : 1), 0))
      : 0;

    // 班级整体知识点覆盖（难度维度得分率趋势）
    const difficultyTrend = difficultyStats;

    // ========== 原有数据 ==========

    // 查询该作业的 AI 分析报告（type: "quiz_class", scopeId = quizId）
    // 注意：使用 filterClassId（前端传递的班级 ID），如果没有则使用第一个班级
    const reportClassId = filterClassId || classIds[0] || "";
    console.log("[GET /api/quiz-activities/[id]/report] quizId:", id, "filterClassId:", filterClassId, "reportClassId:", reportClassId, "classIds:", classIds);
    
    // 获取所有版本
    const allQuizInsights = reportClassId
      ? await prisma.aIInsight.findMany({
          where: { type: "quiz_class", scopeId: id, classId: reportClassId },
          orderBy: { version: "desc" },
        })
      : [];
    console.log("[GET /api/quiz-activities/[id]/report] All AIInsight versions:", allQuizInsights.length);
    
    const quizInsight = allQuizInsights[0] || null;
    console.log("[GET /api/quiz-activities/[id]/report] AIInsight found:", !!quizInsight, "content length:", quizInsight?.content?.length);
    if (quizInsight) {
      console.log("[GET /api/quiz-activities/[id]/report] Content preview:", quizInsight.content?.substring(0, 100));
    } else {
      // 调试：查询所有匹配的报告（不限 classId）
      const allReports = await prisma.aIInsight.findMany({
        where: { type: "quiz_class", scopeId: id },
      });
      console.log("[GET /api/quiz-activities/[id]/report] All reports for this quiz:", allReports.map(r => ({ classId: r.classId, version: r.version, contentLength: r.content?.length })));
    }

    return NextResponse.json({
      classIds,
      quizId: id,
      quizTitle: quiz.title,
      totalStudents,
      classAvgScore,
      questionStats,
      weakQuestions,
      lowScoreStudents,
      studentScores,
      scoreBuckets,
      difficultyStats,
      studentQuestionMatrix: [...studentQuestionMatrix, ...notAttemptedMatrix], // 未参加学生放最后
      notAttemptedStudents, // 未参加作业的学生名单
      incompleteStudents, // 未完成作业的学生名单（参加了但题目没做完）
      topStudents,
      lowScoreStudentsList,
      stats: { maxScore, minScore, median, passRate, stdDev },
      cognitiveLoadIndex,
      questionWrongOptions,
      questionDiscrimination,
      difficultyTrend,
      // AI 报告版本管理
      aiContent: quizInsight?.content || null,
      aiContentVersion: quizInsight?.version || null,
      aiReportVersions: allQuizInsights.map(i => ({ 
        id: i.id, 
        content: i.content, 
        version: i.version, 
        createdAt: i.createdAt.toISOString() 
      })), // 所有版本列表
    });
  } catch (error) {
    console.error("获取作业报告失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}
