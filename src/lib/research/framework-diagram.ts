/**
 * 研究框架图生成器
 * - 结构化 JSON 输入（来自 AI 输出）
 * - 4 级灰度配色，无大块纯黑
 * - 统一白底大方框，全部内容在框内
 * - 返回 PNG Buffer，可直接插入 docx
 */
import sharp from "sharp";

export interface FrameworkRow {
  phase: string;
  content: string;
  subPoints: string[];
  methods: string[];
}

export interface FrameworkData {
  rows: FrameworkRow[];
}

// ── 4 级灰度配色（无纯黑大块）──
const C = {
  white: "#FFFFFF",
  lightest: "#F5F6F7",
  light: "#E5E7EB",
  medium: "#9CA3AF",
  dark: "#6B7280",
  darkest: "#374151",
};

// ── 辅助函数 ──
function rect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw = 1, rx = 4): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}"/>`;
}
function text(x: number, y: number, content: string, opts: { size?: number; fill?: string; weight?: string; anchor?: string; font?: string } = {}): string {
  const { size = 12, fill = "#1F2937", weight = "normal", anchor = "middle", font = "SimHei,Microsoft YaHei,PingFang SC,sans-serif" } = opts;
  const escaped = String(content).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escaped}</text>`;
}

/**
 * 渲染研究框架图 SVG
 */
export function generateFrameworkSVG(data: FrameworkData): string {
  // ── 列尺寸 ──
  const COL_PHASE_W = 150;
  const COL_CONTENT_W = 560;
  const COL_METHOD_W = 220;
  const ARROW_GAP = 60;

  const FRAME_PAD = 36;
  const INNER_PAD = 24;

  // FRAME_W 含 2*INNER_PAD，确保内容全部在框内
  const FRAME_W = 2 * INNER_PAD + COL_PHASE_W + ARROW_GAP + COL_CONTENT_W + ARROW_GAP + COL_METHOD_W;

  const HEADER_H = 50;
  const ROW_H = 100;
  const ROW_GAP = 22;

  // 计算列定位
  const frameX = FRAME_PAD;
  const frameY = 80;
  const innerX = frameX + INNER_PAD;
  const innerY = frameY + INNER_PAD;
  const innerW = FRAME_W - 2 * INNER_PAD;

  const X_PHASE = innerX;
  const X_CONTENT = innerX + COL_PHASE_W + ARROW_GAP;
  const X_METHOD = innerX + COL_PHASE_W + ARROW_GAP + COL_CONTENT_W + ARROW_GAP;
  const COL_PHASE_CX = X_PHASE + COL_PHASE_W / 2;

  const rowsTotalH = data.rows.length * ROW_H + (data.rows.length - 1) * ROW_GAP;
  const FRAME_H = INNER_PAD + HEADER_H + ROW_GAP + rowsTotalH + INNER_PAD;

  const totalW = FRAME_W + FRAME_PAD * 2;
  const totalH = frameY + FRAME_H + 30;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`;
  svg += `<rect width="${totalW}" height="${totalH}" fill="#FFFFFF"/>`;

  // ════ 先画大框（白底+深灰边框）═══
  // 关键：必须先画框，否则后面白色填充的行内容会被覆盖
  svg += rect(frameX, frameY, FRAME_W, FRAME_H, C.white, C.darkest, 2, 8);

  // ════ Rows 渲染 ════
  const headerY = innerY + 8;
  const sepY = headerY + HEADER_H + 6;
  const rowsStartY = sepY + ROW_GAP - 6;

  // 表头（深灰填充+白字）
  svg += rect(X_PHASE, headerY, COL_PHASE_W, HEADER_H, C.darkest, C.darkest, 0, 4);
  svg += text(X_PHASE + COL_PHASE_W / 2, headerY + HEADER_H / 2 + 6, "研究阶段", { size: 16, weight: "bold", fill: C.white });
  svg += rect(X_CONTENT, headerY, COL_CONTENT_W, HEADER_H, C.darkest, C.darkest, 0, 4);
  svg += text(X_CONTENT + COL_CONTENT_W / 2, headerY + HEADER_H / 2 + 6, "研究内容", { size: 16, weight: "bold", fill: C.white });
  svg += rect(X_METHOD, headerY, COL_METHOD_W, HEADER_H, C.darkest, C.darkest, 0, 4);
  svg += text(X_METHOD + COL_METHOD_W / 2, headerY + HEADER_H / 2 + 6, "研究方法", { size: 16, weight: "bold", fill: C.white });

  // 虚线分隔
  svg += `<line x1="${innerX + 6}" y1="${sepY}" x2="${innerX + innerW - 6}" y2="${sepY}" stroke="${C.medium}" stroke-width="0.8" stroke-dasharray="5,4"/>`;

  // 每行
  for (let ri = 0; ri < data.rows.length; ri++) {
    const row = data.rows[ri];
    const y = rowsStartY + ri * (ROW_H + ROW_GAP);
    const rowMidY = y + ROW_H / 2;

    // 阶段块（方形·白底·深灰边框·左侧浅灰条带）
    svg += rect(X_PHASE, rowMidY - 28, COL_PHASE_W, 56, C.white, C.darkest, 1.5, 4);
    svg += rect(X_PHASE, rowMidY - 28, 10, 56, C.light, C.light, 0, 0);
    svg += text(X_PHASE + COL_PHASE_W / 2 + 5, rowMidY + 7, row.phase, { size: 17, weight: "bold", fill: C.darkest });

    // 阶段间向下箭头
    if (ri < data.rows.length - 1) {
      const arrowY1 = y + ROW_H + 4;
      const arrowY2 = rowsStartY + (ri + 1) * (ROW_H + ROW_GAP) - ROW_GAP / 2;
      svg += `<line x1="${COL_PHASE_CX}" y1="${arrowY1}" x2="${COL_PHASE_CX}" y2="${arrowY2 - 6}" stroke="${C.darkest}" stroke-width="2"/>`;
      svg += `<polygon points="${COL_PHASE_CX - 5},${arrowY2 - 8} ${COL_PHASE_CX + 5},${arrowY2 - 8} ${COL_PHASE_CX},${arrowY2}" fill="${C.darkest}"/>`;
    }

    // 阶段→内容 横向箭头
    svg += `<line x1="${X_PHASE + COL_PHASE_W + 4}" y1="${rowMidY}" x2="${X_CONTENT - 14}" y2="${rowMidY}" stroke="${C.darkest}" stroke-width="2"/>`;
    svg += `<polygon points="${X_CONTENT - 16},${rowMidY - 6} ${X_CONTENT - 16},${rowMidY + 6} ${X_CONTENT - 2},${rowMidY}" fill="${C.darkest}"/>`;

    // 内容框
    svg += rect(X_CONTENT, y, COL_CONTENT_W, ROW_H, C.white, C.medium, 1.2, 6);
    svg += text(X_CONTENT + COL_CONTENT_W / 2, y + 40, row.content, { size: 15, weight: "bold", fill: C.darkest });

    // 子要点
    const subY = y + 74;
    const subCount = row.subPoints.length;
    const subGap = 10;
    const subTotalW = COL_CONTENT_W - 32;
    const subW = (subTotalW - subGap * (subCount - 1)) / subCount;
    const subStartX = X_CONTENT + 16;
    for (let si = 0; si < subCount; si++) {
      const sx = subStartX + si * (subW + subGap);
      svg += rect(sx, subY - 18, subW, 22, C.lightest, C.lightest, 0, 3);
      svg += text(sx + subW / 2, subY - 2, row.subPoints[si], { size: 11, fill: C.darkest });
    }

    // 方法→内容 横向箭头（从右到左）
    svg += `<line x1="${X_METHOD - 4}" y1="${rowMidY}" x2="${X_CONTENT + COL_CONTENT_W + 14}" y2="${rowMidY}" stroke="${C.darkest}" stroke-width="2"/>`;
    svg += `<polygon points="${X_CONTENT + COL_CONTENT_W + 16},${rowMidY - 6} ${X_CONTENT + COL_CONTENT_W + 16},${rowMidY + 6} ${X_CONTENT + COL_CONTENT_W + 2},${rowMidY}" fill="${C.darkest}"/>`;

    // 方法框
    svg += rect(X_METHOD, y, COL_METHOD_W, ROW_H, C.white, C.medium, 1.2, 6);
    const methods = row.methods;
    const mCount = methods.length;
    const itemH = 24;
    const itemGap = 8;
    const methodsTotalH = mCount * itemH + (mCount - 1) * itemGap;
    const methodStartY = y + (ROW_H - methodsTotalH) / 2 + itemH - 8;
    for (let mi = 0; mi < mCount; mi++) {
      const my = methodStartY + mi * (itemH + itemGap);
      svg += rect(X_METHOD + 14, my - 18, COL_METHOD_W - 28, itemH, C.light, C.medium, 0.8, 3);
      svg += text(X_METHOD + COL_METHOD_W / 2, my - 1, methods[mi], { size: 13, weight: "bold", fill: C.darkest });
    }
  }

  svg += `</svg>`;
  return svg;
}

/**
 * 生成研究框架图 PNG Buffer
 */
export async function generateFrameworkDiagram(data: FrameworkData): Promise<Buffer> {
  const svg = generateFrameworkSVG(data);
  return await sharp(Buffer.from(svg), { density: 200 })
    .png()
    .toBuffer();
}

/**
 * 从 AI 输出全文中提取 [FRAMEWORK_JSON_START]...[FRAMEWORK_JSON_END] 段
 * 容错：忽略多余 ```json 标记、注释、尾部逗号
 */
export function extractFrameworkJSON(text: string): FrameworkData | null {
  if (!text) return null;

  const match = text.match(/\[FRAMEWORK_JSON_START\]([\s\S]*?)\[FRAMEWORK_JSON_END\]/);
  if (!match) return null;

  let jsonStr = match[1].trim();
  // 清除所有 markdown 代码块标记（任何位置）
  jsonStr = jsonStr.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  // 清除多行/单行注释
  jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // 修复尾部逗号
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    if (parsed.rows.length < 3 || parsed.rows.length > 6) return null;

    // 字段验证与清洗
    const rows: FrameworkRow[] = [];
    for (const r of parsed.rows) {
      const phase = String(r.phase || "").slice(0, 8).trim();
      const content = String(r.content || "").slice(0, 60).trim();
      const subPoints = Array.isArray(r.subPoints)
        ? r.subPoints.map((s: any) => String(s).slice(0, 14).trim()).filter(Boolean).slice(0, 4)
        : [];
      const methods = Array.isArray(r.methods)
        ? r.methods.map((m: any) => String(m).slice(0, 14).trim()).filter(Boolean).slice(0, 4)
        : [];

      if (!phase || !content) continue;
      // 保证至少 2 个 subPoints 和 1 个 methods
      if (subPoints.length < 1) subPoints.push("待补充");
      if (methods.length < 1) methods.push("综合研究法");
      rows.push({ phase, content, subPoints, methods });
    }

    if (rows.length < 2) return null;
    return { rows };
  } catch {
    return null;
  }
}
