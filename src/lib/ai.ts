import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "./prisma";

export async function getAIConfig() {
  const config = await prisma.systemConfig.findFirst();
  if (!config?.aiApiKey) {
    throw new Error("AI 服务未配置，请先在系统设置中配置 API Key");
  }
  return {
    baseURL: config.aiBaseUrl,
    apiKey: config.aiApiKey,
    model: config.aiModel || "qwen-turbo",
    reasoningEnabled: config.reasoningEnabled ?? true, // DeepSeek V4 默认开启
    classWordLimit: config.classWordLimit ?? 2000,
  };
}

/**
 * 关闭推理时的 fetch 中间件：向 chat/completions 请求体注入
 * thinking={type:"disabled"}，彻底关闭 DeepSeek 推理模型的"思考"阶段。
 * 实测全班分析从约 54s 降至约 18s，正文质量不受影响。
 * （@ai-sdk/openai 不透传 thinking 字段，只能借自定义 fetch 注入）
 */
const noThinkingFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body);
      if (body && body.model && !body.thinking) {
        body.thinking = { type: "disabled" };
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      // body 非 JSON（非 chat 请求）时忽略
    }
  }
  return fetch(input, init);
};

export async function createDashScopeClient() {
  const config = await getAIConfig();
  const client = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    // reasoningEnabled 关闭时才注入；开启时走原生 fetch（保留深度推理）
    fetch: config.reasoningEnabled ? undefined : noThinkingFetch,
  });
  return {
    chatModel: client.chat(config.model),
    reasoningEnabled: config.reasoningEnabled,
  };
}

/**
 * 直连 chat/completions 的统一 fetch：超时上限 + 网络级错误自动重试 + 友好错误信息。
 *
 * 为什么要有这个函数：
 * 🧪 MEASURED 2026-09-25：老师生成探究 AI 报告时 api.deepseek.com 瞬时不可达，
 *   两次请求各 ~13s 后以 undici「fetch failed」告终（500 原样透传，老师只看到
 *   「生成失败: fetch failed」）；约 40 分钟后同一请求 14.9s 成功——纯网络抖动，
 *   但当时无超时、无重试、错误信息不可读，一次抖动直接变成用户可见故障。
 *
 * ⚠️ GOTCHA：只重试「网络级」失败（fetch reject：连接被拒/DNS 失败/本函数的超时），
 *   不重试 HTTP 4xx/5xx——401 是 key 无效、400 是请求体问题，重试无意义且拖慢报错。
 *
 * 🔗 RELATED（新增直连 chat/completions 时必须改用本函数，不要再裸写 fetch）：
 *   - src/lib/ai-grading.ts（gradeByAI / generateTeachingAdvice）
 *   - src/app/api/exploration-activities/[id]/analysis/generate/route.ts
 *   - src/app/api/quiz-activities/[id]/report/generate/route.ts
 *   - src/app/api/quiz-activities/generate-preview/route.ts
 *   - src/app/api/quiz-activities/route.ts
 *   - src/app/api/system-config/test/route.ts 是连通性诊断工具，故意保留裸 fetch（重试会掩盖真实断网）
 */
const AI_FETCH_TIMEOUT_MS = 120_000; // 全班报告实测可达 ~60s，留足余量；两轮重试最坏 ~241s，仍在浏览器 ~300s 放弃线内
const AI_FETCH_RETRIES = 1; // 网络级失败自动重试 1 次（共 2 次尝试）

export async function chatCompletionsFetch(
  aiConfig: { baseURL: string; apiKey: string },
  body: Record<string, unknown>
): Promise<Response> {
  const url = `${aiConfig.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const payload = JSON.stringify(body);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= AI_FETCH_RETRIES; attempt++) {
    if (attempt > 0) {
      // 短暂等待，给瞬时网络抖动一点恢复时间
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aiConfig.apiKey}`,
        },
        body: payload,
        signal: AbortSignal.timeout(AI_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
      // 把 undici 隐藏在 cause 里的真实原因（ENOTFOUND/ECONNREFUSED/超时）打出来，便于排查
      const cause = (err as { cause?: unknown })?.cause;
      console.error(
        `[chatCompletionsFetch] 第 ${attempt + 1}/${AI_FETCH_RETRIES + 1} 次尝试网络级失败:`,
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        cause instanceof Error ? `（cause: ${cause.message}）` : ""
      );
    }
  }
  console.error("[chatCompletionsFetch] 重试耗尽，最后错误:", lastErr);
  throw new Error(
    `AI 服务连接失败（网络波动或服务不可达，已自动重试 ${AI_FETCH_RETRIES} 次），请检查网络后稍候重试`
  );
}
