import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 获取教师的课堂列表
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const rawTasks = await prisma.learningTask.findMany({
      where: { teacherId: String(payload.userId) },
      include: {
        classInsightTemplate: { select: { id: true, name: true, type: true } },
        studentInsightTemplate: { select: { id: true, name: true, type: true } },
        subProjects: {
          include: {
            classInsightTemplate: { select: { id: true, name: true, type: true } },
            studentInsightTemplate: { select: { id: true, name: true, type: true } },
            PresetConversation: { select: { id: true, title: true, description: true, systemPrompt: true, analysisPrompt: true, classAnalysisPrompt: true, sortOrder: true, enabled: true, studentInsightTemplateId: true, classInsightTemplateId: true }, orderBy: [{ sortOrder: "asc" }] },
            QuizActivity: { select: { id: true, title: true, description: true, status: true, sortOrder: true, Question: { orderBy: { order: "asc" } } }, orderBy: [{ status: "desc" }, { sortOrder: "asc" }] },
            ExplorationActivity: { select: { id: true, title: true, description: true, sortOrder: true, enabled: true }, orderBy: [{ sortOrder: "asc" }] },
          },
          orderBy: { sortOrder: "asc" },
        },
        assignments: { include: { class: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    // 映射字段名以匹配前端期望
    function mapSubProject(sp: Record<string, unknown>) {
      const { PresetConversation, QuizActivity, ExplorationActivity, ...rest } = sp;
      return {
        ...rest,
        presetConversations: PresetConversation,
        quizActivities: QuizActivity?.map((qa: Record<string, unknown>) => {
          const { Question, ...qaRest } = qa;
          return { ...qaRest, questions: Question };
        }),
        explorations: ExplorationActivity,
      };
    }
    const tasks = rawTasks.map(({ subProjects, assignments: asgns, ...t }) => ({
      ...t,
      assignments: asgns,
      subProjects: subProjects.map(mapSubProject),
    }));

    return NextResponse.json(tasks);
  } catch (error) {
    console.error("Get tasks error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// POST: 创建课堂
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await req.json();
    const { title, description, grade, subject, objectives, requirements, knowledgeBase, analysisPrompt, knowledgeBaseIds, subProjects, classIds, studentInsightTemplateId, classInsightTemplateId, classAnalysisPrompt } = body;

    if (!title) {
      return NextResponse.json({ error: "请填写课堂标题" }, { status: 400 });
    }

    // 确保至少有一个默认学习活动（作为容器）
    let safeSubProjects = subProjects || [];
    if (!Array.isArray(safeSubProjects) || safeSubProjects.length === 0) {
      safeSubProjects = [{ title: "默认活动", description: "", objectives: "", requirements: "", knowledgeBase: "", analysisPrompt: "", presetConversations: [] }];
    }

    // 过滤掉学习活动和对话活动中的 id 字段（创建时不需要）
    const cleanSubProjects = safeSubProjects.map((sp: Record<string, unknown>) => {
      const cleaned = { ...sp };
      delete cleaned.id;
      // 清理对话活动
      cleaned.presetConversations = (cleaned.presetConversations as Record<string, unknown>[])?.map((pc) => {
        const cleanedPc = { ...pc };
        delete cleanedPc.id;
        return cleanedPc;
      }) || [];
      // 清理课堂作业
      if (cleaned.quizActivities && Array.isArray(cleaned.quizActivities)) {
        (cleaned.quizActivities as Record<string, unknown>[]).forEach((qa) => {
          delete qa.id;
          if (qa.questions && Array.isArray(qa.questions)) {
            (qa.questions as Record<string, unknown>[]).forEach((q) => delete q.id);
          }
        });
      }
      return cleaned;
    });

    // 创建课堂 + 学习活动 + 对话活动 + 课堂作业 + 分配班级
    const task = await prisma.learningTask.create({
      data: {
        title,
        description,
        grade,
        subject,
        objectives,
        requirements,
        knowledgeBase,
        analysisPrompt,
        classAnalysisPrompt: classAnalysisPrompt || null,
        knowledgeBaseIds: knowledgeBaseIds || null,
        teacherId: String(payload.userId),
        updatedAt: new Date(),
        subProjects: {
          create: cleanSubProjects.map((sp: Record<string, unknown>, spIndex: number) => {
            const spData: Record<string, unknown> = {
              title: (sp.title as string) || "默认活动",
              description: (sp.description as string) || "",
              objectives: (sp.objectives as string) || "",
              requirements: (sp.requirements as string) || "",
              knowledgeBase: (sp.knowledgeBase as string) || "",
              analysisPrompt: (sp.analysisPrompt as string) || "",
              sortOrder: spIndex,
            };
            if (sp.studentInsightTemplateId) spData.studentInsightTemplateId = sp.studentInsightTemplateId;
            if (sp.classInsightTemplateId) spData.classInsightTemplateId = sp.classInsightTemplateId;
            spData.PresetConversation = {
              create: ((sp.presetConversations || []) as Record<string, unknown>[]).map((pc: Record<string, unknown>, pcIndex: number) => {
                const pcData: Record<string, unknown> = {
                  title: (pc.title as string) || "",
                  description: (pc.description as string) || undefined,
                  systemPrompt: (pc.systemPrompt as string) || undefined,
                  analysisPrompt: (pc.analysisPrompt as string) || undefined,
                  classAnalysisPrompt: (pc.classAnalysisPrompt as string) || undefined,
                  sortOrder: pcIndex,
                };
                if (pc.studentInsightTemplateId) pcData.studentInsightTemplateId = pc.studentInsightTemplateId;
                if (pc.classInsightTemplateId) pcData.classInsightTemplateId = pc.classInsightTemplateId;
                return pcData;
              }),
            };
            spData.QuizActivity = {
              create: ((sp.quizActivities || []) as Record<string, unknown>[]).map((qa: Record<string, unknown>, qaIndex: number) => ({
                title: (qa.title as string) || "",
                description: (qa.description as string) || undefined,
                quizDesignTemplateId: (qa.quizDesignTemplateId as string) || undefined,
                status: (qa.status as string) || "INACTIVE",
                sortOrder: qaIndex,
                Question: {
                  create: ((qa.questions as Record<string, unknown>[]) || []).map((q: Record<string, unknown>, qIdx: number) => ({
                    type: (q.type as string) || "SINGLE_CHOICE",
                    content: (q.content as string) || "",
                    options: typeof q.options === "string" ? q.options : JSON.stringify(q.options || {}),
                    answer: (q.answer as string) || "",
                    difficulty: (q.difficulty as string) || "BASIC",
                    explanation: (q.explanation as string) || undefined,
                    order: qIdx,
                  })),
                },
              })),
            };
            return spData;
          }),
        },
        assignments: {
          create: (classIds || []).map((classId: string) => ({ classId })),
        },
      },
      include: {
        studentInsightTemplate: { select: { id: true, name: true, type: true } },
        classInsightTemplate: { select: { id: true, name: true, type: true } },
        subProjects: {
          include: {
            studentInsightTemplate: { select: { id: true, name: true, type: true } },
            classInsightTemplate: { select: { id: true, name: true, type: true } },
            PresetConversation: { select: { id: true, title: true, description: true, systemPrompt: true, analysisPrompt: true, classAnalysisPrompt: true, sortOrder: true, enabled: true, studentInsightTemplateId: true, classInsightTemplateId: true }, orderBy: [{ sortOrder: "asc" }] },
            QuizActivity: { select: { id: true, title: true, description: true, status: true, sortOrder: true, Question: { orderBy: { order: "asc" } } }, orderBy: [{ status: "desc" }, { sortOrder: "asc" }] },
            ExplorationActivity: { select: { id: true, title: true, description: true, sortOrder: true, enabled: true }, orderBy: [{ sortOrder: "asc" }] },
          },
        },
        assignments: true,
      },
    });

    return NextResponse.json(task);
  } catch (error) {
    console.error("Create task error:", error);
    const message = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: "服务器错误", detail: message }, { status: 500 });
  }
}
