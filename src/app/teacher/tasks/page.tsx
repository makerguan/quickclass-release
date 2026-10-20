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
  Pagination,
  InputNumber,
  Popup,
} from "tdesign-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Markdown from "@/components/Markdown";
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
  DownloadIcon,
  BookIcon,
  BrowseIcon,
  InfoCircleIcon,
} from "tdesign-icons-react";
import Link from "next/link";
import TeacherLayout from "@/components/layout/TeacherLayout";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  PieChart, Pie, Legend, ResponsiveContainer,
} from "recharts";
import { removeSubmitFunctionality, detectInstrumentation } from "@/lib/prompts/exploration-submit";
import { renderExplorationHtml } from "@/lib/exploration/render";
import { parseCollectProfile } from "@/lib/exploration/collect-profile";
import TemplatePreviewButton from "@/components/template/TemplatePreviewButton";
import ViewFrame from "./ViewFrame";

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
  analysisTemplateId?: string;
  explorationActivities?: any[];
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
  imageGroupIds?: string;
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

interface ImageGroupItem {
  id: string;
  name: string;
  enabled: boolean; // 是否启用
  imageCount: number; // 组内图片数
}

// 课堂状态标签统一主题色（2026-10-13）：原 default/success/warning 语义色区分状态，
// 用户要求与课题名称、管理按钮同色系，统一 primary；不再保留语义色。
const STATUS_CONFIG = {
  DISABLED: { label: "未启用", theme: "primary" as const },
  ENABLED: { label: "启用", theme: "primary" as const },
  ENDED: { label: "已结束", theme: "primary" as const },
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

// 稳定排序：生效的排前面，失效的沉底；组内保持原有相对顺序。
// 用于课堂管理内四类活动列表（对话/探究/项目/作业），满足「失效操作必须把失效的放最后」。
// reorder 均按 id 调后端、与下标无关，故渲染层排序不影响上下移逻辑。
function sortEnabledFirst<T extends { enabled?: boolean; status?: string }>(list: T[]): T[] {
  return list.slice().sort((a, b) => {
    const aDisabled = a.status === "INACTIVE" || a.enabled === false;
    const bDisabled = b.status === "INACTIVE" || b.enabled === false;
    return (aDisabled ? 1 : 0) - (bDisabled ? 1 : 0);
  });
}

// 从 AI 流式输出中提取纯 HTML（剥离 markdown 代码块包裹与前后说明文字）
function extractHtml(text: string): string {
  if (!text) return "";
  const t = text.trim();
  // 1) 优先提取 markdown 代码块（取含 <html / <!doctype 的块，否则取第一个块）
  const fenceRegex = /```(?:html)?\s*\n?([\s\S]*?)\n?```/g;
  let best = "";
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(t)) !== null) {
    const block = m[1].trim();
    if (/<html|<!doctype/i.test(block)) return block;
    if (!best) best = block;
  }
  if (best) return best;
  // 2) 无代码块：截取 <!DOCTYPE html>…</html>（兼容前后夹杂说明文字）
  const doctypeMatch = t.match(/<!doctype[^>]*>[\s\S]*?<\/html>/i);
  if (doctypeMatch) return doctypeMatch[0];
  const htmlTagMatch = t.match(/<html[\s\S]*<\/html>/i);
  if (htmlTagMatch) return htmlTagMatch[0];
  // 3) 兜底：原样返回（可能是无 DOCTYPE 的纯 HTML 片段）
  return t;
}

/** 从 AI 返回的可交互元素（形状不定）中稳健提取「名称」，避免出现一串「?」 */
function pickElementName(el: unknown): string {
  if (el === null || el === undefined) return "页面元素";
  if (typeof el !== "object") {
    const s = String(el).trim();
    return s || "页面元素";
  }
  const obj = el as Record<string, unknown>;
  const prefer = ["element", "name", "label", "title", "text", "description", "desc", "type"];
  for (const k of prefer) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const k of Object.keys(obj)) {
    if (k.startsWith("_")) continue;
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "页面元素";
}

/** 提取「说明」，避开与名称重复 */
function pickElementDesc(el: unknown): string {
  if (el === null || typeof el !== "object") return "";
  const obj = el as Record<string, unknown>;
  const name = pickElementName(el);
  const prefer = ["description", "desc", "note", "detail", "purpose"];
  for (const k of prefer) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() && v.trim() !== name) return v.trim();
  }
  for (const k of Object.keys(obj)) {
    if (k.startsWith("_")) continue;
    const v = obj[k];
    if (typeof v === "string" && v.trim() && v.trim() !== name) return v.trim();
  }
  return "";
}

/** 课堂管理页的视图状态：记住上次停在哪门课、展开了哪些子活动、滚动位置、是否独占聚焦 */
type TasksViewState = {
  taskId: string | null;
  spIds: string[];
  scrollY: number;
  /** 独占聚焦的课堂 id：仅在「独占聚焦下打开新网页」时写入，返回列表页恢复独占（2026-10-13） */
  exclusiveTaskId?: string | null;
};

const TASKS_VIEW_STATE_KEY = "quickclass.tasks.viewState";

function readTasksViewState(): TasksViewState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(TASKS_VIEW_STATE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TasksViewState>;
    return {
      taskId: typeof v.taskId === "string" ? v.taskId : null,
      spIds: Array.isArray(v.spIds) ? v.spIds.filter((id): id is string => typeof id === "string") : [],
      scrollY: typeof v.scrollY === "number" && v.scrollY >= 0 ? v.scrollY : 0,
      exclusiveTaskId: typeof v.exclusiveTaskId === "string" ? v.exclusiveTaskId : null,
    };
  } catch {
    return null;
  }
}

function writeTasksViewState(state: TasksViewState) {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(TASKS_VIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式下 sessionStorage 不可用，忽略即可（仅影响"记住位置"，不影响功能） */
  }
}

export default function TeacherTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);
  const [conversationTemplates, setConversationTemplates] = useState<AnalysisTemplate[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [imageGroups, setImageGroups] = useState<ImageGroupItem[]>([]);
  const [selectedImageGroupIds, setSelectedImageGroupIds] = useState<string[]>([]);
  // 分页：每页课堂数（用户自定义）与当前页
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // 独占聚焦：非空时只显示该课堂，其余课堂卡片透明淡出；退出时恢复全列表且不展开
  const [exclusiveTaskId, setExclusiveTaskId] = useState<string | null>(null);
  // 退出独占时恢复进入前的分页页号
  const [prevTaskPage, setPrevTaskPage] = useState<number>(1);

  // 信息预览气泡：点击课题名前的图标弹出课堂信息，3 秒后自动消失（2026-10-13）
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  const previewTimer = useRef<number | null>(null);
  const clearPreviewTimer = () => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  };

  // 退出独占聚焦的延迟定时器：先播放收缩动画，动画结束（>300ms）后再恢复全列表与原分页（2026-10-14）
  // ⚠️ GOTCHA：见 exitExclusive 注释——同帧恢复原序/分页会让 grid-rows 收缩过渡失效，必须延迟
  // ⚠️ GOTCHA: 此 ref 存 requestAnimationFrame 的 id（浏览器中返回 number）
  const exitExclusiveTimerRef = useRef<number | null>(null);
  const clearExitExclusiveTimer = () => {
    if (exitExclusiveTimerRef.current !== null) {
      window.cancelAnimationFrame(exitExclusiveTimerRef.current);
      exitExclusiveTimerRef.current = null;
    }
  };

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

  // AI 按学科核心素养生成/优化课堂目标
  const [generatingObjectives, setGeneratingObjectives] = useState(false);
  const [objectivesBackup, setObjectivesBackup] = useState<string | null>(null);

  // AI 优化/生成对话活动目标
  const [generatingConvObjective, setGeneratingConvObjective] = useState(false);
  const [convObjectiveBackup, setConvObjectiveBackup] = useState<string | null>(null);

  // 学习活动 inline 编辑

  const [expandedSpIds, setExpandedSpIds] = useState<Set<string>>(new Set());

  // 视图状态记忆：离开列表（进分析页等）前记录，返回时恢复，避免又跳回第一门课
  const viewReadyRef = useRef(false);
  const viewStateRef = useRef<TasksViewState>({ taskId: null, spIds: [], scrollY: 0, exclusiveTaskId: null });

  // 把最新的展开状态同步到 ref：滚动监听 / 跳转前记录都从这里取，避免 React 闭包读到旧值
  useEffect(() => {
    if (!viewReadyRef.current) return;
    viewStateRef.current = {
      taskId: expandedTaskId,
      spIds: Array.from(expandedSpIds),
      scrollY: viewStateRef.current.scrollY,
      // 独占标记由 goTo（跳转保留）与 exitExclusive（主动退出清除）管理，这里原样保留
      exclusiveTaskId: viewStateRef.current.exclusiveTaskId,
    };
  }, [expandedTaskId, expandedSpIds]);

  // 记录一次当前视图（含滚动位置）
  const persistTasksView = (scrollY?: number) => {
    if (!viewReadyRef.current) return;
    const state: TasksViewState = {
      ...viewStateRef.current,
      scrollY: typeof scrollY === "number" ? scrollY : window.scrollY,
    };
    viewStateRef.current = state;
    writeTasksViewState(state);
  };

  // 打开/收起课堂、展开子活动后记录
  useEffect(() => {
    if (!viewReadyRef.current) return;
    persistTasksView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTaskId, expandedSpIds]);

  // 滚动位置节流记录（返回列表时能滚回原处，不用重新往下找）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        persistTasksView(window.scrollY);
      }, 250);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
      // 卸载时清掉"退出独占"的延迟定时器，避免卸载后 setState（2026-10-14）
      clearExitExclusiveTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 退出独占聚焦：恢复全列表、不展开、还原进入前的分页（2026-10-13）
  // ⚠️ GOTCHA（2026-10-14）：不能把 setExclusiveTaskId(null)/setCurrentPage(prevTaskPage)
  // 与 setExpandedTaskId(null) 放在同一帧执行——独占聚焦会把目标课堂置顶到列表首位（displayTasks 重排），
  // 若目标课堂原本不在第一页/首位，退出时同帧恢复原序+分页会让 React 移动/卸载该卡片 DOM，
  // grid-rows-[1fr]→[0fr] 的 CSS 过渡因起始位置元素被挪走而"瞬间消失"（表现为只有排顶部的课堂有收缩动画）。
  // 修复：分两步——
  //  1. 本帧立即恢复原排序 + 原分页（exclusiveTaskId 清空），让列表回到目标课堂原本所在页，
  //     避免"先展示置顶的第一页、动画完再跳回原页"的闪跳感；
  //  2. 等 React 完成重排、浏览器渲染一帧后（requestAnimationFrame 双帧），
  //     目标课堂已在其原位，此时再清 expandedTaskId 触发 grid-rows 收缩过渡，动画在原位平滑播放。
  // 若中途又点击其他课堂进入独占，clearExitExclusiveTimer 会取消第二帧。
  const exitExclusive = () => {
    clearExitExclusiveTimer();
    setExclusiveTaskId(null);
    setCurrentPage(prevTaskPage);
    // 主动退出独占时同步清除视图记忆中的独占标记，避免刷新/返回后被带回独占（2026-10-13）
    viewStateRef.current = { taskId: null, spIds: [], scrollY: window.scrollY, exclusiveTaskId: null };
    persistTasksView();
    // 双 rAF：确保重排 + 首帧渲染完成后再收缩
    exitExclusiveTimerRef.current = window.requestAnimationFrame(() => {
      exitExclusiveTimerRef.current = window.requestAnimationFrame(() => {
        exitExclusiveTimerRef.current = null;
        setExpandedTaskId(null);
        setExpandedSpIds(new Set());
      });
    });
  };

  // 跳转到其他页面前先记录一次（带走最新滚动位置）
  const goTo = (url: string) => {
    if (exclusiveTaskId) {
      // 独占聚焦下打开新网页（分析/报告/题目管理等）：保留独占状态，记入视图记忆，
      // 返回列表页时恢复独占聚焦（2026-10-13）。⛔ DO NOT REVERT：曾误写成"退出独占"，用户明确要求返回仍回独占
      viewStateRef.current = {
        taskId: exclusiveTaskId,
        spIds: Array.from(expandedSpIds),
        scrollY: window.scrollY,
        exclusiveTaskId,
      };
    }
    persistTasksView();
    router.push(url);
  };

  // 对话活动名片式独立 CRUD 弹窗状态
  // （旧「对话管理」按钮与 HIDE_LEGACY_CONVERSATION_MANAGE 开关已随按类型分组旧区块删除，勿再加回）
  const [convDialogVisible, setConvDialogVisible] = useState(false);
  const [convDialogMode, setConvDialogMode] = useState<"new" | "edit">("new");
  const [convDialogTaskId, setConvDialogTaskId] = useState<string | null>(null);
  const [convDialogSpId, setConvDialogSpId] = useState<string | null>(null);
  const [convDialogPc, setConvDialogPc] = useState<any>(null);
  const [convDialogSaving, setConvDialogSaving] = useState(false);
  const [convDeletePc, setConvDeletePc] = useState<any>(null);
  const [convForm, setConvForm] = useState({
    title: "",
    description: "",
    openingMessage: "",
    systemPrompt: "",
    analysisPrompt: "",
    classAnalysisPrompt: "",
    conversationPromptTemplateId: "",
  });

  // 课堂作业 inline 面板
  const [quizPanelVisible, setQuizPanelVisible] = useState(false);
  const [quizPanelSpId, setQuizPanelSpId] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<any[]>([]);

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
  const [importingQuestions, setImportingQuestions] = useState(false);

  const quizSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // 项目提交管理
  const [projDialogVisible, setProjDialogVisible] = useState(false);
  const [projDialogMode, setProjDialogMode] = useState<"new" | "edit">("new");
  const [projDialogSpId, setProjDialogSpId] = useState<string | null>(null);
  const [projDialogTaskId, setProjDialogTaskId] = useState<string | null>(null);
  const [projDialogId, setProjDialogId] = useState<string | null>(null);
  const [projSaving, setProjSaving] = useState(false);
  const [projForm, setProjForm] = useState({
    title: "",
    description: "",
    category: "TEXT" as "TEXT" | "IMAGE" | "VIDEO",
    visibleToClass: true,
    allowLike: false,
    fileSizeLimit: 10,
  });
  const [projDelete, setProjDelete] = useState<any>(null);

  // 统一视图管理（课堂分析/探究分析/作业管理/作业报告，用 iframe 嵌入独立页面）
  const [activeView, setActiveView] = useState<{
    src: string; title?: string;
  } | null>(null);

  const openNewProj = (spId: string, taskId: string) => {
    setProjDialogMode("new");
    setProjDialogId(null);
    setProjDialogSpId(spId);
    setProjDialogTaskId(taskId);
    setProjForm({
      title: "",
      description: "",
      category: "TEXT",
      visibleToClass: true,
      allowLike: false,
      fileSizeLimit: 10,
    });
    setProjDialogVisible(true);
  };

  const openEditProj = (ps: any, spId: string, taskId: string) => {
    setProjDialogMode("edit");
    setProjDialogId(ps.id);
    setProjDialogSpId(spId);
    setProjDialogTaskId(taskId);
    setProjForm({
      title: ps.title,
      description: ps.description || "",
      category: ps.category,
      visibleToClass: ps.visibleToClass,
      allowLike: ps.allowLike,
      fileSizeLimit: ps.fileSizeLimit,
    });
    setProjDialogVisible(true);
  };

  const saveProj = async () => {
    if (!projForm.title.trim()) {
      MessagePlugin.warning("请填写项目名称");
      return;
    }
    if (!projDialogSpId) {
      MessagePlugin.warning("缺少学习活动");
      return;
    }
    setProjSaving(true);
    try {
      const token = localStorage.getItem("token") || "";
      if (projDialogMode === "new") {
        const res = await fetch(`/api/sub-projects/${projDialogSpId}/project-submissions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(projForm),
        });
        if (res.ok) {
          MessagePlugin.success("已创建项目提交");
          setProjDialogVisible(false);
          fetchTasks();
        } else {
          const t = await res.text();
          MessagePlugin.error(t || "创建失败");
        }
      } else {
        const res = await fetch(`/api/project-submissions/${projDialogId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(projForm),
        });
        if (res.ok) {
          MessagePlugin.success("已保存");
          setProjDialogVisible(false);
          fetchTasks();
        } else {
          const t = await res.text();
          MessagePlugin.error(t || "保存失败");
        }
      }
    } catch {
      MessagePlugin.error("操作失败");
    } finally {
      setProjSaving(false);
    }
  };

  const openBrowse = (id: string) => {
    goTo(`/teacher/tasks/project/${id}`);
  };

  // ===== 📐 跨类型统一活动排序（2026-10-12）=====
  // 一个课堂下 4 类活动（对话/探究/项目/作业）4 张表共用一个 sortOrder 数值空间，
  // 老师按「授课顺序」跨类型排序（如：先对话、再探究、再对话）。
  // 数据源 = 列表接口 /api/tasks 的 task.subProjects（presetConversations / explorationActivities /
  // projectSubmissions / quizActivities 四个数组齐全，字段映射见 /api/tasks/route.ts mapSubProject）。
  // 🔗 RELATED: src/lib/activities/unified-order.ts（后端口径）、
  //   /api/sub-projects/[subProjectId]/activities/reorder（统一排序 API）、
  //   src/app/student/chat/page.tsx（学生端按同一顺序合并渲染）
  // ⛔ DO NOT REVERT: 下方 4 个 handle*Reorder 不要改回旧 /api/{类型}/reorder 的类内交换——
  //   统一数值空间下类内交换会把其他类型活动"挤"到错误位置（例：[对话0,探究1,对话2,作业3]
  //   交换两个对话后变成 [对话2,探究1,对话0,作业3]，探究被夹进对话中间）。
  type UnifiedActType = "conversation" | "exploration" | "project" | "quiz";
  const UNIFIED_TYPE_LABEL: Record<UnifiedActType, string> = {
    conversation: "对话",
    exploration: "探究",
    project: "项目",
    quiz: "作业",
  };
  // ⚠️ GOTCHA: raw 存列表接口返回的原始对象（字段口径见 /api/tasks route.ts 的 select：
  // 探究含 enableSubmission/enableAiCompanion/_count.ExplorationSubmission，作业含 status/_count.attempts，
  // 项目全量）——统一清单的行内管理按钮直接消费 raw，不要回退到 explorations/quizzes 等旧面板
  // 单例 state（那些只服务已删除的按类型分组旧区块，且只对单个展开任务有效）。
  const buildUnifiedActs = (t: any) => {
    const list: Array<{ type: UnifiedActType; id: string; title: string; enabled: boolean; sortOrder: number; meta: string; subProjectId: string; raw: any }> = [];
    (t?.subProjects || []).forEach((sp: any) => {
      (sp.presetConversations || []).forEach((x: any) =>
        list.push({ type: "conversation", id: x.id, title: x.title, enabled: !!x.enabled, sortOrder: x.sortOrder ?? 0, meta: "", subProjectId: sp.id, raw: x }));
      (sp.explorationActivities || []).forEach((x: any) =>
        list.push({ type: "exploration", id: x.id, title: x.title, enabled: !!x.enabled, sortOrder: x.sortOrder ?? 0, meta: (x._count?.ExplorationSubmission ?? 0) > 0 ? `${x._count.ExplorationSubmission}份提交` : "", subProjectId: sp.id, raw: x }));
      (sp.projectSubmissions || []).forEach((x: any) =>
        list.push({ type: "project", id: x.id, title: x.title, enabled: !!x.enabled, sortOrder: x.sortOrder ?? 0, meta: "", subProjectId: sp.id, raw: x }));
      (sp.quizActivities || []).forEach((x: any) =>
        list.push({ type: "quiz", id: x.id, title: x.title, enabled: x.status === "ACTIVE", sortOrder: x.sortOrder ?? 0, meta: `${x.questions?.length ?? 0}题${(x._count?.attempts ?? 0) > 0 ? ` · ${x._count.attempts}人已答` : ""}`, subProjectId: sp.id, raw: x }));
    });
    // 启用在前按 sortOrder，停用（未发布）沉底保持原相对顺序——学生端不显示停用活动，
    // 教师端在这里沉底展示，与「未启动活动列表中显示但沉底」的产品决策一致
    list.sort((a, b) => (a.enabled === b.enabled ? a.sortOrder - b.sortOrder : a.enabled ? -1 : 1));
    return list;
  };

  // 核心排序：与「课堂全局启用序列」中相邻活动交换（相邻项可能是其他类型），走统一排序 API
  const reorderAcrossTypes = async (type: UnifiedActType, id: string, direction: "up" | "down", hintSpId?: string): Promise<boolean> => {
    const task = tasks.find((t: any) => (t.subProjects || []).some((sp: any) => sp.id === hintSpId)) ||
      tasks.find((t: any) => (t.subProjects || []).some((sp: any) =>
        (sp.presetConversations || []).some((x: any) => x.id === id) ||
        (sp.explorationActivities || []).some((x: any) => x.id === id) ||
        (sp.projectSubmissions || []).some((x: any) => x.id === id) ||
        (sp.quizActivities || []).some((x: any) => x.id === id)
      ));
    if (!task) {
      MessagePlugin.error("未找到所属课堂，请刷新后重试");
      return false;
    }
    const unified = buildUnifiedActs(task);
    const enabledList = unified.filter((a) => a.enabled);
    const gi = enabledList.findIndex((a) => a.type === type && a.id === id);
    if (gi === -1) {
      MessagePlugin.error("未找到该活动，请刷新后重试");
      return false;
    }
    const to = direction === "up" ? gi - 1 : gi + 1;
    if (to < 0 || to >= enabledList.length) {
      MessagePlugin.warning("已经移到头啦");
      return false;
    }
    const reordered = [...enabledList];
    [reordered[gi], reordered[to]] = [reordered[to], reordered[gi]];
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/sub-projects/${hintSpId || reordered[0].subProjectId}/activities/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        // 传课堂全局启用序列；后端按 task 维度收集全部学习活动的活动并按下标重写 sortOrder，
        // 未列出的（停用）活动按类型优先级稳定沉底
        body: JSON.stringify({ activities: reordered.map((a) => ({ type: a.type, id: a.id })) }),
      });
      if (!res.ok) {
        MessagePlugin.error("排序失败: " + (await res.text()));
        return false;
      }
      await fetchTasks();
      // 探究/作业管理区列表来自独立 state（fetchTasks 不会更新），面板开着时重拉保持一致
      if (explorationPanelVisible && explorationPanelSpId) {
        const r = await fetch(`/api/exploration-activities?subProjectId=${explorationPanelSpId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await r.json();
        setExplorations(Array.isArray(data) ? data : []);
      }
      if (quizPanelVisible && quizPanelSpId) {
        const r = await fetch(`/api/quiz-activities?subProjectId=${quizPanelSpId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await r.json();
        setQuizzes(Array.isArray(data) ? data : []);
      }
      MessagePlugin.success("排序已更新");
      return true;
    } catch {
      MessagePlugin.error("网络错误");
      return false;
    }
  };

  // 「新建活动」类型选择弹窗：选完类型分发到各类型现有创建流程
  //（对话/探究/项目为弹窗，课堂作业为设计面板——保持原交互不变）
  const [newActivityDialogVisible, setNewActivityDialogVisible] = useState(false);
  const [newActivityTask, setNewActivityTask] = useState<LearningTask | null>(null);
  const handleCreateActivity = (type: UnifiedActType) => {
    const task = newActivityTask;
    setNewActivityDialogVisible(false);
    if (!task) return;
    const sp0 = task.subProjects?.[0];
    if (type === "conversation") {
      openNewConversationDialog(task);
      return;
    }
    if (!sp0) {
      MessagePlugin.warning("请先创建学习活动");
      return;
    }
    if (type === "exploration") {
      openExplorationThenModal(sp0.id!, task);
    } else if (type === "project") {
      setProjDialogMode("new");
      setProjDialogId(null);
      setProjDialogSpId(sp0.id!);
      setProjDialogTaskId(task.id);
      setProjForm({ title: "", description: "", category: "TEXT", visibleToClass: true, allowLike: false, fileSizeLimit: 10 });
      setProjDialogVisible(true);
    } else if (type === "quiz") {
      setQuizDesignId(null);
      setQuizDesignTitle("");
      setQuizDesignDesc("");
      setQuizDesignTemplateContent("");
      setQuizDesignQuestions([]);
      setSelectedQuizTemplateId("");
      setQuizDesignMode(true);
      setQuizPanelSpId(sp0.id!);
      openQuizPanel(sp0.id!, task);
    }
  };

  const [operatingProjectId, setOperatingProjectId] = useState<string | null>(null);

  // 项目提交排序
  // 📐 已切到跨类型统一排序（与对话/探究/作业同一套逻辑），详见上方「跨类型统一活动排序」注释块
  const [reorderingProjectId, setReorderingProjectId] = useState<string | null>(null);
  const handleProjectReorder = async (submissionId: string, direction: "up" | "down", subProjectId: string) => {
    setReorderingProjectId(submissionId);
    try {
      await reorderAcrossTypes("project", submissionId, direction, subProjectId);
    } finally {
      setReorderingProjectId(null);
    }
  };

  const handleProjectToggle = async (ps: any, shouldEnable: boolean) => {
    setOperatingProjectId(ps.id);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/project-submissions/${ps.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: shouldEnable }),
      });
      if (res.ok) {
        // 刷新课堂列表，同步 enabled 状态
        setTasks((prev) =>
          prev.map((t) => ({
            ...t,
            subProjects: t.subProjects.map((sp: any) => ({
              ...sp,
              projectSubmissions: (sp.projectSubmissions || []).map((p: any) =>
                p.id === ps.id ? { ...p, enabled: shouldEnable } : p
              ),
            })),
          }))
        );
        MessagePlugin.success(shouldEnable ? "项目已生效" : "项目已失效");
      } else {
        MessagePlugin.error("切换失败");
      }
    } catch {
      MessagePlugin.error("切换失败");
    } finally {
      setOperatingProjectId(null);
    }
  };

  const confirmDeleteProj = async () => {
    if (!projDelete) return;
    const token = localStorage.getItem("token") || "";
    const res = await fetch(`/api/project-submissions/${projDelete.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      MessagePlugin.success("已删除（含学生提交及附件）");
      setProjDelete(null);
      fetchTasks();
    } else {
      const t = await res.text();
      MessagePlugin.error(t || "删除失败");
    }
  };

  function SortableQuizQuestion({ q, idx, onUpdate, onMoveUp, onMoveDown, total }: { q: any; idx: number; onUpdate: (field: string, value: any) => void; onMoveUp: () => void; onMoveDown: () => void; total: number }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idx });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.8 : 1 };
    const options = typeof q.options === "string" ? JSON.parse(q.options || "{}") : (q.options || {});
    return (
      <div ref={setNodeRef} style={style} className={`bg-[var(--primary-lighter)] rounded-lg p-3 text-sm ${isDragging ? "shadow-lg" : ""}`}>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-0.5 p-1 rounded">
            <span className="text-xs text-[var(--muted-light)] font-bold">↑</span>
            <button type="button" onClick={onMoveUp} disabled={idx === 0} className="w-5 h-4 flex items-center justify-center text-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▲</button>
            <button type="button" onClick={onMoveDown} disabled={idx === total - 1} className="w-5 h-4 flex items-center justify-center text-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▼</button>
            <span className="text-xs text-[var(--muted-light)] font-bold">↓</span>
          </div>
          <span {...attributes} {...listeners} className="cursor-grab text-[var(--muted-light)] hover:text-[var(--muted)] select-none mt-1" title="拖拽排序">⋮⋮</span>
          <span className="font-medium text-[var(--muted)]">{idx + 1}.</span>
          <div className="flex-1 space-y-2">
            <Input value={q.content} onChange={(v) => onUpdate("content", v)} size="small" />
            <div className="grid grid-cols-2 gap-1">
              {["A","B","C","D"].map((opt) => (
                <div key={opt} className="flex items-center gap-1">
                  <span className="text-xs text-[var(--muted-light)]">{opt}.</span>
                  <Input value={options[opt] || ""} onChange={(v) => onUpdate("options", { ...options, [opt]: v })} size="small" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 items-center text-xs">
              <span className="text-[var(--muted-light)]">题型：</span>
              <select value={q.type || "SINGLE_CHOICE"} onChange={(e) => onUpdate("type", e.target.value)} className="border rounded px-1 py-0.5">
                <option value="SINGLE_CHOICE">单选</option><option value="MULTIPLE_CHOICE">多选</option><option value="TRUE_FALSE">判断</option>
              </select>
              <span className="text-[var(--muted-light)] ml-2">答案：</span>
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
              <span className="text-[var(--muted-light)] ml-2">难度：</span>
              <select value={q.difficulty || "BASIC"} onChange={(e) => onUpdate("difficulty", e.target.value)} className="border rounded px-1 py-0.5">
                <option value="BASIC">基础</option><option value="INTERMEDIATE">提升</option><option value="ADVANCED">拓展</option>
              </select>
            </div>
            <div><span className="text-xs text-[var(--muted-light)]">答案解析</span><Input value={q.explanation || ""} onChange={(v) => onUpdate("explanation", v)} size="small" placeholder="答案解析（可为空）" /></div>
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
          // 同步更新 tasks state，避免关闭面板再打开时数据不一致
          setTasks((prev) =>
            prev.map((t) => ({
              ...t,
              subProjects: t.subProjects.map((sp: any) => {
                if (sp.id === q.subProjectId) {
                  return { ...sp, quizActivities: updatedQuizzes };
                }
                return sp;
              }),
            }))
          );
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

  // 打开新建对话活动弹窗（名片式）
  const openNewConversationDialog = (task: any) => {
    const defaultSp = task.subProjects?.[0];
    if (!defaultSp) {
      MessagePlugin.error("该课堂暂无活动容器，请先添加子项目");
      return;
    }
    setConvDialogMode("new");
    setConvDialogTaskId(task.id);
    setConvDialogSpId(defaultSp.id);
    setConvDialogPc(null);
    setConvObjectiveBackup(null);
    setConvForm({
      title: "",
      description: "",
      openingMessage: "",
      systemPrompt: "",
      analysisPrompt: "",
      classAnalysisPrompt: "",
      conversationPromptTemplateId: "",
    });
    setConvDialogVisible(true);
  };

  // 打开「编辑对话活动」弹窗
  // ⚠️ 列表接口已剥离提示词正文，打开前必须拉一次该对话活动的完整字段
  //    （契约见 fetchTaskDetailLite 上方）；失败则**不开弹窗**，避免空值覆盖库里的提示词。
  // 注：这里走 /api/preset-conversations/[id] 单条接口，而不是 fetchTaskDetailLite，
  //     因为只需要这一条对话活动，没必要把整节课拉下来。
  const openEditConversationDialog = async (task: any, pc: any) => {
    const defaultSp = task.subProjects?.find((sp: any) => sp.presetConversations.some((p: any) => p.id === pc.id));
    let detail: any = pc;
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/preset-conversations/${pc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        MessagePlugin.error("读取对话活动详情失败，请重试");
        return;
      }
      const data = await res.json();
      if (data?.presetConversation) detail = data.presetConversation;
    } catch {
      MessagePlugin.error("读取对话活动详情失败，请重试");
      return;
    }
    setConvDialogMode("edit");
    setConvDialogTaskId(task.id);
    setConvDialogSpId(defaultSp?.id ?? null);
    setConvDialogPc(detail);
    setConvObjectiveBackup(null);
    setConvForm({
      title: detail.title || "",
      description: detail.description || "",
      openingMessage: detail.openingMessage || "",
      systemPrompt: detail.systemPrompt || "",
      analysisPrompt: detail.analysisPrompt || "",
      classAnalysisPrompt: detail.classAnalysisPrompt || "",
      // 模板关联不在库中存字段，靠 systemPrompt 内容反查（此前读 pc.xxx 恒为空）
      conversationPromptTemplateId: findConversationPromptTemplateId(detail.systemPrompt) || "",
    });
    setConvDialogVisible(true);
  };

  // 保存对话活动（新建或编辑），走独立 API
  const handleConversationSave = async () => {
    if (!convForm.title?.trim()) {
      MessagePlugin.error("对话活动名称不能为空");
      return;
    }
    if (!convForm.description?.trim()) {
      MessagePlugin.error("对话活动目标不能为空");
      return;
    }
    if (!convForm.analysisPrompt?.trim()) {
      MessagePlugin.error("个人学情分析提示词不能为空");
      return;
    }
    if (!convForm.classAnalysisPrompt?.trim()) {
      MessagePlugin.error("全班学情分析提示词不能为空");
      return;
    }
    setConvDialogSaving(true);
    try {
      const token = localStorage.getItem("token") || "";
      const body: Record<string, unknown> = {
        title: convForm.title.trim(),
        description: convForm.description.trim(),
        openingMessage: convForm.openingMessage.trim() || null,
        systemPrompt: convForm.systemPrompt,
        analysisPrompt: convForm.analysisPrompt,
        classAnalysisPrompt: convForm.classAnalysisPrompt,
        // 反向匹配对话设计模板 id（仅用于列表展示模板名，不影响填充内容）
        conversationPromptTemplateId: findConversationPromptTemplateId(convForm.systemPrompt) || undefined,
      };

      let res: Response;
      if (convDialogMode === "new") {
        if (!convDialogSpId) {
          MessagePlugin.error("缺少活动容器");
          return;
        }
        res = await fetch("/api/preset-conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...body, subProjectId: convDialogSpId }),
        });
      } else {
        res = await fetch(`/api/preset-conversations/${convDialogPc?.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        MessagePlugin.success(convDialogMode === "new" ? "对话活动已创建" : "对话活动已保存");
        setConvDialogVisible(false);
        fetchTasks();
      } else {
        const data = await res.json().catch(() => ({}));
        MessagePlugin.error(data.error || "保存失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setConvDialogSaving(false);
    }
  };

  // AI 优化/生成对话活动目标
  // 根据课堂信息（课题、年级、学科）+ 对话活动名称 + 已输入目标，生成更贴学科特点与学生水平的目标描述。
  // 为什么用独立接口而非复用 generate-objectives：课堂目标强制按素养维度一一对应（条数=维度数），
  // 对话活动目标聚焦单次 AI 对话互动，不需要该约束。
  // 🔗 RELATED：后端实现见 src/app/api/preset-conversations/optimize-objective/route.ts。
  // ⛔ DO NOT REVERT to /api/tasks/generate-objectives：会把整节课的维度结构强加到单次对话活动上。
  const handleAIOptimizeConversationObjective = async () => {
    if (!convDialogTaskId) {
      MessagePlugin.error("未找到关联课堂");
      return;
    }
    const task = tasks.find((t) => t.id === convDialogTaskId);
    if (!task) {
      MessagePlugin.error("未找到关联课堂");
      return;
    }
    if (!task.grade) {
      MessagePlugin.error("该课堂未设置年级，无法优化");
      return;
    }
    if (!task.subject) {
      MessagePlugin.error("该课堂未设置学科，无法优化");
      return;
    }
    if (!convForm.title?.trim()) {
      MessagePlugin.error("请先填写对话活动名称");
      return;
    }

    setGeneratingConvObjective(true);
    startGenOverlay("AI 思考中...");
    const currentDescription = convForm.description;
    const wasOptimize = currentDescription.trim().length > 0;
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/preset-conversations/optimize-objective", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          taskTitle: task.title,
          grade: task.grade,
          subject: task.subject,
          conversationTitle: convForm.title.trim(),
          currentObjective: currentDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        MessagePlugin.error(data.error || "优化失败，请重试");
        return;
      }
      setConvObjectiveBackup(currentDescription);
      setConvForm((prev) => ({ ...prev, description: data.objective }));
      MessagePlugin.success(wasOptimize ? "已优化对话活动目标" : "已生成对话活动目标");
    } catch {
      MessagePlugin.error("网络错误，请重试");
    } finally {
      stopGenOverlay();
      setGeneratingConvObjective(false);
    }
  };

  // 撤销 AI 生成/优化，恢复之前的对话活动目标
  const restoreConvObjective = () => {
    if (convObjectiveBackup !== null) {
      setConvForm({ ...convForm, description: convObjectiveBackup });
      setConvObjectiveBackup(null);
    }
  };

  // 删除对话活动（独立 API，带确认）
  const handleConversationDelete = (pc: any) => {
    setConvDeletePc(pc);
  };

  const confirmConversationDelete = async () => {
    const pc = convDeletePc;
    setConvDeletePc(null);
    if (!pc) return;
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/preset-conversations/${pc.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success("对话活动已删除");
        fetchTasks();
      } else {
        MessagePlugin.error("删除失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    }
  };

  // ===== 互动探究 =====
  const [explorationPanelVisible, setExplorationPanelVisible] = useState(false);
  const [explorationPanelSpId, setExplorationPanelSpId] = useState<string | null>(null);
  const [explorations, setExplorations] = useState<any[]>([]);
  const [operatingExplorationId, setOperatingExplorationId] = useState<string | null>(null);
  const [togglingExplorationId, setTogglingExplorationId] = useState<string | null>(null);
  const [clearingSubmissionsExplorationId, setClearingSubmissionsExplorationId] = useState<string | null>(null);

  // 新建/编辑探究弹窗
  const [explorationModalVisible, setExplorationModalVisible] = useState(false);
  const [explorationEditId, setExplorationEditId] = useState<string | null>(null); // null=新建
  const [explorationTitle, setExplorationTitle] = useState("");
  const [explorationPrompt, setExplorationPrompt] = useState(""); // 分析提示词（analysisPrompt）
  const [initialPrompt, setInitialPrompt] = useState(""); // 首轮设计意图（保存为 designPrompt）
  const [draftInput, setDraftInput] = useState(""); // 对话输入框当前值
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "ai"; content: string }[]>([]); // 对话流
  const [htmlVersions, setHtmlVersions] = useState<string[]>([]); // 版本栈
  const [versionIndex, setVersionIndex] = useState(-1); // 当前版本指针
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview"); // 右栏 tab
  const [explorationHtml, setExplorationHtml] = useState("");
  const [explorationPreview, setExplorationPreview] = useState("");
  const [generatingPrompt, setGeneratingPrompt] = useState(false); // AI 帮我写
  const [generating, setGenerating] = useState(false); // 多轮生成中
  const [savingExploration, setSavingExploration] = useState(false);

  // ⚠️ GOTCHA：生成进度浮层（单例）
  // 旧写法每秒 `msg.close()` + `MessagePlugin.loading(...)` 重建 —— 因为 TDesign 每次调用都向容器 push 一条
  // 新 message（见 node_modules/tdesign-react/es/message/Message.js:203 renderElement），旧 loading 消息的 fadeOut
  // 异步退出动画未跑完就被新消息盖住，栈顶那条永远显示 "0s" 且圆圈一直转（历史 bug：用户报「秒数一直是 0，圆圆一直滚动」）。
  // 改用单一 React 浮层 + useState 计数，从根本上杜绝消息堆叠，秒数随真实耗时递增。
  const [genOverlay, setGenOverlay] = useState<{ visible: boolean; text: string; seconds: number }>({
    visible: false,
    text: "",
    seconds: 0,
  });
  const genTimerRef = useRef<NodeJS.Timeout | null>(null);
  const genStartRef = useRef<number>(0);
  const startGenOverlay = (initialText: string) => {
    genStartRef.current = Date.now();
    setGenOverlay({ visible: true, text: initialText, seconds: 0 });
    if (genTimerRef.current) clearInterval(genTimerRef.current);
    genTimerRef.current = setInterval(() => {
      setGenOverlay((prev) => ({ ...prev, seconds: Math.round((Date.now() - genStartRef.current) / 1000) }));
    }, 1000);
  };
  const updateGenOverlay = (text: string) => setGenOverlay((prev) => ({ ...prev, text }));
  const stopGenOverlay = () => {
    if (genTimerRef.current) {
      clearInterval(genTimerRef.current);
      genTimerRef.current = null;
    }
    setGenOverlay((prev) => ({ ...prev, visible: false }));
  };
  useEffect(() => {
    return () => {
      if (genTimerRef.current) clearInterval(genTimerRef.current);
    };
  }, []);

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
  // 采集类别（本地渲染预览用，与学生端读取注入保持一致；回显/保存后同步）
  const [explorationCollectProfile, setExplorationCollectProfile] = useState<any>(null);

  // 桩丢失「变化提醒」：采集桩从有→无的翻转瞬间，弹一次性 toast 抓注意力。
  // 为什么：常驻黄条（5383 行 detectInstrumentation 实时算）是「静态状态」，老师专注编辑时
  //   可能没注意到绿条→黄条的翻转；toast 是「变化事件」，明确告知「刚才发生了什么」。
  // 现状/约束：只在 needsAdaptation 从 false→true 翻转、且「启用提交 + 已确认注入」时弹一次；
  //   持续处于无桩态继续编辑不重复弹。开关关闭（confirmedInjection=false）时静默更新基线，不弹。
  // 🔗 RELATED：检测函数 src/lib/prompts/exploration-submit.ts detectInstrumentation；
  //   黄条渲染同文件 5382-5403 行，改判定口径两处要一致。
  const prevNeedsAdaptationRef = useRef<boolean>(false);
  useEffect(() => {
    const needsAdaptation = detectInstrumentation(explorationHtml).needsAdaptation;
    if (
      explorationEnableSubmission &&
      confirmedInjection &&
      needsAdaptation &&
      !prevNeedsAdaptationRef.current
    ) {
      MessagePlugin.warning("⚠️ 采集桩缺失或已丢失，分数/关卡将无法上报，可点「重试接入」恢复");
    }
    prevNeedsAdaptationRef.current = needsAdaptation;
  }, [explorationHtml, explorationEnableSubmission, confirmedInjection]);

  // 去除 AI 伴学注入代码（用于源码编辑器保持纯净稿）
  // 注入结构见 injectAiCompanion：<style>#ai-companion-root…</style> 入 </head> 前，
  // <div id="ai-companion-root">…</div> + katex/伴学 <script> 入 </body> 前。
  // 旧实现只剥 <style>，第二条正则依赖并不存在的 <!--__AI_COMPANION_INJECTED__--> 注释（失效），
  // 会残留浮动按钮 DOM 与对话脚本 → 源码区/导出都不纯净。这里按 CSS / script / DOM 三段剥净。
  // 🔗 RELATED 与后端 removeAiCompanion（src/lib/prompts/ai-companion.ts）语义一致，改这里要同步看那边。
  const stripAiCompanionCode = (html: string) => {
    if (!html) return "";
    let s = html;
    // 1. 伴学 <style>（含 #ai-companion-root）
    s = s.replace(/<style>[\s\S]*?#ai-companion-root[\s\S]*?<\/style>/gi, "");
    // 2. 伴学交互 <script>（IIFE 内含 __AI_COMPANION_INJECTED__ 标记）
    s = s.replace(/<script>\s*\(function\s*\(\)\s*\{[\s\S]*?__AI_COMPANION_INJECTED__[\s\S]*?\}\)\(\);?\s*<\/script>/gi, "");
    // 3. 伴学 DOM + 依赖脚本（katex）：从 <div id="ai-companion-root" 起到 </body> 前整段删除
    const rootIdx = s.indexOf('<div id="ai-companion-root"');
    if (rootIdx > -1) {
      const bodyClose = s.lastIndexOf("</body>");
      if (bodyClose > rootIdx) {
        s = s.substring(0, rootIdx) + s.substring(bodyClose);
      }
    }
    return s;
  };

  // 本地渲染预览：把「纯净稿 + 开关」渲染成注入版（提交 + 伴学），供预览 iframe 使用。
  // 与后端读取路径 renderExplorationHtml 同源，保证预览与学生端看到的一致。
  // ⛔ 不再依赖 GET 详情返回注入版（GET 详情现在返回纯净稿）；预览统一本地渲染。
  const renderLocalPreview = (
    html: string,
    opts?: { enableSubmission?: boolean; enableAiCompanion?: boolean; collectProfile?: any; explorationId?: string }
  ) => {
    return renderExplorationHtml({
      htmlContent: html,
      explorationId: opts?.explorationId ?? explorationEditId ?? "",
      taskTitle: "",
      enableSubmission: opts?.enableSubmission ?? explorationEnableSubmission,
      enableAiCompanion: opts?.enableAiCompanion ?? explorationEnableAiCompanion,
      collectProfile: opts?.collectProfile !== undefined ? opts.collectProfile : (explorationCollectProfile ?? undefined),
    }).html;
  };

  // 打开探究面板（数据已随课堂列表加载，直接从 subProjects 读取，无异步加载）
  const openExplorationPanel = (spId: string, task?: LearningTask) => {
    const sp = (task?.subProjects as any[] | undefined)?.find((s: any) => s.id === spId);
    setExplorations((sp?.explorationActivities as any[]) ?? []);
    setExplorationPanelSpId(spId);
    setExplorationPanelVisible(true);
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
    setInitialPrompt("");
    setDraftInput("");
    setChatMessages([]);
    setHtmlVersions([]);
    setVersionIndex(-1);
    setActiveTab("preview");
    setExplorationHtml("");
    setExplorationPreview("");
    setExplorationEnableSubmission(false);
    setExplorationHasSubmissions(false);
    syncConfirmedInjection(false);
    setOriginalHtmlForInjection("");
    setExplorationEnableAiCompanion(false);
    setAiCompanionStatus("idle");
    setAiCompanionPromptText("");
    setShowAiCompanionPrompt(false);
    setExplorationModalVisible(true);
  };

  // 确保面板已打开后再打弹窗（数据已本地加载，无需异步）
  const openExplorationThenModal = (spId: string, task?: LearningTask) => {
    // 如果面板已显示同一 subProject，直接打开弹窗
    if (explorationPanelVisible && explorationPanelSpId === spId) {
      openNewExploration();
      return;
    }
    // 否则打开面板再弹窗
    openExplorationPanel(spId, task);
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
        // 默认班级：优先「当前班级且有提交」；否则选第一个有提交的班级；
        // 都没有提交才退回原行为（当前班级在列用它，否则 classIds[0]）。
        // ⚠️ GOTCHA（2026-10-13）：教师多班时，当前班级可能无提交，原先直接用它导致
        //   点「分析」看不到任何提交数据（课堂列表却显示 N 份提交，来自全量 _count）。
        // ⛔ DO NOT REVERT: 退回旧逻辑会复现「后台显示有人提交，分析页却为空」。
        // 🔗 RELATED: analysis GET 返回 classSubmittedCounts；
        //   exploration 分析页 page.tsx fetchData 是同款逻辑，改一处务必同步另一处。
        const firstClassWithSub = (data.classIds || []).find(
          (c: string) => (data.classSubmittedCounts?.[c] ?? 0) > 0
        );
        let targetClassId = "";
        if (currentClassId && (data.classSubmittedCounts?.[currentClassId] ?? 0) > 0) {
          targetClassId = currentClassId;
        } else if (firstClassWithSub) {
          targetClassId = firstClassWithSub;
        } else {
          targetClassId = data.classIds?.includes(currentClassId)
            ? currentClassId
            : (data.classIds?.[0] || "");
        }
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

  // 上传 HTML 文件（纳入版本栈，可撤销/继续多轮）
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
      // 导入后作为新版本（若撤销回旧版本，则截断后续版本）
      const baseVersions = htmlVersions.slice(0, versionIndex + 1);
      const newIndex = baseVersions.length;
      setHtmlVersions([...baseVersions, text]);
      setVersionIndex(newIndex);
      setExplorationHtml(text);
      setExplorationPreview(renderLocalPreview(text));
      setChatMessages((prev) => [...prev, { role: "ai", content: "📄 已导入外部 HTML，可继续用对话修改" }]);
      MessagePlugin.success("HTML 文件已加载，可继续用对话修改");
    };
    input.click();
  };

  // AI 接入提交采集：对导入/存量的未接桩 HTML 插桩（复用 generate 多轮分支）
  const [adapting, setAdapting] = useState(false);

  // 纯函数：调用 AI 对 HTML 插桩，成功返回改造后的 HTML，失败返回 null（不抛错、不改任何 state）
  const adaptHtmlWithAi = async (html: string): Promise<string | null> => {
    setAdapting(true);
    startGenOverlay("AI 接入采集中...");
    try {
      const token = localStorage.getItem("token") || "";
      const response = await fetch("/api/exploration-activities/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subProjectId: explorationPanelSpId,
          initialPrompt: "",
          currentHtml: html,
          instruction:
            "请先判断页面形态，再按形态接入采集，全程不得改变页面任何视觉、交互逻辑、文案，输出完整 HTML：\n【游戏/练习型】页面有得分、关卡、对错等：找到记录分数/关卡/完成状态/用户答案的变量或函数，在它们被更新的代码处插入防御式上报调用（if (typeof updateScore === \"function\") updateScore(分数)；if (typeof completeSection === \"function\") completeSection(环节名)；if (typeof setGameLevel === \"function\") setGameLevel(关卡)），并把 score、maxScore、gameLevel、completedSections、answers 同步挂到 window.__gameState__。\n【纯交互/探索型】页面无作答表单（模拟实验、概念可视化、拖拽观察等，无分数也无答题）：不要虚构分数或答案。找出学生的关键可观察状态——滑杆/参数最终值、开关/灯泡状态、学生输入的结论或观察文字、关键变量等，在它们更新处插入防御式上报（if (typeof recordAction === \"function\") recordAction(类型, 描述, 值)），并以自定义键名把这些状态挂到 window.__gameState__（如 { 滑杆值: 3.2, 灯泡状态: \"亮\", 我的发现: \"...\" }）。\n【两者兼有】同时处理。\n如果页面已存在 __gameState__ 初始化或 typeof updateScore 之类的上报调用，说明已接入，直接原样输出 HTML 不要改动。",
        }),
      });
      if (!response.ok || !response.body) throw new Error(`生成失败（${response.status}）`);

      // 流式接收
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }
      const adapted = received.trim();
      if (!adapted) throw new Error("AI 未返回内容");
      return adapted;
    } catch {
      return null;
    } finally {
      stopGenOverlay();
      setAdapting(false);
    }
  };

  // 手动重试入口：降级后教师可再次触发 AI 接入（带确认，改造入版本栈可撤销）
  const handleAdaptInstrumentation = async () => {
    if (!explorationPanelSpId) return;
    if (!explorationHtml.trim()) {
      MessagePlugin.warning("请先生成或上传 HTML 内容");
      return;
    }
    const detection = detectInstrumentation(explorationHtml);
    if (!detection.needsAdaptation) {
      MessagePlugin.info("该页面已接入提交采集，无需改造");
      return;
    }
    // 混淆代码提示：minified/混淆变量 AI 难以识别，效果可能不佳
    const minified = /[\w$]{200,}/.test(explorationHtml) || /_0x[a-f0-9]{4,}/.test(explorationHtml);
    const confirmed = window.confirm(
      minified
        ? "检测到该 HTML 可能经过压缩/混淆，AI 接入效果可能不佳，仍要继续吗？\n（改造会作为新版本入栈，可随时撤销还原）"
        : "AI 将把页面中的分数/关卡/作答状态变量接入提交采集，不改变任何视觉与交互。\n（改造会作为新版本入栈，可随时撤销还原）"
    );
    if (!confirmed) return;

    const adapted = await adaptHtmlWithAi(explorationHtml);
    if (!adapted) {
      MessagePlugin.warning("⚠️ AI 采集接入未成功，当前仅采集基础数据（时长/操作/滚动），分数/关卡/作答暂无法上报");
      return;
    }
    // 改造结果入版本栈（备份/撤销天然可用）
    const baseVersions = htmlVersions.slice(0, versionIndex + 1);
    const newIndex = baseVersions.length;
    setHtmlVersions([...baseVersions, adapted]);
    setVersionIndex(newIndex);
    setExplorationHtml(adapted);
    setExplorationPreview(renderLocalPreview(adapted));
    setChatMessages((prev) => [
      ...prev,
      { role: "ai", content: "🔌 已完成提交采集接入（AI 插桩），建议预览试玩验证，可撤销还原" },
    ]);
    MessagePlugin.success("AI 接入采集完成，建议预览试玩验证（可撤销）");
  };

  // 自动生成提示词（流式：提示词编辑区已有输入时优化已有提示词，否则从零设计）
  const autoGeneratePrompt = async () => {
    if (!explorationPanelSpId) return;
    const hadIdea = !!draftInput.trim();
    setGeneratingPrompt(true);
    startGenOverlay("AI 思考中...");
    let text = "";
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/exploration-activities/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subProjectId: explorationPanelSpId,
          // 提示词编辑区已有的用户输入：非空时后端按「优化已有提示词」处理，为空时按课堂信息从零设计
          teacherIdea: draftInput,
          title: explorationTitle,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "生成提示词失败" }));
        MessagePlugin.error((err as any).error || "生成提示词失败");
        return;
      }
      // 消费流式响应，实时显示已生成字数
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        updateGenOverlay(`已生成 ${text.length} 字...`);
      }
      // 解析「标题：/提示词：」结构
      const titleMatch = text.match(/标题[：:]\s*(.+?)(?:\n|---|$)/);
      const promptMatch = text.match(/提示词[：:]\s*([\s\S]+)/);
      const title = titleMatch ? titleMatch[1].trim().slice(0, 50) : "探究活动";
      const prompt = promptMatch ? promptMatch[1].trim() : text.trim();
      if (!explorationTitle.trim()) setExplorationTitle(title);
      setDraftInput(prompt);
      MessagePlugin.success(hadIdea ? "已优化提示词，请确认后发送" : "已生成设计意图，请确认后发送");
    } catch {
      MessagePlugin.error("生成提示词失败");
    } finally {
      stopGenOverlay();
      setGeneratingPrompt(false);
    }
  };

  // 多轮对话生成 HTML（首轮/后续轮统一入口）
  const handleSend = async () => {
    const instruction = draftInput.trim();
    if (!instruction) {
      MessagePlugin.warning("请输入内容");
      return;
    }
    const isFirstRound = htmlVersions.length === 0;
    if (!isFirstRound && !explorationHtml.trim()) {
      MessagePlugin.warning("缺少当前 HTML，请先生成或导入");
      return;
    }
    if (isFirstRound) setInitialPrompt(instruction);

    // 追加用户消息 + 清空输入
    setChatMessages((prev) => [...prev, { role: "user", content: instruction }]);
    setDraftInput("");
    setGenerating(true);
    startGenOverlay("AI 思考中...");

    try {
      const token = localStorage.getItem("token") || "";
      const response = await fetch("/api/exploration-activities/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subProjectId: explorationPanelSpId,
          initialPrompt: isFirstRound ? instruction : initialPrompt,
          currentHtml: isFirstRound ? "" : explorationHtml,
          instruction,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "生成失败" }));
        MessagePlugin.error(err.error || "生成失败");
        return;
      }
      // 读取流式响应，实时更新进度
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let htmlContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        htmlContent += decoder.decode(value, { stream: true });
        updateGenOverlay(`正在生成网页... ${htmlContent.length.toLocaleString()} 字符`);
      }

      // 剥离 markdown 代码块包裹与前后说明文字，只保留纯 HTML
      const clean = extractHtml(htmlContent);
      if (!clean) {
        MessagePlugin.error("生成内容为空，请重试");
        setGenerating(false);
        return;
      }

      // 纳入版本栈（若撤销回旧版本，则截断后续版本再追加）
      const baseVersions = htmlVersions.slice(0, versionIndex + 1);
      const newIndex = baseVersions.length;
      setHtmlVersions([...baseVersions, clean]);
      setVersionIndex(newIndex);
      setExplorationHtml(clean);
      setExplorationPreview(renderLocalPreview(clean));
      setChatMessages((prev) => [...prev, { role: "ai", content: `✓ 已生成第 ${newIndex + 1} 版` }]);
      MessagePlugin.success("网页已更新");
    } catch {
      MessagePlugin.error("生成失败");
    } finally {
      stopGenOverlay();
      setGenerating(false);
    }
  };

  // 撤销到上一版本
  const handleUndo = () => {
    if (versionIndex <= 0) return;
    const idx = versionIndex - 1;
    setVersionIndex(idx);
    setExplorationHtml(htmlVersions[idx]);
    setExplorationPreview(renderLocalPreview(htmlVersions[idx]));
  };

  // 重做到下一版本
  const handleRedo = () => {
    if (versionIndex >= htmlVersions.length - 1) return;
    const idx = versionIndex + 1;
    setVersionIndex(idx);
    setExplorationHtml(htmlVersions[idx]);
    setExplorationPreview(renderLocalPreview(htmlVersions[idx]));
  };

  // 导出 HTML 文件
  const handleExportHtml = () => {
    if (!explorationHtml.trim()) {
      MessagePlugin.warning("请先生成或上传 HTML 内容");
      return;
    }
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
    // 导出纯净稿：剥掉平台注入的提交通道（提交按钮/追踪脚本/探究记录面板）与 AI 伴学残留，
    // 保留页面本身。AI 契约桩（__gameState__ / typeof updateScore 防御式调用）保留——它们属于页面逻辑、
    // 脱离平台后是 no-op 无害，且无起止标记包裹无法安全剥离。
    // 🔗 RELATED 与后端 PUT 的 removeSubmitFunctionality 同源；改这里要一起看 src/lib/prompts/exploration-submit.ts。
    const cleanHtml = stripAiCompanionCode(removeSubmitFunctionality(explorationHtml));
    const blob = new Blob([cleanHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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
            designPrompt: initialPrompt,
            analysisPrompt: explorationPrompt,
            chatHistory: chatMessages,
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
            designPrompt: initialPrompt,
            analysisPrompt: explorationPrompt,
            chatHistory: chatMessages,
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
        // ⚠️ GOTCHA（2026-10-13）：统一清单「课堂活动（按授课顺序）」读 /api/tasks 的 subProjects
        //   （buildUnifiedActs），本地 setExplorations 只更新探究面板内部列表。
        //   漏调 fetchTasks 会导致新建/编辑保存后清单不显示新活动（或标题不更新）。
        // 🔗 RELATED: handleClearExplorationSubmissions / handleExplorationDelete 同款修复。
        fetchTasks();
        // 同步 enableSubmission 状态（避免数据库值与前端不一致）
        setExplorationEnableSubmission(saved.enableSubmission ?? explorationEnableSubmission);
        setExplorationEnableAiCompanion(saved.enableAiCompanion ?? explorationEnableAiCompanion);
        if (saved.aiCompanionPrompt) {
          setAiCompanionPromptText(saved.aiCompanionPrompt);
        }
        // 保存后预览：本地渲染注入版（提交 + 伴学），源码区恒为纯净稿。
        // ⛔ 不再依赖 GET 详情返回注入版（GET 详情现在返回纯净稿）。
        setExplorationPreview(renderLocalPreview(saved.htmlContent ?? explorationHtml, {
          enableSubmission: saved.enableSubmission,
          enableAiCompanion: saved.enableAiCompanion,
          collectProfile: saved.collectProfile ? parseCollectProfile(saved.collectProfile) : null,
          explorationId: saved.id,
        }));
        if (saved.collectProfile) {
          setExplorationCollectProfile(parseCollectProfile(saved.collectProfile));
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

        // 如果启用了AI伴学但没有提示词，异步生成（HTML变化时PUT已清空旧提示词）
        if (saved.enableAiCompanion && saved.id && !saved.aiCompanionPrompt) {
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
      if (val) {
        // 新建 + 开启：先自动创建探究，再生成提示词，用户看到后可修改再保存
        const htmlOk = explorationHtml.trim().length >= 100;
        if (!explorationTitle.trim() || !htmlOk) {
          MessagePlugin.warning("请先完善探究内容和标题后再开启AI伴学");
          return;
        }
        setExplorationEnableAiCompanion(true);
        try {
          const token = localStorage.getItem("token") || "";
          // 自动创建探究（有了ID才能调生成API）
          const res = await fetch("/api/exploration-activities", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              subProjectId: explorationPanelSpId,
              title: explorationTitle,
              htmlContent: explorationHtml,
              enableSubmission: explorationEnableSubmission,
              enableAiCompanion: true,
              designPrompt: initialPrompt,
              analysisPrompt: explorationPrompt,
              chatHistory: chatMessages,
            }),
          });
          if (!res.ok) throw new Error("创建失败");
          const saved = await res.json();
          setExplorationEditId(saved.id);
          setExplorations((prev) => [saved, ...prev]);
          // 同上：统一清单来自 /api/tasks，自动创建后也要刷新，否则清单看不到这条探究
          fetchTasks();
          // 同步预览（本地渲染注入版）
          setExplorationPreview(renderLocalPreview(saved.htmlContent ?? explorationHtml, {
            enableSubmission: saved.enableSubmission,
            enableAiCompanion: true,
            collectProfile: saved.collectProfile ? parseCollectProfile(saved.collectProfile) : null,
            explorationId: saved.id,
          }));
          if (saved.collectProfile) setExplorationCollectProfile(parseCollectProfile(saved.collectProfile));

          // 生成伴学提示词
          setAiCompanionStatus("analyzing");
          const genRes = await fetch(
            `/api/exploration-activities/${saved.id}/generate-companion-prompt`,
            { method: "POST", headers: { Authorization: `Bearer ${token}` } }
          );
          if (genRes.ok) {
            const data = await genRes.json();
            setAiCompanionPromptText(data.aiCompanionPrompt || "");
            setAiCompanionStatus("ready");
            MessagePlugin.success("AI伴学提示词已生成，您可以修改后保存");
          } else {
            const errData = await genRes.json().catch(() => ({}));
            throw new Error((errData as any).error || "提示词生成失败");
          }
        } catch (e: any) {
          setExplorationEnableAiCompanion(false);
          setAiCompanionStatus("error");
          MessagePlugin.error("AI伴学启用失败：" + (e?.message || "未知错误"));
        }
      } else {
        setExplorationEnableAiCompanion(false);
      }
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

        // 同步更新预览和源代码编辑区（源码区纯净稿，预览本地渲染注入版）
        if (saved.htmlContent) {
          setExplorationHtml(saved.htmlContent); // 源码区：纯净版
          setExplorationPreview(renderLocalPreview(saved.htmlContent, {
            enableSubmission: saved.enableSubmission,
            enableAiCompanion: true,
            collectProfile: saved.collectProfile ? parseCollectProfile(saved.collectProfile) : null,
            explorationId: saved.id,
          }));
          if (saved.collectProfile) setExplorationCollectProfile(parseCollectProfile(saved.collectProfile));
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
          // 同步更新预览和源代码编辑区（源码区纯净稿；关闭伴学后预览仍按提交开关本地渲染）
          if (saved.htmlContent) {
            setExplorationHtml(saved.htmlContent);
            setExplorationPreview(renderLocalPreview(saved.htmlContent, {
              enableSubmission: saved.enableSubmission,
              enableAiCompanion: false,
              collectProfile: saved.collectProfile ? parseCollectProfile(saved.collectProfile) : null,
              explorationId: saved.id,
            }));
            if (saved.collectProfile) setExplorationCollectProfile(parseCollectProfile(saved.collectProfile));
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

    // 新架构：提交/伴学注入由读取路径 renderExplorationHtml 内存渲染，保存只落纯净稿 + 开关。
    // ⛔ DO NOT REVERT：保存前不再走「AI 预览确认注入」流程（提交 UI 不再于保存时注入落库）。
    //    采集桩（AI 插桩）在「启用提交」开关切换时完成；未接桩仅降级为基础采集（UI 已黄条提示）。
    await doSaveExploration();
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
        // ⚠️ GOTCHA（2026-10-13）：统一清单来自 /api/tasks（buildUnifiedActs），漏刷新会导致
        //   已删除的探究仍挂在「课堂活动（按授课顺序）」清单上。与保存分支同款修复。
        fetchTasks();
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
    setTogglingExplorationId(e.id);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/exploration-activities/${e.id}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: checked }),
      });
      if (res.ok) {
        // 同步更新 explorations state
        setExplorations((prev) => prev.map((item) => item.id === e.id ? { ...item, enabled: checked } : item));
        // 同步更新 tasks state，避免数据不一致导致刷新闪烁
        setTasks((prev) =>
          prev.map((t) => ({
            ...t,
            subProjects: t.subProjects.map((sp) => ({
              ...sp,
              explorationActivities: (sp.explorationActivities || []).map((ea: any) =>
                ea.id === e.id ? { ...ea, enabled: checked } : ea
              ),
            })),
          }))
        );
        MessagePlugin.success(checked ? "探究已生效" : "探究已失效");
      } else {
        MessagePlugin.error("切换失败");
      }
    } catch {
      MessagePlugin.error("切换失败");
    } finally {
      setTogglingExplorationId(null);
    }
  };

  // 清除探究的学生提交（失效后、改内容前的逃生口）
  const handleClearExplorationSubmissions = async (explorationId: string) => {
    if (!confirm("确定要清除本探究的全部学生提交吗？\n\nQuickForm 收集的答案将一并清空。\n\n此操作不可撤销！")) return;
    setClearingSubmissionsExplorationId(explorationId);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/exploration-activities/${explorationId}/clear-submissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        // ⚠️ GOTCHA（2026-10-13）：统一清单卡片「N份提交」meta 来自 /api/tasks 的 _count
        //   （buildUnifiedActs 读 t.subProjects[].explorationActivities[]._count.ExplorationSubmission），
        //   原先这里只刷新旧面板 explorations state，导致已清除提交、卡片仍显示「N份提交」。
        // ⛔ DO NOT REVERT：必须先 fetchTasks() 归零统一清单计数（编辑锁定 / 卡片 meta 都依赖它）。
        // 🔗 RELATED：handleClearAttempts 同款修复（作业「N人已答」）；
        //   reorderAcrossTypes 633-637 行的「先 fetchTasks 再面板兜底重拉」是同一模式。
        fetchTasks();
        // 旧面板列表来自独立 state（fetchTasks 不更新），面板开着时单独重拉保持一致
        if (explorationPanelSpId) {
          const refreshRes = await fetch(`/api/exploration-activities?subProjectId=${explorationPanelSpId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const refreshData = await refreshRes.json();
          setExplorations(Array.isArray(refreshData) ? refreshData : []);
        }
        MessagePlugin.success(`已清除 ${data.deletedCount ?? 0} 条提交`);
      } else {
        MessagePlugin.error(data.error || "清除失败");
      }
    } catch {
      MessagePlugin.error("请求失败");
    } finally {
      setClearingSubmissionsExplorationId(null);
    }
  };

  // 探究排序
  // 📐 已切到跨类型统一排序（与对话/项目/作业同一套逻辑），详见上方「跨类型统一活动排序」注释块
  const handleExplorationReorder = async (expId: string, direction: "up" | "down") => {
    if (!explorationPanelSpId) return;
    await reorderAcrossTypes("exploration", expId, direction, explorationPanelSpId);
  };

  // 编辑已有探究
  const openEditExploration = (e: any) => {
    // ⛔ DO NOT REVERT：有学生提交时禁止进入编辑（2026-09-25 用户拍板）。
    //   旧设计是「编辑器照开、HTML 锁定、标题/提示词仍可改」，但用户明确要求入口拦截并提示
    //   「已有学生提交，请清除后编辑！」。清除路径：先失效（开关）→「清除提交」→ 再编辑。
    //   _count 来自列表接口（/api/exploration-activities?subProjectId= 的 include _count），
    //   清除提交成功后会重拉列表归零（见 handleClearExplorationSubmissions），拦截自然解除。
    // 🔗 RELATED：清除提交按钮（本文件，仅 !enabled 且有提交时显示）；
    //   编辑器内 explorationHasSubmissions 锁定与服务端 PUT 字段锁
    //   （[id]/route.ts existingSubs>0 分支）都保留作兜底——防列表数据滞后
    //   （老师开着面板期间学生刚提交）时漏拦。
    if ((e._count?.ExplorationSubmission ?? 0) > 0) {
      MessagePlugin.warning("已有学生提交，请清除后编辑！");
      return;
    }
    setExplorationEditId(e.id);
    setExplorationTitle(e.title);
    setInitialPrompt(e.designPrompt || ""); // 首轮设计意图（保存的 designPrompt）
    setDraftInput("");
    setChatMessages([]);
    setActiveTab("preview");
    setExplorationPrompt(e.analysisPrompt || "");
    // 源码编辑区保持纯净稿（去除 AI 伴学注入代码），预览区使用含注入版本
    // 列表接口已瘦身不再返回 htmlContent，统一从详情接口按需拉取（避免列表页传输大段HTML）
    const rawHtml = e.htmlContent || "";
    const cleanRaw = e.enableAiCompanion ? stripAiCompanionCode(rawHtml) : rawHtml;
    setExplorationHtml(cleanRaw);
    setExplorationPreview(rawHtml);
    // 版本栈：编辑已有探究，初始为当前 HTML 作为 v0
    if (rawHtml) {
      setHtmlVersions([cleanRaw]);
      setVersionIndex(0);
    } else {
      setHtmlVersions([]);
      setVersionIndex(-1);
    }
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
    // ⚠️ 这里**故意不打开**弹窗：列表接口已不下发 htmlContent 与提示词正文，
    //    必须等下面详情拉回来再打开。否则就是「先开弹窗、后补数据」——
    //    一旦详情拉取失败，源码区 / 预览区 / 提示词会全为空，用户一保存就把
    //    库里的探究正文和提示词整片清空。
    //    （真正打开弹窗的动作在下方 async 块的成功分支末尾）

    // 从详情接口获取完整 htmlContent（列表已瘦身，编辑时按需拉取）
    // 详情含注入版HTML + 最新提示词；预览用注入版，源码区保持纯净
    (async () => {
      try {
        const token = localStorage.getItem("token") || "";
        // 拉完整详情：/api/exploration-activities/[id] 始终返回完整字段
        // （含 htmlContent 正文与 designPrompt / analysisPrompt / aiCompanionPrompt）。
        // ⚠️ 编辑探究**必须**拿正文，所以这里不要改用 fetchTaskDetailLite（它会剥掉 htmlContent）。
        const detailRes = await fetch(`/api/exploration-activities/${e.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!detailRes.ok) {
          // 拿不到权威完整数据就**不进编辑态**（弹窗不开），避免空白内容覆盖数据库
          MessagePlugin.error("读取探究详情失败，请重试");
          return;
        }
        const detail = await detailRes.json();
        if (detail.htmlContent) {
          // GET 详情现在返回纯净稿（不含提交/伴学注入），源码区直接用；
          // 预览区本地渲染注入版（按 detail 的开关 + collectProfile，与学生端一致）。
          const clean = detail.htmlContent;
          setExplorationHtml(clean);          // 源码编辑区：纯净稿
          setExplorationPreview(renderLocalPreview(clean, {
            enableSubmission: detail.enableSubmission,
            enableAiCompanion: detail.enableAiCompanion,
            collectProfile: detail.collectProfile ? parseCollectProfile(detail.collectProfile) : null,
            explorationId: detail.id,
          }));
          if (detail.collectProfile) {
            setExplorationCollectProfile(parseCollectProfile(detail.collectProfile));
          }
          setOriginalHtmlForInjection(clean);
          // 详情是权威完整版，重建版本栈 v0
          setHtmlVersions([clean]);
          setVersionIndex(0);
          // 编辑回显：按「是否开启提交 + 采集是否已接桩」恢复 confirmedInjection。
          // ⛔ 别始终 false —— 否则编辑一个已开启提交（且已接桩）的探究时，
          //    会被误判成「未确认注入」，保存/开关切换时又弹 AI 预览（回归）。
          syncConfirmedInjection(!!detail.enableSubmission && !detectInstrumentation(clean).needsAdaptation);
        }
        // 已有提交数：列表接口不下发 _count，以详情为准更新（决定是否锁定 HTML 编辑）。
        // ⛔ 别漏这步 —— 否则 explorationHasSubmissions 恒为 false，锁定编辑/关闭提交拦截全部失效。
        setExplorationHasSubmissions((detail._count?.ExplorationSubmission ?? 0) > 0);
        // 提示词回显：详情是权威来源，无条件回填。
        // ⛔ 别再按长度过滤（原 length > 50 会把短提示词误判成空，导致「编辑时提示词不显示」）
        if (detail.aiCompanionPrompt) {
          setAiCompanionPromptText(detail.aiCompanionPrompt);
          setAiCompanionStatus("ready");
        }
        // 列表接口已剥离提示词正文，这两个提示词改由本详情接口补齐。
        // ⚠️ 别再依赖列表数据回填它们 —— 否则「首轮设计意图 / 分析提示词」会显示为空，
        //    用户一保存就把库里的内容清掉（契约见 fetchTaskDetailLite 上方说明）。
        if (detail.designPrompt !== undefined) setInitialPrompt(detail.designPrompt || "");
        if (detail.analysisPrompt !== undefined) setExplorationPrompt(detail.analysisPrompt || "");
        // 回显多轮对话历史到对话流：
        // ⛔ 优先用 chatHistory（库中持久化的完整对话流，含第二轮起的提示词）；
        //    无则回退到首轮 designPrompt 单条。否则「第二轮起的提示词」保存后再次打开会丢失（旧 bug）。
        //    （历史反馈「编辑时 html 提示词仍没显示」即因只回填 designPrompt 单条、丢失后续轮次。）
        if (Array.isArray(detail.chatHistory) && detail.chatHistory.length > 0) {
          setChatMessages(detail.chatHistory);
        } else if (detail.designPrompt) {
          setChatMessages([{ role: "user", content: detail.designPrompt }]);
        }
        // 数据已到齐，此刻才允许进入编辑态
        setExplorationModalVisible(true);
      } catch {
        // 详情拉取失败：同样不进编辑态（上面已 return / 这里已没有可用的权威数据）
        MessagePlugin.error("读取探究详情失败，请重试");
      }
    })();
  };

  // 打开教学预览（只读 iframe）
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const openPreview = (html: string) => {
    setPreviewHtml(html);
    setPreviewModalVisible(true);
  };

  // 对话活动上下排序
  // 📐 已切到跨类型统一排序（与探究/项目/作业同一套逻辑），详见上方「跨类型统一活动排序」注释块
  const handleConversationReorder = async (pcId: string, direction: "up" | "down", subProjectId: string | undefined): Promise<void> => {
    await reorderAcrossTypes("conversation", pcId, direction, subProjectId);
  };

  // 课堂作业上下排序
  // 📐 已切到跨类型统一排序（与对话/探究/项目同一套逻辑），详见上方「跨类型统一活动排序」注释块。
  // 原本地乐观交换已删：跨类型交换后作业在类内的顺序可能不变（变的是与其他类型的相对位置），
  // 乐观交换会给出错误反馈；统一在 reorderAcrossTypes 内重拉 quizzes。
  const handleQuizReorder = async (quizId: string, direction: "up" | "down", subProjectId: string) => {
    await reorderAcrossTypes("quiz", quizId, direction, subProjectId);
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
    fetchImageGroups();
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
        // 排序：启用的排最前，未启用的沉底（ENABLED -> ENDED -> DISABLED），同状态内按创建时间倒序
        const statusRank: Record<string, number> = { ENABLED: 0, ENDED: 1, DISABLED: 2 };
        const sortedData = [...data].sort((a: any, b: any) => {
          const ra = statusRank[a.status] ?? 3;
          const rb = statusRank[b.status] ?? 3;
          if (ra !== rb) return ra - rb;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        setTasks(sortedData);
        // 仅在首次加载时决定展开哪门课：优先恢复上次停留的位置，其次才默认展开第一门
        if (initial) {
          const enabledSpIdsOf = (list: LearningTask[]) => {
            const ids = new Set<string>();
            list.forEach((t: LearningTask) => {
              if (t.status === "ENABLED") {
                t.subProjects.forEach((sp) => {
                  if (sp.id) ids.add(sp.id);
                });
              }
            });
            return ids;
          };
          const openFirstSp = (task: LearningTask) => {
            const firstSp = task.subProjects?.[0];
            if (firstSp?.id) {
              openQuizPanel(firstSp.id, task);
              // 同时自动加载互动探究列表（如果已有探究项目，面板会立刻显示；没有则无影响）
              openExplorationPanel(firstSp.id, task);
            }
          };

          const saved = readTasksViewState();
          const savedTask = saved?.taskId ? sortedData.find((t: LearningTask) => t.id === saved.taskId) : undefined;
          const enabledTask = sortedData.find((t: LearningTask) => t.status === "ENABLED");

          if (saved?.exclusiveTaskId) {
            // 独占聚焦下打开新网页（分析/报告等）后返回：恢复独占聚焦，仍停在那门课上（2026-10-13）
            const exTask = sortedData.find((t: LearningTask) => t.id === saved.exclusiveTaskId);
            const validSpIds = enabledSpIdsOf(sortedData);
            if (exTask) {
              // 与卡片头进入独占的 onClick 行为保持一致：置顶 + 回第一页 + 展开子活动
              setPrevTaskPage(safePage);
              setExclusiveTaskId(exTask.id);
              setExpandedTaskId(exTask.id);
              setCurrentPage(1);
              const restoredSpIds = (saved?.spIds || []).filter((id) => validSpIds.has(id));
              const restoredSpIdSet = restoredSpIds.length > 0 ? new Set(restoredSpIds) : validSpIds;
              setExpandedSpIds(restoredSpIdSet);
              openFirstSp(exTask);
              setTimeout(() => {
                window.scrollTo({ top: 0 });
                viewStateRef.current = {
                  taskId: exTask.id,
                  spIds: Array.from(restoredSpIdSet),
                  scrollY: 0,
                  exclusiveTaskId: exTask.id,
                };
                viewReadyRef.current = true;
              }, 250);
            } else {
              // 独占的课堂已不存在（可能被删除）：按全收起处理，不恢复独占
              viewStateRef.current = { taskId: null, spIds: [], scrollY: 0, exclusiveTaskId: null };
              viewReadyRef.current = true;
            }
          } else if (savedTask) {
            // 恢复上次停留的课堂与展开的子活动
            const validSpIds = enabledSpIdsOf(sortedData);
            setExpandedTaskId(savedTask.id);
            // 只恢复仍然存在的子活动；一个都对不上（如刚编辑过课程、子活动被重建）就整体展开，避免"展开了却空着"
            const restoredSpIds = (saved?.spIds || []).filter((id) => validSpIds.has(id));
            const restoredSpIdSet = restoredSpIds.length > 0 ? new Set(restoredSpIds) : validSpIds;
            setExpandedSpIds(restoredSpIdSet);
            // 该课堂若不在第一页，自动翻到它所在的那一页
            const savedIndex = sortedData.findIndex((t: LearningTask) => t.id === savedTask.id);
            if (savedIndex >= 0) setCurrentPage(Math.floor(savedIndex / pageSize) + 1);
            openFirstSp(savedTask);

            // 等这一帧渲染完，把画面滚回上次的位置
            const savedScrollY = saved?.scrollY || 0;
            const restoredTaskId = savedTask.id;
            const restoredSpIdsArray = Array.from(restoredSpIdSet);
            setTimeout(() => {
              const el = document.getElementById(`task-card-${restoredTaskId}`);
              if (savedScrollY > 0) window.scrollTo({ top: savedScrollY });
              else if (el) el.scrollIntoView({ block: "start" });
              viewStateRef.current = { taskId: restoredTaskId, spIds: restoredSpIdsArray, scrollY: savedScrollY };
              viewReadyRef.current = true;
            }, 250);
          } else if (saved && saved.taskId === null) {
            // 上次退出时明确是"全收起"状态（手动收起全部课堂 / 主动退出独占）：
            // 保持全收起，不默认展开，不打开任何子活动（2026-10-13）
            viewStateRef.current = { taskId: null, spIds: [], scrollY: 0, exclusiveTaskId: null };
            viewReadyRef.current = true;
          } else if (enabledTask) {
            // 没有历史记录（首次进入，或标签页已关闭）：保持原有默认行为——展开第一门课
            const allSpIds = enabledSpIdsOf(sortedData);
            setExpandedTaskId(enabledTask.id);
            setExpandedSpIds(allSpIds);
            openFirstSp(enabledTask);
            viewStateRef.current = { taskId: enabledTask.id, spIds: Array.from(allSpIds), scrollY: 0 };
            viewReadyRef.current = true;
          } else {
            viewReadyRef.current = true;
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

  const fetchImageGroups = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/image-groups", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setImageGroups(
          data
            .filter((g: { id: string; name: string; enabled: boolean; images: unknown[] }) => g.enabled)
            .map((g: { id: string; name: string; enabled: boolean; images: unknown[] }) => ({
              id: g.id,
              name: g.name,
              enabled: g.enabled,
              imageCount: g.images?.length || 0,
            }))
        );
      }
    } catch {
      console.error("获取图片组失败");
    }
  };

  const toggleImageGroupSelection = (groupId: string) => {
    setSelectedImageGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
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
    setObjectivesBackup(null);
    setFormClassIds([]);
    setSelectedKbIds([]);
    setSelectedImageGroupIds([]);
    setEditingTask(null);
    setFormStudentTemplateId("");
    setFormClassTemplateId("");
    setFormAnalysisPrompt("");
    setFormClassAnalysisPrompt("");
  };

  // ===== 课堂作业 inline 功能 =====
  const openQuizPanel = (spId: string, task: LearningTask) => {
    const sp = (task.subProjects as any[]).find((s: any) => s.id === spId);
    setQuizzes((sp?.quizActivities as any[]) ?? []);
    setQuizPanelSpId(spId);
    setQuizPanelVisible(true);
  };

  const closeQuizPanel = () => {
    setQuizPanelVisible(false);
    setQuizPanelSpId(null);
    setQuizzes([]);
  };

  // Step 1: 编辑已有作业（从列表进入设计模式）
  const startEditQuiz = (q: any) => {
    // ⛔ DO NOT REVERT：有答题记录时禁止快编 —— 服务端 PUT /api/quiz-activities/[id]
    //   对 attemptCount>0 一律 403（所有字段都改不了），这里不拦的话老师改半天、
    //   保存时才报错。与探究「编辑」入口拦截（openEditExploration）口径一致。
    //   清除路径：失效 →「清除答题」→ 再编辑；「题目管理」页仍可进入查看（自带只读横幅）。
    if ((q._count?.attempts ?? 0) > 0) {
      MessagePlugin.warning("已有学生提交，请清除后编辑！");
      return;
    }
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

  // 导入作业题目（JSON 文件）
  const handleImportQuestionsToDesign = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingQuestions(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        let imported: any[] = [];
        if (Array.isArray(data)) {
          imported = data;
        } else if (data.questions && Array.isArray(data.questions)) {
          imported = data.questions;
          // 如果 JSON 包含 title 且当前标题为空，自动填入
          if (data.title && !quizDesignTitle.trim()) {
            setQuizDesignTitle(data.title);
          }
        } else {
          throw new Error("JSON 格式不正确，需包含 questions 数组");
        }
        // 标准化题目
        const standardized = imported.map((q: any, i: number) => ({
          type: q.type || "SINGLE_CHOICE",
          content: q.content || "",
          options: typeof q.options === "string" ? q.options : JSON.stringify(q.options || {}),
          answer: q.answer || "A",
          difficulty: q.difficulty || "BASIC",
          explanation: q.explanation || "",
          order: quizDesignQuestions.length + i,
        }));
        setQuizDesignQuestions((prev) => [...prev, ...standardized]);
        MessagePlugin.success(`成功导入 ${standardized.length} 道题`);
      } catch (err: any) {
        MessagePlugin.error(err.message || "导入失败");
      } finally {
        setImportingQuestions(false);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
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
      // ⚠️ GOTCHA（2026-10-13）：统一清单「课堂活动（按授课顺序）」读 /api/tasks（buildUnifiedActs），
      //   下方只刷新作业面板 quizzes state；漏调 fetchTasks 会导致新建/编辑作业后清单不显示/标题不更新。
      // 🔗 RELATED: 探究保存、handleQuizDelete 同款修复。
      fetchTasks();
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
        // ⚠️ GOTCHA（2026-10-13）：统一清单来自 /api/tasks（buildUnifiedActs），漏刷新会导致
        //   已删除的作业仍挂在「课堂活动（按授课顺序）」清单上。与探究删除同款修复。
        fetchTasks();
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
        // ⚠️ GOTCHA（2026-10-13）：统一清单卡片「N人已答」meta 来自 /api/tasks 的 _count
        //   （buildUnifiedActs 读 t.subProjects[].quizActivities[]._count.attempts），
        //   原先这里只刷新旧面板 quizzes state，导致已清除答题、卡片仍显示「N人已答」。
        // ⛔ DO NOT REVERT：必须先 fetchTasks() 归零统一清单计数（清除答题按钮显隐也依赖它）。
        // 🔗 RELATED：handleClearExplorationSubmissions 同款修复（探究「N份提交」）。
        fetchTasks();
        // 旧面板列表来自独立 state（fetchTasks 不更新），面板开着时单独重拉保持一致
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

  // ── 按需拉取课堂详情（「列表瘦身契约」的前端那一半） ──────────────────────
  // ⚠️ 为什么必须存在：GET /api/tasks（列表接口）**有意不下发**提示词正文
  //   （systemPrompt / analysisPrompt / classAnalysisPrompt / designPrompt /
  //    aiCompanionPrompt）与探究 HTML 正文 —— 实测 8 个课堂的列表响应 372 KiB 里
  //   89% 是这些大字段，而数据库查询只要 14ms，所以「课堂管理页打开慢」的根因
  //   就是每次刷新都要传它们。瘦身后 372 KiB → 65.5 KiB（降 82.4%）。
  //
  //   代价：编辑弹窗不能再拿列表数据直接初始化表单，必须**先拉详情**，
  //   否则输入框是空的，用户一保存就把库里原有的提示词清掉（真实数据丢失）。
  //
  // ⛔ 调用约定（以后新加编辑入口务必遵守）：
  //   凡是「打开一个会把提示词/正文回写到数据库的表单或编辑器」，都必须先
  //   `await` 本函数；拿不到 detail 就 `MessagePlugin.error(...)` + `return`，
  //   **不要**先打开弹窗再补数据，也**不要**拿列表对象兜底（那等于用空值覆盖数据库）。
  //   现有 4 个调用点：
  //     - openEditForm（编辑课堂）            → 本函数（lite）
  //     - startEditingSubProjects（编辑子活动） → 本函数（lite）
  //     - openEditConversationDialog（编辑对话活动）→ GET /api/preset-conversations/[id]
  //     - openEditExploration（编辑探究）      → GET /api/exploration-activities/[id]（要正文，不带 lite）
  //
  // lite=1：不带探究 HTML 正文（单课可达数百 KB，编辑课堂/子活动并不需要它）。
  // 接口侧契约（为什么列表要剥、为什么不能加回去）见
  // src/app/api/tasks/route.ts GET 分支顶部的「列表瘦身契约」注释块。
  // ──────────────────────────────────────────────────────────────────────────
  const fetchTaskDetailLite = async (taskId: string): Promise<any | null> => {
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/tasks/${taskId}?lite=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // 编辑课堂：⚠️ 必须**先拿到详情再打开表单**（原因见 fetchTaskDetailLite 上方的契约）。
  // 拉取失败直接 return —— 不要退化成「用列表里的 task 对象打开表单」，
  // 那样提示词框是空的，用户一点保存就会把库里已有的提示词覆盖成空。
  const openEditForm = async (task: LearningTask) => {
    const detail = await fetchTaskDetailLite(task.id);
    if (!detail) {
      MessagePlugin.error("读取课堂详情失败，请重试");
      return;
    }
    setEditingTask(detail as LearningTask);
    setFormTitle(detail.title || "");
    setFormDescription(detail.description || "");
    setFormGrade(detail.grade || "");
    setFormSubject(detail.subject || "");
    setFormClassIds((detail.assignments || []).map((a: any) => a.classId));
    // 设置分析提示词到独立 state
    setFormAnalysisPrompt(detail.analysisPrompt || "");
    setFormClassAnalysisPrompt(detail.classAnalysisPrompt || "");
    try {
      const ids = detail.knowledgeBaseIds ? JSON.parse(detail.knowledgeBaseIds) : [];
      setSelectedKbIds(Array.isArray(ids) ? ids : []);
    } catch {
      setSelectedKbIds([]);
    }
    try {
      const imgIds = detail.imageGroupIds ? JSON.parse(detail.imageGroupIds) : [];
      setSelectedImageGroupIds(Array.isArray(imgIds) ? imgIds : []);
    } catch {
      setSelectedImageGroupIds([]);
    }
    setFormVisible(true);
  };

  // AI 按学科核心素养生成/优化课堂目标（目标框有内容时为优化模式）
  const handleAIObjectives = async () => {
    if (!formTitle.trim()) {
      MessagePlugin.error("请先填写课题");
      return;
    }
    if (!formGrade) {
      MessagePlugin.error("请先选择年级");
      return;
    }
    if (!formSubject) {
      MessagePlugin.error("请先选择学科");
      return;
    }
    setGeneratingObjectives(true);
    startGenOverlay("AI 思考中...");
    const wasOptimize = formDescription.trim().length > 0;
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/tasks/generate-objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: formTitle,
          grade: formGrade,
          subject: formSubject,
          currentContent: formDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        MessagePlugin.error(data.error || "生成失败，请重试");
        return;
      }
      setObjectivesBackup(formDescription);
      setFormDescription(data.objectives);
      if (data.warning) {
        MessagePlugin.warning(data.warning);
      } else {
        MessagePlugin.success(wasOptimize ? "已按学科核心素养优化课堂目标" : "已按学科核心素养生成课堂目标");
      }
    } catch {
      MessagePlugin.error("网络错误，请重试");
    } finally {
      stopGenOverlay();
      setGeneratingObjectives(false);
    }
  };

  // 撤销 AI 生成/优化，恢复之前的内容
  const restoreObjectives = () => {
    if (objectivesBackup !== null) {
      setFormDescription(objectivesBackup);
      setObjectivesBackup(null);
    }
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
        imageGroupIds: selectedImageGroupIds.length > 0 ? JSON.stringify(selectedImageGroupIds) : null,
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
          // 新建课堂后自动展开新卡片。
          // ⛔ DO NOT REVERT: 旧的「自动进入对话编辑态」（setEditingTaskId/setEditingSubProjects）已随
          // 按类型分组旧区块删除——editingSubProjects 的全部 UI 消费点没了，写进去也无人读。
          setExpandedTaskId(data.id);
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

  // ⛔ DO NOT REVERT: 旧「编辑学习活动」内联链路（startEditingSubProjects / cancelEditingSubProjects /
  // addPresetConversation / removePresetConversation / moveConversation / updatePresetConversation /
  // saveSubProjects）已整体删除——它们只服务已删除的按类型分组旧区块；且 saveSubProjects 的 PUT
  // body 只带对话数据，走它保存会依赖后端「快照恢复」兜底探究/项目/作业（PUT route.ts），
  // 统一清单时代编辑入口已收敛到各活动弹窗 + 课堂编辑弹窗，不要把这条旧链路加回来。
  // 🔗 RELATED: 课堂编辑弹窗（fetchTaskDetailLite 契约）、src/app/api/tasks/[taskId]/route.ts PUT。

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

  const findConversationPromptTemplateId = (systemPrompt?: string) => {
    if (!systemPrompt) return "";
    const t = conversationTemplates.find((tpl) => systemPrompt.startsWith(tpl.content));
    return t ? t.id : "";
  };

  // 当前页要渲染的课堂（已按状态排序后的全量 tasks 切片）
  const totalPages = Math.max(1, Math.ceil(tasks.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  // 独占聚焦时目标课堂置顶到列表首（保证其在第一页可见），其余保持原序
  const displayTasks = exclusiveTaskId
    ? [...tasks.filter((t) => t.id === exclusiveTaskId), ...tasks.filter((t) => t.id !== exclusiveTaskId)]
    : tasks;
  const pagedTasks = displayTasks.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <TeacherLayout>
      {/* 生成进度浮层：单一实例，滚动圈 + 真实递增秒数（替代会堆叠的 MessagePlugin.loading） */}
      {genOverlay.visible && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/30">
          <div className="bg-[var(--card-bg)] rounded-xl px-10 py-7 flex flex-col items-center gap-3 shadow-2xl">
            <span className="inline-block w-9 h-9 border-[3px] border-[var(--primary-light)] border-t-[var(--primary)] rounded-full animate-spin" />
            <div className="text-sm text-[var(--foreground)] whitespace-nowrap">{genOverlay.text}</div>
            <div className="text-xs text-[var(--muted-light)] tabular-nums">{genOverlay.seconds}s</div>
          </div>
        </div>
      )}
      <div className="space-y-6 pb-8">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-[var(--title)]">课堂管理</h2>
            <p className="text-[var(--muted)] text-sm mt-1">创建课堂，分配给班级，管理对话活动、互动探究、课堂作业</p>
          </div>
          <div className="flex gap-2">
            <Button
              theme="primary"
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
                    // 导入可能在导入者账号下新建知识库，需同步知识库列表，否则展开卡片时知识库名称不显示
                    await fetchKnowledgeBases();
                    // 自动展开导入的课堂并加载互动探究和作业面板
                    setExpandedTaskId(importedTask.id);
                    // 从刷新后的任务列表中获取 subProject ID（更可靠）
                    const refreshedTask = updatedTasks.find((t: any) => t.id === importedTask.id);
                    const targetTask = refreshedTask || importedTask;
                    if (targetTask.subProjects?.length > 0) {
                      const firstSpId = targetTask.subProjects[0].id;
                      if (firstSpId) {
                        setExpandedSpIds(new Set([firstSpId]));
                        openExplorationPanel(firstSpId, targetTask);
                        openQuizPanel(firstSpId, targetTask);
                      }
                    }
                  } else {
                    const err = await res.json().catch(() => ({}));
                    MessagePlugin.error(err.detail || err.error || "导入失败");
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

        {activeView ? (
          <ViewFrame
            src={activeView.src}
            title={activeView.title}
            onBack={() => setActiveView(null)}
          />
        ) : loading ? (
          <div className="text-center text-[var(--muted-light)] py-12">加载中...</div>
        ) : tasks.length === 0 ? (
          <Card className="template-compact-card" style={{ boxShadow: 'var(--card-shadow)' }}>
            <div className="text-center py-12 text-[var(--muted-light)]">
              <p className="text-lg mb-2">📋</p>
              <p>暂无课堂</p>
              <p className="text-sm mt-2">点击「创建课堂」开始</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {pagedTasks.map((task) => {
              const isExpanded = expandedTaskId === task.id;
              // 独占聚焦时：目标课堂显示并展开，其余课堂透明淡出（保留 DOM 做平滑过渡）
              // 退出过渡中（expandedTaskId 已清、exclusiveTaskId 尚在）：不再隐藏其余课堂，
              // 让列表与目标课堂收缩同步淡入，避免收缩完成后列表"闪跳"出现（2026-10-14）
              const isExclusiveHidden =
                exclusiveTaskId !== null && exclusiveTaskId !== task.id && expandedTaskId !== null;
              // 四类活动数量统计：头部不再直接展示，收拢到"信息预览"悬停提示（2026-10-13）
              const counts = task.subProjects?.reduce(
                (acc, sp) => {
                  acc.conversations += ((sp as any).presetConversations?.length ?? 0);
                  acc.quizzes += ((sp as any).quizActivities?.length ?? 0);
                  acc.projects += ((sp as any).projectSubmissions?.length ?? 0);
                  acc.explorations += ((sp as any).explorationActivities?.length ?? 0);
                  return acc;
                },
                { conversations: 0, quizzes: 0, projects: 0, explorations: 0 }
              ) ?? { conversations: 0, quizzes: 0, projects: 0, explorations: 0 };
              return (
                <Card
                  key={task.id}
                  className={`template-compact-card transition-all duration-300 ${
                    isExclusiveHidden
                      ? "opacity-0 scale-[0.98] pointer-events-none"
                      : "opacity-100 scale-100"
                  } ${
                    exclusiveTaskId === task.id && expandedTaskId === task.id
                      ? "ring-2 ring-[var(--primary)]"
                      : ""
                  }`}
                >
                  <div
                    id={`task-card-${task.id}`}
                    className="cursor-pointer"
                    onClick={() => {
                      if (exclusiveTaskId === task.id) {
                        // 独占中再点 → 收缩退出独占：不展开，恢复原分页与全部课堂
                        exitExclusive();
                      } else {
                        // 记录原分页页号，进入独占聚焦（置顶 + 回第一页）
                        // 先取消上一个"退出独占"的延迟恢复，防止收缩动画期间点击其他课堂时旧定时器误恢复分页（2026-10-14）
                        clearExitExclusiveTimer();
                        setPrevTaskPage(safePage);
                        setExclusiveTaskId(task.id);
                        setExpandedTaskId(task.id);
                        setCurrentPage(1);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                        // 展开课堂时自动加载探究和作业面板
                        const firstSp = task.subProjects?.[0];
                        if (firstSp?.id) {
                          openQuizPanel(firstSp.id, task);
                          openExplorationPanel(firstSp.id, task);
                        }
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDownIcon className="text-[var(--muted-light)]" />
                        ) : (
                          <ChevronRightIcon className="text-[var(--muted-light)]" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <Popup
                              trigger="hover"
                              placement="top-left"
                              visible={previewTaskId === task.id}
                              onVisibleChange={(v) => {
                                if (v) {
                                  clearPreviewTimer();
                                  setPreviewTaskId(task.id);
                                  previewTimer.current = window.setTimeout(() => {
                                    setPreviewTaskId(null);
                                    previewTimer.current = null;
                                  }, 3000);
                                } else {
                                  clearPreviewTimer();
                                  setPreviewTaskId(null);
                                }
                              }}
                              content={
                                <div className="preview-popup-anim space-y-1 text-xs leading-5 min-w-[180px]">
                                  <div>
                                    班级：
                                    {task.assignments.length > 0
                                      ? task.assignments.map((a) => a.class.name).join("、")
                                      : "未分配"}
                                  </div>
                                  {task.grade && <div>年级：{task.grade}</div>}
                                  {task.subject && <div>学科：{task.subject}</div>}
                                  <div>
                                    活动：对话 {counts.conversations} ｜ 作业 {counts.quizzes} ｜ 项目{" "}
                                    {counts.projects} ｜ 探究 {counts.explorations}
                                  </div>
                                </div>
                              }
                            >
                              <span className="inline-flex cursor-pointer text-[var(--muted)] hover:text-[var(--primary)]">
                                <InfoCircleIcon />
                              </span>
                            </Popup>
                            <h3 className="font-medium text-[var(--title)]">{task.title}</h3>
                            {getStatusTag(task.status)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {/* 课堂卡片管理按钮组：全部统一 theme="primary" 跟随主题主色。
                            ⛔ DO NOT REVERT: 状态切换/分析/重置/导出/删除等卡片管理按钮不再混用
                            success/warning/danger/default 语义色（用户 2026-10-13 要求，与下方
                            活动统一管理行同一口径）。删除确认弹窗按钮仍保留 danger/warning 危险语义。 */}
                        <Button
                          theme="primary"
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
                          <Button
                            theme="primary"
                            variant="text"
                            size="small"
                            icon={<ChartBarIcon />}
                            onClick={() => goTo(`/teacher/tasks/${task.id}/insights`)}
                          />
                        </Tooltip>
                        <Tooltip content="重置清理学生记录">
                          <Button
                            theme="primary"
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
                            theme="primary"
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
                        <Tooltip content="导出手册">
                          <Button
                            theme="primary"
                            variant="text"
                            size="small"
                            icon={<DownloadIcon />}
                            onClick={() => {
                              const token = localStorage.getItem("token") || "";
                              fetch(`/api/tasks/${task.id}/manual`, {
                                headers: { Authorization: `Bearer ${token}` },
                              })
                                .then((res) => {
                                  if (!res.ok) {
                                    return res.json().then((d) => {
                                      throw new Error(d.detail || d.error || "导出失败");
                                    });
                                  }
                                  return res.blob();
                                })
                                .then((blob) => {
                                  const uri = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  const safeName = task.title
                                    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
                                    .replace(/\s+/g, "_")
                                    .substring(0, 30);
                                  a.href = uri;
                                  a.download = `${safeName}_教学手册.docx`;
                                  a.click();
                                  URL.revokeObjectURL(uri);
                                  MessagePlugin.success("教学手册已导出");
                                })
                                .catch((err) => MessagePlugin.error(err.message || "导出失败"));
                            }}
                          />
                        </Tooltip>
                        <Tooltip content="导出学习手册">
                          <Button
                            theme="primary"
                            variant="text"
                            size="small"
                            icon={<BookIcon />}
                            onClick={() => {
                              const token = localStorage.getItem("token") || "";
                              fetch(`/api/tasks/${task.id}/study-guide`, {
                                headers: { Authorization: `Bearer ${token}` },
                              })
                                .then((res) => {
                                  if (!res.ok) {
                                    return res.json().then((d) => {
                                      throw new Error(d.detail || d.error || "导出失败");
                                    });
                                  }
                                  return res.blob();
                                })
                                .then((blob) => {
                                  const uri = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  const safeName = task.title
                                    .replace(
                                      /[\\/:*?"<>|\r\n\t\s·•,，。、？！：；…—–""''‘’《》〈〉【】（）()\[\]]+/g,
                                      "_"
                                    )
                                    .replace(/^_+|_+$/g, "")
                                    .substring(0, 30);
                                  a.href = uri;
                                  a.download = `${safeName}_学习手册.docx`;
                                  a.click();
                                  URL.revokeObjectURL(uri);
                                  MessagePlugin.success("学习手册已导出");
                                })
                                .catch((err) => MessagePlugin.error(err.message || "导出失败"));
                            }}
                          />
                        </Tooltip>
                        <Tooltip content="删除课堂">
                          <Button
                            theme="primary"
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

                  {/* 展开/收起 Grid 折叠动画（2026-10-13）：0fr↔1fr 平滑过渡，替代瞬间条件渲染 */}
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                      isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="mt-2 pt-2 border-t border-[var(--card-border)] pl-8 space-y-3">
                      {/* 关联知识库 */}
                      {task.knowledgeBaseIds && (() => {
                        try {
                          const kbIds = JSON.parse(task.knowledgeBaseIds) as string[];
                          const linkedKbs = knowledgeBases.filter((kb) => kbIds.includes(kb.id));
                          if (linkedKbs.length > 0) {
                            const totalLen = linkedKbs.reduce((s, kb) => s + kb.contentLength, 0);
                            return (
                              <div className="text-sm text-[var(--muted)]">
                                <span className="text-[var(--muted)]">知识库：</span>
                                {linkedKbs.map((kb) => (
                                  <Tag key={kb.id} theme="primary" variant="light" size="small" style={{ marginRight: 4 }}>
                                    {kb.name}（{kb.contentLength.toLocaleString()}字）
                                  </Tag>
                                ))}
                                <span className="text-xs text-[var(--muted-light)] ml-1">共 {totalLen.toLocaleString()} 字符</span>
                              </div>
                            );
                          }
                        } catch { /* ignore */ }
                        return null;
                      })()}

                      {/* 关联图片组 */}
                      {(task as any).imageGroupIds && (() => {
                        try {
                          const gIds = JSON.parse((task as any).imageGroupIds) as string[];
                          const linkedGroups = imageGroups.filter((g) => gIds.includes(g.id));
                          if (linkedGroups.length > 0) {
                            return (
                              <div className="text-sm text-[var(--muted)]">
                                <span className="text-[var(--muted)]">图片组：</span>
                                {linkedGroups.map((g) => (
                                  <Tag key={g.id} theme="primary" variant="light" size="small" style={{ marginRight: 4 }}>
                                    {g.name}（{g.imageCount}张）
                                  </Tag>
                                ))}
                              </div>
                            );
                          }
                        } catch { /* ignore */ }
                        return null;
                      })()}

                      {/* 📐 跨类型统一活动清单（2026-10-12 升级为唯一管理入口）：按授课顺序展示 4 类活动，
                          新建/编辑/删除/预览/启停/分析/浏览提交/查看报告全部在本清单行内完成。
                          原按类型分组的 4 个管理区块（对话活动/互动探究/项目提交/课堂作业）已整体删除。
                          ⛔ DO NOT REVERT / DO NOT ADD THE 4 LEGACY TYPE BLOCKS BACK:
                          旧区块与本清单是同一批活动数据的两套入口，双入口曾导致「新建作业仍回到旧区块编辑、
                          老师在两处看到不同操作位」的困惑；要加新操作就加在行内按钮组里。
                          排序口径与 reorderAcrossTypes / src/lib/activities/unified-order.ts 一致：
                          启用活动在前按 sortOrder，停用沉底（学生端不显示停用活动）。
                          🔗 RELATED: buildUnifiedActs（raw 存原始对象）、handleCreateActivity（新建分发弹窗）、
                          本区块顶部内嵌的新建作业设计表单（依赖组件级 quizDesign* state 与 quizPanelSpId）。 */}
                      <div className="border border-[var(--primary-light)] bg-[var(--primary-light)] rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm text-[var(--muted)]">课堂活动（按授课顺序）</h4>
                          <Button theme="primary" variant="outline" size="small" icon={<EditIcon />} onClick={() => { if (task.subProjects.length === 0) { MessagePlugin.warning("请先创建学习活动"); return; } setNewActivityTask(task); setNewActivityDialogVisible(true); }}>新建活动</Button>
                        </div>
                        {/* 新建作业设计表单内嵌在统一清单顶部：用户从「新建活动」选择课堂作业后，直接在最顶部操作，无需滚到底部。
                            表单只依赖组件级 quizDesign* state 与 quizPanelSpId；与下方活动列表无渲染耦合。
                            🔗 RELATED: handleCreateActivity（入口）、handleSaveQuiz / exitQuizDesign / handleAIGenerateQuestions / handleImportQuestionsToDesign */}
                        {quizDesignMode && !quizDesignId && (
                          <div className="bg-[var(--card-bg)] rounded-lg p-4 space-y-3">
                            <input id="import-quiz-file" type="file" accept=".json" onChange={handleImportQuestionsToDesign} className="hidden" />
                            <div className="flex items-center justify-between">
                              <h5 className="font-medium text-sm text-[var(--muted)]">新建作业 · {quizDesignTitle || "（未命名）"}</h5>
                              <Button theme="primary" variant="text" size="small" onClick={exitQuizDesign}>× 退出设计</Button>
                            </div>
                            {quizDesignQuestions.length === 0 ? (
                              <>
                                <Input value={quizDesignTitle} onChange={(v) => setQuizDesignTitle(v)} placeholder="作业名称 *" size="small" />
                                <Input value={quizDesignDesc} onChange={(v) => setQuizDesignDesc(v)} placeholder="作业说明（选填）" size="small" />
                                <div>
                                  <div className="text-xs text-[var(--muted)] mb-1">选择作业设计模板</div>
                                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={selectedQuizTemplateId} onChange={(e) => { setSelectedQuizTemplateId(e.target.value); const tpl = templates.find((t: any) => t.id === e.target.value); setQuizDesignTemplateContent(tpl?.content || ""); }}>
                                    <option value="">请选择模板...</option>
                                    {(templates.filter((t: any) => t.type === "QUIZ_DESIGN") || []).map((t: any) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                                  </select>
                                  {!selectedQuizTemplateId && <div className="mt-2 p-3 bg-[var(--warning-light)] rounded-lg text-xs text-[var(--warning)]">提示：还没有作业设计模板？去「模板设置」页面创建一个。</div>}
                                  {selectedQuizTemplateId && (() => {
                                    const tpl: any = templates.find((t: any) => t.id === selectedQuizTemplateId);
                                    if (!tpl) return null;
                                    return (
                                      <div className="mt-2">
                                        <TemplatePreviewButton
                                          templateId={tpl.id}
                                          templateName={tpl.name}
                                          templateType={tpl.type}
                                          hasPreview={!!tpl.hasPreview}
                                          previewStale={!!tpl.previewStale}
                                        />
                                      </div>
                                    );
                                  })()}
                                </div>
                                <Textarea value={quizDesignTemplateContent} onChange={(v) => setQuizDesignTemplateContent(v)} placeholder="作业设计提示词..." rows={6} />
                                <div className="flex gap-2 items-center">
                                  <Button theme="primary" size="small" icon={<PlayIcon />} loading={generatingQuestions} onClick={handleAIGenerateQuestions} disabled={!quizDesignTitle.trim() || !selectedQuizTemplateId}>生成作业</Button>
                                  <Button theme="primary" variant="outline" size="small" loading={importingQuestions} disabled={!quizDesignTitle.trim()} onClick={() => document.getElementById('import-quiz-file')?.click()}>导入作业</Button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="space-y-3">
                                  {quizDesignQuestions.length > 0 && (
                                    <div className="space-y-3">
                                      <div className="text-xs font-medium text-[var(--muted)]">题目（共 {quizDesignQuestions.length} 道，可直接修改）</div>
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
                                  <div className="flex gap-2 items-center">
                                    <Button theme="primary" size="small" icon={<SaveIcon />} loading={savingQuiz} onClick={handleSaveQuiz}>保存作业</Button>
                                    <Button theme="default" variant="outline" size="small" loading={importingQuestions} onClick={() => document.getElementById('import-quiz-file')?.click()}>追加导入</Button>
                                  </div>
                                </div>
                              </>
                            )}
                            {generatingQuestions && <div className="text-center py-4 text-sm text-[var(--muted-light)]">AI 正在生成题目，请稍候...</div>}
                          </div>
                        )}
                        {(() => {
                          const acts = buildUnifiedActs(task);
                          if (acts.length === 0) {
                            return <div className="text-center py-3 text-sm text-[var(--muted-light)]">暂无活动，点击「新建活动」创建</div>;
                          }
                          const enabledCount = acts.filter((a) => a.enabled).length;
                          let enabledIdx = -1;
                          return (
                            <div className="space-y-1.5">
                              {acts.map((a, i) => {
                                if (a.enabled) enabledIdx += 1;
                                const myEnabledIdx = a.enabled ? enabledIdx : -1;
                                const raw = a.raw;
                                // 启用/停用分段：第一个停用活动前插入分隔条，上下两部分视觉分离（2026-10-13 用户要求）。
                                // 排序已保证启用在前、停用沉底（buildUnifiedActs），只需在边界行前加分隔。
                                const showDisabledDivider = !a.enabled && (i === 0 || acts[i - 1].enabled);
                                return (
                                  <Fragment key={`${a.type}-${a.id}`}>
                                    {showDisabledDivider && (
                                      <div className="flex items-center gap-2 pt-2 -mb-1">
                                        <div className="flex-1 h-px bg-[var(--card-border)]" />
                                        <span className="text-xs text-[var(--muted-light)]">未启用 · 学生端不可见</span>
                                        <div className="flex-1 h-px bg-[var(--card-border)]" />
                                      </div>
                                    )}
                                  <div className="flex items-center gap-2 bg-[var(--card-bg)] rounded px-3 py-1.5 text-sm">
                                    <Tag size="small" theme="primary" variant="light">{UNIFIED_TYPE_LABEL[a.type]}</Tag>
                                    {/* 活动未启用提示统一主题色（2026-10-13）：原 warning 语义色 */}
                                    {!a.enabled && <Tag size="small" theme="primary" variant="light">未启用</Tag>}
                                    {/* 活动名称跟随主题色系（2026-10-13）：原为硬编码 #333 */}
                                    <span className="flex-1 truncate text-[var(--title)]">{a.title}</span>
                                    {a.meta && <span className="text-xs text-[var(--muted-light)]">{a.meta}</span>}
                                    {/* 行内管理按钮组：按类型分发（承接原 4 个类型区块的全部按钮）
                                        ⛔ DO NOT REVERT: 所有管理按钮统一 theme="primary" variant="text"，
                                        让对话/探究/项目/作业的图标和文字全部跟随主题主色（用户 2026-10-13 要求）。
                                        不再混用 danger/success/warning 等语义色，避免苹果式界面花花绿绿。 */}
                                    {a.type === "conversation" && (
                                      <>
                                        <Button theme="primary" variant="text" size="small" icon={<EditIcon />} onClick={() => openEditConversationDialog(task, raw)}>编辑</Button>
                                        <Button theme="primary" variant="text" size="small" icon={<ChartBarIcon />} onClick={() => goTo(`/teacher/tasks/${task.id}/insights?pc=${a.id}`)}>分析</Button>
                                        {/* 删除固定最右，与探究/项目/作业按钮组口径一致（2026-10-13 用户要求） */}
                                        <Button theme="primary" variant="text" size="small" icon={<DeleteIcon />} onClick={() => handleConversationDelete(raw)}>删除</Button>
                                      </>
                                    )}
                                    {a.type === "exploration" && (
                                      <>
                                        <Button theme="primary" variant="text" size="small"
                                          icon={<BrowseIcon />}
                                          onClick={async () => {
                                            const token = localStorage.getItem("token") || "";
                                            const res = await fetch(`/api/exploration-activities/${a.id}`, {
                                              headers: { Authorization: `Bearer ${token}` },
                                            });
                                            if (res.ok) {
                                              const detail = await res.json();
                                              // 详情返回纯净稿，本地渲染注入版（提交 + 伴学），与学生端一致。
                                              openPreview(renderLocalPreview(detail.htmlContent || raw.htmlContent || "", {
                                                enableSubmission: detail.enableSubmission,
                                                enableAiCompanion: detail.enableAiCompanion,
                                                collectProfile: detail.collectProfile ? parseCollectProfile(detail.collectProfile) : null,
                                                explorationId: detail.id,
                                              }));
                                              return;
                                            }
                                            // 详情拉取失败：列表接口未下发探究 HTML，仅兜底打开已有内容。
                                            openPreview(raw.htmlContent || "");
                                          }}>预览</Button>
                                        {raw.enableSubmission && (
                                          <Button theme="primary" variant="text" size="small"
                                            icon={<ChartBarIcon />}
                                            onClick={() => goTo(`/teacher/tasks/${task.id}/exploration/${a.id}`)}>分析</Button>
                                        )}
                                        <Button theme="primary" variant="text" size="small"
                                          icon={<EditIcon />}
                                          onClick={() => openEditExploration(raw)}>编辑</Button>
                                        {/* 清除提交：仅在停用且有人提交时显示（与课堂作业「清除答题」口径一致）。
                                            ⚠️ 按钮顺序与作业统一：清除提交在前、删除在后（2026-10-13 用户要求）。
                                            ⛔ DO NOT REVERT：作业「清除答题」同款顺序见下方 quiz 分支。 */}
                                        {!raw.enabled && (raw._count?.ExplorationSubmission ?? 0) > 0 && (
                                          <Button theme="primary" variant="text" size="small"
                                            icon={<DeleteIcon />}
                                            loading={clearingSubmissionsExplorationId === a.id}
                                            onClick={() => handleClearExplorationSubmissions(a.id)}>清除提交</Button>
                                        )}
                                        <Button theme="primary" variant="text" size="small"
                                          icon={<DeleteIcon />}
                                          loading={operatingExplorationId === a.id}
                                          onClick={() => handleDeleteExploration(a.id)}>删除</Button>
                                      </>
                                    )}
                                    {a.type === "project" && (
                                      <>
                                        <Button theme="primary" variant="text" size="small" icon={<BrowseIcon />} onClick={() => openBrowse(a.id)}>浏览</Button>
                                        <Button theme="primary" variant="text" size="small" icon={<EditIcon />} onClick={() => {
                                          setProjDialogMode("edit");
                                          setProjDialogId(a.id);
                                          setProjDialogSpId(a.subProjectId);
                                          setProjDialogTaskId(task.id);
                                          setProjForm({
                                            title: raw.title,
                                            description: raw.description || "",
                                            category: raw.category,
                                            visibleToClass: raw.visibleToClass,
                                            allowLike: raw.allowLike,
                                            fileSizeLimit: raw.fileSizeLimit,
                                          });
                                          setProjDialogVisible(true);
                                        }}>编辑</Button>
                                        <Button theme="primary" variant="text" size="small" icon={<DeleteIcon />} onClick={() => setProjDelete(raw)}>删除</Button>
                                      </>
                                    )}
                                    {a.type === "quiz" && (raw.status === "ACTIVE" ? (
                                      <>
                                        <Button theme="primary" variant="text" size="small" icon={<ChartBarIcon />} onClick={() => goTo(`/teacher/activities/${a.subProjectId}/quiz/${a.id}/report`)}>查看报告</Button>
                                        <Button theme="primary" variant="text" size="small" icon={<BrowseIcon />} onClick={() => openQuizPreview(raw)}>预览</Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button theme="primary" variant="text" size="small" icon={<EditIcon />} onClick={() => startEditQuiz(raw)}>快编</Button>
                                        <Button theme="primary" variant="text" size="small" icon={<FileIcon />} onClick={() => goTo(`/teacher/activities/${a.subProjectId}/quiz/${a.id}/questions`)}>题目管理</Button>
                                        <Button theme="primary" variant="text" size="small" icon={<BrowseIcon />} onClick={() => openQuizPreview(raw)}>预览</Button>
                                        {(raw._count?.attempts ?? 0) > 0 && (
                                          <Button theme="primary" variant="text" size="small" icon={<DeleteIcon />} loading={clearingAttemptsQuizId === a.id} onClick={() => handleClearAttempts(a.id)}>清除答题</Button>
                                        )}
                                        <Button theme="primary" variant="text" size="small" icon={<DeleteIcon />} loading={deletingQuizId === a.id} onClick={() => handleQuizDelete(a.id)}>删除</Button>
                                      </>
                                    ))}
                                    {/* 启停开关：统一在此分发；quiz 的 enabled 已在 buildUnifiedActs 归一为 status==="ACTIVE" */}
                                    <Switch
                                      value={a.enabled}
                                      size="small"
                                      onChange={(val: boolean) => {
                                        if (a.type === "conversation") handleConversationToggle(raw, val);
                                        else if (a.type === "exploration") handleExplorationToggle(raw, val);
                                        else if (a.type === "project") handleProjectToggle(raw, val);
                                        else handleQuizToggle(raw, val);
                                      }}
                                      disabled={a.type === "conversation" ? operatingPresetConversationId === a.id
                                        : a.type === "exploration" ? togglingExplorationId === a.id
                                        : a.type === "project" ? operatingProjectId === a.id
                                        : operatingQuizId === a.id}
                                    />
                                    {a.enabled ? (
                                      <div className="flex items-center">
                                        <Button theme="primary" variant="text" size="small" disabled={myEnabledIdx === 0}
                                          onClick={() => reorderAcrossTypes(a.type, a.id, "up", a.subProjectId)}>
                                          <ChevronUpIcon />
                                        </Button>
                                        <Button theme="primary" variant="text" size="small" disabled={myEnabledIdx === enabledCount - 1}
                                          onClick={() => reorderAcrossTypes(a.type, a.id, "down", a.subProjectId)}>
                                          <ChevronDownIcon />
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className="w-[64px]"></span>
                                    )}
                                  </div>
                                  </Fragment>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 编辑作业设计表单仍内嵌于统一清单底部：由停用作业行的「快编」入口触发（startEditQuiz）。
                            新建作业表单已移到统一清单顶部，避免长列表滚动。
                            ⚠️ GOTCHA: handleSaveQuiz 依赖 quizPanelSpId 定位 subProjectId；表单只依赖组件级 quizDesign* state。
                            🔗 RELATED: 顶部新建表单、startEditQuiz / handleSaveQuiz / exitQuizDesign */}
                                                {quizDesignMode && quizDesignId && (
                          <div className="bg-[var(--card-bg)] rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <h5 className="font-medium text-sm text-[var(--muted)]">编辑作业</h5>
                              <Button theme="primary" variant="text" size="small" onClick={exitQuizDesign}>× 退出设计</Button>
                            </div>
                            <Input value={quizDesignTitle} onChange={(v) => setQuizDesignTitle(v)} placeholder="作业名称 *" size="small" />
                            <Input value={quizDesignDesc} onChange={(v) => setQuizDesignDesc(v)} placeholder="作业说明（选填）" size="small" />
                            {quizDesignQuestions.length > 0 && (
                              <div className="space-y-3">
                                <div className="text-xs font-medium text-[var(--muted)]">题目（共 {quizDesignQuestions.length} 道，可直接修改）</div>
                                {quizDesignQuestions.map((question, idx) => {
                                  const options = typeof question.options === "string" ? JSON.parse(question.options || "{}") : (question.options || {});
                                  return (
                                    <div key={idx} className="bg-[var(--primary-lighter)] rounded-lg p-3 text-sm">
                                      <div className="flex items-start gap-2">
                                        <div className="flex flex-col gap-0.5 p-1">
                                          <button type="button" onClick={() => { if (idx === 0) return; const updated = [...quizDesignQuestions]; const temp = updated[idx - 1]; updated[idx - 1] = updated[idx]; updated[idx] = temp; setQuizDesignQuestions(updated); }} disabled={idx === 0} className="w-5 h-4 flex items-center justify-center text-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▲</button>
                                          <button type="button" onClick={() => { if (idx === quizDesignQuestions.length - 1) return; const updated = [...quizDesignQuestions]; const temp = updated[idx + 1]; updated[idx + 1] = updated[idx]; updated[idx] = temp; setQuizDesignQuestions(updated); }} disabled={idx === quizDesignQuestions.length - 1} className="w-5 h-4 flex items-center justify-center text-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold">▼</button>
                                        </div>
                                        <span className="font-medium text-[var(--muted)] mt-1">{idx + 1}.</span>
                                        <div className="flex-1 space-y-2">
                                          <Input value={question.content} onChange={(v) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], content: v }; setQuizDesignQuestions(updated); }} size="small" />
                                          <div className="grid grid-cols-2 gap-1">
                                            {["A", "B", "C", "D"].map((opt) => (
                                              <div key={opt} className="flex items-center gap-1">
                                                <span className="text-xs text-[var(--muted-light)]">{opt}.</span>
                                                <Input value={options[opt] || ""} onChange={(v) => { const updated = [...quizDesignQuestions]; const newOpts = { ...options, [opt]: v }; updated[idx] = { ...updated[idx], options: newOpts }; setQuizDesignQuestions(updated); }} size="small" />
                                              </div>
                                            ))}
                                          </div>
                                          <div className="flex gap-2 items-center text-xs">
                                            <span className="text-[var(--muted-light)]">题型：</span>
                                            <select value={question.type || "SINGLE_CHOICE"} onChange={(e) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], type: e.target.value }; setQuizDesignQuestions(updated); }} className="border rounded px-1 py-0.5">
                                              <option value="SINGLE_CHOICE">单选</option><option value="MULTIPLE_CHOICE">多选</option><option value="TRUE_FALSE">判断</option>
                                            </select>
                                            <span className="text-[var(--muted-light)] ml-2">答案：</span>
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
                                            <span className="text-[var(--muted-light)] ml-2">难度：</span>
                                            <select value={question.difficulty || "BASIC"} onChange={(e) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], difficulty: e.target.value }; setQuizDesignQuestions(updated); }} className="border rounded px-1 py-0.5">
                                              <option value="BASIC">基础</option><option value="INTERMEDIATE">提升</option><option value="ADVANCED">拓展</option>
                                            </select>
                                          </div>
                                          <div><span className="text-xs text-[var(--muted-light)]">答案解析</span><Input value={question.explanation || ""} onChange={(v) => { const updated = [...quizDesignQuestions]; updated[idx] = { ...updated[idx], explanation: v }; setQuizDesignQuestions(updated); }} size="small" placeholder="答案解析（可为空）" /></div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex gap-2 justify-end"><Button theme="primary" size="small" icon={<SaveIcon />} loading={savingQuiz} onClick={handleSaveQuiz}>保存作业</Button></div>
                            {generatingQuestions && <div className="text-center py-4 text-sm text-[var(--muted-light)]">AI 正在生成题目，请稍候...</div>}
                          </div>
                        )}
                      </div>

                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {tasks.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <span>每页</span>
              <InputNumber
                value={pageSize}
                min={1}
                max={100}
                theme="column"
                onChange={(val) => {
                  const n = Math.max(1, Math.min(100, Number(val) || 1));
                  setPageSize(n);
                  setCurrentPage(1);
                }}
                style={{ width: 72 }}
              />
              <span>个课堂，共 {tasks.length} 个</span>
            </div>
            <Pagination
              total={tasks.length}
              pageSize={pageSize}
              current={safePage}
              showJumper
              showPageSize={false}
              onChange={(pageInfo) => {
                // 手动翻页时取消待执行的"退出独占"延迟恢复，避免收缩动画期间翻页被旧定时器拉回 prevTaskPage（2026-10-14）
                clearExitExclusiveTimer();
                setCurrentPage(pageInfo.current);
              }}
            />
          </div>
        )}

        {/* 创建/编辑课堂对话框 - 只保留基本信息 */}
        {/* ⛔ DO NOT REVERT（2026-10-14 用户要求）：编辑/创建课堂弹窗禁止「点遮罩/按 ESC」关闭——
            表单未保存时误触会静默丢弃全部已填内容，必须走「取消/×」显式关闭。
            TDesign 两属性全局默认均为 true（ConfigContext.js dialog 段），不显式传 false 就会误关。
            🔗 RELATED: 同文件「编辑对话活动」「互动探究」「AI伴学提示词」「编辑项目」弹窗同规则，改一处要一起看。 */}
        <Dialog
          header={editingTask ? "编辑课堂" : "创建课堂"}
          visible={formVisible}
          onClose={() => { setFormVisible(false); resetForm(); }}
          closeOnOverlayClick={false}
          closeOnEscKeydown={false}
          footer={null}
          width={900}
          top="48px"
          destroyOnClose
        >
          <div className="space-y-4">
            <div className="flex gap-4 items-stretch">
              <div className="flex-1 flex flex-col space-y-4">
                <Input
                  value={formTitle}
                  onChange={(v) => setFormTitle(v)}
                  placeholder="课题（课堂标题）*"
                />
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-[var(--foreground)] mb-1">年级 <span className="text-[var(--danger)]">*</span></label>
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
                        { label: "小班上学期", value: "小班上学期" },
                        { label: "小班下学期", value: "小班下学期" },
                        { label: "中班上学期", value: "中班上学期" },
                        { label: "中班下学期", value: "中班下学期" },
                        { label: "大班上学期", value: "大班上学期" },
                        { label: "大班下学期", value: "大班下学期" },
                      ]}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-[var(--foreground)] mb-1">学科 <span className="text-[var(--danger)]">*</span></label>
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
                        { label: "健康", value: "健康" },
                        { label: "语言", value: "语言" },
                        { label: "社会", value: "社会" },
                      ]}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-[var(--foreground)]">课堂目标 <span className="text-[var(--danger)]">*</span></label>
                    <div className="flex items-center gap-2">
                      {objectivesBackup !== null && (
                        <span
                          className="text-xs text-[var(--primary)] cursor-pointer hover:underline"
                          onClick={restoreObjectives}
                        >
                          撤销
                        </span>
                      )}
                      <Button
                        size="small"
                        variant="outline"
                        theme="primary"
                        loading={generatingObjectives}
                        onClick={handleAIObjectives}
                      >
                        AI 帮我写
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={formDescription}
                    onChange={(v) => setFormDescription(v)}
                    placeholder="课堂目标（必填）。填写课题、年级、学科后，可点击右上角「AI 帮我写」按学科核心素养生成或优化"
                    rows={8}
                  />
                </div>
              </div>

              <div className="flex-1 space-y-4">
              {/* 个人学情分析提示词 */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-[var(--muted)]">个人学情分析提示词</h4>
                  <div className="flex gap-2 items-center">
                    <select
                      className="flex-1 px-3 py-2 border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
                    className="w-full px-3 py-2 border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
                  <h4 className="font-medium text-sm text-[var(--muted)]">全班学情分析提示词</h4>
                  <div className="flex gap-2 items-center">
                    <select
                      className="flex-1 px-3 py-2 border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
                    className="w-full px-3 py-2 border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
              <h4 className="font-medium text-sm text-[var(--muted)]">分配班级（必选）</h4>
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
                  <span className="text-sm text-[var(--muted-light)]">请先创建班级</span>
                )}
              </div>
            </div>

            {/* 引用知识库 */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-[var(--muted)]">引用知识库（选填）</h4>
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
                  <span className="text-sm text-[var(--muted-light)]">
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
                  <span className={`text-xs ${getSelectedKbTotalLength(selectedKbIds) > 50000 ? "text-[var(--danger)] font-medium" : "text-[var(--muted)]"}`}>
                    已选 {getSelectedKbTotalLength(selectedKbIds).toLocaleString()} / 50,000 字符
                    {getSelectedKbTotalLength(selectedKbIds) > 50000 && " ⚠ 超出限制"}
                  </span>
                </div>
              )}
              <p className="text-xs text-[var(--muted-light)]">
                选择后，该课堂下所有对话活动将自动注入所选知识库的全文内容，总字符数不超过 50,000
              </p>
            </div>

            {/* 引用图片组 */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-[var(--muted)]">引用图片组（选填）</h4>
              <div className="flex flex-wrap gap-2">
                {imageGroups.map((g) => (
                  <Tag
                    key={g.id}
                    theme={selectedImageGroupIds.includes(g.id) ? "primary" : "default"}
                    variant={selectedImageGroupIds.includes(g.id) ? "dark" : "light"}
                    className="cursor-pointer"
                    onClick={() => toggleImageGroupSelection(g.id)}
                  >
                    {g.name}（{g.imageCount} 张）
                  </Tag>
                ))}
                {imageGroups.length === 0 && (
                  <span className="text-xs text-[var(--muted-light)] py-1">
                    暂无图片组，请先到「图片仓库」页面创建
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted-light)]">
                选择后，该课堂下所有对话活动中的 AI 可根据学生问题智能发送组内图片（教师课前准备的素材图）
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-[var(--card-border)]">
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
            <p className="text-sm text-[var(--danger)] font-medium">此操作不可撤销！</p>
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
                <p className="text-[var(--muted)]">
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
                <div className="bg-[var(--warning-light)] rounded-lg p-3 text-sm text-[var(--warning)]">
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
            <div className="text-center py-8 text-sm text-[var(--muted-light)]">加载中...</div>
          ) : quizAnalysisData ? (
            <div className="space-y-4">
              {/* 班级选择 */}
              {quizAnalysisData.classIds && quizAnalysisData.classIds.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[var(--muted)]">班级：</span>
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
                <div className="bg-[var(--primary-light)] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[var(--primary)]">{quizAnalysisData.totalStudents || 0}</div>
                  <div className="text-xs text-[var(--primary)]">作答人数</div>
                </div>
                <div className="bg-[var(--success-light)] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[var(--success)]">{quizAnalysisData.classAvgScore || 0}</div>
                  <div className="text-xs text-[var(--success)]">班级均分</div>
                </div>
                <div className="bg-[var(--warning-light)] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[var(--warning)]">{quizAnalysisData.questionStats?.length || 0}</div>
                  <div className="text-xs text-[var(--warning)]">总题数</div>
                </div>
              </div>

              {/* 分数分布柱状图 */}
              {quizAnalysisData.scoreBuckets && quizAnalysisData.scoreBuckets.some((b: any) => b.count > 0) && (
                <div>
                  <div className="text-sm font-medium text-[var(--muted)] mb-2">分数分布</div>
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
                  <div className="text-sm font-medium text-[var(--muted)] mb-2">各题正确率</div>
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
                <div className="text-center py-4 text-sm text-[var(--muted-light)]">暂无作答数据</div>
              )}

              {/* 难度维度饼图 */}
              {quizAnalysisData.difficultyStats && quizAnalysisData.difficultyStats.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-[var(--muted)] mb-2">各难度正确率</div>
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
                <div className="bg-[var(--danger-light)] rounded-lg p-3">
                  <div className="text-sm font-medium text-[var(--danger)] mb-1">薄弱题目（正确率&lt;60%）</div>
                  <div className="text-xs text-[var(--danger)] whitespace-pre-line"><Markdown>{quizAnalysisData.weakQuestions}</Markdown></div>
                </div>
              )}
              {quizAnalysisData.lowScoreStudents && quizAnalysisData.lowScoreStudents !== "" && (
                <div className="bg-[var(--warning-light)] rounded-lg p-3">
                  <div className="text-sm font-medium text-[var(--warning)] mb-1">低分学生（&lt;60分）</div>
                  <div className="text-xs text-[var(--warning)] whitespace-pre-line"><Markdown>{quizAnalysisData.lowScoreStudents}</Markdown></div>
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
                  <div className="bg-[var(--hover-bg)] rounded-lg p-3">
                    <div className="text-sm font-medium text-[var(--muted)] mb-1">AI 分析报告</div>
                    <div className="text-sm text-[var(--foreground)] whitespace-pre-line prose prose-sm prose-gray max-w-none [&_pre]:overflow-x-auto [&_code]:break-all"><Markdown>{quizAnalysisData.aiContent}</Markdown></div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-xs text-[var(--muted-light)]">AI 分析生成中...</div>
                )}
              </div>

              <div className="flex justify-end">
                <Button size="small" onClick={closeQuizAnalysis}>关闭</Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-[var(--muted-light)]">加载失败</div>
          )}
        </Dialog>

        {/* 对话活动 - 名片式新建/编辑弹窗 */}
        {/* ⛔ DO NOT REVERT（2026-10-14 用户要求）：同「编辑课堂」弹窗——未保存时点遮罩/ESC 会静默丢内容，只允许显式关闭 */}
        <Dialog
          header={convDialogMode === "edit" ? "编辑对话活动" : "新建对话活动"}
          visible={convDialogVisible}
          onClose={() => setConvDialogVisible(false)}
          closeOnOverlayClick={false}
          closeOnEscKeydown={false}
          footer={null}
          width={720}
          destroyOnClose
          top="48px"
        >
          <div className="space-y-4">
            {/* 顶部两列（2026-10-13 布局调整）：左=名称+目标，右=开场白（新增字段）；
                下方系统提示词/学情分析提示词保持通栏，长文本不挤压 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <span className="text-sm font-medium text-[var(--muted)]">对话活动名称</span>
                  <Input
                    value={convForm.title}
                    onChange={(v) => setConvForm({ ...convForm, title: v })}
                    placeholder="例如：圆的认识探究对话"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--muted)]">对话活动目标</span>
                    <div className="flex items-center gap-2">
                      {convObjectiveBackup !== null && (
                        <span
                          className="text-xs text-[var(--primary)] cursor-pointer hover:underline"
                          onClick={restoreConvObjective}
                        >
                          撤销
                        </span>
                      )}
                      <Button
                        variant="outline"
                        theme="primary"
                        size="small"
                        loading={generatingConvObjective}
                        onClick={handleAIOptimizeConversationObjective}
                      >
                        AI 帮我写
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={convForm.description}
                    onChange={(v) => setConvForm({ ...convForm, description: v })}
                    placeholder="描述本次对话活动希望学生达成的目标；填写活动名称后，可点击右上角「AI 帮我写」生成或优化"
                    rows={3}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-[var(--muted)]">开场白（AI 的第一句话）</span>
                <Textarea
                  value={convForm.openingMessage}
                  onChange={(v) => setConvForm({ ...convForm, openingMessage: v })}
                  placeholder="学生进入对话后，AI 自动发出的开场内容；留空则不出开场白。写入的内容不消耗 AI 调用，学生回复后 AI 会接着开场白继续对话"
                  rows={7}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--muted)]">对话设计提示词（系统提示词）</span>
                <Select
                  value=""
                  onChange={(v) => {
                    const tplId = v as string;
                    if (!tplId) return;
                    const tpl = conversationTemplates.find((t) => t.id === tplId);
                    if (!tpl) return;
                    // 原样填入模板（保留 {pcDescription}、{taskTitle} 等变量占位符），
                    // 由学生对话运行时统一替换，与学生对话时保持一致
                    setConvForm({ ...convForm, systemPrompt: tpl.content });
                  }}
                  options={[
                    { label: "选择对话设计模板填充...", value: "" },
                    ...conversationTemplates.map((t) => ({ label: t.name, value: t.id })),
                  ]}
                  placeholder="选择对话设计模板填充..."
                  size="small"
                  style={{ width: 240 }}
                />
              </div>
              <Textarea
                value={convForm.systemPrompt}
                onChange={(v) => setConvForm({ ...convForm, systemPrompt: v })}
                placeholder="选择模板后自动填充，也可手动修改"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--muted)]">个人学情分析提示词</span>
                <Select
                  value=""
                  onChange={(v) => {
                    const tplId = v as string;
                    if (!tplId) return;
                    const tpl = templates.find((t) => t.id === tplId);
                    if (tpl) setConvForm({ ...convForm, analysisPrompt: tpl.content });
                  }}
                  options={[
                    { label: "选择个人学情模板填充...", value: "" },
                    ...templates.filter((t) => t.type === "student").map((t) => ({ label: t.name, value: t.id })),
                  ]}
                  placeholder="选择个人学情模板填充..."
                  size="small"
                  style={{ width: 240 }}
                />
              </div>
              <Textarea
                value={convForm.analysisPrompt}
                onChange={(v) => setConvForm({ ...convForm, analysisPrompt: v })}
                placeholder="用于生成学生个人学情分析的提示词"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--muted)]">全班学情分析提示词</span>
                <Select
                  value=""
                  onChange={(v) => {
                    const tplId = v as string;
                    if (!tplId) return;
                    const tpl = templates.find((t) => t.id === tplId);
                    if (tpl) setConvForm({ ...convForm, classAnalysisPrompt: tpl.content });
                  }}
                  options={[
                    { label: "选择全班学情模板填充...", value: "" },
                    ...templates.filter((t) => t.type === "class").map((t) => ({ label: t.name, value: t.id })),
                  ]}
                  placeholder="选择全班学情模板填充..."
                  size="small"
                  style={{ width: 240 }}
                />
              </div>
              <Textarea
                value={convForm.classAnalysisPrompt}
                onChange={(v) => setConvForm({ ...convForm, classAnalysisPrompt: v })}
                placeholder="用于生成全班学情分析的提示词"
                rows={4}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--card-border)]">
              <Button onClick={() => setConvDialogVisible(false)}>取消</Button>
              <Button
                theme="primary"
                loading={convDialogSaving}
                onClick={handleConversationSave}
              >
                {convDialogMode === "edit" ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </Dialog>

        {/* 对话活动 - 删除确认弹窗 */}
        <Dialog
          header="删除对话活动"
          visible={!!convDeletePc}
          onClose={() => setConvDeletePc(null)}
          onConfirm={confirmConversationDelete}
          confirmBtn={{ content: "删除", theme: "danger" }}
        >
          <p className="text-sm text-[var(--muted)]">
            确定删除「{convDeletePc?.title}」吗？该活动下的学生对话记录与学情分析也会一并删除，且不可恢复。
          </p>
        </Dialog>

        {/* 互动探究 - 新建/编辑弹窗 */}
        {/* ⛔ DO NOT REVERT（2026-10-14 用户要求）：与其他编辑弹窗统一——点遮罩已禁止，此处补禁 ESC；对话流含未保存的多轮设计意图 */}
        <Dialog
          header={explorationEditId ? "编辑互动探究" : "新建互动探究"}
          visible={explorationModalVisible}
          onClose={() => setExplorationModalVisible(false)}
          footer={null}
          width={1040}
          destroyOnClose
          closeOnOverlayClick={false}
          closeOnEscKeydown={false}
          top="48px"
        >
          <div className="space-y-4">
            {/* 标题 */}
            <Input
              value={explorationTitle}
              onChange={(v) => setExplorationTitle(v)}
              placeholder="探究标题"
            />

            {explorationHasSubmissions && (
              <div className="text-xs text-[var(--warning)] bg-[var(--warning-light)] border border-[var(--warning-light)] rounded p-2 leading-relaxed">
                ⚠️ 已有学生提交，HTML 内容已锁定，无法编辑或重新生成（可修改标题、设计意图、分析提示词）。如需改内容，请新建探究。
              </div>
            )}

            {/* 主区域：左对话流 + 右预览/源码 */}
            <div className="flex gap-3" style={{ minHeight: 340 }}>
              {/* 左栏：对话流 + 输入条 */}
              <div className="w-[380px] shrink-0 flex flex-col border border-[var(--card-border)] rounded-lg overflow-hidden">
                {/* 对话流 */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[var(--hover-bg)]" style={{ maxHeight: 300 }}>
                  {/* ⚠️ GOTCHA（2026-10-14 修复）：用户气泡必须「深底白字」——曾写成 bg-[var(--primary-light)]0 text-white，
                      尾部多个 0 使 Tailwind 类失效 → 背景透明，白字落在浅灰对话区上看不清（用户报告"字体颜色不对"）。
                      ⛔ DO NOT REVERT；改色时保持深色背景+白字对比度，--primary-light(#E8F0FE) 是浅色只能配深字。 */}
                  {chatMessages.length === 0 ? (
                    <div className="text-sm text-[var(--muted-light)] text-center px-4 py-16 leading-relaxed">
                      描述你想要的互动网页（主题、互动机制、视觉风格等），发送后 AI 生成第一版。
                      <br />也可点「AI 帮我写」自动生成设计意图，或「上传」HTML 后继续对话修改。
                    </div>
                  ) : (
                    chatMessages.map((m, i) => (
                      <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                        <div
                          className={
                            m.role === "user"
                              ? "max-w-[85%] bg-[var(--primary)] text-white text-sm rounded-lg rounded-br-sm px-3 py-2 whitespace-pre-wrap"
                              : "max-w-[85%] bg-[var(--card-bg)] text-[var(--foreground)] text-sm rounded-lg rounded-bl-sm px-3 py-2 border border-[var(--card-border)] whitespace-pre-wrap"
                          }
                        >
                          {m.content}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {/* 输入条 */}
                <div className="border-t border-[var(--card-border)] p-2 space-y-2 bg-[var(--card-bg)]">
                  <Textarea
                    value={draftInput}
                    onChange={(v) => setDraftInput(v)}
                    disabled={explorationHasSubmissions}
                    placeholder={explorationHasSubmissions ? "已有学生提交，内容已锁定" : (htmlVersions.length === 0 ? "描述你想要的互动网页…" : "输入修改要求，如：把背景改成蓝色")}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button
                      theme="default" variant="outline" size="small"
                      loading={generatingPrompt}
                      disabled={explorationHasSubmissions}
                      onClick={autoGeneratePrompt}
                    >
                      AI 帮我写
                    </Button>
                    <Button
                      theme="primary" size="small"
                      loading={generating}
                      onClick={handleSend}
                      disabled={explorationHasSubmissions || !draftInput.trim()}
                      className="flex-1"
                    >
                      发送
                    </Button>
                  </div>
                </div>
              </div>

              {/* 右栏：预览/源码 */}
              <div className="flex-1 min-w-0 flex flex-col">
                {/* 工具条 */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--muted)]">
                    {htmlVersions.length > 0 ? `第 ${versionIndex + 1} 版` : "预览"}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button theme="primary" variant="text" size="small" onClick={handleUndo} disabled={explorationHasSubmissions || versionIndex <= 0}>
                      撤销
                    </Button>
                    <Button theme="primary" variant="text" size="small" onClick={handleRedo} disabled={explorationHasSubmissions || versionIndex >= htmlVersions.length - 1}>
                      重做
                    </Button>
                    <Button theme="primary" variant="text" size="small" icon={<FileIcon />} onClick={handleUploadHtml} disabled={explorationHasSubmissions}>
                      上传
                    </Button>
                    <Button theme="primary" variant="text" size="small" icon={<FileIcon />} onClick={handleExportHtml}>
                      导出
                    </Button>
                    {explorationHtml.trim() ? (
                      detectInstrumentation(explorationHtml).needsAdaptation ? (
                        <Tooltip content="该页面未接入提交采集，开启「启用提交」时将自动接入">
                          <span className="text-xs text-[var(--muted-light)] px-1">△ 未接入采集</span>
                        </Tooltip>
                      ) : (
                        <Tooltip content="该页面已接入提交采集，学生得分/进度可正常上报">
                          <span className="text-xs text-[var(--success)] px-1">✓ 已接入采集</span>
                        </Tooltip>
                      )
                    ) : null}
                    {explorationPreview && (
                      <Button theme="primary" variant="text" size="small" onClick={() => openPreview(explorationPreview)}>
                        全屏
                      </Button>
                    )}
                  </div>
                </div>

                {/* 预览/源码 tab */}
                <div className="flex-1 flex flex-col border border-[var(--card-border)] rounded-lg overflow-hidden">
                  <div className="flex border-b border-[var(--card-border)] bg-[var(--hover-bg)]">
                    <button
                      type="button"
                      onClick={() => setActiveTab("preview")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "preview" ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("code")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "code" ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}
                    >
                      源码
                    </button>
                  </div>
                  {activeTab === "preview" ? (
                    <iframe
                      srcDoc={explorationPreview || '<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;color:#999;font-family:sans-serif">暂无内容</body></html>'}
                      className="flex-1 w-full"
                      sandbox="allow-scripts allow-same-origin"
                      title="预览"
                      style={{ minHeight: 300 }}
                    />
                  ) : (
                    <Textarea
                      value={explorationHtml}
                      onChange={(v) => { setExplorationHtml(v); setExplorationPreview(renderLocalPreview(v)); }}
                      disabled={explorationHasSubmissions}
                      onBlur={() => {
                        // 手动编辑失焦时纳入版本栈，使手动改也能被撤销/重做
                        const trimmed = explorationHtml.trim();
                        if (!trimmed) return;
                        const current = versionIndex >= 0 ? htmlVersions[versionIndex] : "";
                        if (trimmed !== current) {
                          const baseVersions = versionIndex >= 0 ? htmlVersions.slice(0, versionIndex + 1) : [];
                          const newIndex = baseVersions.length;
                          setHtmlVersions([...baseVersions, trimmed]);
                          setVersionIndex(newIndex);
                          setChatMessages((prev) => [...prev, { role: "ai", content: `✎ 已记录源码编辑（第 ${newIndex + 1} 版）` }]);
                        }
                      }}
                      placeholder={explorationHasSubmissions ? "已有学生提交，HTML 内容已锁定，无法编辑" : "HTML 源代码，可在此直接修改（修改即时同步到预览）"}
                      rows={12}
                      className="font-mono text-xs"
                      style={{ minHeight: 300 }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* 启用提交功能 */}
            <div className="border-t border-[var(--card-border)] pt-3 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[var(--muted)]">启用提交</span>
                <Switch
                  value={explorationEnableSubmission}
                  size="small"
                  onChange={async (val: boolean) => {
                    if (val) {
                      // 开启提交：提交通道由读取路径 renderExplorationHtml 内存注入，无需任何确认弹窗。
                      // 缺采集桩（window.__gameState__ / 防御式调用都没有）只降级分数/关卡上报——
                      // 基础采集（控件扫描 + __gameState__.answers 自定义上报 + 行为数据）照常工作；
                      // 下方状态条会显示黄条，老师可点「重试接入」补救，不再阻断开启流程。
                      setExplorationEnableSubmission(true);
                      syncConfirmedInjection(true);
                      setExplorationPreview(renderLocalPreview(explorationHtml, { enableSubmission: true }));
                    } else {
                      // 关闭 → 撤销注入并预览
                      if (explorationHasSubmissions) {
                        MessagePlugin.warning("已有学生提交，无法关闭启用提交");
                        return;
                      }
                      // 关闭提交：explorationHtml 恒为纯净稿，无需 remove；预览本地渲染（关提交）
                      setExplorationHtml(explorationHtml);
                      setExplorationPreview(renderLocalPreview(explorationHtml, { enableSubmission: false }));
                      setExplorationEnableSubmission(false);
                      syncConfirmedInjection(false);
                    }
                  }}
                />
              </div>
              {confirmedInjection ? (
                detectInstrumentation(explorationHtml).needsAdaptation ? (
                  <div className="text-xs text-[var(--warning)] bg-[var(--warning-light)] rounded p-2 flex items-center justify-between gap-2">
                    <span>⚠️ 页面未接入采集桩——控件答案与自定义同步数据照常采集，分数/关卡无法上报（闯关计分类页面建议点「重试接入」）。</span>
                    <Button size="small" variant="text" theme="warning" loading={adapting} onClick={handleAdaptInstrumentation}>
                      重试接入
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--success)] bg-[var(--success-light)] rounded p-2">
                    ✓ 已启用提交并接入采集，分数/关卡/作答可正常上报，点击保存生效。
                  </div>
                )
              ) : explorationEnableSubmission ? (
                <div className="text-xs text-[var(--warning)] bg-[var(--warning-light)] rounded p-2">
                  为互动探究的HTML注入提交功能，采集学生互动探究过程的数据用于分析，这是测试功能，未必成功。
                </div>
              ) : (
                <div className="text-xs text-[var(--muted-light)] bg-[var(--hover-bg)] rounded p-2">
                  纯展示模式，学生只能浏览互动内容，无法提交成绩。
                </div>
              )}
            </div>

            {/* AI伴学功能 */}
            <div className="border-t border-[var(--card-border)] pt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--muted)]">AI伴学</span>
                  <Switch
                    value={explorationEnableAiCompanion}
                    size="small"
                    disabled={!explorationHtml.trim() || aiCompanionStatus === "analyzing"}
                    onChange={handleAiCompanionToggle}
                  />
                  {aiCompanionStatus === "analyzing" && (
                    <span className="text-xs text-[var(--warning)] flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border-2 border-[var(--warning)] border-t-transparent rounded-full animate-spin" />
                      正在分析交互内容，生成指导策略...
                    </span>
                  )}
                  {aiCompanionStatus === "ready" && explorationEnableAiCompanion && (
                    <span className="text-xs text-[var(--success)]">✓ AI伴学已就绪</span>
                  )}
                  {aiCompanionStatus === "error" && (
                    <span className="text-xs text-[var(--danger)]">✗ 生成失败</span>
                  )}
                  {!explorationEnableAiCompanion && aiCompanionPromptText && (
                    <span className="text-xs text-[var(--muted)]">提示词已保留（再次启用秒开）</span>
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
                  <div className="text-xs text-[var(--accent)] bg-[var(--primary-lighter)] rounded p-2">
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
                <div className="text-xs text-[var(--muted-light)] bg-[var(--hover-bg)] rounded p-2">
                  {aiCompanionPromptText
                    ? "关闭后学生无法使用AI伴学功能（已生成的提示词会保留，再次启用时秒开）。"
                    : "关闭后学生无法使用AI伴学功能。"}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--card-border)]">
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
            if (adapting) return; // AI 接入进行中，禁止关闭，避免与后台返回产生竞态
            setInjectionPreviewVisible(false);
            // 用 ref 读取真实值，避免 React 闭包捕获到旧 state
            if (confirmedInjectionRef.current) {
              setPreviewAnalysis(null);
              setPreviewError(null);
              setAutoScoreScript(null);
              return;
            }
            // 关闭时恢复原始状态（纯净稿）
            setExplorationEnableSubmission(false);
            syncConfirmedInjection(false);
            if (originalHtmlForInjection) {
              setExplorationHtml(originalHtmlForInjection);
              setExplorationPreview(renderLocalPreview(originalHtmlForInjection, { enableSubmission: false }));
            }
            setPreviewAnalysis(null);
            setPreviewError(null);
          }}
          width={680}
          destroyOnClose
          footer={
            <div className="flex justify-end gap-2">
              <Button
                disabled={adapting}
                onClick={() => {
                  setInjectionPreviewVisible(false);
                  // 取消注入，恢复原始 HTML（纯净稿）
                  setExplorationEnableSubmission(false);
                  syncConfirmedInjection(false);
                  if (originalHtmlForInjection) {
                    setExplorationHtml(originalHtmlForInjection);
                    setExplorationPreview(renderLocalPreview(originalHtmlForInjection, { enableSubmission: false }));
                  }
                  setPreviewAnalysis(null);
                  setPreviewError(null);
                }}
              >
                取消注入
              </Button>
              <Button
                theme="primary"
                loading={adapting}
                onClick={async () => {
                  if (adapting) return;
                  // ① 先自动尝试 AI 接入采集（非阻断：失败仅降级为基础采集，不影响提交）
                  //    插桩改的是「纯净稿本身」（老师的 HTML），属内容改造；
                  //    ⛔ 提交通道不再在此注入落库——提交/伴学统一由读取路径 renderExplorationHtml 渲染。
                  let baseHtml = explorationHtml;
                  const detection = detectInstrumentation(baseHtml);
                  let adaptedOk = !detection.needsAdaptation; // 已接桩视为采集就绪，跳过 AI
                  if (detection.needsAdaptation) {
                    const adapted = await adaptHtmlWithAi(baseHtml);
                    if (adapted) {
                      baseHtml = adapted;
                      adaptedOk = true;
                    }
                  }
                  // ② 插桩后的纯净稿入版本栈（撤销一步即回到「插桩前」的原始 HTML）
                  const finalHtml = baseHtml;
                  const baseVersions = htmlVersions.slice(0, versionIndex + 1);
                  const newIndex = baseVersions.length;
                  setHtmlVersions([...baseVersions, finalHtml]);
                  setVersionIndex(newIndex);
                  setExplorationHtml(finalHtml);
                  // ③ 预览：本地渲染注入版（提交 = true，伴学沿用当前开关）
                  setExplorationPreview(renderLocalPreview(finalHtml, { enableSubmission: true }));
                  setExplorationEnableSubmission(true);
                  syncConfirmedInjection(true);
                  // ③ 结果反馈：成功 / 降级
                  if (adaptedOk) {
                    MessagePlugin.success("✅ 已启用提交并接入采集，分数/关卡/作答结果可正常上报");
                  } else {
                    MessagePlugin.warning("⚠️ 提交已启用，但 AI 采集接入未成功——目前仅采集基础数据（时长/操作/滚动），分数/关卡/作答暂无法上报");
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
              <div className="inline-block w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mb-3" />
              <div className="text-sm text-[var(--muted)]">{previewStatus || "正在分析..."}</div>
              <div className="text-xs text-[var(--muted-light)] mt-2">AI 分析可能需要 10-30 秒</div>
            </div>
          ) : previewError ? (
            <div className="space-y-3">
              <div className="text-sm text-[var(--warning)] bg-[var(--warning-light)] rounded p-3">
                ⚠️ {previewError}
              </div>
              <div className="text-xs text-[var(--muted-light)]">
                将使用基础追踪方案（点击次数、停留时间、滚动深度）。继续注入？
              </div>
            </div>
          ) : previewAnalysis ? (
            <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-2">

              {/* AI 总结 */}
              <div className="text-sm text-[var(--foreground)] bg-[var(--primary-light)] rounded p-3 leading-relaxed">
                {previewAnalysis.summary || "AI 分析完成，请确认以下采集项"}
              </div>

              {/* 固定采集项 */}
              <div>
                <div className="text-xs font-medium text-[var(--muted)] mb-2">📊 提交后可查看的数据</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "停留时间", desc: "学生在页面上花费的时长" },
                    { label: "互动次数", desc: "学生的点击总次数" },
                    { label: "滚动深度", desc: "学生浏览页面的程度" },
                    { label: "完成环节", desc: "学生完成了哪些部分" },
                    { label: "最终得分", desc: "学生提交时的成绩" },
                    { label: "操作记录", desc: "学生的具体操作步骤" },
                  ].map((item) => (
                    <div key={item.label} className="bg-[var(--hover-bg)] rounded px-3 py-2">
                      <div className="text-xs font-medium text-[var(--foreground)]">{item.label}</div>
                      <div className="text-xs text-[var(--muted-light)]">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 页面互动元素 */}
              {previewAnalysis.interactiveElements?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-[var(--muted)] mb-2">🔗 页面中的互动元素</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto border border-[var(--card-border)] rounded p-2">
                    {previewAnalysis.interactiveElements.slice(0, 20).map((el: any, i: number) => {
                      const name = pickElementName(el);
                      const desc = pickElementDesc(el);
                      return (
                        <div key={i} className="text-xs text-[var(--muted)] flex gap-2 py-0.5">
                          <span className="text-[var(--primary)] shrink-0">•</span>
                          <span className="font-medium shrink-0">{name}</span>
                          {desc && <span className="text-[var(--muted-light)] truncate">{desc}</span>}
                        </div>
                      );
                    })}
                    {previewAnalysis.interactiveElements.length > 20 && (
                      <div className="text-xs text-[var(--muted-light)] pt-1">
                        还有 {previewAnalysis.interactiveElements.length - 20} 个元素未显示
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 注意事项 */}
              {previewAnalysis.warnings?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-[var(--warning)] mb-2">⚠️ 注意事项</div>
                  <div className="space-y-1">
                    {previewAnalysis.warnings.map((w: any, i: number) => (
                      <div key={i} className="text-xs text-[var(--warning)] bg-[var(--warning-light)] rounded px-3 py-2 leading-relaxed">
                        {typeof w === "string" ? w : JSON.stringify(w)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-[var(--muted-light)] pt-2 border-t leading-relaxed">
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
              sandbox="allow-scripts allow-same-origin"
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
              <div className="flex items-center justify-between px-4 py-3 bg-[var(--hover-bg)] border-b border-[var(--card-border)]">
                <div className="text-sm text-[var(--muted)]">
                  第 {quizPreviewIndex + 1} / {quizPreviewData.questions.length} 题
                </div>
                <div className="text-xs text-[var(--muted-light)]">
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
                    <div className="bg-[var(--card-bg)] rounded-xl shadow-sm p-6 border-2 border-[var(--primary)]">
                      <div className="flex items-start gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold bg-[var(--primary)] text-white">
                          {quizPreviewIndex + 1}
                        </div>
                        <div className="flex-1">
                          <div className="text-base font-medium text-[var(--foreground)]"><Markdown>{q.content}</Markdown></div>
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
                              let bgClass = "bg-[var(--hover-bg)]";
                              if (isCorrect) bgClass = "bg-[var(--success-light)] border border-[var(--success-light)]";
                              else if (isSelected && !isCorrect) bgClass = "bg-[var(--danger-light)] border border-[var(--danger-light)]";
                              return (
                                <div key={k} className={`flex items-center gap-3 p-4 rounded-lg transition-all ${bgClass}`}>
                                  <span className={`text-sm font-medium w-6 ${
                                    isCorrect ? "text-[var(--success)]" : isSelected ? "text-[var(--danger)]" : "text-[var(--muted-light)]"
                                  }`}>{k === "T" ? "T" : "F"}.</span>
                                  <span className={`text-sm flex-1 ${
                                    isCorrect ? "text-[var(--success)]" : isSelected ? "text-[var(--danger)]" : "text-[var(--muted)]"
                                  }`}>{label}</span>
                                  {isSelected && !isCorrect && <span className="ml-auto text-xs text-[var(--danger)]">你的答案</span>}
                                  {isCorrect && <span className="ml-auto text-xs text-[var(--success)]">正确答案</span>}
                                </div>
                              );
                            })}
                          </>
                        ) : Object.keys(options).length === 0 ? (
                          /* 兜底：主观题（填空/简答）无选项，预览若渲染空白教师会误以为题目缺失。
                             出题协议已禁止主观题（⛔ DO NOT REVERT，见 src/lib/prompts/quiz.ts QUIZ_FORMAT_INSTRUCTIONS 注释），
                             此分支仅防御历史/手动添加的主观题，只读展示参考答案。 */
                          <div className="p-4 rounded-lg bg-[var(--warning-light)] border border-[var(--warning-light)] text-sm text-[var(--warning)]">
                            本题为主观题（学生作答文字后由 AI 评分）。参考答案：{String(q.answer || "（无）")}
                          </div>
                        ) : (
                          Object.entries(options).map(([k, v]) => {
                            const isMulti = q.type === "MULTIPLE_CHOICE";
                            const selectedList = userAns ? userAns.split(",") : [];
                            const correctList = (q.answer || "").split(",").map((s: string) => s.trim()).filter(Boolean);
                            const isSelected = isMulti ? selectedList.includes(k) : userAns === k;
                            const isCorrect = isMulti ? correctList.includes(k) : q.answer === k;
                            let bgClass = "bg-[var(--hover-bg)]";
                            if (isCorrect) bgClass = "bg-[var(--success-light)] border border-[var(--success-light)]";
                            else if (isSelected && !isCorrect) bgClass = "bg-[var(--danger-light)] border border-[var(--danger-light)]";
                            return (
                              <div
                                key={k}
                                className={`flex items-center gap-3 p-4 rounded-lg transition-all ${bgClass}`}
                              >
                                <span className={`text-sm font-medium w-6 ${
                                  isCorrect ? "text-[var(--success)]" : isSelected ? "text-[var(--danger)]" : "text-[var(--muted-light)]"
                                }`}>{k}.</span>
                                <span className={`text-sm flex-1 ${
                                  isCorrect ? "text-[var(--success)]" : isSelected ? "text-[var(--danger)]" : "text-[var(--muted)]"
                                }`}><Markdown inline>{String(v)}</Markdown></span>
                                {isSelected && !isCorrect && <span className="ml-auto text-xs text-[var(--danger)]">你的答案</span>}
                                {isCorrect && <span className="ml-auto text-xs text-[var(--success)]">正确答案</span>}
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
              <div className="border-t border-[var(--card-border)] px-4 py-3 flex items-center justify-between bg-[var(--hover-bg)]">
                <Button
                  variant="outline"
                  size="large"
                  onClick={() => setQuizPreviewIndex((i) => Math.max(0, i - 1))}
                  disabled={quizPreviewIndex === 0}
                >
                  上一题
                </Button>
                <div className="text-sm text-[var(--muted-light)]">
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
            <div className="text-center py-8 text-sm text-[var(--muted-light)]">暂无题目</div>
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
            <div className="text-center py-8 text-sm text-[var(--muted-light)]">加载中...</div>
          ) : analysisData ? (
            <div className="space-y-4">
              {/* 班级选择 */}
              {analysisData.classIds && analysisData.classIds.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--muted)]">班级：</span>
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
                <div className="bg-[var(--primary-light)] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[var(--primary)]">{analysisData.submittedCount || 0}</div>
                  <div className="text-xs text-[var(--primary)]">已提交</div>
                </div>
                <div className="bg-[var(--success-light)] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[var(--success)]">
                    {analysisData.hasScoring ? (analysisData.averageScore ?? 0) : "—"}
                  </div>
                  <div className="text-xs text-[var(--success)]">{analysisData.hasScoring ? "平均分" : "不评分"}</div>
                </div>
                <div className="bg-[var(--warning-light)] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[var(--warning)]">{analysisData.totalStudents || 0}</div>
                  <div className="text-xs text-[var(--warning)]">班级人数</div>
                </div>
              </div>

              {/* 行为数据统计 */}
              {(analysisData.avgTimeSpent > 0 || analysisData.avgInteractions > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--primary-lighter)] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-[var(--accent)]">{analysisData.avgTimeSpent}</div>
                    <div className="text-xs text-[var(--accent)]">平均停留（秒）</div>
                  </div>
                  <div className="bg-[var(--primary-lighter)] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-[var(--accent)]">{analysisData.avgInteractions}</div>
                    <div className="text-xs text-[var(--accent)]">平均互动次数</div>
                  </div>
                </div>
              )}

              {/* 操作类型统计 */}
              {analysisData.actionTypeStats && Object.keys(analysisData.actionTypeStats).length > 0 && (
                <div>
                  <div className="text-sm font-medium text-[var(--muted)] mb-2">操作类型统计</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(analysisData.actionTypeStats).map(([type, count]) => (
                      <div key={type} className="bg-[var(--hover-bg)] rounded-full px-3 py-1 text-xs">
                        <span className="text-[var(--muted)]">{type}</span>
                        <span className="ml-1 font-medium text-[var(--foreground)]">{String(count)}次</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 分数分布 */}
              {analysisData.scoreDistribution && (
                <div>
                  <div className="text-sm font-medium text-[var(--muted)] mb-2">分数分布</div>
                  <div className="space-y-1">
                    {Object.entries(analysisData.scoreDistribution).map(([range, count]) => (
                      <div key={range} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-[var(--muted)]">{range}分</span>
                        <div className="flex-1 bg-[var(--primary-lighter)] rounded-full h-2">
                          <div
                            className="bg-[var(--primary)] rounded-full h-2"
                            style={{ width: `${Math.min(((count as number) / Math.max(analysisData.submittedCount, 1)) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-[var(--muted)] w-4">{String(count)}人</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 提交记录 */}
              {analysisData.studentRecords && analysisData.studentRecords.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-[var(--muted)] mb-2">提交记录</div>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {analysisData.studentRecords.map((record: any, idx: number) => (
                      <div key={idx} className="border border-[var(--card-border)] rounded-lg p-3 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-[var(--foreground)]">{record.studentName || record.studentId}</span>
                          <span className="text-[var(--muted-light)]">{new Date(record.submittedAt).toLocaleString()}</span>
                        </div>
                        <div className="flex gap-4 text-[var(--muted)]">
                          {analysisData.hasScoring && (
                            <span>得分：<span className="text-[var(--warning)] font-medium">{record.score}/{record.maxScore}</span></span>
                          )}
                          <span>停留：<span className="text-[var(--muted)]">{record.timeSpent}秒</span></span>
                          <span>互动：<span className="text-[var(--muted)]">{record.interactions}次</span></span>
                          <span>操作：<span className="text-[var(--muted)]">{record.actionCount}条</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 教学建议 */}
              <div className="border-t border-[var(--card-border)] pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--muted)]">教学建议</span>
                  <Button
                    theme="primary" variant="outline" size="small"
                    loading={generatingAdvice}
                    onClick={() => handleGenerateTeachingAdvice()}
                  >
                    {analysisData.teachingAdvice ? "重新生成" : "生成建议"}
                  </Button>
                </div>
                {analysisData.teachingAdvice ? (
                  <div className="bg-[var(--warning-light)] rounded-lg p-3 text-sm text-[var(--foreground)] whitespace-pre-line">
                    {analysisData.teachingAdvice}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--muted-light)] text-center py-2">暂无建议，点击上方按钮生成</div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-[var(--muted-light)]">暂无数据</div>
          )}
        </Dialog>

        {/* AI伴学提示词查看/编辑弹窗 */}
        {/* ⛔ DO NOT REVERT（2026-10-14 用户要求）：内含可编辑提示词 Textarea + 保存按钮，同「编辑课堂」弹窗规则防误关 */}
        <Dialog
          header="AI伴学提示词"
          visible={showAiCompanionPrompt}
          onClose={() => setShowAiCompanionPrompt(false)}
          closeOnOverlayClick={false}
          closeOnEscKeydown={false}
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
            <div className="text-xs text-[var(--muted)]">
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

        {/* 📐 「新建活动」类型选择弹窗（2026-10-12）：统一入口，选完类型分发到各类型现有创建流程
            （对话/探究/项目为弹窗，课堂作业为设计面板），见 handleCreateActivity。
            🔗 RELATED: 统一活动排序区块（搜索「课堂活动（按授课顺序）」） */}
        <Dialog
          header="新建活动"
          visible={newActivityDialogVisible}
          onClose={() => setNewActivityDialogVisible(false)}
          footer={null}
          width={460}
        >
          <div className="grid grid-cols-2 gap-3 pb-2">
            {([
              { type: "conversation" as const, name: "对话活动", desc: "AI 引导对话" },
              { type: "exploration" as const, name: "互动探究", desc: "网页互动 + 提交" },
              { type: "project" as const, name: "项目提交", desc: "学生上传作品" },
              { type: "quiz" as const, name: "课堂作业", desc: "在线答题练习" },
            ]).map((item) => (
              <button
                key={item.type}
                className="text-left border border-[var(--card-border)] hover:border-[var(--primary)] hover:bg-[var(--primary-light)] rounded-lg px-4 py-3 transition-colors"
                onClick={() => handleCreateActivity(item.type)}
              >
                {/* 活动类型名称跟随主题标题色（2026-10-13）：原硬编码 #333 */}
                <div className="font-medium text-sm text-[var(--title)]">{item.name}</div>
                <div className="text-xs text-[var(--muted-light)] mt-1">{item.desc}</div>
              </button>
            ))}
          </div>
        </Dialog>

        {/* 项目提交 新建/编辑 弹窗 */}
        {/* ⛔ DO NOT REVERT（2026-10-14 用户要求）：同「编辑课堂」弹窗——未保存时点遮罩/ESC 会静默丢内容，只允许显式关闭 */}
        <Dialog
          header={projDialogMode === "new" ? "新建项目" : "编辑项目"}
          visible={projDialogVisible}
          onClose={() => setProjDialogVisible(false)}
          onConfirm={saveProj}
          closeOnOverlayClick={false}
          closeOnEscKeydown={false}
          confirmBtn={{ content: "保存", loading: projSaving }}
          cancelBtn="取消"
          width={520}
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm text-[var(--foreground)]">项目名称 *</label>
              <Input
                value={projForm.title}
                onChange={(v) => setProjForm({ ...projForm, title: v as string })}
                placeholder="请输入项目名称"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--foreground)]">说明（可选）</label>
              <Textarea
                value={projForm.description}
                onChange={(v) => setProjForm({ ...projForm, description: v as string })}
                placeholder="简单描述项目要求"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--foreground)]">项目类别</label>
              <div className="flex gap-2 mt-1">
                {(["TEXT", "IMAGE", "VIDEO"] as const).map((c) => (
                  <Button
                    key={c}
                    size="small"
                    theme={projForm.category === c ? "primary" : "default"}
                    variant={projForm.category === c ? "base" : "outline"}
                    onClick={() => setProjForm({ ...projForm, category: c })}
                  >
                    {c === "TEXT" ? "文本类" : c === "IMAGE" ? "图片类" : "音视频类"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={projForm.visibleToClass}
                  onChange={(e) =>
                    setProjForm({
                      ...projForm,
                      visibleToClass: e.target.checked,
                      allowLike: e.target.checked ? projForm.allowLike : false,
                    })
                  }
                />
                全班可见
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={projForm.allowLike}
                  disabled={!projForm.visibleToClass}
                  onChange={(e) =>
                    setProjForm({ ...projForm, allowLike: e.target.checked })
                  }
                />
                允许点赞（自动开全班可见）
              </label>
            </div>
            <div>
              <label className="text-sm text-[var(--foreground)]">文件大小限制（MB，默认 10）</label>
              <InputNumber
                value={projForm.fileSizeLimit}
                min={1}
                onChange={(v) =>
                  setProjForm({ ...projForm, fileSizeLimit: Number(v) || 10 })
                }
              />
            </div>
          </div>
        </Dialog>

        {/* 删除项目提交确认 */}
        <Dialog
          header="删除项目提交"
          visible={!!projDelete}
          onClose={() => setProjDelete(null)}
          onConfirm={confirmDeleteProj}
          confirmBtn="删除"
          cancelBtn="取消"
          theme="danger"
        >
          <p className="text-sm text-[var(--foreground)]">
            确定删除「{projDelete?.title}」吗？该任务下所有学生的提交及附件文件将一并删除，不可恢复。
          </p>
        </Dialog>

</div>
    </TeacherLayout>
  );
}
