"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, MessagePlugin, Button, Tag } from "tdesign-react";
import {
  AddIcon,
  EditIcon,
  DeleteIcon,
  UserIcon,
  UsergroupIcon,
  ChatIcon,
  DownloadIcon,
  UploadIcon,
  FileIcon,
} from "tdesign-icons-react";
import TeacherLayout from "@/components/layout/TeacherLayout";
import TemplatePreviewButton from "@/components/template/TemplatePreviewButton";

interface AnalysisTemplate {
  id: string;
  type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS";
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  // 模板效果预览状态（由列表接口带下来，避免每张卡片各发一次请求）
  hasPreview?: boolean;
  previewStale?: boolean;
  previewAt?: string | null;
}

interface TemplateVariable {
  name: string;
  desc: string;
}

interface AvailableVariable {
  name: string;
  desc: string;
}

// 根据 AI 帮写时的三个选项生成模板名称前缀，如 "[网页型·通用·课堂]"。
// 📐 CONTRACT：前缀格式与剥离正则 /^\[[^\]]*\]\s*/ 配套（handleGenerateAI 内），
// 改前缀格式必须同步改剥离规则，否则会重复叠加。
// ⚠️ GOTCHA：作用域段仅学情分析写入——custom（个性）模式作用域由 AI 按意图判断，aiScope 未生效；
// QUIZ_ANALYSIS/EXPLORATION_ANALYSIS 无 scope 维度，任何模式都是两段前缀。scope 不传时
// parseNamePrefix 对第三段兜底 task，对无 scope 维度的类型无实际影响。
const buildNamePrefix = (
  style: "text" | "html",
  mode: "generic" | "custom",
  scope?: "task" | "pc"
): string => {
  const parts = [style === "html" ? "网页型" : "文本型", mode === "custom" ? "个性" : "通用"];
  if (mode === "generic" && scope) parts.push(scope === "pc" ? "对话" : "课堂");
  return `[${parts.join("·")}]`;
};

// 从名称前缀解析三个维度（报告样式/模板类型/适用范围），无前缀返回 null
// 📐 CONTRACT：解析格式与 buildNamePrefix 输出严格对应（唯一写入方），改前缀格式必须同步改这里
// ⚠️ GOTCHA：custom（个性）前缀只有两段，scope 解析不到时兜底 task——custom 模式下 scope
// 不参与生成参数传值（见 handleGenerateAI），兜底值无实际影响
const parseNamePrefix = (
  name: string
): { style: "text" | "html"; mode: "generic" | "custom"; scope: "task" | "pc" } | null => {
  const m = name.match(/^\[([^\]]*)\]/);
  if (!m) return null;
  const segs = m[1].split("·");
  const style = segs[0] === "网页型" ? "html" : segs[0] === "文本型" ? "text" : null;
  const mode = segs[1] === "个性" ? "custom" : segs[1] === "通用" ? "generic" : null;
  if (!style || !mode) return null;
  const scope = segs[2] === "对话" ? "pc" : "task";
  return { style, mode, scope };
};

// 把维度前缀写进名称：剥旧前缀 + 拼新前缀（前缀是三维度在库里的唯一载体，schema 无独立字段）
// ⛔ DO NOT REVERT：改维度选择器后必须经此函数同步前缀，否则「修改维度→保存」静默无效
// （2026-10-11 教师实测踩坑）。调用方：handleGenerateAI（AI 帮写后写入）、handleSave（手动保存同步）
const withNamePrefix = (name: string, prefix: string): string =>
  prefix + (name.replace(/^\[[^\]]*\]\s*/, "").trim() || "未命名模板");

// 主题化（2026-10-13）：六类模板图标色全部走教师端主题的 CSS 变量（见 lib/teacher-theme.ts）。
// 分类区分靠「不同语义令牌」而非固定色值：纯黑白/灰度主题下仍保持层级差异但依旧是单色。
// ⛔ DO NOT REVERT：CSS 变量可直接用于内联 style；改回固定 hex 会让这两套单色主题出现彩色残留。
const TYPE_CONFIG = {
  conversation: {
    title: "学生对话设计模板",
    description: "用于设计学生对话活动的提示词",
    icon: ChatIcon,
    color: "var(--warning)",
  },
  student: {
    title: "学生个人学情模板",
    description: "用于分析单个学生的对话表现",
    icon: UserIcon,
    color: "var(--primary)",
  },
  class: {
    title: "学生全班学情模板",
    description: "用于汇总分析全班学生的对话情况",
    icon: UsergroupIcon,
    color: "var(--success)",
  },
  QUIZ_DESIGN: {
    title: "课堂作业设计模板",
    description: "用于AI生成课堂作业题目",
    icon: FileIcon,
    color: "var(--accent)",
  },
  QUIZ_ANALYSIS: {
    title: "课堂作业分析模板",
    description: "用于AI分析班级作业结果",
    icon: FileIcon,
    color: "var(--secondary)",
  },
  EXPLORATION_ANALYSIS: {
    title: "互动探究分析模板",
    description: "用于AI分析互动探究提交结果",
    icon: FileIcon,
    color: "var(--danger)",
  },
} as const;

export default function TemplateSettingsPage() {
  const [studentTemplates, setStudentTemplates] = useState<AnalysisTemplate[]>([]);
  const [classTemplates, setClassTemplates] = useState<AnalysisTemplate[]>([]);
  const [conversationTemplates, setConversationTemplates] = useState<AnalysisTemplate[]>([]);
  const [quizDesignTemplates, setQuizDesignTemplates] = useState<AnalysisTemplate[]>([]);
  const [quizAnalysisTemplates, setQuizAnalysisTemplates] = useState<AnalysisTemplate[]>([]);
  const [explorationAnalysisTemplates, setExplorationAnalysisTemplates] = useState<AnalysisTemplate[]>([]);
  const [templateVariables, setTemplateVariables] = useState<{
    conversation: { class: TemplateVariable[]; student: TemplateVariable[] };
    task: { class: TemplateVariable[]; student: TemplateVariable[] };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // 当前展开的类型（null=全部收起）
  const [expandedType, setExpandedType] = useState<"student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS" | null>(null);

  // 编辑弹窗状态
  const [editDialogVisible, setEditDialogVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AnalysisTemplate | null>(null);
  const [editType, setEditType] = useState<"student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS">("student");
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  // AI 帮我写（支持 conversation / QUIZ_DESIGN / student / class，知识库见 src/lib/template-writing-guide.ts）
  const [aiIntent, setAiIntent] = useState("");
  // student/class 学情分析专属：generic=通用模板（变量占位，需选作用域）；custom=个性模板（上下文按意图写死）
  const [aiMode, setAiMode] = useState<"generic" | "custom">("generic");
  const [aiScope, setAiScope] = useState<"task" | "pc">("task");
  // student/class 学情分析专属：报告样式——text=纯文本 Markdown；html=网页型（分析 AI 输出完整 HTML 文档，渲染端沙箱 iframe，token 消耗更高）
  const [aiStyle, setAiStyle] = useState<"text" | "html">("text");
  const [aiGenerating, setAiGenerating] = useState(false);
  // 生成前的内容快照（null=无快照），用于「撤销本次生成」
  const [aiPrevContent, setAiPrevContent] = useState<string | null>(null);
  // 生成前的名称快照：AI 帮写成功会同时写内容+名称前缀，撤销必须两者都回滚，
  // 否则名称前缀残留、标签与回滚后的内容不符（2026-10-11 同源踩坑修复）
  const [aiPrevName, setAiPrevName] = useState<string | null>(null);
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  // 生成中已等待秒数（教师反馈：生成期间要有思考耗时提示，否则不知道是否卡住）
  const [aiElapsed, setAiElapsed] = useState(0);
  useEffect(() => {
    if (!aiGenerating) return;
    setAiElapsed(0);
    const timer = setInterval(() => setAiElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [aiGenerating]);

  // 删除确认
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<AnalysisTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 导入 ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<"student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS">("student");
  // 点「导入」时锁定的分类：文件选择是异步的，用 ref 保证"选文件时用的分类"和"点按钮时看到的分类"一致
  const importTypeRef = useRef<typeof importType>("student");
  // 批量导入进行中（按钮禁用 + 显示进度）
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  // 导出模板（.md 文件，自动下载）
  const handleExport = (tpl: AnalysisTemplate) => {
    // 模板类别名称使用 TYPE_CONFIG 中的完整 title
    const categoryName = TYPE_CONFIG[tpl.type as keyof typeof TYPE_CONFIG]?.title || tpl.type;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const content = `${tpl.name}\n${tpl.content}`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${categoryName}_${tpl.name}_${date}.MD`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    MessagePlugin.success("模板已导出");
  };

  // 导入模板：支持一次选择多个 .md 文件，逐个导入后汇总结果
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // 先把 FileList 拷贝成数组：后面会清空 input，FileList 会被一并清掉
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const type = importTypeRef.current;
    const imported: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    setImporting(true);
    try {
      const token = localStorage.getItem("token");

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (files.length > 1) setImportProgress(`导入中 ${i + 1}/${files.length}`);

        // 只允许 .md 文件
        if (!file.name.toLowerCase().endsWith(".md")) {
          skipped.push(`${file.name}（不是 .md 文件）`);
          continue;
        }

        let content = "";
        try {
          content = (await file.text()).trim();
        } catch {
          failed.push(`${file.name}（读取失败）`);
          continue;
        }
        if (!content) {
          skipped.push(`${file.name}（内容为空）`);
          continue;
        }

        // 模板名使用上传文件的文件名（去掉扩展名），保证导出文件名 = 导入文件名，可往返
        const dotIndex = file.name.lastIndexOf(".");
        const name = (dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name).trim();
        if (!name) {
          skipped.push(`${file.name}（无法从文件名解析模板名称）`);
          continue;
        }

        try {
          const res = await fetch("/api/analysis-templates", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              type,
              name,
              content,
              isDefault: false,
            }),
          });

          if (res.ok) {
            imported.push(name);
          } else {
            const data = await res.json().catch(() => ({}) as { error?: string });
            failed.push(`${name}（${data.error || `接口返回 ${res.status}`}）`);
          }
        } catch {
          failed.push(`${name}（网络错误）`);
        }
      }

      if (imported.length > 0) fetchTemplates();

      // 汇总：成功 / 跳过 / 失败各多少个，失败的逐条列出便于定位
      const summaryParts: string[] = [];
      if (imported.length > 0) summaryParts.push(`成功导入 ${imported.length} 个`);
      if (skipped.length > 0) summaryParts.push(`跳过 ${skipped.length} 个`);
      if (failed.length > 0) summaryParts.push(`失败 ${failed.length} 个`);
      const summary = summaryParts.length > 0 ? summaryParts.join("，") : "没有可导入的文件";
      // 逐条明细最多列 5 条，其余给个总数，避免提示条过长
      const detailOf = (list: string[]) => {
        const shown = list.slice(0, 5).join("；");
        const rest = list.length > 5 ? `；等共 ${list.length} 个` : "";
        return `${shown}${rest}`;
      };

      if (failed.length > 0) {
        MessagePlugin.error(`${summary}；失败：${detailOf(failed)}${skipped.length > 0 ? `；跳过：${detailOf(skipped)}` : ""}`);
      } else if (skipped.length > 0) {
        MessagePlugin.warning(`${summary}；跳过：${detailOf(skipped)}`);
      } else {
        MessagePlugin.success(summary);
      }
    } finally {
      setImporting(false);
      setImportProgress("");
      e.target.value = "";
    }
  };

  // 获取模板列表
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/analysis-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStudentTemplates(data.studentTemplates || []);
        setClassTemplates(data.classTemplates || []);
        setConversationTemplates(data.conversationTemplates || []);
        setQuizDesignTemplates(data.quizDesignTemplates || []);
        setQuizAnalysisTemplates(data.quizAnalysisTemplates || []);
        setExplorationAnalysisTemplates(data.explorationAnalysisTemplates || []);
        if (data.templateVariables) {
          setTemplateVariables(data.templateVariables);
        }
      } else {
        MessagePlugin.error(`获取模板列表失败（${res.status}）`);
      }
    } catch {
      MessagePlugin.error("获取模板列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // 打开新增弹窗
  const openAddDialog = (type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS") => {
    setEditingTemplate(null);
    setEditType(type);
    setEditName("");
    setEditContent("");
    setEditIsDefault(false);
    // 重置 AI 生成状态，避免上一次弹窗的意图/快照/警告串场
    setAiIntent("");
    setAiPrevContent(null);
    setAiPrevName(null);
    setAiWarning(null);
    setAiMode("generic");
    setAiScope("task");
    setAiStyle("text");
    setEditDialogVisible(true);
  };

  // 打开编辑弹窗
  const openEditDialog = (template: AnalysisTemplate) => {
    setEditingTemplate(template);
    setEditType(template.type);
    setEditName(template.name);
    setEditContent(template.content);
    setEditIsDefault(template.isDefault);
    // 重置 AI 生成状态，避免上一次弹窗的意图/快照/警告串场
    setAiIntent("");
    setAiPrevContent(null);
    setAiPrevName(null);
    setAiWarning(null);
    // 从名称前缀回填三维度选择器（报告样式/模板类型/适用范围）；无前缀保持默认
    // ⛔ DO NOT REVERT：不回填会让「AI 优化现有」拿错维度——如把网页型模板按文本型优化，
    // 输出 Markdown 覆盖 HTML 结构，网页型模板被静默破坏（2026-10-11 修复）
    // 🔗 RELATED：保存同步见 handleSave；前缀格式契约见 buildNamePrefix/parseNamePrefix
    const dims = parseNamePrefix(template.name);
    if (dims) {
      setAiStyle(dims.style);
      setAiMode(dims.mode);
      setAiScope(dims.scope);
    } else {
      setAiStyle("text");
      setAiMode("generic");
      setAiScope("task");
    }
    setEditDialogVisible(true);
  };

  // AI 维度判定（handleGenerateAI 传参与下方 JSX 渲染条件共用，必须放在组件顶层——
  // 放函数体内 JSX 拿不到，曾报 TS2304）
  const isInsightType = editType === "student" || editType === "class";
  // 作业/探究分析：与学情分析共用 mode（通用/个性）× style（文本/网页）两维度，无 scope 维度
  const isAnalysisType = editType === "QUIZ_ANALYSIS" || editType === "EXPLORATION_ANALYSIS";
  const supportsAiDimensions = isInsightType || isAnalysisType;

  // AI 意图输入框占位文案（按模板类型与 mode/scope 变化：学情分析区分 mode+scope，分析类区分 mode）
  const aiIntentPlaceholder =
    editType === "QUIZ_DESIGN"
      ? "想让这份作业怎么出？一句话描述，如：作业要分层，基础题和提升题都要有"
      : editType === "student"
        ? aiMode === "custom"
          ? "描述你的定制需求，如：为《三角形的内角和》写个人学情分析，重点结合作业成绩"
          : aiScope === "pc"
            ? "想让活动学情分析重点看什么？如：重点分析他的提问质量和思维深度"
            : "想让学情分析重点看什么？如：结合作业和探究数据，重点分析知识薄弱点"
        : editType === "class"
          ? aiMode === "custom"
            ? "描述你的定制需求，如：为《三角形的内角和》写全班学情分析，突出共性问题"
            : aiScope === "pc"
              ? "想让活动全班分析重点看什么？如：汇总本活动共性问题，列出重点关注学生"
              : "想让全班学情分析重点看什么？如：结合作业和探究数据，给出分层教学建议"
          : editType === "QUIZ_ANALYSIS"
            ? aiMode === "custom"
              ? "描述你的定制场景，如：为《三角形的内角和》单元测评写作业分析，重点分析作图题失分"
              : "想让这份作业分析重点看什么？如：重点分析薄弱知识点的归因和补救方式"
            : editType === "EXPLORATION_ANALYSIS"
              ? aiMode === "custom"
                ? "描述你的定制场景，如：为「水的三态变化」探究写分析，重点关注反复试错的学生"
                : "想让探究分析重点看什么？如：结合操作行为和作答内容，分析学生探究习惯"
              : "想让这段对话怎么教？一句话描述，如：希望不同的学生有不同的成长";

  // AI 帮我写/优化模板：editContent 非空走优化模式（保留教师设计），空走生成模式
  // 🔗 RELATED：src/app/api/analysis-templates/generate/route.ts（同一套模式判定，前后端必须一致）
  const handleGenerateAI = async () => {
    if (aiGenerating) return;
    const isOptimize = editContent.trim().length > 0;
    // isInsightType / isAnalysisType / supportsAiDimensions 定义在组件顶层（JSX 渲染条件共用）
    if (!isOptimize && !aiIntent.trim()) {
      MessagePlugin.warning(
        editType === "QUIZ_DESIGN"
          ? "请先用一句话描述你想让这份作业怎么出，例如：作业要分层，基础题和提升题都要有"
          : editType === "QUIZ_ANALYSIS"
            ? "请先用一句话描述你想让这份作业分析重点看什么，例如：重点分析薄弱知识点的归因和补救方式"
            : editType === "EXPLORATION_ANALYSIS"
              ? "请先用一句话描述你想让探究分析重点看什么，例如：结合操作行为分析学生探究习惯"
              : isInsightType
                ? "请先用一句话描述你想让学情分析重点看什么，例如：结合作业数据分析知识薄弱点"
                : "请先用一句话描述你的想法，例如：希望不同的学生有不同的成长"
      );
      return;
    }
    setAiGenerating(true);
    setAiWarning(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/analysis-templates/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: editType,
          intent: aiIntent.trim(),
          currentContent: isOptimize ? editContent : undefined,
          // mode/style 对学情分析与作业/探究分析都生效（后端按类型分发，其他类型忽略）；
          // scope 仅学情分析有（按作用域裁剪变量清单）
          mode: supportsAiDimensions ? aiMode : undefined,
          scope: isInsightType && aiMode === "generic" ? aiScope : undefined,
          style: supportsAiDimensions ? aiStyle : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 必须显式处理非 2xx：不读 error 就会把后端 400/500 静默吞掉
        MessagePlugin.error(data?.error || "生成失败，请稍后重试");
        return;
      }
      setAiPrevContent(editContent);
      // 名称快照取闭包里生成前的值（setEditName 在下方才执行，且 state 批处理不立即生效）
      setAiPrevName(editName);
      setEditContent(data.content as string);
      // AI 帮写成功后，把三个维度（报告样式/模板类型/适用范围）自动拼进名称前缀，便于列表识别；
      // 旧前缀先剥离避免重复叠加；用户已填的名称主体保留
      if (isInsightType) {
        // 前缀写入统一走 withNamePrefix（剥旧拼新），与 handleSave 共用同一剥离规则
        setEditName((prev) => withNamePrefix(prev, buildNamePrefix(aiStyle, aiMode, aiScope)));
      } else if (isAnalysisType) {
        // 分析类无 scope 维度，前缀两段；打开编辑时 parseNamePrefix 按前缀回填维度（见 openEditDialog）
        setEditName((prev) => withNamePrefix(prev, buildNamePrefix(aiStyle, aiMode)));
      }
      if (data.warning) setAiWarning(data.warning as string);
      MessagePlugin.success(
        isOptimize
          ? "AI 已基于现有内容优化，不满意可点「撤销本次生成」"
          : "AI 已生成模板草稿，请检查调整后保存"
      );
    } catch {
      MessagePlugin.error("生成失败，请检查网络后重试");
    } finally {
      setAiGenerating(false);
    }
  };

  // 撤销本次 AI 生成，恢复生成前的内容和名称
  // ⛔ DO NOT REVERT：AI 帮写成功会同时改内容+名称前缀，撤销只回滚内容会让前缀残留、
  // 标签与回滚后的内容不符（2026-10-11 修复）
  const handleUndoAI = () => {
    if (aiPrevContent === null) return;
    setEditContent(aiPrevContent);
    if (aiPrevName !== null) setEditName(aiPrevName);
    setAiPrevContent(null);
    setAiPrevName(null);
    setAiWarning(null);
  };

  // 获取当前模板类型可用的变量（只显示用户输入和系统计算的数据）
  const getAvailableVariables = (type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS"): AvailableVariable[] => {
    if (type === "QUIZ_DESIGN") {
      return [
        { name: "taskTitle", desc: "课堂名称" },
        { name: "taskGrade", desc: "年级" },
        { name: "taskSubject", desc: "学科" },
        { name: "taskObjectives", desc: "课堂目标" },
        { name: "teacherName", desc: "教师姓名" },
        { name: "convDescription", desc: "对话目标" },
        { name: "kbContent", desc: "知识库内容" },
        { name: "kbList", desc: "参考知识库列表" },
      ];
    }
    if (type === "QUIZ_ANALYSIS") {
      // 变量清单与运行时替换表严格一致（quiz-activities/[id]/report/generate 的 quizAnalysisVars），
      // 缺失的变量 AI 生成的模板写出来运行时不会被替换
      return [
        { name: "quizTitle", desc: "作业名称" },
        { name: "quizCount", desc: "题目数量" },
        { name: "className", desc: "班级名称" },
        { name: "totalStudents", desc: "参与人数" },
        { name: "classSize", desc: "班级总人数" },
        { name: "classAvgScore", desc: "班级平均分" },
        { name: "passScore", desc: "及格分数线" },
        { name: "questionStats", desc: "各题正确率" },
        { name: "weakQuestions", desc: "薄弱题目" },
        { name: "lowScoreStudents", desc: "低分学生" },
        { name: "highScoreStudents", desc: "高分学生" },
        { name: "scoreDistribution", desc: "分数分布" },
        { name: "reportTime", desc: "报告生成时间（服务器真实时间）" },
      ];
    }
    if (type === "EXPLORATION_ANALYSIS") {
      // 同上：与 exploration-activities/[id]/analysis/generate 的 explorationVars 严格一致
      return [
        { name: "explorationTitle", desc: "探究标题" },
        { name: "explorationDescription", desc: "探究描述" },
        { name: "className", desc: "班级名称" },
        { name: "submittedCount", desc: "已提交人数" },
        { name: "classAvgScore", desc: "平均得分" },
        { name: "totalStudents", desc: "班级总人数" },
        { name: "scoreDistribution", desc: "分数分布" },
        { name: "submissionDetails", desc: "提交详情（含 answers 和 actionLogs）" },
        { name: "actionTypeStats", desc: "操作类型统计" },
        { name: "avgTimeSpent", desc: "平均停留时间" },
        { name: "avgInteractions", desc: "平均互动次数" },
        { name: "qfAnswers", desc: "学生作答内容" },
        { name: "reportTime", desc: "报告生成时间（服务器真实时间）" },
      ];
    }
    // 所有类型通用的用户输入变量
    const userInputs = [
      { name: "studentName", desc: "学生姓名" },
      { name: "pcTitle", desc: "对话活动名称" },
      { name: "pcDescription", desc: "对话活动目标" },
      { name: "taskTitle", desc: "课题" },
      { name: "taskGrade", desc: "年级" },
      { name: "taskSubject", desc: "学科" },
      { name: "taskDescription", desc: "课堂目标" },
    ];

    if (type === "conversation") {
      return [...userInputs];
    } else if (type === ("QUIZ_DESIGN" as string)) {
      return [
        { name: "taskTitle", desc: "课题" },
        { name: "taskGrade", desc: "年级" },
        { name: "taskSubject", desc: "学科" },
        { name: "taskObjectives", desc: "课堂目标" },
        { name: "taskDescription", desc: "课堂目标（同taskObjectives）" },
        { name: "teacherName", desc: "教师姓名" },
        { name: "convDescription", desc: "对话目标" },
        { name: "kbContent", desc: "知识库内容" },
        { name: "kbList", desc: "参考知识库列表" },
      ];
    } else if (type === "student") {
      return [
        ...userInputs,
        { name: "personalDialogContents", desc: "个人对话记录" },
        { name: "personalQuizStats", desc: "个人作业数据" },
        { name: "personalExplorationStats", desc: "个人探究数据（用时/关卡/操作路径/作答结论）" },
        { name: "reportTime", desc: "报告生成时间（服务器真实时间）" },
      ];
    } else {
      // class
      return [
        ...userInputs,
        { name: "activeCount", desc: "参与学生数" },
        { name: "totalStudents", desc: "班级总学生数" },
        { name: "activeStudents", desc: "活跃学生列表" },
        { name: "personalDialogContents", desc: "个人对话记录" },
        { name: "personalQuizStats", desc: "个人作业数据" },
        { name: "personalDialogAnalysisReport", desc: "个人对话分析报告" },
        { name: "classDialogAnalysisReport", desc: "班级对话分析报告" },
        { name: "classQuizStats", desc: "全班作业数据" },
        { name: "classExplorationStats", desc: "全班探究数据（完成率/探索用时/操作特征/结论摘要）" },
        { name: "reportTime", desc: "报告生成时间（服务器真实时间）" },
      ];
    }
  };

  // textarea ref
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  // 在光标位置插入变量
  const insertVariable = (varName: string) => {
    const textarea = contentTextareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const scrollTop = textarea.scrollTop;  // 保存滚动位置
      const before = editContent.substring(0, start);
      const after = editContent.substring(end);
      const newContent = before + `{${varName}}` + after;
      setEditContent(newContent);
      // 恢复滚动位置并设置光标到插入内容之后
      requestAnimationFrame(() => {
        textarea.scrollTop = scrollTop;
        textarea.setSelectionRange(start + varName.length + 2, start + varName.length + 2);
      });
    } else {
      setEditContent((prev) => prev + `{${varName}}`);
    }
  };

  // 获取默认模板内容
  const getDefaultTemplate = (type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS") => {
    if (type === "QUIZ_ANALYSIS") {
      return `你是一位资深学科教师，请根据以下答题数据生成班级学情分析报告。

## 检测信息
作业名称：{quizTitle}
班级名称：{className}
参与人数：{totalStudents} / {classSize}
班级平均分：{classAvgScore}
报告生成时间：{reportTime}

## 各题正确率
{questionStats}

## 薄弱题目
{weakQuestions}

## 低分学生
{lowScoreStudents}

## 分析要求
1. 班级整体掌握情况（优秀/良好/一般/较差）
2. 薄弱知识点分析
3. 后续教学建议（2-3条）
4. 需重点关注的学生（得分低于60分）

## ⚠️ 字数限制
整篇报告总字数不得超过300字，超出将被判定为不合格。

## 时间真实性（强制）
报告中出现的任何日期/时间只能原样引用上方"报告生成时间：{reportTime}"，禁止自行推算、改写或编造任何其他日期时间；无必要不写时间。

## 输出格式
直接输出分析内容，末尾另起一行输出综合评分：
评分：★★★★★★`;
    }
    if (type === "EXPLORATION_ANALYSIS") {
      return `你是一位资深学科教师，请根据以下互动探究的学生提交数据，生成一份专业的研学分析报告。

## 基本信息
探究标题：{explorationTitle}
探究描述：{explorationDescription}
已提交：{submittedCount}/{totalStudents}人
平均得分：{classAvgScore}分
平均停留：{avgTimeSpent}秒
平均互动：{avgInteractions}次
报告生成时间：{reportTime}

## 分数分布
{scoreDistribution}

## 操作类型统计
{actionTypeStats}

## 提交详情
{submissionDetails}

## 分析要求
1. 学生对互动内容的整体完成情况（参与度、完成率）
2. 分析学生提交数据中反映出的学习行为特点
3. 识别表现优秀和有困难的学生
4. 提出教学改进建议（2-3条）

## 字数限制
整篇报告总字数不超过500字。

## 时间真实性（强制）
报告中出现的任何日期/时间只能原样引用上方"报告生成时间：{reportTime}"，禁止自行推算、改写或编造任何其他日期时间；无必要不写时间。

## 输出格式
直接输出分析内容，末尾另起一行输出综合评分：
评分：★★★★★★`;
    }
    if (type === "student") {
      return `请分析以下学生在对话中的表现：

## 学生信息
- 姓名：{studentName}
- 对话主题：{pcTitle}
- 报告生成时间：{reportTime}

## 对话内容
{personalDialogContents}

## 分析要求
1. 评估学生对核心概念的掌握程度
2. 指出学生的优点和进步
3. 指出学生的常见误区或问题
4. 给出针对性的学习建议

请用简洁专业的语言进行分析，篇幅控制在300字以内。

## 时间真实性（强制）
报告中出现的任何日期/时间只能原样引用上方"报告生成时间：{reportTime}"，禁止自行推算、改写或编造任何其他日期时间；无必要不写时间。`;
    } else if (type === "class") {
      return `请对全班学生的对话进行汇总分析：

## 任务信息
- 对话活动：{pcTitle}
- 参与学生：{activeCount}/{totalStudents}人
- 报告生成时间：{reportTime}

## 学生对话汇总
{personalDialogContents}

## 分析要求
1. 统计学生的参与情况（参与率、对话深度）
2. 分析全班对核心概念的掌握情况
3. 总结常见问题和误解
4. 提出班级整体的教学改进建议

请用简洁专业的语言进行分析，篇幅控制在1000字以内。

## 时间真实性（强制）
报告中出现的任何日期/时间只能原样引用上方"报告生成时间：{reportTime}"，禁止自行推算、改写或编造任何其他日期时间；无必要不写时间。`;
    } else {
      return `你是一位AI学习助手，正在辅导学生完成课堂学习。请根据以下课堂信息引导学生学习，回答他们的问题。

## 教学风格要求
1. 耐心细致，鼓励学生主动思考
2. 用通俗易懂的语言解释概念
3. 适时提问，引导学生深入思考
4. 对学生的回答给予积极的反馈

## 注意事项
1. 不要直接给出答案，而是引导学生自己发现
2. 当学生遇到困难时，提供适当的提示
3. 鼓励学生多角度思考问题`;
    }
  };

  // 保存模板
  const handleSave = async () => {
    if (!editName.trim()) {
      MessagePlugin.warning("请输入模板名称");
      return;
    }
    if (!editContent.trim()) {
      MessagePlugin.warning("请输入模板内容");
      return;
    }

    // 维度→名称前缀（前缀是维度在库里的唯一载体，schema 无独立字段，⛔ DO NOT REVERT）：
    // - 作业/探究分析：保存时按选择器现状打标签（两段 [文本型·通用]），无前缀也写入——
    //   否则手建/AI 帮写的分析类模板改维度后保存，名称标签静默不更新（2026-10-11 教师实测踩坑）
    // - 学情分析沿用既有约定：仅名称已有前缀时同步三段前缀，无前缀 = 教师手建，保持名称不动
    // 🔗 RELATED：回填 openEditDialog、AI 帮写写入 handleGenerateAI、
    // 生成参数消费 src/app/api/analysis-templates/generate/route.ts
    const finalName = isAnalysisType
      ? withNamePrefix(editName, buildNamePrefix(aiStyle, aiMode))
      : isInsightType && /^\[[^\]]*\]/.test(editName.trim())
        ? withNamePrefix(editName, buildNamePrefix(aiStyle, aiMode, aiScope))
        : editName;

    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      let res;

      if (editingTemplate) {
        // 更新
        res = await fetch(`/api/analysis-templates/${editingTemplate.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: finalName,
            content: editContent,
            isDefault: editIsDefault,
            type: editType,
          }),
        });
      } else {
        // 新增
        res = await fetch("/api/analysis-templates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: editType,
            name: finalName,
            content: editContent,
            isDefault: editIsDefault,
          }),
        });
      }

      if (res.ok) {
        MessagePlugin.success(editingTemplate ? "模板已更新" : "模板已创建");
        setEditDialogVisible(false);
        fetchTemplates();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "保存失败");
      }
    } catch {
      MessagePlugin.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 删除模板
  const handleDelete = async () => {
    if (!deletingTemplate) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/analysis-templates/${deletingTemplate.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        MessagePlugin.success("模板已删除");
        setDeleteDialogVisible(false);
        setDeletingTemplate(null);
        fetchTemplates();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "删除失败");
      }
    } catch {
      MessagePlugin.error("删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const getCurrentTemplatesForType = (type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS") => {
    switch (type) {
      case "student": return studentTemplates;
      case "class": return classTemplates;
      case "conversation": return conversationTemplates;
      case "QUIZ_DESIGN": return quizDesignTemplates;
      case "QUIZ_ANALYSIS": return quizAnalysisTemplates;
      case "EXPLORATION_ANALYSIS": return explorationAnalysisTemplates;
    }
  };

  const getTypeCount = (type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS") => {
    switch (type) {
      case "student": return studentTemplates.length;
      case "class": return classTemplates.length;
      case "conversation": return conversationTemplates.length;
      case "QUIZ_DESIGN": return quizDesignTemplates.length;
      case "QUIZ_ANALYSIS": return quizAnalysisTemplates.length;
      case "EXPLORATION_ANALYSIS": return explorationAnalysisTemplates.length;
    }
  };

  const getIsDefaultName = (type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS") => {
    const map: Record<string, AnalysisTemplate[]> = {
      student: studentTemplates,
      class: classTemplates,
      conversation: conversationTemplates,
      QUIZ_DESIGN: quizDesignTemplates,
      QUIZ_ANALYSIS: quizAnalysisTemplates,
      EXPLORATION_ANALYSIS: explorationAnalysisTemplates,
    };
    return map[type]?.find((t) => t.isDefault)?.name;
  };

  // 渲染单个类别（可展开）
  // 预览状态变化（首次生成 / 刷新后）→ 就地更新该模板，让按钮颜色立刻跟着变
  const updatePreviewState = (id: string, state: "none" | "ok" | "stale") => {
    const patch = (list: AnalysisTemplate[]) =>
      list.map((t) =>
        t.id === id ? { ...t, hasPreview: state !== "none", previewStale: state === "stale" } : t
      );
    setStudentTemplates(patch);
    setClassTemplates(patch);
    setConversationTemplates(patch);
    setQuizDesignTemplates(patch);
    setQuizAnalysisTemplates(patch);
    setExplorationAnalysisTemplates(patch);
  };

  const renderCategory = (type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS") => {
    const config = TYPE_CONFIG[type];
    const Icon = config.icon;
    const count = getTypeCount(type);
    const defaultName = getIsDefaultName(type);
    const isExpanded = expandedType === type;
    const templates = getCurrentTemplatesForType(type);

    return (
      <div key={type} className="space-y-3">
        {/* 类别头部 — 点击展开/收起 */}
        <div
          className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
            isExpanded ? "rounded-b-none" : ""
          }`}
          onClick={() => setExpandedType(isExpanded ? null : type)}
        >
          <Card
            className={`template-compact-card ${isExpanded ? "rounded-b-none" : ""}`}
            style={{
              borderTop: isExpanded ? `3px solid ${config.color}` : undefined,
            }}
          >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* 苹果式纯色图标（2026-10-13）：⛔ DO NOT ADD 图标底色 */}
              <Icon
                className="text-xl flex-shrink-0"
                style={{ color: config.color }}
              />
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)] leading-snug">
                  {config.title}
                </h3>
                <p className="text-xs text-[var(--muted)] leading-snug">{config.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <span
                className="text-sm font-bold"
                style={{ color: config.color }}
              >
                {count}
              </span>
              <svg
                className={`w-5 h-5 text-[var(--muted)] transition-transform duration-200 ${
                  isExpanded ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </Card>
      </div>

        {/* 展开后的列表 */}
        {isExpanded && (
          <Card className="template-compact-card rounded-t-none border-t-0 !shadow-md">
            {templates.length === 0 ? (
              <div className="text-center py-6 text-[var(--muted-light)]">
                <p className="text-sm mb-2">暂无{config.title}</p>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="small"
                    icon={<UploadIcon />}
                    disabled={importing}
                    onClick={(e) => {
                      e.stopPropagation();
                      importTypeRef.current = type as typeof importType;
                      setImportType(type);
                      fileInputRef.current?.click();
                    }}
                  >
                    {importing ? importProgress || "导入中…" : "导入"}
                  </Button>
                  <Button
                    theme="primary"
                    variant="outline"
                    size="small"
                    icon={<AddIcon />}
                    onClick={(e) => {
                      e.stopPropagation();
                      openAddDialog(type);
                    }}
                  >
                    新建模板
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-[var(--muted)]">
                    {count} 个模板
                    {defaultName && (
                      <span className="ml-2">
                        · 默认：{defaultName}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="small"
                      icon={<UploadIcon />}
                      disabled={importing}
                      onClick={(e) => {
                        e.stopPropagation();
                        importTypeRef.current = type as typeof importType;
                        setImportType(type);
                        fileInputRef.current?.click();
                      }}
                    >
                      {importing ? importProgress || "导入中…" : "导入"}
                    </Button>
                    <Button
                      theme="primary"
                      size="small"
                      icon={<AddIcon />}
                      onClick={(e) => {
                        e.stopPropagation();
                        openAddDialog(type);
                      }}
                    >
                      新建
                    </Button>
                  </div>
                </div>

                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between gap-4 px-3 py-1 rounded-lg hover:bg-[var(--hover-bg)] transition-colors border border-[var(--card-border)]"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {tpl.isDefault && (
                        <Tag theme="primary" variant="light" size="small">
                          默认
                        </Tag>
                      )}
                      <h4 className="font-medium text-[var(--foreground)] text-sm truncate">{tpl.name}</h4>
                      <span className="text-xs text-[var(--muted-light)] flex-shrink-0">
                        {new Date(tpl.updatedAt).toLocaleDateString("zh-CN")} 更新
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <TemplatePreviewButton
                        templateId={tpl.id}
                        templateName={tpl.name}
                        templateType={tpl.type}
                        hasPreview={!!tpl.hasPreview}
                        previewStale={!!tpl.previewStale}
                        onStateChange={(st) => updatePreviewState(tpl.id, st)}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExport(tpl);
                        }}
                        className="p-1 text-[var(--muted-light)] hover:text-[var(--success)] hover:bg-[var(--success-light)] rounded transition-colors"
                        title="导出"
                      >
                        <DownloadIcon className="text-base" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(tpl);
                        }}
                        className="p-1 text-[var(--muted-light)] hover:text-[var(--primary)] hover:bg-[var(--primary-light)] rounded transition-colors"
                        title="编辑"
                      >
                        <EditIcon className="text-base" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingTemplate(tpl);
                          setDeleteDialogVisible(true);
                        }}
                        className="p-1 text-[var(--muted-light)] hover:text-[var(--danger)] hover:bg-[var(--danger-light)] rounded transition-colors"
                        title="删除"
                      >
                        <DeleteIcon className="text-base" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    );
  };

  return (
    <TeacherLayout>
      <div className="space-y-6 pb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--title)]">模板设置</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              点击类别展开模板列表，可设置默认模板自动应用于分析。
            </p>
          </div>

        {loading ? (
          <div className="text-center text-[var(--muted-light)] py-20">加载中...</div>
        ) : (
          <div className="space-y-4">
            {(["student", "class", "conversation", "QUIZ_DESIGN", "QUIZ_ANALYSIS", "EXPLORATION_ANALYSIS"] as const).map(renderCategory)}
          </div>
        )}

        {/* 模板编辑弹窗 */}
        {/* ⛔ DO NOT REVERT：遮罩层禁止 onClick 关闭弹窗——教师反馈点击弹窗外会静默丢失未保存的模板内容，只允许 × / 取消 / 保存 关闭 */}
        <div
          className={`fixed inset-0 bg-black/30 z-50 flex items-center justify-center ${
            editDialogVisible ? "" : "hidden"
          }`}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-[900px] mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[var(--foreground)]">
                    {editingTemplate ? "编辑模板" : "新建模板"}
                  </h3>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {editType === "conversation" ? "学生对话设计模板"
                      : editType === "student" ? "学生个人学情模板"
                      : editType === "class" ? "学生全班学情模板"
                      : editType === "QUIZ_DESIGN" ? "课堂作业设计模板"
                      : editType === "QUIZ_ANALYSIS" ? "课堂作业分析模板"
                      : "互动探究分析模板"}
                  </p>
                </div>
                <button
                  onClick={() => setEditDialogVisible(false)}
                  className="text-[var(--muted-light)] hover:text-[var(--muted)] text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    模板类别 <span className="text-[var(--danger)]">*</span>
                  </label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS")}
                    className="w-full px-2 py-1.5 border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                  >
                    <option value="conversation">学生对话设计模板</option>
                    <option value="student">学生个人学情模板</option>
                    <option value="class">学生全班学情模板</option>
                    <option value="QUIZ_DESIGN">课堂作业设计模板</option>
                    <option value="QUIZ_ANALYSIS">课堂作业分析模板</option>
                    <option value="EXPLORATION_ANALYSIS">互动探究分析模板</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    模板名称 <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="例如：标准分析模板"
                    className="w-full px-2 py-1.5 border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                  />
                </div>
              </div>

              {editingTemplate && editingTemplate.type !== editType && (
                <p className="text-xs text-[var(--warning)]">注意：修改类别后，使用该模板的任务需要重新选择模板</p>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[var(--foreground)]">
                    模板内容 <span className="text-[var(--danger)]">*</span>
                  </label>
                  <span className="text-xs text-[var(--muted-light)]">{editContent.length} 字符</span>
                </div>

                {/* AI 帮我写（全部六类模板均支持，知识库见 src/lib/template-writing-guide.ts） */}
                {editType === "conversation" ||
                editType === "QUIZ_DESIGN" ||
                editType === "QUIZ_ANALYSIS" ||
                editType === "EXPLORATION_ANALYSIS" ||
                editType === "student" ||
                editType === "class" ? (
                  <div className="mb-2 p-2 bg-[var(--primary-light)] rounded-lg border border-[var(--primary-light)]">
                    {editType === "QUIZ_DESIGN" && (
                      <p className="text-xs text-[var(--muted)] mb-1.5">
                        模板只需描述「出什么题」（题型、难度、情境等）；题目的 JSON 输出格式由系统在出题时自动附加，不会显示在模板正文里，也无需编写。
                      </p>
                    )}
                    {/* 学情分析与作业/探究分析：第一行报告样式+模板类型（学情另联动作用域），再输入意图 */}
                    {supportsAiDimensions && (
                      <div className="mb-2 space-y-1.5">
                        {/* 报告样式 + 模板类型同行；标签精简防折行，说明放 title 悬停提示 */}
                        <div className="flex items-center gap-x-4 text-xs text-[var(--muted)]">
                          <span className="flex items-center gap-x-2">
                            <span className="font-medium">报告样式：</span>
                            <label className="flex items-center gap-1 cursor-pointer" title="纯文本 Markdown 报告，生成快">
                              <input
                                type="radio"
                                name="aiWriteStyle"
                                checked={aiStyle === "text"}
                                disabled={aiGenerating}
                                onChange={() => setAiStyle("text")}
                              />
                              文本型
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer" title="HTML 卡片排版报告，更美观但生成较慢、消耗额度更多">
                              <input
                                type="radio"
                                name="aiWriteStyle"
                                checked={aiStyle === "html"}
                                disabled={aiGenerating}
                                onChange={() => setAiStyle("html")}
                              />
                              网页型
                            </label>
                          </span>
                          <span className="flex items-center gap-x-2">
                            <span className="font-medium">模板类型：</span>
                            <label className="flex items-center gap-1 cursor-pointer" title="变量占位，任何课堂可复用">
                              <input
                                type="radio"
                                name="aiWriteMode"
                                checked={aiMode === "generic"}
                                disabled={aiGenerating}
                                onChange={() => setAiMode("generic")}
                              />
                              通用
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer" title="按描述定制，上下文写死">
                              <input
                                type="radio"
                                name="aiWriteMode"
                                checked={aiMode === "custom"}
                                disabled={aiGenerating}
                                onChange={() => setAiMode("custom")}
                              />
                              个性
                            </label>
                          </span>
                        </div>
                        {isInsightType && aiMode === "generic" && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                            <span className="font-medium">适用范围：</span>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="aiWriteScope"
                                checked={aiScope === "task"}
                                disabled={aiGenerating}
                                onChange={() => setAiScope("task")}
                              />
                              课堂级（含作业/探究数据）
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="aiWriteScope"
                                checked={aiScope === "pc"}
                                disabled={aiGenerating}
                                onChange={() => setAiScope("pc")}
                              />
                              对话活动级（仅对话数据）
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={aiIntent}
                        onChange={(e) => setAiIntent(e.target.value)}
                        disabled={aiGenerating}
                        placeholder={aiIntentPlaceholder}
                        className="flex-1 min-w-0 px-2 py-1.5 border border-[var(--card-border)] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent disabled:opacity-50"
                      />
                      <Button
                        theme="primary"
                        size="small"
                        loading={aiGenerating}
                        onClick={handleGenerateAI}
                      >
                        {editContent.trim() ? "AI 优化现有" : "AI 帮我写"}
                      </Button>
                    </div>
                    {aiGenerating && (
                      <p className="text-xs text-[var(--primary)] mt-1.5">
                        AI 正在思考并撰写模板，通常需要 10~40 秒（已等待 {aiElapsed} 秒），请勿关闭弹窗
                      </p>
                    )}
                    {aiWarning && (
                      <p className="text-xs text-[var(--warning)] mt-1.5">注意：{aiWarning}</p>
                    )}
                    {aiPrevContent !== null && !aiGenerating && (
                      <button
                        onClick={handleUndoAI}
                        className="text-xs text-[var(--primary)] hover:underline mt-1.5"
                      >
                        撤销本次生成，恢复之前的内容
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mb-2 px-2 py-1.5 bg-[var(--hover-bg)] rounded-lg text-xs text-[var(--muted-light)]">
                    「AI 帮我写」暂未支持当前模板类型（已支持：对话设计、课堂作业设计、学情分析、作业分析、探究分析）
                  </div>
                )}

                {/* 变量插入区域 */}
                <div className="mb-2 p-2 bg-[var(--warning-light)] rounded-lg">
                  <p className="text-xs text-[var(--warning)] mb-1.5 font-medium">
                    点击变量插入到光标位置
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {getAvailableVariables(editType).map((v) => (
                      <button
                        key={v.name}
                        onClick={() => insertVariable(v.name)}
                        className="px-1.5 py-0.5 bg-white border border-[var(--warning)] rounded text-xs text-[var(--warning)] hover:bg-[var(--warning-light)] transition-colors"
                        title={v.desc}
                      >
                        {`${v.desc}{${v.name}}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 可编辑的模板内容区 */}
                <textarea
                  ref={contentTextareaRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="在此编辑模板内容，点击上方变量按钮插入变量..."
                  rows={8}
                  className="w-full px-3 py-2 border border-[var(--card-border)] rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent resize-y"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsDefault}
                    onChange={(e) => setEditIsDefault(e.target.checked)}
                    className="w-3.5 h-3.5 text-[var(--primary)] border-[var(--card-border)] rounded focus:ring-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--foreground)]">设为默认模板</span>
                </label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="small"
                    onClick={() => setEditDialogVisible(false)}
                  >
                    取消
                  </Button>
                  <Button theme="primary" size="small" loading={saving} onClick={handleSave}>
                    保存
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 删除确认弹窗 */}
        <div
          className={`fixed inset-0 bg-black/30 z-50 flex items-center justify-center ${
            deleteDialogVisible ? "" : "hidden"
          }`}
          onClick={() => setDeleteDialogVisible(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-semibold text-[var(--foreground)]">
                确认删除模板
              </h3>
              <p>
                确定要删除模板 <strong>{deletingTemplate?.name}</strong> 吗？
              </p>
              <p className="text-[var(--danger)] text-sm">此操作不可撤销。</p>
              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogVisible(false)}
                  disabled={deleting}
                >
                  取消
                </Button>
                {/* ⛔ DO NOT REVERT（2026-10-14 修复）：曾写成 bg-[var(--danger-light)]0——尾部多余 0 使 Tailwind 类失效 → 透明底白字看不清。
                    改为实色 danger 底白字；--danger-light 是浅色只配深字，勿与 text-white 搭配。
                    🔗 RELATED: conversations/page.tsx 同根因 5 处、settings/page.tsx 3 处。 */}
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-[var(--danger)] text-white rounded-lg disabled:opacity-50"
                >
                  {deleting ? "删除中..." : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 隐藏的文件输入 — 用于导入 .md 模板文件 */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            multiple
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </div>
    </TeacherLayout>
  );
}