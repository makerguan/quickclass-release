import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// POST: 生成教学建议
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

    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      include: {
        SubProject: { include: { task: true } },
        ExplorationSubmission: {
          include: { ExplorationActionLog: true },
          orderBy: { submittedAt: "desc" },
          take: 20,
        },
      },
    });
    if (!exploration) return new Response("探究不存在", { status: 404 });
    if (exploration.SubProject.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    // 获取 AI 配置
    const config = await prisma.systemConfig.findFirst();
    if (!config?.aiApiKey) {
      return NextResponse.json({ advice: "未配置 AI 服务，无法生成建议。" });
    }

    // 获取模板内容（备用）
    let templateContent: string | null = null;
    const body = await req.json().catch(() => ({}));
    if (body.templateId) {
      const template = await prisma.analysisTemplate.findUnique({ where: { id: body.templateId } });
      if (template && template.teacherId === String(payload.userId)) {
        templateContent = template.content;
      }
    }

    // 最终使用的提示词：exploration.analysisPrompt 字段优先于模板内容，再Fallback到默认
    const effectivePrompt = exploration.analysisPrompt || templateContent || null;

    // 汇总提交数据
    const submissions = exploration.ExplorationSubmission;
    const submittedCount = submissions.length;
    const avgScore = submittedCount > 0
      ? Math.round(submissions.reduce((s, sub) => s + (sub.score || 0), 0) / submittedCount)
      : 0;
    const actionSummary = Object.entries(
      submissions.flatMap(s => s.ExplorationActionLog).reduce((acc, log) => {
        acc[log.type] = (acc[log.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([type, count]) => `${type}: ${count}次`).join("、");

    // 构建提示词：effectivePrompt 存在则作为自定义模板，否则使用默认提示词框架
    let prompt: string;
    if (effectivePrompt) {
      // 用 effectivePrompt 替换变量后直接作为用户提示词
      const vars: Record<string, string> = {
        "explorationTitle": exploration.title,
        "exploration.title": exploration.title,
        "explorationDescription": exploration.description || "无",
        "exploration.description": exploration.description || "无",
        "submittedCount": String(submittedCount),
        "avgScore": `${avgScore}/100`,
        "actionSummary": actionSummary || "无",
      };
      let filledPrompt = effectivePrompt;
      for (const [key, value] of Object.entries(vars)) {
        filledPrompt = filledPrompt.replace(new RegExp(`{${key}}`, "g"), value);
      }
      // 不存在变量占位符时，追加数据段
      if (!effectivePrompt.includes("{") && !effectivePrompt.includes("}")) {
        prompt = `${effectivePrompt}\n\n## 数据\n探究标题：${exploration.title}\n描述：${exploration.description || "无"}\n已提交人数：${submittedCount}\n平均得分：${avgScore}/100\n操作类型统计：${actionSummary || "无"}\n\n请生成教学改进建议。`;
      } else {
        prompt = filledPrompt;
      }
    } else {
      // 默认提示词框架
      prompt = `你是教师助手。根据以下探究活动的学生提交数据，生成教学改进建议。

探究标题：${exploration.title}
描述：${exploration.description || "无"}
已提交人数：${submittedCount}
平均得分：${avgScore}/100
操作类型统计：${actionSummary || "无"}

请生成 2-3 条简洁的教学改进建议，用中文回复。`;
    }

    const aiRes = await fetch(`${config.aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel || "qwen-plus",
        messages: [
          { role: "system", content: "你是一个中学教师教学助手，擅长根据学情数据给出教学建议。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!aiRes.ok) {
      return NextResponse.json({ advice: "AI 服务调用失败。" });
    }

    const aiData = await aiRes.json();
    const advice = aiData?.choices?.[0]?.message?.content || "生成失败";

    // 保存到数据库
    await prisma.explorationActivity.update({
      where: { id },
      data: { teachingAdvice: advice },
    });

    return NextResponse.json({ advice });
  } catch (error: any) {
    console.error("生成教学建议失败:", error);
    return new Response(error?.message || "生成失败", { status: 500 });
  }
}

// GET: 获取探究分析数据
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

    // 获取探究活动（包含学生提交记录）
    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      include: {
        SubProject: { include: { task: true } },
        ExplorationSubmission: {
          include: { ExplorationActionLog: true },
        },
      },
    });

    if (!exploration) return new Response("探究不存在", { status: 404 });

    // 验证教师权限
    if (exploration.SubProject.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    // 获取查询参数 classId
    const { searchParams } = new URL(req.url);
    const filterClassId = searchParams.get("classId");

    // 获取班级学生数
    const taskAssignments = await prisma.taskAssignment.findMany({
      where: { taskId: exploration.SubProject.taskId },
      select: { classId: true },
    });
    const allClassIds = taskAssignments.map(a => a.classId);
    // 如果指定了班级，过滤提交记录
    let filterStudentIds: string[] = [];
    if (filterClassId) {
      const students = await prisma.user.findMany({
        where: { classId: filterClassId, role: "STUDENT" },
        select: { id: true },
      });
      filterStudentIds = students.map(s => s.id);
    }
    const submissions = filterClassId ? exploration.ExplorationSubmission.filter(s => filterStudentIds.includes(s.studentId)) : exploration.ExplorationSubmission;
    const submittedCount = submissions.length;

    const classStudentsCount = filterClassId
      ? await prisma.user.count({ where: { classId: filterClassId, role: "STUDENT" } })
      : (allClassIds.length > 0
        ? await prisma.user.count({ where: { classId: { in: allClassIds }, role: "STUDENT" } })
        : submittedCount);

    // 分数统计
    let averageScore = 0;
    const scoreDistribution: Record<string, number> = {
      "0-59": 0, "60-79": 0, "80-89": 0, "90-100": 0,
    };
    if (submittedCount > 0) {
      const totalScore = submissions.reduce((sum, s) => sum + (s.score || 0), 0);
      averageScore = Math.round((totalScore / submittedCount) * 10) / 10;
      for (const s of submissions) {
        const score = s.score || 0;
        if (score < 60) scoreDistribution["0-59"]++;
        else if (score < 80) scoreDistribution["60-79"]++;
        else if (score < 90) scoreDistribution["80-89"]++;
        else scoreDistribution["90-100"]++;
      }
    }

    // 时间统计
    let avgTimeSpent = 0;
    if (submittedCount > 0) {
      const totalTime = submissions.reduce((sum, s) => {
        try {
          const answers = JSON.parse(s.answers || "{}");
          return sum + (answers.timeSpent || 0);
        } catch { return sum; }
      }, 0);
      avgTimeSpent = Math.round(totalTime / submittedCount);
    }

    // 互动次数统计
    let avgInteractions = 0;
    if (submittedCount > 0) {
      const totalInteractions = submissions.reduce((sum, s) => {
        try {
          const answers = JSON.parse(s.answers || "{}");
          return sum + (answers.interactions || 0);
        } catch { return sum; }
      }, 0);
      avgInteractions = Math.round(totalInteractions / submittedCount);
    }

    // 操作类型统计（从 actionLog 聚合）
    const actionTypeStats: Record<string, number> = {};
    for (const sub of submissions) {
      const logs = (sub as any).actionLogs || (sub as any).ExplorationActionLog || [];
      for (const log of logs) {
        actionTypeStats[log.type] = (actionTypeStats[log.type] || 0) + 1;
      }
    }

    // 各学生的操作记录（最近10条）
    // 获取学生姓名映射
    const studentIds = [...new Set(submissions.map(s => s.studentId))];
    const students = await prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true },
    });
    const studentNameMap = new Map(students.map(u => [u.id, u.name]));

    const studentRecords = submissions
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
      .slice(0, 20)
      .map((s) => {
        let answers: any = {};
        try { answers = JSON.parse(s.answers || "{}"); } catch {}
        return {
          studentId: s.studentId,
          studentName: studentNameMap.get(s.studentId) || s.studentId,
          score: s.score || 0,
          maxScore: s.totalScore || 100,
          timeSpent: answers.timeSpent || 0,
          interactions: answers.interactions || 0,
          completedSections: answers.completedSections || [],
          submittedAt: s.submittedAt,
          actionCount: s.ExplorationActionLog.length,
        };
      });

    return NextResponse.json({
      explorationId: id,
      explorationTitle: exploration.title,
      submittedCount,
      totalStudents: classStudentsCount || submittedCount,
      classIds: allClassIds,
      averageScore,
      scoreDistribution,
      avgTimeSpent,
      avgInteractions,
      actionTypeStats,
      studentRecords,
      teachingAdvice: exploration.teachingAdvice || null,
    });
  } catch (error: any) {
    console.error("获取探究分析失败:", error);
    return new Response(error?.message || "分析失败", { status: 500 });
  }
}
