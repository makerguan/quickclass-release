import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, PageOrientation, Header, Footer, PageNumber, BorderStyle, Table, TableRow, TableCell, WidthType } from "docx";
import type { PaperContent, ProposalContent } from "./document-generator";

/**
 * 清洗 Markdown 符号，保留文字内容
 * 处理：加粗/斜体/标题/列表/引用/行内代码/链接/删除线/表格/水平线
 */
export function cleanMarkdown(text: string): string {
  if (!text) return "";
  let s = text;

  // 0. 保留换行的 Markdown 块标记（这些不应该出现在正文里，但保险起见处理）
  //    [SECTION_START]/[SECTION_END]/[ABSTRACT_START]/[KEYWORDS_START] 等协议标记由上游处理
  //    这里只清理纯 Markdown 语法

  // 1. 删除线 ~~text~~ → text
  s = s.replace(/~~([^~]+)~~/g, "$1");

  // 2. 加粗 **text** 或 __text__ → text（先处理加粗，再处理斜体避免误伤）
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");

  // 3. 行内代码 `text` → text
  s = s.replace(/`([^`]+)`/g, "$1");

  // 4. 链接 [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 5. 斜体 *text* 或 _text_ → text
  s = s.replace(/(?<![*_])\*([^*\s][^*]*?)\*(?![*_])/g, "$1");
  s = s.replace(/(?<![*_])_([^_\s][^_]*?)_(?![*_])/g, "$1");

  // 6. 标题 # / ## / ### / #### / ##### / ###### (行首) → 标题文字
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // 7. 引用 > (行首) → 文字
  s = s.replace(/^\s{0,3}>\s?/gm, "");

  // 8. 列表 - 或 * 或 + (行首) → 文字
  s = s.replace(/^\s*[-*+]\s+/gm, "• ");

  // 9. 数字列表 1. 2. 等（行首）→ 保留（不删除，因为中文方案文档中 "1." 是章节编号，不是 markdown 列表）

  // 10. 表格 | ... |（合并多行表格为一行）
  s = s.replace(/^\s*\|.*\|\s*$/gm, (line) => line.replace(/\|/g, " ").replace(/-{2,}/g, "").trim());

  // 11. 水平线 --- *** ___ → 移除
  s = s.replace(/^\s*([-*_])\s*(\1\s*){2,}$/gm, "");

  // 12. 多余空行合并
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

/**
 * 把正文中的 [N] 引用标记拆分为多个 TextRun，[N] 部分用上标
 * 例："推动数据驱动的教育评价改革[1]" →
 *   [TextRun("推动数据驱动的教育评价改革", { size: 24 }), TextRun("[1]", { size: 24, superScript: true })]
 *
 * 用于 PROPOSAL/PAPER 全文的 [N] 上标渲染
 */
function parseInlineReferences(
  text: string,
  baseStyle: { font?: any; size?: number; bold?: boolean; italics?: boolean; color?: string }
): TextRun[] {
  if (!text) return [new TextRun({ text: "", ...baseStyle })];
  const runs: TextRun[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.substring(lastIndex, match.index), ...baseStyle }));
    }
    runs.push(new TextRun({ text: match[0], ...baseStyle, superScript: true }));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.substring(lastIndex), ...baseStyle }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text, ...baseStyle })];
}

/**
 * 解析正文中的图占位标记
 * 输入: "正文内容[FIGURE_PLACEHOLDER_START]描述[FIGURE_PLACEHOLDER_END]更多正文"
 * 输出: 移除占位标记的正文 + 占位符列表
 */
function extractFigurePlaceholders(content: string): { cleaned: string; figures: string[] } {
  const regex = /\[FIGURE_PLACEHOLDER_START\]([\s\S]*?)\[FIGURE_PLACEHOLDER_END\]/g;
  const figures: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    figures.push(match[1].trim());
  }
  const cleaned = content.replace(regex, "").trim();
  return { cleaned, figures };
}

export async function generatePaperDocx(doc: PaperContent): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(new Paragraph({
    text: doc.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 400 },
  }));

  children.push(new Paragraph({
    text: "摘  要",
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 200 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: doc.abstract, size: 24 })],
    spacing: { line: 360 },
    indent: { firstLine: 480 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "关键词：", bold: true }), new TextRun({ text: doc.keywords.join("；") })],
    spacing: { before: 200, after: 300 },
  }));

  doc.sections.forEach(section => {
    children.push(new Paragraph({
      text: section.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }));

    // 解析章节内容，提取图占位标记
    const { cleaned, figures } = extractFigurePlaceholders(section.content);

    // 先清洗 Markdown 符号，再渲染正文段落
    const mdCleaned = cleanMarkdown(cleaned);
    mdCleaned.split("\n").filter(p => p.trim()).forEach(p => {
      children.push(new Paragraph({
        children: parseInlineReferences(p.trim(), { size: 24, font: { eastAsia: "仿宋", ascii: "Times New Roman" } }),
        spacing: { line: 360, after: 120 },
        indent: { firstLine: 480 },
      }));
    });

    // 在该章节末尾追加图占位提示
    figures.forEach((desc, i) => {
      // 占位框（首行：图示说明 + 来源）
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "📊 此处加图：", bold: true, size: 24, color: "0052D9", font: "SimHei" }),
          new TextRun({ text: desc, size: 24, color: "374151", font: "SimSun" }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 60 },
        indent: { firstLine: 0 },
      }));
      // 注：实际图片由作者根据上述建议自行绘制后插入
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "（图示内容由 AI 建议，实际图片由作者根据建议内容绘制后插入）", size: 18, italics: true, color: "9CA3AF", font: "SimSun" }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        indent: { firstLine: 0 },
      }));
    });
  });

  if (doc.references.length > 0) {
    children.push(new Paragraph({
      text: "参考文献",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }));
    doc.references.forEach((ref, i) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: `[${i + 1}] ${ref}`, size: 22 })],
        spacing: { after: 100 },
        indent: { left: 480, hanging: 240 },
      }));
    });
  }

  const docxDoc = new Document({
    creator: "QuickClass 教研宝",
    title: doc.title,
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  return await Packer.toBuffer(docxDoc);
}

export interface ProposalDocOptions {
  /** 研究框架图 PNG Buffer（已渲染好，可选） */
  frameworkDiagram?: Buffer;
}

/**
 * 提取正文中的 [FRAMEWORK_FIGURE_START]...[FRAMEWORK_FIGURE_END] 框架图标记
 * 返回 { cleaned, figureLines, figureTitle }
 */
function extractFrameworkFigure(content: string): { cleaned: string; figureLines: string[]; figureTitle: string } {
  const regex = /\[FRAMEWORK_FIGURE_START\]([\s\S]*?)\[FRAMEWORK_FIGURE_END\]/g;
  const match = regex.exec(content);
  if (!match) return { cleaned: content, figureLines: [], figureTitle: "" };
  const raw = match[1].trim();
  const lines = raw.split("\n").map(l => l).filter(l => l.length > 0);
  let figureTitle = "图1 研究框架图";
  // 提取第一行 "图1：xxx"
  if (lines.length > 0 && /^图\d+[：:]/.test(lines[0].trim())) {
    figureTitle = lines[0].trim();
    lines.shift();
  }
  return { cleaned: content.replace(regex, "").trim(), figureLines: lines, figureTitle };
}

/**
 * 渲染 ASCII 框架图为 Word 段落（用 ASCII 字符直接呈现，保持原貌）
 */
function renderFrameworkFigure(lines: string[], title: string): Paragraph[] {
  const result: Paragraph[] = [];
  // 图前说明
  result.push(new Paragraph({
    children: [new TextRun({
      text: "本研究框架见图1。",
      font: { eastAsia: "仿宋", ascii: "Times New Roman" },
      size: 24,
    })],
    spacing: { line: 360, before: 100, after: 100 },
    indent: { firstLine: 480 },
  }));
  // 框架图主体（等宽字体）
  lines.forEach(line => {
    result.push(new Paragraph({
      children: [new TextRun({
        text: line,
        font: { eastAsia: "宋体", ascii: "Courier New", cs: "Courier New" },
        size: 18,
      })],
      alignment: AlignmentType.CENTER,
      spacing: { line: 240, after: 0 },
      indent: { firstLine: 0 },
    }));
  });
  // 图注
  result.push(new Paragraph({
    children: [new TextRun({
      text: title,
      font: { eastAsia: "仿宋", ascii: "Times New Roman" },
      size: 21,
      italics: true,
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 200 },
  }));
  return result;
}

/**
 * 检测短小标题行（纯标题，无描述内容）
 * 匹配：一级标题：1. xx / 一、 xx
 *       二级标题：（1）xx / （一）xx
 *       自定义：目标1 / 观点2 / 视角新 等
 * 不匹配：带句号的长描述行
 */
function isShortSubHeading(text: string): boolean {
  if (text.length > 80) return false;
  // 一级编号：阿拉伯数字+点 或 中文数字+顿号
  // 二级编号：中文括号+数字（如 （1）（一））
  // 自定义前缀：目标N / 内容N / 观点N / 视角新 等
  return /^(\d+[.、]|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[、.]|（[\d\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+）|目标\d|内容\d|观点\d|创新\d|概念\d|过程\d|阶段\d|步骤\d|子要点\d|视角新|框架新|路径新)\s*[、.：:]?\s*[^。\n]{1,60}$/.test(text);
}

/**
 * 解析"预期研究成果"表格文本
 * 支持以下输入格式：
 *   格式A（"阶段成果/最终成果"标签 + "|" 分隔列）：
 *     阶段成果（限5项）
 *     中小学教师数字素养现状调查报告 | 调查报告 | 2024.10
 *     ...
 *     最终成果（限3项）
 *     ...
 *   格式B（"理论性/实践性/最终成果"标签 + "（形式：XX，完成时间：YYYY.MM）"内嵌列）：
 *     1. 理论性成果
 *     - 研究报告《XX课题研究报告》（形式：研究报告，完成时间：2026.06）
 *     2. 实践性成果
 *     - 教学案例集《XX主题教学案例集》（形式：案例集，完成时间：2026.12）
 *     3. 最终成果
 *     - 研究报告《XX课题研究报告》（形式：研究报告，完成时间：2027.06）
 */
function parseOutcomesTable(content: string, deadlineYear?: number): {
  prefix: string; // 表格前的说明文字
  stageHeader: string;
  stageRows: string[][];
  finalHeader: string;
  finalRows: string[][];
} {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  const prefix: string[] = [];
  let finalIdx = -1;
  const stageRows: string[][] = [];
  const finalRows: string[][] = [];

  // 找到"最终成果"段的开始位置（兼容"3. 最终成果"和"最终成果"两种写法）
  for (let i = 0; i < lines.length; i++) {
    if (/最终成果/.test(lines[i])) {
      finalIdx = i;
      break;
    }
  }

  // 解析一行产出记录，支持两种格式：
  //   格式A：名称 | 形式 | 时间
  //   格式B：- 名称《XX》（形式：形式名，完成时间：YYYY.MM）
  //   格式C：名称《XX》（形式：形式名，完成时间：YYYY.MM）  （无前导"- "）
  const parseLine = (raw: string): string[] | null => {
    // 去掉前导 "- " 或 "• "
    const ln = raw.replace(/^[-•·]\s*/, "").trim();
    if (!ln) return null;
    // 格式A：管道分隔
    const parts = ln.split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
    // 格式B/C：括号内嵌形式与时间
    const m = ln.match(/^(.+?)[（(]\s*形式\s*[:：]\s*([^，,）)]+?)\s*[,，]\s*完成时间\s*[:：]\s*(\d{4}[.\-/年]\d{1,2}(?:[.\-/月]\d{1,2})?日?)\s*[）)]/);
    if (m) {
      return [m[1].trim(), m[2].trim(), m[3].trim()];
    }
    return null;
  };

  // 阶段成果：最终成果之前的所有列表行（"理论性/实践性/阶段成果"标题行被跳过）
  const stageEnd = finalIdx >= 0 ? finalIdx : lines.length;
  for (let i = 0; i < stageEnd; i++) {
    const ln = lines[i];
    // 跳过"理论性/实践性/阶段成果"标题行（如 "1. 理论性成果" / "2. 实践性成果" / "阶段成果（限5项）"）
    if (/^(1\.|2\.|3\.|4\.|5\.|\(1\)|\(2\)|\(3\))?\s*(理论性成果|实践性成果|阶段成果|阶段性成果)/.test(ln)) continue;
    if (/^(理论性成果|实践性成果|阶段成果|阶段性成果)/.test(ln)) continue;
    const row = parseLine(ln);
    if (row) {
      stageRows.push(row);
    } else {
      prefix.push(ln);
    }
  }

  // 最终成果：最终成果标题之后的所有列表行
  if (finalIdx >= 0) {
    for (let i = finalIdx + 1; i < lines.length; i++) {
      const row = parseLine(lines[i]);
      if (row) finalRows.push(row);
    }
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
      const monthMatch = dateStr.match(/\.(\d{1,2})$/);
      if (monthMatch) {
        const month = parseInt(monthMatch[1], 10);
        if (month > 12) return `${deadlineYear}.12`;
      }
    }
    return dateStr;
  }

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

/**
 * 创建一个简单的表格（3 列）
 */
function buildSimpleTable(headers: string[], rows: string[][]): Table {
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  const headerRow = new TableRow({
    children: headers.map(h => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, font: { eastAsia: "黑体", ascii: "Times New Roman" }, size: 21 })],
        alignment: AlignmentType.CENTER,
      })],
      borders: allBorders,
      shading: { fill: "F3F4F6" },
    })),
  });

  const dataRows = rows.map(r => new TableRow({
    children: r.map(cell => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: cell, font: { eastAsia: "仿宋", ascii: "Times New Roman" }, size: 21 })],
        alignment: AlignmentType.CENTER,
      })],
      borders: allBorders,
    })),
  }));

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
  });
}

export async function generateProposalDocx(
  doc: ProposalContent,
  options: ProposalDocOptions = {}
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // ── 标题块 ──
  children.push(new Paragraph({
    children: [new TextRun({
      text: "江苏省教育科学规划课题申报评审活页",
      font: { eastAsia: "黑体", ascii: "Times New Roman" },
      size: 36,
      bold: true,
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 400 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({
      text: "课题名称：" + doc.title,
      font: { eastAsia: "黑体", ascii: "Times New Roman" },
      size: 32,
      bold: true,
    })],
    spacing: { after: 200 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({
      text: "设计与论证报告（8000字以内，不得出现学校和课题组相关人员名字）",
      font: { eastAsia: "仿宋", ascii: "Times New Roman" },
      size: 21,
      italics: true,
    })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
  }));

  // 遍历所有章节
  doc.sections.forEach(section => {
    const isFifthSection = /（五）/.test(section.title) || /研究的思路.*过程与方法/.test(section.title);
    const isSeventhSection = /（七）/.test(section.title) || /预期研究成果/.test(section.title);

    // 章标题
    children.push(new Paragraph({
      children: [new TextRun({
        text: section.title,
        font: { eastAsia: "黑体", ascii: "Times New Roman" },
        size: 28,
        bold: true,
      })],
      spacing: { before: 300, after: 150 },
    }));

    // 第七章（预期研究成果）特殊处理：表格
    if (isSeventhSection) {
      const now = new Date();
      const applyMonth = now.getMonth() + 1;
      const applyYear = applyMonth <= 6 ? now.getFullYear() : now.getFullYear() + 1;
      const tableData = parseOutcomesTable(section.content, applyYear + 3);
      if (tableData.prefix) {
        children.push(new Paragraph({
          children: [new TextRun({
            text: tableData.prefix,
            font: { eastAsia: "仿宋", ascii: "Times New Roman" },
            size: 24,
          })],
          spacing: { line: 360 },
          indent: { firstLine: 480 },
        }));
      }
      // 阶段成果表
      if (tableData.stageRows.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({
            text: tableData.stageHeader,
            font: { eastAsia: "黑体", ascii: "Times New Roman" },
            size: 24,
            bold: true,
          })],
          spacing: { before: 200, after: 100 },
        }));
        children.push(buildSimpleTable(["成果名称", "成果形式", "完成时间"], tableData.stageRows));
      }
      // 最终成果表
      if (tableData.finalRows.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({
            text: tableData.finalHeader,
            font: { eastAsia: "黑体", ascii: "Times New Roman" },
            size: 24,
            bold: true,
          })],
          spacing: { before: 200, after: 100 },
        }));
        children.push(buildSimpleTable(["成果名称", "成果形式", "完成时间"], tableData.finalRows));
      }
      return;
    }

    // 提取框架图（仅第五章可能包含）
    let processedContent = section.content;
    let figureLines: string[] = [];
    let figureTitle = "";
    if (isFifthSection) {
      const extracted = extractFrameworkFigure(section.content);
      processedContent = extracted.cleaned;
      figureLines = extracted.figureLines;
      figureTitle = extracted.figureTitle;
      // 清除 [FRAMEWORK_JSON_START]...[FRAMEWORK_JSON_END] 标记及内容（已由 framework-diagram.ts 提取并渲染为 PNG）
      processedContent = processedContent.replace(/\[FRAMEWORK_JSON_START\][\s\S]*?\[FRAMEWORK_JSON_END\]/g, "").trim();
    }

    // 渲染正文段落
    const paragraphs = cleanMarkdown(processedContent).split("\n").filter(p => p.trim());
    paragraphs.forEach((p, idx) => {
      const text = p.trim();
      const isTableHeading = /^(阶段成果|最终成果)/.test(text);

      // ── 检测"标题+描述"混合行，拆分为加粗标题 + 缩进正文 ──
      // 模式1：目标1：【标题】描述... / 观点1：【标题】描述...
      // 模式2：视角新：【标题】 vs 【对比】描述... / 框架新：... / 路径新：...
      // 模式3：【子任务名称】：... / 【具体研究动作】：... / 【预期产出】：...
      const titleDescMatch = text.match(/^(目标\d|观点\d|创新\d)\s*[：:]\s*【([^】]+)】\s*([\s\S]+)$/);
      const innovationMatch = text.match(/^(视角新|框架新|路径新)\s*[：:]\s*【([^】]+)】\s*vs\s*【([^】]+)】\s*[\s。]*([\s\S]*)$/);
      const labelMatch = text.match(/^(【[^】]+】)\s*[：:]\s*(.+)$/);

      if (isTableHeading) {
        // 表格标题不处理
        return;
      } else if (titleDescMatch) {
        // 模式1：目标/观点 — "目标1：【标题】描述"
        const prefix = titleDescMatch[1];   // 目标1
        const title = titleDescMatch[2];     // 标题
        const desc = titleDescMatch[3];      // 描述
        children.push(new Paragraph({
          children: [new TextRun({
            text: `${prefix}：${title}`,
            font: { eastAsia: "黑体", ascii: "Times New Roman" },
            size: 24,
            bold: true,
          })],
          spacing: { before: 150, after: 40, line: 360 },
        }));
        children.push(new Paragraph({
          children: parseInlineReferences(desc, { size: 24, font: { eastAsia: "仿宋", ascii: "Times New Roman" } }),
          spacing: { line: 360, after: 60 },
          indent: { left: 480, firstLine: 0 },
        }));
      } else if (innovationMatch) {
        // 模式2：创新点 — "视角新：【本课题】 vs 【传统】描述"
        const prefix = innovationMatch[1];     // 视角新
        const self = innovationMatch[2];        // 本课题视角
        const contrast = innovationMatch[3];    // 传统视角
        const desc = innovationMatch[4];        // 描述
        children.push(new Paragraph({
          children: [new TextRun({
            text: `${prefix}：${self}`,
            font: { eastAsia: "黑体", ascii: "Times New Roman" },
            size: 24,
            bold: true,
          }), new TextRun({
            text: " vs ",
            font: { eastAsia: "黑体", ascii: "Times New Roman" },
            size: 24,
            bold: true,
            color: "6B7280",
          }), new TextRun({
            text: contrast,
            font: { eastAsia: "黑体", ascii: "Times New Roman" },
            size: 24,
            bold: true,
          })],
          spacing: { before: 150, after: 40, line: 360 },
        }));
        if (desc && desc.trim()) {
          children.push(new Paragraph({
            children: parseInlineReferences(desc.trim(), { size: 24, font: { eastAsia: "仿宋", ascii: "Times New Roman" } }),
            spacing: { line: 360, after: 60 },
            indent: { left: 480, firstLine: 0 },
          }));
        }
      } else if (labelMatch) {
        // 模式3：【标签】：内容 — 如【子任务名称】：xxx / 【具体研究动作】：xxx
        const label = labelMatch[1];  // 【子任务名称】
        const content = labelMatch[2]; // 内容
        children.push(new Paragraph({
          children: [
            new TextRun({
              text: `${label}：`,
              font: { eastAsia: "黑体", ascii: "Times New Roman" },
              size: 24,
              bold: true,
            }),
            ...parseInlineReferences(content, { size: 24, font: { eastAsia: "仿宋", ascii: "Times New Roman" } }),
          ],
          spacing: { line: 360, after: 60 },
          indent: { left: 480, firstLine: 0 },
        }));
      } else if (isShortSubHeading(text)) {
        // 短小标题（纯标题行，无描述）
        children.push(new Paragraph({
          children: [new TextRun({
            text: text,
            font: { eastAsia: "黑体", ascii: "Times New Roman" },
            size: 24,
            bold: true,
          })],
          spacing: { before: 150, after: 80, line: 360 },
        }));
      } else {
        // 普通正文
        children.push(new Paragraph({
          children: parseInlineReferences(text, { size: 24, font: { eastAsia: "仿宋", ascii: "Times New Roman" } }),
          spacing: { line: 360, after: 60 },
          indent: { firstLine: 480 },
        }));
      }
    });

    // 第（五）章末尾插入框架图（PNG 优先级最高）
    if (isFifthSection && options.frameworkDiagram) {
      // ── PNG 路径（优先）──
      children.push(new Paragraph({
        children: [new TextRun({
          text: "本研究模型见图1。",
          font: { eastAsia: "仿宋", ascii: "Times New Roman" },
          size: 24,
        })],
        spacing: { line: 360, after: 100 },
        indent: { firstLine: 480 },
      }));
      children.push(new Paragraph({
        children: [new ImageRun({
          data: options.frameworkDiagram,
          transformation: { width: 624, height: 437 },
          type: "png",
        })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 100 },
      }));
      children.push(new Paragraph({
        children: [new TextRun({
          text: "图1 研究框架图",
          font: { eastAsia: "仿宋", ascii: "Times New Roman" },
          size: 21,
          italics: true,
        })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }));
    } else if (isFifthSection && figureLines.length > 0) {
      // ── ASCII 后备路径（PNG 失败时）──
      const figureParas = renderFrameworkFigure(figureLines, figureTitle);
      children.push(...figureParas);
    }
  });

  // ── 参考文献 ──
  if (doc.references && doc.references.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({
        text: "参考文献",
        font: { eastAsia: "黑体", ascii: "Times New Roman" },
        size: 28,
        bold: true,
      })],
      spacing: { before: 400, after: 150 },
    }));
    doc.references.forEach((ref) => {
      children.push(new Paragraph({
        children: [new TextRun({
          text: ref,
          font: { eastAsia: "仿宋", ascii: "Times New Roman" },
          size: 21,
        })],
        spacing: { line: 320, after: 60 },
        indent: { left: 480, hanging: 240 },
      }));
    });
  }

  // ── 页眉页脚 ──
  const header = new Header({
    children: [new Paragraph({
      children: [new TextRun({
        text: "江苏省教育科学规划课题申报评审活页",
        font: { eastAsia: "仿宋", ascii: "Times New Roman" },
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

  const docxDoc = new Document({
    creator: "QuickClass 教研宝",
    title: doc.title,
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT },
          margin: { top: 1700, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children,
    }],
  });

  return await Packer.toBuffer(docxDoc);
}