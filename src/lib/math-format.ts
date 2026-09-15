/**
 * 数学公式格式统一工具
 *
 * 背景：部分模型（Qwen 等）习惯输出标准 LaTeX 定界符 \(...\) 与 \[...\]，
 * 而本项目前端使用的 remark-math / AI伴学渲染器只识别 $...$ 与 $$...$$。
 * 模型写成 \(\tan60^\circ=\sqrt3\) 时，前端会原样把它当普通文本显示，
 * 学生看到的是一串反斜杠代码（看起来就是"乱码"）。
 *
 * 解决分两层：
 * 1. 治本：通过 MATH_OUTPUT_RULES 在 system prompt 里要求模型统一使用 $ 定界符；
 * 2. 兜底：normalizeMathDelimiters 在渲染前把 \(...\)/\[...\] 规范化为 $...$/$$...$$，
 *    既能兜住模型偶尔不听话的情况，也能让数据库里的历史消息正常显示。
 */

/**
 * 数学公式输出规范（注入 AI system prompt 的提示词片段）
 *
 * 注意：本字符串中所有反斜杠都写成双反斜杠，
 * 因为模板字符串会把无法识别的转义（如 \p）中的反斜杠吞掉。
 */
export const MATH_OUTPUT_RULES = `## 数学公式输出规范（必须严格遵守）
本系统前端使用 KaTeX 渲染数学公式，只识别 $ 作为定界符，请务必遵守：
- 行内公式写成 $...$，例如：$\\pi$、$\\sqrt{3}$、$\\frac{1}{2}$、$x^2$、$\\tan 60^\\circ$、$2\\times3$。
- 需要独占一行居中展示的重点公式必须写成三行：第一行只写 $$，第二行写公式本体，第三行只写 $$。不要写成单行的 $$公式$$（那样只会被当作行内公式，不会居中）。
- 严禁使用 \\(...\\) 或 \\[...\\] 定界符：本系统无法识别，会把公式源码（如 \\(\\sqrt{3}\\)）原样显示给学生，学生看到的是一片反斜杠代码。
- 公式内部一律使用标准 LaTeX 命令：圆周率写 \\pi，根号写 \\sqrt{...}，分数写 \\frac{...}{...}，乘号写 \\times，正切写 \\tan，度数写 ^\\circ。
- 不要直接输出 Unicode 数学符号（如 𝜋、√、²、×）来替代公式，改用对应的 $LaTeX$ 表达。
- 中文与公式混排示例：当 $r=2$ 时，圆的面积是 $4\\pi$。`;

/** 把一段非代码文本中的 \(...\) / \[...\] 定界符转换为 $...$ / $$...$$ */
function convertDelimiters(segment: string): string {
  if (
    segment.indexOf("\\(") === -1 &&
    segment.indexOf("\\)") === -1 &&
    segment.indexOf("\\[") === -1 &&
    segment.indexOf("\\]") === -1
  ) {
    return segment;
  }
  // 先处理块级（\[ \]），再处理行内（\( \)）
  // 注意：必须用函数式替换。replace 的字符串参数里 "$$" 表示一个字面 "$"，
  // 直接写 "$$" 会得到单 $ 而不是 $$（块级公式定界符）。
  return segment
    .replace(/\\\[/g, () => "$$")
    .replace(/\\\]/g, () => "$$")
    .replace(/\\\(/g, () => "$")
    .replace(/\\\)/g, () => "$");
}

/**
 * 统一 LaTeX 定界符：\(...\) → $...$，\[...\] → $$...$$
 *
 * 保护范围（不做转换，避免破坏字面代码）：
 * - ``` 或 ~~~ 围栏代码块内的整段内容
 * - 单个反引号包裹的行内代码 `...`
 */
/**
 * 修复 JSON 文本中的非法反斜杠转义
 *
 * 起因：AI 常把 LaTeX 直接写进 JSON（如 {"content":"求 $\pi r^2$ 的值"}），
 * 但 JSON 规范里 \p 不是合法转义符，JSON.parse 会直接抛错；
 * 出题/批阅场景一旦解析失败就会回退到"剥离非 ASCII"的兜底逻辑，
 * 结果是中文全被清掉、题目变成乱码。
 *
 * 做法：把非法转义的反斜杠补成双反斜杠，
 * 合法转义（\" \\ \/ \b \f \n \r \t \uXXXX）原样保留。
 */
export function fixInvalidJsonEscapes(text: string): string {
  return text.replace(/\\(?:u[0-9a-fA-F]{4}|.)/g, (m) => {
    if (/^\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})$/.test(m)) return m;
    return "\\" + m;
  });
}

export function normalizeMathDelimiters(text: string | null | undefined): string {
  const s = String(text == null ? "" : text);
  if (!s) return s;
  if (
    s.indexOf("\\(") === -1 &&
    s.indexOf("\\)") === -1 &&
    s.indexOf("\\[") === -1 &&
    s.indexOf("\\]") === -1
  ) {
    return s;
  }

  const lines = s.split("\n");
  let inFence = false;
  const out: string[] = [];

  for (const line of lines) {
    // 围栏代码块边界：进入/退出时整行原样保留
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // 行内代码按反引号切分，奇数下标为代码片段，跳过转换
    const parts = line.split(/(`[^`]*`)/g);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) continue;
      parts[i] = convertDelimiters(parts[i]);
    }
    out.push(parts.join(""));
  }

  return out.join("\n");
}
