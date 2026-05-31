import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getAIConfig } from "@/lib/ai";
import { buildQuizGeneratePrompt, parseQuestionsFromAIResponse } from "@/lib/prompts/quiz";

/**
 * 预览模式：AI 生成题目但不写入数据库
 * 用于新建作业时，先预览 AI 生成的题目，确认后再保存
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const { subProjectId, title, description, quizDesignTemplateContent, taskId } = await req.json();
    if (!subProjectId) return new Response("缺少 subProjectId", { status: 400 });

    // 获取 subProject 和关联的 task
    const subProject = await prisma.subProject.findFirst({
      where: { id: subProjectId, task: { teacherId: String(payload.userId) } },
      include: {
        task: { include: { User: { select: { name: true } } } },
      },
    });
    if (!subProject) return new Response("学习活动不存在", { status: 404 });

    const task = subProject.task;
    const teacherName = task.User.name;

    // 解析知识库
    let knowledgeBases: Array<{ name: string; content: string }> = [];
    if (task.knowledgeBaseIds) {
      try {
        const kbIds = JSON.parse(task.knowledgeBaseIds) as string[];
        if (kbIds.length > 0) {
          const kbs = await prisma.knowledgeBase.findMany({
            where: { id: { in: kbIds }, teacherId: task.teacherId },
          });
          knowledgeBases = kbs.map((kb) => ({ name: kb.name, content: kb.content }));
        }
      } catch { /* ignore */ }
    }

    // 构建 prompt（必须传入模板内容，不再有硬编码默认）
    if (!quizDesignTemplateContent) {
      return new Response("缺少作业设计模板", { status: 400 });
    }
    const templateContent = quizDesignTemplateContent;


    const prompt = buildQuizGeneratePrompt(templateContent, {
      task: {
        title: task.title,
        grade: task.grade,
        subject: task.subject,
        objectives: task.objectives,
        knowledgeBase: task.knowledgeBase,
      },
      presetConv: { description: description || null },
      knowledgeBases,
      teacherName,
      quizCount: 5,
      convDescription: description || "",
      kbList: knowledgeBases && knowledgeBases.length > 0
        ? knowledgeBases.map((kb: any) => `【${kb.name}】：\n${kb.content}`).join("\n\n")
        : ""
    });

    const aiConfig = await getAIConfig();
    const aiResponse = await fetch(`${aiConfig.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50000,
      }),
    });

    let aiData;
    try {
      aiData = await aiResponse.json();
    } catch (e) {
      const rawText = await aiResponse.text();
      console.error("=== AI 响应不是 JSON ===", rawText.substring(0, 500));
      return NextResponse.json({
        message: "AI 响应格式错误",
        detail: rawText.substring(0, 200)
      }, { status: 500 });
    }

    if (!aiResponse.ok) {
      const err = aiData.error?.message || aiData.message || JSON.stringify(aiData);
      console.error("AI 出题失败:", err);
      return NextResponse.json({ message: "AI 出题失败：" + err }, { status: 500 });
    }

    const choice = aiData.choices?.[0];
    const message = choice?.message || {};

    if (message.refusal) {
      console.error("=== AI 拒绝回答 ===", message.refusal);
      return NextResponse.json({ message: "AI 拒绝了请求：" + message.refusal }, { status: 500 });
    }

    const rawContent = message.content || "";

    // 调试：打印 AI 返回的原始内容
    console.log("=== AI 返回原始内容 ===");
    console.log(rawContent.substring(0, 2000));

    let parsed;
    try {
      parsed = parseQuestionsFromAIResponse(rawContent);
      // 调试：打印解析后的题目
      console.log("=== 解析后的题目 ===");
      console.log(JSON.stringify(parsed, null, 2));
    } catch (parseErr: any) {
      const preview = rawContent.substring(0, 500);
      console.error("=== AI 返回内容解析失败 ===", preview);
      return NextResponse.json({
        message: "AI 返回格式错误：" + (parseErr?.message || "无法解析"),
        aiResponse: preview,
      }, { status: 500 });
    }

    // 只返回题目数据，不写入数据库
    return NextResponse.json({ questions: parsed, count: parsed.length });
  } catch (error: any) {
    console.error("生成作业题目失败:", error);
    return NextResponse.json({ message: error?.message || "生成失败" }, { status: 500 });
  }
}