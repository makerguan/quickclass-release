import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { generateText } from "ai";
import { aiQueue } from "@/lib/ai-queue";
import { getSubjectCompetencies } from "@/lib/subject-competencies";

/**
 * AI 优化/生成对话活动目标
 * POST /api/preset-conversations/optimize-objective
 * body: { taskTitle, grade, subject, conversationTitle, currentObjective? }
 *
 * - currentObjective 非空：优化模式（保留教师意图，改写得更有学科特点、更贴合学生水平）
 * - currentObjective 为空：生成模式（基于课堂信息 + 对话活动名称生成目标）
 *
 * 为什么不用 /api/tasks/generate-objectives：
 * 课堂目标接口强制按学科核心素养维度一一对应（条数=维度数），属于整节课目标。
 * 对话活动目标聚焦单次 AI 对话互动，不必套用整节课的维度约束，否则会出现
 * "为了凑维度而硬塞目标" 的违和结果。
 *
 * 📐 CONTRACT：返回字段统一为 { objective: string }；不返回多字段对象，避免前端歧义。
 * 🔗 RELATED：调用方在 src/app/teacher/tasks/page.tsx handleAIOptimizeConversationObjective。
 * ⛔ DO NOT ADD dimension-level validation here：对话活动目标不需要像课堂目标那样
 *    逐条校验素养维度，强行校验会限制 AI 对具体对话情境的表达。
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    const { taskTitle, grade, subject, conversationTitle, currentObjective } = body;

    if (!taskTitle || typeof taskTitle !== "string" || !taskTitle.trim()) {
      return NextResponse.json({ error: "课堂课题不能为空" }, { status: 400 });
    }
    if (!grade || typeof grade !== "string") {
      return NextResponse.json({ error: "年级不能为空" }, { status: 400 });
    }
    if (!subject || typeof subject !== "string") {
      return NextResponse.json({ error: "学科不能为空" }, { status: 400 });
    }
    if (!conversationTitle || typeof conversationTitle !== "string" || !conversationTitle.trim()) {
      return NextResponse.json({ error: "对话活动名称不能为空" }, { status: 400 });
    }

    const comp = getSubjectCompetencies(grade, subject);
    const isPreschool = comp?.stage === "学前教育";
    const learnerWord = isPreschool ? "幼儿" : "学生";
    const expertLine = isPreschool
      ? "你是一位资深的学前教育教研专家，精通《3-6岁儿童学习与发展指南》，擅长撰写符合幼儿年龄特点与发展规律的对话活动目标。"
      : "你是一位资深的中小学学科教研专家，精通《义务教育课程标准（2022年版）》和《普通高中课程标准（2017年版2020年修订）》，擅长撰写聚焦 AI 对话互动的学习活动目标。";

    const isOptimize = typeof currentObjective === "string" && currentObjective.trim().length > 0;

    // 可选：若存在学科素养映射，把维度清单作为背景知识注入，让输出更贴学科特点
    const competencyHint = comp
      ? `\n该学科${comp.stage}阶段的核心素养维度（供参考，不必一一对应）：\n${comp.competencies
          .map((c) => (c.meaning ? `- ${c.name}：${c.meaning}` : `- ${c.name}`))
          .join("\n")}\n`
      : "";

    const prompt = `${expertLine}

请为以下课堂中的 AI 对话活动${isOptimize ? "优化" : "生成"}活动目标。

课堂课题：${taskTitle.trim()}
年级：${grade}
学科：${subject}
对话活动名称：${conversationTitle.trim()}
${competencyHint}
${
  isOptimize
    ? `教师已写的目标初稿：
---
${currentObjective.trim()}
---
请在保留教师核心意图与教学设计思路的基础上进行优化：使表述更聚焦本次 AI 对话互动、更贴合${grade}${learnerWord}的认知水平、更具学科特点，同时保持简洁可评价。`
    : `请从零生成本次对话活动的学习目标。`
}

要求：
1. 目标聚焦本次 AI 对话互动，具体、可观察、可评价
2. 使用符合${grade}${learnerWord}认知发展水平的行为动词
3. 体现${subject}学科特点，避免空泛套话
4. 语言简洁，1-3 条即可；每条一句话，直接输出目标内容，不要输出任何额外解释`;

    const { chatModel } = await createDashScopeClient();

    const result = await aiQueue.enqueue(async () =>
      generateText({
        model: chatModel,
        system: isPreschool
          ? "你是一位专业的学前教育教研专家。输出应聚焦幼儿对话活动目标，简洁具体。"
          : "你是一位专业的中小学学科教研专家。输出应聚焦 AI 对话互动的学习目标，简洁具体。",
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: 4096,
      })
    );

    if (!result.text || !result.text.trim()) {
      return NextResponse.json({ error: "AI 未返回有效内容，请重试" }, { status: 500 });
    }

    return NextResponse.json({ objective: result.text.trim() });
  } catch (error) {
    console.error("优化对话活动目标失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 服务错误，请检查配置" },
      { status: 500 }
    );
  }
}
