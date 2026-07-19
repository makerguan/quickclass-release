import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { generateText } from "ai";
import { ANALYST_SYSTEM, buildBasicClassPrompt, buildBasicStudentPrompt } from "@/lib/prompts";

/** 将 Prisma PascalCase 关系字段映射为前端期望的字段名 */
function mapConversation(c: Record<string, unknown>) {
  const { User, Message, ...rest } = c;
  return { ...rest, user: User, messages: Message };
}

// GET: 获取已保存的洞察
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    const type = searchParams.get("type"); // "class" | "student"
    const studentId = searchParams.get("studentId");

    // 学生只能查看自己的洞察
    if (payload.role === "STUDENT") {
      const insights = await prisma.aIInsight.findMany({
        where: { userId: String(payload.userId), type: "student" },
        orderBy: { version: "desc" },
      });
      return NextResponse.json(insights);
    }

    // 教师查看班级/学生洞察
    if (payload.role === "TEACHER" && classId) {
      const cls = await prisma.class.findFirst({
        where: { id: classId, teacherId: String(payload.userId) },
      });
      if (!cls) return NextResponse.json({ error: "无权限" }, { status: 403 });

      const where: Record<string, unknown> = { classId };
      if (type) where.type = type;
      if (studentId) where.userId = studentId;

      const insights = await prisma.aIInsight.findMany({
        where,
        orderBy: { version: "desc" },
        include: studentId ? { User: { select: { name: true } } } : undefined,
      });
      return NextResponse.json(insights);
    }

    return NextResponse.json([]);
  } catch (error) {
    console.error("Get insights error:", error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}

// POST: 生成新的 AI 分析
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    const { classId, type, studentId, analyzeAll, previewOnly } = body;

    // 确保教师只能分析自己班级的数据
    if (classId) {
      const cls = await prisma.class.findFirst({
        where: { id: classId, teacherId: String(payload.userId) },
      });
      if (!cls) return NextResponse.json({ error: "无权限访问该班级" }, { status: 403 });
    }

    const { chatModel } = await createDashScopeClient();

    const systemConfig = await prisma.systemConfig.findFirst();
    const config = {
      insightLevel: "STANDARD", // 已从 SystemConfig 移除，提供默认值
      studentWordLimit: systemConfig?.studentWordLimit ?? 300,
      classWordLimit: systemConfig?.classWordLimit ?? 1000,
      starCount: 10, // 已从 SystemConfig 移除，提供默认值
    };

    // 如果只是预览提示词，不调用 AI
    if (previewOnly && type === "class" && classId) {
      const promptText = await generateInsight(chatModel, "class", classId, undefined, config, true);
      // 查询班级对话概览
      const [students, conversations] = await Promise.all([
        prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
        prisma.conversation.findMany({
          where: { classId },
          include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true }, take: 3 } },
          orderBy: { updatedAt: "desc" }, take: 30,
        }),
      ]);
      const activeStudents = new Set(conversations.map((c) => c.userId));
      let dialogData = `参与学生：${activeStudents.size}/${students.length}人\n\n`;
      dialogData += conversations.slice(0, 10).map((c) => {
        const msgs = c.Message.map((m: { role: string; content: string }) => `${m.role === "user" ? "👤 学生" : "🤖 AI"}：${m.content.substring(0, 150)}`).join("\n");
        return `${c.User?.name || "未知"}：\n${msgs}`;
      }).join("\n\n---\n\n");
      return NextResponse.json({ prompt: promptText, dialogData });
    }
    if (previewOnly && type === "student" && studentId && classId) {
      const promptText = await generateInsight(chatModel, "student", classId, studentId, config, true);
      // 查询该学生的对话记录
      const [student, rawConversations] = await Promise.all([
        prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }),
        prisma.conversation.findMany({
          where: { userId: studentId, classId },
          include: { Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
          orderBy: { updatedAt: "desc" }, take: 5,
        }),
      ]);
      const conversations = rawConversations.map(mapConversation);
      let dialogData = `学生：${student?.name || "未知"}\n对话数：${conversations.length}\n\n`;
      dialogData += (conversations as Array<{ user: { name: string } | null; messages: { role: string; content: string }[]; title?: string }>).map((conv, i) => {
        const msgs = conv.messages.map((m: { role: string; content: string }) => `${m.role === "user" ? "👤 学生" : "🤖 AI"}：${m.content.substring(0, 200)}`).join("\n");
        return `【对话 ${i + 1}】${conv.title || ""}\n${msgs}`;
      }).join("\n\n---\n\n");
      return NextResponse.json({ prompt: promptText, dialogData });
    }

    // 全班分析：为班级+每个有对话的学生都生成分析
    if (analyzeAll && classId) {
      const students = await prisma.user.findMany({
        where: { classId, role: "STUDENT" },
        select: { id: true, name: true },
      });

      const conversations = await prisma.conversation.findMany({
        where: { classId },
        select: { userId: true },
      });

      const studentsWithConv = new Set(conversations.map((c) => c.userId));

      // 先生成班级洞察
      const classInsight = await generateInsight(chatModel, "class", classId, undefined, config);

      // 获取当前最大版本号
      const existingClassInsight = await prisma.aIInsight.findFirst({
        where: { classId, type: "class", userId: null },
        orderBy: { version: "desc" },
      });
      const classVersion = (existingClassInsight?.version || 0) + 1;

      await prisma.aIInsight.create({
        data: { type: "class", classId, content: classInsight, version: classVersion },
      });

      // 为每个有对话的学生生成洞察
      const results: { studentId: string; studentName: string; success: boolean }[] = [];
      for (const student of students) {
        if (!studentsWithConv.has(student.id)) continue;
        try {
          const content = await generateInsight(chatModel, "student", classId, student.id, config);

          const existingStudentInsight = await prisma.aIInsight.findFirst({
            where: { classId, type: "student", userId: student.id },
            orderBy: { version: "desc" },
          });
          const studentVersion = (existingStudentInsight?.version || 0) + 1;

          await prisma.aIInsight.create({
            data: { type: "student", classId, userId: student.id, content, version: studentVersion },
          });

          results.push({ studentId: student.id, studentName: student.name, success: true });
        } catch {
          results.push({ studentId: student.id, studentName: student.name, success: false });
        }
      }

      return NextResponse.json({
        message: "全班分析完成",
        classVersion,
        classInsight,
        studentResults: results,
      });
    }

    // 单个分析（班级或学生）
    if (type === "class" && classId) {
      const content = await generateInsight(chatModel, "class", classId, undefined, config);
      const existing = await prisma.aIInsight.findFirst({
        where: { classId, type: "class", userId: null },
        orderBy: { version: "desc" },
      });
      const version = (existing?.version || 0) + 1;

      await prisma.aIInsight.create({
        data: { type: "class", classId, content, version },
      });

      return NextResponse.json({ content, version, previousContent: existing?.content || null });
    }

    if (type === "student" && studentId && classId) {
      const content = await generateInsight(chatModel, "student", classId, studentId, config);
      const existing = await prisma.aIInsight.findFirst({
        where: { classId, type: "student", userId: studentId },
        orderBy: { version: "desc" },
      });
      const version = (existing?.version || 0) + 1;

      await prisma.aIInsight.create({
        data: { type: "student", classId, userId: studentId, content, version },
      });

      return NextResponse.json({ content, version, previousContent: existing?.content || null });
    }

    return NextResponse.json({ error: "请提供有效的分析参数" }, { status: 400 });
  } catch (error) {
    console.error("AI analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    );
  }
}

// 生成洞察的核心函数（非流式，便于保存）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateInsight(
  chatModel: any,
  type: "class" | "student",
  classId: string,
  studentId: string | undefined,
  config: { insightLevel: string; studentWordLimit: number; classWordLimit: number },
  isPreview?: boolean,
): Promise<string> {
  if (type === "class") {
    const [students, conversations, attempts, evaluations] = await Promise.all([
      prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
      prisma.conversation.findMany({
        where: { classId, presetConversationId: { not: null } },
        include: {
          User: { select: { name: true } },
          Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.exerciseAttempt.findMany({
        where: { Exercise: { classId } },
        include: { Exercise: true, User: { select: { name: true } } },
      }),
      prisma.evaluation.findMany({ where: { classId }, include: { User: { select: { name: true } } } }),
    ]);

    const totalAttempts = attempts.length;
    const correctAttempts = attempts.filter((a) => a.isCorrect).length;
    const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0;

    const studentConvMap = new Map<string, { name: string; convCount: number; msgCount: number; topics: string[] }>();
    for (const s of students) studentConvMap.set(s.id, { name: s.name, convCount: 0, msgCount: 0, topics: [] });
    for (const conv of conversations) {
      const info = studentConvMap.get(conv.userId);
      if (info) { info.convCount++; info.msgCount += conv.Message.length; info.topics.push(conv.title); }
    }

    const studentDialogSummaries = Array.from(studentConvMap.values())
      .filter((s) => s.convCount > 0)
      .map((s) => `${s.name}：${s.convCount}次对话，${s.msgCount}条消息，话题：${s.topics.join("、")}`);

    const recentQuestions = conversations
      .flatMap((c) => c.Message.filter((m) => m.role === "user").map((m) => ({ student: c.User.name, question: m.content })))
      .slice(0, 20)
      .map((q) => `${q.student}：${q.question.substring(0, 60)}`)
      .join("\n");

    const studentEvalMap = new Map<string, { name: string; scores: Record<string, number> }>();
    for (const ev of evaluations) {
      if (!studentEvalMap.has(ev.userId)) {
        const student = students.find((s) => s.id === ev.userId);
        studentEvalMap.set(ev.userId, { name: student?.name || "未知", scores: {} });
      }
      studentEvalMap.get(ev.userId)!.scores[ev.dimension] = ev.score;
    }
    const evalSummary = Array.from(studentEvalMap.values())
      .map((s) => `${s.name}：${Object.entries(s.scores).map(([d, v]) => `${d}${v}分`).join("，")}`)
      .join("\n");

    // 拼接所有学生的完整对话内容
    const activeStudentIds = new Set(conversations.map((c) => c.userId));
    const dialogContents = Array.from(activeStudentIds).map((uid) => {
      const convs = conversations.filter((c) => c.userId === uid);
      const student = students.find((s) => s.id === uid);
      const studentName = student?.name || "未知学生";
      const convTexts = convs.map((conv) => {
        const msgs = conv.Message.map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`).join("\n");
        return `【对话${conv.updatedAt.toLocaleString()}】\n${msgs}`;
      }).join("\n\n");
      return `## ${studentName}\n${convTexts || "（无对话记录）"}`;
    }).join("\n\n");

    const prompt = buildBasicClassPrompt({
      students: Array.from(studentConvMap.values()),
      recentQuestions,
      totalAttempts,
      accuracy,
      evalSummary,
      dialogContents,
      config,
    });

    if (isPreview) return prompt;

    const result = await aiQueue.enqueue(async () =>
      generateText({
        model: chatModel,
        system: ANALYST_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      })
    );
    return result.text;
  }

  // type === "student"
  const [student, conversations, attempts, evaluations] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true } }),
    prisma.conversation.findMany({
      where: { userId: studentId, classId },
      include: { Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.exerciseAttempt.findMany({ where: { userId: studentId }, include: { Exercise: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.evaluation.findMany({ where: { userId: studentId, classId }, orderBy: { createdAt: "desc" } }),
  ]);

  const totalAttempts = attempts.length;
  const correctAttempts = attempts.filter((a) => a.isCorrect).length;
  const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0;

  const dialogSummaries = conversations.map((conv, i) => {
    const messages = conv.Message
      .map((m) => `${m.role === "user" ? "学生" : "AI"}：${m.content}`)
      .join("\n");
    return `对话${i + 1}（${conv.title}）：\n${messages}`;
  }).join("\n\n");

  const evalInfo = evaluations.map((e) => `${e.dimension}：${e.score}分${e.feedback ? `，${e.feedback}` : ""}`).join("\n");
  const attemptDetails = attempts.slice(0, 5).map((a) => `- 题目：${a.Exercise.question.substring(0, 40)}... ${a.isCorrect ? "✓正确" : "✗错误"}`).join("\n");

  const previousInsight = await prisma.aIInsight.findFirst({
    where: { classId, type: "student", userId: studentId },
    orderBy: { version: "desc" },
  });

  const prompt = buildBasicStudentPrompt({
    studentName: student?.name ?? "未知",
    dialogSummaries,
    totalAttempts,
    accuracy,
    attemptDetails,
    evalInfo,
    historyContent: previousInsight?.content.substring(0, 800),
    config,
  });

  if (isPreview) return prompt;

  const result = await aiQueue.enqueue(async () =>
    generateText({
      model: chatModel,
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    })
  );
  return result.text;
}
