import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { getQfCore } from "@/lib/quickform";
import { generateText } from "ai";
import {
  buildFieldSummaries,
  DASHBOARD_SYSTEM_PROMPT,
  extractJsonObject,
  sanitizeDashboardConfig,
  type AiDashboardConfig,
  type FieldSummary,
} from "@/lib/prompts/dashboard-config";

const TYPE_LABEL: Record<FieldSummary["type"], string> = {
  number: "数值",
  option: "选项",
  text: "自由文本",
  multi: "多选",
};

/** 把字段摘要拼成 user 提示词（不含任何原始学生记录） */
function buildUserPrompt(summaries: FieldSummary[], total: number, instruction: string): string {
  const lines = summaries.map((s) => {
    const base = `- ${s.name}｜类型:${TYPE_LABEL[s.type]}｜${s.count} 条｜去重 ${s.unique}`;
    if (s.type === "number") {
      return `${base}｜最小 ${s.min}｜最大 ${s.max}｜平均 ${s.avg}`;
    }
    const top = (s.top || []).map((t) => `${t.value}(${t.count})`).join(" / ");
    return `${base}｜高频取值: ${top || "无"}`;
  });

  const extra = instruction ? `\n【老师额外要求】${instruction}\n` : "";
  return (
    `共 ${total} 条学生提交。\n【字段摘要】\n${lines.join("\n")}\n${extra}\n` +
    `请据上述字段设计数据大屏配置，只输出 JSON。`
  );
}

async function authenticate(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: new Response("未登录", { status: 401 }) };
  const payload = await verifyToken(token);
  if (!payload) return { error: new Response("登录已过期", { status: 401 }) };
  return { userId: String(payload.userId) };
}

async function loadOwnedExploration(id: string, userId: string) {
  const exploration = await prisma.explorationActivity.findUnique({
    where: { id },
    include: { SubProject: { include: { task: true } } },
  });
  if (!exploration) return { error: new Response("探究不存在", { status: 404 }) };
  if (!exploration.SubProject || exploration.SubProject.task.teacherId !== userId) {
    return { error: new Response("无权限", { status: 403 }) };
  }
  return { exploration };
}

/**
 * POST：让 AI 依据「字段摘要 + 聚合统计」重排数据大屏，产出**图表配置 JSON**（不是 HTML），
 * 落库缓存到 exploration.dashboardConfig。老师手动触发、低频。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authenticate(req);
    if ("error" in auth) return auth.error;

    const owned = await loadOwnedExploration(id, auth.userId!);
    if ("error" in owned) return owned.error;
    const exploration = owned.exploration!;

    if (!exploration.qfTaskId) {
      return NextResponse.json(
        { ok: false, message: "该探究尚未开启提交收集，无法生成数据大屏。" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const instruction =
      typeof body?.instruction === "string" ? body.instruction.trim().slice(0, 200) : "";

    let items: { data?: Record<string, unknown> }[] = [];
    let total = 0;
    try {
      const page = await getQfCore().listRecords(exploration.qfTaskId, undefined, {
        page: 1,
        pageSize: 500,
      });
      items = page.items;
      total = page.total;
    } catch (e) {
      console.error("[dashboard-config] 读取收集数据失败:", e);
      return NextResponse.json({ ok: false, message: "读取收集数据失败。" }, { status: 500 });
    }

    if (total === 0) {
      return NextResponse.json(
        { ok: false, message: "暂无学生提交数据，先让学生提交后再生成大屏。" },
        { status: 400 }
      );
    }

    const summaries = buildFieldSummaries(items);
    if (summaries.length === 0) {
      return NextResponse.json({ ok: false, message: "提交数据里没有可用字段。" }, { status: 400 });
    }

    let config: AiDashboardConfig | null = null;
    try {
      const { chatModel } = await createDashScopeClient();
      const { text } = await generateText({
        model: chatModel,
        system: DASHBOARD_SYSTEM_PROMPT,
        prompt: buildUserPrompt(summaries, total, instruction),
        temperature: 0.4,
      });
      const parsed = extractJsonObject(text);
      if (parsed) config = sanitizeDashboardConfig(parsed, summaries.map((s) => s.name));
    } catch (e) {
      console.error("[dashboard-config] 调用 AI 失败:", e);
      return NextResponse.json(
        { ok: false, message: "AI 服务暂不可用，请稍后重试（可先用默认大屏）。" },
        { status: 502 }
      );
    }

    if (!config || (config.charts?.length ?? 0) === 0) {
      return NextResponse.json(
        { ok: false, message: "AI 未返回可用的图表配置，请重试。" },
        { status: 502 }
      );
    }

    await prisma.explorationActivity.update({
      where: { id },
      data: { dashboardConfig: JSON.stringify(config) },
    });

    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error("[dashboard-config] 生成失败:", error);
    return new Response("生成失败", { status: 500 });
  }
}

/** DELETE：清空 AI 配置，回到默认的字段自动映射大屏 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authenticate(req);
    if ("error" in auth) return auth.error;

    const owned = await loadOwnedExploration(id, auth.userId!);
    if ("error" in owned) return owned.error;

    await prisma.explorationActivity.update({
      where: { id },
      data: { dashboardConfig: null },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[dashboard-config] 清除失败:", error);
    return new Response("清除失败", { status: 500 });
  }
}
