import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { ensureQfTaskForExploration } from "@/lib/exploration/qf-binding";
import {
  analyzeCollectProfileWithAi,
  detectCollectProfile,
  parseCollectProfile,
  stringifyCollectProfile,
} from "@/lib/exploration/collect-profile";
import { purifyExplorationHtml, renderExplorationHtml } from "@/lib/exploration/render";

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

    // 教师预览场景：渲染注入版（提交 + 伴学），只在内存渲染，不持久化回 DB（保持 htmlContent 纯净稿）。
    // ⛔ 与学生读取路径同源（renderExplorationHtml），保证教师预览与学生端一致。
    const renderedItems = items.map((it) => {
      const rendered = renderExplorationHtml({
        htmlContent: it.htmlContent,
        explorationId: it.id,
        taskTitle: sp.task.title || "",
        enableSubmission: it.enableSubmission,
        enableAiCompanion: it.enableAiCompanion,
        collectProfile: parseCollectProfile(it.collectProfile ?? null),
      });
      it.htmlContent = rendered.html;
      return it;
    });

    return NextResponse.json(renderedItems);
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
        // htmlContent 恒存纯净稿（⛔ 不落库注入，提交功能由读取路径渲染）
        htmlContent: purifyExplorationHtml(htmlContent || ""),
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        enabled: true,
        enableSubmission: enableSubmission || false,
        enableAiCompanion: enableAiCompanion ?? false,
        aiCompanionPrompt: aiCompanionPrompt || null,
        designPrompt: designPrompt || null,
        analysisPrompt: analysisPrompt || null,
      },
    });

    // AI 伴学注入不落库：htmlContent 恒为纯净稿，伴学注入由读取路径 renderExplorationHtml 内存现算。
    let savedItem = item;
    // enableAiCompanion 标志位已在上面 create 时写入，无需额外处理

    // 新建时若已开启提交：绑定 / 复用 QuickForm 收集任务 + 分析采集类别。
    // ⛔ 不再把注入后的 HTML 写回 htmlContent（htmlContent 恒为纯净稿）；
    //    提交功能由读取路径 renderExplorationHtml 内存注入，保存只落 collectProfile + qfTaskId。
    let qfWarnings: string[] | undefined;
    if (enableSubmission === true) {
      const qf = await ensureQfTaskForExploration({
        currentTaskId: null,
        title: title.trim(),
      });
      if (qf.error) {
        qfWarnings = ["QuickForm 收集任务准备失败：" + qf.error];
      }

      // 采集类别分析：AI 判断有没有评分环节（新建即开提交，HTML 必为新稿，直接分析）
      const cleanHtml = item.htmlContent || "";
      const aiProfile = await analyzeCollectProfileWithAi(cleanHtml);
      const profile = aiProfile ?? detectCollectProfile(cleanHtml);

      const postUpdate: Record<string, unknown> = {
        collectProfile: stringifyCollectProfile(profile),
      };
      if (qf.taskId) postUpdate.qfTaskId = qf.taskId;

      savedItem = await prisma.explorationActivity.update({
        where: { id: item.id },
        data: postUpdate as any,
      });
    }

    const responseBody: Record<string, unknown> = { ...savedItem };
    if (qfWarnings && qfWarnings.length > 0) {
      responseBody._qfWarnings = qfWarnings;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error(error);
    return new Response("创建失败", { status: 500 });
  }
}
