import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import {
  ensureQfTaskForExploration,
  deleteQfTaskForExploration,
} from "@/lib/exploration/qf-binding";
import {
  analyzeCollectProfileWithAi,
  detectCollectProfile,
  parseCollectProfile,
  stringifyCollectProfile,
} from "@/lib/exploration/collect-profile";
import { purifyExplorationHtml } from "@/lib/exploration/render";

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

    // 编辑回显返回纯净稿（不含提交 / 伴学注入），保证前端「源码区」与「AI 接入状态」
    // 都基于纯净稿判断，避免「编辑时看到注入代码」「提示词不显示」的错位。
    // ⛔ 预览所需的注入版由前端本地渲染（复用 lib 注入函数），此处不再内存注入。
    item.htmlContent = purifyExplorationHtml(item.htmlContent);

    const response: Record<string, unknown> = { ...item };
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
    let qfWarnings: string[] | undefined;
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

    // 已有提交时锁定内容和提交开关（htmlContent 仍剥净为纯净稿，保证读取路径渲染一致）
    if (existingSubs > 0) {
      updateData.htmlContent = purifyExplorationHtml(item.htmlContent);
      updateData.enableSubmission = item.enableSubmission;
    } else {
      // 决定要操作的 HTML（⛔ htmlContent 恒存纯净稿，注入移到读取路径 renderExplorationHtml）
      const baseHtml = htmlContent !== undefined ? htmlContent : item.htmlContent;
      htmlContentChanged = htmlContent !== undefined && htmlContent !== item.htmlContent;
      // ① htmlContent 恒存纯净稿（purify 幂等，兼容存量注入版数据自愈）
      updateData.htmlContent = purifyExplorationHtml(baseHtml);

      if (enableSubmission === true) {
        // ② 绑定 / 复用 QuickForm 收集任务（首次创建，之后复用；改名只同步任务名）
        //    绑定失败不阻断：老师照常能开提交，只是答案不入库（会提示）
        const qf = await ensureQfTaskForExploration({
          currentTaskId: item.qfTaskId ?? null,
          title: (updateData.title as string) || item.title || "",
        });
        if (qf.error) {
          qfWarnings = ["QuickForm 收集任务准备失败：" + qf.error];
        }
        if (qf.taskId) {
          updateData.qfTaskId = qf.taskId;
        }

        // ③ 采集类别分析：只有 HTML 变了 / 首次启用（无 collectProfile）才重新分析，
        //    避免每次保存都调 AI。⛔ 只存 collectProfile，不注入 htmlContent；
        //    提交功能由读取路径 renderExplorationHtml 内存注入。
        let profile = parseCollectProfile(item.collectProfile ?? null);
        if (htmlContentChanged || !profile) {
          const cleanBaseHtml = updateData.htmlContent as string;
          const aiProfile = await analyzeCollectProfileWithAi(cleanBaseHtml);
          profile = aiProfile ?? detectCollectProfile(cleanBaseHtml);
          updateData.collectProfile = stringifyCollectProfile(profile);
        }
        updateData.enableSubmission = true;
      } else if (enableSubmission === false) {
        // 禁用提交 → 只关开关；htmlContent 已在上方 purify 成纯净稿（无提交注入可移除）
        updateData.enableSubmission = false;
      } else {
        // enableSubmission 未传：htmlContent 已在上方更新为纯净稿
      }
    }

    // AI伴学启用/禁用处理：只翻转标志位，不持久化注入/清理到 htmlContent。
    // ⛔ htmlContent 恒为纯净稿，伴学注入由读取路径 renderExplorationHtml 内存现算；
    //    关闭时不清空 aiCompanionPrompt，保留提示词以便下次开启时复用。
    if (enableAiCompanion === true) {
      updateData.enableAiCompanion = true;
    } else if (enableAiCompanion === false) {
      // 关闭只关开关；htmlContent 已在上方 purify 成纯净稿（无伴学注入残留）
      updateData.enableAiCompanion = false;
      // 关闭时只关功能，不删除提示词
    } else if (enableAiCompanion === undefined) {
      updateData.enableAiCompanion = item.enableAiCompanion;
    }

    // AI伴学提示词：HTML内容变化且AI伴学启用时，无条件清空旧提示词触发重新生成。
    // ⛔ DO NOT REVERT：别再要求 aiCompanionPrompt === undefined —— 前端 doSaveExploration
    //   总会把回显的旧提示词原样传回，导致「老师改了 HTML 但提示词没动」时旧提示词残留、
    //   与新页面语义不匹配。改为只要 HTML 变 + 伴学开就清空重生成。
    //   老师「只改提示词、不改 HTML」时 htmlContentChanged=false，走上方 109-111 行正常保存，不受影响。
    // 🔗 RELATED：前端保存后触发重生成 src/app/teacher/tasks/page.tsx doSaveExploration。
    const effectiveAiCompanion = enableAiCompanion === true ? true : item.enableAiCompanion;
    if (htmlContentChanged && effectiveAiCompanion) {
      updateData.aiCompanionPrompt = null;
    }

    const updated = await prisma.explorationActivity.update({
      where: { id },
      data: updateData as any,
    });

    const response: Record<string, unknown> = { ...updated };
    if (qfWarnings && qfWarnings.length > 0) {
      response._qfWarnings = qfWarnings;
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

    // 连带清理该探究绑定的 QF 收集任务（含 qf_records）。
    // ⛔ DO NOT REMOVE：qfTaskId 是普通字符串字段、无外键级联，不在这里删会残留孤儿
    // qf_tasks / qf_records（历史教训：删探究后留下 task_id 找不到的孤儿记录）。
    // 🔗 RELATED：deleteQfTaskForExploration 见 src/lib/exploration/qf-binding.ts。
    await deleteQfTaskForExploration(item.qfTaskId);

    await prisma.explorationActivity.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
