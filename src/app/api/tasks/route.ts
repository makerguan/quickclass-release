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

    // ══════════════════════════════════════════════════════════════════════════
    // ⚠️ 列表瘦身契约 · 不要在这里加回大字段
    // ══════════════════════════════════════════════════════════════════════════
    // 本接口是课堂管理页（/teacher/tasks）每次刷新都要调的接口，只下发「目录级」
    // 信息：id / 标题 / 状态 / 排序 / 模板名 / 归属班级等。
    //
    // 为什么不能带大字段：
    //   提示词正文（systemPrompt / analysisPrompt / classAnalysisPrompt /
    //   designPrompt / aiCompanionPrompt）与探究 HTML 正文合计可达数百 KB。
    //   实测 8 个课堂 = 372 KiB 响应，其中 89% 是提示词；而数据库查询只要 14ms。
    //   开了大字段后，每次刷新都要多传数百 KB + 前端解析 + 渲染，页面体感「慢」。
    //   （瘦身后实测 372 KiB → 65.5 KiB，降 82.4%）
    //
    // ⛔ 历史教训（务必先读）：
    //   本处被「半截优化」坑过一次 —— 当年只把字段从列表剥掉、**没配编辑时按需拉取**，
    //   于是重进编辑弹窗看不到已填的提示词，下一个人为修这个 bug 又把字段整个加回列表，
    //   优化就此整体回退。**剥字段与「编辑入口按需拉取」必须成对存在。**
    //   所以：你若想把上面 5 个提示词字段加回 select，请先确认前端 4 个编辑入口
    //   仍在「先拉详情再打开」；否则会同时引入「刷新变慢」与「保存清空提示词」两个问题。
    //
    // 关联（这几处是一套，改一处要一起看）：
    //   - 详情接口：GET /api/tasks/[taskId]（?lite=1 时不返回探究 HTML 正文）
    //   - 对话活动详情：GET /api/preset-conversations/[id]
    //   - 前端按需拉取：src/app/teacher/tasks/page.tsx 的 fetchTaskDetailLite()，
    //     以及 openEditForm / startEditingSubProjects / openEditConversationDialog /
    //     openEditExploration 四个入口
    //   - 本文件 POST 分支的 select 必须与本处保持同一口径
    //
    // 刻意保留（别当成「漏剥」顺手删掉）：
    //   - SubProject.analysisPrompt   —— 不是提示词正文语义，「新建子活动」要用它的默认值
    //   - QuizActivity.analysisPrompt —— 「编辑作业」要回填；此前从未下发，导致保存即清空库
    //   - QuizActivity.Question       —— 列表要渲染题目摘要
    //
    // 维护指引：
    //   将来 LearningTask / SubProject / PresetConversation / ExplorationActivity
    //   新增「长文本」字段（提示词、HTML、JSON 正文…），默认**不要**加进本 select，
    //   改为在详情接口里返回、编辑时按需拉取；新增「目录级」字段（标题/状态/排序/外键）
    //   按需加即可。
    // ══════════════════════════════════════════════════════════════════════════
    const rawTasks = await prisma.learningTask.findMany({
      where: { teacherId: String(payload.userId) },
      select: {
        id: true,
        title: true,
        description: true,
        grade: true,
        subject: true,
        objectives: true,
        requirements: true,
        knowledgeBase: true,
        knowledgeBaseIds: true,
        imageGroupIds: true,
        studentInsightTemplateId: true,
        classInsightTemplateId: true,
        status: true,
        teacherId: true,
        createdAt: true,
        updatedAt: true,
        classInsightTemplate: { select: { id: true, name: true, type: true } },
        studentInsightTemplate: { select: { id: true, name: true, type: true } },
        subProjects: {
          select: {
            id: true,
            taskId: true,
            title: true,
            description: true,
            objectives: true,
            requirements: true,
            knowledgeBase: true,
            analysisPrompt: true,
            studentInsightTemplateId: true,
            classInsightTemplateId: true,
            sortOrder: true,
            enabled: true,
            createdAt: true,
            classInsightTemplate: { select: { id: true, name: true, type: true } },
            studentInsightTemplate: { select: { id: true, name: true, type: true } },
            PresetConversation: { select: { id: true, title: true, description: true, sortOrder: true, enabled: true, studentInsightTemplateId: true, classInsightTemplateId: true }, orderBy: [{ sortOrder: "asc" }] },
            QuizActivity: { select: { id: true, subProjectId: true, title: true, description: true, status: true, sortOrder: true, analysisPrompt: true, _count: { select: { QuizAttempt: true } }, Question: { orderBy: { order: "asc" } } }, orderBy: [{ status: "desc" }, { sortOrder: "asc" }] },
            ExplorationActivity: { select: { id: true, title: true, description: true, enableSubmission: true, enableAiCompanion: true, sortOrder: true, enabled: true, _count: { select: { ExplorationSubmission: true } } }, orderBy: [{ sortOrder: "asc" }] },
            ProjectSubmission: { orderBy: { sortOrder: "asc" } },
          },
          orderBy: { sortOrder: "asc" },
        },
        assignments: { include: { class: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    // 映射字段名以匹配前端期望
    const mapSubProject = (sp: Record<string, unknown>) => {
      const { PresetConversation, QuizActivity, ExplorationActivity, ProjectSubmission, ...rest } = sp;
      return {
        ...rest,
        presetConversations: PresetConversation,
        quizActivities: (QuizActivity as Array<Record<string, unknown>>)?.map((qa) => {
          const { Question, _count, ...qaRest } = qa;
          return {
            ...qaRest,
            questions: Question,
            // Prisma _count 字段名是 QuizAttempt，前端约定读 attempts，这里做字段名映射
            _count: { attempts: (_count as { QuizAttempt?: number } | undefined)?.QuizAttempt ?? 0 },
          };
        }),
        explorationActivities: ExplorationActivity,
        projectSubmissions: ProjectSubmission,
      };
    };
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
    const { title, description, grade, subject, objectives, requirements, knowledgeBase, analysisPrompt, knowledgeBaseIds, imageGroupIds, subProjects, classIds, studentInsightTemplateId, classInsightTemplateId, classAnalysisPrompt } = body;

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
        imageGroupIds: imageGroupIds || null,
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
      // ⚠️ 与「列表 GET」保持同一口径 —— 原因、历史教训与关联点见本文件 GET 分支
      // 顶部的「列表瘦身契约」注释块。创建后返回的也是目录级数据，不含提示词正文
      // 与探究 HTML 正文。
      // 维护提示：此处与 GET 的 select 字段列表**必须同步修改**，否则会出现
      // 「列表已瘦身、但新建课堂后前端拿到的对象仍带一批大字段」的口径漂移。
      select: {
        id: true,
        title: true,
        description: true,
        grade: true,
        subject: true,
        objectives: true,
        requirements: true,
        knowledgeBase: true,
        knowledgeBaseIds: true,
        imageGroupIds: true,
        studentInsightTemplateId: true,
        classInsightTemplateId: true,
        status: true,
        teacherId: true,
        createdAt: true,
        updatedAt: true,
        classInsightTemplate: { select: { id: true, name: true, type: true } },
        studentInsightTemplate: { select: { id: true, name: true, type: true } },
        subProjects: {
          select: {
            id: true,
            taskId: true,
            title: true,
            description: true,
            objectives: true,
            requirements: true,
            knowledgeBase: true,
            analysisPrompt: true,
            studentInsightTemplateId: true,
            classInsightTemplateId: true,
            sortOrder: true,
            enabled: true,
            createdAt: true,
            classInsightTemplate: { select: { id: true, name: true, type: true } },
            studentInsightTemplate: { select: { id: true, name: true, type: true } },
            PresetConversation: { select: { id: true, title: true, description: true, sortOrder: true, enabled: true, studentInsightTemplateId: true, classInsightTemplateId: true }, orderBy: [{ sortOrder: "asc" }] },
            QuizActivity: { select: { id: true, subProjectId: true, title: true, description: true, status: true, sortOrder: true, analysisPrompt: true, _count: { select: { QuizAttempt: true } }, Question: { orderBy: { order: "asc" } } }, orderBy: [{ status: "desc" }, { sortOrder: "asc" }] },
            ExplorationActivity: { select: { id: true, title: true, description: true, enableSubmission: true, enableAiCompanion: true, sortOrder: true, enabled: true, _count: { select: { ExplorationSubmission: true } } }, orderBy: [{ sortOrder: "asc" }] },
            ProjectSubmission: { orderBy: { sortOrder: "asc" } },
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
