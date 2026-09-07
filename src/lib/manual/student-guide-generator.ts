/**
 * 学生学习手册（学案）生成器
 *
 * 与教学手册（manual-generator.ts，教师教案）相对：本模块从同一份课堂内容
 * 生成一份"发给学生用"的学习手册（.docx，可打印），学生视角呈现：
 *   《课题》学习手册（班级/姓名/日期填写栏）
 *   一、我的学习目标（取自课堂目标，逐条列出）
 *   二、课堂任务单（对话 / 探究 / 作业 / 项目，勾选框 + 学生要做的事 + 提示）
 *   三、随堂练习（课堂作业题目 + 作答区，不含参考答案，答案由课堂讲解/平台反馈）
 *   四、我的学习小结（自评填空）
 *   附录：本课知识点（知识库与课堂教育内容合并整理成一份「知识点 + 内容」，不区分来源）
 *
 * 章节按实际有内容的部分自动编号；空章节（无题目的随堂练习、全空的任务单等）不出现。
 *
 * 内容只取学生端真实可见的活动（已启用），字段口径与
 * src/app/api/student/tasks/route.ts 保持一致。
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Footer,
  PageNumber,
  AlignmentType,
  BorderStyle,
  ShadingType,
  LineRuleType,
} from "docx";
import type {
  ManualTaskInput,
  ManualQuestion,
  ManualQuizActivity,
} from "./manual-generator";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const TYPE_CN: Record<string, string> = {
  SINGLE_CHOICE: "单选题",
  MULTIPLE_CHOICE: "多选题",
  TRUE_FALSE: "判断题",
};

const CATEGORY_CN: Record<string, string> = {
  TEXT: "文本",
  IMAGE: "图片",
  VIDEO: "视频",
  AUDIO: "音频",
  FILE: "文件",
  DOCUMENT: "文档",
};

const FONT_EAST = "宋体";
const FONT_ASCII = "Times New Roman";
const TITLE_SIZE = 48; // 24pt
const H1_SIZE = 30; // 15pt
const H2_SIZE = 24; // 12pt
const BODY_SIZE = 24; // 12pt
const SMALL_SIZE = 21; // 10.5pt

const COLOR_TITLE = "143256"; // 封面深蓝
const COLOR_HEADING = "1A3C6E";
const COLOR_ACCENT = "2B6CB0"; // 冷蓝
const COLOR_HINT = "6B7A90"; // 冷灰
const COLOR_BODY = "000000";
const SHADE_H1 = "EAF0F8";
const SHADE_TASK = "F4F8FD"; // 任务标题底（浅冷蓝）
const LINE_TASK = "2B6CB0";
const LINE_WRITE = "B9C4CF";

const pt = (v: number) => v * 2;

// ---------------------------------------------------------------------------
// 纯文本工具（与教学手册口径一致）
// ---------------------------------------------------------------------------

function ensurePeriod(text: string): string {
  const t = (text || "").trimEnd();
  if (!t) return t;
  const deduped = t.replace(/[。．]{2,}$/, (m) => m[m.length - 1]);
  if (/[。．.！？!?；;：:…~～”』」）)\]】>》]$/.test(deduped)) return deduped;
  return deduped + "。";
}

/** 解析选项 JSON（{"A":"xx","B":"yy"}）→ 排序后的 [字母, 文本] */
function parseOptions(
  optionsStr: string,
  qType: string
): [string, string][] {
  if (qType === "TRUE_FALSE" || !optionsStr) return [];
  try {
    const opts =
      typeof optionsStr === "string" ? JSON.parse(optionsStr) : optionsStr;
    if (opts && typeof opts === "object") {
      return Object.entries(opts).sort((a, b) => a[0].localeCompare(b[0]));
    }
  } catch {
    // ignore
  }
  return [];
}

/** HTML → 纯文本摘要（探究页面要点提示用） */
function htmlToText(html: string, limit = 120): string {
  if (!html) return "";
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > limit) {
    text = text.slice(0, limit) + "……";
  }
  return text;
}

/** 探究页面是否有实质内容（去掉标签与空白后仍有文字） */
function hasHtmlContent(html: string): boolean {
  return htmlToText(html || "", Number.MAX_SAFE_INTEGER).replace(/[\s　]+/g, "")
    .length > 0;
}

interface KnowledgePoint {
  /** 知识点名称（可为空：原文没有明确知识点名时只给内容） */
  term: string;
  /** 知识点的具体内容 */
  content: string;
}

/**
 * 从知识库文档 / 课堂教育内容中整理出「知识点 + 内容」
 * - markdown / HTML 标题（# 或 h1-h6）→ 知识点名称，其后正文归到该知识点
 * - 「名称：内容」「【名称】内容」→ 拆成知识点名与内容
 * - 其余行独立成条（只有内容，没有知识点名）
 */
function extractKnowledgePoints(
  raw: string,
  maxItems: number,
  maxLen: number
): KnowledgePoint[] {
  if (!raw) return [];
  const text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, "\n## $2\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\r/g, "");

  const stripInline = (line: string) =>
    line
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\s*[-*+>]\s*/, "")
      .replace(/^\s*\d+[.、．)]\s*/, "")
      .replace(/^\s*[（(]\d+[)）]\s*/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const isHeading = (line: string) => /^\s*#{1,6}\s+\S/.test(line);

  const items: KnowledgePoint[] = [];
  // current：当前标题知识点；其中 children 是标题下自带的「名称：内容」子条目
  let current: { term: string; content: string; children: KnowledgePoint[] } | null =
    null;
  const flush = () => {
    if (!current) return;
    const content = current.content.trim();
    // 只有名称没有内容的标题（如仅作分节的一级标题）不进手册
    if (content) {
      items.push({ term: current.term.slice(0, 40), content });
    }
    for (const child of current.children) items.push(child);
    current = null;
  };
  const pushPair = (term: string, content: string) => {
    const pair = { term: term.slice(0, 40), content: content.trim() };
    if (current) {
      current.children.push(pair); // 归到当前标题之后，保持原顺序
    } else {
      items.push(pair);
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isHeading(line)) {
      flush();
      current = { term: stripInline(line), content: "", children: [] };
      continue;
    }
    const body = stripInline(line);
    if (!body || body.length < 4 || /^[\s\-—_=*·.。]+$/.test(body)) continue;

    // 「【名称】内容」
    const bracket = body.match(/^[【\[]([^】\]]{1,20})[】\]]\s*(.*)$/);
    if (bracket && bracket[2].trim().length >= 4) {
      pushPair(bracket[1], bracket[2]);
      continue;
    }
    // 「名称：内容」
    const colon = body.match(/^([^：:]{2,24})[：:]\s*(.{4,})$/);
    if (colon) {
      pushPair(colon[1], colon[2]);
      continue;
    }
    // 普通正文：有标题则并入该知识点，否则独立成条
    if (!current) {
      pushPair("", body);
      continue;
    }
    current.content = current.content ? `${current.content} ${body}` : body;
  }
  flush();

  // 整篇挤在一行（无换行）时，按句拆分兜底
  if (items.length === 0) {
    for (const seg of text.replace(/\s+/g, " ").match(/[^。！？；!?;]{6,}/g) ||
      []) {
      const s = stripInline(seg);
      if (s.length >= 6) pushPair("", s);
    }
  }

  const seen = new Set<string>();
  const out: KnowledgePoint[] = [];
  for (const item of items) {
    const key = `${item.term}|${item.content}`.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      term: item.term,
      content:
        item.content.length > maxLen
          ? `${item.content.slice(0, maxLen)}……`
          : item.content,
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 把教师视角的"学生能/学生将…"改成学生口吻"我能/我将…"（目标句式一般为"通过……，学生能……"） */
function toStudentFriendly(line: string): string {
  return line.replace(/学生(?=[能会可以将要])/, "我");
}

/** 空行填空线（段落底边框），长度参数 unused 保留以示意 */
const addWriteLine = (paras: Paragraph[], n: number) => {
  for (let i = 0; i < n; i++) {
    paras.push(
      new Paragraph({
        children: [],
        spacing: { before: pt(6), after: pt(0), line: 276, lineRule: LineRuleType.AUTO },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 8,
            color: LINE_WRITE,
            space: 1,
          },
        },
      })
    );
  }
};

/** 逐字下划线填空（适合标题后的横线）：＿＿＿＿ */
const BLANK = "＿＿＿＿＿＿";

// ---------------------------------------------------------------------------
// 任务构建
// ---------------------------------------------------------------------------

interface StudyTask {
  type: "对话" | "探究" | "作业" | "项目";
  title: string;
  desc?: string;
  doText: string;
  tips: string[];
}

function buildStudyTasks(data: ManualTaskInput): StudyTask[] {
  const tasks: StudyTask[] = [];
  const convs = data.presetConversations || [];
  const exps = data.explorations || [];
  const quizzes = data.quizActivities || [];
  const projects = data.projectSubmissions || [];

  // 1. 对话：既没有说明也没有引导语的"空对话"不进手册
  for (const conv of convs) {
    if (!(conv.description || "").trim() && !(conv.systemPrompt || "").trim()) {
      continue;
    }
    const title = conv.title || "课堂对话";
    tasks.push({
      type: "对话",
      title,
      desc: conv.description || "",
      doText: `参与「${title}」的课堂对话，围绕老师提出的问题说出自己的想法，并说明理由；认真倾听，也可以赞同或补充同学的观点。`,
      tips: [],
    });
  }

  // 2. 探究：页面无内容且无说明的"空探究"不进手册
  for (const exp of exps) {
    if (!hasHtmlContent(exp.htmlContent || "") && !(exp.description || "").trim()) {
      continue;
    }
    const title = exp.title || "互动探究";
    const aiOn = exp.enableAiCompanion !== false;
    const submitOn = exp.enableSubmission === true;
    const summary = htmlToText(exp.htmlContent || "", 120);
    const tips: string[] = [];
    if (summary) {
      tips.push(`页面要点：${summary}`);
    }
    if (aiOn) {
      tips.push(
        "遇到困难可先点页面里的「AI 伴学」求助，提问时要说清楚自己已经做到哪一步。"
      );
    }
    if (submitOn) {
      tips.push("完成探究后按页面提示提交探究结果。");
    }
    tasks.push({
      type: "探究",
      title,
      desc: exp.description || "",
      doText: `打开「${title}」的探究页面，自己动手试一试，观察发生了什么、记下你的发现；完成后用自己的话总结：我发现了什么、为什么。`,
      tips,
    });
  }

  // 3. 作业：没有题目的"空作业"不进手册（随堂练习章节同样不出）
  for (const quiz of quizzes) {
    const n = (quiz.questions || []).length;
    if (n === 0) continue;
    const title = quiz.title || "课堂作业";
    tasks.push({
      type: "作业",
      title,
      desc: quiz.description || "",
      doText: `独立完成「${title}」中的${n}道题目，全部做完再查看解析，把错题认真订正一遍。`,
      tips: ["做完一题检查一题，不要把答案写串行。"],
    });
  }

  // 4. 项目：既无说明、又未做任何设置（分类/大小/可见/点赞全为默认）的不进手册
  for (const proj of projects) {
    const desc = proj.description || "";
    const configured =
      !!desc.trim() ||
      (proj.category || "TEXT") !== "TEXT" ||
      (proj.fileSizeLimit ?? 10) !== 10 ||
      proj.visibleToClass === true ||
      proj.allowLike === true;
    if (!configured) continue;
    const title = proj.title || "项目提交";
    const category = CATEGORY_CN[proj.category || "TEXT"] || proj.category || "文本";
    const sizeLimit = proj.fileSizeLimit ?? 10;
    const visible = proj.visibleToClass !== false;
    const allowLike = proj.allowLike === true;
    const tips: string[] = [];
    if (visible) tips.push("作品提交后将展示给全班同学。");
    if (allowLike) tips.push("同学之间可以互相浏览、点赞作品。");
    tasks.push({
      type: "项目",
      title,
      desc: desc
        ? `${desc}（${category}类作品，单个文件不超过${sizeLimit}MB）`
        : `请完成一份${category}类作品（单个文件不超过${sizeLimit}MB）。`,
      doText: `按照要求完成「${title}」的作品并在课内提交。提交前对照要求自查一遍：内容完整、表述清楚、格式正确。`,
      tips,
    });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export async function buildStudentGuideDocx(
  data: ManualTaskInput
): Promise<Buffer> {
  // ---- 解析输入 ----
  let rawTitle = data.title || "";
  let source = "";
  let taskTitle = rawTitle;
  if (rawTitle.includes("_来源于_")) {
    const parts = rawTitle.split("_来源于_");
    taskTitle = parts[0];
    source = parts[1] || "";
  }
  const grade = data.grade || "";
  const subject = data.subject || "";

  // 学习目标：课堂目标（description）逐条拆分
  const objItems = (data.description || "")
    .split(/[\n；;]+/)
    .map((l) => l.replace(/^[ 　·\-]+|[ 　·\-]+$/g, ""))
    .map((l) => l.replace(/^\d+\s*[.、．)]?\s*/, ""))
    .map(toStudentFriendly)
    .filter(Boolean);

  // 任务单
  const tasks = buildStudyTasks(data);

  // 随堂练习分组（按作业活动分组，组内按 order 排序）
  const quizGroups: { title: string; questions: ManualQuestion[] }[] = [];
  for (const quiz of data.quizActivities || []) {
    const questions = [...(quiz.questions || [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    if (questions.length > 0) {
      quizGroups.push({ title: quiz.title || "课堂作业", questions });
    }
  }

  // 附录知识点：知识库与课堂教育内容合并整理成一份，不区分来源、统一编号
  const appendixPoints: KnowledgePoint[] = [];
  const appendixSeen = new Set<string>();
  const pushPoints = (items: KnowledgePoint[]) => {
    for (const item of items) {
      const key = `${item.term}|${item.content}`.slice(0, 40);
      if (appendixSeen.has(key)) continue; // 跨来源去重
      appendixSeen.add(key);
      appendixPoints.push(item);
    }
  };
  for (const kb of data.knowledgeBases || []) {
    pushPoints(extractKnowledgePoints(kb.content || "", 25, 240));
  }
  for (const exp of data.explorations || []) {
    pushPoints(extractKnowledgePoints(exp.htmlContent || "", 10, 180));
  }
  appendixPoints.splice(30); // 整份附录最多 30 条

  // ---- 文档 ----
  const children: Paragraph[] = [];

  const addParagraph = (
    text = "",
    opts: {
      size?: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
      before?: number;
      after?: number;
      line?: number;
      leftIndent?: number;
      firstLine?: number;
      shading?: string;
      borderLeft?: { color: string; size: number; space?: number };
      borderBottom?: { color: string; size: number; space?: number };
    } = {}
  ): Paragraph => {
    const paragraph = new Paragraph({
      children: [
        new TextRun({
          text,
          font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
          size: opts.size ?? BODY_SIZE,
          bold: opts.bold ?? false,
          italics: opts.italic ?? false,
          color: opts.color ?? COLOR_BODY,
        }),
      ],
      alignment: opts.align,
      spacing: {
        before: opts.before,
        after: opts.after,
        line: opts.line ?? 276,
        lineRule: LineRuleType.AUTO,
      },
      indent:
        opts.leftIndent !== undefined || opts.firstLine !== undefined
          ? { left: opts.leftIndent, firstLine: opts.firstLine }
          : undefined,
      shading: opts.shading
        ? { type: ShadingType.CLEAR, fill: opts.shading }
        : undefined,
      border:
        opts.borderLeft || opts.borderBottom
          ? {
              left: opts.borderLeft
                ? {
                    style: BorderStyle.SINGLE,
                    size: opts.borderLeft.size,
                    color: opts.borderLeft.color,
                    space: opts.borderLeft.space ?? 4,
                  }
                : undefined,
              bottom: opts.borderBottom
                ? {
                    style: BorderStyle.SINGLE,
                    size: opts.borderBottom.size,
                    color: opts.borderBottom.color,
                    space: opts.borderBottom.space ?? 1,
                  }
                : undefined,
            }
          : undefined,
    });
    children.push(paragraph);
    return paragraph;
  };

  const addRuns = (
    runs: { text: string; size: number; bold: boolean; color: string }[],
    opts: {
      before?: number;
      after?: number;
      leftIndent?: number;
      shading?: string;
      borderLeft?: { color: string; size: number; space?: number };
    } = {}
  ): Paragraph => {
    const paragraph = new Paragraph({
      children: runs.map(
        (r) =>
          new TextRun({
            text: r.text,
            font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
            size: r.size,
            bold: r.bold,
            color: r.color,
          })
      ),
      spacing: {
        before: opts.before,
        after: opts.after,
        line: 276,
        lineRule: LineRuleType.AUTO,
      },
      indent:
        opts.leftIndent !== undefined ? { left: opts.leftIndent } : undefined,
      shading: opts.shading
        ? { type: ShadingType.CLEAR, fill: opts.shading }
        : undefined,
      border: opts.borderLeft
        ? {
            left: {
              style: BorderStyle.SINGLE,
              size: opts.borderLeft.size,
              color: opts.borderLeft.color,
              space: opts.borderLeft.space ?? 4,
            },
          }
        : undefined,
    });
    children.push(paragraph);
    return paragraph;
  };

  // 章节标题：按实际出现的章节自动编号（空章节不占号）
  const CN_SECTION = ["一", "二", "三", "四", "五", "六"];
  let sectionSeq = 0;
  const addH1 = (text: string) => {
    const no = CN_SECTION[sectionSeq++] ?? String(sectionSeq);
    addParagraph(`${no}、${text}`, {
      size: H1_SIZE,
      bold: true,
      color: COLOR_HEADING,
      before: pt(16),
      after: pt(8),
      leftIndent: 85,
      shading: SHADE_H1,
      borderLeft: { color: "1A3C6E", size: 24 },
    });
  };

  // 任务标题：□ 编号 + 名称
  const addTaskTitle = (seq: number, type: string, title: string) => {
    addRuns(
      [
        { text: "□　", size: BODY_SIZE, bold: true, color: COLOR_ACCENT },
        { text: `任务${seq}（${type}）　`, size: pt(14), bold: true, color: COLOR_ACCENT },
        { text: title, size: H2_SIZE, bold: true, color: COLOR_HEADING },
      ],
      {
        before: pt(14),
        after: pt(4),
        leftIndent: 57,
        shading: SHADE_TASK,
        borderLeft: { color: LINE_TASK, size: 18 },
      }
    );
  };

  // 分组小标题（随堂练习分组 / 附录要点分组）
  const addGroupTitle = (text: string) => {
    addParagraph(text, {
      size: BODY_SIZE,
      bold: true,
      color: COLOR_HEADING,
      before: pt(8),
      after: pt(2),
      leftIndent: 85,
      shading: "F1F6FB",
      borderLeft: { color: LINE_TASK, size: 16 },
    });
  };

  // 标签 + 正文
  const addLabelBody = (
    label: string,
    text: string,
    opts: { labelColor?: string; period?: boolean } = {}
  ) => {
    const paragraph = new Paragraph({
      children: [
        new TextRun({
          text: label,
          font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
          size: BODY_SIZE,
          bold: true,
          color: opts.labelColor ?? COLOR_ACCENT,
        }),
        new TextRun({
          text: opts.period === false ? text : ensurePeriod(text),
          font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
          size: BODY_SIZE,
          color: COLOR_BODY,
        }),
      ],
      spacing: { after: pt(3), line: 276, lineRule: LineRuleType.AUTO },
    });
    children.push(paragraph);
  };

  // 正文（首行缩进）
  const addBody = (
    text: string,
    opts: {
      bold?: boolean;
      italic?: boolean;
      color?: string;
      indent?: boolean;
      after?: number;
    } = {}
  ) => {
    addParagraph(text, {
      size: BODY_SIZE,
      bold: opts.bold ?? false,
      italic: opts.italic ?? false,
      color: opts.color ?? COLOR_BODY,
      after: opts.after ?? pt(5),
      firstLine: opts.indent ? 420 : undefined,
    });
  };

  const addSmall = (text: string, opts: { italic?: boolean } = {}) => {
    addParagraph(text, {
      size: SMALL_SIZE,
      italic: opts.italic ?? false,
      color: COLOR_HINT,
      after: pt(3),
    });
  };

  // ===================================================================
  // 头部：标题 + 填写栏
  // ===================================================================
  const coverTitle = `《${taskTitle}》学习手册`;
  addParagraph(coverTitle, {
    size: TITLE_SIZE,
    bold: true,
    color: COLOR_TITLE,
    align: AlignmentType.CENTER,
    before: pt(4),
    after: pt(6),
  });
  // 填写栏
  addParagraph("班级：＿＿＿＿＿＿　姓名：＿＿＿＿＿＿　日期：＿＿＿＿＿＿", {
    size: BODY_SIZE,
    bold: true,
    color: COLOR_BODY,
    align: AlignmentType.CENTER,
    after: pt(4),
  });
  let infoLine = `${grade || "年级待定"} · ${subject || "学科待定"}`;
  if (source) infoLine += ` · ${source}`;
  addParagraph(infoLine, {
    size: SMALL_SIZE,
    color: COLOR_HINT,
    align: AlignmentType.CENTER,
    after: pt(8),
  });
  addSmall("对照这份手册，跟着课堂一步一步完成下面的任务。完成一项，就在它前面的“□”里打个勾。", { italic: true });
  addParagraph("", { after: pt(2) });

  // ===================================================================
  // 一、我的学习目标
  // ===================================================================
  addH1("我的学习目标");
  if (objItems.length > 0) {
    addBody("学完这节课，我将努力达成：", { after: pt(2) });
    objItems.forEach((line, i) => {
      addBody(ensurePeriod(`${i + 1}. ${line}`), { indent: true, after: pt(2) });
    });
  } else {
    addBody("（老师还没有填写本课目标，请根据老师的课堂讲解补充填写。）", {
      italic: true,
      color: COLOR_HINT,
    });
  }
  addParagraph("", { after: pt(2) });

  // ===================================================================
  // 课堂任务单：全部活动都为空时，整节不出现
  // ===================================================================
  if (tasks.length > 0) {
    addH1("课堂任务单");
    tasks.forEach((task, i) => {
      const seq = i + 1;
      addTaskTitle(seq, task.type, task.title);
      if (task.desc) {
        addLabelBody("【说明】", task.desc);
      }
      addLabelBody("【我要做的】", task.doText);
      for (const tip of task.tips) {
        addLabelBody("【小提示】", tip, { labelColor: COLOR_HINT });
      }
      if (task.type === "对话" || task.type === "探究") {
        addParagraph("我的记录：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿", {
          size: BODY_SIZE,
          color: COLOR_HINT,
          before: pt(4),
          after: pt(2),
          leftIndent: 142,
        });
        addParagraph("＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿", {
          size: BODY_SIZE,
          color: COLOR_HINT,
          after: pt(2),
          leftIndent: 142,
        });
      }
      if (i < tasks.length - 1) {
        addParagraph("", { after: pt(2) });
      }
    });
    addParagraph("", { after: pt(2) });
  }

  // ===================================================================
  // 随堂练习：一道题都没有时，整节不出现
  // ===================================================================
  if (quizGroups.length > 0) {
    addH1("随堂练习");
    addBody("仔细读题，独立完成下面的练习。做完后与同学交流订正，或听老师讲评。", {
      after: pt(4),
    });
    for (const group of quizGroups) {
      addGroupTitle(group.title);
      group.questions.forEach((q, qi) => {
        const qType = q.type || "SINGLE_CHOICE";
        const qTypeCn = TYPE_CN[qType] || qType;
        const qContent = q.content || "";
        const qOptions = q.options || "";
        const optsList = parseOptions(qOptions, qType);
        // 题目标题
        addRuns(
          [
            { text: `第 ${qi + 1} 题  `, size: pt(13), bold: true, color: COLOR_ACCENT },
            { text: `（${qTypeCn}）`, size: SMALL_SIZE, bold: false, color: COLOR_HINT },
          ],
          {
            before: pt(10),
            after: pt(3),
            leftIndent: 142,
            borderLeft: { color: LINE_TASK, size: 16 },
          }
        );
        addLabelBody("【题目】", qContent, { labelColor: COLOR_BODY });
        for (const [letter, optText] of optsList) {
          addParagraph(`${letter}. ${optText}`, {
            size: BODY_SIZE,
            leftIndent: 567,
            after: pt(1),
          });
        }
        // 作答区
        const answerLine =
          qType === "TRUE_FALSE"
            ? "我的判断：　　　　　　　　我的理由：＿＿＿＿＿＿＿＿＿＿＿＿"
            : "我的答案：＿＿＿＿＿＿＿＿＿＿＿＿";
        addParagraph(answerLine, {
          size: BODY_SIZE,
          color: COLOR_HINT,
          before: pt(2),
          after: pt(6),
          leftIndent: 142,
        });
      });
    }
    addSmall("参考答案由老师在课堂讲评或由平台即时反馈，请先自己思考再对照订正。", {
      italic: true,
    });
    addParagraph("", { after: pt(2) });
  }

  // ===================================================================
  // 四、我的学习小结
  // ===================================================================
  addH1("我的学习小结");
  addBody("课堂结束前，花两三分钟回顾今天的学习，写下你的小结：", { after: pt(2) });
  const summaryLines: string[] = [
    "这节课我最喜欢（收获最大）的一个任务：",
    "我学到、并想牢牢记住的一点：",
    "我还没弄懂、想请教老师或同学的问题：",
  ];
  for (const [i, line] of summaryLines.entries()) {
    addParagraph(`${i + 1}. ${line}`, {
      size: BODY_SIZE,
      bold: true,
      color: COLOR_ACCENT,
      before: pt(6),
      after: pt(2),
    });
    addWriteLine(children, 1);
    addParagraph("", { after: pt(0) });
  }
  addParagraph(`4. 给自己今天的学习点个赞（涂黑几颗星）：★ ☆ ☆ ☆ ☆`, {
    size: BODY_SIZE,
    bold: true,
    color: COLOR_ACCENT,
    before: pt(6),
    after: pt(2),
  });
  addWriteLine(children, 1);
  addParagraph("", { after: pt(0) });

  // ===================================================================
  // 附录：学习要点（无内容可提炼时整节不出现）
  // ===================================================================
  if (appendixPoints.length > 0) {
    addH1("附录：本课知识点");
    addBody("下面是与本课相关的知识点及其内容，上课或课后复习时可以对照查阅。", {
      after: pt(4),
    });
    appendixPoints.forEach((p, i) => {
      if (p.term) {
        addRuns(
          [
            { text: `${i + 1}. `, size: BODY_SIZE, bold: true, color: COLOR_ACCENT },
            { text: `${p.term}：`, size: BODY_SIZE, bold: true, color: COLOR_HEADING },
            {
              text: ensurePeriod(p.content),
              size: BODY_SIZE,
              bold: false,
              color: COLOR_BODY,
            },
          ],
          { after: pt(2), leftIndent: 420 }
        );
      } else {
        addBody(ensurePeriod(`${i + 1}. ${p.content}`), {
          indent: true,
          after: pt(2),
        });
      }
    });
    addSmall(
      "知识点整理自老师准备的知识库与课堂内容；如与课堂讲解不一致，以老师的讲解为准。",
      { italic: true }
    );
    addParagraph("", { after: pt(2) });
  }

  // ===================================================================
  // 结尾说明 + 页码
  // ===================================================================
  addParagraph(
    "说明：本学习手册由 QuickClass 依据课堂内容自动生成，供学生课上、课后对照使用。如课堂内容有调整，请重新导出。",
    {
      size: SMALL_SIZE,
      italic: true,
      color: COLOR_HINT,
      before: pt(10),
      after: pt(5),
    }
  );

  const footer = new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            children: [PageNumber.CURRENT],
            font: { ascii: FONT_ASCII, eastAsia: FONT_EAST },
            size: pt(9),
            color: COLOR_HINT,
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });

  const docxDoc = new Document({
    creator: "QuickClass",
    title: coverTitle,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1797,
              right: 1797,
              footer: 720,
            },
          },
        },
        footers: { default: footer },
        children,
      },
    ],
  });

  return await Packer.toBuffer(docxDoc);
}
