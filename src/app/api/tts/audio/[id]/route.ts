import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import {
  acquireSlot,
  BusyError,
  isSafeKey,
  lookupText,
  readCache,
  releaseSlot,
  writeCache,
} from "@/lib/tts-store";

/**
 * 朗读音频**播放**接口（流式）。
 *
 * GET /api/tts/audio/<id>
 *
 * 这是整个朗读体验的关键：把合成结果**边生成边推给浏览器**，
 * 而不是等整段合成完再一次性返回。
 *
 * 实测数据（258 字）：
 * - 整段合成完再返回：约 8–19 秒才开始出声
 * - 改成流式：**首字节约 0.45 秒**，浏览器用原生 `<audio>` 边收边播
 *
 * 失败处理：**首字节到达之前**失败会干净地返回错误状态，前端据此回退到
 * 浏览器内置朗读；首字节之后失败只能中断音频（已经发不出错误码了）。
 *
 * ⚠️ 失败必须**快**：老师可能把 QuickClass 部署在没有外网的教室里，此时学生点朗读
 * 只能靠前端回退到本机音色出声。所以这里把"连不上微软端点"和"连上了但合成慢"分开处理：
 * 前者**短超时 + 不重试**（尽快返 502 触发回退），后者才重试。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 建连超时（毫秒）：连接微软语音端点。
 * 没外网时这一步典型 <1 秒就失败，5 秒是给慢网络的余量 —— 拖长了学生只会干等。
 */
const CONNECT_TIMEOUT_MS = Number(process.env.QC_TTS_CONNECT_TIMEOUT_MS || 5000);
/** 等首字节的超时（毫秒）：已经连上了，只是合成慢，属于抖动，给足余量 */
const FIRST_BYTE_TIMEOUT_MS = Number(process.env.QC_TTS_FIRST_BYTE_TIMEOUT_MS || 15000);
/** 失败重试次数（微软端点偶发连接超时，重试一次能挡掉大部分抖动） */
const MAX_ATTEMPTS = 2;
/** 重试前的等待（毫秒） */
const RETRY_DELAY_MS = 400;

/**
 * 建连阶段失败（连不上微软端点）——典型场景：教室没有外网。
 * 这类失败**不重试**：网络不通时重试只会把"没声音"这件事拖得更久，
 * 而前端一收到 502 就会回退到浏览器内置朗读，学生马上能听到声音。
 */
class ConnectError extends Error {}

/** 是否"网络不可达"类错误（离线、DNS 不通、路由黑洞），这类错误重试没有意义 */
function isUnreachable(e: unknown): boolean {
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNRESET|ETIMEDOUT|EPIPE|ESOCKETTIMEDOUT|UND_ERR)/.test(
      code
    ) ||
    /getaddrinfo|ENOTFOUND|EAI_AGAIN|net::ERR_|socket hang up|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|未连接|连接超时/i.test(
      msg
    )
  );
}

function fail(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === "string") return Buffer.from(v, "binary");
  return Buffer.alloc(0);
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Upstream {
  tts: MsEdgeTTS;
  iterator: AsyncIterator<Buffer>;
  firstBuf: Buffer;
}

/** 建立一条到微软语音端点的合成流，并等到首字节 */
async function startUpstream(voice: string, text: string): Promise<Upstream> {
  const tts = new MsEdgeTTS();
  let iterator: AsyncIterator<Buffer>;
  const connectTimeoutMsg = `连接语音服务超时（${CONNECT_TIMEOUT_MS}ms）`;

  // ① 建连阶段：没外网 / DNS 不通时这里会尽快抛错，归为 ConnectError（不重试）
  try {
    await withTimeout(
      tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3),
      CONNECT_TIMEOUT_MS,
      connectTimeoutMsg
    );
    const res = (await withTimeout(
      tts.toStream(text),
      CONNECT_TIMEOUT_MS,
      connectTimeoutMsg
    )) as unknown as { audioStream: AsyncIterable<Buffer> };
    iterator = res.audioStream[Symbol.asyncIterator]();
  } catch (e) {
    try {
      tts.close();
    } catch {
      /* ignore */
    }
    throw new ConnectError(e instanceof Error ? e.message : String(e));
  }

  // ② 首字节：已经连上了，只是合成慢 —— 属于抖动，给足余量并允许重试。
  //    但若这期间连接被重置（同样是"网络不通"），仍按 ConnectError 处理，不再重试。
  try {
    const first = await withTimeout(
      iterator.next(),
      FIRST_BYTE_TIMEOUT_MS,
      "语音合成首字节超时"
    );
    if (first.done || !first.value) throw new Error("语音合成结果为空");
    return { tts, iterator, firstBuf: toBuffer(first.value) };
  } catch (e) {
    try {
      tts.close();
    } catch {
      /* ignore */
    }
    if (isUnreachable(e)) throw new ConnectError(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = String(params?.id || "");
  if (!isSafeKey(id)) return fail(404, "无效的音频标识");

  // ① 磁盘缓存命中：直接整段返回（实测约 8ms，几乎零成本）
  const cached = await readCache(id);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(cached.length),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  // ② 取回登记的文本；进程重启后注册表为空，但只要音频已缓存仍可播放
  const entry = lookupText(id);
  if (!entry) return fail(404, "朗读内容已过期，请重新发起朗读");

  // ③ 排队拿合成名额（保护微软端点，避免并发失败）
  try {
    await acquireSlot();
  } catch (e) {
    if (e instanceof BusyError) return fail(503, "语音合成繁忙，请稍后重试");
    throw e;
  }

  // ④ 合成（连不上→立刻失败；抖动类失败→重试一次）
  let up: Upstream | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      up = await startUpstream(entry.voice, entry.text);
      break;
    } catch (e) {
      lastError = e;
      // 网络不通（最常见：教室没有外网）→ 不再重试，尽快返 502 让前端回退到本机朗读
      if (e instanceof ConnectError || isUnreachable(e)) break;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  if (!up) {
    releaseSlot();
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    return fail(502, "语音合成失败：" + msg);
  }

  const ready = up;
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    try {
      ready.tts.close();
    } catch {
      /* ignore */
    }
    try {
      void ready.iterator.return?.();
    } catch {
      /* ignore */
    }
    releaseSlot();
  };

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const collected: Buffer[] = [ready.firstBuf];
      controller.enqueue(new Uint8Array(ready.firstBuf));
      try {
        for (;;) {
          const next = await ready.iterator.next();
          if (next.done) break;
          const buf = toBuffer(next.value);
          if (!buf.length) continue;
          collected.push(buf);
          controller.enqueue(new Uint8Array(buf));
        }
        controller.close();
        // 流正常结束才落缓存，避免把截断的音频缓存下来
        void writeCache(id, Buffer.concat(collected));
      } catch (e) {
        try {
          controller.error(e as Error);
        } catch {
          /* ignore */
        }
      } finally {
        finish();
      }
    },
    cancel() {
      finish();
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Accel-Buffering": "no",
    },
  });
}
