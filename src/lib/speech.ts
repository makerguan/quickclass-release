/**
 * 学生端对话语音朗读工具
 *
 * 职责：把 AI 生成的 Markdown + LaTeX 回答，清洗成适合中文语音朗读的纯文本，
 * 再交给浏览器原生 SpeechSynthesis 朗读（零依赖、免费）。
 *
 * 四级清洗（textToSpeechText）：
 *   1. stripMarkdownForSpeech —— 剥离 Markdown 结构（代码块、链接、加粗等）
 *   2. stripNonSpeechIcons —— 删除不应朗读的方向箭头与 emoji 图标（👍⭐☀️→ 等）
 *   3. latexToSpeech —— 把 $...$ 内的 LaTeX 公式翻译成中文口语（分数、根号、上标、符号）
 *   4. replaceUnicodeMath —— Unicode 数学符号兜底替换（× ÷ ≤ ≥ π √ 等）
 *
 * 朗读（speak）：按句切分逐条朗读，规避 Chrome 对超长 utterance 静默截断的已知问题。
 *
 * 音色（pickChineseVoice）：在**浏览器内置朗读**这条回退路径上挑音色。
 *   这里**优先本机自带（localService）的中文音色**：名字含 Natural/Online 的微软音色
 *   其实是**云端**音色，教室没有外网时反而不出声 —— 回退路径要的是"稳定出声"，
 *   音质交给上面的服务端合成负责。
 *
 * 高质量朗读（speakSmart）——学生端统一入口：
 *   先用 `/api/tts` 登记文本，再用原生 `<audio>` 播放 `/api/tts/audio/<id>`。
 *   服务端是**流式**返回的（边合成边推），所以约半秒就能出声，且音色由服务端决定，
 *   与学生电脑装了什么系统音色无关。服务端不可用、或浏览器拦截自动播放时，
 *   自动回退到上面的浏览器内置朗读。
 *
 * 开关 / 音色 / 语速统一存在 `speech-settings`，多个使用朗读的组件共享同一份配置。
 */

import {
  DEFAULT_VOICE_RATE,
  MAX_VOICE_RATE,
  MIN_VOICE_RATE,
  getSpeechSettings,
} from "./speech-settings";
import { replacePinyinWithHanzi } from "./pinyin-to-hanzi";

// ---------- 语音默认语速（倍速） ----------
export { DEFAULT_VOICE_RATE };

// ---------- 第三级：Unicode 数学符号 → 中文口语 ----------
const UNICODE_MATH_MAP: Record<string, string> = {
  "×": "乘",
  "÷": "除以",
  "≤": "小于等于",
  "≥": "大于等于",
  "≠": "不等于",
  "≡": "恒等于",
  "≈": "约等于",
  "√": "根号",
  "π": "派",
  "∞": "无穷",
  "∑": "求和",
  "∏": "求积",
  "∫": "积分",
  "°": "度",
  "²": "平方",
  "³": "立方",
  "±": "正负",
  "∈": "属于",
  "∉": "不属于",
  "∪": "并",
  "∩": "交",
  "⊥": "垂直",
  "∥": "平行",
  "∠": "角",
  "△": "三角形",
  "α": "阿尔法",
  "β": "贝塔",
  "γ": "伽马",
  "δ": "德尔塔",
  "θ": "西塔",
  "λ": "拉姆达",
  "μ": "缪",
  "σ": "西格玛",
  "φ": "斐",
  "ω": "欧米伽",
  "Δ": "德尔塔",
  "Ω": "欧米伽",
};

// ---------- LaTeX 命令 → 中文口语 ----------
const GREEK_LATEX: Record<string, string> = {
  "\\pi": "派",
  "\\theta": "西塔",
  "\\alpha": "阿尔法",
  "\\beta": "贝塔",
  "\\gamma": "伽马",
  "\\delta": "德尔塔",
  "\\lambda": "拉姆达",
  "\\mu": "缪",
  "\\sigma": "西格玛",
  "\\phi": "斐",
  "\\omega": "欧米伽",
  "\\Delta": "德尔塔",
  "\\Omega": "欧米伽",
  "\\infty": "无穷",
};

const FUNC_LATEX: Record<string, string> = {
  "\\sin": "正弦",
  "\\cos": "余弦",
  "\\tan": "正切",
  "\\cot": "余切",
  "\\log": "对数",
  "\\ln": "自然对数",
  "\\lim": "极限",
  "\\max": "最大值",
  "\\min": "最小值",
};

const OP_LATEX: Record<string, string> = {
  "\\times": "乘",
  "\\cdot": "乘以",
  "\\div": "除以",
  "\\pm": "正负",
  "\\mp": "负正",
  "\\leq": "小于等于",
  "\\geq": "大于等于",
  "\\neq": "不等于",
  "\\approx": "约等于",
  "\\lt": "小于",
  "\\gt": "大于",
  "\\le": "小于等于",
  "\\ge": "大于等于",
  "\\ne": "不等于",
  "\\sim": "相似于",
  "\\equiv": "恒等于",
  "\\rightarrow": "箭头",
  "\\to": "箭头",
  "\\Rightarrow": "推出",
  "\\leftarrow": "箭头",
  "\\Leftrightarrow": "等价于",
  "\\sum": "求和",
  "\\prod": "求积",
  "\\int": "积分",
  "\\angle": "角",
  "\\triangle": "三角形",
  "\\perp": "垂直",
  "\\parallel": "平行",
  "\\circ": "度",
  "\\cdots": "等等",
  "\\ldots": "等等",
  "\\therefore": "所以",
  "\\because": "因为",
};

// 合并并按命令长度降序，保证 \leq 优先于 \le、\geq 优先于 \ge 等前缀命令
const ALL_LATEX: Record<string, string> = { ...GREEK_LATEX, ...FUNC_LATEX, ...OP_LATEX };
const ALL_LATEX_KEYS = Object.keys(ALL_LATEX).sort((a, b) => b.length - a.length);

function replaceLatexCommands(s: string): string {
  let out = s;
  for (const k of ALL_LATEX_KEYS) {
    out = out.split(k).join(ALL_LATEX[k]);
  }
  return out;
}

/** 从 start（指向 '{'）开始，返回第一个配对花括号内的内容与 '}' 的位置；不配对返回 null */
function extractBraces(s: string, start: number): { content: string; end: number } | null {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return { content: s.slice(start + 1, i), end: i };
    }
  }
  return null;
}

function supToSpeech(t: string): string {
  if (t === "2") return "的平方";
  if (t === "3") return "的三次方";
  if (t.startsWith("减")) return "的负" + t.slice(1) + "次方";
  return "的" + t + "次方";
}

function subToSpeech(t: string): string {
  return "下标" + t;
}

function replaceFrac(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("\\frac", i)) {
      const numStart = s.indexOf("{", i + 5);
      const num = numStart !== -1 ? extractBraces(s, numStart) : null;
      const denStart = num ? s.indexOf("{", num.end + 1) : -1;
      const den = denStart !== -1 ? extractBraces(s, denStart) : null;
      if (num && den) {
        // 中文语序：分母在前，读「分母分之分子」，如 \frac{1}{2} → 二分之一
        result += latexToSpeech(den.content) + "分之" + latexToSpeech(num.content);
        i = den.end + 1;
        continue;
      }
    }
    result += s[i];
    i++;
  }
  return result;
}

function replaceSqrt(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("\\sqrt", i)) {
      const after = i + 5;
      let degree = "";
      let braceStart = -1;
      if (s[after] === "[") {
        const close = s.indexOf("]", after);
        if (close !== -1) {
          degree = s.slice(after + 1, close);
          braceStart = s.indexOf("{", close + 1);
        }
      } else {
        braceStart = s.indexOf("{", after);
      }
      const body = braceStart !== -1 ? extractBraces(s, braceStart) : null;
      if (body) {
        result += degree ? latexToSpeech(degree) + "次根号" : "根号";
        result += latexToSpeech(body.content);
        i = body.end + 1;
        continue;
      }
    }
    result += s[i];
    i++;
  }
  return result;
}

function replaceSupSub(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if ((ch === "^" || ch === "_") && i > 0) {
      let content = "";
      let end = i + 1;
      if (s[i + 1] === "{") {
        const b = extractBraces(s, i + 1);
        if (b) {
          content = b.content;
          end = b.end + 1;
        } else {
          result += ch;
          i++;
          continue;
        }
      } else {
        content = s[i + 1] ?? "";
        end = i + 2;
      }
      const spoken = latexToSpeech(content);
      result += ch === "^" ? supToSpeech(spoken) : subToSpeech(spoken);
      i = end;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

/** 把一段 LaTeX 公式源码翻译成中文口语 */
export function latexToSpeech(latex: string): string {
  let s = latex.trim();
  s = s.replace(/\$\$/g, "").replace(/\$/g, "");
  if (!s) return "";

  // 统一分数命令变体
  s = s.replace(/\\dfrac/g, "\\frac").replace(/\\tfrac/g, "\\frac");

  // 提取 \text{...} / \mathrm{...} 等命令包裹的普通文字
  s = s.replace(/\\text\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\mbox\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\mathrm\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\textbf\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\qquad/g, " ");
  s = s.replace(/\\quad/g, " ");

  s = replaceFrac(s);
  s = replaceSqrt(s);

  // 度数 ^\circ → 度（必须先于一般上标处理，避免 ^ 吃掉反斜杠）
  s = s.replace(/\^\s*\\circ/g, "度").replace(/\^\{\s*\\circ\s*\}/g, "度");

  s = replaceSupSub(s);
  s = replaceLatexCommands(s);

  // 残留清理
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\,|\\;|\\!|\\ /g, "");
  s = s
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\%/g, "%")
    .replace(/\\&/g, "&")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_");
  s = s.replace(/\\[a-zA-Z]+/g, ""); // 未覆盖的 LaTeX 命令：直接删除，避免读出英文
  s = s.replace(/\\/g, ""); // 残留反斜杠
  // 裸运算符与结构符号 → 中文读法（括号等直接省略）
  s = s
    .replace(/\+/g, "加")
    .replace(/-/g, "减")
    .replace(/=/g, "等于")
    .replace(/</g, "小于")
    .replace(/>/g, "大于")
    .replace(/[()[\]{}|]/g, "");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/** 剥离 Markdown 结构，只保留适合朗读的纯文本 */
export function stripMarkdownForSpeech(markdown: string): string {
  let s = markdown;
  // 围栏代码块
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/~~~[\s\S]*?~~~/g, " ");
  // 行内代码
  s = s.replace(/`[^`]*`/g, " ");
  // 图片（先于链接处理）
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  // 链接 [text](url) → text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // 标题 / 列表 / 引用
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  s = s.replace(/^\s*>\s?/gm, "");
  // 表格：去掉竖线与分隔行
  s = s.replace(/^\s*\|/gm, "");
  s = s.replace(/^\s*[-:|]+\s*$/gm, " ");
  // 加粗 / 斜体 / 删除线（仅用 * 与 ~，避免 _ 与下标 x_1 冲突）
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/~~([^~]+)~~/g, "$1");
  // HTML 标签
  s = s.replace(/<[^>]+>/g, " ");
  return s;
}

/** Unicode 数学符号兜底替换 */
export function replaceUnicodeMath(s: string): string {
  let out = s;
  for (const [sym, word] of Object.entries(UNICODE_MATH_MAP)) {
    out = out.split(sym).join(word);
  }
  return out;
}

// ---------- 第四级：删除不应朗读的图标 ----------
// 方向箭头（→←↑↓⇒⇔ 等，U+2190–21FF）与 emoji 图标（👍⭐☀️🎉 等），
// 属于表情/装饰/方向示意，朗读无意义，直接删除。
const NON_SPEECH_SYMBOLS_RE =
  /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}]/gu;

function stripNonSpeechIcons(s: string): string {
  return s.replace(NON_SPEECH_SYMBOLS_RE, "");
}

/** 三级清洗：把 Markdown + LaTeX 回答转换为适合朗读的中文纯文本 */
export function textToSpeechText(markdown: string): string {
  let s = stripMarkdownForSpeech(markdown);
  // 方向箭头、emoji 图标（👍⭐☀️→ 等）不朗读，先删除
  s = stripNonSpeechIcons(s);
  // LaTeX 公式：$$...$$ 优先，再行内 $...$
  s = s.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g, (_m, block, inline) =>
    latexToSpeech(block ?? inline ?? "")
  );
  s = replaceUnicodeMath(s);
  // 语文课注音（"数读 shǔ"）：浏览器内置朗读会把拼音罗马字按字母逐个念（s-h-u），
  // 这里把带声调的拼音音节转成读音对应的汉字（shǔ→鼠），任何 TTS 按汉字发音必读对。
  // 服务端 Edge 合成本就能拼读拼音，替换成汉字读音一致，无副作用（见 pinyin-to-hanzi.ts）。
  s = replacePinyinWithHanzi(s);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ---------- 音色选择（仅用于「浏览器内置朗读」这条回退路径） ----------
// speechSynthesis 若不指定 voice，会用系统默认音色，质量完全取决于客户端环境：
// 有的机器落到微软老式 SAPI（Microsoft David / Huihui 等）甚至 Linux 的 eSpeak。
//
// 这里挑音色的目标**不是"最好听"，而是"最可能出得了声"**（老师可能把 QuickClass
// 部署在没有外网的教室里）：
//   ① 先用 `localService === true` 滤出**本机自带**的音色 —— 这类音色离线可用
//   ② 再按下面的关键词顺序匹配常见中文音色
//   ③ 兜底：第一个中文音色；一个中文音色都没有时返回 null（交给浏览器默认）
//
// 为什么不优先 Natural/Online：那是微软的**云端**神经音色（音质确实最好），
// 但需要联网 —— 没外网时选中它会**静音**，等于把"回退保底"这件事做没了。
// 高音质由服务端合成（speakSmart）负责，这条路只负责"一定有声音"。
const VOICE_NAME_PRIORITY = [
  // 微软边缘/Windows 神经音色（在线，需系统已安装对应语音包）
  "xiaoxiao",
  "xiaoyi",
  "xiaochen",
  "xiaohan",
  "yunxi",
  "yunyang",
  "yunjian",
  "yunxia",
  // 微软 Windows 本地音色
  "huihui",
  "yaoyao",
  "kangkang",
  // Chrome / macOS / 其他
  "google 普通话",
  "google 中文",
  "ting-ting",
  "tingting",
  "mei-jia",
  "meijia",
  "sin-ji",
  "sinji",
];

const ZH_LANG_RE = /^zh(-|_)?(cn|hans|sg|tw|hk)?/i;
const ZH_NAME_RE = /chinese|中文|普通话|国语|國語/i;

let cachedVoice: SpeechSynthesisVoice | null = null;

function isChineseVoice(v: SpeechSynthesisVoice): boolean {
  return ZH_LANG_RE.test(v.lang || "") || ZH_NAME_RE.test(v.name || "");
}

/** 从系统音色列表里挑一个最自然的中文音色；取不到时返回 null */
export function pickChineseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const all = window.speechSynthesis.getVoices();
  if (!all || all.length === 0) return null;

  const zhPool = all.filter(isChineseVoice);
  const candidates = zhPool.length > 0 ? zhPool : all;

  // ① 本机自带的音色优先（离线可用）。若这台机器只有云端音色，就退回全集（行为同以前）
  const localOnly = candidates.filter((v) => v.localService === true);
  const pool = localOnly.length > 0 ? localOnly : candidates;

  // ② 关键词优先级
  for (const kw of VOICE_NAME_PRIORITY) {
    const hit = pool.find((v) => (v.name || "").toLowerCase().includes(kw));
    if (hit) return hit;
  }

  // ③ 兜底：池子里第一个不是云端音色的；实在没有就拿第一个
  const plain = pool.find((v) => !/natural|online/i.test(v.name || ""));
  return plain ?? pool[0] ?? null;
}

/** 取音色（带缓存）。Chrome 首次 getVoices() 常返回空数组，需等 voiceschanged 事件再取 */
function resolveVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  cachedVoice = pickChineseVoice();
  if (cachedVoice) return cachedVoice;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  window.speechSynthesis.addEventListener(
    "voiceschanged",
    () => {
      if (!cachedVoice) cachedVoice = pickChineseVoice();
    },
    { once: true }
  );
  return null;
}

/** 停止当前朗读（服务端合成音频与浏览器内置朗读一起停） */
export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  releaseAudio();
  setSpeakingOwner(null);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** 朗读一段 Markdown 回答（清洗后按句切分，逐条朗读） */
export function speak(markdown: string, rate = DEFAULT_VOICE_RATE, onEnd?: () => void): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  stopSpeaking();
  const clean = textToSpeechText(markdown);
  if (!clean) return;
  const voice = resolveVoice();
  const sentences =
    clean
      .match(/[^。！？!?；;]+[。！？!?；;]?/g)
      ?.map((x) => x.trim())
      .filter(Boolean) ?? [];
  const chunks = sentences.length > 0 ? sentences : [clean];
  chunks.forEach((text, index) => {
    const utter = new SpeechSynthesisUtterance(text);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang || "zh-CN";
    } else {
      utter.lang = "zh-CN";
    }
    utter.rate = rate;
    utter.pitch = 1;
    if (index === chunks.length - 1 && onEnd) {
      utter.onend = onEnd;
      utter.onerror = onEnd;
    }
    window.speechSynthesis.speak(utter);
  });
}

// ---------- 服务端高质量合成（音色可选，失败自动回退浏览器朗读） ----------

/** 正在播放的服务端合成音频 */
let currentAudio: HTMLAudioElement | null = null;
/** 朗读请求序号：用于丢弃被新一段朗读取代的旧请求 */
let speakSeq = 0;

// ---------- 朗读状态广播（供"每条回答上的朗读按钮"显示播放中/已停止） ----------
let speakingOwner: string | null = null;
const speakingSubs = new Set<(owner: string | null) => void>();

function setSpeakingOwner(owner: string | null): void {
  if (speakingOwner === owner) return;
  speakingOwner = owner;
  speakingSubs.forEach((fn) => fn(owner));
}

/** 订阅"当前正在朗读哪一条"；返回取消订阅函数 */
export function subscribeSpeakingOwner(cb: (owner: string | null) => void): () => void {
  speakingSubs.add(cb);
  cb(speakingOwner);
  return () => {
    speakingSubs.delete(cb);
  };
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_VOICE_RATE;
  return Math.min(MAX_VOICE_RATE, Math.max(MIN_VOICE_RATE, rate));
}

/** 播放一定时间后仍未出声，判定为启动失败（避免一直干等） */
function startWatchdog(ms: number): { cancel: () => void; promise: Promise<never> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("朗读启动超时")), ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

function releaseAudio(): void {
  if (!currentAudio) return;
  const audio = currentAudio;
  currentAudio = null;
  try {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load(); // 中止仍在进行的流式下载，省流量
  } catch {
    /* ignore */
  }
}

// ---------- 服务端高质量合成（流式播放，失败自动回退浏览器朗读） ----------

/** 登记朗读文本，拿到可交给 <audio> 播放的 id */
async function registerTts(text: string, voice: string): Promise<string> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) throw new Error("登记朗读文本失败");
  const data = (await res.json()) as { ok?: boolean; id?: string };
  if (!data?.ok || !data.id) throw new Error("登记朗读文本失败");
  return data.id;
}

/**
 * 等待系统音色列表就绪（Chrome 首次 getVoices() 返回空数组，需等 voiceschanged 事件）。
 * 超时仍为空 → 这台设备没有可用的语音引擎（安卓平板常见：无 GMS 或 Google 语音服务
 * 不可达时 speechSynthesis 存在但永远无声），返回 false。
 */
function waitForVoices(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve(false);
      return;
    }
    const synth = window.speechSynthesis;
    if ((synth.getVoices() || []).length > 0) {
      resolve(true);
      return;
    }
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", onChange);
      resolve(ok);
    };
    const onChange = () => {
      if ((synth.getVoices() || []).length > 0) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    synth.addEventListener("voiceschanged", onChange);
  });
}

export type SpeakResult = "server" | "fallback" | "no-voice" | "none";

/**
 * 学生端朗读统一入口：优先服务端**流式**合成，失败自动回退浏览器内置朗读。
 *
 * @param markdown 回答原文（Markdown + LaTeX，内部会清洗成朗读文本）
 * @param opts.owner 调用方标识（每条回答上的朗读按钮各自一个），用于回显"正在朗读"
 */
export async function speakSmart(
  markdown: string,
  opts: { owner?: string } = {}
): Promise<SpeakResult> {
  if (typeof window === "undefined") return "none";
  const text = textToSpeechText(markdown);
  if (!text) return "none";

  const { voice, rate } = getSpeechSettings();
  const seq = ++speakSeq;
  releaseAudio();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();

  // ① 服务端流式合成：原生 <audio> 边收边播，实测约半秒出声
  try {
    const id = await registerTts(text, voice);
    // 取文本期间又触发了新的朗读 → 丢弃这一段，也不回退（新的那段会自己播）
    if (seq !== speakSeq) return "none";

    const audio = new Audio(`/api/tts/audio/${id}`);
    // 语速交给播放器变速（变速不变调），不必每个语速各自合成一份
    audio.playbackRate = clampRate(rate);
    currentAudio = audio;

    const watchdog = startWatchdog(15000);
    try {
      await Promise.race([audio.play(), watchdog.promise]);
    } catch (e) {
      watchdog.cancel();
      if (seq === speakSeq) releaseAudio();
      throw e;
    }
    watchdog.cancel();

    setSpeakingOwner(opts.owner ?? null);
    const done = () => {
      if (currentAudio === audio) {
        currentAudio = null;
        setSpeakingOwner(null);
      }
    };
    audio.onended = done;
    audio.onerror = done;
    return "server";
  } catch {
    if (seq === speakSeq) releaseAudio();
  }

  // ② 回退：浏览器内置朗读（音色取决于学生电脑，但保证"读得出来"）。
  // 安卓平板常见坑：speechSynthesis 存在但系统没有 TTS 引擎（无 GMS / Google 语音被墙），
  // getVoices() 永远为空，speak() 不报错也不出声 —— 先确认真的有音色可用再回退。
  if (seq !== speakSeq) return "none";
  const hasVoice = await waitForVoices();
  if (seq !== speakSeq) return "none";
  if (!hasVoice) return "no-voice";
  speak(markdown, rate, () => {
    if (seq === speakSeq) setSpeakingOwner(null);
  });
  setSpeakingOwner(opts.owner ?? null);
  return "fallback";
}
