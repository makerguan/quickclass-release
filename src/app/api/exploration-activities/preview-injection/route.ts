import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { aiPreviewPrompt, generateAutoScoringScript } from "@/lib/prompts/exploration-submit";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const body = await req.json();
    const { htmlContent, explorationId, subProjectId } = body;

    if (!htmlContent?.trim()) {
      return new Response("HTML 内容不能为空", { status: 400 });
    }

    // 获取任务标题作为上下文
    let taskTitle = "";
    if (explorationId) {
      const exp = await prisma.explorationActivity.findUnique({
        where: { id: explorationId },
        include: { SubProject: { include: { task: true } } },
      });
      taskTitle = exp?.SubProject?.task?.title ?? "";
    } else if (subProjectId) {
      const sp = await prisma.subProject.findUnique({
        where: { id: subProjectId },
        include: { task: true },
      });
      taskTitle = sp?.task?.title ?? "";
    }

    // 从数据库 SystemConfig 读取 AI 配置
    const config = await prisma.systemConfig.findFirst();
    if (!config?.aiApiKey) {
      return NextResponse.json({
        success: false,
        error: "AI 服务未配置，请先在系统设置中配置 API Key",
        fallback: {
          interactiveElements: [
            { type: "click", element: "所有按钮", description: "点击按钮" },
            { type: "display", element: "页面主体", description: "页面浏览" },
          ],
          autoTrackable: ["timeSpent", "interactions", "scrollDepth"],
          manualTrackable: [],
          warnings: ["未配置 AI API Key，仅显示基础分析"],
          summary: "系统未配置 AI，将采用基础追踪方案。",
        },
      });
    }

    const prompt = aiPreviewPrompt(htmlContent);
    const model = config.aiModel || "qwen-plus";

    const aiRes = await fetch(`${config.aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是一个 HTML 交互分析助手，擅长识别页面中的学生互动行为。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiRes.ok) {
      throw new Error(`AI API error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const content = aiData?.choices?.[0]?.message?.content ?? "";

    // 尝试解析 JSON
    let analysis;
    try {
      const jsonStr = content.replace(/```json\n?|```\n?/g, "").trim();
      analysis = JSON.parse(jsonStr);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          analysis = JSON.parse(match[0]);
        } catch {
          return NextResponse.json({
            success: false,
            error: "AI 返回格式解析失败",
            raw: content.substring(0, 500),
          });
        }
      } else {
        return NextResponse.json({
          success: false,
          error: "AI 返回格式解析失败",
          raw: content.substring(0, 500),
        });
      }
    }

    return NextResponse.json({
      success: true,
      taskTitle,
      analysis,
      // 自动生成评分脚本
      autoScoreScript: (analysis.questions && analysis.questions.length > 0)
        ? generateAutoScoringScript(analysis.questions, analysis.totalScore || 100)
        : null,
    });
  } catch (error: any) {
    console.error("预览分析失败:", error);
    return NextResponse.json({
      success: false,
      error: error?.message || "预览分析失败",
    }, { status: 500 });
  }
}
