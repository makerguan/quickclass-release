import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { generateText } from "ai";
import { ANALYST_SYSTEM, getWordLimitPrompt } from "@/lib/prompts";

// GET: 获取班级的学情洞察数据（任务级洞察 + 学生洞察）
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    const type = searchParams.get("type");
    const scopeId = searchParams.get("scopeId");
    if (!classId) return NextResponse.json({ error: "缺少 classId" }, { status: 400 });

    // 如果是查询指定 type 的洞察，直接返回
    if (type && scopeId) {
      const insights = await prisma.aIInsight.findMany({
        where: { classId, type, scopeId },
        orderBy: { version: "desc" },
        take: 1,
      });
      return NextResponse.json({
        explorationReport: insights.length > 0
          ? { content: insights[0].content, version: insights[0].version, createdAt: insights[0].createdAt }
          : null,
      });
    }

    // 验证权限
    if (payload.role === "TEACHER") {
      const cls = await prisma.class.findFirst({
        where: { id: classId, teacherId: String(payload.userId) },
      });
      if (!cls) return NextResponse.json({ error: "无权限" }, { status: 403 });
    } else {
      // 学生只能查看自己班级的数据
      const user = await prisma.user.findUnique({ where: { id: String(payload.userId) } });
      if (!user || user.classId !== classId) {
        return NextResponse.json({ error: "无权限" }, { status: 403 });
      }
    }

    // 获取班级洞察（如果有）
    const classInsights = await prisma.aIInsight.findMany({
      where: { classId, type: "class", userId: null },
      orderBy: { version: "desc" },
      take: 5,
    });
    const latestClassInsight = classInsights[0] || null;

    // 获取任务级洞察 - 从任务分配中获取任务洞察
    const taskInsights: Array<{
      id: string;
      taskId: string;
      taskTitle: string;
      content: string;
      version: number;
      createdAt: string;
    }> = [];

    // 获取已分配给此班级的任务
    const assignments = await prisma.taskAssignment.findMany({
      where: { classId },
      include: {
        task: { select: { id: true, title: true } },
      },
    });

    for (const assignment of assignments) {
      // 检查是否有任务级的洞察
      const insights = await prisma.aIInsight.findMany({
        where: {
          classId,
          type: "task_class",
          scopeId: assignment.taskId,
        },
        orderBy: { version: "desc" },
        take: 1,
      });
      if (insights.length > 0) {
        taskInsights.push({
          id: insights[0].id,
          taskId: assignment.taskId,
          taskTitle: assignment.task.title,
          content: insights[0].content,
          version: insights[0].version,
          createdAt: insights[0].createdAt.toISOString(),
        });
      }
    }

    // 获取学生洞察
    const studentInsights = await prisma.aIInsight.findMany({
      where: { classId, type: "student" },
      orderBy: { version: "desc" },
      include: { User: { select: { name: true } } },
    });

    // 每个学生只取最新版本
    const latestStudentInsights: Array<{
      id: string;
      userId: string;
      studentName: string;
      content: string;
      version: number;
      createdAt: string;
    }> = [];
    const seenUsers = new Set<string>();
    for (const insight of studentInsights) {
      if (!seenUsers.has(insight.userId!)) {
        seenUsers.add(insight.userId!);
        latestStudentInsights.push({
          id: insight.id,
          userId: insight.userId!,
          studentName: insight.User?.name || "未知",
          content: insight.content,
          version: insight.version,
          createdAt: insight.createdAt.toISOString(),
        });
      }
    }

    return NextResponse.json({
      taskInsights,
      studentInsights: latestStudentInsights,
      classSummary: latestClassInsight?.content || "",
    });
  } catch (error) {
    console.error("Get class summary error:", error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}

// POST: 生成班级学情汇总
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    const { classId, previewOnly } = body;
    if (!classId) return NextResponse.json({ error: "缺少 classId" }, { status: 400 });

    // 验证权限
    const cls = await prisma.class.findFirst({
      where: { id: classId, teacherId: String(payload.userId) },
    });
    if (!cls) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { chatModel } = await createDashScopeClient();

    // 获取系统配置（分析字数限制）
    const systemConfig = await prisma.systemConfig.findFirst();
    const insightLevel = "STANDARD"; // 已从 SystemConfig 移除，提供默认值
    const classWordLimit = systemConfig?.classWordLimit ?? 1000;
    const starCount = 10; // 已从 SystemConfig 移除，提供默认值

    // 根据系统配置的 insightDataSource 决定数据来源
    const dataSource = systemConfig?.insightDataSource || "CONVERSATIONS";

    // 如果只是预览提示词，不调用 AI
    if (previewOnly) {
      let promptText: string;
      if (dataSource === "TASK_INSIGHTS") {
        promptText = await generateSummaryFromTaskInsights(chatModel, classId, { insightLevel, classWordLimit, starCount }, true);
      } else {
        promptText = await generateSummaryFromConversations(chatModel, classId, { insightLevel, classWordLimit, starCount }, true);
      }
      // 查询对话数据供预览
      let dialogData = "";
      const [students, conversations] = await Promise.all([
        prisma.user.findMany({ where: { classId, role: "STUDENT" }, select: { id: true, name: true } }),
        prisma.conversation.findMany({
          where: { classId },
          include: { User: { select: { name: true } }, Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true }, take: 3 } },
          orderBy: { updatedAt: "desc" }, take: 30,
        }),
      ]);
      const activeStudents = new Set(conversations.map((c) => c.userId));
      if (dataSource === "TASK_INSIGHTS") {
        dialogData = `数据来源设置为「仅使用任务分析结果」，不直接分析原始对话。\n`;
      }
      dialogData += `参与学生：${activeStudents.size}/${students.length}人\n\n`;
      dialogData += conversations.slice(0, 10).map((c) => {
        const msgs = c.Message.map((m) => `${m.role === "user" ? "👤 学生" : "🤖 AI"}：${m.content.substring(0, 150)}`).join("\n");
        return `${c.user?.name || "未知"}：\n${msgs}`;
      }).join("\n\n---\n\n");
      return NextResponse.json({ prompt: promptText, dialogData });
    }

    let summary = "";

    if (dataSource === "TASK_INSIGHTS") {
      // 使用任务级分析结果
      summary = await generateSummaryFromTaskInsights(chatModel, classId, { insightLevel, classWordLimit, starCount });
    } else {
      // 使用原始对话数据
      summary = await generateSummaryFromConversations(chatModel, classId, { insightLevel, classWordLimit, starCount });
    }

    // 获取当前最大版本号
    const existingInsight = await prisma.aIInsight.findFirst({
      where: { classId, type: "class", userId: null },
      orderBy: { version: "desc" },
    });
    const version = (existingInsight?.version || 0) + 1;

    // 保存分析结果
    await prisma.aIInsight.create({
      data: { type: "class", classId, content: summary, version },
    });

    return NextResponse.json({ summary, version });
  } catch (error) {
    console.error("Generate class summary error:", error);
    return NextResponse.json({ error: "生成失败" }, { status: 500 });
  }
}

// 从任务级洞察生成班级汇总
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateSummaryFromTaskInsights(chatModel: any, classId: string, config: { insightLevel: string; classWordLimit: number; starCount: number }, isPreview?: boolean): Promise<string> {
  // 获取任务分配
  const assignments = await prisma.taskAssignment.findMany({
    where: { classId },
    include: {
      task: { select: { id: true, title: true, objectives: true } },
    },
  });

  // 收集每个任务的洞察
  const taskInsightsData: Array<{ taskTitle: string; objectives: string; content: string }> = [];

  for (const assignment of assignments) {
    const insights = await prisma.aIInsight.findMany({
      where: { classId, type: "task_class", scopeId: assignment.taskId },
      orderBy: { version: "desc" },
      take: 1,
    });
    if (insights.length > 0) {
      taskInsightsData.push({
        taskTitle: assignment.task.title,
        objectives: assignment.task.objectives,
        content: insights[0].content,
      });
    }
  }

  const prompt = `${ANALYST_SYSTEM}请基于以下各任务的学情分析结果，生成班级整体学情洞察报告。

## 数据来源说明
本班级已配置为「仅使用任务分析结果」，不采集学生原始对话。以下分析基于各任务已生成的班级学情分析。

## 任务学情分析
${taskInsightsData.length > 0
    ? taskInsightsData.map((t) => `### ${t.taskTitle}
任务目标：${t.objectives}
分析结果：
${t.content}`).join("\n\n")
    : "暂无任务级学情分析结果"}

---

请按以下格式输出班级整体学情洞察报告：

### 一、班级学情总览
概括班级在各任务中的整体学习状态和表现。

### 二、共性特征分析
分析学生在各任务中表现出的共性特点、优势和薄弱环节。

### 三、差异分析
指出不同任务中学生表现的差异，分析原因。

### 四、教学建议
基于任务分析结果，给出班级整体的教学改进建议。

注意：用中文回答，语言专业且有建设性。

${getWordLimitPrompt("class", config)}`;
  if (isPreview) return prompt;
  const result = await aiQueue.enqueue(async () => {
    return generateText({
      model: chatModel,
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
  });

  return result.text;
}

// 从原始对话数据生成班级汇总
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateSummaryFromConversations(chatModel: any, classId: string, config: { insightLevel: string; classWordLimit: number; starCount: number }, isPreview?: boolean): Promise<string> {
  const [students, conversations] = await Promise.all([
    prisma.user.findMany({
      where: { classId, role: "STUDENT" },
      select: { id: true, name: true },
    }),
    prisma.conversation.findMany({
      where: { classId, presetConversationId: { not: null } },
      include: {
        User: { select: { name: true } },
        Message: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const studentConvMap = new Map<string, { name: string; convCount: number; msgCount: number; topics: string[] }>();
  for (const s of students) {
    studentConvMap.set(s.id, { name: s.name, convCount: 0, msgCount: 0, topics: [] });
  }
  for (const conv of conversations) {
    const info = studentConvMap.get(conv.userId);
    if (info) {
      info.convCount++;
      info.msgCount += conv.Message.length;
      info.topics.push(conv.title);
    }
  }

  const studentDialogSummaries = Array.from(studentConvMap.values())
    .filter((s) => s.convCount > 0)
    .map((s) => `${s.name}：${s.convCount}次对话，${s.msgCount}条消息，话题：${s.topics.join("、")}`);

  const recentQuestions = conversations
    .flatMap((c) =>
      c.Message
        .filter((m) => m.role === "user")
        .map((m) => ({ student: c.User.name, question: m.content }))
    )
    .slice(0, 15)
    .map((q) => `${q.student}：${q.question.substring(0, 80)}`)
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

  const prompt = `${ANALYST_SYSTEM}请基于以下班级学情数据，生成详细的班级学情洞察报告。

## 数据来源说明
本班级已配置为「采集原始对话数据」，以下分析基于学生的真实对话记录。

## 班级基本情况
- 学生人数：${students.length}人
- 有对话记录的学生：${studentDialogSummaries.length}人

## 学生对话情况
${studentDialogSummaries.length > 0 ? studentDialogSummaries.join("\n") : "暂无对话记录"}

## 学生近期提问内容
${recentQuestions || "暂无提问记录"}

## 学生对话记录（完整）
${dialogContents || "暂无对话记录"}

---

请按以下格式输出班级整体学情洞察报告：

### 一、班级学情总览
概括班级整体学习状态和活跃度。

### 二、学习热点分析
根据学生对话内容和提问，分析学生最关注的知识点和常见困惑。

### 三、学生参与度分析
分析不同学生的参与情况，识别积极参与和需要关注的学生。

### 四、教学建议
给出具体可操作的教学改进建议。

注意：用中文回答，语言专业且亲切。分析要基于对话数据，给出有针对性的见解。

${getWordLimitPrompt("class", config)}`;

  if (isPreview) return prompt;

  const result = await aiQueue.enqueue(async () => {
    return generateText({
      model: chatModel,
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
  });

  return result.text;
}


