import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { buildStudentGuideDocx } from "@/lib/manual/student-guide-generator";
import type { ManualTaskInput } from "@/lib/manual/manual-generator";

// GET: 生成并下载该课堂的学生学习手册（学案）Word 文档
// 活动只取学生端可见的已启用部分，口径与 /api/student/tasks 一致
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
              where: { enabled: true },
              orderBy: { sortOrder: "asc" },
            },
            QuizActivity: {
              where: { status: "ACTIVE" },
              include: {
                Question: { orderBy: { order: "asc" } },
              },
              orderBy: { sortOrder: "asc" },
            },
            ExplorationActivity: {
              where: { enabled: true },
              orderBy: { sortOrder: "asc" },
            },
            ProjectSubmission: {
              where: { enabled: true },
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

    // 取第一个学习活动（课堂只有一个）
    const sp = task.subProjects[0];

    // 关联的知识库：knowledgeBaseIds 为 JSON 数组字符串，按 teacherId 过滤防越权
    const knowledgeBases: { name: string; content: string }[] = [];
    const seenKb = new Set<string>();
    const pushKb = (name: string, content: string) => {
      const c = (content || "").trim();
      if (!c) return;
      const key = c.slice(0, 60);
      if (seenKb.has(key)) return;
      seenKb.add(key);
      knowledgeBases.push({ name: name.trim() || "知识补充", content: c });
    };
    if (task.knowledgeBaseIds) {
      try {
        const kbIds = JSON.parse(task.knowledgeBaseIds);
        if (Array.isArray(kbIds) && kbIds.length > 0) {
          const kbs = await prisma.knowledgeBase.findMany({
            where: { id: { in: kbIds }, teacherId: task.teacherId },
            select: { name: true, content: true },
          });
          for (const kb of kbs) pushKb(kb.name, kb.content || "");
        }
      } catch {
        // JSON 解析失败则忽略，仅用旧版文本兜底
      }
    }
    // 旧版自由文本知识库（历史数据）兜底
    if (task.knowledgeBase) pushKb("课堂知识补充", task.knowledgeBase);

    const guideInput: ManualTaskInput = {
      title: task.title,
      description: task.description || "",
      grade: task.grade || "",
      subject: task.subject || "",
      knowledgeBases,
      presetConversations: (sp?.PresetConversation || []).map((pc) => ({
        title: pc.title,
        description: pc.description || "",
        systemPrompt: pc.systemPrompt || "",
      })),
      quizActivities: (sp?.QuizActivity || []).map((qa) => ({
        title: qa.title,
        description: qa.description || "",
        questions: qa.Question.map((q) => ({
          type: q.type,
          content: q.content,
          options: q.options || "",
          difficulty: q.difficulty,
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

    const buffer = await buildStudentGuideDocx(guideInput);

    // 文件名：{课堂名}_学习手册.docx（清理非法字符与常见标点）
    const safeTitle = task.title
      .replace(
        /[\\/:*?"<>|\r\n\t\s·•,，。、？！：；…—–""''‘’《》〈〉【】（）()\[\]]+/g,
        "_"
      )
      .replace(/^_+|_+$/g, "")
      .substring(0, 30);
    const filename = `${safeTitle}_学习手册.docx`;

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
    console.error("Generate study guide error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: "服务器错误", detail: message }, { status: 500 });
  }
}
