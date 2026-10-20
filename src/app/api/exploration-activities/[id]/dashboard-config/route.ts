import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { getQfCore } from "@/lib/quickform";
import { generateText } from "ai";
import {
  buildFallbackCharts,
  buildDashboardSystemPrompt,
  buildFieldSummaries,
  detectKpiAggIntents,
  extractJsonObject,
  sanitizeDashboardConfig,
  SUBMITTED_AT_FIELD,
  type AiDashboardConfig,
  type FieldSummary,
} from "@/lib/prompts/dashboard-config";

const TYPE_LABEL: Record<FieldSummary["type"], string> = {
  number: "数值",
  option: "选项",
  text: "自由文本",
  multi: "多选",
};

/** 把字段摘要拼成 user 提示词（不含任何原始学生记录）；baseConfig 存在时进入修订模式 */
function buildUserPrompt(
  summaries: FieldSummary[],
  total: number,
  instruction: string,
  baseConfig?: AiDashboardConfig | null
): string {
  const lines = summaries.map((s) => {
    const base = `- ${s.name}｜类型:${TYPE_LABEL[s.type]}｜${s.count} 条｜去重 ${s.unique}`;
    if (s.type === "number") {
      return `${base}｜最小 ${s.min}｜最大 ${s.max}｜平均 ${s.avg}`;
    }
    const top = (s.top || []).map((t) => `${t.value}(${t.count})`).join(" / ");
    return `${base}｜高频取值: ${top || "无"}`;
  });

  // 方案 B：先把老师口语化指标翻译成「KPI 硬约束」，让 AI 精确兑现（不再瞎猜 avg/max/count）
  const intents = detectKpiAggIntents(instruction);
  const kpiConstraint = intents.length
    ? `\n【KPI 硬约束】老师点名了这些指标：${intents.join("、")}。请在 kpis 中逐一兑现（放在靠前位置、选对应字段、label 用老师原词）。\n`
    : "";
  // 修订模式：当前配置作为基准交给 AI（已经 sanitize，字段/类型/长度都受控，无注入面）
  const baseSection = baseConfig
    ? `\n【当前大屏配置】（修订基准，未提及的部分必须原样保留）\n${JSON.stringify(baseConfig)}\n`
    : "";
  const extra = instruction ? `\n【老师额外要求】${instruction}\n${kpiConstraint}` : "";
  return (
    `共 ${total} 条学生提交。\n【字段摘要】\n${lines.join("\n")}${baseSection}${extra}\n` +
    `请据上述字段${baseConfig ? "在当前配置基础上修订" : "设计"}数据大屏配置，只输出 JSON。`
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
    // 修订模式（方案 A）：前端带上老师当前已保存的大屏配置，AI 只改指令提到的部分
    const rawBaseConfig =
      body?.baseConfig && typeof body.baseConfig === "object" ? body.baseConfig : null;

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
    console.log(
      "[dashboard-config] 字段摘要:",
      summaries.map((s) => `${s.name}(${s.type})`).join(", ")
    );
    if (summaries.length === 0) {
      return NextResponse.json({ ok: false, message: "提交数据里没有可用字段。" }, { status: 400 });
    }

    // 修订基准：sanitize 一遍（同一白名单口径），sanitize 后还有卡片才值得修订
    const validFields = [...summaries.map((s) => s.name), SUBMITTED_AT_FIELD];
    const baseConfig = rawBaseConfig ? sanitizeDashboardConfig(rawBaseConfig, validFields) : null;
    const isRevise = Boolean(
      instruction &&
        baseConfig &&
        ((baseConfig.charts?.length ?? 0) > 0 || (baseConfig.kpis?.length ?? 0) > 0)
    );

    let config: AiDashboardConfig | null = null;
    try {
      const { chatModel } = await createDashScopeClient();
      const { text } = await generateText({
        model: chatModel,
        system: buildDashboardSystemPrompt(isRevise ? "revise" : "create"),
        prompt: buildUserPrompt(summaries, total, instruction, isRevise ? baseConfig : null),
        temperature: isRevise ? 0.2 : 0.4, // 修订要保守，别自作主张大改
      });
      const parsed = extractJsonObject(text);
      console.log("[dashboard-config] AI 原始输出:", text?.slice(0, 800));
      console.log("[dashboard-config] 解析结果:", parsed ? "JSON OK" : "解析失败(null)");
      if (parsed) {
        config = sanitizeDashboardConfig(parsed, summaries.map((s) => s.name));
        console.log(
          "[dashboard-config] sanitize 后 -> charts:",
          config?.charts?.length ?? 0,
          "kpis:",
          config?.kpis?.length ?? 0
        );
      }
    } catch (e) {
      console.error("[dashboard-config] 调用 AI 失败:", e);
      return NextResponse.json(
        { ok: false, message: "AI 服务暂不可用，请稍后重试（可先用默认大屏）。" },
        { status: 502 }
      );
    }

    // ⚠️ GOTCHA：AI 在「数据很少（仅 1~2 条）」时可能只返回 KPI、charts 为空（合法但体验差），
    // 直接落库会导致大屏出现「没有可渲染的图表」空态，老师点「编辑」进去也没有图表可修（死循环）。
    // 这里据字段摘要兜底生成基础图表，保证 charts 非空（buildFallbackCharts 字段名即真实 key）。
    // 只有 charts 和 kpis 都为 0 才是真失败。
    if (config && (config.charts?.length ?? 0) === 0) {
      config.charts = buildFallbackCharts(summaries);
    }
    if (!config || ((config.charts?.length ?? 0) === 0 && (config.kpis?.length ?? 0) === 0)) {
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

/**
 * PUT：保存老师手动微调后的数据大屏配置（「AI 初稿 + 手动微调」的持久化入口）。
 * 与 POST 共用同一套 sanitize + 白名单校验，落库前过滤非法字段 / 图型。
 */
export async function PUT(
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
        { ok: false, message: "该探究尚未开启提交收集，无法保存数据大屏配置。" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawConfig = body?.config;
    if (!rawConfig || typeof rawConfig !== "object") {
      return NextResponse.json({ ok: false, message: "缺少配置。" }, { status: 400 });
    }

    // 从当前收集数据实时提取合法字段名（不信任前端传的字段）
    let items: { data?: Record<string, unknown> }[] = [];
    try {
      const page = await getQfCore().listRecords(exploration.qfTaskId, undefined, {
        page: 1,
        pageSize: 500,
      });
      items = page.items;
    } catch (e) {
      console.error("[dashboard-config] PUT 读取收集数据失败:", e);
      return NextResponse.json({ ok: false, message: "读取收集数据失败。" }, { status: 500 });
    }

    // ⚠️ GOTCHA：「提交时间」是记录元数据（不在 data 里），buildFieldSummaries 不会列出它；
    // 不补进白名单的话，老师手动编辑时选「提交时间」做排行榜会被 sanitize 整条丢弃。
    const validFields = [...buildFieldSummaries(items).map((s) => s.name), SUBMITTED_AT_FIELD];
    const config = sanitizeDashboardConfig(rawConfig, validFields);

    await prisma.explorationActivity.update({
      where: { id },
      data: { dashboardConfig: JSON.stringify(config) },
    });

    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error("[dashboard-config] 保存失败:", error);
    return new Response("保存失败", { status: 500 });
  }
}
