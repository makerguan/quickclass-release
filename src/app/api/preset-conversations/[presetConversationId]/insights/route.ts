import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { generateText } from "ai";
import {
  ANALYST_SYSTEM,
  buildConversationClassPrompt,
  buildConversationStudentPrompt,
  type ConversationTemplateVars,
} from "@/lib/prompts";

// GET: 获取对话活动分析结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ presetConversationId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { presetConversationId } = await params;
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    if (!classId) return NextResponse.json({ error: "缺少 classId" }, { status: 400 });

    // 获取对话活动详情
    const pc = await prisma.presetConversation.findUnique({
      where: { id: presetConversationId },
      include: { SubProject: { include: { task: { select: { id: true, title: true, teacherId: true } } } } },
    });
    if (!pc) return NextResponse.json({ error: "对话活动不存在" }, { status: 404 });
    if (pc.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 获取分析结果：preset_conversation_class / preset_conversation_student
    // 查询班级分析（userId = null）和学生分析（userId = studentId）
    const [classInsights, studentInsightsRaw] = await Promise.all([
      prisma.aIInsight.findMany({
        where: { classId, type: "pc_class", scopeId: presetConversationId },
        orderBy: { version: "desc" },
      }),
      prisma.aIInsight.findMany({
        where: { classId, type: "pc_student", scopeId: presetConversationId },
        orderBy: { version: "desc" },
        include: { User: { select: { name: true } } },
      }),
    ]);

    // 学生分析：返回全部历史版本（按 userId 分组后前端展示版本切换）；
    // "已分析人数" 由前端根据 userId 去重计算
    const studentInsights: Array<{ id: string; userId: string; studentName: string; content: string; version: number; createdAt: string }> =
      studentInsightsRaw.map((ins) => ({
        id: ins.id,
        userId: ins.userId!,
        studentName: ins.User?.name || "未知",
        content: ins.content,
        version: ins.version,
        createdAt: ins.createdAt.toISOString(),
      }));

    // 解析星星数量
    const parseStarCount = (content: string): number => {
      const match = content.match(/★+/g);
      return match ? Math.max(...match.map((s) => s.length)) : 0;
    };

    // 获取学生在当前对话活动中的对话数
    const [students, pcConversations] = await Promise.all([
      prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
      prisma.conversation.findMany({
        where: { classId, presetConversationId: presetConversationId },
        select: { userId: true, id: true },
      }),
    ]);
    const studentConvCount = new Map<string, number>();
    for (const conv of pcConversations) {
      studentConvCount.set(conv.userId, (studentConvCount.get(conv.userId) || 0) + 1);
    }

    return NextResponse.json({
      presetConversation: {
        id: pc.id,
        title: pc.title,
        description: pc.description,
        analysisPrompt: pc.analysisPrompt,
      },
      subProject: {
        id: pc.SubProject.id,
        title: pc.SubProject.title,
        analysisPrompt: pc.SubProject.analysisPrompt,
      },
      task: {
        id: pc.SubProject.task.id,
        title: pc.SubProject.task.title,
      },
      students: students.map((s) => ({
        id: s.id,
        name: s.name,
        convCount: studentConvCount.get(s.id) || 0,
      })),
      classInsights: classInsights.map((ins) => ({
        id: ins.id,
        content: ins.content,
        version: ins.version,
        createdAt: ins.createdAt.toISOString(),
      })),
      studentInsights: studentInsights.map((si) => ({
        ...si,
        starCount: parseStarCount(si.content),
      })),
    });
  } catch (error) {
    console.error("Get PC insight error:", error);
    return NextResponse.json({ error: "获取失败", detail: error instanceof Error ? error.message : "服务器错误" }, { status: 500 });
  }
}

// POST: 生成对话活动分析
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ presetConversationId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { presetConversationId } = await params;
    const body = await req.json();
    const { classId, type, studentId, templateId, previewOnly } = body;

    if (!classId) return NextResponse.json({ error: "缺少 classId" }, { status: 400 });
    if (!["class", "student"].includes(type)) {
      return NextResponse.json({ error: "type 必须为 class 或 student" }, { status: 400 });
    }
    if (type === "student" && !studentId) {
      return NextResponse.json({ error: "学生分析需提供 studentId" }, { status: 400 });
    }

    // 获取对话活动及上下文
    const pc = await prisma.presetConversation.findUnique({
      where: { id: presetConversationId },
      include: { SubProject: { include: { task: { select: { id: true, title: true, teacherId: true, grade: true, subject: true } } } } },
    });
    if (!pc) return NextResponse.json({ error: "对话活动不存在" }, { status: 404 });
    if (pc.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 获取模板内容（备用，当 pc.analysisPrompt 字段为空时使用）
    let templateContent: string | null = null;
    if (templateId) {
      const template = await prisma.analysisTemplate.findUnique({ where: { id: templateId } });
      if (template) {
        templateContent = template.content;
      }
    }

    // 最终使用的提示词：班级分析用 classAnalysisPrompt，个人分析用 analysisPrompt
    const effectivePrompt = type === "class"
      ? (pc.classAnalysisPrompt || pc.analysisPrompt || templateContent)
      : (pc.analysisPrompt || templateContent);

    // 检测提示词是否为 HTML 格式（含 HTML 标签或图表指令）
    const isHtmlOutput = effectivePrompt ? (
      effectivePrompt.includes('<!DOCTYPE') ||
      effectivePrompt.includes('<html') ||
      effectivePrompt.includes('<div') ||
      effectivePrompt.includes('echarts') ||
      effectivePrompt.includes('ECharts') ||
      effectivePrompt.includes('chart') ||
      effectivePrompt.toLowerCase().includes('html')
    ) : false;

    const { chatModel } = await createDashScopeClient();

    // 获取系统配置（分析字数限制 + 星星评分）
    const systemConfig = await prisma.systemConfig.findFirst();
    const insightLevel = "STANDARD"; // 已从 SystemConfig 移除，提供默认值
    const studentWordLimit = systemConfig?.studentWordLimit ?? 100;
    const classWordLimit = systemConfig?.classWordLimit ?? 300;
    const starCount = 10; // 已从 SystemConfig 移除，提供默认值
    const requireStarRating = systemConfig?.requireStarRating ?? false;

    // 如果只是预览提示词，不调用 AI
    if (previewOnly) {
      let promptText: string;
      let dialogData = "";
      
      // 将 null 转换为 undefined 以符合函数签名
      const pcNormalized = {
        ...pc,
        subProject: {
          ...pc.SubProject,
          task: { ...pc.SubProject.task },
        },
      } as any;
      
      if (effectivePrompt) {
        if (type === "class") {
          promptText = await generatePCClassInsightWithTemplate(chatModel, pcNormalized, classId, effectivePrompt, { insightLevel, classWordLimit: classWordLimit ?? undefined, starCount }, true);
        } else {
          promptText = await generatePCStudentInsightWithTemplate(chatModel, pcNormalized, classId, studentId!, effectivePrompt, { insightLevel, studentWordLimit: studentWordLimit ?? undefined, classWordLimit: classWordLimit ?? undefined, starCount, requireStarRating }, true);
        }
      } else {
        if (type === "class") {
          promptText = await generatePCClassInsight(chatModel, pcNormalized, classId, null, {
            insightLevel, classWordLimit: classWordLimit ?? undefined, starCount
          }, true);
        } else {
          promptText = await generatePCStudentInsight(chatModel, pcNormalized, classId, studentId!, null, {
            insightLevel, studentWordLimit: studentWordLimit ?? undefined, starCount, requireStarRating
          }, true);
        }
      }
      // 查询对话数据供预览
      if (type === "class") {
        const [students, conversations] = await Promise.all([
          prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
          prisma.conversation.findMany({
            where: { classId, presetConversationId: pc.id },
            include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true }, take: 3 } },
            orderBy: { updatedAt: "desc" }, take: 50,
          }),
        ]);
        const uniqueStudents = new Set(conversations.map((c) => c.userId));
        dialogData = `对话活动：${pc.title}\n参与学生：${uniqueStudents.size}/${students.length}人\n总对话：${conversations.length}条\n\n`;
        const studentConvs = new Map<string, typeof conversations>();
        for (const c of conversations) {
          if (!studentConvs.has(c.userId)) studentConvs.set(c.userId, []);
          studentConvs.get(c.userId)!.push(c);
        }
        let idx = 0;
        for (const [uid, convs] of Array.from(studentConvs)) {
          if (idx >= 5) break;
          const s = students.find((s) => s.id === uid);
          dialogData += `## ${s?.name || "未知"}\n`;
          convs.slice(0, 3).forEach((conv) => {
            const msgs = conv.Message.map((m) => `${m.role === "user" ? "👤 学生" : "🤖 AI"}：${m.content.substring(0, 150)}`).join("\n");
            dialogData += `${msgs}\n\n`;
          });
          idx++;
        }
      } else {
        const [student, conversations] = await Promise.all([
          prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }),
          prisma.conversation.findMany({
            where: { classId, presetConversationId: pc.id, userId: studentId },
            include: { Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
            orderBy: { updatedAt: "desc" }, take: 10,
          }),
        ]);
        dialogData = `学生：${student?.name || "未知"}\n对话数：${conversations.length}\n\n`;
        dialogData += conversations.map((conv, i) => {
          const msgs = conv.Message.map((m) => `${m.role === "user" ? "👤 学生" : "🤖 AI"}：${m.content}`).join("\n");
          return `【对话 ${i + 1}】\n${msgs}`;
        }).join("\n\n---\n\n");
      }
      return NextResponse.json({ prompt: promptText, dialogData });
    }

    // 将 null 转换为 undefined 以符合函数签名
    const pcNormalized = {
      ...pc,
      subProject: {
        ...pc.SubProject,
        task: {
          ...pc.SubProject.task,
          grade: pc.SubProject.task.grade ?? undefined,
          subject: pc.SubProject.task.subject ?? undefined,
        },
      },
    } as any;

let content: string;

// 根据是否使用 analysisPrompt 字段选择不同的生成函数
    if (effectivePrompt) {
      // HTML 输出时跳过字数限制和格式约束
      const classConfig = { insightLevel, classWordLimit: isHtmlOutput ? 0 : classWordLimit, starCount, isHtmlOutput };
      const studentConfig = { insightLevel, studentWordLimit: isHtmlOutput ? undefined : studentWordLimit, classWordLimit: isHtmlOutput ? undefined : classWordLimit, starCount, requireStarRating };

      if (type === "class") {
        content = await generatePCClassInsightWithTemplate(chatModel, pcNormalized, classId, effectivePrompt, classConfig);
      } else {
        content = await generatePCStudentInsightWithTemplate(chatModel, pcNormalized, classId, studentId!, effectivePrompt, studentConfig);
      }
    } else {
      // 使用默认逻辑（无 analysisPrompt 字段内容）
      if (type === "class") {
        content = await generatePCClassInsight(chatModel, pcNormalized, classId, null, {
          insightLevel, classWordLimit: classWordLimit ?? undefined, starCount
        });
      } else {
        content = await generatePCStudentInsight(chatModel, pcNormalized, classId, studentId!, null, {
          insightLevel, studentWordLimit: studentWordLimit ?? undefined, classWordLimit: classWordLimit ?? undefined, starCount, requireStarRating
        });
      }
    }

    // 保存分析结果
    const insightType = type === "class" ? "pc_class" : "pc_student";
    const existing = await prisma.aIInsight.findFirst({
      where: {
        classId,
        type: insightType,
        scopeId: presetConversationId,
        ...(type === "student" ? { userId: studentId } : { userId: null }),
      },
      orderBy: { version: "desc" },
    });
    const version = (existing?.version || 0) + 1;

    const saved = await prisma.aIInsight.create({
      data: {
        type: insightType,
        classId,
        userId: type === "student" ? studentId : null,
        scopeId: presetConversationId,
        content,
        version,
      },
    });

    return NextResponse.json({ content, version, id: saved.id, previousContent: existing?.content || null, previousId: existing?.id || null });
  } catch (error) {
    console.error("Generate PC insight error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}

async function generatePCClassInsight(
  chatModel: unknown,
  pc: {
    id: string; title: string; description: string | null; analysisPrompt?: string | null;
    subProject: { id: string; title: string; objectives: string; requirements: string; knowledgeBase: string | null;
      task: { id: string; title: string; objectives: string; knowledgeBase: string | null; grade?: string; subject?: string } };
  },
  classId: string,
  templateContent: string | null,
  config: { insightLevel: string; classWordLimit: number; starCount: number },
  isPreview?: boolean
): Promise<string> {
  const taskInfo = { taskTitle: pc.subProject.task.title, taskObjectives: pc.subProject.task.objectives, grade: pc.subProject.task.grade ?? undefined, subject: pc.subProject.task.subject ?? undefined };
  const [students, conversations] = await Promise.all([
    prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, presetConversationId: pc.id },
      include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const activeStudents = conversations.map((c) => c.userId);
  const uniqueActiveStudents = new Set(activeStudents);

  // 拼接所有学生的完整对话内容
  const dialogContents = Array.from(uniqueActiveStudents).map((uid) => {
    const convs = conversations.filter((c) => c.userId === uid);
    const student = students.find((s) => s.id === uid);
    const studentName = student?.name || "未知学生";
    const convTexts = convs.map((conv) => {
      const msgs = conv.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`).join("\n");
      return `【对话${conv.updatedAt.toLocaleString()}】\n${msgs}`;
    }).join("\n\n");
    return `## ${studentName}
${convTexts || "（无对话记录）"}`;
  }).join("\n\n");

  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : (pc.analysisPrompt ? `## 教师自定义分析要求\n${pc.analysisPrompt}` : undefined);

  const prompt = buildConversationClassPrompt({
    pcTitle: pc.title,
    pcDescription: pc.description ?? undefined,
    spTitle: pc.subProject.title,
    spObjectives: pc.subProject.objectives,
    spRequirements: pc.subProject.requirements,
    activeCount: uniqueActiveStudents.size,
    totalStudents: students.length,
    dialogContents,
    customSection,
    taskInfo,
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

// 模板驱动版本的班级分析
async function generatePCClassInsightWithTemplate(
  chatModel: unknown,
  pc: {
    id: string; title: string; description: string | null;
    subProject: { id: string; title: string; objectives: string; requirements: string;
      task?: { id: string; title: string; objectives: string; requirements: string; grade?: string; subject?: string } };
  },
  classId: string,
  templateContent: string,
  config: { insightLevel: string; classWordLimit: number; starCount: number },
  isPreview?: boolean
): Promise<string> {
  const taskInfo = pc.subProject.task ? { taskTitle: pc.subProject.task.title, taskObjectives: pc.subProject.task.objectives, grade: pc.subProject.task.grade ?? undefined, subject: pc.subProject.task.subject ?? undefined } : undefined;
  const [students, conversations] = await Promise.all([
    prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, presetConversationId: pc.id },
      include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const uniqueActiveStudents = new Set(conversations.map((c) => c.userId));

  const dialogContents = Array.from(uniqueActiveStudents).map((uid) => {
    const convs = conversations.filter((c) => c.userId === uid);
    const student = students.find((s) => s.id === uid);
    const studentName = student?.name || "未知学生";
    const convTexts = convs.map((conv) => {
      const msgs = conv.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`).join("\n");
      return `【对话${conv.updatedAt.toLocaleString()}】\n${msgs}`;
    }).join("\n\n");
    return `## ${studentName}\n${convTexts || "（无对话记录）"}`;
  }).join("\n\n");

  // 始终构建包含完整数据段的提示词，模板内容作为 customSection 追加
  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : undefined;

  const finalPrompt = buildConversationClassPrompt({
    pcTitle: pc.title,
    pcDescription: pc.description ?? undefined,
    spTitle: pc.subProject.title,
    spObjectives: pc.subProject.objectives,
    spRequirements: pc.subProject.requirements,
    activeCount: uniqueActiveStudents.size,
    totalStudents: students.length,
    dialogContents,
    customSection,
    taskInfo,
    config,
  });

  if (isPreview) return finalPrompt;

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel as Parameters<typeof generateText>[0]["model"],
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: finalPrompt }],
    })
  );
  return result.text;
}

async function generatePCStudentInsight(
  chatModel: unknown,
  pc: {
    id: string; title: string; description: string | null; analysisPrompt?: string | null;
    subProject: { id: string; title: string; objectives: string; requirements: string; knowledgeBase: string | null;
      task: { id: string; title: string; objectives: string; knowledgeBase: string | null; grade?: string; subject?: string } };
  },
  classId: string,
  studentId: string,
  templateContent: string | null,
  config: { insightLevel?: string; studentWordLimit?: number | null; classWordLimit?: number | null; starCount?: number; requireStarRating?: boolean },
  isPreview?: boolean
): Promise<string> {
  const taskInfo = { taskTitle: pc.subProject.task.title, taskObjectives: pc.subProject.task.objectives, grade: pc.subProject.task.grade ?? undefined, subject: pc.subProject.task.subject ?? undefined };
  const [student, conversations] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, presetConversationId: pc.id, userId: studentId },
      include: { Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!student) throw new Error("学生不存在");

  const dialogContent = conversations.map((conv, i) => {
    const msgs = conv.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`).join("\n");
    return `对话${i + 1}：\n${msgs}`;
  }).join("\n\n");

  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : (pc.analysisPrompt ? `## 教师自定义分析要求\n${pc.analysisPrompt}` : undefined);

  const prompt = buildConversationStudentPrompt({
    pcTitle: pc.title,
    pcDescription: pc.description ?? undefined,
    spTitle: pc.subProject.title,
    spObjectives: pc.subProject.objectives,
    spRequirements: pc.subProject.requirements,
    studentName: student.name,
    dialogContent,
    customSection,
    taskInfo,
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

// 模板驱动版本的学生分析
async function generatePCStudentInsightWithTemplate(
  chatModel: unknown,
  pc: {
    id: string; title: string; description: string | null;
    subProject: { id: string; title: string; objectives: string; requirements: string;
      task?: { id: string; title: string; objectives: string; requirements: string; grade?: string; subject?: string } };
  },
  classId: string,
  studentId: string,
  templateContent: string,
  config: { insightLevel?: string; studentWordLimit?: number | null; classWordLimit?: number | null; starCount?: number; requireStarRating?: boolean },
  isPreview?: boolean
): Promise<string> {
  const taskInfo = pc.subProject.task ? { taskTitle: pc.subProject.task.title, taskObjectives: pc.subProject.task.objectives, grade: pc.subProject.task.grade ?? undefined, subject: pc.subProject.task.subject ?? undefined } : undefined;
  const [student, conversations] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { classId, presetConversationId: pc.id, userId: studentId },
      include: { Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!student) throw new Error("学生不存在");

  const dialogContent = conversations.map((conv, i) => {
    const msgs = conv.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`).join("\n");
    return `对话${i + 1}：\n${msgs}`;
  }).join("\n\n");

  // 始终构建包含完整数据段的提示词，模板内容作为 customSection 追加
  const customSection = templateContent
    ? `## 教师自定义分析模板\n${templateContent}`
    : undefined;

  const finalPrompt = buildConversationStudentPrompt({
    pcTitle: pc.title,
    pcDescription: pc.description ?? undefined,
    spTitle: pc.subProject.title,
    spObjectives: pc.subProject.objectives,
    spRequirements: pc.subProject.requirements,
    studentName: student.name,
    dialogContent,
    customSection,
    taskInfo,
    config,
  });

  if (isPreview) return finalPrompt;

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel as Parameters<typeof generateText>[0]["model"],
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: finalPrompt }],
    })
  );
  return result.text;
}
