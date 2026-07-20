"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Dialog,
  Input,
  Textarea,
  MessagePlugin,
  Tag,
  Select,
  Progress,
  Switch,
  Tooltip,
} from "tdesign-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AddIcon,
  DeleteIcon,
  EditIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  RemoveIcon,
  ChartBarIcon,
  RefreshIcon,
  StopIcon,
  PlayIcon,
  SaveIcon,
  FileIcon,
} from "tdesign-icons-react";
import Link from "next/link";
import TeacherLayout from "@/components/layout/TeacherLayout";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  PieChart, Pie, Legend, ResponsiveContainer,
} from "recharts";
import { injectSubmitFunctionality, removeSubmitFunctionality } from "@/lib/prompts/exploration-submit";

interface AnalysisTemplate {
  id: string;
  type: "student" | "class" | "conversation";
  name: string;
  content: string;
  isDefault: boolean;
}

interface PresetConversation {
  id?: string;
  title: string;
  description?: string;
  systemPrompt?: string;
  analysisPrompt?: string;
  classAnalysisPrompt?: string;
  analysisTemplateId?: string;
  conversationPromptTemplateId?: string;
  enabled?: boolean;
}

interface SubProject {
  id: string;
  title: string;
  description?: string;
  objectives: string;
  requirements: string;
  knowledgeBase?: string;
  analysisPrompt?: string;
  presetConversations: PresetConversation[];
}

interface TaskAssignment {
  id: string;
  classId: string;
  class: { id: string; name: string };
}

interface LearningTask {
  id: string;
  title: string;
  description?: string;
  grade?: string;
  subject?: string;
  objectives: string;
  requirements: string;
  knowledgeBase?: string;
  knowledgeBaseIds?: string;
  analysisPrompt?: string;
  status: string;
  createdAt: string;
  subProjects: SubProject[];
  assignments: TaskAssignment[];
  studentInsightTemplateId?: string;
  classInsightTemplateId?: string;
}

interface ClassItem {
  id: string;
  name: string;
}

interface KnowledgeBaseItem {
  id: string;
  name: string;
  status: string;
  enabled: boolean; // 是否启用
  contentLength: number; // 知识库字符数
}

const STATUS_CONFIG = {
  DISABLED: { label: "未启用", theme: "default" as const, color: "gray" },
  ENABLED: { label: "启用", theme: "success" as const, color: "green" },
  ENDED: { label: "已结束", theme: "warning" as const, color: "orange" },
};

const NEXT_STATUS = {
  DISABLED: "ENABLED",
  ENABLED: "ENDED",
  ENDED: "DISABLED",
};

const NEXT_STATUS_LABEL = {
  DISABLED: "启用",
  ENABLED: "结束",
  ENDED: "暂存",
};

export default function TeacherTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);
  const [conversationTemplates, setConversationTemplates] = useState<AnalysisTemplate[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // 编辑/创建课堂表单
  const [formVisible, setFormVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<LearningTask | null>(null);
  const [saving, setSaving] = useState(false);

  // 创建/编辑课堂 - 只保留基本信息
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formGrade, setFormGrade] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formClassIds, setFormClassIds] = useState<string[]>([]);

  // 学习活动 inline 编辑
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingSubProjects, setEditingSubProjects] = useState<SubProject[]>([]);
  const [savingSubProjects, setSavingSubProjects] = useState(false);
  const [expandedSpIds, setExpandedSpIds] = useState<Set<string>>(new Set());

  // 课堂作业 inline 面板
  const [quizPanelVisible, setQuizPanelVisible] = useState(false);
  const [quizPanelSpId, setQuizPanelSpId] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);

  // 作业设计模式（Step 1: 新建作业弹窗）
  const [quizModalVisible, setQuizModalVisible] = useState(false);
  const [newQuizTitle, setNewQuizTitle] = useState("");
  const [newQuizDesc, setNewQuizDesc] = useState("");
  const [selectedQuizTemplateId, setSelectedQuizTemplateId] = useState("");
  const [step1Confirming, setStep1Confirming] = useState(false);

  // 作业设计模式（Step 2: 设计面板）
  const [quizDesignMode, setQuizDesignMode] = useState(false);
  const [quizDesignId, setQuizDesignId] = useState<string | null>(null); // null = 新建, string = 编辑已有
  const [quizDesignTitle, setQuizDesignTitle] = useState("");
  const [quizDesignDesc, setQuizDesignDesc] = useState("");
  const [quizDesignTemplateContent, setQuizDesignTemplateContent] = useState("");
  const [quizAnalysisPrompt, setQuizAnalysisPrompt] = useState(""); // 作业的AI分析提示词
  const [quizDesignQuestions, setQuizDesignQuestions] = useState<any[]>([]);

  // 作业完整管理面板
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [savingQuiz, setSavingQuiz] = useState(false);

  const quizSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function SortableQuizQuestion({ q, idx, onUpdate, onMoveUp, onMoveDown, total }: { q: any; idx: number; onUpdate: (field: string, value: any) => void; onMoveUp: () => void; onMoveDown: () => void; total: number }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idx });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.8 : 1 };
    const options = typeof q.options === "string" ? JSON.parse(q.options || "{}") : (q.options || {});
    return (
      <div ref={setNodeRef} style={style} className={`bg-[#F7F8FA] rounded-lg p-3 text-sm ${isDragging ? "shadow-lg" : ""}`}>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-0.5 p-1 rounded">
            <span className="text-xs text-gray-400 font-bold">↑</span>
            <button type="button" onClick={onMoveUp} disabled={idx === 0} className="w-5 h-4 flex items-center justify-center text-blue-600 hover:text-blue-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▲</button>
            <button type="button" onClick={onMoveDown} disabled={idx === total - 1} className="w-5 h-4 flex items-center justify-center text-blue-600 hover:text-blue-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▼</button>
            <span className="text-xs text-gray-400 font-bold">↓</span>
          </div>
          <span {...attributes} {...listeners} className="cursor-grab text-gray-300 hover:text-gray-500 select-none mt-1" title="拖拽排序">⋮⋮</span>
          <span className="font-medium text-gray-500">{idx + 1}.</span>
          <div className="flex-1 space-y-2">
            <Input value={q.content} onChange={(v) => onUpdate("content", v)} size="small" />
            <div className="grid grid-cols-2 gap-1">
              {["A","B","C","D"].map((opt) => (
                <div key={opt} className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">{opt}.</span>
                  <Input value={options[opt] || ""} onChange={(v) => onUpdate("options", { ...options, [opt]: v })} size="small" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 items-center text-xs">
              <span className="text-gray-400">题型：</span>
              <select value={q.type || "SINGLE_CHOICE"} onChange={(e) => onUpdate("type", e.target.value)} className="border rounded px-1 py-0.5">
                <option value="SINGLE_CHOICE">单选</option><option value="MULTIPLE_CHOICE">多选</option><option value="TRUE_FALSE">判断</option>
              </select>
              <span className="text-gray-400 ml-2">答案：</span>
              {q.type === "TRUE_FALSE" ? (
                <select value={q.answer || "T"} onChange={(e) => onUpdate("answer", e.target.value)} className="border rounded px-1 py-0.5"><option value="T">正确</option><option value="F">错误</option></select>
              ) : q.type !== "MULTIPLE_CHOICE" ? (
                <select value={q.answer || "A"} onChange={(e) => onUpdate("answer", e.target.value)} className="border rounded px-1 py-0.5"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select>
              ) : (
                <div className="flex gap-2 items-center">
                  {["A","B","C","D"].map((opt) => {
                    const list = (q.answer || "").split(",").map((s: string) => s.trim()).filter(Boolean);
                    return <label key={opt} className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={list.includes(opt)} onChange={() => { const nl = list.includes(opt) ? list.filter((s: string) => s !== opt) : [...list, opt]; onUpdate("answer", nl.join(",")); }} /><span>{opt}</span></label>;
                  })}
                </div>
              )}
              <span className="text-gray-400 ml-2">难度：</span>
              <select value={q.difficulty || "BASIC"} onChange={(e) => onUpdate("difficulty", e.target.value)} className="border rounded px-1 py-0.5">
                <option value="BASIC">基础</option><option value="INTERMEDIATE">提升</option><option value="ADVANCED">拓展</option>
              </select>
            </div>
            <div><span className="text-xs text-gray-400">答案解析</span><Input value={q.explanation || ""} onChange={(v) => onUpdate("explanation", v)} size="small" placeholder="答案解析（可为空）" /></div>
          </div>
        </div>
      </div>
    );
  }

  const handleQuizDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setQuizDesignQuestions((items: any[]) => {
        const oldIdx = items.findIndex((_, i) => i === active.id);
        return arrayMove(items, oldIdx, items.findIndex((_, i) => i === over?.id));
      });
    }
  };

  // 作业状态切换（二态：ACTIVE/INACTIVE）
  const handleQuizToggle = async (q: any, shouldEnable: boolean) => {
    setOperatingQuizId(q.id);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${q.id}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: shouldEnable }),
      });
      if (res.ok) {
        // 重新获取作业列表，确保状态同步
        const updatedRes = await fetch(`/api/quiz-activities?subProjectId=${q.subProjectId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (updatedRes.ok) {
          const updatedQuizzes = await updatedRes.json();
          setQuizzes((prev) => {
            const otherQuizzes = prev.filter((quiz) => quiz.subProjectId !== q.subProjectId);
            return [...otherQuizzes, ...updatedQuizzes];
          });
        }
        MessagePlugin.success(shouldEnable ? "作业已生效" : "作业已失效");
      } else {
        const errorText = await res.text();
        MessagePlugin.error(errorText || "切换失败");
      }
    } catch (e) {
      MessagePlugin.error("切换失败");
    } finally {
      setOperatingQuizId(null);
    }
  };

  // 对话活动 enabled 切换
  const handleConversationToggle = async (pc: any, checked: boolean) => {
    setOperatingPresetConversationId(pc.id);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/preset-conversations/${pc.id}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: checked }),
      });
      if (res.ok) {
        setTasks((prev) =>
          prev.map((t) => ({
            ...t,
            subProjects: t.subProjects.map((sp) => ({
              ...sp,
              presetConversations: sp.presetConversations.map((p) =>
                p.id === pc.id ? { ...p, enabled: checked } : p
              ),
            })),
          }))
        );
        MessagePlugin.success(checked ? "对话活动已生效" : "对话活动已失效");
      } else {
        MessagePlugin.error("切换失败");
      }
    } finally {
      setOperatingPresetConversationId(null);
    }
  };

  // ===== 互动探究 =====
  const [explorationPanelVisible, setExplorationPanelVisible] = useState(false);
  const [explorationPanelSpId, setExplorationPanelSpId] = useState<string | null>(null);
  const [explorations, setExplorations] = useState<any[]>([]);
  const [loadingExplorations, setLoadingExplorations] = useState(false);
  const [operatingExplorationId, setOperatingExplorationId] = useState<string | null>(null);

  // 新建/编辑探究弹窗
  const [explorationModalVisible, setExplorationModalVisible] = useState(false);
  const [explorationEditId, setExplorationEditId] = useState<string | null>(null); // null=新建
  const [explorationTitle, setExplorationTitle] = useState("");
  const [explorationPrompt, setExplorationPrompt] = useState("");
  const [explorationDesignPrompt, setExplorationDesignPrompt] = useState(""); // 互动设计提示词（临时，不保存）
  const [explorationHtml, setExplorationHtml] = useState("");
  const [explorationPreview, setExplorationPreview] = useState("");
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatingHtml, setGeneratingHtml] = useState(false);
  const [savingExploration, setSavingExploration] = useState(false);

  // 分析弹窗
  const [analysisModalVisible, setAnalysisModalVisible] = useState(false);
  const [analysisExplorationId, setAnalysisExplorationId] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [generatingAdvice, setGeneratingAdvice] = useState(false);
  const [analysisClassId, setAnalysisClassId] = useState<string>("");

  // 答题提交
  const [explorationEnableSubmission, setExplorationEnableSubmission] = useState(false);
  const [explorationHasSubmissions, setExplorationHasSubmissions] = useState(false);
  // AI伴学
  const [explorationEnableAiCompanion, setExplorationEnableAiCompanion] = useState(false);
  const [aiCompanionStatus, setAiCompanionStatus] = useState<"idle" | "injecting" | "analyzing" | "ready" | "error">("idle");
  const [aiCompanionPromptText, setAiCompanionPromptText] = useState<string>("");
  const [showAiCompanionPrompt, setShowAiCompanionPrompt] = useState(false);
  // AI 预览注入分析
  const [injectionPreviewVisible, setInjectionPreviewVisible] = useState(false);
  const [previewAnalysis, setPreviewAnalysis] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState("");
  const [autoScoreScript, setAutoScoreScript] = useState<string | null>(null);
  // 注入确认状态（用户是否已在预览中确认注入）
  const [confirmedInjection, setConfirmedInjection] = useState(false);
  const confirmedInjectionRef = useRef(false);
  const syncConfirmedInjection = (v: boolean) => {
    setConfirmedInjection(v);
    confirmedInjectionRef.current = v;
  };
  // 原始 HTML（启用提交前保存，用于取消时恢复）
  const [originalHtmlForInjection, setOriginalHtmlForInjection] = useState("");

  // 打开探究面板（先加载数据，面板只在数据就绪后显示）
  const openExplorationPanel = async (spId: string) => {
    setExplorationPanelSpId(spId);
    setLoadingExplorations(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/exploration-activities?subProjectId=${spId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        console.error("解析探究活动响应失败");
        setExplorations([]);
        setExplorationPanelVisible(true);
        return;
      }
      setExplorations(Array.isArray(data) ? data : []);
      // 数据加载完成后才显示面板，避免出现"暂无探究"后再刷出数据
      setExplorationPanelVisible(true);
    } catch (e) {
      console.error("获取探究活动失败", e);
    } finally {
      setLoadingExplorations(false);
    }
  };

  const closeExplorationPanel = () => {
    setExplorationPanelVisible(false);
    setExplorationPanelSpId(null);
    setExplorations([]);
  };

  // 打开发起新建探究
  const openNewExploration = () => {
    setExplorationEditId(null);
    setExplorationTitle("");
    setExplorationPrompt("");
    setExplorationDesignPrompt("");
    setExplorationHtml("");
    setExplorationPreview("");
    setExplorationEnableSubmission(false);
    syncConfirmedInjection(false);
    setOriginalHtmlForInjection("");
    setExplorationEnableAiCompanion(false);
    setAiCompanionStatus("idle");
    setAiCompanionPromptText("");
    setShowAiCompanionPrompt(false);
    setExplorationModalVisible(true);
  };

  // 确保面板已打开并加载数据后再打弹窗
  const openExplorationThenModal = async (spId: string) => {
    // 如果面板已显示同一 subProject，直接打开弹窗
    if (explorationPanelVisible && explorationPanelSpId === spId) {
      openNewExploration();
      return;
    }
    // 否则打开面板（会 fetch 数据）再弹窗
    await openExplorationPanel(spId);
    openNewExploration();
  };

  // 打开分析弹窗
  const openAnalysisModal = async (explorationId: string) => {
    setAnalysisExplorationId(explorationId);
    setAnalysisModalVisible(true);
    setLoadingAnalysis(true);
    setAnalysisData(null);
    setAnalysisClassId("");
    try {
      const token = localStorage.getItem("token");
      // 先获取当前班级
      const currentRes = await fetch("/api/classes/current", {
        headers: { Authorization: `Bearer ${token}` },
      });
      let currentClassId = "";
      if (currentRes.ok) {
        const currentData = await currentRes.json();
        currentClassId = currentData.class?.id || "";
      }
      // 获取分析数据
      const res = await fetch(`/api/exploration-activities/${explorationId}/analysis`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // 尝试用当前班级，否则用第一个，否则无班级
        const targetClassId = data.classIds?.includes(currentClassId)
          ? currentClassId
          : (data.classIds?.[0] || "");
        setAnalysisClassId(targetClassId);
        if (targetClassId) {
          const res2 = await fetch(`/api/exploration-activities/${explorationId}/analysis?classId=${targetClassId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res2) {
            setAnalysisData(await res2.json());
          }
        } else {
          setAnalysisData(data);
        }
      }
    } catch (e) {
      console.error("获取分析数据失败", e);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  // 生成教学建议
  const handleGenerateTeachingAdvice = async () => {
    if (!analysisExplorationId) return;
    setGeneratingAdvice(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/exploration-activities/${analysisExplorationId}/analysis`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.advice) {
        setAnalysisData((prev: any) => ({ ...prev, teachingAdvice: data.advice }));
      }
    } catch (e) {
      console.error("生成教学建议失败", e);
    } finally {
      setGeneratingAdvice(false);
    }
  };

  // 上传 HTML 文件
  const handleUploadHtml = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".html,.htm";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      if (!text.trim()) {
        MessagePlugin.warning("文件内容为空");
        return;
      }
      setExplorationHtml(text);
      setExplorationPreview(text);
      MessagePlugin.success("HTML 文件已加载，请预览");
    };
    input.click();
  };

  // 自动生成提示词
  const autoGeneratePrompt = async () => {
    if (!explorationPanelSpId) return;
    setGeneratingPrompt(true);
    let msg = await MessagePlugin.loading("正在读取课堂信息...", 0);
    let stage = 0;
    const timer = setInterval(async () => {
      stage++;
      if (stage === 1) { msg.close(); msg = await MessagePlugin.loading("正在分析知识点...", 0); }
      if (stage === 2) { msg.close(); msg = await MessagePlugin.loading("正在生成互动设计提示词...", 0); }
    }, 1500);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/exploration-activities/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subProjectId: explorationPanelSpId }),
      });
      clearInterval(timer);
      msg.close();
      const data = await res.json();
      if (res.ok) {
        setExplorationTitle(data.title || "探究活动");
        setExplorationDesignPrompt(data.prompt || "");
        MessagePlugin.success("互动设计提示词已生成");
      } else {
        MessagePlugin.error(data.error || "生成提示词失败");
      }
    } catch {
      clearInterval(timer);
      msg.close();
      MessagePlugin.error("生成提示词失败");
    } finally {
      setGeneratingPrompt(false);
    }
  };

  // 生成 HTML（流式）
  const handleGenerateHtml = async () => {
    if (!explorationDesignPrompt.trim()) {
      MessagePlugin.warning("请先输入互动设计提示词");
      return;
    }
    setGeneratingHtml(true);
    // 实时字节数进度提示
    let msg = await MessagePlugin.loading("正在构思网页结构... 0 B", 0);
    let receivedBytes = 0;
    let timer: NodeJS.Timeout | undefined = undefined;
    try {
      const token = localStorage.getItem("token") || "";
      const response = await fetch("/api/exploration-activities/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          prompt: explorationDesignPrompt,
        }),
      });
      if (!response.ok) {
        msg.close();
        const err = await response.json().catch(() => ({ error: "生成失败" }));
        MessagePlugin.error(err.error || "生成失败");
        setGeneratingHtml(false);
        return;
      }
      // 读取流式响应，实时更新字节数
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let htmlContent = "";
      timer = setInterval(async () => {
        msg.close();
        msg = await MessagePlugin.loading(`正在生成... ${receivedBytes} B`, 0);
      }, 1500);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        htmlContent += decoder.decode(value, { stream: true });
        receivedBytes = new Blob([htmlContent]).size;
      }
      clearInterval(timer);
      msg.close();
      setExplorationHtml(htmlContent);
      setExplorationPreview(htmlContent);
      MessagePlugin.success("网页生成成功，请预览效果");
    } catch {
      clearInterval(timer);
      msg.close();
      MessagePlugin.error("生成失败");
    } finally {
      setGeneratingHtml(false);
    }
  };

  // 保存探究
  // 实际执行保存（预览确认后调用）
  const doSaveExploration = async () => {
    setSavingExploration(true);
    try {
      const token = localStorage.getItem("token") || "";
      let res;
      if (explorationEditId) {
        res = await fetch(`/api/exploration-activities/${explorationEditId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title: explorationTitle,
            htmlContent: explorationHtml,
            enableSubmission: explorationEnableSubmission,
            enableAiCompanion: explorationEnableAiCompanion,
            aiCompanionPrompt: aiCompanionPromptText || undefined,
            designPrompt: explorationDesignPrompt,
            analysisPrompt: explorationPrompt,
          }),
        });
      } else {
        res = await fetch("/api/exploration-activities", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            subProjectId: explorationPanelSpId,
            title: explorationTitle,
            htmlContent: explorationHtml,
            enableSubmission: explorationEnableSubmission,
            enableAiCompanion: explorationEnableAiCompanion,
            designPrompt: explorationDesignPrompt,
            analysisPrompt: explorationPrompt,
          }),
        });
      }
      if (res.ok) {
        const saved = await res.json();
        if (!explorationEditId) {
          setExplorationEditId(saved.id);
          setExplorations((prev) => [saved, ...prev]);
        } else {
          setExplorations((prev) => prev.map((e) => e.id === saved.id ? saved : e));
        }
        // 同步 enableSubmission 状态（避免数据库值与前端不一致）
        setExplorationEnableSubmission(saved.enableSubmission ?? explorationEnableSubmission);
        setExplorationEnableAiCompanion(saved.enableAiCompanion ?? explorationEnableAiCompanion);
        if (saved.aiCompanionPrompt) {
          setAiCompanionPromptText(saved.aiCompanionPrompt);
        }
        MessagePlugin.success("探究已保存");
        if (saved._injectWarnings && saved._injectWarnings.length > 0) {
          saved._injectWarnings.forEach((w: string) => MessagePlugin.warning(w));
        }
        if (saved._aiCompanionWarnings && saved._aiCompanionWarnings.length > 0) {
          saved._aiCompanionWarnings.forEach((w: string) => MessagePlugin.warning(w));
        }
        setExplorationModalVisible(false);
        setInjectionPreviewVisible(false);

        // 如果启用了AI伴学，异步生成伴学语义提示词
        if (saved.enableAiCompanion && saved.id) {
          generateAiCompanionPromptInBackground(saved.id);
        }
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "保存失败");
      }
    } catch {
      MessagePlugin.error("保存失败");
    } finally {
      setSavingExploration(false);
    }
  };

  // 后台生成AI伴学提示词
  const generateAiCompanionPromptInBackground = async (expId: string) => {
    setAiCompanionStatus("analyzing");
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/exploration-activities/${expId}/generate-companion-prompt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAiCompanionPromptText(data.aiCompanionPrompt || "");
        setAiCompanionStatus("ready");
      } else {
        setAiCompanionStatus("error");
      }
    } catch {
      setAiCompanionStatus("error");
    }
  };

  // AI伴学开关处理
  const handleAiCompanionToggle = async (val: boolean) => {
    if (!explorationEditId) {
      // 新建模式下，先标记状态，等保存时一起提交
      setExplorationEnableAiCompanion(val);
      MessagePlugin.info(val ? "已标记启用AI伴学，保存后生效" : "已取消AI伴学");
      return;
    }

    if (val) {
      // 启用
      setExplorationEnableAiCompanion(true);
      try {
        const token = localStorage.getItem("token") || "";

        // 1. 先获取最新数据，看是否已有提示词
        const detailRes = await fetch(`/api/exploration-activities/${explorationEditId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        let hasPrompt = false;
        if (detailRes.ok) {
          const detail = await detailRes.json();
          hasPrompt = !!(detail.aiCompanionPrompt && detail.aiCompanionPrompt.length > 50);
          if (hasPrompt) {
            setAiCompanionPromptText(detail.aiCompanionPrompt);
          }
        }

        // 2. 调用PUT注入UI
        setAiCompanionStatus("injecting");
        const res = await fetch(`/api/exploration-activities/${explorationEditId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ enableAiCompanion: true }),
        });
        if (!res.ok) {
          throw new Error("注入失败");
        }
        const saved = await res.json();
        setExplorations((prev) => prev.map((e) => e.id === saved.id ? saved : e));

        // 同步更新预览和源代码编辑区
        if (saved.htmlContent) {
          setExplorationHtml(saved.htmlContent);
          setExplorationPreview(saved.htmlContent);
        }

        // 3. 如果已有提示词 → 秒开，否则生成
        if (hasPrompt) {
          setAiCompanionStatus("ready");
          MessagePlugin.success("AI伴学已开启（秒开）");
        } else {
          setAiCompanionStatus("analyzing");
          await generateAiCompanionPromptInBackground(explorationEditId);
          MessagePlugin.success("AI伴学已就绪");
        }
      } catch (e: any) {
        setAiCompanionStatus("error");
        setExplorationEnableAiCompanion(false);
        MessagePlugin.error("AI伴学启用失败：" + (e?.message || "未知错误"));
      }
    } else {
      // 禁用：调用PUT移除UI，提示词保留（再次启用秒开）
      setAiCompanionStatus("idle");
      try {
        const token = localStorage.getItem("token") || "";
        const res = await fetch(`/api/exploration-activities/${explorationEditId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ enableAiCompanion: false }),
        });
        if (res.ok) {
          const saved = await res.json();
          setExplorations((prev) => prev.map((e) => e.id === saved.id ? saved : e));
          // 同步更新预览和源代码编辑区（移除AI伴学代码）
          if (saved.htmlContent) {
            setExplorationHtml(saved.htmlContent);
            setExplorationPreview(saved.htmlContent);
          }
          MessagePlugin.success("AI伴学已关闭（提示词已保留，再次启用秒开）");
        }
        setExplorationEnableAiCompanion(false);
      } catch {
        MessagePlugin.error("操作失败");
      }
    }
  };

  // 重置AI伴学提示词（清空aiCompanionPrompt，下次启用时重新生成）
  const handleResetAiCompanionPrompt = async () => {
    if (!explorationEditId) return;
    if (!confirm("确定要重置AI伴学提示词吗？\n重置后，下次开启AI伴学会重新分析HTML生成提示词（耗时10-30秒）。")) {
      return;
    }
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/exploration-activities/${explorationEditId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ aiCompanionPrompt: null }),
      });
      if (res.ok) {
        const saved = await res.json();
        setExplorations((prev) => prev.map((e) => e.id === saved.id ? saved : e));
        setAiCompanionPromptText("");
        if (explorationEnableAiCompanion) {
          // 已启用状态下重置：立即重新生成
          setAiCompanionStatus("analyzing");
          await generateAiCompanionPromptInBackground(explorationEditId);
          MessagePlugin.success("提示词已重置并重新生成");
        } else {
          setAiCompanionStatus("idle");
          MessagePlugin.success("提示词已重置，下次启用AI伴学会重新生成");
        }
      } else {
        MessagePlugin.error("重置失败");
      }
    } catch {
      MessagePlugin.error("操作失败");
    }
  };

  // 保存探究（入口：判断是否需要预览）
  const handleSaveExploration = async () => {
    if (!explorationTitle.trim()) {
      MessagePlugin.warning("请输入探究标题");
      return;
    }
    if (!explorationHtml.trim()) {
      MessagePlugin.warning("请先生成 HTML 内容");
      return;
    }

    // 未启用提交 → 直接保存
    if (!explorationEnableSubmission) {
      await doSaveExploration();
      return;
    }

    // 已确认注入（用户在预览中点了确认）→ HTML 已改造，直接保存
    if (confirmedInjection) {
      await doSaveExploration();
      return;
    }

    // 启用提交但未确认 → 先调 AI 预览（原始流程）
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewAnalysis(null);
    setAutoScoreScript(null);
    setPreviewStatus("正在向 AI 发送 HTML 代码...");
    setInjectionPreviewVisible(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/exploration-activities/preview-injection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          htmlContent: explorationHtml,
          explorationId: explorationEditId || undefined,
          subProjectId: explorationPanelSpId,
        }),
      });
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        setPreviewError("服务器返回格式错误：" + String(parseErr));
        setPreviewLoading(false);
        return;
      }
      if (data.success) {
        setPreviewAnalysis(data.analysis);
        setAutoScoreScript(data.autoScoreScript || null);
      } else {
        setPreviewError(data.error || "分析失败");
        if (data.fallback) {
          setPreviewAnalysis(data.fallback);
        }
      }
    } catch (e: any) {
      setPreviewError(e.message || "预览失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  // 删除探究
  const handleDeleteExploration = async (id: string) => {
    if (!confirm("确定要删除此探究吗？")) return;
    setOperatingExplorationId(id);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/exploration-activities/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setExplorations((prev) => prev.filter((e) => e.id !== id));
        MessagePlugin.success("已删除");
      } else {
        MessagePlugin.error("删除失败");
      }
    } catch {
      MessagePlugin.error("删除失败");
    } finally {
      setOperatingExplorationId(null);
    }
  };

  // 探究 enabled 切换
  const handleExplorationToggle = async (e: any, checked: boolean) => {
    setOperatingExplorationId(e.id);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/exploration-activities/${e.id}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: checked }),
      });
      if (res.ok) {
        setExplorations((prev) => prev.map((item) => item.id === e.id ? { ...item, enabled: checked } : item));
        MessagePlugin.success(checked ? "探究已生效" : "探究已失效");
      } else {
        MessagePlugin.error("切换失败");
      }
    } catch {
      MessagePlugin.error("切换失败");
    } finally {
      setOperatingExplorationId(null);
    }
  };

  // 探究排序
  const handleExplorationReorder = async (expId: string, direction: "up" | "down") => {
    if (!explorationPanelSpId) return;
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/exploration-activities/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ explorationId: expId, direction, subProjectId: explorationPanelSpId }),
      });
      if (res.ok) {
        // 重新拉取列表
        const refreshRes = await fetch(`/api/exploration-activities?subProjectId=${explorationPanelSpId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await refreshRes.json();
        setExplorations(Array.isArray(data) ? data : []);
      } else {
        MessagePlugin.error("排序失败");
      }
    } catch {
      MessagePlugin.error("排序失败");
    }
  };

  // 编辑已有探究
  const openEditExploration = (e: any) => {
    setExplorationEditId(e.id);
    setExplorationTitle(e.title);
    setExplorationDesignPrompt(e.designPrompt || ""); // 互动设计提示词（如果有保存的话）
    setExplorationPrompt(e.analysisPrompt || "");
    setExplorationHtml(e.htmlContent || "");
    setExplorationPreview(e.htmlContent || "");
    // 答题提交相关
    setExplorationEnableSubmission(e.enableSubmission || false);
    setExplorationHasSubmissions((e._count?.ExplorationSubmission ?? 0) > 0);
    syncConfirmedInjection(false);
    // 保存编辑前的原始 HTML（用于关闭时恢复）
    setOriginalHtmlForInjection(e.htmlContent || "");
    // AI伴学状态
    setExplorationEnableAiCompanion(e.enableAiCompanion || false);
    setAiCompanionPromptText((e as any).aiCompanionPrompt || "");
    setAiCompanionStatus(e.enableAiCompanion ? "ready" : "idle");
    setShowAiCompanionPrompt(false);
    setExplorationModalVisible(true);
  };

  // 打开教学预览（只读 iframe）
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const openPreview = (html: string) => {
    setPreviewHtml(html);
    setPreviewModalVisible(true);
  };

  // 对话活动上下排序
  const handleConversationReorder = async (pcId: string, direction: "up" | "down", subProjectId: string | undefined): Promise<void> => {
    const _resolvedSpId = subProjectId ?? "";
    void _resolvedSpId; // suppress unused warning
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/preset-conversations/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ presetConversationId: pcId, direction, subProjectId: _resolvedSpId }),
      });
      if (res.ok) {
        // 重新拉取课堂数据
        fetchTasks();
      } else {
        MessagePlugin.error("排序失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    }
  };

  // 课堂作业上下排序
  const handleQuizReorder = async (quizId: string, direction: "up" | "down", subProjectId: string) => {
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/quiz-activities/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ quizId, direction, subProjectId }),
      });
      if (res.ok) {
        // 乐观更新：本地交换列表顺序（因为 GET 排序规则不依赖 sortOrder 一个字段）
        setQuizzes((prev) => {
          const idx = prev.findIndex((q: any) => q.id === quizId);
          if (idx === -1) return prev;
          const targetIdx = direction === "up" ? idx - 1 : idx + 1;
          if (targetIdx < 0 || targetIdx >= prev.length) return prev;
          const updated = [...prev];
          [updated[idx], updated[targetIdx]] = [updated[targetIdx], updated[idx]];
          return updated;
        });
      } else {
        const errText = await res.text();
        MessagePlugin.error("排序失败: " + errText);
      }
    } catch (e) {
      MessagePlugin.error("网络错误");
    }
  };

  // 单个作业操作中状态（避免按钮重复点击）
  const [operatingQuizId, setOperatingQuizId] = useState<string | null>(null);
  const [deletingQuizId, setDeletingQuizId] = useState<string | null>(null);
  const [clearingAttemptsQuizId, setClearingAttemptsQuizId] = useState<string | null>(null);
  const [operatingPresetConversationId, setOperatingPresetConversationId] = useState<string | null>(null);
  const [reanalyzingQuizId, setReanalyzingQuizId] = useState<string | null>(null);

  // 作业分析弹窗
  const [quizAnalysisVisible, setQuizAnalysisVisible] = useState(false);
  const [quizAnalysisLoading, setQuizAnalysisLoading] = useState(false);
  const [quizAnalysisData, setQuizAnalysisData] = useState<any>(null);
  const [quizAnalysisGenerating, setQuizAnalysisGenerating] = useState(false);
  const [quizScrollToAI, setQuizScrollToAI] = useState(false);
  const quizAIRef = useRef<HTMLDivElement>(null);
  const [quizAnalysisClassId, setQuizAnalysisClassId] = useState("");
  const [quizAnalysisId, setQuizAnalysisId] = useState("");

  // 作业预览弹窗（模拟学生界面，只读，不能提交，只有上一题/下一题）
  const [quizPreviewVisible, setQuizPreviewVisible] = useState(false);
  const [quizPreviewData, setQuizPreviewData] = useState<{ title: string; questions: any[] } | null>(null);
  const [quizPreviewIndex, setQuizPreviewIndex] = useState(0);
  const [quizPreviewAnswers, setQuizPreviewAnswers] = useState<Record<string, string>>({});

  const openQuizPreview = (q: any) => {
    const questions = q.questions || [];
    setQuizPreviewData({ title: q.title, questions });
    setQuizPreviewIndex(0);
    setQuizPreviewAnswers({});
    setQuizPreviewVisible(true);
  };

  const closeQuizPreview = () => {
    setQuizPreviewVisible(false);
    setQuizPreviewData(null);
    setQuizPreviewIndex(0);
    setQuizPreviewAnswers({});
  };

  // 删除确认
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  // 清理对话
  const [clearVisible, setClearVisible] = useState(false);
  const [clearTaskId, setClearTaskId] = useState<string | null>(null);
  const [clearClassId, setClearClassId] = useState<string | null>(null);
  const [clearLoading, setClearLoading] = useState(false);
  const [formStudentTemplateId, setFormStudentTemplateId] = useState<string>("");
  const [formClassTemplateId, setFormClassTemplateId] = useState<string>("");
  const [formAnalysisPrompt, setFormAnalysisPrompt] = useState("");
  const [formClassAnalysisPrompt, setFormClassAnalysisPrompt] = useState("");

  useEffect(() => {
    fetchTasks(true);
    fetchClasses();
    fetchTemplates();
    fetchKnowledgeBases();
  }, []);

  // 作业分析弹窗滚动到AI区域
  useEffect(() => {
    if (quizScrollToAI && quizAnalysisData && quizAIRef.current) {
      setTimeout(() => {
        quizAIRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setQuizScrollToAI(false);
      }, 100);
    }
  }, [quizScrollToAI, quizAnalysisData]);

  const fetchTasks = async (initial = false): Promise<LearningTask[]> => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/tasks", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        let data: any;
        try {
          data = await res.json();
        } catch {
          console.error("解析 tasks 响应失败，响应内容非 JSON");
          setLoading(false);
          return [];
        }
        setTasks(data);
        // 仅在首次加载时自动展开
        if (initial) {
          const enabledTask = data.find((t: LearningTask) => t.status === "ENABLED");
          if (enabledTask) {
            setExpandedTaskId(enabledTask.id);
            const allSpIds = new Set<string>();
            data.forEach((t: LearningTask) => {
              if (t.status === "ENABLED") {
                t.subProjects.forEach((sp) => {
                  if (sp.id) allSpIds.add(sp.id);
                });
              }
            });
            setExpandedSpIds(allSpIds);
            const firstSp = enabledTask.subProjects[0];
            if (firstSp?.id) {
              openQuizPanel(firstSp.id, enabledTask);
              // 同时自动加载互动探究列表（如果已有探究项目，面板会立刻显示；没有则无影响）
              openExplorationPanel(firstSp.id);
            }
          }
        }
        return data;
      }
      return [];
    } catch {
      console.error("获取课堂失败");
      return [];
    } finally {
      setLoading(false);
    }
  };

  const fetchClasses = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setClasses(data);
      }
    } catch {
      console.error("获取班级失败");
    }
  };

  const fetchTemplates = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/analysis-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        console.log("模板数据:", data);
        console.log("所有模板:", data.all);
        console.log("学生模板:", data.studentTemplates);
        console.log("班级模板:", data.classTemplates);
        setTemplates(data.all || []);
        setConversationTemplates(data.conversationTemplates || []);
      }
    } catch {
      console.error("获取模板失败");
    }
  };

  const fetchKnowledgeBases = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/knowledge-base", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKnowledgeBases(
          data
            .filter((kb: { id: string; name: string; status: string; content: string; enabled: boolean }) => kb.enabled)
            .map((kb: { id: string; name: string; status: string; content: string; enabled: boolean }) => ({
              id: kb.id,
              name: kb.name,
              status: kb.status,
              enabled: kb.enabled,
              contentLength: kb.content?.length || 0,
            }))
        );
      }
    } catch {
      console.error("获取知识库失败");
    }
  };

  const getSelectedKbTotalLength = (ids: string[]) => {
    return ids
      .map((id) => knowledgeBases.find((kb) => kb.id === id))
      .reduce((sum, kb) => sum + (kb?.contentLength || 0), 0);
  };

  const toggleKbSelection = (kbId: string) => {
    setSelectedKbIds((prev) => {
      if (prev.includes(kbId)) {
        return prev.filter((id) => id !== kbId);
      }
      // 检查加入后是否超过总量限制
      const newIds = [...prev, kbId];
      const total = getSelectedKbTotalLength(newIds);
      if (total > 50000) {
        MessagePlugin.warning(`所选知识库总字符数将超过 50,000 限制（${total.toLocaleString()} 字符），无法添加`);
        return prev;
      }
      return newIds;
    });
  };

  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormGrade("");
    setFormSubject("");
    setFormClassIds([]);
    setSelectedKbIds([]);
    setEditingTask(null);
    setFormStudentTemplateId("");
    setFormClassTemplateId("");
    setFormAnalysisPrompt("");
    setFormClassAnalysisPrompt("");
  };

  // ===== 课堂作业 inline 功能 =====
  const openQuizPanel = async (spId: string, task: LearningTask) => {
    setQuizPanelSpId(spId);
    setQuizPanelVisible(true);
    setLoadingQuizzes(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/quiz-activities?subProjectId=${spId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        console.error("解析作业响应失败");
        setQuizzes([]);
        return;
      }
      setQuizzes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("获取作业失败", e);
    } finally {
      setLoadingQuizzes(false);
    }
  };

  const closeQuizPanel = () => {
    setQuizPanelVisible(false);
    setQuizPanelSpId(null);
    setQuizzes([]);
  };

  // Step 1: 编辑已有作业（从列表进入设计模式）
  const startEditQuiz = (q: any) => {
    const tpl = templates.find((t: any) => t.type === "QUIZ_DESIGN");
    setQuizDesignId(q.id); // 编辑已有
    setQuizDesignTitle(q.title);
    setQuizDesignDesc(q.description || "");
    setQuizDesignTemplateContent(tpl?.content || "");
    setQuizDesignQuestions(q.questions || []);
    setQuizAnalysisPrompt(q.analysisPrompt || "");
    setQuizDesignMode(true);
  };

  // Step 2: AI 生成题目（新建和编辑共用）
  const handleAIGenerateQuestions = async () => {
    if (!quizPanelSpId) return;
    setGeneratingQuestions(true);
    try {
      const token = localStorage.getItem("token") || "";

      // 新建模式：不创建作业，只调用 AI 生成题目到前端 state
      // 作业将在用户点"保存作业"时才创建
      if (!quizDesignId) {
        // 仅验证标题和模板是否已选
        if (!quizDesignTitle.trim()) {
          MessagePlugin.warning("请输入作业名称");
          setGeneratingQuestions(false);
          return;
        }
        if (!selectedQuizTemplateId) {
          MessagePlugin.warning("请选择模板");
          setGeneratingQuestions(false);
          return;
        }
      }

      // 调用 AI 生成（统一使用 generate-preview 预览，不再支持对已有作业重新生成）
      const genRes = await fetch(`/api/quiz-activities/generate-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subProjectId: quizPanelSpId,
          title: quizDesignTitle,
          description: quizDesignDesc,
          quizDesignTemplateContent: quizDesignTemplateContent,
          taskId: quizDesignId ? undefined : (tasks.find(t => t.subProjects.some(sp => sp.id === quizPanelSpId))?.id),
        }),
      });
      const genData = await genRes.json();
      console.log("=== 前端收到的生成结果 ===", genData);
      if (!genRes.ok) throw new Error(genData.message || "生成题目失败");

      setQuizDesignQuestions(genData.questions || []);
      // generate API 只返回数据，题目在 quizDesignQuestions 中，等用户点"保存作业"才写入数据库
      MessagePlugin.success(`已生成 ${genData.count} 道题目，点击「保存作业」保存到数据库`);
    } catch (e: any) {
      MessagePlugin.error(e.message);
    } finally {
      setGeneratingQuestions(false);
    }
  };

  // Step 2: 保存作业（含题目编辑）
  const handleSaveQuiz = async () => {
    if (!quizDesignTitle.trim()) {
      MessagePlugin.warning("请输入作业名称");
      return;
    }
    setSavingQuiz(true);
    try {
      const token = localStorage.getItem("token") || "";
      let quizId = quizDesignId;

      // 新建模式：先创建作业
      if (!quizId) {
        const createRes = await fetch("/api/quiz-activities", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            subProjectId: quizPanelSpId,
            title: quizDesignTitle,
            description: quizDesignDesc,
            autoGenerate: false,
            analysisPrompt: quizAnalysisPrompt,
          }),
        });
        const created = await createRes.json();
        if (!createRes.ok) throw new Error(created.error || "创建作业失败");
        quizId = created.id;
        // 更新面板列表
        setQuizzes((prev) => [created, ...prev]);
      } else {
        // 编辑模式：更新作业基本信息（含analysisPrompt）
        await fetch(`/api/quiz-activities/${quizId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title: quizDesignTitle,
            description: quizDesignDesc,
            analysisPrompt: quizAnalysisPrompt,
          }),
        });
      }

      // 保存题目（无论是否有内容，empty array 表示清空题目）
      const updateQuestionsRes = await fetch(`/api/quiz-activities/${quizId}/questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ questions: quizDesignQuestions }),
      });
      if (!updateQuestionsRes.ok) {
        console.error("题目保存失败");
      }
      MessagePlugin.success("作业已保存");
      exitQuizDesign();
      // 刷新列表
      if (quizPanelSpId) {
        const res = await fetch(`/api/quiz-activities?subProjectId=${quizPanelSpId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setQuizzes(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      MessagePlugin.error("保存失败");
    } finally {
      setSavingQuiz(false);
    }
  };

  const exitQuizDesign = () => {
    setQuizDesignMode(false);
    setQuizDesignId(null);
    setQuizDesignTitle("");
    setQuizDesignDesc("");
    setQuizDesignTemplateContent("");
    setQuizAnalysisPrompt("");
    setQuizDesignQuestions([]);
    setNewQuizTitle("");
    setNewQuizDesc("");
    setSelectedQuizTemplateId("");
  };

  // ===== 作业分析 =====
  const openQuizAnalysis = async (quizId: string, scrollToAI = false) => {
    setQuizAnalysisId(quizId);
    setQuizScrollToAI(scrollToAI);
    setQuizAnalysisVisible(true);
    setQuizAnalysisData(null);
    setQuizAnalysisLoading(true);
    setQuizAnalysisGenerating(false);
    try {
      const token = localStorage.getItem("token") || "";
      // 获取当前班级
      const currentRes = await fetch("/api/classes/current", {
        headers: { Authorization: `Bearer ${token}` },
      });
      let currentClassId = "";
      if (currentRes.ok) {
        const currentData = await currentRes.json();
        currentClassId = currentData.class?.id || "";
      }
      // 先获取 classIds
      const initRes = await fetch(`/api/quiz-activities/${quizId}/report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (initRes.ok) {
        const initData = await initRes.json();
        const targetClassId = initData.classIds?.includes(currentClassId)
          ? currentClassId
          : (initData.classIds?.[0] || "");
        setQuizAnalysisClassId(targetClassId);
        // 加载该班级数据
        const classParam = targetClassId ? `?classId=${targetClassId}` : "";
        const data = await (await fetch(`/api/quiz-activities/${quizId}/report${classParam}`, {
          headers: { Authorization: `Bearer ${token}` },
        })).json();
        setQuizAnalysisData(data);
      }
    } catch (e) {
      console.error("获取作业分析失败", e);
    } finally {
      setQuizAnalysisLoading(false);
    }
  };

  const generateQuizAIAnalysis = async (quizId: string, templateId?: string) => {
    setQuizAnalysisGenerating(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${quizId}/report/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const data = await res.json();
      console.log("AI分析返回数据:", res.status, data);
      if (!res.ok) {
        console.error("生成AI分析失败", res.status, data);
        alert(data.error || "生成失败");
        return;
      }
      if (!data.content) {
        console.error("生成AI分析返回内容为空", data);
      }
      setQuizAnalysisData((prev: any) => {
        console.log("更新quizAnalysisData, prev:", prev, "aiContent:", data.content);
        return { ...prev, aiContent: data.content || "" };
      });
      setQuizzes((prev) => prev.map((q) => q.id === quizId ? { ...q, hasAIAnalysis: true } : q));
    } catch (e) {
      console.error("生成AI分析失败", e);
    } finally {
      setQuizAnalysisGenerating(false);
    }
  };

  const handleReanalyzeQuiz = async (quizId: string) => {
    setReanalyzingQuizId(quizId);
    try {
      // 先打开分析弹窗，加载数据
      await openQuizAnalysis(quizId);
      // 然后直接触发 AI 重新分析
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${quizId}/report/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      setQuizAnalysisData((prev: any) => ({ ...prev, aiContent: data.content }));
    } catch (e) {
      console.error("重新分析失败", e);
    } finally {
      setReanalyzingQuizId(null);
    }
  };

  const closeQuizAnalysis = () => {
    setQuizAnalysisVisible(false);
    setQuizAnalysisData(null);
  };

  // ===== 单个作业操作 =====
  const handleQuizPublish = async (quizId: string) => {
    setOperatingQuizId(quizId);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${quizId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        // 重新获取作业列表，确保状态同步
        const quiz = quizzes.find(q => q.id === quizId);
        if (quiz) {
          const updatedRes = await fetch(`/api/quiz-activities?subProjectId=${quiz.subProjectId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (updatedRes.ok) {
            const updatedQuizzes = await updatedRes.json();
            setQuizzes((prev) => {
              const otherQuizzes = prev.filter((q) => q.subProjectId !== quiz.subProjectId);
              return [...otherQuizzes, ...updatedQuizzes];
            });
          }
        }
        MessagePlugin.success("作业已生效");
      } else {
        const errorText = await res.text();
        MessagePlugin.error(errorText || "生效失败");
      }
    } finally {
      setOperatingQuizId(null);
    }
  };

  const handleQuizDelete = async (quizId: string) => {
    if (!confirm("确定要删除此作业吗？删除后不可恢复。")) return;
    setDeletingQuizId(quizId);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${quizId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
        MessagePlugin.success("作业已删除");
      } else {
        MessagePlugin.error("删除失败");
      }
    } finally {
      setDeletingQuizId(null);
    }
  };

  const handleClearAttempts = async (quizId: string) => {
    if (!confirm("确定要清除本作业覆盖的所有班级的学生答题吗？\n\nAI 分析报告将继续保留。\n\n此操作不可撤销！")) return;
    setClearingAttemptsQuizId(quizId);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${quizId}/clear-attempts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        // 刷新列表
        if (quizPanelSpId) {
          const refreshRes = await fetch(`/api/quiz-activities?subProjectId=${quizPanelSpId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const refreshData = await refreshRes.json();
          setQuizzes(Array.isArray(refreshData) ? refreshData : []);
        }
        MessagePlugin.success(`已清除 ${data.deletedCount} 条答题记录`);
      } else {
        MessagePlugin.error(data.error || "清除失败");
      }
    } catch {
      MessagePlugin.error("请求失败");
    } finally {
      setClearingAttemptsQuizId(null);
    }
  };

  const handleQuizViewStudentPage = (quizId: string) => {
    window.open(`/student/quiz/${quizId}`, "_blank");
  };

  const openCreateForm = () => {
    resetForm();
    setFormVisible(true);
  };

  const openEditForm = (task: LearningTask) => {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDescription(task.description || "");
    setFormGrade(task.grade || "");
    setFormSubject(task.subject || "");
    setFormClassIds(task.assignments.map((a) => a.classId));
    // 设置分析提示词到独立 state
    setFormAnalysisPrompt(task.analysisPrompt || "");
    setFormClassAnalysisPrompt((task as any).classAnalysisPrompt || "");
    try {
      const ids = task.knowledgeBaseIds ? JSON.parse(task.knowledgeBaseIds) : [];
      setSelectedKbIds(Array.isArray(ids) ? ids : []);
    } catch {
      setSelectedKbIds([]);
    }
    setFormVisible(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim()) {
      MessagePlugin.error("请填写课堂标题");
      return;
    }
    if (!formGrade) {
      MessagePlugin.error("请选择年级");
      return;
    }
    if (!formSubject) {
      MessagePlugin.error("请选择学科");
      return;
    }
    if (!formDescription.trim()) {
      MessagePlugin.error("请填写课堂目标");
      return;
    }
    if (formClassIds.length === 0) {
      MessagePlugin.error("请至少选择一个班级");
      return;
    }

    console.log("保存课堂，当前选择的模板:", {
      studentInsightTemplateId: editingTask?.studentInsightTemplateId,
      classInsightTemplateId: editingTask?.classInsightTemplateId,
    });

    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      const url = editingTask ? `/api/tasks/${editingTask.id}` : "/api/tasks";
      const method = editingTask ? "PUT" : "POST";

      // 新建课堂时，自动创建一个默认学习活动作为容器
      const subProjectsToSend = editingTask
        ? undefined  // 编辑时不传 subProjects，后端保留现有数据
        : [{ title: "默认活动", description: "", objectives: "", requirements: "", knowledgeBase: "", analysisPrompt: "", presetConversations: [] }];

      const body: Record<string, unknown> = {
        title: formTitle,
        description: formDescription,
        grade: formGrade,
        subject: formSubject,
        objectives: editingTask?.objectives || "",
        requirements: editingTask?.requirements || "",
        knowledgeBase: editingTask?.knowledgeBase || "",
        analysisPrompt: formAnalysisPrompt || editingTask?.analysisPrompt || "",
        knowledgeBaseIds: selectedKbIds.length > 0 ? JSON.stringify(selectedKbIds) : null,
        classIds: formClassIds,
        classAnalysisPrompt: formClassAnalysisPrompt || (editingTask as any)?.classAnalysisPrompt || "",
      };
      if (subProjectsToSend) {
        body.subProjects = subProjectsToSend;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        MessagePlugin.success(editingTask ? "课堂已更新" : "课堂已创建");
        setFormVisible(false);
        resetForm();
        const data = await res.json();
        if (!editingTask) {
          // 新建课堂后自动展开并进入编辑对话活动模式
          setExpandedTaskId(data.id);
          setEditingTaskId(data.id);
          // 使用返回的第一个 SubProject（自动创建的默认活动）
          const defaultSp = data.subProjects?.[0];
          setEditingSubProjects([
            {
              id: defaultSp?.id || "",
              title: "默认活动",
              description: "",
              objectives: "",
              requirements: "",
              knowledgeBase: "",
              analysisPrompt: "",
              analysisTemplateId: "",
              presetConversations: [
                {
                  title: "",
                  description: "",
                  systemPrompt: "",
                  analysisPrompt: "",
                  analysisTemplateId: "",
                  conversationPromptTemplateId: "",
                },
              ],
            },
          ]);
          const allSpIds = new Set<string>();
          data.subProjects?.forEach((sp: { id?: string }) => {
            if (sp.id) allSpIds.add(sp.id);
          });
          setExpandedSpIds(allSpIds);
        }
        fetchTasks();
        // 如果探究面板已打开，更新 spId（新 subProject id）并刷新列表
        if (explorationPanelVisible && explorationPanelSpId) {
          const newTasks = await fetchTasks();
          const updatedTask = newTasks.find((t: any) => t.id === editingTask?.id);
          if (updatedTask?.subProjects?.[0]?.id) {
            const newSpId = updatedTask.subProjects[0].id;
            setExplorationPanelSpId(newSpId);
            fetch("/api/exploration-activities?subProjectId=" + newSpId, {
              headers: { Authorization: "Bearer " + (localStorage.getItem("token") || "") },
            }).then(r => r.json()).then(data => {
              setExplorations(Array.isArray(data) ? data : []);
            });
          }
        }
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "保存失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTaskId) return;
    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${deleteTaskId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success("课堂已删除");
        fetchTasks();
      } else {
        MessagePlugin.error("删除失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setSaving(false);
      setDeleteVisible(false);
      setDeleteTaskId(null);
    }
  };

  const handleStatusChange = async (taskId: string, currentStatus: string) => {
    const newStatus = NEXT_STATUS[currentStatus as keyof typeof NEXT_STATUS];
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        MessagePlugin.success(`课堂已${NEXT_STATUS_LABEL[currentStatus as keyof typeof NEXT_STATUS_LABEL]}`);
        fetchTasks();
      } else {
        MessagePlugin.error("状态更新失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    }
  };

  const openClearDialog = (taskId: string) => {
    setClearTaskId(taskId);
    setClearClassId(null);
    setClearVisible(true);
  };

  const handleClearConversations = async () => {
    if (!clearTaskId) return;
    setClearLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${clearTaskId}/conversations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId: clearClassId }),
      });
      if (res.ok) {
        const data = await res.json();
        MessagePlugin.success(data.message || "对话记录已清理");
        setClearVisible(false);
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "清理失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setClearLoading(false);
    }
  };

  const toggleClass = (classId: string) => {
    setFormClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  const getStatusTag = (status: string) => {
    const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.DISABLED;
    return (
      <Tag theme={config.theme} variant="light" size="small">
        {config.label}
      </Tag>
    );
  };

  // startEditingSubProjects：analysisPrompt 直接赋值，不再做模板映射
  const startEditingSubProjects = (task: LearningTask) => {
    setEditingTaskId(task.id);

    setEditingSubProjects(
      task.subProjects.map((sp) => ({
        id: sp.id,
        title: sp.title,
        description: sp.description || "",
        objectives: sp.objectives || "",
        requirements: sp.requirements || "",
        knowledgeBase: sp.knowledgeBase || "",
        analysisPrompt: sp.analysisPrompt || "",
        presetConversations: sp.presetConversations.map((pc) => ({
          id: pc.id,
          title: pc.title,
          description: pc.description || "",
          systemPrompt: pc.systemPrompt || "",
          analysisPrompt: pc.analysisPrompt || "",
          classAnalysisPrompt: pc.classAnalysisPrompt || "",
          conversationPromptTemplateId: findConversationPromptTemplateId(pc.systemPrompt),
          enabled: pc.enabled !== false,
        })),
      }))
    );
  };

  const cancelEditingSubProjects = () => {
    setEditingTaskId(null);
    setEditingSubProjects([]);
  };

  const addPresetConversation = (spIndex: number) => {
    const updated = [...editingSubProjects];
    updated[spIndex].presetConversations.push({
      title: "",
      description: "",
      systemPrompt: "",
      enabled: true,
      analysisPrompt: "",
      classAnalysisPrompt: "",
    });
    setEditingSubProjects(updated);
  };

  const removePresetConversation = (spIndex: number, pcIndex: number) => {
    const updated = [...editingSubProjects];
    updated[spIndex].presetConversations = updated[spIndex].presetConversations.filter(
      (_, i) => i !== pcIndex
    );
    setEditingSubProjects(updated);
  };

  const moveConversation = (spIndex: number, pcIndex: number, direction: "up" | "down") => {
    const updated = [...editingSubProjects];
    const list = [...updated[spIndex].presetConversations];
    const targetIndex = direction === "up" ? pcIndex - 1 : pcIndex + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    [list[pcIndex], list[targetIndex]] = [list[targetIndex], list[pcIndex]];
    updated[spIndex].presetConversations = list;
    setEditingSubProjects(updated);
  };

  const updatePresetConversation = (spIndex: number, pcIndex: number, field: string, value: string) => {
    const updated = [...editingSubProjects];
    updated[spIndex].presetConversations[pcIndex] = {
      ...updated[spIndex].presetConversations[pcIndex],
      [field]: value,
    };
    // 如果用户手动编辑了 systemPrompt，清除模板关联，避免下次选择模板时覆盖
    if (field === "systemPrompt") {
      const currentTemplateId = updated[spIndex].presetConversations[pcIndex].conversationPromptTemplateId;
      if (currentTemplateId) {
        const templateContent = getConversationTemplateContent(currentTemplateId);
        if (value !== templateContent) {
          updated[spIndex].presetConversations[pcIndex].conversationPromptTemplateId = undefined;
        }
      }
    }
    setEditingSubProjects(updated);
  };

  const saveSubProjects = async (taskId: string) => {
    // 校验对话活动
    for (const sp of editingSubProjects) {
      for (const pc of sp.presetConversations) {
        if (!pc.title?.trim()) {
          MessagePlugin.error("对话活动名称不能为空");
          return;
        }
        if (!pc.description?.trim()) {
          MessagePlugin.error("对话活动目标不能为空");
          return;
        }
        if (!pc.analysisPrompt?.trim()) {
          MessagePlugin.error("个人学情分析提示词不能为空");
          return;
        }
        if (!pc.classAnalysisPrompt?.trim()) {
          MessagePlugin.error("全班学情分析提示词不能为空");
          return;
        }
        if (!pc.systemPrompt?.trim()) {
          MessagePlugin.error("对话提示词不能为空");
          return;
        }
      }
    }

    setSavingSubProjects(true);
    try {
      const token = localStorage.getItem("token");
      const task = tasks.find((t) => t.id === taskId);

      // 保存对话活动，传递模板ID
      const subProjectsToSave = editingSubProjects.map((sp) => ({
        ...sp,
        title: "默认活动",
        objectives: "",
        requirements: "",
        knowledgeBase: "",
        analysisPrompt: "",
        presetConversations: sp.presetConversations.map((pc) => ({
          ...pc,
          // analysisPrompt 和 classAnalysisPrompt 已直接编辑
        })),
      }));

      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          // 保存对话活动时，只更新 subProjects 和 classIds，不修改课堂基本信息
          subProjects: subProjectsToSave,
          classIds: task?.assignments.map((a) => a.classId),
        }),
      });

      if (res.ok) {
        MessagePlugin.success("对话活动已保存");
        setEditingTaskId(null);
        setEditingSubProjects([]);
        closeExplorationPanel();
        const updatedTasks = await fetchTasks();
        // 重新打开互动探究面板（使用返回的最新数据中的第一个 subProject 的 ID）
        const currentTask = updatedTasks.find((t: LearningTask) => t.id === taskId);
        const firstSpId = currentTask?.subProjects?.[0]?.id;
        if (firstSpId) {
          openExplorationPanel(firstSpId);
        }
      } else {
        const data = await res.json();
        console.error("[saveSubProjects] 保存失败:", data);
        MessagePlugin.error(data.error === "服务器错误" && data.detail ? `服务器错误: ${data.detail}` : (data.error || "保存失败"));
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setSavingSubProjects(false);
    }
  };

  // const getTemplateNameById = (templateId?: string) => {
  //   if (!templateId) return "";
  //   const t = templates.find((tpl) => tpl.id === templateId);
  //   return t ? t.name : "";
  // };

  const getTemplateNameByContent = (content?: string) => {
    if (!content) return "";
    const t = templates.find((tpl) => tpl.content === content);
    return t ? t.name : "";
  };

  const getTemplateContent = (templateId?: string) => {
    if (!templateId) return "";
    const t = templates.find((tpl) => tpl.id === templateId);
    return t ? t.content : "";
  };

  const getTemplateOptions = (type: "student" | "class") => {
    return templates
      .filter((t) => t.type === type)
      .map((t) => ({ label: t.name, value: t.id }));
  };

  const getConversationTemplateOptions = () => {
    return conversationTemplates.map((t) => ({ label: t.name, value: t.id }));
  };

  const getConversationTemplateContent = (templateId?: string) => {
    if (!templateId) return "";
    const t = conversationTemplates.find((tpl) => tpl.id === templateId);
    return t ? t.content : "";
  };

  const findConversationPromptTemplateId = (systemPrompt?: string) => {
    if (!systemPrompt) return "";
    const t = conversationTemplates.find((tpl) => systemPrompt.startsWith(tpl.content));
    return t ? t.id : "";
  };

  return (
    <TeacherLayout>
      <div className="max-w-5xl space-y-6 pb-8">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">课堂管理</h2>
            <p className="text-[#63666F] text-sm mt-1">创建课堂，分配给班级，管理对话活动、互动探究、课堂作业</p>
          </div>
          <div className="flex gap-2">
            <Button
              theme="default"
              variant="outline"
              icon={<FileIcon />}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".json";
                input.onchange = async (e: any) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  // 检测并删除第一行注释行
                  let cleanText = text;
                  const firstLineEnd = text.indexOf('\n');
                  if (firstLineEnd > 0) {
                    const firstLine = text.substring(0, firstLineEnd).trim();
                    if (firstLine.startsWith('//')) {
                      cleanText = text.substring(firstLineEnd + 1);
                    }
                  }
                  let data: any;
                  try {
                    data = JSON.parse(cleanText);
                  } catch {
                    MessagePlugin.error("文件格式错误，无法解析");
                    return;
                  }
                  const token = localStorage.getItem("token") || "";
                  const res = await fetch("/api/tasks/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify(data),
                  });
                  if (res.ok) {
                    const importedTask = await res.json();
                    MessagePlugin.success("课堂导入成功");
                    const updatedTasks = await fetchTasks();
                    // 自动展开导入的课堂并加载互动探究和作业面板
                    setExpandedTaskId(importedTask.id);
                    // 从刷新后的任务列表中获取 subProject ID（更可靠）
                    const refreshedTask = updatedTasks.find((t: any) => t.id === importedTask.id);
                    const targetTask = refreshedTask || importedTask;
                    if (targetTask.subProjects?.length > 0) {
                      const firstSpId = targetTask.subProjects[0].id;
                      if (firstSpId) {
                        setExpandedSpIds(new Set([firstSpId]));
                        openExplorationPanel(firstSpId);
                        openQuizPanel(firstSpId, targetTask);
                      }
                    }
                  } else {
                    const err = await res.json().catch(() => ({}));
                    MessagePlugin.error(err.error || "导入失败");
                  }
                };
                input.click();
              }}
            >
              导入课堂
            </Button>
            <Button theme="primary" icon={<AddIcon />} onClick={openCreateForm}>
              创建课堂
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : tasks.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg mb-2">📋</p>
              <p>暂无课堂</p>
              <p className="text-sm mt-2">点击「创建课堂」开始</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const isExpanded = expandedTaskId === task.id;
              const isEditingSP = editingTaskId === task.id;
              return (
                <Card key={task.id}>
                  <div
                    className="cursor-pointer"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedTaskId(null);
                      } else {
                        setExpandedTaskId(task.id);
                        // 展开课堂时自动加载探究和作业面板
                        const firstSp = task.subProjects?.[0];
                        if (firstSp?.id) {
                          openQuizPanel(firstSp.id, task);
                          openExplorationPanel(firstSp.id);
                        }
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDownIcon className="text-gray-400" />
                        ) : (
                          <ChevronRightIcon className="text-gray-400" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-[#1A1A1A]">{task.title}</h3>
                            {getStatusTag(task.status)}
                            {task.grade && <Tag theme="default" variant="light" size="small">{task.grade}</Tag>}
                            {task.subject && <Tag theme="primary" variant="light" size="small">{task.subject}</Tag>}
                          </div>
                          <div className="text-xs text-[#63666F]">
                            {task.grade && `${task.grade} · `}{task.subject && `${task.subject} · `}更新于 {new Date(task.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 mr-2">
                          {task.assignments.map((a) => (
                            <Tag key={a.classId} theme="primary" variant="light" size="small">
                              {a.class.name}
                            </Tag>
                          ))}
                        </div>
                        <Button
                          theme={task.status === "ENDED" ? "warning" : "default"}
                          variant="outline"
                          size="small"
                          icon={
                            task.status === "DISABLED" ? <PlayIcon /> :
                            task.status === "ENABLED" ? <StopIcon /> :
                            <RefreshIcon />
                          }
                          onClick={() => handleStatusChange(task.id, task.status)}
                        >
                          {NEXT_STATUS_LABEL[task.status as keyof typeof NEXT_STATUS_LABEL]}
                        </Button>
                        <Tooltip content="分析课堂学情">
                          <Link href={`/teacher/tasks/${task.id}/insights`}>
                            <Button theme="success" variant="text" size="small" icon={<ChartBarIcon />} />
                          </Link>
                        </Tooltip>
                        <Tooltip content="重置清理学生记录">
                          <Button
                            theme="warning"
                            variant="text"
                            size="small"
                            icon={<RefreshIcon />}
                            onClick={() => openClearDialog(task.id)}
                          />
                        </Tooltip>
                        <Tooltip content="编辑课堂信息">
                          <Button
                            theme="primary"
                            variant="text"
                            size="small"
                            icon={<EditIcon />}
                            onClick={() => openEditForm(task)}
                          />
                        </Tooltip>
                        <Tooltip content="导出课堂">
                          <Button
                            theme="default"
                            variant="text"
                            size="small"
                            icon={<FileIcon />}
                            onClick={() => {
                              const token = localStorage.getItem("token") || "";
                              fetch(`/api/tasks/${task.id}/export`, {
                                headers: { Authorization: `Bearer ${token}` },
                              }).then((res) => res.json()).then((data) => {
                                if (data.error) {
                                  MessagePlugin.error(data.detail || data.error);
                                  return;
                                }
                                const filename = data._filename || `task_export_${new Date().toISOString().split("T")[0]}.json`;
                                const { _filename, ...cleanData } = data;
                                const commentLine = "// 这个json数据仅用于由常州管老师和他的AI助手协作开发的教学智能体（QuickClass Agent）。\n";
                                const jsonStr = commentLine + JSON.stringify(cleanData, null, 2);
                                const uri = "data:application/json;charset=utf-8," + encodeURIComponent(jsonStr);
                                const a = document.createElement("a");
                                a.href = uri;
                                a.download = filename;
                                a.click();
                                MessagePlugin.success("课堂已导出");
                              }).catch(() => MessagePlugin.error("导出失败"));
                            }}
                          />
                        </Tooltip>
                        <Tooltip content="删除课堂">
                          <Button
                            theme="danger"
                            variant="text"
                            size="small"
                            icon={<DeleteIcon />}
                            onClick={() => {
                              setDeleteTaskId(task.id);
                              setDeleteVisible(true);
                            }}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 pl-8 space-y-4">
                      {/* 关联知识库 */}
                      {task.knowledgeBaseIds && (() => {
                        try {
                          const kbIds = JSON.parse(task.knowledgeBaseIds) as string[];
                          const linkedKbs = knowledgeBases.filter((kb) => kbIds.includes(kb.id));
                          if (linkedKbs.length > 0) {
                            const totalLen = linkedKbs.reduce((s, kb) => s + kb.contentLength, 0);
                            return (
                              <div className="text-sm text-[#63666F]">
                                <span className="text-gray-500">知识库：</span>
                                {linkedKbs.map((kb) => (
                                  <Tag key={kb.id} theme="primary" variant="light" size="small" style={{ marginRight: 4 }}>
                                    {kb.name}（{kb.contentLength.toLocaleString()}字）
                                  </Tag>
                                ))}
                                <span className="text-xs text-gray-400 ml-1">共 {totalLen.toLocaleString()} 字符</span>
                              </div>
                            );
                          }
                        } catch { /* ignore */ }
                        return null;
                      })()}

                      {/* 对话编辑对话活动 */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm text-[#0052D9]">💬 对话活动</h4>
                          {!isEditingSP && (
                            <div className="flex gap-2">
                              <Button
                                theme="primary"
                                variant="outline"
                                size="small"
                                icon={<EditIcon />}
                                onClick={() => startEditingSubProjects(task)}
                              >
                                活动管理
                              </Button>
                              
                            </div>
                          )}
                        </div>

                        {isEditingSP ? (
                          /* 编辑模式 - 展平所有对话活动到一个区域 */
                          <div className="space-y-3">
                            {(() => {
                              // 展平所有子项目的对话活动，记录来源索引
                              const flatEds: { spIdx: number; pcIdx: number; pc: PresetConversation }[] = [];
                              editingSubProjects.forEach((sp, spIdx) => {
                                sp.presetConversations.forEach((pc, pcIdx) => {
                                  flatEds.push({ spIdx, pcIdx, pc });
                                });
                              });
                              return (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-[#63666F]">
                                      对话活动 ({flatEds.length})
                                    </span>
                                  </div>
                                  {flatEds.map(({ spIdx, pcIdx, pc }, flatIndex) => (
                                    <div key={flatIndex} className="bg-[#F7F8FA] rounded-lg p-3 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1">
                                          <Button
                                            theme="default"
                                            variant="text"
                                            size="small"
                                            disabled={flatIndex === 0}
                                            onClick={() => moveConversation(spIdx, pcIdx, "up")}
                                          >
                                            ↑
                                          </Button>
                                          <Button
                                            theme="default"
                                            variant="text"
                                            size="small"
                                            disabled={flatIndex === flatEds.length - 1}
                                            onClick={() => moveConversation(spIdx, pcIdx, "down")}
                                          >
                                            ↓
                                          </Button>
                                          <span className="text-xs text-gray-500 ml-1">对话 {flatIndex + 1}</span>
                                        </div>
                                        <Button
                                          theme="danger"
                                          variant="text"
                                          size="small"
                                          icon={<RemoveIcon />}
                                          onClick={() => {
                                            const pcName = pc.title || `对话 ${flatIndex + 1}`;
                                            if (window.confirm(`确定要删除「${pcName}」吗？此操作不可撤销！`)) {
                                              removePresetConversation(spIdx, pcIdx);
                                            }
                                          }}
                                        >
                                          删除
                                        </Button>
                                      </div>
                                      <span className="text-xs text-gray-500">对话活动名称：</span>
                                      <Input
                                        value={pc.title}
                                        onChange={(v) => updatePresetConversation(spIdx, pcIdx, "title", v)}
                                        placeholder="对话活动名称 *"
                                        size="small"
                                      />
                                      <span className="text-xs text-gray-500">对话活动目标：</span>
                                      <Textarea
                                        value={pc.description || ""}
                                        onChange={(v) => updatePresetConversation(spIdx, pcIdx, "description", v)}
                                        placeholder="对话活动目标 *"
                                        rows={2}
                                      />
                                      {/* 个人学情分析提示词 */}
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-gray-500">学生个人学情分析提示词：</span>
                                          <select
                                            className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0052D9]"
                                            value=""
                                            onChange={(e) => {
                                              const content = getTemplateContent(e.target.value);
                                              if (content) updatePresetConversation(spIdx, pcIdx, "analysisPrompt", content);
                                            }}
                                          >
                                            <option value="">选择个人学情模板填充...</option>
                                            {templates.filter(t => t.type === "student").map(t => (
                                              <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <textarea
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0052D9]"
                                          value={pc.analysisPrompt || ""}
                                          onChange={(e) => updatePresetConversation(spIdx, pcIdx, "analysisPrompt", e.target.value)}
                                          placeholder="个人学情分析提示词 *"
                                          rows={2}
                                        />
                                      </div>
                                      {/* 全班学情分析提示词 */}
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-gray-500">学生全班学情分析提示词：</span>
                                          <select
                                            className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0052D9]"
                                            value=""
                                            onChange={(e) => {
                                              const content = getTemplateContent(e.target.value);
                                              if (content) updatePresetConversation(spIdx, pcIdx, "classAnalysisPrompt", content);
                                            }}
                                          >
                                            <option value="">选择全班学情模板填充...</option>
                                            {templates.filter(t => t.type === "class").map(t => (
                                              <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <textarea
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0052D9]"
                                          value={pc.classAnalysisPrompt || ""}
                                          onChange={(e) => updatePresetConversation(spIdx, pcIdx, "classAnalysisPrompt", e.target.value)}
                                          placeholder="全班学情分析提示词 *"
                                          rows={2}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-gray-500">对话设计提示词：</span>
                                          <select
                                            className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0052D9]"
                                            value=""
                                            onChange={(e) => {
                                              const content = getConversationTemplateContent(e.target.value);
                                              if (content) updatePresetConversation(spIdx, pcIdx, "systemPrompt", content);
                                            }}
                                          >
                                            <option value="">选择对话设计模板</option>
                                            {conversationTemplates.map(t => (
                                              <option key={t.id} value={t.id}>{t.name}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <Textarea
                                          value={pc.systemPrompt || ""}
                                          onChange={(v) => updatePresetConversation(spIdx, pcIdx, "systemPrompt", v)}
                                        placeholder="对话提示词 *（选择模板后自动填入，可在此基础上修改）"
                                        rows={3}
                                      />
                                    </div>
                                  </div>
                                  ))}
                                </div>
                              );
                            })()}
                            {isEditingSP && (
                              <div className="flex justify-end gap-2 pt-2">
                                <Button
                                  theme="primary"
                                  variant="outline"
                                  size="small"
                                  icon={<AddIcon />}
                                  onClick={() => addPresetConversation(editingSubProjects.length - 1)}
                                >
                                  添加对话
                                </Button>
                              </div>
                            )}
                            {isEditingSP && (
                              <div className="flex justify-end gap-2 pt-2">
                                <Button
                                  theme="default"
                                  variant="outline"
                                  size="small"
                                  onClick={cancelEditingSubProjects}
                                >
                                  取消
                                </Button>
                                <Button
                                  theme="primary"
                                  size="small"
                                  icon={<SaveIcon />}
                                  loading={savingSubProjects}
                                  onClick={() => saveSubProjects(task.id)}
                                >
                                  保存
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          /* 只读模式 - 直接展示对话活动列表 */
                          (() => {
                            const allConversations = task.subProjects.flatMap(sp => sp.presetConversations);
                            return allConversations.length === 0 ? (
                              <div className="text-sm text-gray-400 py-4">暂无对话活动，点击「活动管理」添加</div>
                            ) : (
                              <div className="space-y-2">
                                {allConversations.map((pc, pcIdx) => {
                                  // 找到该对话所属的 subProject
                                  const isEnabled = pc.enabled !== false;
                                  return (
                                  <div key={pc.id} className="bg-[#F7F8FA] rounded-lg p-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {isEnabled ? (
                                          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">生效中</span>
                                        ) : (
                                          <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">失效中</span>
                                        )}
                                        <Switch value={isEnabled} size="small" onChange={(val: boolean) => handleConversationToggle(pc, val)} disabled={operatingPresetConversationId === pc.id} />
                                        <span className="font-medium text-sm">{pc.title}</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {isEnabled && (
                                          <>
                                            <Button
                                              theme="default" variant="text" size="small"
                                              disabled={pcIdx === 0}
                                              onClick={() => {
                                                const _sp = task.subProjects.find(sp => sp.presetConversations.some(p => p.id === pc.id));
                                                if (_sp && _sp.id) handleConversationReorder(pc.id as string, "up", _sp.id);
                                              }}
                                            >
                                              <ChevronUpIcon />
                                            </Button>
                                            <Button
                                              theme="default" variant="text" size="small"
                                              disabled={pcIdx === allConversations.length - 1}
                                              onClick={() => {
                                                const _sp = task.subProjects.find(sp => sp.presetConversations.some(p => p.id === pc.id));
                                                if (_sp && _sp.id) handleConversationReorder(pc.id as string, "down", _sp.id);
                                              }}
                                            >
                                              <ChevronDownIcon />
                                            </Button>
                                          </>
                                        )}
                                        <Button
                                          theme="success"
                                          variant="text"
                                          size="small"
                                          icon={<ChartBarIcon />}
                                          onClick={() => router.push(`/teacher/tasks/${task.id}/insights?pc=${pc.id}`)}
                                        >
                                          分析
                                        </Button>
                                      </div>
                                    </div>
                                    {pc.description && <div className="text-xs text-[#63666F] mt-1">对话活动目标：{pc.description}</div>}
                                  </div>
                                );})}
                              </div>
                            );
                          })()
                        )}
                      </div>

                      {/* 课堂作业管理 - 始终显示列表 */}

                      {/* 互动探究管理 */}
                      <div className="border-t border-gray-100 pt-3 mt-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-sm text-[#63666F]">互动探究</h4>
                          <Button
                            theme="primary" variant="outline" size="small" icon={<AddIcon />}
                            onClick={() => {
                              if (task.subProjects.length > 0) {
                                openExplorationThenModal(task.subProjects[0].id!);
                              }
                            }}
                          >
                            新建探究
                          </Button>
                        </div>

                        {/* 探究列表面板 */}
                        <div className="bg-[#F7F8FA] rounded-lg p-4">
                          {explorationPanelVisible && explorationPanelSpId === task.subProjects[0]?.id ? (
                            <>
                              {/* 探究列表 */}
                              {loadingExplorations ? (
                                <div className="text-center py-6 text-sm text-gray-400">加载中...</div>
                              ) : explorations.length === 0 ? (
                                <div className="text-center py-6 text-sm text-gray-400">暂无探究，点击「新建探究」创建</div>
                              ) : (
                                <div className="space-y-2">
                                  {explorations.map((e, eIdx) => (
                                    <div key={e.id} className="bg-white rounded-lg p-3">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          {e.enabled ? (
                                            <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">生效中</span>
                                          ) : (
                                            <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">失效中</span>
                                          )}
                                          {e.enableSubmission && (
                                            <span className={`px-2 py-0.5 rounded-full text-xs ${(e._count?.ExplorationSubmission ?? 0) > 0 ? "bg-gray-100 text-gray-400" : "bg-blue-100 text-blue-700"}`}>
                                              启用提交{(e._count?.ExplorationSubmission ?? 0) > 0 ? " 🔒" : ""}
                                            </span>
                                          )}
                                          {e.enableAiCompanion && (
                                            <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">
                                              AI伴学{(e as any).aiCompanionPrompt ? " ✓" : ""}
                                            </span>
                                          )}
                                          <Switch value={e.enabled} size="small"
                                            onChange={(val: boolean) => handleExplorationToggle(e, val)}
                                            disabled={operatingExplorationId === e.id} />
                                          <span className="font-medium text-sm text-gray-800">{e.title}</span>
                                        </div>
                                        <div className="flex gap-1 items-center flex-wrap">
                                          {e.enabled && (
                                            <>
                                              <Button theme="default" variant="text" size="small"
                                                disabled={eIdx === 0}
                                                onClick={() => handleExplorationReorder(e.id, "up")}>
                                                <ChevronUpIcon />
                                              </Button>
                                              <Button theme="default" variant="text" size="small"
                                                disabled={eIdx === explorations.length - 1}
                                                onClick={() => handleExplorationReorder(e.id, "down")}>
                                                <ChevronDownIcon />
                                              </Button>
                                            </>
                                          )}
                                          <Button theme="primary" variant="text" size="small"
                                            onClick={() => openPreview(e.htmlContent)}>预览</Button>
                                          {e.enableSubmission && (
                                            <Button theme="primary" variant="text" size="small"
                                              onClick={() => router.push(`/teacher/tasks/${expandedTaskId}/exploration/${e.id}`)}>分析</Button>
                                          )}
                                          <Button theme="primary" variant="text" size="small"
                                            onClick={() => openEditExploration(e)}>编辑</Button>
                                          <Button theme="danger" variant="text" size="small"
                                            loading={operatingExplorationId === e.id}
                                            onClick={() => handleDeleteExploration(e.id)}>删除</Button>
                                        </div>
                                      </div>
                                      {e.description && (
                                        <div className="text-xs text-gray-400">{e.description}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-center py-4 text-sm text-gray-400">
                              <Button theme="primary" variant="outline" size="small" icon={<AddIcon />}
                                onClick={() => { if (task.subProjects.length > 0) openExplorationThenModal(task.subProjects[0].id!); }}>
                                新建探究
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="border-t border-gray-100 pt-3 mt-3">
                        {/* 标题行 */}
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-sm text-[#63666F]">课堂作业</h4>
                          <div className="flex gap-2">
                            <input
                              type="file"
                              accept=".json"
                              className="hidden"
                              id="import-quiz-input"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = async (ev) => {
                                  try {
                                    const data = JSON.parse(ev.target?.result as string);
                                    let importedQuestions: any[] = [];
                                    if (Array.isArray(data)) importedQuestions = data;
                                    else if (data.questions && Array.isArray(data.questions)) importedQuestions = data.questions;
                                    else throw new Error("JSON 格式不正确");

                                    // 从文件名提取标题
                                    const title = file.name.replace(/\.json$/i, "") || "导入作业";
                                    const token = localStorage.getItem("token") || "";

                                    // 创建作业
                                    const desc = data.description || "";
                                    const createRes = await fetch("/api/quiz-activities", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ subProjectId: quizPanelSpId || task.subProjects[0]?.id, title, description: desc, autoGenerate: false }),
                                    });
                                    const created = await createRes.json();
                                    if (!createRes.ok) throw new Error(created.error || "创建失败");

                                    // 导入题目
                                    const questionsRes = await fetch(`/api/quiz-activities/${created.id}/questions`, {
                                      method: "PUT",
                                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ questions: importedQuestions }),
                                    });
                                    if (!questionsRes.ok) {
                                      const errData = await questionsRes.json().catch(() => ({}));
                                      throw new Error(errData.message || "导入题目失败");
                                    }

                                    // 刷新列表
                                    if (quizPanelSpId || task.subProjects[0]?.id) {
                                      const refreshRes = await fetch(`/api/quiz-activities?subProjectId=${quizPanelSpId || task.subProjects[0]?.id}`, {
                                        headers: { Authorization: `Bearer ${token}` },
                                      });
                                      const refreshData = await refreshRes.json();
                                      setQuizzes(Array.isArray(refreshData) ? refreshData : []);
                                    }
                                    MessagePlugin.success(`已导入作业「${title}」，共 ${importedQuestions.length} 题`);
                                  } catch (err: any) {
                                    MessagePlugin.error("导入失败: " + (err.message || "文件格式不正确"));
                                  }
                                };
                                reader.readAsText(file);
                                e.target.value = "";
                              }}
                            />
                            <label htmlFor="import-quiz-input" className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs cursor-pointer hover:bg-gray-50 text-gray-600">
                              导入作业
                            </label>
                            <Button theme="primary" variant="outline" size="small" icon={<EditIcon />} onClick={() => { setQuizDesignId(null); setQuizDesignTitle(""); setQuizDesignDesc(""); setQuizDesignTemplateContent(""); setQuizDesignQuestions([]); setSelectedQuizTemplateId(""); setQuizDesignMode(true); if (!quizPanelVisible && task.subProjects.length > 0) openQuizPanel(task.subProjects[0].id!, task); else if (quizPanelVisible && task.subProjects.length > 0) { setQuizPanelSpId(task.subProjects[0].id!); openQuizPanel(task.subProjects[0].id!, task); } else { setQuizPanelVisible(true); } }}>新建作业</Button>
                          </div>
                        </div>

                        {/* 作业列表面板 */}
                        <div className="bg-[#F7F8FA] rounded-lg p-4">
                          {quizPanelVisible ? (
                              <>
                                {/* 新建作业设计表单 - 置顶 */}
                                {quizDesignMode && !quizDesignId && (
                                  <div className="bg-white rounded-lg p-4 mb-3 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <h5 className="font-medium text-sm text-[#63666F]">新建作业 · {quizDesignTitle || "（未命名）"}</h5>
                                      <Button theme="default" variant="text" size="small" onClick={exitQuizDesign}>× 退出设计</Button>
                                    </div>
                                    {quizDesignQuestions.length === 0 ? (
                                      <>
                                        <Input value={quizDesignTitle} onChange={(v) => setQuizDesignTitle(v)} placeholder="作业名称 *" size="small" />
                                        <Input value={quizDesignDesc} onChange={(v) => setQuizDesignDesc(v)} placeholder="作业说明（选填）" size="small" />
                                        <div>
                                          <div className="text-xs text-gray-500 mb-1">选择作业设计模板</div>
                                          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={selectedQuizTemplateId} onChange={(e) => { setSelectedQuizTemplateId(e.target.value); const tpl = templates.find((t: any) => t.id === e.target.value); setQuizDesignTemplateContent(tpl?.content || ""); }}>
                                            <option value="">请选择模板...</option>
                                            {(templates.filter((t: any) => t.type === "QUIZ_DESIGN") || []).map((t: any) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                                          </select>
                                          {!selectedQuizTemplateId && <div className="mt-2 p-3 bg-yellow-50 rounded-lg text-xs text-yellow-700">提示：还没有作业设计模板？去「模板设置」页面创建一个。</div>}
                                        </div>
                                        <Textarea value={quizDesignTemplateContent} onChange={(v) => setQuizDesignTemplateContent(v)} placeholder="作业设计提示词..." rows={6} />
                                        <div className="flex gap-2">
                                          <Button theme="primary" size="small" icon={<PlayIcon />} loading={generatingQuestions} onClick={handleAIGenerateQuestions} disabled={!quizDesignTitle.trim() || !selectedQuizTemplateId}>生成作业</Button>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="space-y-3">
                                          {quizDesignQuestions.length > 0 && (
                                            <div className="space-y-3">
                                              <div className="text-xs font-medium text-gray-500">题目（共 {quizDesignQuestions.length} 道，可直接修改）</div>
                                              <DndContext sensors={quizSensors} collisionDetection={closestCenter} onDragEnd={handleQuizDragEnd}>
                                                <SortableContext items={quizDesignQuestions.map((_, i) => i)} strategy={verticalListSortingStrategy}>
                                                  {quizDesignQuestions.map((q, idx) => (
                                                    <SortableQuizQuestion
                                                      key={idx}
                                                      q={q}
                                                      idx={idx}
                                                      total={quizDesignQuestions.length}
                                                      onUpdate={(field, value) => {
                                                        const updated = [...quizDesignQuestions];
                                                        updated[idx] = { ...updated[idx], [field]: value };
                                                        setQuizDesignQuestions(updated);
                                                      }}
                                                      onMoveUp={() => {
                                                        if (idx > 0) {
                                                          const updated = [...quizDesignQuestions];
                                                          [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
                                                          setQuizDesignQuestions(updated);
                                                        }
                                                      }}
                                                      onMoveDown={() => {
                                                        if (idx < quizDesignQuestions.length - 1) {
                                                          const updated = [...quizDesignQuestions];
                                                          [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                                                          setQuizDesignQuestions(updated);
                                                        }
                                                      }}
                                                    />
                                                  ))}
                                                </SortableContext>
                                              </DndContext>
                                            </div>
                                          )}
                                          <div className="flex gap-2"><Button theme="primary" size="small" icon={<SaveIcon />} loading={savingQuiz} onClick={handleSaveQuiz}>保存作业</Button></div>
                                        </div>
                                      </>
                                    )}
                                    {generatingQuestions && <div className="text-center py-4 text-sm text-gray-400">AI 正在生成题目，请稍候...</div>}
                                  </div>
                                )}

                                {/* 作业列表 */}
                                {loadingQuizzes ? (
                                  <div className="text-center py-6 text-sm text-gray-400">加载中...</div>
                                ) : quizzes.length === 0 ? (
                                  <div className="text-center py-6 text-sm text-gray-400">暂无作业，点击「新建作业」创建</div>
                                ) : (
                                  <div className="space-y-2">
                                    {quizzes.map((q, qIdx) => (
                                      <div key={q.id} className="bg-white rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            {q.status === "INACTIVE" && <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">失效中</span>}
                                            {q.status === "ACTIVE" && <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">生效中</span>}
                                            <Switch
                                              value={q.status === "ACTIVE"}
                                              size="small"
                                              onChange={(val: boolean) => handleQuizToggle(q, val)}
                                              disabled={operatingQuizId === q.id}
                                            />
                                            <span className="font-medium text-sm text-gray-800">{q.title}</span>
                                            {q.hasAIAnalysis && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">AI 报告</span>}
                                          </div>
                                          <div className="flex gap-1 items-center flex-wrap">
                                            {(() => {
                                              const activeIndices = quizzes.map((q, i) => q.status === "ACTIVE" ? i : -1).filter(i => i >= 0);
                                              const firstActiveIdx = activeIndices[0];
                                              const lastActiveIdx = activeIndices[activeIndices.length - 1];
                                              return q.status === "ACTIVE" && (
                                                <>
                                                  <Button
                                                    theme="default" variant="text" size="small"
                                                    disabled={qIdx === firstActiveIdx}
                                                    onClick={() => handleQuizReorder(q.id, "up", quizPanelSpId!)}
                                                  >
                                                    <ChevronUpIcon />
                                                  </Button>
                                                  <Button
                                                    theme="default" variant="text" size="small"
                                                    disabled={qIdx === lastActiveIdx}
                                                    onClick={() => handleQuizReorder(q.id, "down", quizPanelSpId!)}
                                                  >
                                                    <ChevronDownIcon />
                                                  </Button>
                                                </>
                                              );
                                            })()}
                                            {/* 失效中（INACTIVE）按钮 */}
                                            {q.status === "INACTIVE" && (
                                              <>
                                                <Button theme="primary" variant="text" size="small" onClick={() => startEditQuiz(q)}>快编</Button>
                                                <Button theme="primary" variant="text" size="small" onClick={() => router.push(`/teacher/activities/${quizPanelSpId}/quiz/${q.id}/questions`)}>题目管理</Button>
                                                <Button theme="primary" variant="text" size="small" onClick={() => openQuizPreview(q)}>预览</Button>
                                                {(q._count?.attempts ?? 0) > 0 && (
                                                  <Button theme="warning" variant="text" size="small" loading={clearingAttemptsQuizId === q.id} onClick={() => handleClearAttempts(q.id)}>清除答题</Button>
                                                )}
                                                <Button theme="danger" variant="text" size="small" loading={deletingQuizId === q.id} onClick={() => handleQuizDelete(q.id)}>删除</Button>
                                              </>
                                            )}
                                            
                                            {/* 生效中（ACTIVE）按钮 */}
                                            {q.status === "ACTIVE" && (
                                              <>
                                                <Button theme="primary" variant="text" size="small" onClick={() => router.push(`/teacher/activities/${quizPanelSpId}/quiz/${q.id}/report`)}>查看报告</Button>
                                                <Button theme="primary" variant="text" size="small" onClick={() => openQuizPreview(q)}>预览</Button>
                                                {(q._count?.attempts ?? 0) > 0 && (
                                                  <Button theme="warning" variant="text" size="small" loading={clearingAttemptsQuizId === q.id} onClick={() => handleClearAttempts(q.id)}>清除答题</Button>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-xs text-gray-400">{q.description || "无说明"} · {q.questions?.length || 0}题 · {q._count?.attempts || 0}人已答</div>

                                        {/* 编辑表单 - 就地展开在卡片内 */}
                                        {quizDesignMode && quizDesignId === q.id && (
                                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                                            <div className="flex items-center justify-between">
                                              <h5 className="font-medium text-sm text-[#63666F]">编辑作业</h5>
                                              <Button theme="default" variant="text" size="small" onClick={exitQuizDesign}>× 退出设计</Button>
                                            </div>
                                            <Input value={quizDesignTitle} onChange={(v) => setQuizDesignTitle(v)} placeholder="作业名称 *" size="small" />
                                            <Input value={quizDesignDesc} onChange={(v) => setQuizDesignDesc(v)} placeholder="作业说明（选填）" size="small" />
                                            {quizDesignQuestions.length > 0 && (
                                              <div className="space-y-3">
                                                <div className="text-xs font-medium text-gray-500">题目（共 {quizDesignQuestions.length} 道，可直接修改）</div>
                                                {quizDesignQuestions.map((question, idx) => {
                                                  const options = typeof question.options === "string" ? JSON.parse(question.options || "{}") : (question.options || {});
                                                  return (
                                                    <div key={idx} className="bg-[#F7F8FA] rounded-lg p-3 text-sm">
                                                      <div className="flex items-start gap-2">
                                                        <div className="flex flex-col gap-0.5 p-1">
                                                          <button type="button" onClick={() => { if (idx === 0) return; const updated = [...quizDesignQuestions]; const temp = updated[idx - 1]; updated[idx - 1] = updated[idx]; updated[idx] = temp; setQuizDesignQuestions(updated); }} disabled={idx === 0} className="w-5 h-4 flex items-center justify-center text-blue-600 hover:text-blue-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▲</button>
                                                          <button type="button" onClick={() => { if (idx === quizDesignQuestions.length - 1) return; const updated = [...quizDesignQuestions]; const temp = updated[idx + 1]; updated[idx + 1] = updated[idx]; updated[idx] = temp; setQuizDesignQuestions(updated); }} disabled={idx === quizDesignQuestions.length - 1} className="w-5 h-4 flex items-center justify-center text-blue-600 hover:text-blue-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▼</button>
                                                        </div>
                                                        <span className="font-medium text-gray-500 mt-1">{idx + 1}.</span>
                                                        <div className="flex-1 space-y-2">
                                                          <Input value={question.content} onChange={(v) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], content: v }; setQuizDesignQuestions(updated); }} size="small" />
                                                          <div className="grid grid-cols-2 gap-1">
                                                            {["A", "B", "C", "D"].map((opt) => (
                                                              <div key={opt} className="flex items-center gap-1">
                                                                <span className="text-xs text-gray-400">{opt}.</span>
                                                                <Input value={options[opt] || ""} onChange={(v) => { const updated = [...quizDesignQuestions]; const newOpts = { ...options, [opt]: v }; updated[idx] = { ...updated[idx], options: newOpts }; setQuizDesignQuestions(updated); }} size="small" />
                                                              </div>
                                                            ))}
                                                          </div>
                                                          <div className="flex gap-2 items-center text-xs">
                                                            <span className="text-gray-400">题型：</span>
                                                            <select value={question.type || "SINGLE_CHOICE"} onChange={(e) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], type: e.target.value }; setQuizDesignQuestions(updated); }} className="border rounded px-1 py-0.5">
                                                              <option value="SINGLE_CHOICE">单选</option><option value="MULTIPLE_CHOICE">多选</option><option value="TRUE_FALSE">判断</option>
                                                            </select>
                                                            <span className="text-gray-400 ml-2">答案：</span>
                                                            {question.type === "TRUE_FALSE" ? (
                                                              <select value={question.answer || "T"} onChange={(e) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], answer: e.target.value }; setQuizDesignQuestions(updated); }} className="border rounded px-1 py-0.5">
                                                                <option value="T">正确</option><option value="F">错误</option>
                                                              </select>
                                                            ) : question.type !== "MULTIPLE_CHOICE" ? (
                                                              <select value={question.answer || "A"} onChange={(e) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], answer: e.target.value }; setQuizDesignQuestions(updated); }} className="border rounded px-1 py-0.5">
                                                                <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
                                                              </select>
                                                            ) : (
                                                              <div className="flex gap-2 items-center">
                                                                {["A", "B", "C", "D"].map((opt) => {
                                                                  const correctList = (question.answer || "").split(",").map((s: string) => s.trim()).filter(Boolean);
                                                                  const checked = correctList.includes(opt);
                                                                  return (
                                                                    <label key={opt} className="flex items-center gap-1 cursor-pointer">
                                                                      <input type="checkbox" checked={checked} onChange={() => {
                                                                        const updated = [...quizDesignQuestions];
                                                                        const list = checked ? correctList.filter((s: string) => s !== opt) : [...correctList, opt];
                                                                        updated[idx] = { ...updated[idx], answer: list.join(",") };
                                                                        setQuizDesignQuestions(updated);
                                                                      }} />
                                                                      <span>{opt}</span>
                                                                    </label>
                                                                  );
                                                                })}
                                                              </div>
                                                            )}
                                                            <span className="text-gray-400 ml-2">难度：</span>
                                                            <select value={question.difficulty || "BASIC"} onChange={(e) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], difficulty: e.target.value }; setQuizDesignQuestions(updated); }} className="border rounded px-1 py-0.5">
                                                              <option value="BASIC">基础</option><option value="INTERMEDIATE">提升</option><option value="ADVANCED">拓展</option>
                                                            </select>
                                                          </div>
                                                          <div><span className="text-xs text-gray-400">答案解析</span><Input value={question.explanation || ""} onChange={(v) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], explanation: v }; setQuizDesignQuestions(updated); }} size="small" placeholder="答案解析（可为空）" /></div>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            )}
                                            <div className="flex gap-2 justify-end"><Button theme="primary" size="small" icon={<SaveIcon />} loading={savingQuiz} onClick={handleSaveQuiz}>保存作业</Button></div>
                                          {generatingQuestions && <div className="text-center py-4 text-sm text-gray-400">AI 正在生成题目，请稍候...</div>}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-center py-4 text-sm text-gray-400">暂无作业，点击「新建作业」创建</div>
                            )}
                          </div>

                          {/* 新建作业表单 - 已移到列表顶部 */}
                          </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* 创建/编辑课堂对话框 - 只保留基本信息 */}
        <Dialog
          header={editingTask ? "编辑课堂" : "创建课堂"}
          visible={formVisible}
          onClose={() => { setFormVisible(false); resetForm(); }}
          footer={null}
          width={900}
          destroyOnClose
        >
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1 space-y-4">
                <Input
                  value={formTitle}
                  onChange={(v) => setFormTitle(v)}
                  placeholder="课题（课堂标题）*"
                />
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-700 mb-1">年级 <span className="text-red-500">*</span></label>
                    <Select
                      value={formGrade}
                      onChange={(v) => setFormGrade(v as string)}
                      placeholder="选择年级（必填，用于 AI 生成）"
                      clearable
                      options={[
                        { label: "一年级上学期", value: "一年级上学期" },
                        { label: "一年级下学期", value: "一年级下学期" },
                        { label: "二年级上学期", value: "二年级上学期" },
                        { label: "二年级下学期", value: "二年级下学期" },
                        { label: "三年级上学期", value: "三年级上学期" },
                        { label: "三年级下学期", value: "三年级下学期" },
                        { label: "四年级上学期", value: "四年级上学期" },
                        { label: "四年级下学期", value: "四年级下学期" },
                        { label: "五年级上学期", value: "五年级上学期" },
                        { label: "五年级下学期", value: "五年级下学期" },
                        { label: "六年级上学期", value: "六年级上学期" },
                        { label: "六年级下学期", value: "六年级下学期" },
                        { label: "七年级上学期", value: "七年级上学期" },
                        { label: "七年级下学期", value: "七年级下学期" },
                        { label: "八年级上学期", value: "八年级上学期" },
                        { label: "八年级下学期", value: "八年级下学期" },
                        { label: "九年级上学期", value: "九年级上学期" },
                        { label: "九年级下学期", value: "九年级下学期" },
                        { label: "高中一年级上学期", value: "高中一年级上学期" },
                        { label: "高中一年级下学期", value: "高中一年级下学期" },
                        { label: "高中二年级上学期", value: "高中二年级上学期" },
                        { label: "高中二年级下学期", value: "高中二年级下学期" },
                        { label: "高中三年级上学期", value: "高中三年级上学期" },
                        { label: "高中三年级下学期", value: "高中三年级下学期" },
                      ]}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-700 mb-1">学科 <span className="text-red-500">*</span></label>
                    <Select
                      value={formSubject}
                      onChange={(v) => setFormSubject(v as string)}
                      placeholder="选择学科（必填，用于 AI 生成）"
                      clearable
                      options={[
                        { label: "语文", value: "语文" },
                        { label: "数学", value: "数学" },
                        { label: "英语", value: "英语" },
                        { label: "道德与法治", value: "道德与法治" },
                        { label: "科学", value: "科学" },
                        { label: "物理", value: "物理" },
                        { label: "化学", value: "化学" },
                        { label: "生物学", value: "生物学" },
                        { label: "历史", value: "历史" },
                        { label: "地理", value: "地理" },
                        { label: "思想政治", value: "思想政治" },
                        { label: "信息科技", value: "信息科技" },
                        { label: "信息技术", value: "信息技术" },
                        { label: "通用技术", value: "通用技术" },
                        { label: "体育与健康", value: "体育与健康" },
                        { label: "艺术", value: "艺术" },
                        { label: "音乐", value: "音乐" },
                        { label: "美术", value: "美术" },
                        { label: "劳动", value: "劳动" },
                        { label: "综合实践活动", value: "综合实践活动" },
                        { label: "书法", value: "书法" },
                        { label: "班团队活动", value: "班团队活动" },
                      ]}
                    />
                  </div>
                </div>
                <label className="block text-sm text-gray-700 mb-1">课堂目标 <span className="text-red-500">*</span></label>
                <Textarea
                  value={formDescription}
                  onChange={(v) => setFormDescription(v)}
                  placeholder="课堂目标（必填，用于 AI 生成）"
                  rows={3}
                />
              </div>

              <div className="flex-1 space-y-4">
              {/* 个人学情分析提示词 */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-[#63666F]">个人学情分析提示词</h4>
                  <div className="flex gap-2 items-center">
                    <select
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9]"
                      value=""
                      onChange={(e) => {
                        const content = getTemplateContent(e.target.value);
                        if (content) {
                          setFormAnalysisPrompt(content);
                        }
                      }}
                    >
                      <option value="">选择个人学情模板填充...</option>
                      {templates.filter(t => t.type === "student").map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9]"
                    value={formAnalysisPrompt || editingTask?.analysisPrompt || ""}
                    onChange={(e) => {
                      setFormAnalysisPrompt(e.target.value);
                    }}
                    placeholder="个人学情分析提示词，选择模板即填充"
                    rows={4}
                  />
                </div>

                {/* 全班学情分析提示词 */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-[#63666F]">全班学情分析提示词</h4>
                  <div className="flex gap-2 items-center">
                    <select
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9]"
                      value=""
                      onChange={(e) => {
                        const content = getTemplateContent(e.target.value);
                        if (content) {
                          setFormClassAnalysisPrompt(content);
                        }
                      }}
                    >
                      <option value="">选择全班学情模板填充...</option>
                      {templates.filter(t => t.type === "class").map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9]"
                    value={formClassAnalysisPrompt || (editingTask as any)?.classAnalysisPrompt || ""}
                    onChange={(e) => {
                      setFormClassAnalysisPrompt(e.target.value);
                    }}
                    placeholder="全班学情分析提示词，选择模板即填充"
                    rows={4}
                  />
                </div>
              </div>
            </div>

            {/* 分配班级 */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-[#63666F]">分配班级（必选）</h4>
              <div className="flex flex-wrap gap-2">
                {classes.map((cls) => (
                  <Tag
                    key={cls.id}
                    theme={formClassIds.includes(cls.id) ? "primary" : "default"}
                    variant={formClassIds.includes(cls.id) ? "dark" : "light"}
                    className="cursor-pointer"
                    onClick={() => toggleClass(cls.id)}
                  >
                    {cls.name}
                  </Tag>
                ))}
                {classes.length === 0 && (
                  <span className="text-sm text-gray-400">请先创建班级</span>
                )}
              </div>
            </div>

            {/* 引用知识库 */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-[#63666F]">引用知识库（选填）</h4>
              <div className="flex flex-wrap gap-2">
                {knowledgeBases.map((kb) => (
                  <Tag
                    key={kb.id}
                    theme={selectedKbIds.includes(kb.id) ? "primary" : "default"}
                    variant={selectedKbIds.includes(kb.id) ? "dark" : "light"}
                    className="cursor-pointer"
                    onClick={() => toggleKbSelection(kb.id)}
                  >
                    {kb.name}（{kb.contentLength.toLocaleString()}字）
                  </Tag>
                ))}
                {knowledgeBases.length === 0 && (
                  <span className="text-sm text-gray-400">
                    暂无知识库，请先到「知识库」页面创建
                  </span>
                )}
              </div>
              {/* 已选知识库总量进度条 */}
              {selectedKbIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <Progress
                    status={getSelectedKbTotalLength(selectedKbIds) > 50000 ? "warning" : "success"}
                    percentage={Math.min(100, Math.round((getSelectedKbTotalLength(selectedKbIds) / 50000) * 100))}
                    size="small"
                    style={{ width: 120 }}
                    label={false}
                  />
                  <span className={`text-xs ${getSelectedKbTotalLength(selectedKbIds) > 50000 ? "text-red-500 font-medium" : "text-[#63666F]"}`}>
                    已选 {getSelectedKbTotalLength(selectedKbIds).toLocaleString()} / 50,000 字符
                    {getSelectedKbTotalLength(selectedKbIds) > 50000 && " ⚠ 超出限制"}
                  </span>
                </div>
              )}
              <p className="text-xs text-gray-400">
                选择后，该课堂下所有对话活动将自动注入所选知识库的全文内容，总字符数不超过 50,000
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
              <Button onClick={() => { setFormVisible(false); resetForm(); }}>取消</Button>
              <Button theme="primary" loading={saving} onClick={handleSave}>
                {editingTask ? "保存修改" : "创建课堂"}
              </Button>
            </div>
          </div>
        </Dialog>

        {/* 删除确认 */}
        <Dialog
          header="删除课堂"
          visible={deleteVisible}
          onClose={() => { setDeleteVisible(false); setDeleteTaskId(null); }}
          footer={null}
        >
          <div className="space-y-4">
            <p>确定要删除此课堂吗？所有对话活动将一并删除。</p>
            <p className="text-sm text-red-600 font-medium">此操作不可撤销！</p>
            <div className="flex gap-2 justify-end">
              <Button onClick={() => { setDeleteVisible(false); setDeleteTaskId(null); }}>取消</Button>
              <Button theme="danger" loading={saving} onClick={handleDelete}>确认删除</Button>
            </div>
          </div>
        </Dialog>

        {/* 清理对话记录 */}
        <Dialog
          header="清理对话记录"
          visible={clearVisible}
          onClose={() => { setClearVisible(false); setClearTaskId(null); }}
          footer={null}
        >
          {clearTaskId && (() => {
            const task = tasks.find((t) => t.id === clearTaskId);
            return (
              <div className="space-y-4">
                <p className="text-gray-600">
                  选择要清理对话记录的班级。选择「全部」将清理此课堂下所有班级的学生对话记录。
                </p>
                <Select
                  value={clearClassId || ""}
                  onChange={(val) => setClearClassId(val as string || null)}
                  options={[
                    { label: "全部班级", value: "" },
                    ...(task?.assignments.map((a) => ({
                      label: a.class.name,
                      value: a.classId,
                    })) || []),
                  ]}
                  placeholder="选择班级"
                  style={{ width: "100%" }}
                />
                <div className="bg-yellow-50 rounded-lg p-3 text-sm text-yellow-700">
                  <p className="font-medium mb-1">⚠️ 注意事项</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>此操作将删除选中国生的所有对话记录和消息</li>
                    <li>AI 学情分析结果将保留</li>
                    <li>此操作不可撤销！</li>
                  </ul>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button onClick={() => { setClearVisible(false); setClearTaskId(null); }}>取消</Button>
                  <Button theme="warning" loading={clearLoading} onClick={handleClearConversations}>
                    确认清理
                  </Button>
                </div>
              </div>
            );
          })()}
        </Dialog>

        {/* 作业分析弹窗 */}
        <Dialog
          header="作业完成情况分析"
          visible={quizAnalysisVisible}
          onClose={closeQuizAnalysis}
          footer={null}
          width={900}
          destroyOnClose
        >
          {quizAnalysisLoading ? (
            <div className="text-center py-8 text-sm text-gray-400">加载中...</div>
          ) : quizAnalysisData ? (
            <div className="space-y-4">
              {/* 班级选择 */}
              {quizAnalysisData.classIds && quizAnalysisData.classIds.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-500">班级：</span>
                  {quizAnalysisData.classIds.map((cid: string) => {
                    const cls = classes.find(c => c.id === cid);
                    return (
                      <Tag
                        key={cid}
                        theme={quizAnalysisClassId === cid ? "primary" : "default"}
                        variant={quizAnalysisClassId === cid ? "dark" : "light"}
                        className="cursor-pointer"
                        onClick={async () => {
                          setQuizAnalysisClassId(cid);
                          setQuizAnalysisLoading(true);
                          const token = localStorage.getItem("token") || "";
                          const res = await fetch(`/api/quiz-activities/${quizAnalysisId}/report?classId=${cid}`, {
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          if (res.ok) {
                            setQuizAnalysisData(await res.json());
                          }
                          setQuizAnalysisLoading(false);
                        }}
                      >{cls ? cls.name : cid}</Tag>
                    );
                  })}
                </div>
              )}
              {/* 基础统计 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">{quizAnalysisData.totalStudents || 0}</div>
                  <div className="text-xs text-blue-500">作答人数</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{quizAnalysisData.classAvgScore || 0}</div>
                  <div className="text-xs text-green-500">班级均分</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-orange-600">{quizAnalysisData.questionStats?.length || 0}</div>
                  <div className="text-xs text-orange-500">总题数</div>
                </div>
              </div>

              {/* 分数分布柱状图 */}
              {quizAnalysisData.scoreBuckets && quizAnalysisData.scoreBuckets.some((b: any) => b.count > 0) && (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">分数分布</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={quizAnalysisData.scoreBuckets} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <RechartsTooltip formatter={(val) => `${val} 人`} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 题目正确率柱状图 */}
              {quizAnalysisData.questionStats && quizAnalysisData.questionStats.length > 0 ? (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">各题正确率</div>
                  <ResponsiveContainer width="100%" height={Math.max(120, quizAnalysisData.questionStats.length * 36)}>
                    <BarChart
                      data={quizAnalysisData.questionStats.map((qs: any, idx: number) => ({
                        name: `题${idx + 1}`,
                        fullName: qs.content,
                        rate: qs.correctRate,
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 40, left: 40, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={30} />
                      <RechartsTooltip
                        formatter={(val) => [`${val}%`, "正确率"]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName?.substring(0, 30) || ""}
                      />
                      <Bar dataKey="rate" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center py-4 text-sm text-gray-400">暂无作答数据</div>
              )}

              {/* 难度维度饼图 */}
              {quizAnalysisData.difficultyStats && quizAnalysisData.difficultyStats.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">各难度正确率</div>
                  <div className="flex justify-center">
                    <ResponsiveContainer width={240} height={180}>
                      <PieChart>
                        <Pie
                          data={quizAnalysisData.difficultyStats.map((d: any, idx: number) => ({
                            ...d,
                            fill: ["#3b82f6", "#22c55e", "#f59e0b"][idx],
                          }))}
                          dataKey="correctRate"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={60}
                          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                          labelLine={false}
                        />
                        <RechartsTooltip formatter={(val) => `${val}%`} />
                        <Legend fontSize={12} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* 薄弱题目 / 低分学生 */}
              {quizAnalysisData.weakQuestions && quizAnalysisData.weakQuestions !== "" && (
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-sm font-medium text-red-600 mb-1">薄弱题目（正确率&lt;60%）</div>
                  <div className="text-xs text-red-700 whitespace-pre-line">{quizAnalysisData.weakQuestions}</div>
                </div>
              )}
              {quizAnalysisData.lowScoreStudents && quizAnalysisData.lowScoreStudents !== "" && (
                <div className="bg-orange-50 rounded-lg p-3">
                  <div className="text-sm font-medium text-orange-600 mb-1">低分学生（&lt;60分）</div>
                  <div className="text-xs text-orange-700 whitespace-pre-line">{quizAnalysisData.lowScoreStudents}</div>
                </div>
              )}

              {/* AI 分析 */}
              <div className="flex items-center justify-between gap-2">
                
                <Button
                  theme="primary"
                  size="small"
                  loading={quizAnalysisGenerating}
                  onClick={() => {
                    console.log("AI分析按钮点击", quizAnalysisData?.quizId);
                    generateQuizAIAnalysis(quizAnalysisData?.quizId);
                  }}
                >
                  {quizAnalysisData?.aiContent ? "重新分析" : "AI 分析"}
                </Button>
              </div>

              <div ref={quizAIRef}>
                {quizAnalysisData.aiContent ? (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-sm font-medium text-gray-600 mb-1">AI 分析报告</div>
                    <div className="text-sm text-gray-700 whitespace-pre-line">{quizAnalysisData.aiContent}</div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-xs text-gray-400">AI 分析生成中...</div>
                )}
              </div>

              <div className="flex justify-end">
                <Button size="small" onClick={closeQuizAnalysis}>关闭</Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">加载失败</div>
          )}
        </Dialog>

        {/* 互动探究 - 新建/编辑弹窗 */}
        <Dialog
          header={explorationEditId ? "编辑互动设计提示词" : "新建互动探究"}
          visible={explorationModalVisible}
          onClose={() => setExplorationModalVisible(false)}
          footer={null}
          width={720}
          destroyOnClose
        >
          <div className="space-y-4">
            {/* 标题 */}
            <Input
              value={explorationTitle}
              onChange={(v) => setExplorationTitle(v)}
              placeholder="探究标题"
            />

            {/* 互动设计提示词 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">编辑互动设计提示词</span>
                <Button
                  theme="primary" variant="outline" size="small"
                  loading={generatingPrompt}
                  onClick={autoGeneratePrompt}
                >
                  生成提示词
                </Button>
              </div>
              <Textarea
                value={explorationDesignPrompt}
                onChange={(v) => setExplorationDesignPrompt(v)}
                placeholder="描述你想要生成的互动学习网页：主题、互动机制、视觉风格、题目内容等"
                rows={5}
              />
            </div>

            {/* 生成网页 / 上传HTML */}
            <div className="flex gap-2">
              <Button
                theme="primary"
                size="small"
                icon={<PlayIcon />}
                loading={generatingHtml}
                onClick={handleGenerateHtml}
                disabled={!explorationDesignPrompt.trim()}
              >
                生成网页
              </Button>
              <Button
                theme="default"
                variant="outline"
                size="small"
                icon={<FileIcon />}
                onClick={handleUploadHtml}
              >
                上传HTML
              </Button>
              <Button
                theme="default"
                variant="outline"
                size="small"
                icon={<FileIcon />}
                onClick={() => {
                  if (!explorationHtml.trim()) {
                    MessagePlugin.warning("请先生成或上传 HTML 内容");
                    return;
                  }
                  // 通过 spId 查找课堂信息
                  let taskGrade = "未知年级";
                  let taskSubject = "未知学科";
                  let taskTitle = "未知课题";
                  try {
                    const spTask = tasks.find(t => t.subProjects.some(sp => sp.id === explorationPanelSpId));
                    if (spTask) {
                      taskGrade = spTask.grade || "未知年级";
                      taskSubject = spTask.subject || "未知学科";
                      taskTitle = spTask.title;
                    }
                  } catch {}
                  const safeName = (s: string) => s.replace(/[\\/:*?"<>|，。、？！：；【】（）""''\s]/g, "_");
                  const filename = [safeName(taskTitle), safeName(taskGrade), safeName(taskSubject), safeName(explorationTitle)].join("_") + ".html";
                  const blob = new Blob([explorationHtml], { type: "text/html;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = filename;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                导出 HTML
              </Button>
            </div>

            {/* 效果预览 + 源代码左右并排 */}
            {explorationPreview && (
              <div className="flex gap-3">
                {/* 左侧：效果预览 */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600">效果预览</span>
                    <Button theme="default" variant="text" size="small" onClick={() => openPreview(explorationPreview)}>
                      全屏预览
                    </Button>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ height: 360 }}>
                    <iframe srcDoc={explorationPreview} className="w-full h-full" sandbox="allow-scripts" title="预览" />
                  </div>
                </div>

                {/* 右侧：源代码编辑（仅在有内容时显示） */}
                {explorationHtml && (
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">源代码</span>
                      <span className="text-xs text-gray-400">修改即时同步到预览</span>
                    </div>
                    <Textarea
                      value={explorationHtml}
                      onChange={(v) => { setExplorationHtml(v); setExplorationPreview(v); }}
                      placeholder="HTML 源代码，可在此直接修改"
                      rows={16}
                      className="font-mono text-xs"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 启用提交功能 */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600">启用提交</span>
                <Switch
                  value={explorationEnableSubmission}
                  size="small"
                  onChange={async (val: boolean) => {
                    if (val) {
                      // 开启 → 保存当前 HTML → 立即弹出预览
                      setOriginalHtmlForInjection(explorationHtml);
                      syncConfirmedInjection(false);
                      // 立即调用预览 API 并弹出对话框
                      setPreviewLoading(true);
                      setPreviewError(null);
                      setPreviewAnalysis(null);
                      setAutoScoreScript(null);
                      setPreviewStatus("正在向 AI 发送 HTML 代码...");
                      setInjectionPreviewVisible(true);
                      try {
                        const token = localStorage.getItem("token") || "";
                        const res = await fetch("/api/exploration-activities/preview-injection", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                          body: JSON.stringify({
                            htmlContent: explorationHtml,
                            explorationId: explorationEditId || undefined,
                            subProjectId: explorationPanelSpId,
                          }),
                        });
                        let data;
                        try { data = await res.json(); } catch { data = null; }
                        if (data && data.success) {
                          setPreviewAnalysis(data.analysis);
                          setAutoScoreScript(data.autoScoreScript || null);
                        } else {
                          setPreviewError((data && data.error) || "分析失败");
                          if (data && data.fallback) setPreviewAnalysis(data.fallback);
                        }
                      } catch (e: any) {
                        setPreviewError(e.message || "预览失败");
                      } finally {
                        setPreviewLoading(false);
                      }
                    } else {
                      // 关闭 → 撤销注入并预览
                      if (explorationHasSubmissions) {
                        MessagePlugin.warning("已有学生提交，无法关闭启用提交");
                        return;
                      }
                      const cleanedHtml = removeSubmitFunctionality(explorationHtml);
                      setExplorationHtml(cleanedHtml);
                      setExplorationPreview(cleanedHtml);
                      setExplorationEnableSubmission(false);
                      syncConfirmedInjection(false);
                    }
                  }}
                />
              </div>
              {confirmedInjection ? (
                <div className="text-xs text-green-600 bg-green-50 rounded p-2">
                  ✓ 已确认注入提交功能，点击保存即可生效。
                </div>
              ) : explorationEnableSubmission ? (
                <div className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                  为互动探究的HTML注入提交功能，采集学生互动探究过程的数据用于分析，这是测试功能，未必成功。
                </div>
              ) : (
                <div className="text-xs text-gray-400 bg-gray-50 rounded p-2">
                  纯展示模式，学生只能浏览互动内容，无法提交成绩。
                </div>
              )}
            </div>

            {/* AI伴学功能 */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-600">AI伴学</span>
                  <Switch
                    value={explorationEnableAiCompanion}
                    size="small"
                    disabled={!explorationHtml.trim() || aiCompanionStatus === "analyzing"}
                    onChange={handleAiCompanionToggle}
                  />
                  {aiCompanionStatus === "analyzing" && (
                    <span className="text-xs text-orange-500 flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                      正在分析交互内容，生成指导策略...
                    </span>
                  )}
                  {aiCompanionStatus === "ready" && explorationEnableAiCompanion && (
                    <span className="text-xs text-green-600">✓ AI伴学已就绪</span>
                  )}
                  {aiCompanionStatus === "error" && (
                    <span className="text-xs text-red-500">✗ 生成失败</span>
                  )}
                  {!explorationEnableAiCompanion && aiCompanionPromptText && (
                    <span className="text-xs text-gray-500">提示词已保留（再次启用秒开）</span>
                  )}
                </div>
                {explorationEditId && aiCompanionPromptText && (
                  <Button
                    size="small"
                    variant="text"
                    theme="danger"
                    onClick={handleResetAiCompanionPrompt}
                    disabled={aiCompanionStatus === "analyzing"}
                  >
                    重置提示词
                  </Button>
                )}
              </div>
              {explorationEnableAiCompanion ? (
                <>
                  <div className="text-xs text-purple-700 bg-purple-50 rounded p-2">
                    学生可在互动页面右下角看到"AI伴学"按钮，可随时提问获取AI指导。
                    AI会先分析完整HTML内容生成指导策略，再结合实时页面状态回答。
                  </div>
                  {explorationEditId && (
                    <Button
                      size="small"
                      variant="text"
                      theme="primary"
                      onClick={() => setShowAiCompanionPrompt(true)}
                      disabled={!aiCompanionPromptText}
                    >
                      查看/编辑伴学提示词
                    </Button>
                  )}
                </>
              ) : (
                <div className="text-xs text-gray-400 bg-gray-50 rounded p-2">
                  {aiCompanionPromptText
                    ? "关闭后学生无法使用AI伴学功能（已生成的提示词会保留，再次启用时秒开）。"
                    : "关闭后学生无法使用AI伴学功能。"}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button onClick={() => setExplorationModalVisible(false)}>取消</Button>
              <Button
                theme="primary"
                loading={savingExploration}
                onClick={handleSaveExploration}
                disabled={!explorationTitle.trim() || !explorationHtml.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </Dialog>

        {/* 互动探究 - 注入预览确认弹窗 */}
        <Dialog
          header="提交功能预览"
          visible={injectionPreviewVisible}
          onClose={() => {
            setInjectionPreviewVisible(false);
            // 用 ref 读取真实值，避免 React 闭包捕获到旧 state
            if (confirmedInjectionRef.current) {
              setPreviewAnalysis(null);
              setPreviewError(null);
              setAutoScoreScript(null);
              return;
            }
            // 关闭时恢复原始状态
            setExplorationEnableSubmission(false);
            syncConfirmedInjection(false);
            if (originalHtmlForInjection) {
              setExplorationHtml(originalHtmlForInjection);
              setExplorationPreview(originalHtmlForInjection);
            }
            setPreviewAnalysis(null);
            setPreviewError(null);
          }}
          width={680}
          destroyOnClose
          footer={
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setInjectionPreviewVisible(false);
                  // 取消注入，恢复原始 HTML
                  setExplorationEnableSubmission(false);
                  syncConfirmedInjection(false);
                  if (originalHtmlForInjection) {
                    setExplorationHtml(originalHtmlForInjection);
                    setExplorationPreview(originalHtmlForInjection);
                  }
                  setPreviewAnalysis(null);
                  setPreviewError(null);
                }}
              >
                取消注入
              </Button>
              <Button
                theme="primary"
                onClick={() => {
                  // 确认注入 → 调用注入函数修改 HTML
                  const result = injectSubmitFunctionality(explorationHtml, {
                    explorationId: explorationEditId || "",
                    taskTitle: "",
                  });
                  // 暂时跳过自动评分脚本注入，先用基础跟踪和提交功能
                  let finalHtml = result.html;
                  setExplorationHtml(finalHtml);
                  setExplorationPreview(finalHtml);
                  setExplorationEnableSubmission(true);
                  syncConfirmedInjection(true);
                  if (result.warnings.length > 0) {
                    result.warnings.forEach((w: string) => MessagePlugin.warning(w));
                  } else {
                    MessagePlugin.success("提交功能已注入");
                  }
                  setInjectionPreviewVisible(false);
                  setPreviewAnalysis(null);
                  setPreviewError(null);
                  setAutoScoreScript(null);
                }}
              >
                确认注入
              </Button>
            </div>
          }
        >
          {previewLoading ? (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
              <div className="text-sm text-gray-500">{previewStatus || "正在分析..."}</div>
              <div className="text-xs text-gray-300 mt-2">AI 分析可能需要 10-30 秒</div>
            </div>
          ) : previewError ? (
            <div className="space-y-3">
              <div className="text-sm text-yellow-600 bg-yellow-50 rounded p-3">
                ⚠️ {previewError}
              </div>
              <div className="text-xs text-gray-400">
                将使用基础追踪方案（点击次数、停留时间、滚动深度）。继续注入？
              </div>
            </div>
          ) : previewAnalysis ? (
            <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-2">

              {/* AI 总结 */}
              <div className="text-sm text-gray-700 bg-blue-50 rounded p-3 leading-relaxed">
                {previewAnalysis.summary || "AI 分析完成，请确认以下采集项"}
              </div>

              {/* 固定采集项 */}
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">📊 提交后可查看的数据</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "停留时间", desc: "学生在页面上花费的时长" },
                    { label: "互动次数", desc: "学生的点击总次数" },
                    { label: "滚动深度", desc: "学生浏览页面的程度" },
                    { label: "完成环节", desc: "学生完成了哪些部分" },
                    { label: "最终得分", desc: "学生提交时的成绩" },
                    { label: "操作记录", desc: "学生的具体操作步骤" },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded px-3 py-2">
                      <div className="text-xs font-medium text-gray-700">{item.label}</div>
                      <div className="text-xs text-gray-400">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 页面互动元素 */}
              {previewAnalysis.interactiveElements?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">🔗 页面中的互动元素</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-100 rounded p-2">
                    {previewAnalysis.interactiveElements.slice(0, 20).map((el: any, i: number) => {
                      const name = typeof el === "object" ? (el.element || el.name || el.description || "?") : String(el);
                      const desc = typeof el === "object" ? (el.description || "") : "";
                      return (
                        <div key={i} className="text-xs text-gray-600 flex gap-2 py-0.5">
                          <span className="text-blue-400 shrink-0">•</span>
                          <span className="font-medium shrink-0">{name}</span>
                          {desc && <span className="text-gray-400 truncate">{desc}</span>}
                        </div>
                      );
                    })}
                    {previewAnalysis.interactiveElements.length > 20 && (
                      <div className="text-xs text-gray-400 pt-1">
                        还有 {previewAnalysis.interactiveElements.length - 20} 个元素未显示
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 注意事项 */}
              {previewAnalysis.warnings?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-yellow-600 mb-2">⚠️ 注意事项</div>
                  <div className="space-y-1">
                    {previewAnalysis.warnings.map((w: any, i: number) => (
                      <div key={i} className="text-xs text-yellow-700 bg-yellow-50 rounded px-3 py-2 leading-relaxed">
                        {typeof w === "string" ? w : JSON.stringify(w)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-gray-400 pt-2 border-t leading-relaxed">
                确认后，系统将为此 HTML 注入提交按钮和追踪脚本。学生提交后可查看完整行为数据。
              </div>
            </div>
          ) : null}
        </Dialog>
        <Dialog
          header="探究预览"
          visible={previewModalVisible}
          onClose={() => setPreviewModalVisible(false)}
          footer={null}
          width={900}
          destroyOnClose
        >
          <div style={{ height: "70vh" }}>
            <iframe
              srcDoc={previewHtml}
              className="w-full h-full"
              sandbox="allow-scripts"
              title="探究预览"
            />
          </div>
        </Dialog>

        {/* 作业预览弹窗 - 模拟学生答题界面（只读，不能提交，只有上一题/下一题） */}
        <Dialog
          header={`作业预览：${quizPreviewData?.title || ""}`}
          visible={quizPreviewVisible}
          onClose={closeQuizPreview}
          footer={null}
          width={780}
          destroyOnClose
        >
          {quizPreviewData && quizPreviewData.questions.length > 0 ? (
            <div className="flex flex-col" style={{ height: "70vh" }}>
              {/* 顶部进度 */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#FAFBFC] border-b border-gray-200">
                <div className="text-sm text-[#63666F]">
                  第 {quizPreviewIndex + 1} / {quizPreviewData.questions.length} 题
                </div>
                <div className="text-xs text-gray-400">
                  已答 {Object.keys(quizPreviewAnswers).length} / {quizPreviewData.questions.length}
                </div>
              </div>

              {/* 题目内容区 */}
              <div className="flex-1 overflow-y-auto p-6">
                {(() => {
                  const q = quizPreviewData.questions[quizPreviewIndex];
                  const options = typeof q.options === "string" ? JSON.parse(q.options || "{}") : (q.options || {});
                  const userAns = quizPreviewAnswers[q.id];
                  return (
                    <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-[#0052D9]">
                      <div className="flex items-start gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold bg-[#0052D9] text-white">
                          {quizPreviewIndex + 1}
                        </div>
                        <div className="flex-1">
                          <div className="text-base font-medium text-[#1A1A1A]">{q.content}</div>
                        </div>
                      </div>
                      <div className="space-y-3 ml-11">
                        {q.type === "TRUE_FALSE" ? (
                          <>
                            {["T", "F"].map((k) => {
                              const label = k === "T" ? "正确" : "错误";
                              // 兼容 "T"/"F" 或 "true"/"false" 格式
                              const rawAnswer = (q.answer || "").toString().toLowerCase();
                              const answerNorm = rawAnswer === "true" ? "T" : rawAnswer === "false" ? "F" : rawAnswer.toUpperCase();
                              const isCorrect = answerNorm === k;
                              const isSelected = userAns === k;
                              let bgClass = "bg-gray-50";
                              if (isCorrect) bgClass = "bg-green-50 border border-green-200";
                              else if (isSelected && !isCorrect) bgClass = "bg-red-50 border border-red-200";
                              return (
                                <div key={k} className={`flex items-center gap-3 p-4 rounded-lg transition-all ${bgClass}`}>
                                  <span className={`text-sm font-medium w-6 ${
                                    isCorrect ? "text-green-600" : isSelected ? "text-red-500" : "text-gray-400"
                                  }`}>{k === "T" ? "T" : "F"}.</span>
                                  <span className={`text-sm flex-1 ${
                                    isCorrect ? "text-green-700" : isSelected ? "text-red-700" : "text-gray-600"
                                  }`}>{label}</span>
                                  {isSelected && !isCorrect && <span className="ml-auto text-xs text-red-400">你的答案</span>}
                                  {isCorrect && <span className="ml-auto text-xs text-green-500">正确答案</span>}
                                </div>
                              );
                            })}
                          </>
                        ) : (
                          Object.entries(options).map(([k, v]) => {
                            const isMulti = q.type === "MULTIPLE_CHOICE";
                            const selectedList = userAns ? userAns.split(",") : [];
                            const correctList = (q.answer || "").split(",").map((s: string) => s.trim()).filter(Boolean);
                            const isSelected = isMulti ? selectedList.includes(k) : userAns === k;
                            const isCorrect = isMulti ? correctList.includes(k) : q.answer === k;
                            let bgClass = "bg-gray-50";
                            if (isCorrect) bgClass = "bg-green-50 border border-green-200";
                            else if (isSelected && !isCorrect) bgClass = "bg-red-50 border border-red-200";
                            return (
                              <div
                                key={k}
                                className={`flex items-center gap-3 p-4 rounded-lg transition-all ${bgClass}`}
                              >
                                <span className={`text-sm font-medium w-6 ${
                                  isCorrect ? "text-green-600" : isSelected ? "text-red-500" : "text-gray-400"
                                }`}>{k}.</span>
                                <span className={`text-sm flex-1 ${
                                  isCorrect ? "text-green-700" : isSelected ? "text-red-700" : "text-gray-600"
                                }`}>{v as React.ReactNode}</span>
                                {isSelected && !isCorrect && <span className="ml-auto text-xs text-red-400">你的答案</span>}
                                {isCorrect && <span className="ml-auto text-xs text-green-500">正确答案</span>}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* 底部导航栏 */}
              <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-[#FAFBFC]">
                <Button
                  variant="outline"
                  size="large"
                  onClick={() => setQuizPreviewIndex((i) => Math.max(0, i - 1))}
                  disabled={quizPreviewIndex === 0}
                >
                  上一题
                </Button>
                <div className="text-sm text-gray-400">
                  {quizPreviewIndex === quizPreviewData.questions.length - 1 ? "（最后一题）" : ""}
                </div>
                <Button
                  variant="outline"
                  size="large"
                  onClick={() => setQuizPreviewIndex((i) => Math.min(quizPreviewData.questions.length - 1, i + 1))}
                  disabled={quizPreviewIndex === quizPreviewData.questions.length - 1}
                >
                  下一题
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">暂无题目</div>
          )}
        </Dialog>

        {/* 互动探究 - 分析弹窗 */}
        <Dialog
          header="探究分析报告"
          visible={analysisModalVisible}
          onClose={() => setAnalysisModalVisible(false)}
          footer={null}
          width={680}
          destroyOnClose
        >
          {loadingAnalysis ? (
            <div className="text-center py-8 text-sm text-gray-400">加载中...</div>
          ) : analysisData ? (
            <div className="space-y-4">
              {/* 班级选择 */}
              {analysisData.classIds && analysisData.classIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">班级：</span>
                  <div className="flex flex-wrap gap-2">
                    {analysisData.classIds.map((cid: string) => {
                      const cls = classes.find(c => c.id === cid);
                      return (
                        <Tag
                          key={cid}
                          theme={analysisClassId === cid ? "primary" : "default"}
                          variant={analysisClassId === cid ? "dark" : "light"}
                          className="cursor-pointer"
                          onClick={async () => {
                            setAnalysisClassId(cid);
                            setLoadingAnalysis(true);
                            const token = localStorage.getItem("token");
                            const res = await fetch(`/api/exploration-activities/${analysisExplorationId}/analysis?classId=${cid}`, {
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (res.ok) {
                              setAnalysisData(await res.json());
                            }
                            setLoadingAnalysis(false);
                          }}
                        >{cls ? cls.name : cid}</Tag>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* 概览 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700">{analysisData.submittedCount || 0}</div>
                  <div className="text-xs text-blue-500">已提交</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-700">{analysisData.averageScore || 0}</div>
                  <div className="text-xs text-green-500">平均分</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-orange-700">{analysisData.totalStudents || 0}</div>
                  <div className="text-xs text-orange-500">班级人数</div>
                </div>
              </div>

              {/* 行为数据统计 */}
              {(analysisData.avgTimeSpent > 0 || analysisData.avgInteractions > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-purple-700">{analysisData.avgTimeSpent}</div>
                    <div className="text-xs text-purple-500">平均停留（秒）</div>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-indigo-700">{analysisData.avgInteractions}</div>
                    <div className="text-xs text-indigo-500">平均互动次数</div>
                  </div>
                </div>
              )}

              {/* 操作类型统计 */}
              {analysisData.actionTypeStats && Object.keys(analysisData.actionTypeStats).length > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">操作类型统计</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(analysisData.actionTypeStats).map(([type, count]) => (
                      <div key={type} className="bg-gray-50 rounded-full px-3 py-1 text-xs">
                        <span className="text-gray-500">{type}</span>
                        <span className="ml-1 font-medium text-gray-700">{String(count)}次</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 分数分布 */}
              {analysisData.scoreDistribution && (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">分数分布</div>
                  <div className="space-y-1">
                    {Object.entries(analysisData.scoreDistribution).map(([range, count]) => (
                      <div key={range} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-gray-500">{range}分</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div
                            className="bg-blue-400 rounded-full h-2"
                            style={{ width: `${Math.min(((count as number) / Math.max(analysisData.submittedCount, 1)) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-600 w-4">{String(count)}人</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 提交记录 */}
              {analysisData.studentRecords && analysisData.studentRecords.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">提交记录</div>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {analysisData.studentRecords.map((record: any, idx: number) => (
                      <div key={idx} className="border border-gray-100 rounded-lg p-3 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-700">{record.studentName || record.studentId}</span>
                          <span className="text-gray-400">{new Date(record.submittedAt).toLocaleString()}</span>
                        </div>
                        <div className="flex gap-4 text-gray-500">
                          <span>得分：<span className="text-orange-600 font-medium">{record.score}/{record.maxScore}</span></span>
                          <span>停留：<span className="text-gray-600">{record.timeSpent}秒</span></span>
                          <span>互动：<span className="text-gray-600">{record.interactions}次</span></span>
                          <span>操作：<span className="text-gray-600">{record.actionCount}条</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 教学建议 */}
              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-600">教学建议</span>
                  <Button
                    theme="primary" variant="outline" size="small"
                    loading={generatingAdvice}
                    onClick={() => handleGenerateTeachingAdvice()}
                  >
                    {analysisData.teachingAdvice ? "重新生成" : "生成建议"}
                  </Button>
                </div>
                {analysisData.teachingAdvice ? (
                  <div className="bg-yellow-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-line">
                    {analysisData.teachingAdvice}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 text-center py-2">暂无建议，点击上方按钮生成</div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">暂无数据</div>
          )}
        </Dialog>

        {/* AI伴学提示词查看/编辑弹窗 */}
        <Dialog
          header="AI伴学提示词"
          visible={showAiCompanionPrompt}
          onClose={() => setShowAiCompanionPrompt(false)}
          width={720}
          zIndex={100000}
          footer={
            <div className="flex justify-between items-center w-full">
              <Button
                theme="default"
                variant="text"
                loading={aiCompanionStatus === "analyzing"}
                onClick={async () => {
                  if (!explorationEditId) return;
                  await generateAiCompanionPromptInBackground(explorationEditId);
                  // 重新获取最新提示词
                  const token = localStorage.getItem("token") || "";
                  try {
                    const res = await fetch(`/api/exploration-activities/${explorationEditId}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setAiCompanionPromptText(data.aiCompanionPrompt || "");
                    }
                  } catch {}
                }}
              >
                重新生成
              </Button>
              <div className="flex gap-2">
                <Button onClick={() => setShowAiCompanionPrompt(false)}>取消</Button>
                <Button
                  theme="primary"
                  onClick={async () => {
                    if (!explorationEditId) return;
                    try {
                      const token = localStorage.getItem("token") || "";
                      await fetch(`/api/exploration-activities/${explorationEditId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ aiCompanionPrompt: aiCompanionPromptText }),
                      });
                      MessagePlugin.success("提示词已保存");
                      setShowAiCompanionPrompt(false);
                    } catch {
                      MessagePlugin.error("保存失败");
                    }
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="text-xs text-gray-500">
              这是AI分析互动HTML后生成的伴学指导手册，作为AI伴学的系统提示词使用。
              可手动调整其中的指导策略和回答风格。
            </div>
            <Textarea
              value={aiCompanionPromptText}
              onChange={(v) => setAiCompanionPromptText(v)}
              placeholder="AI伴学提示词（自动生成中...）"
              rows={20}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </div>
        </Dialog>

</div>
    </TeacherLayout>
  );
}
