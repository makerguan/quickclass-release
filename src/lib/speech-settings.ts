/**
 * 朗读设置的统一配置源（全局一份，跨组件共享）。
 *
 * 学生端有多个使用朗读的位置（「对话思考」页头、「互动探究」面板、每条回答上的朗读按钮），
 * 它们的开关 / 音色 / 语速必须**始终一致**，所以不再各自 useState，统一走这里：
 * - 读写都经 localStorage（同一浏览器全局生效）
 * - 同页面内多个组件通过自定义事件实时同步
 * - 跨标签页通过 storage 事件同步
 */

import { DEFAULT_TTS_VOICE, TTS_VOICE_STORAGE_KEY, isValidTtsVoice } from "./tts-voices";

export interface SpeechSettings {
  /** 是否开启自动朗读（新回答生成后自动播报） */
  enabled: boolean;
  /** 朗读音色（TTS_VOICES 里的 id） */
  voice: string;
  /** 朗读语速（倍速） */
  rate: number;
}

export const DEFAULT_VOICE_RATE = 1.2;
export const MIN_VOICE_RATE = 0.5;
export const MAX_VOICE_RATE = 2;

export const SPEECH_SETTINGS_KEY = "qc-speech-settings";

const CHANGE_EVENT = "qc-speech-settings-change";

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: false,
  voice: DEFAULT_TTS_VOICE,
  rate: DEFAULT_VOICE_RATE,
};

function clampRate(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VOICE_RATE;
  return Math.min(MAX_VOICE_RATE, Math.max(MIN_VOICE_RATE, Math.round(n * 10) / 10));
}

function normalize(raw: unknown): SpeechSettings {
  const o = (raw || {}) as Partial<SpeechSettings>;
  return {
    enabled: o.enabled === true,
    voice: isValidTtsVoice(o.voice) ? o.voice : DEFAULT_TTS_VOICE,
    rate: clampRate(o.rate),
  };
}

/** 读取设置：新键优先；老版本只存了音色的键做一次性迁移 */
function readFromStorage(): SpeechSettings {
  if (typeof window === "undefined") return DEFAULT_SPEECH_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SPEECH_SETTINGS_KEY);
    if (raw) return normalize(JSON.parse(raw));
    // 迁移：老版本用 qc-tts-voice 单独存音色
    const legacyVoice = window.localStorage.getItem(TTS_VOICE_STORAGE_KEY);
    if (isValidTtsVoice(legacyVoice)) {
      return { ...DEFAULT_SPEECH_SETTINGS, voice: legacyVoice };
    }
  } catch {
    /* 读取失败按默认值处理 */
  }
  return DEFAULT_SPEECH_SETTINGS;
}

let cached: SpeechSettings | null = null;

/** 读取当前朗读设置（浏览器端；服务端返回默认值） */
export function getSpeechSettings(): SpeechSettings {
  if (!cached) cached = readFromStorage();
  return cached;
}

/** 更新朗读设置（可只传要改的字段），返回合并后的完整设置 */
export function updateSpeechSettings(patch: Partial<SpeechSettings>): SpeechSettings {
  const next = normalize({ ...getSpeechSettings(), ...patch });
  cached = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* 存储不可用时仅内存生效 */
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }
  return next;
}

/** 订阅朗读设置变化；返回取消订阅函数 */
export function subscribeSpeechSettings(cb: (s: SpeechSettings) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onLocal = (e: Event) => {
    const detail = (e as CustomEvent<SpeechSettings>).detail;
    cb(detail ?? getSpeechSettings());
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SPEECH_SETTINGS_KEY && e.key !== TTS_VOICE_STORAGE_KEY) return;
    cached = readFromStorage();
    cb(cached);
  };
  window.addEventListener(CHANGE_EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}
