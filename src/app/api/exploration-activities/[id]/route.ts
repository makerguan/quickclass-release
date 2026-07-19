import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { injectSubmitFunctionality, removeSubmitFunctionality } from "@/lib/prompts/exploration-submit";
import type { SubmitContext } from "@/lib/prompts/exploration-submit";
import { AI_COMPANION_VERSION, injectAiCompanion, removeAiCompanion, upgradeAiCompanionIfNeeded } from "@/lib/prompts/ai-companion";

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
    let upgradeWarnings: string[] | undefined;
    if (item.enableAiCompanion) {
      const upgrade = upgradeAiCompanionIfNeeded(item.htmlContent, { explorationId: id });
      if (upgrade.changed) {
        upgradeWarnings = upgrade.warnings;
        item.htmlContent = upgrade.html;
        // 后台持久化，不阻塞响应
        prisma.explorationActivity
          .update({ where: { id }, data: { htmlContent: upgrade.html } })
          .catch((e) => console.error("[GET/exploration-activity] 持久化AI伴学升级失败", id, e));
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
    let aiCompanionWarnings: string[] | undefined;
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
    if (enableAiCompanion === true && !item.enableAiCompanion) {
      // 启用AI伴学 → 注入UI
      const html = (updateData.htmlContent as string) || item.htmlContent;
      const result = injectAiCompanion(html, { explorationId: id });
      updateData.htmlContent = result.html;
      aiCompanionWarnings = result.warnings;
      updateData.enableAiCompanion = true;
    } else if (enableAiCompanion === true && item.enableAiCompanion) {
      // 已启用但HTML可能未注入 或 有重复注入 或 缺少新版本特性（兜底：检测注入完整性）
      const html = (updateData.htmlContent as string) || item.htmlContent;
      const hasNewFeatures = html.includes("AI_COMPANION_HISTORY") && html.includes("AI_COMPANION_READY") && html.includes("ac-clear");
      // 检测是否有重复注入（多个button或panel）
      const buttonCount = (html.match(/<button id="ai-companion-trigger"/g) || []).length;
      const panelCount = (html.match(/<div id="ai-companion-panel"/g) || []).length;
      const hasDuplicate = buttonCount > 1 || panelCount > 1;
      // 检测是否包含当前版本渲染器（Markdown + KaTeX）— 老版本或有解析问题的版本会重新注入
      const hasLatestRenderer = html.includes("renderMarkdownToElement")
        && html.includes("window.katex.renderToString")
        && html.includes(AI_COMPANION_VERSION);
      if (!hasNewFeatures || hasDuplicate || !hasLatestRenderer) {
        // 先移除所有AI伴学代码（包括重复的），再注入新版
        const cleanedHtml = html.includes("__AI_COMPANION_INJECTED__") || html.includes("ai-companion-trigger") || html.includes("AI学习伙伴")
          ? removeAiCompanion(html)
          : html;
        const result = injectAiCompanion(cleanedHtml, { explorationId: id });
        updateData.htmlContent = result.html;
        aiCompanionWarnings = result.warnings;
      }
      updateData.enableAiCompanion = true;
    } else if (enableAiCompanion === false) {
      // 禁用AI伴学（即使状态已不一致也清理HTML中的代码）
      const html = (updateData.htmlContent as string) || item.htmlContent;
      if (html.includes("__AI_COMPANION_INJECTED__") || html.includes("ai-companion-trigger") || html.includes("#ai-companion-root")) {
        updateData.htmlContent = removeAiCompanion(html);
      }
      updateData.enableAiCompanion = false;
    } else if (enableAiCompanion === undefined) {
      // 未传 enableAiCompanion：保持当前值不变
      updateData.enableAiCompanion = item.enableAiCompanion;
    }

    // HTML内容变化且已启用AI伴学 → 清空旧提示词（需重新生成）
    if (htmlContentChanged && item.enableAiCompanion && aiCompanionPrompt === undefined) {
      updateData.aiCompanionPrompt = null;
    }

    const updated = await prisma.explorationActivity.update({
      where: { id },
      data: updateData as any,
    });

    // 兜底：若返回前 html 仍非当前版本（教师编辑路径未触发切换分支），再升级一次并异步持久化
    let finalHtmlWarnings: string[] | undefined;
    if (updated.enableAiCompanion) {
      const guard = upgradeAiCompanionIfNeeded(updated.htmlContent, { explorationId: id });
      if (guard.changed) {
        finalHtmlWarnings = guard.warnings;
        updated.htmlContent = guard.html;
        prisma.explorationActivity
          .update({ where: { id }, data: { htmlContent: guard.html } })
          .catch((e) => console.error("[PUT/exploration-activity] 兜底持久化AI伴学升级失败", id, e));
      }
    }

    const response: Record<string, unknown> = { ...updated };
    if (injectWarnings && injectWarnings.length > 0) {
      response._injectWarnings = injectWarnings;
    }
    if (aiCompanionWarnings && aiCompanionWarnings.length > 0) {
      response._aiCompanionWarnings = aiCompanionWarnings;
    }
    if (finalHtmlWarnings && finalHtmlWarnings.length > 0) {
      response._aiCompanionWarnings = [...(aiCompanionWarnings || []), ...finalHtmlWarnings];
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
