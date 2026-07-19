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

interface AnalysisTemplate {
  id: string;
  type: "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS";
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateVariable {
  name: string;
  desc: string;
}

interface AvailableVariable {
  name: string;
  desc: string;
}

const TYPE_CONFIG = {
  conversation: {
    title: "学生对话设计模板",
    description: "用于设计学生对话活动的提示词",
    icon: ChatIcon,
    color: "#ED7B2F",
    bgColor: "#FFF3E0",
  },
  student: {
    title: "学生个人学情模板",
    description: "用于分析单个学生的对话表现",
    icon: UserIcon,
    color: "#0052D9",
    bgColor: "#E8F0FE",
  },
  class: {
    title: "学生全班学情模板",
    description: "用于汇总分析全班学生的对话情况",
    icon: UsergroupIcon,
    color: "#00A870",
    bgColor: "#E8F8F0",
  },
  QUIZ_DESIGN: {
    title: "课堂作业设计模板",
    description: "用于AI生成课堂作业题目",
    icon: FileIcon,
    color: "#9C27B0",
    bgColor: "#F3E5F5",
  },
  QUIZ_ANALYSIS: {
    title: "课堂作业分析模板",
    description: "用于AI分析班级作业结果",
    icon: FileIcon,
    color: "#00BCD4",
    bgColor: "#E0F7FA",
  },
  EXPLORATION_ANALYSIS: {
    title: "互动探究分析模板",
    description: "用于AI分析互动探究提交结果",
    icon: FileIcon,
    color: "#FF6B35",
    bgColor: "#FFF3E8",
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
    subProject: { class: TemplateVariable[]; student: TemplateVariable[] };
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

  // 删除确认
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<AnalysisTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 导入 ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<"student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS">("student");

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

  // 导入模板
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 只允许 .md 文件
    if (!file.name.endsWith(".md")) {
      MessagePlugin.warning("请选择 .md 格式的模板文件");
      e.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      const trimmedText = text.trim();
      if (!trimmedText) {
        MessagePlugin.warning("模板文件为空");
        e.target.value = "";
        return;
      }

      // 模板名使用上传文件的文件名（去掉扩展名），保证导出文件名 = 导入文件名，可往返
      const dotIndex = file.name.lastIndexOf(".");
      const fileBaseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
      const name = fileBaseName.trim();

      // 模板内容保存整篇 Markdown 文本
      const content = trimmedText;

      if (!name) {
        MessagePlugin.warning("模板文件格式不正确：无法从文件名解析模板名称");
        e.target.value = "";
        return;
      }

      const token = localStorage.getItem("token");
      const res = await fetch("/api/analysis-templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: importType,
          name,
          content,
          isDefault: false,
        }),
      });

      if (res.ok) {
        MessagePlugin.success("模板已导入");
        fetchTemplates();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "导入失败");
      }
    } catch {
      MessagePlugin.error("读取文件失败");
    }

    e.target.value = "";
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
    setEditDialogVisible(true);
  };

  // 打开编辑弹窗
  const openEditDialog = (template: AnalysisTemplate) => {
    setEditingTemplate(template);
    setEditType(template.type);
    setEditName(template.name);
    setEditContent(template.content);
    setEditIsDefault(template.isDefault);
    setEditDialogVisible(true);
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
        { name: "quizCount", desc: "题目数量" },
      ];
    }
    if (type === "QUIZ_ANALYSIS") {
      return [
        { name: "quizTitle", desc: "作业名称" },
        { name: "className", desc: "班级名称" },
        { name: "totalStudents", desc: "参与人数" },
        { name: "classSize", desc: "班级总人数" },
        { name: "classAvgScore", desc: "班级平均分" },
        { name: "questionStats", desc: "各题正确率" },
        { name: "weakQuestions", desc: "薄弱题目" },
        { name: "lowScoreStudents", desc: "低分学生" },
        { name: "highScoreStudents", desc: "高分学生" },
      ];
    }
    if (type === "EXPLORATION_ANALYSIS") {
      return [
        { name: "explorationTitle", desc: "探究标题" },
        { name: "explorationDescription", desc: "探究描述" },
        { name: "submittedCount", desc: "已提交人数" },
        { name: "classAvgScore", desc: "平均得分" },
        { name: "totalStudents", desc: "班级总人数" },
        { name: "scoreDistribution", desc: "分数分布" },
        { name: "submissionDetails", desc: "提交详情（含 answers 和 actionLogs）" },
        { name: "actionTypeStats", desc: "操作类型统计" },
        { name: "avgTimeSpent", desc: "平均停留时间" },
        { name: "avgInteractions", desc: "平均互动次数" },
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
        { name: "quizCount", desc: "题目数量" },
      ];
    } else if (type === "student") {
      return [
        ...userInputs,
        { name: "personalDialogContents", desc: "个人对话记录" },
        { name: "personalQuizStats", desc: "个人作业数据" },
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

## 输出格式
直接输出分析内容，末尾另起一行输出综合评分：
评分：★★★★★★`;
    }
    if (type === "student") {
      return `请分析以下学生在对话中的表现：

## 学生信息
- 姓名：{studentName}
- 对话主题：{pcTitle}

## 对话内容
{personalDialogContents}

## 分析要求
1. 评估学生对核心概念的掌握程度
2. 指出学生的优点和进步
3. 指出学生的常见误区或问题
4. 给出针对性的学习建议

请用简洁专业的语言进行分析，篇幅控制在300字以内。`;
    } else if (type === "class") {
      return `请对全班学生的对话进行汇总分析：

## 任务信息
- 对话活动：{pcTitle}
- 学习活动：{spTitle}
- 参与学生：{activeCount}/{totalStudents}人

## 学生对话汇总
{personalDialogContents}

## 分析要求
1. 统计学生的参与情况（参与率、对话深度）
2. 分析全班对核心概念的掌握情况
3. 总结常见问题和误解
4. 提出班级整体的教学改进建议

请用简洁专业的语言进行分析，篇幅控制在1000字以内。`;
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
            name: editName,
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
            name: editName,
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
            className={isExpanded ? "rounded-b-none" : ""}
            style={{
              borderTop: isExpanded ? `3px solid ${config.color}` : undefined,
            }}
          >
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: config.bgColor }}
              >
                <Icon
                  className="text-xl"
                  style={{ color: config.color }}
                />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#1A1A1A]">
                  {config.title}
                </h3>
                <p className="text-xs text-[#63666F]">{config.description}</p>
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
                className={`w-5 h-5 text-[#63666F] transition-transform duration-200 ${
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
          <Card className="rounded-t-none border-t-0 !shadow-md">
            {templates.length === 0 ? (
              <div className="text-center py-8 text-[#BBBBBB]">
                <p className="text-sm mb-3">暂无{config.title}</p>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="small"
                    icon={<UploadIcon />}
                    onClick={(e) => {
                      e.stopPropagation();
                      setImportType(type);
                      fileInputRef.current?.click();
                    }}
                  >
                    导入
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
                  <span className="text-sm text-[#63666F]">
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setImportType(type);
                        fileInputRef.current?.click();
                      }}
                    >
                      导入
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
                    className="flex items-start justify-between gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {tpl.isDefault && (
                          <Tag theme="primary" variant="light" size="small">
                            默认
                          </Tag>
                        )}
                        <h4 className="font-medium text-[#1A1A1A] text-sm">{tpl.name}</h4>
                      </div>
                      <p className="text-xs text-[#63666F] line-clamp-1 whitespace-pre-wrap">
                        {tpl.content.slice(0, 120)}
                        {tpl.content.length > 120 ? "..." : ""}
                      </p>
                      <span className="text-xs text-[#BBBBBB] mt-0.5 block">
                        {new Date(tpl.updatedAt).toLocaleDateString("zh-CN")} 更新
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExport(tpl);
                        }}
                        className="p-1.5 text-gray-400 hover:text-[#00A870] hover:bg-[#00A870]/10 rounded transition-colors"
                        title="导出"
                      >
                        <DownloadIcon className="text-base" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(tpl);
                        }}
                        className="p-1.5 text-gray-400 hover:text-[#0052D9] hover:bg-[#0052D9]/10 rounded transition-colors"
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
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
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
      <div className="max-w-5xl space-y-6 pb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">模板设置</h1>
            <p className="text-sm text-[#63666F] mt-1">
              点击类别展开模板列表，可设置默认模板自动应用于分析。
            </p>
          </div>

        {loading ? (
          <div className="text-center text-gray-400 py-20">加载中...</div>
        ) : (
          <div className="space-y-4">
            {(["student", "class", "conversation", "QUIZ_DESIGN", "QUIZ_ANALYSIS", "EXPLORATION_ANALYSIS"] as const).map(renderCategory)}
          </div>
        )}

        {/* 模板编辑弹窗 */}
        <div
          className={`fixed inset-0 bg-black/30 z-50 flex items-center justify-center ${
            editDialogVisible ? "" : "hidden"
          }`}
          onClick={() => setEditDialogVisible(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-[900px] mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#1A1A1A]">
                    {editingTemplate ? "编辑模板" : "新建模板"}
                  </h3>
                  <p className="text-xs text-[#63666F] mt-0.5">
                    {editType === "conversation" ? "学生对话设计模板"
                      : editType === "student" ? "学生个人学情模板"
                      : editType === "class" ? "学生全班学情模板"
                      : editType === "QUIZ_DESIGN" ? "课堂作业设计模板"
                      : "课堂作业分析模板"}
                  </p>
                </div>
                <button
                  onClick={() => setEditDialogVisible(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#1A1A1A] mb-1">
                    模板类别 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as "student" | "class" | "conversation" | "QUIZ_DESIGN" | "QUIZ_ANALYSIS" | "EXPLORATION_ANALYSIS")}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9] focus:border-transparent"
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
                  <label className="block text-xs font-medium text-[#1A1A1A] mb-1">
                    模板名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="例如：标准分析模板"
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9] focus:border-transparent"
                  />
                </div>
              </div>

              {editingTemplate && editingTemplate.type !== editType && (
                <p className="text-xs text-[#ED7B2F]">注意：修改类别后，使用该模板的任务需要重新选择模板</p>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#1A1A1A]">
                    模板内容 <span className="text-red-500">*</span>
                  </label>
                  <span className="text-xs text-gray-400">{editContent.length} 字符</span>
                </div>

                {/* 变量插入区域 */}
                <div className="mb-2 p-2 bg-[#FFF9E6] rounded-lg">
                  <p className="text-xs text-[#8B5C00] mb-1.5 font-medium">
                    点击变量插入到光标位置
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {getAvailableVariables(editType).map((v) => (
                      <button
                        key={v.name}
                        onClick={() => insertVariable(v.name)}
                        className="px-1.5 py-0.5 bg-white border border-[#E8A000] rounded text-xs text-[#8B5C00] hover:bg-[#FFF3CC] transition-colors"
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
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0052D9] focus:border-transparent resize-y"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsDefault}
                    onChange={(e) => setEditIsDefault(e.target.checked)}
                    className="w-3.5 h-3.5 text-[#0052D9] border-gray-300 rounded focus:ring-[#0052D9]"
                  />
                  <span className="text-sm text-[#1A1A1A]">设为默认模板</span>
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
              <h3 className="text-lg font-semibold text-[#1A1A1A]">
                确认删除模板
              </h3>
              <p>
                确定要删除模板 <strong>{deletingTemplate?.name}</strong> 吗？
              </p>
              <p className="text-red-500 text-sm">此操作不可撤销。</p>
              <div className="flex gap-2 justify-end pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogVisible(false)}
                  disabled={deleting}
                >
                  取消
                </Button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
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
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </div>
    </TeacherLayout>
  );
}