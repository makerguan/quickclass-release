import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 导出课堂完整结构（不含教师/学生/班级数据）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { taskId } = await params;

    const task = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: {
        subProjects: {
          orderBy: { sortOrder: "asc" },
          include: {
            PresetConversation: {
              orderBy: { sortOrder: "asc" },
            },
            QuizActivity: {
              include: {
                Question: { orderBy: { order: "asc" } },
              },
              orderBy: { sortOrder: "asc" },
            },
            ExplorationActivity: {
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    if (!task) return NextResponse.json({ error: "课堂不存在" }, { status: 404 });
    if (task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 获取教师姓名
    const teacher = await prisma.user.findUnique({
      where: { id: task.teacherId },
      select: { name: true },
    });
    const teacherName = teacher?.name || "未知";

    // 构建导出数据（与课堂生成提示词模板结构一致）
    const exportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      _filename: [
        teacherName,
        task.grade || "未知年级",
        task.subject || "未知学科",
        task.title,
        new Date().toISOString().split("T")[0],
      ].join("_").replace(/[\/\\?%*:|"<>]/g, "") + ".json",
      task: {
        title: `${task.title}_来源于_${teacherName}`,
        description: task.description || "",
        grade: task.grade || "",
        subject: task.subject || "",
        objectives: task.objectives,
        requirements: task.requirements,
        knowledgeBase: task.knowledgeBase || "",
        analysisPrompt: task.analysisPrompt || "",
        classAnalysisPrompt: task.classAnalysisPrompt || "",
        subProjects: task.subProjects.map((sp) => ({
          title: sp.title,
          presetConversations: sp.PresetConversation.map((pc) => ({
            title: pc.title,
            description: pc.description || "",
            systemPrompt: pc.systemPrompt || "",
            analysisPrompt: pc.analysisPrompt || "",
            classAnalysisPrompt: pc.classAnalysisPrompt || "",
          })),
          quizActivities: sp.QuizActivity.map((qa) => ({
            title: qa.title,
            description: qa.description || "",
            analysisPrompt: qa.analysisPrompt || "",
            questions: qa.Question.map((q) => ({
              type: q.type,
              content: q.content,
              options: q.options || "",
              answer: q.answer,
              score: q.score,
              difficulty: q.difficulty,
              explanation: q.explanation || "",
              order: q.order,
            })),
          })),
          explorations: sp.ExplorationActivity.map((e) => ({
            title: e.title,
            description: e.description || "",
            htmlContent: e.htmlContent || "",
            designPrompt: e.designPrompt || "",
            analysisPrompt: e.analysisPrompt || "",
          })),
        })),
      },
    };

    // 生成文件名
    const safeTitle = task.title.replace(/[^\x00-\x7F]/g, "_").replace(/[，。、？！：；""''【】（）\s]/g, "_").substring(0, 20);
    const filename = `${safeTitle}_${new Date().toISOString().split("T")[0]}.json`;

    // 直接返回导出数据（前端负责下载）
    return NextResponse.json(exportData);
  } catch (error) {
    console.error("Export task error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: "服务器错误", detail: message }, { status: 500 });
  }
}