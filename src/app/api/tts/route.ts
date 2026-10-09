import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_TTS_VOICE, isValidTtsVoice } from "@/lib/tts-voices";
import { cacheKey, hasCache, normalizeText, registerText } from "@/lib/tts-store";

/**
 * 朗读音频**登记**接口。
 *
 * 学生端要朗读一段文字时，先用本接口登记文本，拿到一个 id，
 * 再用 `/api/tts/audio/<id>` 交给原生 `<audio>` 播放 —— 这样浏览器可以
 * **边接收边播放**（首字节 0.4 秒左右就能出声），也能利用浏览器自身缓存。
 *
 * 为什么不直接返回音频：`<audio>` 标签无法发 POST 请求，而把整段文字塞进
 * URL 查询串会超长（中文编码后每字约 9 字节）。用登记换 id 是最省事的方式。
 *
 * 响应里连同 id 一起回传**清洗后**的文本（`text`）：服务端不可用（例如教室没有外网）
 * 时，调用方要用它做浏览器内置朗读的保底，不能拿原始 Markdown 去念。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { text?: unknown; voice?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const text = normalizeText(body?.text);
  if (!text) return NextResponse.json({ ok: false, error: "缺少朗读文本" }, { status: 400 });

  const voice = isValidTtsVoice(body?.voice) ? body.voice : DEFAULT_TTS_VOICE;
  const id = registerText(voice, text);
  const cached = await hasCache(cacheKey(voice, text));

  // 回传清洗后的文本：调用方（如注入在 iframe 里的 AI 伴学脚本）在服务端合成失败时
  // 要用它做浏览器内置朗读 —— 直接念原文会把 "**"、"$x^2$" 这类符号读出来。
  // 清洗仍只在服务端做一处（lib/tts-store 的 normalizeText），调用方不重复实现。
  return NextResponse.json({ ok: true, id, cached, url: `/api/tts/audio/${id}`, text });
}
