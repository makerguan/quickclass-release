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

    const body = await req.json();

    // 解析导入数据
    const { task, referencedTemplates, referencedKnowledgeBases } = body;

    if (!task || !task.title) {
      return NextResponse.json({ error: "无效的导入数据" }, { status: 400 });
    }

    // 确保至少有一个默认学习活动作为容器
    let safeSubProjects = task.subProjects || [];
    if (!Array.isArray(safeSubProjects) || safeSubProjects.length === 0) {
      safeSubProjects = [{
        title: "默认活动",
        description: "",
        objectives: "",
        requirements: "",
        knowledgeBase: "",
        analysisPrompt: "",
        presetConversations: [],
        quizActivities: [],
        explorations: [],
      }];
    }

    // 构建 subProjects 创建数据
    const subProjectsData = safeSubProjects.map((sp: Record<string, unknown>, spIndex: number) => {
      const spData: Record<string, unknown> = {
        title: (sp.title as string) || "默认活动",
        objectives: (sp.objectives as string) || "",
        requirements: (sp.requirements as string) || "",
        sortOrder: spIndex,
      };
      spData.PresetConversation = {
        create: ((sp.presetConversations as Record<string, unknown>[]) || []).map((pc: Record<string, unknown>, pcIndex: number) => ({
          title: (pc.title as string) || "",
          description: (pc.description as string) || undefined,
          systemPrompt: (pc.systemPrompt as string) || undefined,
          analysisPrompt: (pc.analysisPrompt as string) || undefined,
          classAnalysisPrompt: (pc.classAnalysisPrompt as string) || undefined,
          sortOrder: pcIndex,
        })),
      };
      spData.QuizActivity = {
        create: ((sp.quizActivities as Record<string, unknown>[]) || []).map((qa: Record<string, unknown>, qaIndex: number) => ({
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
      spData.ExplorationActivity = {
        create: ((sp.explorations as Record<string, unknown>[]) || []).map((e: Record<string, unknown>, eIndex: number) => ({
          title: (e.title as string) || "探究活动",
          description: (e.description as string) || "",
          htmlContent: (e.htmlContent as string) || "",
          designPrompt: (e.designPrompt as string) || undefined,
          analysisPrompt: (e.analysisPrompt as string) || undefined,
          sortOrder: eIndex,
          enabled: true,
        })),
      };
      return spData;
    });

    // 创建课堂
    const newTask = await prisma.learningTask.create({
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
        updatedAt: new Date(),
        subProjects: {
          create: subProjectsData,
        },
      },
      include: {
        subProjects: {
          include: {
            PresetConversation: { select: { id: true, title: true, description: true, systemPrompt: true, analysisPrompt: true, classAnalysisPrompt: true, sortOrder: true, enabled: true } },
            QuizActivity: { select: { id: true, title: true, description: true, status: true, sortOrder: true, Question: { orderBy: { order: "asc" } } } },
            ExplorationActivity: { select: { id: true, title: true, description: true, sortOrder: true, enabled: true } },
          },
        },
        assignments: true,
      },
    });

    // 映射字段名以匹配前端期望
    const mapSubProject = (sp: Record<string, unknown>) => {
      const { PresetConversation, QuizActivity, ExplorationActivity, ...rest } = sp;
      return {
        ...rest,
        presetConversations: PresetConversation,
        quizActivities: (QuizActivity as Array<Record<string, unknown>>)?.map((qa) => {
          const { Question, ...qaRest } = qa;
          return { ...qaRest, questions: Question };
        }),
        explorations: ExplorationActivity,
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