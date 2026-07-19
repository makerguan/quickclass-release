import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { generateText } from "ai";
import {
  ANALYST_SYSTEM,
  buildTaskClassPrompt,
  buildTaskStudentPrompt,
} from "@/lib/prompts";

// GET: 获取指定课堂的学情数据
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
      select: {
        id: true, title: true, objectives: true, requirements: true,
        knowledgeBase: true, teacherId: true, analysisPrompt: true,
        grade: true, subject: true,
        subProjects: {
          include: { PresetConversation: { orderBy: { sortOrder: "asc" } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    if (task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId") || undefined;
    console.log('[insights] taskId:', taskId, 'classId:', classId);

    // 不再依赖 taskAssignment，直接查询有对话记录的班级
    // 1. 先获取该课堂所有的 presetConversationId
    const presetIds = task.subProjects.flatMap((sp) => (sp as any).PresetConversation.map((pc: { id: string }) => pc.id));
    console.log('[insights] presetIds:', presetIds);

    // 2. 查询所有相关的对话（含无预设活动的对话），提取 classId
    const conversationsWithClass = await prisma.conversation.findMany({
      where: {
        classId: { not: undefined },
        ...(presetIds.length > 0
          ? {
              OR: [
                { presetConversationId: { in: presetIds } },
                { presetConversationId: null },
              ],
            }
          : {}),
      },
      select: { classId: true },
      distinct: ['classId'],
    });
    console.log('[insights] conversationsWithClass:', conversationsWithClass);

    const classIds = conversationsWithClass.map((c) => c.classId);
    console.log('[insights] classIds:', classIds);

    // 3. 查询班级信息
    // 关键：没有对话记录时 classIds=[]，但如果指定了 classId 仍需返回该班级
    const classesWhere = classIds.length > 0
      ? { id: { in: classIds }, ...(classId ? { id: classId } : {}) }
      : classId
        ? { id: classId }
        : { id: { in: [] } }; // 既无对话也无 classId 则返回空

    const classesData = await prisma.class.findMany({
      where: classesWhere,
      select: { id: true, name: true },
    });
    console.log('[insights] classesData:', classesData);

    const assignments = classesData.map((cls) => ({ class: cls }));
    console.log('[insights] assignments:', assignments);

    // 获取系统配置（全局数据来源）
    const systemConfig = await prisma.systemConfig.findFirst();
    const globalInsightDataSource = systemConfig?.insightDataSource || "CONVERSATIONS";

    const classes = await Promise.all(
      assignments.map(async (assignment) => {
        const cid = assignment.class.id;

        const students = await prisma.user.findMany({
          where: { classId: cid, role: "STUDENT" },
          select: { id: true, name: true },
        });

        const presetIds = task.subProjects.flatMap((sp) => (sp as any).PresetConversation.map((pc: { id: string }) => pc.id));

        const conversations = await prisma.conversation.findMany({
          where: { 
            classId: cid, 
            userId: { in: students.map((s) => s.id) },
            OR: [
              { presetConversationId: { in: presetIds } },
              { presetConversationId: null },
            ],
          },
          include: { Message: { select: { id: true } } },
        });

        const studentMap = new Map<string, { convCount: number; msgCount: number; completedPresets: Set<string>; lastActiveAt: Date | null }>();
        for (const s of students) {
          studentMap.set(s.id, { convCount: 0, msgCount: 0, completedPresets: new Set(), lastActiveAt: null });
        }

        for (const conv of conversations) {
          const info = studentMap.get(conv.userId);
          if (!info) continue;
          info.convCount++;
          info.msgCount += conv.Message.length;
          if (conv.presetConversationId) {
            info.completedPresets.add(conv.presetConversationId);
          }
          if (!info.lastActiveAt || conv.updatedAt > info.lastActiveAt) {
            info.lastActiveAt = conv.updatedAt;
          }
        }

        const presetConvStats = new Map<string, { completedCount: number; totalMessages: number }>();
        for (const pcId of presetIds) {
          presetConvStats.set(pcId, { completedCount: 0, totalMessages: 0 });
        }
        for (const conv of conversations) {
          if (!conv.presetConversationId) continue;
          const stat = presetConvStats.get(conv.presetConversationId);
          if (!stat) continue;
          stat.completedCount++;
          stat.totalMessages += conv.Message.length;
        }

        const activeStudents = Array.from(studentMap.values()).filter((s) => s.convCount > 0).length;

        return {
          classId: cid,
          className: assignment.class.name,
          totalStudents: students.length,
          activeStudents,
          totalConversations: conversations.length,
          totalMessages: conversations.reduce((sum, c) => sum + c.Message.length, 0),
          subProjects: task.subProjects.map((sp) => ({
            id: sp.id,
            title: sp.title,
            analysisPrompt: sp.analysisPrompt,
            presetConversations: (sp as any).PresetConversation.map((pc: { id: string }) => {
              const stat = presetConvStats.get(pc.id) || { completedCount: 0, totalMessages: 0 };
              return {
                id: pc.id,
                title: pc.title,
                analysisPrompt: pc.analysisPrompt,
                completedCount: stat.completedCount,
                totalMessages: stat.totalMessages,
              };
            }),
          })),
          students: students.map((s) => {
            const info = studentMap.get(s.id)!;
            return {
              id: s.id,
              name: s.name,
              convCount: info.convCount,
              msgCount: info.msgCount,
              completedPresets: Array.from(info.completedPresets),
              lastActiveAt: info.lastActiveAt?.toISOString() || null,
            };
          }),
        };
      })
    );

    // 获取已保存的任务级AI洞察（只取当前课堂的）
    const insightWhere: Record<string, unknown> = {
      type: { in: ["task_class", "task_student"] },
      scopeId: taskId,
    };
    if (classId) {
      insightWhere.classId = classId;
    } else {
      insightWhere.classId = { in: assignments.map((a) => a.class.id) };
    }

    // 获取所有洞察
    const allInsights = await prisma.aIInsight.findMany({
      where: insightWhere,
      orderBy: { version: "desc" },
    });

    // 去重：只保留每个 type + classId + userId 组合的最新版本
    const latestInsightsMap = new Map<string, typeof allInsights[0]>();
    for (const insight of allInsights) {
      const key = `${insight.type}-${insight.classId}-${insight.userId || "class"}`;
      if (!latestInsightsMap.has(key)) {
        latestInsightsMap.set(key, insight);
      }
    }
    const insights = Array.from(latestInsightsMap.values());

    // 解析星星数量：从 content 中提取 ★ 的个数
    const parseStarCount = (content: string): number => {
      // SIMPLE 模式下 content 可能全为星星，也可能包含星星行
      // 匹配连续 ★ 的序列
      const match = content.match(/★+/g);
      if (match) {
        // 取最长的连续星星序列
        return Math.max(...match.map((s) => s.length));
      }
      return 0;
    };

    return NextResponse.json({
      task: {
        id: task.id, title: task.title,
        objectives: task.objectives, requirements: task.requirements,
        analysisPrompt: task.analysisPrompt,
        subProjects: task.subProjects.map((sp) => ({
          id: sp.id, title: sp.title,
          analysisPrompt: sp.analysisPrompt,
          presetConversations: (sp as any).PresetConversation.map((pc: { id: string; title: string; analysisPrompt: string | null }) => ({
            id: pc.id, title: pc.title, analysisPrompt: pc.analysisPrompt,
          })),
        })),
      },
      insightDataSource: globalInsightDataSource,
      requireStarRating: systemConfig?.requireStarRating ?? false,
      classes,
      insights: insights.map((i) => ({
        id: i.id, type: i.type, content: i.content,
        version: i.version, createdAt: i.createdAt.toISOString(), classId: i.classId,
        userId: i.userId,
        starCount: parseStarCount(i.content),
      })),
    });
  } catch (error) {
    console.error("Get task insights error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// POST: 为指定课堂生成 AI 分析
export async function POST(
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
    const body = await req.json();
    const { classId, type, studentId, templateId, checkOnly, previewOnly } = body;

    if (!classId) return NextResponse.json({ error: "classId 为必填参数" }, { status: 400 });
    if (!["class", "student"].includes(type)) {
      return NextResponse.json({ error: "type 必须为 class 或 student" }, { status: 400 });
    }
    if (type === "student" && !studentId) {
      return NextResponse.json({ error: "学生分析需提供 studentId" }, { status: 400 });
    }

    const cls = await prisma.class.findFirst({
      where: { id: classId, teacherId: String(payload.userId) },
    });
    if (!cls) return NextResponse.json({ error: "班级不存在或无权限" }, { status: 403 });

    // 获取系统配置（全局数据来源）
    const systemConfig = await prisma.systemConfig.findFirst();
    const insightDataSource = systemConfig?.insightDataSource || "CONVERSATIONS";

    // 如果只是检查下级报告完整度，不生成分析
    if (checkOnly && insightDataSource === "TASK_INSIGHTS") {
      const missingItems = await checkTaskMissingItems(taskId, classId, type, studentId);
      return NextResponse.json(missingItems);
    }

    // 获取任务详情
    const task = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: {
        subProjects: {
          include: { PresetConversation: { orderBy: { sortOrder: "asc" } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!task) return NextResponse.json({ error: "课堂不存在" }, { status: 404 });
    if (task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 获取模板内容（备用，当 analysisPrompt 字段为空时使用）
    let templateContent: string | null = null;
    if (templateId) {
      const template = await prisma.analysisTemplate.findUnique({ where: { id: templateId } });
      if (template) {
        templateContent = template.content;
      }
    }

    // 最终使用的提示词：班级分析优先用 classAnalysisPrompt
    const effectivePrompt = type === "class"
      ? (task.classAnalysisPrompt || task.analysisPrompt || templateContent)
      : (task.analysisPrompt || templateContent);

    // 检测提示词是否为 HTML 格式
    const isHtmlOutput = effectivePrompt ? (
      effectivePrompt.includes('<!DOCTYPE') ||
      effectivePrompt.includes('<html') ||
      effectivePrompt.includes('<div') ||
      effectivePrompt.includes('echarts') ||
      effectivePrompt.includes('ECharts') ||
      effectivePrompt.includes('chart') ||
      effectivePrompt.toLowerCase().includes('html')
    ) : false;

    const assignment = await prisma.taskAssignment.findFirst({
      where: { taskId, classId },
    });
    if (!assignment) {
      return NextResponse.json({ error: "该班级未分配到此任务" }, { status: 400 });
    }

    const insightType = type === "class" ? "task_class" : "task_student";

    const { chatModel } = await createDashScopeClient();

    // 获取系统配置（分析字数限制）
    const insightLevel = "STANDARD"; // 已从 SystemConfig 移除，提供默认值
    const studentWordLimit = systemConfig?.studentWordLimit ?? 800;
    const classWordLimit = systemConfig?.classWordLimit ?? 2000;
    const starCount = 10; // 已从 SystemConfig 移除，提供默认值
    const requireStarRating = systemConfig?.requireStarRating ?? false;

    // 将 null 转换为 undefined 以符合函数签名，并映射 Prisma 字段名
    const taskNormalized = {
      ...task,
      grade: task.grade ?? undefined,
      subject: task.subject ?? undefined,
      subProjects: task.subProjects.map((sp) => ({
        ...sp,
        presetConversations: sp.PresetConversation,
        PresetConversation: undefined,
      })),
    };

    // 如果只是预览提示词，不调用 AI
    if (previewOnly) {
      let promptText: string;
      let dialogData = "";
      if (type === "class") {
        promptText = await generateTaskClassInsightWithTemplate(chatModel, taskNormalized, classId, insightDataSource, effectivePrompt, {
          insightLevel, classWordLimit: isHtmlOutput ? undefined : classWordLimit, starCount, requireStarRating, isHtmlOutput,
        }, true);
        // 查询班级对话概览供预览
        const presetIds = (task as any).subProjects.flatMap((sp: any) => sp.PresetConversation.map((pc: { id: string }) => pc.id));
        const [students, conversations] = await Promise.all([
          prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
          prisma.conversation.findMany({
            where: { classId, presetConversationId: { in: presetIds } },
            include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true }, take: 3 } },
            orderBy: { updatedAt: "desc" }, take: 30,
          }),
        ]);
        const activeStudents = new Set(conversations.map((c) => c.userId));
        dialogData = `参与学生：${activeStudents.size}/${students.length}人\n\n`;
        dialogData += conversations.slice(0, 10).map((c) => {
          const msgs = c.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content.substring(0, 200)}`).join("\n");
          return `${c.User?.name || "未知"} - ${c.title}:\n${msgs}`;
        }).join("\n\n---\n\n");
      } else {
        promptText = await generateTaskStudentInsightWithTemplate(chatModel, taskNormalized, classId, studentId, insightDataSource, effectivePrompt, {
          insightLevel, studentWordLimit, starCount, requireStarRating
        }, true);
        // 查询该学生的对话记录供预览
        const presetIds = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => pc.id));
        const [student, conversations] = await Promise.all([
          prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }),
          prisma.conversation.findMany({
            where: { classId, userId: studentId, presetConversationId: { in: presetIds } },
            include: { PresetConversation: { select: { title: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
            orderBy: { updatedAt: "desc" }, take: 10,
          }),
        ]);
        dialogData = `学生：${student?.name || "未知"}\n对话数：${conversations.length}\n\n`;
        dialogData += conversations.map((conv, i) => {
          const msgs = conv.Message.map((m) => `${m.role === "user" ? "👤 学生" : "🤖 AI"}：${m.content}`).join("\n");
          return `【对话 ${i + 1}】${conv.PresetConversation?.title || conv.title}\n${msgs}`;
        }).join("\n\n---\n\n");
      }
      return NextResponse.json({ prompt: promptText, dialogData });
    }

    let content: string;
    if (type === "class") {
      content = await generateTaskClassInsightWithTemplate(chatModel, taskNormalized, classId, insightDataSource, effectivePrompt, {
        insightLevel, classWordLimit: isHtmlOutput ? undefined : classWordLimit, starCount, requireStarRating, isHtmlOutput,
      });
    } else {
      content = await generateTaskStudentInsightWithTemplate(chatModel, taskNormalized, classId, studentId, insightDataSource, effectivePrompt, {
        insightLevel, studentWordLimit, starCount, requireStarRating
      });
    }

    const existingInsight = await prisma.aIInsight.findFirst({
      where: {
        classId,
        type: insightType,
        ...(type === "student" ? { userId: studentId } : { userId: null }),
        scopeId: taskId,
      },
      orderBy: { version: "desc" },
    });
    const version = (existingInsight?.version || 0) + 1;

    const saved = await prisma.aIInsight.create({
      data: {
        type: insightType,
        classId,
        ...(type === "student" ? { userId: studentId } : { userId: null }),
        scopeId: taskId,
        content,
        version,
      },
    });

    return NextResponse.json({
      content,
      version,
      id: saved.id,
      previousContent: existingInsight?.content || null,
      previousId: existingInsight?.id || null,
    });
  } catch (error) {
    console.error("Generate task insight error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}

async function generateTaskClassInsight(
  chatModel: unknown,
  task: {
    id: string; title: string; objectives: string; requirements: string;
    knowledgeBase?: string | null; analysisPrompt?: string | null;
    grade?: string; subject?: string;
    subProjects: Array<{
      id: string; title: string; objectives: string; requirements: string; analysisPrompt?: string | null;
      presetConversations: Array<{ id: string; title: string; description?: string | null }>;
    }>;
  },
  classId: string,
  dataSource: string,
  templateContent: string | null,
  config: { insightLevel: string; classWordLimit: number; starCount: number; requireStarRating: boolean; isHtmlOutput?: boolean }
): Promise<string> {
  const presetIds = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => pc.id));
  const allPCs = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => ({ id: pc.id, title: pc.title })));

  const [students, conversations] = await Promise.all([
    prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, presetConversationId: { in: presetIds } },
      include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const useSubInsights = dataSource === "TASK_INSIGHTS";

  if (useSubInsights) {
    const pcClassInsights: Array<{ pcTitle: string; content: string }> = [];
    const pcStudentInsights: Array<{ studentName: string; pcTitle: string; content: string }> = [];
    for (const pc of allPCs) {
      const classIns = await prisma.aIInsight.findMany({
        where: { classId, type: "pc_class", scopeId: pc.id },
        orderBy: { version: "desc" }, take: 1,
      });
      if (classIns.length > 0) {
        pcClassInsights.push({ pcTitle: pc.title, content: classIns[0].content });
      }
      const studentIns = await prisma.aIInsight.findMany({
        where: { classId, type: "pc_student", scopeId: pc.id },
        orderBy: { version: "desc" },
        include: { User: { select: { name: true } } },
      });
      const seenStudent = new Set<string>();
      for (const ins of studentIns) {
        if (ins.userId && !seenStudent.has(ins.userId)) {
          seenStudent.add(ins.userId);
          pcStudentInsights.push({ studentName: ins.User?.name || "未知", pcTitle: pc.title, content: ins.content });
        }
      }
    }

    const customSection = templateContent
      ? `## 教师自定义分析模板\n${templateContent}`
      : (task.analysisPrompt ? `## 教师自定义分析要求\n${task.analysisPrompt}` : undefined);

    const prompt = buildTaskClassPrompt({
      taskTitle: task.title,
      taskObjectives: task.objectives,
      taskRequirements: task.requirements,
      knowledgeBase: task.knowledgeBase ?? undefined,
      pcClassInsights,
      pcStudentInsights,
      customSection,
      useSubInsights: true,
      quizStats: await buildClassQuizStats(task.id, classId),
      personalDialogAnalysisReport: pcStudentInsights.length > 0
        ? pcStudentInsights.map((p) => `【${p.pcTitle} - ${p.studentName}】\n${p.content}`).join("\n\n")
        : "",
      classDialogAnalysisReport: pcClassInsights.length > 0
        ? pcClassInsights.map((p) => `【${p.pcTitle}】\n${p.content}`).join("\n\n")
        : "",
      classQuizStats: await buildClassQuizStats(task.id, classId),
      taskInfo: { taskTitle: task.title, taskObjectives: task.objectives, grade: task.grade ?? undefined, subject: task.subject ?? undefined },
      config,
    });

    const result = await aiQueue.enqueue(async () =>
      generateText({
        model: chatModel as Parameters<typeof generateText>[0]["model"],
        system: ANALYST_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      })
    );
    return result.text;
  }

  // 拼接所有学生的完整对话内容
  const dialogContents = buildDialogContents(conversations, students, allPCs);

  // 直接对话数据分析
  const presetStats = new Map<string, { completedStudents: Set<string>; totalMessages: number }>();
  for (const pcId of presetIds) {
    presetStats.set(pcId, { completedStudents: new Set(), totalMessages: 0 });
  }
  for (const conv of conversations) {
    if (!conv.presetConversationId) continue;
    const stat = presetStats.get(conv.presetConversationId);
    if (!stat) continue;
    stat.completedStudents.add(conv.userId);
    stat.totalMessages += conv.Message.length;
  }

  const studentStats = new Map<string, { name: string; convCount: number; msgCount: number; completedPresets: string[] }>();
  for (const s of students) {
    studentStats.set(s.id, { name: s.name, convCount: 0, msgCount: 0, completedPresets: [] });
  }
  for (const conv of conversations) {
    if (!conv.presetConversationId) continue;
    const info = studentStats.get(conv.userId);
    if (!info) continue;
    info.convCount++;
    info.msgCount += conv.Message.length;
    info.completedPresets.push(conv.presetConversationId);
  }

  const activeStudentsList = Array.from(studentStats.values()).filter((s) => s.convCount > 0);
  const totalPresetCount = presetIds.length;

  const subProjectSummary = task.subProjects.map((sp) => {
    const pcStats = sp.presetConversations.map((pc) => {
      const stat = presetStats.get(pc.id);
      const completed = stat?.completedStudents.size || 0;
      const msgs = stat?.totalMessages || 0;
      return `  - ${pc.title}：${completed}/${students.length}人完成，${msgs}条消息`;
    });
    return `### ${sp.title}\n${pcStats.join("\n")}`;
  }).join("\n\n");

  const recentQuestions = conversations
    .flatMap((c) => c.Message.filter((m) => m.role === "user").map((m) => ({ student: c.User.name, question: m.content })))
    .slice(0, 30).map((q) => `${q.student}：${q.question.substring(0, 80)}`).join("\n");

  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : (task.analysisPrompt ? `## 教师自定义分析要求\n${task.analysisPrompt}` : undefined);

  const prompt = buildTaskClassPrompt({
    taskTitle: task.title,
    taskObjectives: task.objectives,
    taskRequirements: task.requirements,
    knowledgeBase: task.knowledgeBase ?? undefined,
    pcClassInsights: [],
    pcStudentInsights: [],
    customSection,
    useSubInsights: false,
    dialogContents,
    quizStats: await buildClassQuizStats(task.id, classId),
    personalDialogAnalysisReport: "",
    classDialogAnalysisReport: "",
    classQuizStats: await buildClassQuizStats(task.id, classId),
    rawData: {
      students: Array.from(studentStats.values()).map((s) => ({
        name: s.name,
        convCount: s.convCount,
        msgCount: s.msgCount,
        completedPresets: s.completedPresets.length,
        totalPresets: totalPresetCount,
      })),
      recentQuestions,
      subProjectSummary,
    },
    taskInfo: { taskTitle: task.title, taskObjectives: task.objectives, grade: task.grade ?? undefined, subject: task.subject ?? undefined },
    config,
  });

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel as Parameters<typeof generateText>[0]["model"],
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    })
  );
  return result.text;
}

async function generateTaskStudentInsight(
  chatModel: unknown,
  task: {
    id: string; title: string; objectives: string; requirements: string;
    knowledgeBase?: string | null; analysisPrompt?: string | null;
    grade?: string; subject?: string;
    subProjects: Array<{
      id: string; title: string; objectives: string; requirements: string; analysisPrompt?: string | null;
      presetConversations: Array<{ id: string; title: string; description?: string | null }>;
    }>;
  },
  classId: string,
  studentId: string,
  dataSource: string,
  templateContent: string | null,
  config: { insightLevel: string; studentWordLimit: number; starCount: number; requireStarRating: boolean }
): Promise<string> {
  const presetIds = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => pc.id));
  const allPCs = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => ({ id: pc.id, title: pc.title })));

  const [student, conversations] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, userId: studentId, presetConversationId: { in: presetIds } },
      include: { PresetConversation: { select: { title: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!student) throw new Error("学生不存在");

  const useSubInsights = dataSource === "TASK_INSIGHTS";

  if (useSubInsights) {
    const pcStudentInsights: Array<{ pcTitle: string; content: string }> = [];
    for (const pc of allPCs) {
      const insights = await prisma.aIInsight.findMany({
        where: { classId, type: "pc_student", userId: studentId, scopeId: pc.id },
        orderBy: { version: "desc" }, take: 1,
      });
      if (insights.length > 0) {
        pcStudentInsights.push({ pcTitle: pc.title, content: insights[0].content });
      }
    }

    const customSection = templateContent
      ? `## 教师自定义分析模板\n${templateContent}`
      : (task.analysisPrompt ? `## 教师自定义分析要求\n${task.analysisPrompt}` : undefined);

const prompt = buildTaskStudentPrompt({
  taskTitle: task.title,
  taskObjectives: task.objectives,
  taskRequirements: task.requirements,
  knowledgeBase: task.knowledgeBase ?? undefined,
  studentName: student.name,
  pcStudentInsights,
  dialogContents: "",
  presetCompletion: "",
  customSection,
  useSubInsights: true,
  quizStats: await buildPersonalQuizStats(task.id, classId, studentId),
  classQuizStats: await buildClassQuizStats(task.id, classId),
  taskInfo: { taskTitle: task.title, taskObjectives: task.objectives, grade: task.grade ?? undefined, subject: task.subject ?? undefined },
  config,
});

    const result = await aiQueue.enqueue(async () =>
      generateText({
        model: chatModel as Parameters<typeof generateText>[0]["model"],
        system: ANALYST_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      })
    );
    return result.text;
  }

  const dialogContents = conversations.map((conv, i) => {
    const msgs = conv.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`).join("\n");
    const presetTitle = conv.PresetConversation?.title || conv.title;
    return `对话${i + 1}（${presetTitle}）：\n${msgs}`;
  }).join("\n\n");

  const completedPresetIds = new Set(conversations.map((c) => c.presetConversationId).filter(Boolean) as string[]);
  const totalPresetCount = presetIds.length;

  const presetCompletion = task.subProjects.map((sp) => {
    const items = sp.presetConversations.map((pc) => {
      const done = completedPresetIds.has(pc.id);
      const conv = conversations.find((c) => c.presetConversationId === pc.id);
      return `  - ${pc.title}：${done ? "✓已完成" : "✗未完成"}${conv ? `，${conv.Message.length}条消息` : ""}`;
    });
    return `### ${sp.title}\n${items.join("\n")}`;
  }).join("\n\n");

  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : (task.analysisPrompt ? `## 教师自定义分析要求\n${task.analysisPrompt}` : undefined);

const prompt = buildTaskStudentPrompt({
  taskTitle: task.title,
  taskObjectives: task.objectives,
  taskRequirements: task.requirements,
  knowledgeBase: task.knowledgeBase ?? undefined,
  studentName: student.name,
  pcStudentInsights: [],
  dialogContents,
  presetCompletion,
  customSection,
  useSubInsights: false,
  quizStats: await buildPersonalQuizStats(task.id, classId, studentId),
  classQuizStats: await buildClassQuizStats(task.id, classId),
  taskInfo: { taskTitle: task.title, taskObjectives: task.objectives, grade: task.grade ?? undefined, subject: task.subject ?? undefined },
  config,
});

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel as Parameters<typeof generateText>[0]["model"],
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    })
  );
  return result.text;
}

// 模板驱动的课堂班级分析
async function generateTaskClassInsightWithTemplate(
  chatModel: unknown,
  task: {
    id: string; title: string; objectives: string; requirements: string;
    knowledgeBase?: string | null; analysisPrompt?: string | null;
    grade?: string; subject?: string;
    subProjects: Array<{
      id: string; title: string; objectives: string; requirements: string;
      presetConversations: Array<{ id: string; title: string }>;
    }>;
  },
  classId: string,
  dataSource: string,
  templateContent: string | null,
  config: { insightLevel: string; classWordLimit: number; starCount: number; requireStarRating: boolean; isHtmlOutput?: boolean },
  isPreview?: boolean
): Promise<string> {
  const presetIds = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => pc.id));
  const allPCs = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => ({ id: pc.id, title: pc.title })));

  const [students, conversations] = await Promise.all([
    prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, presetConversationId: { in: presetIds } },
      include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const useSubInsights = dataSource === "TASK_INSIGHTS";

  // 收集下层分析结果
  const pcClassInsights: Array<{ pcTitle: string; content: string }> = [];
  const pcStudentInsights: Array<{ studentName: string; pcTitle: string; content: string }> = [];
  for (const pc of allPCs) {
    const classIns = await prisma.aIInsight.findMany({
      where: { classId, type: "pc_class", scopeId: pc.id },
      orderBy: { version: "desc" }, take: 1,
    });
    if (classIns.length > 0) {
      pcClassInsights.push({ pcTitle: pc.title, content: classIns[0].content });
    }
    const studentIns = await prisma.aIInsight.findMany({
      where: { classId, type: "pc_student", scopeId: pc.id },
      orderBy: { version: "desc" },
      include: { User: { select: { name: true } } },
    });
    const seenStudent = new Set<string>();
    for (const ins of studentIns) {
      if (ins.userId && !seenStudent.has(ins.userId)) {
        seenStudent.add(ins.userId);
        pcStudentInsights.push({ studentName: ins.User?.name || "未知", pcTitle: pc.title, content: ins.content });
      }
    }
  }

  // 构建原始数据
  const presetStats = new Map<string, { completedStudents: Set<string>; totalMessages: number }>();
  for (const pcId of presetIds) {
    presetStats.set(pcId, { completedStudents: new Set(), totalMessages: 0 });
  }
  for (const conv of conversations) {
    if (!conv.presetConversationId) continue;
    const stat = presetStats.get(conv.presetConversationId);
    if (!stat) continue;
    stat.completedStudents.add(conv.userId);
    stat.totalMessages += conv.Message.length;
  }

  const studentStats = new Map<string, { name: string; convCount: number; msgCount: number; completedPresets: string[] }>();
  for (const s of students) {
    studentStats.set(s.id, { name: s.name, convCount: 0, msgCount: 0, completedPresets: [] });
  }
  for (const conv of conversations) {
    if (!conv.presetConversationId) continue;
    const info = studentStats.get(conv.userId);
    if (!info) continue;
    info.convCount++;
    info.msgCount += conv.Message.length;
    info.completedPresets.push(conv.presetConversationId);
  }

  const activeStudentsList = Array.from(studentStats.values()).filter((s) => s.convCount > 0);
  const totalPresetCount = presetIds.length;
  const recentQuestions = conversations
    .flatMap((c) => c.Message.filter((m) => m.role === "user").map((m) => ({ student: c.User.name, question: m.content })))
    .slice(0, 30).map((q) => `${q.student}：${q.question.substring(0, 80)}`).join("\n");

  const subProjectSummary = task.subProjects.map((sp) => {
    const pcStats = sp.presetConversations.map((pc) => {
      const stat = presetStats.get(pc.id);
      const completed = stat?.completedStudents.size || 0;
      const msgs = stat?.totalMessages || 0;
      return `  - ${pc.title}：${completed}/${students.length}人完成，${msgs}条消息`;
    });
    return `### ${sp.title}\n${pcStats.join("\n")}`;
  }).join("\n\n");

  const dialogContents = buildDialogContents(conversations, students, allPCs);

  // 始终构建包含完整数据段（含 dialogContents）的提示词，
  // 模板内容作为 customSection 追加到数据段中。
  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : undefined;

  const prompt = buildTaskClassPrompt({
    taskTitle: task.title,
    taskObjectives: task.objectives,
    taskRequirements: task.requirements,
    knowledgeBase: task.knowledgeBase ?? undefined,
    pcClassInsights: useSubInsights ? pcClassInsights : [],
    pcStudentInsights: useSubInsights ? pcStudentInsights : [],
    customSection,
    useSubInsights,
    dialogContents: useSubInsights ? undefined : dialogContents,
    quizStats: await buildClassQuizStats(task.id, classId),
    personalDialogAnalysisReport: useSubInsights && pcStudentInsights.length > 0
      ? pcStudentInsights.map((p) => `【${p.pcTitle} - ${p.studentName}】\n${p.content}`).join("\n\n")
      : "",
    classDialogAnalysisReport: useSubInsights && pcClassInsights.length > 0
      ? pcClassInsights.map((p) => `【${p.pcTitle}】\n${p.content}`).join("\n\n")
      : "",
    classQuizStats: await buildClassQuizStats(task.id, classId),
    rawData: useSubInsights ? undefined : {
      students: Array.from(studentStats.values()).map((s) => ({
        name: s.name,
        convCount: s.convCount,
        msgCount: s.msgCount,
        completedPresets: s.completedPresets.length,
        totalPresets: totalPresetCount,
      })),
      recentQuestions,
      subProjectSummary,
    },
    taskInfo: { taskTitle: task.title, taskObjectives: task.objectives, grade: task.grade ?? undefined, subject: task.subject ?? undefined },
    config,
  });

  if (isPreview) return prompt;

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel as Parameters<typeof generateText>[0]["model"],
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    })
  );
  return result.text;
}

// 模板驱动的课堂学生分析
async function generateTaskStudentInsightWithTemplate(
  chatModel: unknown,
  task: {
    id: string; title: string; objectives: string; requirements: string;
    knowledgeBase?: string | null; analysisPrompt?: string | null;
    grade?: string; subject?: string;
    subProjects: Array<{
      id: string; title: string; objectives: string; requirements: string;
      presetConversations: Array<{ id: string; title: string }>;
    }>;
  },
  classId: string,
  studentId: string,
  dataSource: string,
  templateContent: string | null,
  config: { insightLevel: string; studentWordLimit: number; starCount: number; requireStarRating: boolean },
  isPreview?: boolean
): Promise<string> {
  const presetIds = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => pc.id));
  const allPCs = task.subProjects.flatMap((sp) => sp.presetConversations.map((pc) => ({ id: pc.id, title: pc.title })));

  const [student, conversations] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, userId: studentId, presetConversationId: { in: presetIds } },
      include: { PresetConversation: { select: { title: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!student) throw new Error("学生不存在");

  const useSubInsights = dataSource === "TASK_INSIGHTS";

  // 收集下层学生分析结果
  const pcStudentInsights: Array<{ studentName: string; pcTitle: string; content: string }> = [];
  for (const pc of allPCs) {
    const insights = await prisma.aIInsight.findMany({
      where: { classId, type: "pc_student", userId: studentId, scopeId: pc.id },
      orderBy: { version: "desc" }, take: 1,
    });
    if (insights.length > 0) {
      pcStudentInsights.push({ studentName: student.name, pcTitle: pc.title, content: insights[0].content });
    }
  }

  // 构建该学生的完整对话记录
  const dialogContents = conversations.map((conv, i) => {
    const msgs = conv.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`).join("\n");
    const presetTitle = conv.PresetConversation?.title || conv.title;
    return `【${presetTitle}】\n${msgs}`;
  }).join("\n\n");

  const completedPresetIds = new Set(conversations.map((c) => c.presetConversationId).filter(Boolean) as string[]);
  const totalPresetCount = presetIds.length;

  const presetCompletion = task.subProjects.map((sp) => {
    const items = sp.presetConversations.map((pc) => {
      const done = completedPresetIds.has(pc.id);
      const conv = conversations.find((c) => c.presetConversationId === pc.id);
      return `  - ${pc.title}：${done ? "✓已完成" : "✗未完成"}${conv ? `，${conv.Message.length}条消息` : ""}`;
    });
    return `### ${sp.title}\n${items.join("\n")}`;
  }).join("\n\n");

  // 始终构建包含完整数据段（含对话记录）的提示词，
  // 模板内容作为 customSection 追加到数据段中。
  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : undefined;

const prompt = buildTaskStudentPrompt({
  taskTitle: task.title,
  taskObjectives: task.objectives,
  taskRequirements: task.requirements,
  knowledgeBase: task.knowledgeBase ?? undefined,
  studentName: student.name,
  pcStudentInsights: useSubInsights ? pcStudentInsights : [],
  dialogContents: useSubInsights ? "" : dialogContents,
  presetCompletion: useSubInsights ? "" : presetCompletion,
  customSection,
  useSubInsights,
  quizStats: await buildPersonalQuizStats(task.id, classId, studentId),
  classQuizStats: await buildClassQuizStats(task.id, classId),
  taskInfo: { taskTitle: task.title, taskObjectives: task.objectives, grade: task.grade ?? undefined, subject: task.subject ?? undefined },
  config,
});

  if (isPreview) return prompt;

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel as Parameters<typeof generateText>[0]["model"],
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    })
  );
  return result.text;
}

// 检查课堂级下级报告（学习活动）的完整度
async function checkTaskMissingItems(
  taskId: string,
  classId: string,
  type: string,
  studentId?: string,
) {
  const task = await prisma.learningTask.findUnique({
    where: { id: taskId },
    include: {
      subProjects: {
        include: { PresetConversation: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!task) return { hasMissing: false, missingItems: { PresetConversation: [] } };

  // 获取所有对话活动（扁平化）
  const allPCs = task.subProjects.flatMap((sp) =>
    sp.presetConversations.map((pc) => ({ id: pc.id, title: pc.title, spTitle: sp.title }))
  );
  const presetIds = allPCs.map((pc) => pc.id);

  // 获取有对话记录的学生
  const conversations = await prisma.conversation.findMany({
    where: { classId, presetConversationId: { in: presetIds } },
    select: { userId: true, presetConversationId: true },
  });

  // 统计每个对话活动有对话的学生
  const pcActiveStudents = new Map<string, Set<string>>();
  for (const pc of allPCs) {
    const activeSet = new Set<string>();
    for (const conv of conversations) {
      if (conv.presetConversationId === pc.id) {
        activeSet.add(conv.userId);
      }
    }
    if (activeSet.size > 0) {
      pcActiveStudents.set(pc.id, activeSet);
    }
  }

  const missingPCs: Array<{ id: string; title: string; spTitle: string; missingClass: boolean; missingStudents: string[] }> = [];

  for (const pc of allPCs) {
    const activeStudents = pcActiveStudents.get(pc.id);
    // 没有学生参与的对话活动可以忽略
    if (!activeStudents || activeStudents.size === 0) continue;

    let missingClass = false;
    const missingStudents: string[] = [];

    // 检查班级报告
    if (type === "class") {
      const classIns = await prisma.aIInsight.findFirst({
        where: { classId, type: "pc_class", scopeId: pc.id },
        orderBy: { version: "desc" },
      });
      if (!classIns) missingClass = true;
    }

    // 检查学生报告
    if (type === "class" || (type === "student" && studentId)) {
      const studentIds = type === "class"
        ? Array.from(activeStudents)
        : (activeStudents.has(studentId!) ? [studentId!] : []);

      for (const sid of studentIds) {
        const studentIns = await prisma.aIInsight.findFirst({
          where: { classId, type: "pc_student", userId: sid, scopeId: pc.id },
          orderBy: { version: "desc" },
        });
        if (!studentIns) {
          const student = await prisma.user.findUnique({ where: { id: sid }, select: { name: true } });
          missingStudents.push(student?.name || "未知");
        }
      }
    }

    if (missingClass || missingStudents.length > 0) {
      missingPCs.push({ id: pc.id, title: pc.title, spTitle: pc.spTitle, missingClass, missingStudents });
    }
  }

  return {
    hasMissing: missingPCs.length > 0,
    missingItems: { presetConversations: missingPCs },
  };
}

// ─────────────────────────────────────────────
// 共享工具函数
// ─────────────────────────────────────────────

/**
 * 将对话数据拼装为完整的学生对话记录文本，供嵌入到提示词中
 */
function buildDialogContents(
  conversations: Array<{
    userId: string;
    Message: Array<{ role: string; content: string }>;
    updatedAt: Date;
    user: { name: string } | null;
    presetConversationId?: string | null;
  }>,
  students: Array<{ id: string; name: string }>,
  allPCs: Array<{ id: string; title: string }>,
): string {
  const activeStudentIds = new Set(conversations.map((c) => c.userId));
  return Array.from(activeStudentIds)
    .map((uid) => {
      const convs = conversations.filter((c) => c.userId === uid);
      const student = students.find((s) => s.id === uid);
      const studentName = student?.name || "未知学生";
      const convTexts = convs
        .map((conv) => {
          const pcTitle =
            allPCs.find((pc) => pc.id === conv.presetConversationId)?.title || "未知活动";
          const msgs = conv.Message
            .map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`)
            .join("\n");
          return `【${pcTitle} - ${conv.updatedAt.toLocaleString()}】\n${msgs}`;
        })
        .join("\n\n");
      return `## ${studentName}\n${convTexts || "（无对话记录）"}`;
    })
    .join("\n\n");
}

/** 构建班级作业统计数据（班级层面汇总，每项作业一条统计） */
async function buildClassQuizStats(taskId: string, classId: string): Promise<string> {
  const subProjects = await prisma.subProject.findMany({
    where: { taskId },
    include: {
      QuizActivity: {
        include: {
          Question: { orderBy: { order: "asc" } },
          QuizAttempt: {
            where: { User: { classId } },
            include: { User: { select: { name: true } }, QuestionAttempt: true },
          },
        },
      },
    },
  });

  const parts: string[] = [];
  for (const sp of subProjects) {
    for (const qa of sp.QuizActivity) {
      if (qa.QuizAttempt.length === 0) continue;

      const total = qa.QuizAttempt.length;
      const avgScore = Math.round(qa.QuizAttempt.reduce((s, a) => s + a.score, 0) / total);

      // 各题正确率
      const questionStats = qa.Question.map((q) => {
        const answered = qa.QuizAttempt.flatMap((a) => a.QuestionAttempt.filter((ans) => ans.questionId === q.id));
        const correct = answered.filter((a) => a.isCorrect).length;
        return { content: q.content, difficulty: q.difficulty, rate: total > 0 ? Math.round((correct / total) * 100) : 0 };
      });

      // 薄弱题目（正确率<60%）
      const weakQuestions = questionStats.filter((q) => q.rate < 60).map((q) => `${q.content}（${q.rate}%）`).join("；");

      // 高低分段
      const highScorers = qa.QuizAttempt.filter((a) => a.score >= 90).map((a) => `${a.User.name}(${a.score}分)`).join("、");
      const lowScorers = qa.QuizAttempt.filter((a) => a.score < 60).map((a) => `${a.User.name}(${a.score}分)`).join("、");

      const lines = [
        `- 班级平均分：${avgScore}分`,
        `- 完成率：${total}人`,
        `- 各题正确率：${questionStats.map((q) => `${q.difficulty==='基础'?'基':'进'}${q.rate}%`).join("、") || "暂无数据"}`,
        weakQuestions ? `- 薄弱题目：${weakQuestions}` : null,
        highScorers ? `- 高分段：${highScorers}` : null,
        lowScorers ? `- 低分段：${lowScorers}` : null,
      ].filter(Boolean);

      parts.push(`### ${sp.title} - ${qa.title}\n${lines.join("\n")}`);
    }
  }

  return parts.length > 0
    ? `## 作业完成情况\n\n${parts.join("\n\n")}`
    : "";
}

/** 构建个人作业统计数据（该学生各次作业的明细成绩） */
async function buildPersonalQuizStats(taskId: string, classId: string, studentId: string): Promise<string> {
  const subProjects = await prisma.subProject.findMany({
    where: { taskId },
    include: {
      QuizActivity: {
        include: {
          QuizAttempt: {
            where: { userId: studentId },
            include: { User: { select: { name: true } } },
          },
        },
      },
    },
  });

  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { name: true } });
  const studentName = student?.name || "该学生";

  const parts: string[] = [];
  for (const sp of subProjects) {
    for (const qa of sp.QuizActivity) {
      const attempt = qa.QuizAttempt[0]; // 该学生该作业只有一条记录
      if (!attempt) continue;
      const pct = attempt.maxTotalScore && attempt.maxTotalScore > 0
        ? Math.round((Number(attempt.totalScore || attempt.score) / attempt.maxTotalScore) * 100)
        : attempt.score;
      parts.push(`### ${sp.title} - ${qa.title}\n${studentName}：${pct}分（${attempt.correctCount}/${attempt.totalQuestions}题正确）`);
    }
  }

  return parts.length > 0
    ? `## 作业完成情况\n\n${parts.join("\n\n")}`
    : "";
}