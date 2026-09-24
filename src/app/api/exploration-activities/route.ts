import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { upgradeAiCompanionIfNeeded } from "@/lib/prompts/ai-companion";
import { injectSubmitFunctionality, removeSubmitFunctionality } from "@/lib/prompts/exploration-submit";
import type { SubmitContext } from "@/lib/prompts/exploration-submit";
import { ensureQfTaskForExploration } from "@/lib/exploration/qf-binding";
import {
  analyzeCollectProfileWithAi,
  detectCollectProfile,
  stringifyCollectProfile,
} from "@/lib/exploration/collect-profile";

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

    // 新建时若已开启提交：与 PUT 路径保持一致，绑定 / 复用 QuickForm 收集任务 + 注入采集块。
    // 否则「新建即开提交」的探究永远不会有 qfTaskId → 数据大屏不显示、答案不入 QF 库。
    let injectWarnings: string[] | undefined;
    let qfWarnings: string[] | undefined;
    if (enableSubmission === true) {
      const qf = await ensureQfTaskForExploration({
        currentTaskId: null,
        title: title.trim(),
      });
      if (qf.error) {
        qfWarnings = ["QuickForm 收集任务准备失败：" + qf.error];
      }

      const context: SubmitContext = {
        explorationId: item.id,
        taskTitle: sp.task.title || "",
      };

      // 采集类别分析：AI 判断有没有评分环节（新建即开提交，HTML 必为新稿，直接分析）
      const cleanHtml = removeSubmitFunctionality(item.htmlContent || "");
      const aiProfile = await analyzeCollectProfileWithAi(cleanHtml);
      const profile = aiProfile ?? detectCollectProfile(cleanHtml);

      const result = injectSubmitFunctionality(item.htmlContent || "", context, profile);
      injectWarnings = result.warnings;

      const postUpdate: Record<string, unknown> = {
        htmlContent: result.html,
        collectProfile: stringifyCollectProfile(profile),
      };
      if (qf.taskId) postUpdate.qfTaskId = qf.taskId;

      savedItem = await prisma.explorationActivity.update({
        where: { id: item.id },
        data: postUpdate as any,
      });
    }

    const responseBody: Record<string, unknown> = { ...savedItem };
    if (injectWarnings && injectWarnings.length > 0) {
      responseBody._injectWarnings = injectWarnings;
    }
    if (qfWarnings && qfWarnings.length > 0) {
      responseBody._qfWarnings = qfWarnings;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error(error);
    return new Response("创建失败", { status: 500 });
  }
}
