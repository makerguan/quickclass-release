import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "./prisma";

/** 线路标识：text=图文线路（文本/图片），omni=全媒体线路（语音/图片/视频） */
export type AIConfigRoute = "text" | "omni";

/** 单条模型端点 */
export interface Endpoint {
  baseURL: string;
  apiKey: string;
  model: string;
}

/**
 * 读取 AI 配置。
 * @param route 线路："text"（默认，图文）/ "omni"（全媒体）。
 *   - omni 线路未配置（aiOmniModel 为空）时自动回落到图文配置，行为与旧版完全一致；
 *   - 返回结构兼容旧版（baseURL/apiKey/model/...），并附带 _route/_primary/_backup 内部字段
 *     供 failover 封装使用（ai-grading 等直接消费旧字段的调用方零改动）。
 */
export async function getAIConfig(route: AIConfigRoute = "text") {
  const config = await prisma.systemConfig.findFirst();
  if (!config?.aiApiKey) {
    throw new Error("AI 服务未配置，请先在系统设置中配置 API Key");
  }

  const isOmni = route === "omni" && !!config.aiOmniModel;

  const primary: Endpoint = isOmni
    ? {
        baseURL: config.aiOmniBaseUrl || config.aiBaseUrl,
        apiKey: config.aiOmniApiKey || config.aiApiKey,
        model: config.aiOmniModel || config.aiModel || "qwen-turbo",
      }
    : {
        baseURL: config.aiBaseUrl,
        apiKey: config.aiApiKey,
        model: config.aiModel || "qwen-turbo",
      };

  const backup: Endpoint | undefined = isOmni
    ? config.aiOmniBackupModel
      ? {
          baseURL: config.aiOmniBackupBaseUrl || config.aiOmniBaseUrl || config.aiBaseUrl,
          apiKey: config.aiOmniBackupApiKey || config.aiOmniApiKey || config.aiApiKey,
          model: config.aiOmniBackupModel,
        }
      : undefined
    : config.aiTextBackupModel
      ? {
          baseURL: config.aiTextBackupBaseUrl || config.aiBaseUrl,
          apiKey: config.aiTextBackupApiKey || config.aiApiKey,
          model: config.aiTextBackupModel,
        }
      : undefined;

  return {
    baseURL: primary.baseURL,
    apiKey: primary.apiKey,
    model: primary.model,
    reasoningEnabled: config.reasoningEnabled ?? true, // DeepSeek V4 默认开启
    classWordLimit: config.classWordLimit ?? 2000,
    // 内部字段：主备 failover 使用（不对外承诺稳定性）
    _route: isOmni ? ("omni" as const) : ("text" as const),
    _primary: primary,
    _backup: backup,
  };
}

/* ===================== 主备故障切换 + 熔断 =====================
 * 设计（2026-10-15，2026-10-15 调优）：
 * - 每条线路可配「主模型 + 备用模型」；主模型 网络失败/超时/HTTP 4xx/5xx（key 无效、模型不存在、
 *   无权限、限流、服务端故障）时自动切备用——测试实测「model 不存在」（400/403/404）也会切备。
 * - 流式对话：首响应超时 10s（FIRST_RESPONSE_TIMEOUT_MS）——主模型 10s 内未开始返回内容即切备用，
 *   避免白等；报告类长任务（chatCompletionsFetch）保留 300s 整体超时——主模型 300s 内未完成才判定失败切备用（120s 太短，会误伤正常的长报告）。
 * - 熔断：主模型连续失败达到阈值后，临时挂起（直接用备用），避免每次请求都白等主模型超时；
 *   窗口期（60s）结束后自动恢复主模型，成功即重置计数。
 * - 内存态（单进程/每实例独立）：多实例部署下各自熔断，属可接受折衷。
 * - A 类（createDashScopeClient，AI SDK）通过自定义 fetch 包装实现，27 处调用点零改动；
 *   B 类（chatCompletionsFetch）熔断状态与 A 类共享：主模型被判故障后报告生成也直接用备用；
 *   主失败计入熔断（让对话随之切备），但不主动切备重试（切换=重新生成），调用方零改动。
 */
interface CircuitState {
  failures: number;
  openUntil: number;
}
const circuitMap = new Map<AIConfigRoute, CircuitState>();
const CIRCUIT_FAIL_THRESHOLD = 3; // 连续失败 3 次触发熔断
const CIRCUIT_OPEN_MS = 60 * 1000; // 熔断窗口 60 秒（对话已有 10s 首响应超时，白等成本低，无需 5 分钟）

function isPrimaryOpen(route: AIConfigRoute): boolean {
  const state = circuitMap.get(route);
  return !!state && state.openUntil > Date.now();
}

function reportPrimaryFailure(route: AIConfigRoute): void {
  const state = circuitMap.get(route) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAIL_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    console.warn(`[ai] 线路「${route}」主模型连续失败 ${state.failures} 次，熔断 ${CIRCUIT_OPEN_MS / 1000}s，切换到备用模型`);
  }
  circuitMap.set(route, state);
}

function reportPrimarySuccess(route: AIConfigRoute): void {
  circuitMap.delete(route);
}

/** 将 URL 中的 fromBase 替换为 toBase（主备 baseURL 切换） */
function rewriteBaseUrl(url: string, fromBase: string, toBase: string): string {
  const from = fromBase.replace(/\/+$/, "");
  const to = toBase.replace(/\/+$/, "");
  if (!from || from === to) return url;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return url.replace(new RegExp(escaped), to);
}

/** 注入指定 API Key 的 Authorization 头 */
function withAuth(init: RequestInit | undefined, apiKey: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  return { ...init, headers };
}

/** 改写请求体中的模型名：failover 切备用时，URL/key 换掉后 model 必须同步换成备用模型，
 * 否则请求会带着主模型名打到备用方（对方不认识 → Model not exist / model_not_found）。 */
function withBodyModel(init: RequestInit | undefined, model: string): RequestInit {
  if (!init || typeof init.body !== "string") return init as RequestInit;
  try {
    const body = JSON.parse(init.body);
    if (body && typeof body.model === "string" && body.model !== model) {
      body.model = model;
      return { ...init, body: JSON.stringify(body) };
    }
  } catch {
    // body 非 JSON（理论上不会出现）→ 原样返回，不破坏请求
  }
  return init;
}

/** 流式对话首响应超时：主/备模型在此时长内未开始返回内容即判定失败（只卡首字节，不约束总时长） */
const FIRST_RESPONSE_TIMEOUT_MS = 10_000;

/**
 * fetch 后等待首个数据块：FIRST_RESPONSE_TIMEOUT_MS 内未收到即 abort 并抛错。
 * 专用于流式对话——只卡「首响应」，长回复（如作文、全班报告）不会被掐断；
 * 超时抛错后由上层（buildFailoverFetch）切备用重试。
 */
async function fetchWithFirstByteTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  // 兼容调用方（AI SDK 客户端断开）的 signal：任一中止即中止本次请求
  const outerSignal = init?.signal;
  if (outerSignal?.aborted) {
    controller.abort();
  } else if (outerSignal) {
    outerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), FIRST_RESPONSE_TIMEOUT_MS);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    if (!res.body) {
      clearTimeout(timer); // 无 body（HTTP 错误响应等）→ 停掉首响应定时器再原样返回
      return res;
    }
    const reader = res.body.getReader();
    const first = await reader.read();
    clearTimeout(timer);
    // 重组流：把已读出的首个 chunk 放回去，保证内容不丢失
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        if (first.done) {
          c.close();
          return;
        }
        c.enqueue(first.value!);
      },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) c.close();
        else c.enqueue(value);
      },
      cancel(reason) {
        reader.cancel(reason);
      },
    });
    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error)?.name === "AbortError") {
      throw new Error(`AI 服务响应超时（${FIRST_RESPONSE_TIMEOUT_MS / 1000} 秒内未开始返回内容）`);
    }
    throw err;
  }
}

/**
 * 构建带「熔断感知 + 主→备」切换的 fetch 包装。
 * 失败判定：网络错误（fetch reject）、首响应超时（10s）、HTTP 4xx/5xx（key 无效/模型不存在/无权限/限流/服务端）→ 切备用重试一次。
 * 注意：模型层「空流/内容不支持」在此层不可见（fetch 已 200 返回），由调用方现有逻辑处理。
 */
function buildFailoverFetch(
  route: AIConfigRoute,
  primary: Endpoint,
  backup?: Endpoint,
  /** 主失败切到备用成功后回调（供上层在流中注入「正在切换模型」提示） */
  onFailover?: () => void
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    // 熔断期内直接走备用，避免每次都等主模型超时
    const useBackupFirst = !!backup && isPrimaryOpen(route);
    const first = useBackupFirst ? backup! : primary;
    const firstUrl = rewriteBaseUrl(url, primary.baseURL, first.baseURL);

    try {
      const res = await fetchWithFirstByteTimeout(
        firstUrl,
        withBodyModel(withAuth(init, first.apiKey), first.model)
      );
      // 主模型 HTTP 级失败（4xx：key 无效/模型不存在/无权限/限流；5xx：服务端故障）→ 切备用
      if (!useBackupFirst && backup && res.status >= 400) {
        reportPrimaryFailure(route);
        onFailover?.();
        console.warn(
          `[ai][failover] 线路「${route}」主模型 HTTP ${res.status}（${first.model}）→ 切备用（${backup.model}）`
        );
        const backupRes = await fetchWithFirstByteTimeout(
          rewriteBaseUrl(url, primary.baseURL, backup.baseURL),
          withBodyModel(withAuth(init, backup.apiKey), backup.model)
        );
        if (backupRes.status >= 400) {
          console.warn(
            `[ai][failover] 线路「${route}」备用也失败 HTTP ${backupRes.status}（${backup.model}）→ 透传备用错误`
          );
        }
        return backupRes;
      }
      if (!useBackupFirst) reportPrimarySuccess(route);
      return res;
    } catch (err) {
      if (!useBackupFirst && backup) {
        // 网络级失败 / 首响应超时 → 切备用重试
        reportPrimaryFailure(route);
        onFailover?.();
        return fetchWithFirstByteTimeout(
          rewriteBaseUrl(url, primary.baseURL, backup.baseURL),
          withBodyModel(withAuth(init, backup.apiKey), backup.model)
        );
      }
      throw err;
    }
  };
}

/**
 * 关闭推理时的 fetch 中间件：向 chat/completions 请求体注入
 * thinking={type:"disabled"}，彻底关闭 DeepSeek 推理模型的"思考"阶段。
 * 实测全班分析从约 54s 降至约 18s，正文质量不受影响。
 * （@ai-sdk/openai 不透传 thinking 字段，只能借自定义 fetch 注入）
 */
function buildNoThinkingFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    let nextInit = init;
    if (nextInit?.body && typeof nextInit.body === "string") {
      try {
        const body = JSON.parse(nextInit.body);
        if (body && body.model && !body.thinking) {
          body.thinking = { type: "disabled" };
          nextInit = { ...nextInit, body: JSON.stringify(body) };
        }
      } catch {
        // body 非 JSON（非 chat 请求）时忽略
      }
    }
    return baseFetch(input, nextInit);
  };
}

export async function createDashScopeClient(
  route: AIConfigRoute = "text",
  hooks?: { onFailover?: () => void }
) {
  const config = await getAIConfig(route);
  // 排查日志：每次对话请求打印当前线路的主备配置，确认备用是否生效
  console.log(
    `[ai] 线路「${config._route}」主=${config._primary.model}@${config._primary.baseURL}，` +
      `备=${config._backup ? `${config._backup.model}@${config._backup.baseURL}` : "未配置"}`
  );
  // 先做 noThinking 注入，再做主备 failover（改 URL/Header）——顺序：注入 body → 切换端点
  const failoverFetch = buildFailoverFetch(
    config._route,
    config._primary,
    config._backup,
    hooks?.onFailover
  );
  const fetchImpl: typeof fetch = config.reasoningEnabled
    ? failoverFetch
    : buildNoThinkingFetch(failoverFetch);
  const client = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    // reasoningEnabled 关闭时才注入；开启时走原生 fetch（保留深度推理）
    fetch: fetchImpl,
  });
  return {
    chatModel: client.chat(config.model),
    reasoningEnabled: config.reasoningEnabled,
  };
}

/**
 * 直连 chat/completions 的统一 fetch：超时上限 + 网络级重试 + 熔断共享 + 友好错误信息。
 * （2026-10-15 调整：熔断状态全局共享——主模型被判故障（对话/报告任一触发）后，
 *  报告生成也直接用备用；未熔断时主优先，HTTP 失败（4xx/5xx：key 无效/模型不存在/限流/服务端）
 *  切备重试（请求未开始生成，零浪费），300s 超时不切备（切换=重新生成，浪费已跑时长）。）
 *
 * 为什么要有这个函数：
 * 🧪 MEASURED 2026-09-25：老师生成探究 AI 报告时 api.deepseek.com 瞬时不可达，
 *   两次请求各 ~13s 后以 undici「fetch failed」告终（500 原样透传，老师只看到
 *   「生成失败: fetch failed」）；约 40 分钟后同一请求 14.9s 成功——纯网络抖动，
 *   但当时无超时、无重试、错误信息不可读，一次抖动直接变成用户可见故障。
 *
 * ⚠️ GOTCHA：网络级失败（连接被拒/DNS）同端点重试 1 次；
 *   HTTP 4xx/5xx（key 无效/模型不存在/无权限/限流/服务端）→ 切备用重试（请求未开始生成，零浪费；
 *   实测「model 不存在」返回 400/403/404，必须切备才能救活当前请求）；
 *   300s 超时（已开始生成）不切备——避免重新生成浪费。
 *   主模型失败（网络/超时/4xx/5xx）计入熔断（reportPrimaryFailure），对话等应用随之切备用。
 *
 * 🔗 RELATED（新增直连 chat/completions 时必须改用本函数，不要再裸写 fetch）：
 *   - src/lib/ai-grading.ts（gradeByAI / generateTeachingAdvice）
 *   - src/app/api/exploration-activities/[id]/analysis/generate/route.ts
 *   - src/app/api/quiz-activities/[id]/report/generate/route.ts
 *   - src/app/api/quiz-activities/generate-preview/route.ts
 *   - src/app/api/quiz-activities/route.ts
 *   - src/app/api/system-config/test/route.ts 是连通性诊断工具，故意保留裸 fetch（重试会掩盖真实断网）
 */
const AI_FETCH_TIMEOUT_MS = 300_000; // 报告类长任务单次硬上限：全班报告实测 ~60s，300s 兜底大班/复杂报告；超时不重试不切备
const AI_FETCH_RETRIES = 1; // 网络级瞬时失败（连接被拒/DNS）自动重试 1 次（共 2 次尝试）

export async function chatCompletionsFetch(
  aiConfig: { baseURL: string; apiKey: string } & Partial<{
    _route: AIConfigRoute;
    _primary: Endpoint;
    _backup?: Endpoint;
  }>,
  body: Record<string, unknown>
): Promise<Response> {
  const route = aiConfig._route ?? "text";
  const primary: Endpoint =
    aiConfig._primary ?? {
      baseURL: aiConfig.baseURL,
      apiKey: aiConfig.apiKey,
      model: "qwen-turbo",
    };
  const backup = aiConfig._backup;
  const payload = JSON.stringify(body);

  // 熔断状态全局共享：主被判故障（对话/报告任一触发）→ 直接用备用。
  // 未熔断时主优先；HTTP 失败（401 key 无效/429 限流/5xx 故障）→ 切备重试（请求未开始生成，零浪费）；
  // 300s 超时（已开始生成）→ 不切备重试（避免重新生成浪费）。
  const useBackup = !!backup && isPrimaryOpen(route);
  const endpoints: Endpoint[] = useBackup
    ? [backup!]
    : backup
      ? [primary, backup]
      : [primary];
  let lastErr: unknown = null;
  let lastResponse: Response | null = null;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const url = `${ep.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const maxAttempts = 1 + AI_FETCH_RETRIES; // 网络级瞬时失败同端点重试 1 次（快）
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ep.apiKey}`,
          },
          body: payload,
          signal: AbortSignal.timeout(AI_FETCH_TIMEOUT_MS),
        });
        if (res.status >= 400) {
          // HTTP 级失败（4xx：key 无效/模型不存在/无权限/限流；5xx：服务端）→ 计入熔断并换下一端点
          if (ep === primary) reportPrimaryFailure(route);
          lastResponse = res;
          break; // 跳出内层，外层换下一端点（若有）
        }
        if (ep === primary) reportPrimarySuccess(route);
        return res;
      } catch (err) {
        lastErr = err;
        if (ep === primary) reportPrimaryFailure(route);
        const isTimeout =
          (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
        if (isTimeout) {
          // 300s 超时：已开始生成，不切备重试（避免重新生成浪费），直接判定失败
          throw new Error(
            `AI 服务响应超时（${AI_FETCH_TIMEOUT_MS / 1000} 秒内未完成），请检查主模型状态后重试`
          );
        }
        const cause = (err as { cause?: unknown })?.cause;
        console.error(
          `[chatCompletionsFetch] 线路「${route}」${ep === primary ? "主" : "备用"}模型第 ${attempt + 1}/${maxAttempts} 次网络级失败:`,
          err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          cause instanceof Error ? `（cause: ${cause.message}）` : ""
        );
        // 连接级失败 → 同端点重试；重试耗尽后外层换下一端点
      }
    }
  }

  if (lastResponse) return lastResponse; // 所有端点 HTTP 失败，返回最后一次失败响应
  console.error("[chatCompletionsFetch] 重试耗尽，最后错误:", lastErr);
  throw new Error(
    `AI 服务连接失败（网络波动或服务不可达，已自动重试 ${AI_FETCH_RETRIES} 次），请检查网络后稍候重试`
  );
}
