/**
 * 基于官方模板结构的课题方案 Word 生成器
 * - 严格按照"{year}年度教育科学规划课题评审活页"模板（年份动态计算）
 * - 主体为大表格：每个章节 1 行标题 + 1 行内容（合并 4 列）
 * - 第（七）章特殊：含"阶段成果 5 项 + 最终成果 3 项"子表格
 * - 第（五）章末尾插入研究框架图 PNG
 */
import {
  Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType,
  PageOrientation, Header, Footer, PageNumber,
  Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign,
} from "docx";
import type { ProposalContent } from "./document-generator";

// ── 工具函数（从 docx-generator.ts 复制，避免循环依赖） ──

/**
 * 计算课题申报年份：
 * - 1-6 月：申报当年（例：2026 年 3 月 → 申报 2026 年度）
 * - 7-12 月：申报下一年（例：2024 年 8 月 → 申报 2025 年度）
 */
function getProposalYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  return month <= 6 ? now.getFullYear() : now.getFullYear() + 1;
}

/**
 * 清洗 Markdown 符号，保留文字内容
 */
function cleanMarkdown(text: string): string {
  if (!text) return "";
  let s = text;
  s = s.replace(/~~([^~]+)~~/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/(?<![*_])\*([^*\s][^*]*?)\*(?![*_])/g, "$1");
  s = s.replace(/(?<![*_])_([^_\s][^_]*?)_(?![*_])/g, "$1");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "• ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * 拆注文本：[N] 形式的参考文献序号渲染为上标，其余保持普通字号
 * - 例："xxx[1]yyy[2]" → [TextRun("xxx"), TextRun("[1]", super), TextRun("yyy"), TextRun("[2]", super)]
 */
function runsWithCitations(
  text: string,
  opts: { font?: any; size?: number; bold?: boolean } = {}
): TextRun[] {
  const font = opts.font || fontFangSong;
  const size = opts.size ?? 24;
  const bold = !!opts.bold;
  // 用带捕获组的正则拆分，保留 [N] 标记
  const parts = text.split(/(\[\d+\])/g);
  return parts.filter(p => p !== "").map(part => {
    if (/^\[\d+\]$/.test(part)) {
      return new TextRun({ text: part, font, size, bold, superScript: true });
    }
    return new TextRun({ text: part, font, size, bold });
  });
}

/**
 * 解析"预期研究成果"表格文本
 * - 支持多种 AI 输出格式，宽松识别"理论性/实践性/最终成果"分区
 * - 行级宽松匹配：兼容前缀编号、半角/全角括号
 */
function parseOutcomesTable(content: string, deadlineYear?: number) {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  const prefix: string[] = [];
  let stageIdx = -1;
  let finalIdx = -1;
  const stageRows: string[][] = [];
  const finalRows: string[][] = [];

  // 仅当存在独立章节"阶段成果"才在 prefix 中切分；其他模式全部行作为 prefix
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^阶段成果/.test(ln) || /阶段成果[（(]/.test(ln)) stageIdx = i;
    if (/最终成果/.test(ln)) finalIdx = i;
  }

  if (stageIdx > 0) {
    for (let i = 0; i < stageIdx; i++) prefix.push(lines[i]);
  } else {
    prefix.push(...lines);
  }

  /**
   * 解析一行产出记录，支持多种格式：
   * 1. 表格分隔符 | ："名称 | 形式 | 时间"
   * 2. 行内完整格式："名称（形式：xxx，完成时间：yyy）"
   * 3. 行内简化格式："名称（形式：xxx）"
   * 4. 仅名称：必须是带书名号的成果名 或 以常见成果类型开头
   * 前缀处理：去除 "产出N"、"（N）"、"N."、"N、" 等编号
   */
  function parseOutcomeLine(line: string): string[] | null {
    if (!line) return null;
    // 移除行首列表符号
    let s = line.replace(/^[-•·*—]\s*/, "").trim();
    if (!s) return null;
    // 移除常见编号前缀：产出1 / （1） / 1. / 1、
    s = s.replace(/^(?:产出\s*[\d一二三四五六七八九十]+[\s：:、.]?|[\(（]\s*[\d一二三四五六七八九十]+\s*[\)）][\s：:、.]?|\d+[\.\)、]\s*)/, "").trim();
    if (!s) return null;

    // 跳过介绍/说明/规则性段落
    // - "每条30-40字" / "格式：「...」" / "研究报告、学术论文、案例是主要的研究成果形式"
    // - "直接写成果名" / "无需前缀" / "形成阶段" / "从...中选" 等元说明
    // 注意：只匹配"行首"或"括号内"开头的元说明（"^（每条|格式|形式）"），避免误伤"《XX》（形式：xxx）"这类行内数据
    if (/^[（(](?:每条|格式|形式)[：:]|^(?:每条|格式|形式)\s|^形式\s|^成果包括|预期成果|如下所示|如下[：:]|例如[：:]|示例[：:]|直接写|无需[「"「]|主要.*形式|^以上|^以下是|^分类|^本研究预期|^形成.*阶段|^理论性.*实践性|.*最终.*阶段|^最终.*成果|从(?:上述|五项|以上).*中.*选|^成果形式|^\d+\s*[、.]|^分阶段|^分[、，]/.test(s)) {
      return null;
    }

    // 格式1：表格分隔符 | （半角或全角）
    const pipeParts = s.split(/[｜|]/).map(x => x.trim()).filter(Boolean);
    if (pipeParts.length >= 2) {
      return [pipeParts[0], pipeParts[1] || "", pipeParts[2] || ""].slice(0, 3);
    }

    // 格式2：行内完整 - "名称（形式：xxx，完成时间：yyy）" 或 "名称(形式:xxx,完成时间:yyy)"
    const inlineMatch = s.match(/^(.+?)\s*[（(]\s*形式\s*[：:]\s*([^，,）)]+?)\s*[,，]\s*完成时间\s*[：:]\s*([^）)]+?)\s*[）)]\s*$/);
    if (inlineMatch) {
      return [inlineMatch[1].trim(), inlineMatch[2].trim(), inlineMatch[3].trim()];
    }

    // 格式3：行内简化 - "名称（形式：xxx）"
    const inlineSimpleMatch = s.match(/^(.+?)\s*[（(]\s*形式\s*[：:]\s*([^）)]+?)\s*[）)]\s*$/);
    if (inlineSimpleMatch) {
      return [inlineSimpleMatch[1].trim(), inlineSimpleMatch[2].trim(), ""];
    }

    // 格式4：仅名称 - 必须是带书名号的成果名 或 以常见成果类型开头
    if (/《[^》]+》/.test(s) || /^(研究报告|学术论文|论文|案例|教学案例|案例集|教学案例集|平台|智能体|指标|指标体系|专著|教材|课例|反思|手册|报告|著作|文集|读本|指南)/.test(s)) {
      return [s, "", ""];
    }

    // 兜底拒绝
    return null;
  }

  // 区段切换：宽松识别"理论性/实践性 → stage";"最终 → final"
  let currentSection: "stage" | "final" | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // 单独行（无其他产出的"分类标题"）
    const isHeaderLine = ln.length <= 30 && !/《[^》]+》/.test(ln);

    if (/理论性成果|实践性成果/.test(ln)) { currentSection = "stage"; continue; }
    if (/最终成果/.test(ln)) { currentSection = "final"; continue; }
    // 区段标题行（如 "1. 理论性成果" / "（1）理论性成果" / "理论性成果："）一并跳过
    if (isHeaderLine && /(?:理论性|实践性|最终|阶段|预期).*成果/.test(ln)) continue;
    // 没有显式章节标题时，遇到首条可能成果自动归为 stage
    if (!currentSection && i > 0 && /^(研究报告|学术论文|案例|教学案例|案例集|教学案例集|平台|智能体)/.test(ln.replace(/^[-•·*（(]\s*/, "").trim())) {
      currentSection = "stage";
    }

    if (currentSection) {
      const parts = parseOutcomeLine(ln);
      if (parts) {
        if (currentSection === "stage" && stageRows.length < 5) stageRows.push(parts);
        else if (currentSection === "final" && finalRows.length < 3) finalRows.push(parts);
      }
    }
  }

  // 兜底：如果上面没匹配到，回退到原始逻辑（基于"阶段成果"/"最终成果"标题位置）
  if (stageRows.length === 0 && finalRows.length === 0 && stageIdx >= 0) {
    const endIdx = finalIdx > stageIdx ? finalIdx : lines.length;
    for (let i = stageIdx + 1; i < endIdx; i++) {
      const parts = parseOutcomeLine(lines[i]);
      if (parts) stageRows.push(parts);
    }
    if (finalIdx >= 0) {
      for (let i = finalIdx + 1; i < lines.length; i++) {
        const parts = parseOutcomeLine(lines[i]);
        if (parts) finalRows.push(parts);
      }
    }
  }

  // 调试日志：当表格为空时输出原始内容便于排查
  if (stageRows.length === 0 && finalRows.length === 0 && lines.length > 0) {
    console.warn("[parseOutcomesTable] 未能解析任何成果行，原始内容前 20 行：");
    for (const ln of lines.slice(0, 20)) console.warn("  ", ln);
  }

  // 自动校正超出截止期限的日期
  function clampDate(dateStr: string): string {
    if (!dateStr || !deadlineYear) return dateStr;
    const yearMatch = dateStr.match(/(\d{4})/);
    if (!yearMatch) return dateStr;
    const year = parseInt(yearMatch[1], 10);
    if (year > deadlineYear) {
      return `${deadlineYear}.12`;
    }
    if (year === deadlineYear) {
      // 如果年份等于截止年，确保月份不超过 12
      const monthMatch = dateStr.match(/\.(\d{1,2})$/);
      if (monthMatch) {
        const month = parseInt(monthMatch[1], 10);
        if (month > 12) return `${deadlineYear}.12`;
      }
    }
    return dateStr;
  }

  // 对所有成果行应用日期限制
  for (const row of stageRows) {
    if (row[2]) row[2] = clampDate(row[2]);
  }
  for (const row of finalRows) {
    if (row[2]) row[2] = clampDate(row[2]);
  }

  return {
    prefix: prefix.join("\n"),
    stageHeader: "阶段成果（限5项）",
    stageRows: stageRows.slice(0, 5),
    finalHeader: "最终成果（限3项）",
    finalRows: finalRows.slice(0, 3),
  };
}

interface ProposalDocOptions {
  /** 研究框架图 PNG Buffer（已渲染好，可选） */
  frameworkDiagram?: Buffer;
}

// 单元格边框（细黑边）
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

// 通用字体配置
const fontHeiTi = { eastAsia: "黑体", ascii: "Times New Roman", hAnsi: "Times New Roman" };
const fontFangSong = { eastAsia: "仿宋", ascii: "Times New Roman", hAnsi: "Times New Roman" };

/**
 * 创建普通段落（仿宋正文）
 * - 自动把文本中的 [N] 引用编号渲染为上标
 */
function pNormal(text: string, opts: { firstLine?: number; left?: number; bold?: boolean; align?: any; size?: number } = {}): Paragraph {
  return new Paragraph({
    children: runsWithCitations(text, { font: fontFangSong, size: opts.size ?? 24, bold: opts.bold }),
    spacing: { line: 360, after: 60 },
    indent: {
      firstLine: opts.firstLine !== undefined ? opts.firstLine : 480,
      left: opts.left,
    },
    alignment: opts.align,
  });
}

/**
 * 创建小标题段落（黑体加粗）
 * - 自动把文本中的 [N] 引用编号渲染为上标
 */
function pSubHeading(text: string, opts: { size?: number } = {}): Paragraph {
  return new Paragraph({
    children: runsWithCitations(text, { font: fontHeiTi, size: opts.size ?? 24, bold: true }),
    spacing: { before: 150, after: 40, line: 360 },
  });
}

/**
 * 创建单元格内的章节标题（合并 4 列，黑体加粗居中）
 */
function sectionTitleCell(title: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text: title,
        font: fontHeiTi,
        size: 28,
        bold: true,
      })],
      alignment: AlignmentType.LEFT,
      spacing: { before: 100, after: 100, line: 360 },
    })],
    columnSpan: 4,
    borders: allBorders,
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill: "F3F4F6" },
  });
}

/**
 * 创建单元格内的内容（合并 4 列，填入多个段落）
 */
function contentCell(paragraphs: Paragraph[]): TableCell {
  return new TableCell({
    children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ children: [new TextRun({ text: "" })] })],
    columnSpan: 4,
    borders: allBorders,
    verticalAlign: VerticalAlign.TOP,
  });
}

/**
 * 创建合并 4 列的标题单元格（用于第（七）章表格的"阶段成果"/"最终成果"）
 * - 关键：vMerge=restart + rowSpan=5 让 docx 库自动给后续 4 行添加 vMerge=continue cell
 * - 续行只需放 3 个 data cell，不要再手动加 continue cell（否则会重复）
 */
function categoryCell(text: string, rowSpan: number, vMerge: "restart"): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text,
        font: fontHeiTi,
        size: 24,
        bold: true,
      })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 100 },
    })],
    rowSpan: rowSpan,
    borders: allBorders,
    verticalAlign: VerticalAlign.CENTER,
    
    shading: { fill: "F9FAFB" },
  });
}

/**
 * 创建数据单元格
 */
function dataCell(text: string, opts: { bold?: boolean; align?: any } = {}): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text,
        font: fontFangSong,
        size: 22,
        bold: opts.bold || false,
      })],
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { before: 60, after: 60 },
    })],
    borders: allBorders,
    verticalAlign: VerticalAlign.CENTER,
  });
}

/**
 * 把章节内容文本拆分为段落（应用标题+描述拆分逻辑）
 */
function splitSectionContent(text: string): Paragraph[] {
  // 清除协议标记：[FRAMEWORK_JSON_START]...[FRAMEWORK_JSON_END]、[SECTION_END]、[SECTION_START]
  const cleaned = cleanMarkdown(text)
    .replace(/\[FRAMEWORK_JSON_START\][\s\S]*?\[FRAMEWORK_JSON_END\]/g, "")
    .replace(/\[SECTION_END\]/g, "")
    .replace(/\[SECTION_START\]/g, "")
    .trim();

  const lines = cleaned.split("\n").filter(p => p.trim());
  const paragraphs: Paragraph[] = [];

  for (const p of lines) {
    const t = p.trim();

    // 检测"标题+描述"混合行
    const titleDescMatch = t.match(/^(目标\d|观点\d|创新\d)\s*[：:]\s*【([^】]+)】\s*([\s\S]+)$/);
    const innovationMatch = t.match(/^(视角新|框架新|路径新)\s*[：:]\s*【([^】]+)】\s*vs\s*【([^】]+)】\s*[\s。]*([\s\S]*)$/);
    const labelMatch = t.match(/^(【[^】]+】)\s*[：:]\s*(.+)$/);
    // 模式4：（1）**标题**。描述...  / （1）标题：描述...
    const numTitleDescMatch = t.match(/^[（(](\d+)[）)]\s*[：:、.]?\s*(.+)$/);

    if (titleDescMatch) {
      paragraphs.push(pSubHeading(`${titleDescMatch[1]}：${titleDescMatch[2]}`));
      paragraphs.push(pNormal(titleDescMatch[3], { firstLine: 480 }));
    } else if (numTitleDescMatch) {
      // 检查是否"标题+描述"格式：标题（短）+ 描述（长）
      // 通常标题后面跟句号或冒号，然后是描述
      const rest = numTitleDescMatch[2];
      // 匹配 "标题：描述" 或 "标题。描述" 或 "标题 描述"（标题较短）
      const titleWithDesc = rest.match(/^([^。：:]{2,40})[：:]\s*([\s\S]+)$/);
      const titleWithPeriod = rest.match(/^([^。]{2,80})。\s*([\s\S]+)$/);
      // 匹配 "标题——描述"（研究内容格式）
      const titleWithDash = rest.match(/^([^—]{2,40})——\s*([\s\S]+)$/);

      if (titleWithDesc) {
        paragraphs.push(pSubHeading(`（${numTitleDescMatch[1]}）${titleWithDesc[1]}`));
        paragraphs.push(pNormal(titleWithDesc[2], { firstLine: 480 }));
      } else if (titleWithPeriod) {
        paragraphs.push(pSubHeading(`（${numTitleDescMatch[1]}）${titleWithPeriod[1]}`));
        paragraphs.push(pNormal(titleWithPeriod[2], { firstLine: 480 }));
      } else if (titleWithDash) {
        paragraphs.push(pSubHeading(`（${numTitleDescMatch[1]}）${titleWithDash[1]}`));
        paragraphs.push(pNormal(titleWithDash[2], { firstLine: 480 }));
      } else {
        paragraphs.push(pNormal(t));
      }
    } else if (innovationMatch) {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: `${innovationMatch[1]}：${innovationMatch[2]}`, font: fontHeiTi, size: 24, bold: true }),
          new TextRun({ text: " vs ", font: fontHeiTi, size: 24, bold: true, color: "6B7280" }),
          new TextRun({ text: innovationMatch[3], font: fontHeiTi, size: 24, bold: true }),
        ],
        spacing: { before: 150, after: 40, line: 360 },
      }));
      const desc = innovationMatch[4];
      if (desc && desc.trim()) {
        paragraphs.push(pNormal(desc.trim(), { firstLine: 480 }));
      }
    } else if (labelMatch) {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: `${labelMatch[1]}：`, font: fontHeiTi, size: 24, bold: true }),
          new TextRun({ text: labelMatch[2], font: fontFangSong, size: 24 }),
        ],
        spacing: { line: 360, after: 60 },
        indent: { left: 480, firstLine: 0 },
      }));
    } else if (isShortSubHeading(t)) {
      paragraphs.push(pSubHeading(t));
    } else {
      // 检测 "N. 标题。描述..." 或 "N. 标题。描述..." 格式（主要观点/创新点使用阿拉伯数字编号）
      // 示例：1. 双轨数据融合驱动机制能够实时诊断学生认知盲区。课前预习数据...
      const dotNumMatch = t.match(/^(\d+)[.、]\s*(.+)$/);
      if (dotNumMatch) {
        const dotRest = dotNumMatch[2];
        const dotTitlePeriod = dotRest.match(/^([^。]{2,80})。\s*([\s\S]+)$/);
        if (dotTitlePeriod) {
          paragraphs.push(pSubHeading(`${dotNumMatch[1]}. ${dotTitlePeriod[1]}`));
          paragraphs.push(pNormal(dotTitlePeriod[2], { firstLine: 480 }));
        } else {
          paragraphs.push(pNormal(t));
        }
      } else {
        paragraphs.push(pNormal(t));
      }
    }
  }

  return paragraphs;
}

/**
 * 检测短小标题行（与 docx-generator.ts 一致）
 */
function isShortSubHeading(text: string): boolean {
  if (text.length > 80) return false;
  return /^(\d+[.、]|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[、.]|（[\d\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+）|目标\d|内容\d|观点\d|创新\d|概念\d|过程\d|阶段\d|步骤\d|子要点\d|视角新|框架新|路径新)\s*[、.：:]?\s*[^。\n]{1,60}$/.test(text);
}

/**
 * 构造大表格（按官方模板结构）
 */
function buildMainTable(
  doc: ProposalContent,
  frameworkDiagram?: Buffer
): Table {
  const rows: TableRow[] = [];

  // 章节标题（统一使用官方格式）
  const TITLES = {
    sec1: "（一）研究缘起",
    sec2: "（二）课题的核心概念及其界定",
    sec3: "（三）国内外同一研究领域现状与研究的价值",
    sec4: "（四）研究的目标、内容（或子课题设计）与重点",
    sec5: "（五）研究的思路、过程与方法",
    sec6: "（六）主要观点与可能的创新之处",
    sec7: "（七）预期研究成果",
    sec8: "（八）完成研究任务的可行性分析（包括：①包括课题申报人在内的课题组核心成员的学术或学科背景、研究经历、研究能力、研究成果；②研究基础，包括围绕本课题所开展的文献搜集、调研和相关论文等；③完成研究任务的保障条件，包括研究资料的获得、研究经费的筹措、研究时间的保障等。）",
  };

  // 把 section 按标题匹配（兼容新旧两种格式）
  const findSection = (pattern: RegExp) => doc.sections.find(s => pattern.test(s.title));

  const sec1 = findSection(/研究缘起/);
  const sec2 = findSection(/核心概念/);
  const sec3 = findSection(/国内外/);
  const sec4 = findSection(/研究.{0,3}目标|研究.{0,3}内容/);
  const sec5 = findSection(/研究.{0,3}的(思路|过程).*方法/);
  const sec6 = findSection(/主要观点|创新/);
  const sec7 = findSection(/预期研究成果/);
  const sec8 = findSection(/可行性|研究基础/);

  // 第（一）章：研究缘起
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec1)] }));
  rows.push(new TableRow({ children: [contentCell(sec1 ? splitSectionContent(sec1.content) : [])] }));

  // 第（二）章：核心概念及其界定
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec2)] }));
  rows.push(new TableRow({ children: [contentCell(sec2 ? splitSectionContent(sec2.content) : [])] }));

  // 第（三）章：国内外同一研究领域现状与研究的价值
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec3)] }));
  rows.push(new TableRow({ children: [contentCell(sec3 ? splitSectionContent(sec3.content) : [])] }));

  // 第（四）章：研究的目标、内容（或子课题设计）与重点
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec4)] }));
  rows.push(new TableRow({ children: [contentCell(sec4 ? splitSectionContent(sec4.content) : [])] }));

  // 第（五）章：研究的思路、过程与方法（含框架图）
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec5)] }));
  const sec5Paragraphs = sec5 ? splitSectionContent(sec5.content) : [];
  if (frameworkDiagram) {
    sec5Paragraphs.push(new Paragraph({
      children: [new ImageRun({
        data: frameworkDiagram,
        transformation: { width: 540, height: 378 },
        type: "png",
      })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 100 },
    }));
    sec5Paragraphs.push(new Paragraph({
      children: [new TextRun({
        text: "图1 研究框架图",
        font: fontFangSong,
        size: 21,
        italics: true,
      })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));
  }
  rows.push(new TableRow({ children: [contentCell(sec5Paragraphs)] }));

  // 第（六）章：主要观点与可能的创新之处
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec6)] }));
  rows.push(new TableRow({ children: [contentCell(sec6 ? splitSectionContent(sec6.content) : [])] }));

  // 第（七）章：预期研究成果（含子表格）
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec7)] }));

  // 解析预期研究成果内容
  const proposalYear = getProposalYear();
  const outcomes = sec7 ? parseOutcomesTable(sec7.content, proposalYear + 3) : { prefix: "", stageHeader: "阶段成果（限5项）", stageRows: [], finalHeader: "最终成果（限3项）", finalRows: [] };

  // 表头行
  rows.push(new TableRow({
    children: [
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "", font: fontFangSong })] })], borders: allBorders }),
      dataCell("成果名称", { bold: true, align: AlignmentType.CENTER }),
      dataCell("成果形式", { bold: true, align: AlignmentType.CENTER }),
      dataCell("完成时间", { bold: true, align: AlignmentType.CENTER }),
    ],
  }));

  // 阶段成果：5 行（库自动为 rowSpan=5 的 cell 添加 4 行 vMerge=continue）
  const stageRows = outcomes.stageRows.slice(0, 5);
  for (let i = 0; i < 5; i++) {
    const rowData = stageRows[i] || ["", "", ""];
    if (i === 0) {
      // 第一行：阶段成果标题（vMerge=restart + rowSpan=5，库会自动处理后续 4 行 vMerge=continue）
      rows.push(new TableRow({
        children: [
          categoryCell(outcomes.stageHeader, 5, "restart"),
          dataCell(rowData[0] || ""),
          dataCell(rowData[1] || ""),
          dataCell(rowData[2] || ""),
        ],
      }));
    } else {
      // 后续 4 行：只放 3 个 data cell（vMerge=continue 由库自动添加）
      rows.push(new TableRow({
        children: [
          dataCell(rowData[0] || ""),
          dataCell(rowData[1] || ""),
          dataCell(rowData[2] || ""),
        ],
      }));
    }
  }

  // 最终成果：3 行（库自动为 rowSpan=3 的 cell 添加 2 行 vMerge=continue）
  const finalRows = outcomes.finalRows.slice(0, 3);
  for (let i = 0; i < 3; i++) {
    const rowData = finalRows[i] || ["", "", ""];
    if (i === 0) {
      // 第一行：最终成果标题（vMerge=restart + rowSpan=3，库会自动处理后续 2 行 vMerge=continue）
      rows.push(new TableRow({
        children: [
          categoryCell(outcomes.finalHeader, 3, "restart"),
          dataCell(rowData[0] || ""),
          dataCell(rowData[1] || ""),
          dataCell(rowData[2] || ""),
        ],
      }));
    } else {
      // 后续 2 行：只放 3 个 data cell（vMerge=continue 由库自动添加）
      rows.push(new TableRow({
        children: [
          dataCell(rowData[0] || ""),
          dataCell(rowData[1] || ""),
          dataCell(rowData[2] || ""),
        ],
      }));
    }
  }

  // 第（八）章：完成研究任务的可行性分析（含参考文献）
  rows.push(new TableRow({ children: [sectionTitleCell(TITLES.sec8)] }));
  const sec8Paragraphs = sec8 ? splitSectionContent(sec8.content) : [];
  // 在（八）末尾追加参考文献
  if (doc.references && doc.references.length > 0) {
    sec8Paragraphs.push(new Paragraph({
      children: [new TextRun({ text: "", font: fontFangSong, size: 21 })],
      spacing: { before: 200 },
    }));
    sec8Paragraphs.push(new Paragraph({
      children: [new TextRun({
        text: "参考文献",
        font: fontHeiTi,
        size: 24,
        bold: true,
      })],
      spacing: { before: 200, after: 100 },
    }));
    doc.references.forEach((ref) => {
      sec8Paragraphs.push(new Paragraph({
        // 参考文献每条开头的 [N] 自动作为上标
        children: runsWithCitations(ref, { font: fontFangSong, size: 21 }),
        spacing: { line: 320, after: 40 },
        indent: { left: 480, hanging: 240 },
      }));
    });
  }
  rows.push(new TableRow({ children: [contentCell(sec8Paragraphs)] }));

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
  });
}

/**
 * 主函数：基于模板结构生成课题方案 Word
 */
export async function generateProposalDocxFromTemplate(
  doc: ProposalContent,
  options: ProposalDocOptions = {}
): Promise<Buffer> {
  // ── 标题块 ──
  const proposalYear = getProposalYear();
  const titleText = `${proposalYear}年度教育科学规划课题评审活页`;
  const headerBlock: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({
        text: titleText,
        font: fontHeiTi,
        size: 36,
        bold: true,
      })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({
        text: "课题名称：",
        font: fontHeiTi,
        size: 32,
        bold: true,
      }), new TextRun({
        text: doc.title,
        font: fontHeiTi,
        size: 32,
        bold: true,
        color: "1F2937",
      })],
      spacing: { after: 200 },
    }),
  ];

  // ── 主表格 ──
  const mainTable = buildMainTable(doc, options.frameworkDiagram);

  // ── 页眉页脚 ──
  const header = new Header({
    children: [new Paragraph({
      children: [new TextRun({
        text: titleText,
        font: fontFangSong,
        size: 18,
      })],
      alignment: AlignmentType.CENTER,
    })],
  });
  const footer = new Footer({
    children: [new Paragraph({
      children: [
        new TextRun({ text: "— ", font: "Times New Roman", size: 18 }),
        new TextRun({ children: [PageNumber.CURRENT], font: "Times New Roman", size: 18 }),
        new TextRun({ text: " —", font: "Times New Roman", size: 18 }),
      ],
      alignment: AlignmentType.CENTER,
    })],
  });

  // ── 组装文档 ──
  const docxDoc = new Document({
    creator: "QuickClass 教研宝",
    title: doc.title,
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: [...headerBlock, mainTable],
    }],
  });

  return await Packer.toBuffer(docxDoc);
}