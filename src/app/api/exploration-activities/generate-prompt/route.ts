import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// POST: 根据课堂信息自动生成互动网页设计提示词
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const { subProjectId } = await req.json();
    if (!subProjectId) return new Response("缺少 subProjectId", { status: 400 });

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: {
        task: {
          select: {
            title: true,
            description: true,
            objectives: true,
            knowledgeBase: true,
            knowledgeBaseIds: true,
          },
        },
      },
    });
    if (!sp || sp.task.title === undefined) {
      return new Response("未找到课堂", { status: 404 });
    }

    // 收集知识库内容
    let knowledgeContent = "";
    if (sp.task.knowledgeBaseIds) {
      try {
        const kbIds = JSON.parse(sp.task.knowledgeBaseIds) as string[];
        if (kbIds.length > 0) {
          const kbs = await prisma.knowledgeBase.findMany({
            where: { id: { in: kbIds } },
            select: { content: true },
          });
          knowledgeContent = kbs.map((kb) => kb.content).join("\n\n");
        }
      } catch { /* ignore */ }
    }

    const { chatModel } = await createDashScopeClient();
    const { generateText } = await import("ai");

    const result = await generateText({
      model: chatModel,
      system: `你是一位专业的互动教育网页设计师。根据提供的课堂信息，设计一个适合学生自主学习或互动的网页探究活动。

请同时输出：
1. **探究标题**（15字以内，简明扼要，如"方程概念探究"、"移项法则挑战"）
2. **互动设计提示词**（详细描述网页的：主题场景、互动机制、视觉风格、具体内容、反馈方式）

要求：
- 提示词能引导 AI 生成完整、可在浏览器中运行的 HTML5 互动网页
- 网页必须包含内联 CSS 和 JavaScript，不依赖外部资源
- 设计要有趣味性，适合初中生
- 可包含：互动填空、拖拽排序、选择题、即时反馈、游戏化挑战等元素
- 页面美观、配色清晰、有动画效果
- 生成后可直接在 iframe 中运行

输出格式：
标题：<你的标题>
---
提示词：<你的详细提示词>`,
      prompt: `课堂主题：${sp.task.title}
课堂目标：${sp.task.description || sp.task.objectives || "无"}
知识库内容：${knowledgeContent || "无"}`,
    });

    // 解析 AI 返回的标题和提示词
    const text = result.text;
    const titleMatch = text.match(/标题[：:]\s*(.+?)(?:\n|---|$)/);
    const promptMatch = text.match(/提示词[：:]\s*([\s\S]+)/);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 50) : sp.task.title + "探究";
    const prompt = promptMatch ? promptMatch[1].trim() : text.trim();

    return NextResponse.json({ title, prompt });
  } catch (e: any) {
    console.error(e);
    return new Response(e.message || "生成提示词失败", { status: 500 });
  }
}

async function createDashScopeClient() {
  const config = await prisma.systemConfig.findFirst();
  if (!config?.aiApiKey) {
    throw new Error("AI 服务未配置，请先在系统设置中配置 API Key");
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  const client = createOpenAI({
    baseURL: config.aiBaseUrl,
    apiKey: config.aiApiKey,
  });
  return { chatModel: client.chat(config.aiModel || "qwen-turbo") };
}
