/**
 * 学情报告图表生成器（方案 B：AI 只输出 ```chart 数据块，几何由确定性代码计算）
 *
 * 内置对策：
 * - XML 转义：所有文本节点经 esc()，防注入/防非法 SVG
 * - 边界兜底：饼图全 0、单块 100%、折线单点、空数组、负值钳 0、类目过多自动转横向
 * - 长文本：标签按字数截断/换行
 * - 打印：图表容器 break-inside:avoid，防分页切断
 * - 失败降级：任何解析/校验失败 → 原始数据表格，报告永不残缺
 */

export type ChartTheme = "blue" | "green" | "orange";

interface BaseStyle {
  theme?: ChartTheme;
  showValues?: boolean;
}

export interface RadarSpec {
  type: "radar";
  title?: string;
  data: { name: string; value: number }[];
  style?: BaseStyle & { max?: number };
}

export interface BarSpec {
  type: "bar";
  title?: string;
  data: { name: string; value: number }[];
  style?: BaseStyle & { unit?: string; warnBelow?: number };
}

export interface LineSpec {
  type: "line";
  title?: string;
  data: { name: string; value: number }[];
  style?: BaseStyle & { unit?: string };
}

export interface PieSpec {
  type: "pie";
  title?: string;
  data: { name: string; value: number; warn?: boolean }[];
  style?: BaseStyle & { centerLabel?: string };
}

export interface ProgressSpec {
  type: "progress";
  title?: string;
  data: { name: string; value: number }[];
  style?: BaseStyle & { unit?: string; warnBelow?: number };
}

export interface ScatterSpec {
  type: "scatter";
  title?: string;
  data: { name?: string; x: number; y: number }[];
  style?: BaseStyle & { xLabel?: string; yLabel?: string };
}

export type ChartSpec =
  | RadarSpec | BarSpec | LineSpec | PieSpec | ProgressSpec | ScatterSpec;

// ---------- 主题与常量 ----------

const THEMES: Record<ChartTheme, { main: string; from: string; to: string }> = {
  blue: { main: "#0052D9", from: "#5B8CFF", to: "#0052D9" },
  green: { main: "#00A870", from: "#4FD1A5", to: "#00A870" },
  orange: { main: "#ED7B2F", from: "#F8B47C", to: "#ED7B2F" },
};

const WARN = "#E34D59";
const PIE_PALETTE = ["#0052D9", "#00A870", "#ED7B2F", "#8E6CE7", "#2BA4E0", "#94A3B8"];

function themeOf(style?: BaseStyle) {
  return THEMES[style?.theme ?? "blue"] ?? THEMES.blue;
}

// ---------- 工具 ----------

/** XML/HTML 文本转义（防注入） */
const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** 坐标格式化：固定 1 位小数，保证快照确定性 */
const c = (n: number): string => n.toFixed(1);

/** 数值标签：最多 1 位小数，去尾 0 */
const num = (n: number): string => {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

/** 长文本截断 */
const cut = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) + "…" : s;

/** 确定性 id（渐变定义用，同 spec 同 id） */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "qc" + h.toString(36);
}

/** 钳位到 [0, +∞)（图表不支持负值，负数按 0 渲染） */
const nn = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

// ---------- 校验（手写，无 zod 依赖） ----------

export type ValidateResult =
  | { ok: true; spec: ChartSpec }
  | { ok: false; error: string };

function isNameValue(d: unknown): d is { name: string; value: number } {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.name === "string" && o.name.trim() !== "" &&
    typeof o.value === "number" && Number.isFinite(o.value)
  );
}

export function validateChartSpec(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "图表定义必须是 JSON 对象" };
  }
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== "string") return { ok: false, error: "缺少 type 字段" };

  const checkData = (min: number): { name: string; value: number }[] | null => {
    if (!Array.isArray(o.data) || o.data.length < min) return null;
    return o.data.every(isNameValue) ? (o.data as { name: string; value: number }[]) : null;
  };

  switch (type) {
    case "radar": {
      const data = checkData(3);
      if (!data) return { ok: false, error: "雷达图 data 需为 ≥3 个 {name, value} 数组" };
      return { ok: true, spec: { type: "radar", title: str(o.title), data, style: styleOf(o.style) } };
    }
    case "bar":
    case "line":
    case "progress": {
      const data = checkData(1);
      if (!data) return { ok: false, error: `${type} 图 data 需为非空 {name, value} 数组` };
      const style = styleOf(o.style);
      if (o.style && typeof o.style === "object") {
        const s = o.style as Record<string, unknown>;
        if (typeof s.unit === "string") style.unit = s.unit;
        if (typeof s.warnBelow === "number" && Number.isFinite(s.warnBelow)) style.warnBelow = s.warnBelow;
      }
      return { ok: true, spec: { type, title: str(o.title), data, style } as BarSpec };
    }
    case "pie": {
      if (!Array.isArray(o.data) || o.data.length < 1 || !o.data.every(isNameValue)) {
        return { ok: false, error: "饼图 data 需为非空 {name, value} 数组" };
      }
      const data = (o.data as { name: string; value: number }[]).map((d, i) => ({
        ...d,
        warn: !!(o.data as Record<string, unknown>[])[i]?.warn,
      }));
      const style = styleOf(o.style);
      if (o.style && typeof o.style === "object" && typeof (o.style as Record<string, unknown>).centerLabel === "string") {
        style.centerLabel = (o.style as Record<string, unknown>).centerLabel as string;
      }
      return { ok: true, spec: { type: "pie", title: str(o.title), data, style } };
    }
    case "scatter": {
      if (!Array.isArray(o.data) || o.data.length < 1) return { ok: false, error: "散点图 data 需为非空数组" };
      const pts: { name?: string; x: number; y: number }[] = [];
      for (const d of o.data) {
        if (!d || typeof d !== "object") return { ok: false, error: "散点数据格式错误" };
        const p = d as Record<string, unknown>;
        if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          return { ok: false, error: "散点需含数值 x, y" };
        }
        pts.push({ x: p.x, y: p.y, name: typeof p.name === "string" ? p.name : undefined });
      }
      const style = styleOf(o.style);
      if (o.style && typeof o.style === "object") {
        const s = o.style as Record<string, unknown>;
        if (typeof s.xLabel === "string") style.xLabel = s.xLabel;
        if (typeof s.yLabel === "string") style.yLabel = s.yLabel;
      }
      return { ok: true, spec: { type: "scatter", title: str(o.title), data: pts, style } };
    }
    default:
      return { ok: false, error: `不支持的图表类型: ${type}` };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function styleOf(v: unknown): BaseStyle & Record<string, unknown> {
  const style: BaseStyle & Record<string, unknown> = {};
  if (v && typeof v === "object") {
    const s = v as Record<string, unknown>;
    if (s.theme === "blue" || s.theme === "green" || s.theme === "orange") style.theme = s.theme;
    if (typeof s.showValues === "boolean") style.showValues = s.showValues;
    if (s.max && typeof s.max === "number" && Number.isFinite(s.max) && s.max > 0) style.max = s.max;
  }
  return style;
}

// ---------- 雷达图 ----------
// 修正后的公式：θᵢ = 2π·i/N（首顶点朝正上方），顶点 = (cx + R·sinθᵢ, cy − R·cosθᵢ)

function renderRadar(s: RadarSpec): string {
  if (s.data.length > 12) return fallbackTable(JSON.stringify(s), "雷达图维度超过 12 个");
  const N = s.data.length;
  const cx = 230, cy = 215, R = 150;
  const max = typeof s.style?.max === "number" ? (s.style.max as number) : 100;
  const th = themeOf(s.style);
  const showValues = s.style?.showValues !== false;

  const pt = (i: number, r: number): [number, number] => {
    const a = (2 * Math.PI * i) / N;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const poly = (r: number): string =>
    Array.from({ length: N }, (_, i) => pt(i, r).map(c).join(",")).join(" ");

  // 网格层（4 同心 N 边形）+ 轴线
  let grid = "";
  for (const k of [1, 0.75, 0.5, 0.25]) {
    const outer = k === 1;
    grid += `<polygon points="${poly(R * k)}" fill="none" stroke="#94A3B8" stroke-width="${outer ? 2 : 1.5}"/>`;
  }
  let axes = "";
  for (let i = 0; i < N; i++) {
    const [x, y] = pt(i, R);
    axes += `<line x1="${c(cx)}" y1="${c(cy)}" x2="${c(x)}" y2="${c(y)}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 3"/>`;
  }

  // 数据多边形 + 数据点 + 数值标签
  const vals = s.data.map((d) => (nn(d.value) / max) * R);
  const dataPoly = vals.map((r, i) => pt(i, r).map(c).join(",")).join(" ");
  let dots = "", valLabels = "";
  s.data.forEach((d, i) => {
    const [x, y] = pt(i, vals[i]);
    dots += `<circle cx="${c(x)}" cy="${c(y)}" r="4" fill="${th.main}" stroke="white" stroke-width="1.5"/>`;
    if (showValues) {
      const [lx, ly] = pt(i, vals[i] + 16);
      const sn = Math.sin((2 * Math.PI * i) / N);
      const anchor = Math.abs(sn) < 0.35 ? "middle" : sn > 0 ? "start" : "end";
      valLabels += `<text x="${c(lx)}" y="${c(ly + 4)}" font-size="11" fill="#4B5563" text-anchor="${anchor}">${esc(num(d.value))}</text>`;
    }
  });

  // 维度标签（截断 8 字）
  let labels = "";
  s.data.forEach((d, i) => {
    const a = (2 * Math.PI * i) / N;
    const [lx, ly] = pt(i, R + 22);
    const sn = Math.sin(a), cs = Math.cos(a);
    const anchor = Math.abs(sn) < 0.35 ? "middle" : sn > 0 ? "start" : "end";
    const dy = cs > 0.8 ? -2 : cs < -0.8 ? 14 : 5;
    labels += `<text x="${c(lx)}" y="${c(ly + dy)}" font-size="14" font-weight="bold" fill="#1F2937" text-anchor="${anchor}">${esc(cut(d.name.trim(), 8))}</text>`;
  });

  // 顶部刻度 25/50/75/100
  let scale = "";
  for (const k of [0.25, 0.5, 0.75, 1]) {
    scale += `<text x="${c(cx + 6)}" y="${c(cy - R * k + 3)}" font-size="10" fill="#6B7280">${num(max * k)}</text>`;
  }

  return wrap(s.title, `<svg viewBox="0 0 460 420" width="100%" style="max-width:460px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${grid}${axes}<polygon points="${dataPoly}" fill="${th.main}" fill-opacity="0.3" stroke="${th.main}" stroke-width="2.5"/>${dots}${valLabels}${labels}${scale}</svg>`, 460);
}

// ---------- 柱状图（≤10 项纵向；>10 项自动横向，防标签挤压） ----------

function renderBar(s: BarSpec): string {
  return s.data.length > 10 ? renderBarH(s) : renderBarV(s);
}

function renderBarV(s: BarSpec): string {
  const th = themeOf(s.style);
  const unit = typeof s.style?.unit === "string" ? (s.style.unit as string) : "";
  const warnBelow = typeof s.style?.warnBelow === "number" ? (s.style.warnBelow as number) : null;
  const W = 800, H = 400, L = 60, T = 40, B = 350;
  const vals = s.data.map((d) => nn(d.value));
  const rawMax = Math.max(...vals, 1);
  const niceMax = Math.max(10, Math.ceil((rawMax * 1.15) / 5) * 5);
  const plotW = W - L - 20;
  const n = s.data.length;
  const unitW = (plotW * 0.7) / n;
  const barW = (unitW * 2) / 3;
  const x0 = L + (plotW * 0.15);

  const gid = hashId("barv" + JSON.stringify(s.data) + th.main);
  let defs = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.from}"/><stop offset="1" stop-color="${th.to}"/></linearGradient><linearGradient id="${gid}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8F9A"/><stop offset="1" stop-color="${WARN}"/></linearGradient></defs>`;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const y = B - ((B - T) * i) / 4;
    grid += `<line x1="${c(L)}" y1="${c(y)}" x2="${c(W - 20)}" y2="${c(y)}" stroke="#E5E7EB" stroke-dasharray="4 4"/>` +
      `<text x="${c(L - 8)}" y="${c(y + 4)}" font-size="11" fill="#6B7280" text-anchor="end">${num((niceMax * i) / 4)}</text>`;
  }

  let bars = "", valLabels = "", catLabels = "";
  s.data.forEach((d, i) => {
    const v = vals[i];
    const h = (v / niceMax) * (B - T);
    const x = x0 + unitW * i + (unitW - barW) / 2;
    const warn = warnBelow !== null && v < warnBelow;
    bars += `<rect x="${c(x)}" y="${c(B - h)}" width="${c(barW)}" height="${c(h)}" rx="6" fill="url(#${gid}${warn ? "w" : ""})"/>`;
    if (s.style?.showValues !== false) {
      valLabels += `<text x="${c(x + barW / 2)}" y="${c(B - h - 6)}" font-size="13" font-weight="bold" fill="#1F2937" text-anchor="middle">${esc(num(v))}${esc(unit)}</text>`;
    }
    // 类别标签：≤6 字一行，最多 2 行
    const nm = d.name.trim();
    const l1 = nm.slice(0, 6);
    const l2 = nm.length > 6 ? nm.slice(6, 12) : "";
    catLabels += `<text x="${c(x + barW / 2)}" y="${c(B + 18)}" font-size="12" fill="#4B5563" text-anchor="middle">${esc(l1)}</text>` +
      (l2 ? `<text x="${c(x + barW / 2)}" y="${c(B + 32)}" font-size="12" fill="#4B5563" text-anchor="middle">${esc(l2)}</text>` : "");
  });

  return wrap(s.title, `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${defs}${grid}<line x1="${c(L)}" y1="${c(B)}" x2="${c(W - 20)}" y2="${c(B)}" stroke="#94A3B8" stroke-width="2"/>${bars}${valLabels}${catLabels}</svg>`);
}

function renderBarH(s: BarSpec): string {
  const th = themeOf(s.style);
  const unit = typeof s.style?.unit === "string" ? (s.style.unit as string) : "";
  const warnBelow = typeof s.style?.warnBelow === "number" ? (s.style.warnBelow as number) : null;
  const n = s.data.length;
  const rowH = 30, H = n * rowH + 50, W = 800, L = 150, R = 770;
  const vals = s.data.map((d) => nn(d.value));
  const niceMax = Math.max(10, Math.ceil((Math.max(...vals, 1) * 1.1) / 5) * 5);

  const gid = hashId("barh" + JSON.stringify(s.data) + th.main);
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${th.to}"/><stop offset="1" stop-color="${th.from}"/></linearGradient><linearGradient id="${gid}w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${WARN}"/><stop offset="1" stop-color="#FF8F9A"/></linearGradient></defs>`;
  out += `<line x1="${c(L)}" y1="20" x2="${c(L)}" y2="${c(H - 20)}" stroke="#94A3B8" stroke-width="2"/>`;
  s.data.forEach((d, i) => {
    const v = vals[i];
    const w = (v / niceMax) * (R - L);
    const y = 25 + i * rowH;
    const warn = warnBelow !== null && v < warnBelow;
    out += `<text x="${c(L - 8)}" y="${c(y + 12)}" font-size="12" fill="#4B5563" text-anchor="end">${esc(cut(d.name.trim(), 8))}</text>` +
      `<rect x="${c(L)}" y="${c(y)}" width="${c(Math.max(w, 2))}" height="18" rx="4" fill="url(#${gid}${warn ? "w" : ""})"/>` +
      `<text x="${c(L + Math.max(w, 2) + 6)}" y="${c(y + 13)}" font-size="11" fill="#4B5563">${esc(num(v))}${esc(unit)}</text>`;
  });
  out += `</svg>`;
  return wrap(s.title, out);
}

// ---------- 折线图 ----------

function renderLine(s: LineSpec): string {
  const th = themeOf(s.style);
  const unit = typeof s.style?.unit === "string" ? (s.style.unit as string) : "";
  const n = s.data.length;

  if (n === 1) {
    // 单点：只画点 + 标签，不画线
    const d = s.data[0];
    return wrap(s.title, `<svg viewBox="0 0 800 400" width="100%" style="max-width:800px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg"><line x1="60" y1="350" x2="780" y2="350" stroke="#94A3B8" stroke-width="2"/><circle cx="400" cy="200" r="5" fill="${th.main}" stroke="white" stroke-width="1.5"/><text x="400" y="180" font-size="13" font-weight="bold" fill="#1F2937" text-anchor="middle">${esc(num(nn(d.value)))}${esc(unit)}</text><text x="400" y="372" font-size="12" fill="#4B5563" text-anchor="middle">${esc(cut(d.name.trim(), 8))}</text></svg>`);
  }

  const W = 800, H = 400, L = 60, T = 40, B = 350, Rm = 780;
  const vals = s.data.map((d) => nn(d.value));
  const niceMax = Math.max(10, Math.ceil((Math.max(...vals, 1) * 1.15) / 5) * 5);
  const px = (i: number) => L + ((Rm - L) * i) / (n - 1);
  const py = (v: number) => B - (v / niceMax) * (B - T);

  const gid = hashId("line" + JSON.stringify(s.data) + th.main);
  let defs = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.main}" stop-opacity="0.22"/><stop offset="1" stop-color="${th.main}" stop-opacity="0"/></linearGradient></defs>`;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const y = B - ((B - T) * i) / 4;
    grid += `<line x1="${c(L)}" y1="${c(y)}" x2="${c(Rm)}" y2="${c(y)}" stroke="#E5E7EB" stroke-dasharray="4 4"/>` +
      `<text x="${c(L - 8)}" y="${c(y + 4)}" font-size="11" fill="#6B7280" text-anchor="end">${num((niceMax * i) / 4)}</text>`;
  }

  const pts = vals.map((v, i) => `${c(px(i))},${c(py(v))}`).join(" ");
  const area = `M ${c(px(0))} ${c(B)} ` + vals.map((v, i) => `L ${c(px(i))} ${c(py(v))}`).join(" ") + ` L ${c(px(n - 1))} ${c(B)} Z`;

  const maxI = vals.indexOf(Math.max(...vals));
  const minI = vals.indexOf(Math.min(...vals));
  let dots = "", labels = "", xlabels = "";
  const xCut = n > 10 ? 4 : 6;
  s.data.forEach((d, i) => {
    const x = px(i), y = py(vals[i]);
    dots += `<circle cx="${c(x)}" cy="${c(y)}" r="4.5" fill="${th.main}" stroke="white" stroke-width="1.5"/>`;
    if (s.style?.showValues !== false) {
      const isMax = i === maxI, isMin = i === minI;
      labels += `<text x="${c(x)}" y="${c(y - 10)}" font-size="11" fill="${isMax ? th.main : isMin ? WARN : "#4B5563"}" ${isMax || isMin ? 'font-weight="bold"' : ""} text-anchor="middle">${esc(num(vals[i]))}${esc(unit)}</text>`;
    }
    xlabels += `<text x="${c(x)}" y="${c(B + 18)}" font-size="12" fill="#4B5563" text-anchor="middle">${esc(cut(d.name.trim(), xCut))}</text>`;
  });

  return wrap(s.title, `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${defs}${grid}<path d="${area}" fill="url(#${gid})"/><polyline points="${pts}" fill="none" stroke="${th.main}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><line x1="${c(L)}" y1="${c(B)}" x2="${c(Rm)}" y2="${c(B)}" stroke="#94A3B8" stroke-width="2"/>${dots}${labels}${xlabels}</svg>`);
}

// ---------- 饼图 / 环形图 ----------

function renderPie(s: PieSpec): string {
  const items = s.data.map((d) => ({ ...d, v: nn(d.value) }));
  const sum = items.reduce((a, b) => a + b.v, 0);
  if (sum <= 0) return wrap(s.title, emptyState);

  const cx = 200, cy = 190, R = 150;
  const n = items.filter((d) => d.v > 0).length;
  const topPct = Math.max(...items.map((d) => d.v / sum));
  const donut = items.length === 2 || n === 1 || topPct >= 0.6;
  const r = donut ? 0.62 * R : 0;

  let paths = "", labels = "";
  let ang = -Math.PI / 2;
  const P = (a: number, rad: number): [number, number] => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];

  items.forEach((d, i) => {
    if (d.v <= 0) return;
    const sweep = (d.v / sum) * 2 * Math.PI;
    const a0 = ang, a1 = ang + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const color = d.warn ? WARN : PIE_PALETTE[i % PIE_PALETTE.length];
    if (n === 1) {
      // 单块 100%：用圆环描边技巧（360° 弧路径非法）
      const mid = (R + r) / 2, w = R - r;
      paths += `<circle cx="${c(cx)}" cy="${c(cy)}" r="${c(mid)}" fill="none" stroke="${color}" stroke-width="${c(w)}"/>`;
    } else {
      const [x0o, y0o] = P(a0, R), [x1o, y1o] = P(a1, R);
      if (donut) {
        const [x0i, y0i] = P(a0, r), [x1i, y1i] = P(a1, r);
        paths += `<path d="M ${c(x0o)} ${c(y0o)} A ${c(R)} ${c(R)} 0 ${large} 1 ${c(x1o)} ${c(y1o)} L ${c(x1i)} ${c(y1i)} A ${c(r)} ${c(r)} 0 ${large} 0 ${c(x0i)} ${c(y0i)} Z" fill="${color}" stroke="white" stroke-width="2"/>`;
      } else {
        paths += `<path d="M ${c(cx)} ${c(cy)} L ${c(x0o)} ${c(y0o)} A ${c(R)} ${c(R)} 0 ${large} 1 ${c(x1o)} ${c(y1o)} Z" fill="${color}" stroke="white" stroke-width="2"/>`;
      }
    }
    // 内置百分比（≥5%）
    const pct = (d.v / sum) * 100;
    if (pct >= 5) {
      const am = (a0 + a1) / 2;
      const lr = donut ? (R + r) / 2 : R * 0.72;
      const [lx, ly] = P(am, lr);
      labels += `<text x="${c(lx)}" y="${c(ly + 4)}" font-size="12" fill="white" text-anchor="middle" font-weight="bold">${num(pct)}%</text>`;
    }
    ang = a1;
  });

  // 环形圆心：核心数值
  let center = "";
  if (donut) {
    const topI = items.findIndex((d) => d.v / sum === topPct);
    const cl = typeof s.style?.centerLabel === "string" ? (s.style.centerLabel as string) : items[topI]?.name ?? "";
    center = `<text x="${c(cx)}" y="${c(cy - 4)}" font-size="28" font-weight="bold" fill="#1F2937" text-anchor="middle">${num(topPct * 100)}%</text>` +
      `<text x="${c(cx)}" y="${c(cy + 18)}" font-size="12" fill="#6B7280" text-anchor="middle">${esc(cut(cl.trim(), 10))}</text>`;
  }

  // 图例（HTML，图表下方）
  const legend = `<div style="display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:center;margin-top:8px;font-size:12px;color:#4B5563">` +
    items.map((d, i) => `<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${d.warn ? WARN : PIE_PALETTE[i % PIE_PALETTE.length]};margin-right:4px;vertical-align:middle"></span>${esc(cut(d.name.trim(), 10))}</span>`).join("") +
    `</div>`;

  return wrap(s.title, `<svg viewBox="0 0 400 380" width="100%" style="max-width:400px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${paths}${labels}${center}</svg>${legend}`, 400);
}

// ---------- 进度条（纯 CSS，无 SVG） ----------

function renderProgress(s: ProgressSpec): string {
  const th = themeOf(s.style);
  const unit = typeof s.style?.unit === "string" ? (s.style.unit as string) : "";
  const warnBelow = typeof s.style?.warnBelow === "number" ? (s.style.warnBelow as number) : null;
  const rows = s.data.map((d) => {
    const v = Math.min(nn(d.value), 100);
    const warn = warnBelow !== null && nn(d.value) < warnBelow;
    const bg = warn ? WARN : th.main;
    return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0">` +
      `<div style="width:130px;font-size:13px;color:#1F2937;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(d.name)}">${esc(cut(d.name.trim(), 10))}</div>` +
      `<div style="flex:1;height:14px;background:#E5E7EB;border-radius:7px;overflow:hidden"><div style="width:${num(v)}%;height:100%;background:${bg};border-radius:7px"></div></div>` +
      `<div style="width:56px;font-size:12px;color:${warn ? WARN : "#4B5563"};font-weight:600">${esc(num(nn(d.value)))}${esc(unit)}</div></div>`;
  }).join("");
  return wrap(s.title, `<div style="max-width:800px;margin:0 auto">${rows}</div>`);
}

// ---------- 散点图 ----------

function renderScatter(s: ScatterSpec): string {
  const th = themeOf(s.style);
  const W = 800, H = 420, L = 60, T = 30, B = 370, Rm = 780;
  const xs = s.data.map((p) => p.x), ys = s.data.map((p) => p.y);
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.08 || 1;
  const yPad = (yMax - yMin) * 0.08 || 1;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
  const px = (x: number) => L + ((x - xMin) / (xMax - xMin)) * (Rm - L);
  const py = (y: number) => B - ((y - yMin) / (yMax - yMin)) * (B - T);

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const y = B - ((B - T) * i) / 4;
    const val = yMin + ((yMax - yMin) * i) / 4;
    grid += `<line x1="${c(L)}" y1="${c(y)}" x2="${c(Rm)}" y2="${c(y)}" stroke="#E5E7EB" stroke-dasharray="4 4"/>` +
      `<text x="${c(L - 8)}" y="${c(y + 4)}" font-size="11" fill="#6B7280" text-anchor="end">${num(val)}</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const x = L + ((Rm - L) * i) / 4;
    const val = xMin + ((xMax - xMin) * i) / 4;
    grid += `<text x="${c(x)}" y="${c(B + 18)}" font-size="11" fill="#6B7280" text-anchor="middle">${num(val)}</text>`;
  }

  let dots = "";
  for (const p of s.data) {
    dots += `<circle cx="${c(px(p.x))}" cy="${c(py(p.y))}" r="4" fill="${th.main}" fill-opacity="0.65" stroke="white" stroke-width="1">` +
      (p.name ? `<title>${esc(p.name)}</title>` : "") + `</circle>`;
  }

  const xCap = typeof s.style?.xLabel === "string" ? `<text x="${c((L + Rm) / 2)}" y="${c(H - 5)}" font-size="12" fill="#6B7280" text-anchor="middle">${esc(s.style.xLabel as string)}</text>` : "";
  const yCap = typeof s.style?.yLabel === "string" ? `<text x="16" y="${c((T + B) / 2)}" font-size="12" fill="#6B7280" text-anchor="middle" transform="rotate(-90 16 ${c((T + B) / 2)})">${esc(s.style.yLabel as string)}</text>` : "";

  return wrap(s.title, `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${grid}<line x1="${c(L)}" y1="${c(B)}" x2="${c(Rm)}" y2="${c(B)}" stroke="#94A3B8" stroke-width="2"/><line x1="${c(L)}" y1="${c(T)}" x2="${c(L)}" y2="${c(B)}" stroke="#94A3B8" stroke-width="2"/>${dots}${xCap}${yCap}</svg>`);
}

// ---------- 管线：提取 ```chart 块 → 校验 → 渲染/降级 ----------

const CHART_RE = /```[ \t]*chart[ \t]*\r?\n?([\s\S]*?)```/g;

/**
 * 处理 AI 输出的 HTML：把 ```chart 块替换为确定性渲染的图表。
 * 任何失败都降级为原始数据表格；整体异常时原样返回（最坏 = 现状）。
 */
export function processChartBlocks(html: string): string {
  try {
    return html.replace(CHART_RE, (_m, json: string) => renderChartText(json));
  } catch {
    return html;
  }
}

/** 解析 + 校验 + 渲染单个 chart 块（失败降级表格） */
export function renderChartText(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return fallbackTable(json, `JSON 解析失败: ${(e as Error).message}`);
  }
  const v = validateChartSpec(parsed);
  if (!v.ok) return fallbackTable(json, v.error);
  try {
    return renderChart(v.spec);
  } catch (e) {
    return fallbackTable(json, `渲染异常: ${(e as Error).message}`);
  }
}

/** 总入口：永不出错，非法 spec 降级为表格 */
export function renderChart(spec: unknown): string {
  const v = validateChartSpec(spec);
  if (!v.ok) return fallbackTable(JSON.stringify(spec) ?? "", v.error);
  const s = v.spec;
  try {
    const body =
      s.type === "radar" ? renderRadar(s) :
      s.type === "bar" ? renderBar(s) :
      s.type === "line" ? renderLine(s) :
      s.type === "pie" ? renderPie(s) :
      s.type === "progress" ? renderProgress(s) :
      renderScatter(s);
    return body; // 各渲染器自带容器
  } catch (e) {
    return fallbackTable(JSON.stringify(spec), `渲染异常: ${(e as Error).message}`);
  }
}

// ---------- 降级表格 ----------

function fallbackTable(rawJson: string, reason: string): string {
  const title = rawJson.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const pairs: { name: string; value: string }[] = [];
  const re = /\{[^{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*?"value"\s*:\s*(-?\d+(?:\.\d+)?)[^{}]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawJson))) pairs.push({ name: m[1], value: m[2] });
  const unq = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const rows = pairs
    .map((p) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #E5E7EB">${esc(unq(p.name))}</td><td style="padding:6px 12px;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:600">${esc(p.value)}</td></tr>`)
    .join("");
  const head = title
    ? `<div style="font-size:15px;font-weight:700;color:#1F2937;margin-bottom:8px">${esc(unq(title))}</div>`
    : "";
  if (!rows) {
    return `<div class="qc-chart" style="margin:16px 0;padding:16px;border:1px dashed #E5E7EB;border-radius:8px;break-inside:avoid;page-break-inside:avoid">${head}<div style="color:#6B7280;font-size:13px">图表渲染失败（${esc(reason)}），请参考报告文字与表格数据。</div></div>`;
  }
  return `<div class="qc-chart" style="margin:16px 0;break-inside:avoid;page-break-inside:avoid">${head}<table style="border-collapse:collapse;font-size:13px;color:#1F2937;min-width:280px"><thead><tr><th style="padding:6px 12px;border-bottom:2px solid #94A3B8;text-align:left">项目</th><th style="padding:6px 12px;border-bottom:2px solid #94A3B8;text-align:right">数值</th></tr></thead><tbody>${rows}</tbody></table><div style="color:#94A3B8;font-size:11px;margin-top:4px">图表降级为表格（${esc(reason)}）</div></div>`;
}

/** 图表容器（标题 + 打印防切） */
function wrap(title: string | undefined, inner: string, maxW = 800): string {
  const t = title
    ? `<div style="font-size:15px;font-weight:700;color:#1F2937;margin-bottom:10px;text-align:center">${esc(title)}</div>`
    : "";
  return `<div class="qc-chart" style="margin:16px 0;break-inside:avoid;page-break-inside:avoid">${t}${inner}</div>`;
}

const emptyState = `<div style="padding:32px;text-align:center;color:#6B7280;font-size:13px;border:1px dashed #E5E7EB;border-radius:8px">暂无数据</div>`;
