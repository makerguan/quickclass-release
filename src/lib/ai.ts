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

export async function createDashScopeClient() {
  const config = await getAIConfig();
  const client = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
  return {
    chatModel: client.chat(config.model),
    reasoningEnabled: config.reasoningEnabled,
  };
}
