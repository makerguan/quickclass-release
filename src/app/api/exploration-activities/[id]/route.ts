import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { injectSubmitFunctionality, removeSubmitFunctionality } from "@/lib/prompts/exploration-submit";
import type { SubmitContext } from "@/lib/prompts/exploration-submit";
import { removeAiCompanion, upgradeAiCompanionIfNeeded } from "@/lib/prompts/ai-companion";

// GET: 获取单个探究详情（含 aiCompanionPrompt）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const item = await prisma.explorationActivity.findUnique({
      where: { id },
      include: {
        SubProject: { include: { task: true } },
        _count: { select: { ExplorationSubmission: true } },
      },
    });
    if (!item) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (!item.SubProject) {
      return NextResponse.json({ error: "关联的项目不存在" }, { status: 400 });
    }
    if (item.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 兜底升级：教师预览 / 第三方调用也可能命中旧版 AI 伴学 HTML
    // 只在内存中自愈注入，不持久化回 DB（保持 htmlContent 纯净）
    let upgradeWarnings: string[] | undefined;
    if (item.enableAiCompanion) {
      const upgrade = upgradeAiCompanionIfNeeded(item.htmlContent, { explorationId: id });
      if (upgrade.changed) {
        upgradeWarnings = upgrade.warnings;
        item.htmlContent = upgrade.html;
      }
    }

    const response: Record<string, unknown> = { ...item };
    if (upgradeWarnings && upgradeWarnings.length > 0) {
      response._aiCompanionWarnings = upgradeWarnings;
    }
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[GET/exploration-activity] 错误:", error?.message || error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const body = await req.json();
    const {
      title,
      description,
      htmlContent,
      enableSubmission,
      enableAiCompanion,
      aiCompanionPrompt,
      designPrompt,
      analysisPrompt,
    } = body;

    const item = await prisma.explorationActivity.findUnique({
      where: { id },
      include: { SubProject: { include: { task: true } } },
    });
    if (!item) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (!item.SubProject) {
      return NextResponse.json({ error: "关联的项目不存在" }, { status: 400 });
    }
    if (item.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const existingSubs = await prisma.explorationSubmission.count({ where: { explorationId: id } });
    const updateData: Record<string, unknown> = {};
    let injectWarnings: string[] | undefined;
    let htmlContentChanged = false;

    // 基础字段
    updateData.title = title?.trim() ?? item.title;
    updateData.description = description ?? item.description;
    // 设计提示词（可编辑）
    if (designPrompt !== undefined) {
      updateData.designPrompt = designPrompt;
    }
    // 分析提示词（可编辑）
    if (analysisPrompt !== undefined) {
      updateData.analysisPrompt = analysisPrompt;
    }

    // AI伴学提示词（教师可手动编辑）
    if (aiCompanionPrompt !== undefined) {
      updateData.aiCompanionPrompt = aiCompanionPrompt && aiCompanionPrompt.trim() ? aiCompanionPrompt.trim() : null;
    }

    // 已有提交时锁定内容和提交开关
    if (existingSubs > 0) {
      updateData.htmlContent = item.htmlContent;
      updateData.enableSubmission = item.enableSubmission;
    } else {
      // 决定要操作的 HTML
      const baseHtml = htmlContent !== undefined ? htmlContent : item.htmlContent;
      htmlContentChanged = htmlContent !== undefined && htmlContent !== item.htmlContent;

      if (enableSubmission === true) {
        // 启用提交 → 注入提交功能
        const context: SubmitContext = {
          explorationId: id,
          taskTitle: item.SubProject.task.title || "",
        };
        const result = injectSubmitFunctionality(baseHtml, context);
        updateData.htmlContent = result.html;
        injectWarnings = result.warnings;
        updateData.enableSubmission = true;
      } else if (enableSubmission === false) {
        // 禁用提交 → 移除提交功能
        updateData.htmlContent = removeSubmitFunctionality(baseHtml);
        updateData.enableSubmission = false;
      } else {
        // enableSubmission 未传，只更新 HTML
        if (htmlContent !== undefined) {
          updateData.htmlContent = htmlContent;
        }
      }
    }

    // AI伴学启用/禁用处理（在提交功能注入之后，避免互相覆盖）
    // 不再在 PUT 时持久化注入/清理 AI 伴学代码到 htmlContent：
    // - 启用时只记录标志位，学生读取路径通过 upgradeAiCompanionIfNeeded 在内存中自愈注入
    // - 禁用时仍调用 removeAiCompanion 清理由历史残留的注入标记（存量兼容，对纯净稿是 no-op）
    // - 禁用时不清空 aiCompanionPrompt，保留提示词以便下次开启时复用
    if (enableAiCompanion === true) {
      updateData.enableAiCompanion = true;
    } else if (enableAiCompanion === false) {
      const html = (updateData.htmlContent as string) || item.htmlContent;
      if (html.includes("__AI_COMPANION_INJECTED__") || html.includes("ai-companion-trigger") || html.includes("#ai-companion-root")) {
        updateData.htmlContent = removeAiCompanion(html);
      }
      updateData.enableAiCompanion = false;
      // 关闭时只关功能，不删除提示词
    } else if (enableAiCompanion === undefined) {
      updateData.enableAiCompanion = item.enableAiCompanion;
    }

    // AI伴学提示词：HTML内容变化且AI伴学启用时，清空旧提示词触发重新生成
    // 考虑两种场景：(1) 伴学已开启+改HTML (2) 本次同时开启伴学+改HTML
    const effectiveAiCompanion = enableAiCompanion === true ? true : item.enableAiCompanion;
    if (htmlContentChanged && effectiveAiCompanion && aiCompanionPrompt === undefined) {
      updateData.aiCompanionPrompt = null;
    }

    const updated = await prisma.explorationActivity.update({
      where: { id },
      data: updateData as any,
    });

    const response: Record<string, unknown> = { ...updated };
    if (injectWarnings && injectWarnings.length > 0) {
      response._injectWarnings = injectWarnings;
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[PUT/exploration-activity] 错误:", error?.message || error);
    if (error?.stack) console.error(error.stack);
    return NextResponse.json({ error: "更新失败: " + (error?.message || "未知错误") }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const item = await prisma.explorationActivity.findUnique({
      where: { id },
      include: { SubProject: { include: { task: true } } },
    });
    if (!item) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (!item.SubProject) {
      return NextResponse.json({ error: "关联的项目不存在" }, { status: 400 });
    }
    if (item.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 手动级联删除：先删 AIInsight → ActionLog → Submission，再删 Activity
    // 查所有 submission
    const submissions = await prisma.explorationSubmission.findMany({
      where: { explorationId: id },
      select: { id: true },
    });
    const subIds = submissions.map(s => s.id);

    // 删除 exploration 相关的 AI 分析报告
    await prisma.aIInsight.deleteMany({
      where: { scopeId: id, type: { startsWith: "exploration_" } },
    });

    if (subIds.length > 0) {
      await prisma.explorationActionLog.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.explorationSubmission.deleteMany({ where: { explorationId: id } });
    }

    await prisma.explorationActivity.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
