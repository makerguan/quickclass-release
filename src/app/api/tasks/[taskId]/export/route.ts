import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { upgradeAiCompanionIfNeeded } from "@/lib/prompts/ai-companion";

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

    // 获取教师姓名
    const teacher = await prisma.user.findUnique({
      where: { id: task.teacherId },
      select: { name: true },
    });
    const teacherName = teacher?.name || "未知";

    // 读取被引用的知识库内容（随课堂导出，导入时建库+引用）
    let referencedKnowledgeBases: { name: string; content: string }[] = [];
    if (task.knowledgeBaseIds) {
      try {
        const kbIds: string[] = JSON.parse(task.knowledgeBaseIds);
        if (Array.isArray(kbIds) && kbIds.length > 0) {
          const kbs = await prisma.knowledgeBase.findMany({
            where: { id: { in: kbIds }, teacherId: task.teacherId },
            select: { name: true, content: true },
          });
          referencedKnowledgeBases = kbs.map((kb) => ({
            name: kb.name,
            content: kb.content || "",
          }));
        }
      } catch {
        referencedKnowledgeBases = [];
      }
    }

    // 取第一个学习活动（课堂只有一个）
    const sp = task.subProjects[0];
    // 保留中文，仅将文件名非法字符（\ / : * ? " < > | 及换行/制表/控制字符）替换为下划线
    const safeTitle = task.title
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/[，。、？！：；""''【】（）]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 30);
    const filename = `${safeTitle}_${new Date().toISOString().split("T")[0]}.json`;

    const exportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      _filename: filename,
      referencedKnowledgeBases,
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
        // 四类活动内容，直接挂在课堂下（不嵌套学习活动）
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
            score: q.score,
            difficulty: q.difficulty,
            explanation: q.explanation || "",
            order: q.order,
          })),
        })),
        explorations: (sp?.ExplorationActivity || []).map((e) => ({
          title: e.title,
          description: e.description || "",
          htmlContent: (() => {
            if (!e.enableAiCompanion) return e.htmlContent || "";
            return upgradeAiCompanionIfNeeded(e.htmlContent, { explorationId: e.id }).html;
          })(),
          designPrompt: e.designPrompt || "",
          analysisPrompt: e.analysisPrompt || "",
          enableSubmission: e.enableSubmission ?? false,
          enableAiCompanion: e.enableAiCompanion ?? false,
          aiCompanionPrompt: e.aiCompanionPrompt || "",
        })),
        projectSubmissions: (sp?.ProjectSubmission || []).map((ps) => ({
          title: ps.title,
          description: ps.description || "",
          category: ps.category || "general",
          visibleToClass: ps.visibleToClass ?? false,
          allowLike: ps.allowLike ?? false,
          fileSizeLimit: ps.fileSizeLimit ?? 10,
        })),
      },
    };

    return NextResponse.json(exportData);
  } catch (error) {
    console.error("Export task error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: "服务器错误", detail: message }, { status: 500 });
  }
}