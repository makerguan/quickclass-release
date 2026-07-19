import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { buildHtmlAnalysisPrompt } from "@/lib/prompts/ai-companion";

// POST: AI分析完整HTML，生成AI伴学语义提示词并保存到数据库
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      include: { SubProject: { include: { task: true } } },
    });
    if (!exploration) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (exploration.SubProject?.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    if (!exploration.htmlContent || exploration.htmlContent.trim().length < 100) {
      return NextResponse.json(
        { error: "HTML内容为空或过短，无法生成伴学提示词" },
        { status: 400 }
      );
    }

    if (!exploration.enableAiCompanion) {
      return NextResponse.json(
        { error: "AI伴学未启用，请先启用" },
        { status: 400 }
      );
    }

    const { chatModel } = await createDashScopeClient();
    const analysisPrompt = buildHtmlAnalysisPrompt(exploration.htmlContent);

    // 使用 generateText（非流式），因为需要完整结果后保存
    const result = await aiQueue.enqueue(async () => {
      return generateText({
        model: chatModel,
        prompt: analysisPrompt,
      });
    });

    const companionPrompt = (result.text || "").trim();

    if (!companionPrompt) {
      return NextResponse.json(
        { error: "AI返回了空内容，请重试" },
        { status: 500 }
      );
    }

    // 保存到数据库
    await prisma.explorationActivity.update({
      where: { id },
      data: { aiCompanionPrompt: companionPrompt },
    });

    return NextResponse.json({
      success: true,
      aiCompanionPrompt: companionPrompt,
    });
  } catch (error: any) {
    console.error("[generate-companion-prompt] 错误:", error?.message || error);
    if (error?.stack) console.error(error.stack);
    return NextResponse.json(
      { error: "生成伴学提示词失败: " + (error?.message || "未知错误") },
      { status: 500 }
    );
  }
}