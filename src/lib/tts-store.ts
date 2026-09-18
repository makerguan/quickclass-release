/**
 * 服务端语音合成的支撑设施：文本清洗、磁盘缓存、文本注册表、并发闸门。
 *
 * 设计要点：
 * - **磁盘缓存**：合成结果按 `sha1(音色 + 文本)` 落盘，同一个班级里多人听同一段内容时
 *   只向微软请求一次。缓存目录放在项目内（默认 `.cache/tts`），重启不丢。
 * - **文本注册表**：浏览器用 `/api/tts` 登记文本拿到 id，再用 `/api/tts/audio/<id>` 播放。
 *   这样音频可以用原生 `<audio>` 标签播放，浏览器能边收边播、也能自己缓存。
 *   注册表只在内存里，进程重启后丢失；但**只要音频已在磁盘缓存里，播放依然可用**。
 * - **并发闸门**：微软的免费语音端点对同一 IP 的并发连接有限制（实测 6 路并发会有失败），
 *   因此把同时向微软发起的合成限制在少数几个，其余排队。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { textToSpeechText } from "./speech";

/** 单次合成的文本上限（超长截断，避免请求过大/超时） */
export const MAX_CHARS = 1500;

/** 磁盘缓存目录：项目内，重启不丢；可用环境变量覆盖 */
export const CACHE_DIR =
  process.env.QC_TTS_CACHE_DIR || path.join(process.cwd(), ".cache", "tts");

/** 磁盘缓存容量上限（字节），超出后按最后访问时间淘汰 */
const CACHE_MAX_BYTES = 200 * 1024 * 1024;

/** 同时向微软发起的合成数上限 */
const MAX_CONCURRENT = Number(process.env.QC_TTS_CONCURRENCY || 2);

/** 排队上限：超过则直接失败，让前端走回退，避免请求堆积 */
const MAX_QUEUE = Number(process.env.QC_TTS_MAX_QUEUE || 12);

/** 清洗：朗读场景下这些符号没有意义，同时避免 SSML/XML 结构被破坏 */
export function sanitize(text: string): string {
  return text.replace(/[<>&"']/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 规范化文本（截断到上限）。
 *
 * 朗读清洗放在**服务端**是刻意的：调用方（学生端组件、注入在 iframe 里的 AI 伴学）
 * 只需要把原文丢过来即可，不必各自实现一套清洗 —— 保证同一段文字从任何入口读出来
 * 都一样，缓存键也不会因为调用方不同而分裂。
 * 清洗步骤见 lib/speech 的 textToSpeechText（剥离 Markdown、公式转中文口语等）。
 */
export function normalizeText(raw: unknown): string {
  const src = typeof raw === "string" ? raw : "";
  return sanitize(textToSpeechText(src)).slice(0, MAX_CHARS);
}

/** 缓存键 = sha1(音色 + 文本)；同时作为对外暴露的音频 id */
export function cacheKey(voice: string, text: string): string {
  return crypto.createHash("sha1").update(voice + "\n" + text).digest("hex");
}

/** id 只允许 sha1 的十六进制形式，避免路径穿越 */
export function isSafeKey(id: string): boolean {
  return /^[0-9a-f]{40}$/.test(id);
}

function fileOf(key: string): string {
  return path.join(CACHE_DIR, key + ".mp3");
}

/** 读缓存；未命中返回 null */
export async function readCache(key: string): Promise<Buffer | null> {
  if (!isSafeKey(key)) return null;
  try {
    const buf = await fs.readFile(fileOf(key));
    if (!buf.length) return null;
    // 更新访问时间，供淘汰策略使用
    const now = new Date();
    void fs.utimes(fileOf(key), now, now).catch(() => {});
    return buf;
  } catch {
    return null;
  }
}

export async function hasCache(key: string): Promise<boolean> {
  if (!isSafeKey(key)) return false;
  try {
    const st = await fs.stat(fileOf(key));
    return st.size > 0;
  } catch {
    return false;
  }
}

let lastPrune = 0;

/** 写入缓存；顺带做低频淘汰，避免目录无限增长 */
export async function writeCache(key: string, data: Buffer): Promise<void> {
  if (!isSafeKey(key) || !data.length) return;
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(fileOf(key), data);
  } catch {
    return; // 缓存写失败不影响本次返回
  }
  const now = Date.now();
  if (now - lastPrune > 10 * 60 * 1000) {
    lastPrune = now;
    void pruneCache();
  }
}

/** 按最后访问时间淘汰，直到总量低于上限 */
async function pruneCache(): Promise<void> {
  try {
    const names = await fs.readdir(CACHE_DIR);
    const entries: Array<{ file: string; atime: number; size: number }> = [];
    let total = 0;
    for (const name of names) {
      if (!name.endsWith(".mp3")) continue;
      try {
        const st = await fs.stat(path.join(CACHE_DIR, name));
        entries.push({ file: name, atime: st.atimeMs, size: st.size });
        total += st.size;
      } catch {
        /* 已被删除，忽略 */
      }
    }
    if (total <= CACHE_MAX_BYTES) return;
    entries.sort((a, b) => a.atime - b.atime);
    for (const e of entries) {
      if (total <= CACHE_MAX_BYTES) break;
      try {
        await fs.unlink(path.join(CACHE_DIR, e.file));
        total -= e.size;
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 目录不存在等情况忽略 */
  }
}

// ---------- 文本注册表（id → 文本/音色），进程内 LRU ----------

const REGISTRY_MAX = 300;
const REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;

const registry = new Map<string, { text: string; voice: string; at: number }>();

/** 登记文本，返回可播放的 id */
export function registerText(voice: string, text: string): string {
  const key = cacheKey(voice, text);
  registry.delete(key);
  registry.set(key, { text, voice, at: Date.now() });
  if (registry.size > REGISTRY_MAX) {
    const oldest = registry.keys().next().value;
    if (oldest) registry.delete(oldest);
  }
  return key;
}

/** 按 id 取回文本；不存在或过期返回 null */
export function lookupText(id: string): { text: string; voice: string } | null {
  const hit = registry.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > REGISTRY_TTL_MS) {
    registry.delete(id);
    return null;
  }
  return { text: hit.text, voice: hit.voice };
}

// ---------- 合成并发闸门 ----------

let running = 0;
const waiters: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];

export class BusyError extends Error {}

/**
 * 取得一个合成名额（必要时排队）。名额用完后必须调用 releaseSlot()。
 */
export async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return;
  }
  if (waiters.length >= MAX_QUEUE) throw new BusyError("语音合成排队已满");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      const i = waiters.findIndex((w) => w.timer === timer);
      if (i >= 0) waiters.splice(i, 1);
      resolve(); // 等待超时也放行，由调用方自己控制后续超时
    }, 30000);
    waiters.push({ resolve, timer });
  });
  running++;
}

export function releaseSlot(): void {
  running = Math.max(0, running - 1);
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  }
}

/** 当前并发占用情况（用于诊断） */
export function slotStats() {
  return { running, queued: waiters.length, max: MAX_CONCURRENT };
}
