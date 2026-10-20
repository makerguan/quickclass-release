import { generateText } from "ai";
import { createDashScopeClient } from "@/lib/ai";

/** mediaType（如 audio/wav）→ 文件扩展名（与 /api/chat/route.ts 的 mediaTypeToExt 保持一致） */
function mediaTypeToExt(mediaType: string): string {
  const m = mediaType.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("m4a") || m.includes("mp4")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("webm")) return "webm";
  return "audio";
}

/**
 * 用全媒体(omni)模型把语音转写为文字（2026-10-15 需求）：
 * 对话记录既要看文字又能听声音——发送语音时用 omni 模型回吐转写文本，
 * 替换前端占位符"(发送了语音)"后入库；分析链路只取文字。
 *
 * ⛔ DO NOT REVERT: 按用户决策用「全媒体模型转写」而非 DashScope ASR 接口——
 * 复用现有 omni 线路与 key，老师零新增配置；代价是每次语音多一次模型调用。
 * 转写失败（omni 未配置回落 text 模型 / 超时 / 网关报错）返回 null，
 * 由调用方降级保留占位符，不阻塞对话。
 */
export async function transcribeAudioWithOmni(
  parts: Array<{
    type: string;
    text?: string;
    audio_url?: { url: string };
  }>
): Promise<string | null> {
  try {
    const audioPart = parts.find((p) => p.type === "audio_url");
    const url = audioPart?.audio_url?.url;
    if (!url) return null;
    const match = url.match(/^data:(audio\/[\w.+-]+);base64,(.+)$/);
    if (!match) return null;
    const [, mediaType, base64] = match;

    const { chatModel } = await createDashScopeClient("omni");
    const result = await generateText({
      model: chatModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file" as const,
              data: base64,
              mediaType,
              filename: `audio-${Date.now()}.${mediaTypeToExt(mediaType)}`,
            },
            {
              type: "text" as const,
              text: "请把这段语音的内容转写成文字。只输出转写后的文字本身，不要任何解释、前缀或标点修饰。",
            },
          ],
        },
      ],
    });
    const text = result.text?.trim();
    return text || null;
  } catch (error) {
    console.warn(
      "[asr] omni 语音转写失败，降级保留占位符：",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
