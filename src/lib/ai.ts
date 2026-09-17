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
