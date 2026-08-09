import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { upgradeAiCompanionIfNeeded } from "@/lib/prompts/ai-companion";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const { searchParams } = new URL(req.url);
    const subProjectId = searchParams.get("subProjectId");
    if (!subProjectId) return new Response("缺少 subProjectId", { status: 400 });

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: { task: true },
    });
    if (!sp || sp.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    const items = await prisma.explorationActivity.findMany({
      where: { subProjectId },
      orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }],
      include: { _count: { select: { ExplorationSubmission: true } } },
    });

    // 教师预览场景的兜底升级：每个启用了 AI 伴学的探究都跑一遍惰性升级
    // 只在内存中自愈注入，不持久化回 DB（保持 htmlContent 纯净）
    const upgradedItems = items.map((it) => {
      if (!it.enableAiCompanion) return it;
      const upgrade = upgradeAiCompanionIfNeeded(it.htmlContent, { explorationId: it.id });
      if (!upgrade.changed) return it;
      it.htmlContent = upgrade.html;
      return it;
    });

    return NextResponse.json(upgradedItems);
  } catch (error) {
    console.error(error);
    return new Response("查询失败", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const body = await req.json();
    const { subProjectId, title, description, htmlContent, enableSubmission, enableAiCompanion, aiCompanionPrompt, designPrompt, analysisPrompt } = body;

    if (!subProjectId || !title?.trim()) {
      return new Response("缺少必填字段", { status: 400 });
    }

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: { task: true },
    });
    if (!sp || sp.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    const maxOrder = await prisma.explorationActivity.aggregate({
      where: { subProjectId },
      _max: { sortOrder: true },
    });

    const item = await prisma.explorationActivity.create({
      data: {
        subProjectId,
        title: title.trim(),
        description: description || "",
        htmlContent: htmlContent || "",
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        enabled: true,
        enableSubmission: enableSubmission || false,
        enableAiCompanion: enableAiCompanion ?? false,
        aiCompanionPrompt: aiCompanionPrompt || null,
        designPrompt: designPrompt || null,
        analysisPrompt: analysisPrompt || null,
      },
    });

    // AI 伴学 UI 不再在保存时持久化注入到 HTML 原稿（避免污染），
    // 改为学生读取路径通过 upgradeAiCompanionIfNeeded 在内存中自愈注入
    let savedItem = item;
    // enableAiCompanion 标志位已在上面 create 时写入，无需额外注入

    return NextResponse.json(savedItem);
  } catch (error) {
    console.error(error);
    return new Response("创建失败", { status: 500 });
  }
}
