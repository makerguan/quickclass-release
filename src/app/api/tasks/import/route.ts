import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// POST: 导入课堂结构
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 兼容：旧版导出文件可能以 // 注释开头（支持 \n 和 \r\n）
    let rawText = await req.text();
    rawText = rawText.replace(/^\/\/[^\n]*\r?\n/, "");
    const body = JSON.parse(rawText);

    // 解析导入数据
    const { task, referencedTemplates, referencedKnowledgeBases } = body;

    if (!task || !task.title) {
      return NextResponse.json({ error: "无效的导入数据" }, { status: 400 });
    }

    // 获取导入者姓名（用于知识库命名）
    const importer = await prisma.user.findUnique({
      where: { id: String(payload.userId) },
      select: { name: true },
    });
    const importerName = importer?.name || "老师";

    // 四类内容从 task 直接取（兼容新旧两种格式）
    const presetConversations = (task.presetConversations as Record<string, unknown>[]) ||
      (task.subProjects?.[0] as any)?.presetConversations || [];
    const quizActivities = (task.quizActivities as Record<string, unknown>[]) ||
      (task.subProjects?.[0] as any)?.quizActivities || [];
    const explorations = (task.explorations as Record<string, unknown>[]) ||
      (task.subProjects?.[0] as any)?.explorations || [];
    const projectSubmissions = (task.projectSubmissions as Record<string, unknown>[]) ||
      (task.subProjects?.[0] as any)?.projectSubmissions || [];

    // 构建单个默认学习活动容器，承载四类内容
    const subProjectData: Record<string, unknown> = {
      title: "默认活动",
      objectives: "",
      requirements: "",
      sortOrder: 0,
    };
    subProjectData.PresetConversation = {
      create: presetConversations.map((pc: Record<string, unknown>, pcIndex: number) => ({
        title: (pc.title as string) || "",
        description: (pc.description as string) || undefined,
        systemPrompt: (pc.systemPrompt as string) || undefined,
        analysisPrompt: (pc.analysisPrompt as string) || undefined,
        classAnalysisPrompt: (pc.classAnalysisPrompt as string) || undefined,
        sortOrder: pcIndex,
      })),
    };
    subProjectData.QuizActivity = {
      create: quizActivities.map((qa: Record<string, unknown>, qaIndex: number) => ({
        title: (qa.title as string) || "作业",
        description: (qa.description as string) || undefined,
        status: "INACTIVE",
        sortOrder: qaIndex,
        analysisPrompt: (qa.analysisPrompt as string) || undefined,
        updatedAt: new Date(),
        Question: {
          create: ((qa.questions as Record<string, unknown>[]) || []).map((q: Record<string, unknown>, qIndex: number) => ({
            type: (q.type as string) || "SINGLE_CHOICE",
            content: (q.content as string) || "",
            options: (q.options as string) || undefined,
            answer: (q.answer as string) || "",
            score: (q.score as number) || 0,
            difficulty: (q.difficulty as string) || "BASIC",
            explanation: (q.explanation as string) || undefined,
            order: qIndex,
          })),
        },
        })),
      };
    subProjectData.ExplorationActivity = {
      create: explorations.map((e: Record<string, unknown>, eIndex: number) => ({
        title: (e.title as string) || "探究活动",
        description: (e.description as string) || "",
        htmlContent: (e.htmlContent as string) || "",
        designPrompt: (e.designPrompt as string) || undefined,
        analysisPrompt: (e.analysisPrompt as string) || undefined,
        enableSubmission: (e.enableSubmission as boolean) ?? false,
        enableAiCompanion: (e.enableAiCompanion as boolean) ?? false,
        aiCompanionPrompt: (e.aiCompanionPrompt as string) || undefined,
        sortOrder: eIndex,
        enabled: true,
      })),
    };
    subProjectData.ProjectSubmission = {
      create: projectSubmissions.map((ps: Record<string, unknown>, psIndex: number) => ({
        title: (ps.title as string) || "项目提交",
        description: (ps.description as string) || "",
        category: (ps.category as string) || "general",
        visibleToClass: (ps.visibleToClass as boolean) ?? false,
        allowLike: (ps.allowLike as boolean) ?? false,
        fileSizeLimit: (ps.fileSizeLimit as number) ?? 10,
        sortOrder: psIndex,
      })),
    };

    // 处理引用知识库：在导入者账号下建库或复用，得到 id 数组
    const exportDate = (body.exportedAt || new Date().toISOString()).slice(0, 10);
    const kbIds: string[] = [];
    for (const refKb of (referencedKnowledgeBases || []) as { name?: string; content?: string }[]) {
      if (!refKb?.name || !refKb?.content) continue;
      const targetName = `${importerName}_${task.title}_${refKb.name}_${exportDate}`;
      // 双检：name 与 content 都一致才复用，否则强制新建
      const existing = await prisma.knowledgeBase.findFirst({
        where: { teacherId: String(payload.userId), name: targetName, content: refKb.content },
      });
      if (existing) {
        kbIds.push(existing.id);
      } else {
        const created = await prisma.knowledgeBase.create({
          data: {
            name: targetName,
            content: refKb.content,
            teacherId: String(payload.userId),
            status: "VECTORIZED",
            enabled: true,
            updatedAt: new Date(),
          },
        });
        kbIds.push(created.id);
      }
    }

    // 创建课堂（只有一个默认学习活动容器），包事务确保建库与建课堂原子性
    const newTask = await prisma.$transaction(async (tx) => {
      return tx.learningTask.create({
        data: {
          title: task.title,
          description: task.description || null,
          grade: task.grade || null,
          subject: task.subject || null,
          objectives: task.objectives || "",
          requirements: task.requirements || "",
          knowledgeBase: task.knowledgeBase || null,
          analysisPrompt: task.analysisPrompt || null,
          classAnalysisPrompt: task.classAnalysisPrompt || null,
          teacherId: String(payload.userId),
          status: "DISABLED",
          knowledgeBaseIds: kbIds.length > 0 ? JSON.stringify(kbIds) : null,
          updatedAt: new Date(),
          subProjects: {
            create: [subProjectData],
          },
        },
        include: {
          subProjects: {
            include: {
              PresetConversation: { select: { id: true, title: true, description: true, systemPrompt: true, analysisPrompt: true, classAnalysisPrompt: true, sortOrder: true } },
              QuizActivity: { select: { id: true, title: true, description: true, status: true, sortOrder: true, Question: { orderBy: { order: "asc" } } } },
              ExplorationActivity: { select: { id: true, title: true, description: true, htmlContent: true, designPrompt: true, analysisPrompt: true, enableSubmission: true, enableAiCompanion: true, aiCompanionPrompt: true, sortOrder: true, enabled: true } },
              ProjectSubmission: true,
            },
          },
          assignments: true,
        },
      });
    });

    // 映射字段名以匹配前端期望
    const mapSubProject = (sp: Record<string, unknown>) => {
      const { PresetConversation, QuizActivity, ExplorationActivity, ProjectSubmission, ...rest } = sp;
      return {
        ...rest,
        presetConversations: PresetConversation,
        quizActivities: (QuizActivity as Array<Record<string, unknown>>)?.map((qa) => {
          const { Question, ...qaRest } = qa;
          return { ...qaRest, questions: Question };
        }),
        explorations: ExplorationActivity,
        projectSubmissions: ProjectSubmission,
      };
    };
    const result = {
      ...newTask,
      subProjects: newTask.subProjects.map(mapSubProject),
    };

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Import task error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: "导入失败", detail: message }, { status: 500 });
  }
}