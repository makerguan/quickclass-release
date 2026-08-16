// 生成错误分类器：根据错误 message 正则匹配分类，不依赖任何硬编码窗口表。
// 用于把后端异常转成结构化 {kind, message, hint}，前端按 kind 渲染可操作提示。

export type GenErrorKind =
  | "CONTEXT_OVERFLOW" // 上下文/输入超窗口
  | "AUTH" // 鉴权失败（401/key 失效）
  | "RATE_LIMIT" // 限流（429）
  | "MODEL_NOT_FOUND" // 模型不存在/不可用
  | "NETWORK" // 网络/超时
  | "PARSE" // 返回内容无法解析为论文结构
  | "UNKNOWN";

export interface GenErrorInfo {
  kind: GenErrorKind;
  message: string;
  hint: string;
}

const HINTS: Record<GenErrorKind, string> = {
  CONTEXT_OVERFLOW:
    "本次数据量超出当前模型的上下文窗口。请在系统设置中切换到上下文更大的模型（如百万级 token 的 qwen-turbo），或减少选中的课堂/数据类型后重试。",
  AUTH:
    "AI 接口鉴权失败，可能是 API Key 失效或过期。请到系统设置检查并重新填写有效的 API Key。",
  RATE_LIMIT:
    "AI 接口触发了限流。请稍候 1–2 分钟再点生成；如频繁触发，可在系统设置降低并发数。",
  MODEL_NOT_FOUND:
    "当前指定的模型不可用或不存在。请到系统设置更换一个可用模型后重试。",
  NETWORK:
    "网络连接异常或 AI 服务超时。请检查网络后重试；若网络有代理限制，需确认能访问 AI 服务。",
  PARSE:
    "AI 返回内容未能解析为规范的论文结构（可能中途被截断）。请重试；若反复出现，建议减少数据量或更换模型。",
  UNKNOWN: "生成过程出现异常。请重试；若反复失败，请查看服务端日志或联系技术支持。",
};

// 顺序敏感：先匹配具体错误，再兜底
const RULES: { kind: GenErrorKind; re: RegExp }[] = [
  { kind: "CONTEXT_OVERFLOW", re: /context length|maximum context|too many tokens|window exceeded|exceed.*length|超出.*上下文|上下文.*超出|too long|prompt.*long|input.*length|length.*exceed/i },
  { kind: "AUTH", re: /401|unauthorized|api key|invalid token|鉴权|未授权|unauthenticated/i },
  { kind: "RATE_LIMIT", re: /429|rate limit|too many requests|请求过于频繁|限流/i },
  { kind: "MODEL_NOT_FOUND", re: /model.*not found|does not exist|unknown model|模型不存在|model_not_found|no such model/i },
  { kind: "NETWORK", re: /fetch failed|econnreset|timeout|etimedout|network|网络|connection|连接|超时/i },
];

export function classifyGenError(e: any): GenErrorInfo {
  const message = e?.message || String(e) || "未知错误";

  // 显式携带 kind 的错误优先（如解析层主动抛出的 PARSE）
  if (e && e.kind && HINTS[e.kind as GenErrorKind]) {
    return { kind: e.kind, message, hint: HINTS[e.kind as GenErrorKind] };
  }

  const msg = message.toLowerCase();
  for (const { kind, re } of RULES) {
    if (re.test(msg)) {
      return { kind, message, hint: HINTS[kind] };
    }
  }
  return { kind: "UNKNOWN", message, hint: `${HINTS.UNKNOWN}错误信息：${message}` };
}
