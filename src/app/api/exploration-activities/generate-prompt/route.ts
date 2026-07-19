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
      system: `你是一位专业的互动探究学习设计师。根据提供的课堂信息，设计一个让学生"通过动手探索来理解知识"的网页探究活动。

【核心理念】互动探究≠做题闯关，而是让学生通过操作、观察、对比来发现规律、形成理解。

请同时输出：
1. **探究标题**（15字以内，简明扼要，体现探究主题，如"圆的面积公式探索"、"光的折射模拟实验"）
2. **互动设计提示词**（详细描述网页的：探究主题、可视化方式、交互机制、引导性问题）

【探究形式偏好】（按优先级排序，请优先选择前几种）
1. **概念可视化**：将抽象概念转化为直观的图形、动画（如几何图形的动态变化、函数的动态图像、分子结构的3D展示）
2. **模拟实验**：模拟真实实验过程（如物理化学实验、天文现象、生物过程），学生可调整参数观察结果变化
3. **对比探究**：并列展示多种情况让学生观察异同（如不同条件下的结果对比、历史演变对比、正例反例对比）
4. **原理探索**：通过分层揭示、逐步展开的方式让学生看到"为什么"（如几何证明的动态构建、公式推导的逐步展开）
5. **数据/规律发现**：提供可操作的数据让学生自己发现规律（如调整变量观察图表变化、排列组合寻找模式）

【真实可操作原则】（非常重要）
1. 所有交互必须基于真实计算：物理模拟要用真实物理公式（牛顿定律、抛物线方程、能量守恒等），数学可视化要用真实数学函数（函数图像、几何定理、概率计算等）
2. 不能是"看起来像但实际是固定动画"的伪交互：例如抛物线必须根据初速度、角度真实计算轨迹；函数图像必须根据参数真实计算坐标
3. 学生调节参数时要看到真实的变化规律，而不是预设的几段动画
4. 计算结果要尽可能贴近真实数据（可使用真实物理/数学常量、单位换算）

【应避免】
- 不要做成"闯关游戏"（避免"侦探社"、"挑战赛"、"大冒险"等游戏化包装）
- 不要以"得分/排行榜/关卡"为主要反馈机制（可以有轻量的进度提示，但不是核心）
- 不要把探究等同于"做题"（避免大量选择题、填空题、判断题堆砌）
- 不要让学生"猜答案"，而是让学生"看到规律"

【设计要求】
- 提示词能引导 AI 生成完整、可在浏览器中运行的 HTML5 互动网页
- 网页必须包含内联 CSS 和 JavaScript，不依赖外部资源
- 视觉风格：现代简洁、配色清晰、信息层级分明，重点突出"可观察的变化"
- 交互方式：滑块、按钮、可拖动元素、参数调节器、可点击的图表
- 必须有"引导性问题"或"观察提示"，让学生知道"该看什么、该思考什么"
- 视觉反馈要服务于理解（如参数变化时图形实时变化），而非简单的"对错"判断
- 适配电脑和Pad
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
