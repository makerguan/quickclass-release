import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { injectSubmitFunctionality, removeSubmitFunctionality } from "@/lib/prompts/exploration-submit";
import type { SubmitContext } from "@/lib/prompts/exploration-submit";

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
    const { title, description, htmlContent, enableSubmission, designPrompt, analysisPrompt } = body;

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

    // 已有提交时锁定内容和提交开关
    if (existingSubs > 0) {
      updateData.htmlContent = item.htmlContent;
      updateData.enableSubmission = item.enableSubmission;
    } else {
      // 决定要操作的 HTML
      const baseHtml = htmlContent !== undefined ? htmlContent : item.htmlContent;

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
