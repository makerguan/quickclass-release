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
 */

// ---------- 语音默认语速（倍速） ----------
export const DEFAULT_VOICE_RATE = 1.2;

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
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** 停止当前朗读 */
export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

/** 朗读一段 Markdown 回答（清洗后按句切分，逐条朗读） */
export function speak(markdown: string, rate = DEFAULT_VOICE_RATE): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  stopSpeaking();
  const clean = textToSpeechText(markdown);
  if (!clean) return;
  const sentences =
    clean
      .match(/[^。！？!?；;]+[。！？!?；;]?/g)
      ?.map((x) => x.trim())
      .filter(Boolean) ?? [];
  const chunks = sentences.length > 0 ? sentences : [clean];
  for (const text of chunks) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = rate;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  }
}
