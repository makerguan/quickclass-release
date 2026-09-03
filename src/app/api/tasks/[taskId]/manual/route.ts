import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { generateManualDocx } from "@/lib/manual/manual-generator";
import type { ManualTaskInput } from "@/lib/manual/manual-generator";

// GET: 生成并下载该课堂的教学手册 Word 文档
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
            ProjectSubmission: {
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

    // 教师姓名与单位（封面信息）
    const teacher = await prisma.user.findUnique({
      where: { id: task.teacherId },
      select: { name: true, school: true },
    });
    const teacherName = teacher?.name || "";
    const school = teacher?.school || "";

    // 取第一个学习活动（课堂只有一个）
    const sp = task.subProjects[0];

    const manualInput: ManualTaskInput = {
      title: task.title,
      description: task.description || "",
      grade: task.grade || "",
      subject: task.subject || "",
      teacher: teacherName,
      school,
      presetConversations: (sp?.PresetConversation || []).map((pc) => ({
        title: pc.title,
        description: pc.description || "",
        systemPrompt: pc.systemPrompt || "",
        analysisPrompt: pc.analysisPrompt || "",
        classAnalysisPrompt: pc.classAnalysisPrompt || "",
      })),
      quizActivities: (sp?.QuizActivity || []).map((qa) => ({
        title: qa.title,
        description: qa.description || "",
        analysisPrompt: qa.analysisPrompt || "",
        questions: qa.Question.map((q) => ({
          type: q.type,
          content: q.content,
          options: q.options || "",
          answer: q.answer,
          difficulty: q.difficulty,
          explanation: q.explanation || "",
          order: q.order,
        })),
      })),
      explorations: (sp?.ExplorationActivity || []).map((e) => ({
        title: e.title,
        description: e.description || "",
        htmlContent: e.htmlContent || "",
        enableSubmission: e.enableSubmission ?? false,
        enableAiCompanion: e.enableAiCompanion ?? false,
        aiCompanionPrompt: e.aiCompanionPrompt || "",
      })),
      projectSubmissions: (sp?.ProjectSubmission || []).map((ps) => ({
        title: ps.title,
        description: ps.description || "",
        category: ps.category || "TEXT",
        visibleToClass: ps.visibleToClass ?? false,
        allowLike: ps.allowLike ?? false,
        fileSizeLimit: ps.fileSizeLimit ?? 10,
      })),
    };

    const buffer = await generateManualDocx(manualInput);

    // 文件名：{课堂名}_教学手册.docx（清理非法字符）
    const safeTitle = task.title
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/[，。、？！：；""''【】（）]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 30);
    const filename = `${safeTitle}_教学手册.docx`;

    return new NextResponse(buffer as any, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          filename
        )}`,
      },
    });
  } catch (error) {
    console.error("Generate manual error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: "服务器错误", detail: message }, { status: 500 });
  }
}
