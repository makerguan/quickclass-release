/**
 * 服务端高质量语音合成（TTS）可选音色清单。
 *
 * 这里只存**纯数据常量**，客户端与服务端都能安全引用：
 * - 服务端 `/api/tts` 用它做音色白名单（防止任意音色/SSML 注入）
 * - 客户端音色选择用它渲染选项
 *
 * 音色全部来自微软 Edge 在线神经语音（Azure Neural TTS 同源），
 * 由服务端合成 MP3 后返回，因此**不依赖学生电脑装了哪些系统音色**。
 *
 * 面向课堂只保留两个最经典的音色：一男一女，降低学生选择成本。
 */
export interface TtsVoiceOption {
  /** 微软音色标识（Voice ShortName） */
  id: string;
  /** 选择器上显示的短标签 */
  label: string;
  /** 一句话说明 */
  hint: string;
}

export const TTS_VOICES: TtsVoiceOption[] = [
  { id: "zh-CN-XiaoxiaoNeural", label: "女声", hint: "晓晓 · 温婉自然" },
  { id: "zh-CN-YunxiNeural", label: "男声", hint: "云希 · 清亮阳光" },
];

export const DEFAULT_TTS_VOICE = "zh-CN-XiaoxiaoNeural";

/** 旧版单独保存音色时使用的 localStorage 键（保留用于一次性迁移） */
export const TTS_VOICE_STORAGE_KEY = "qc-tts-voice";

/** 判断音色是否在白名单内 */
export function isValidTtsVoice(id: unknown): id is string {
  return typeof id === "string" && TTS_VOICES.some((v) => v.id === id);
}

/** 按 id 取音色定义（含展示用文案） */
export function findTtsVoice(id: unknown): TtsVoiceOption | undefined {
  return typeof id === "string" ? TTS_VOICES.find((v) => v.id === id) : undefined;
}
