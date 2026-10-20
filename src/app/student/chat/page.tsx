"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Button, Input, MessagePlugin, Tag } from "tdesign-react";
import {
  SendIcon,
  ImageIcon,
  AddIcon,
  ChatIcon,
  MicrophoneIcon,
  BookOpenIcon,
  BrowseIcon,
  AssignmentIcon,
  EditIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "tdesign-icons-react";
import Markdown from "@/components/Markdown";
import SpeechControls from "@/components/speech/SpeechControls";
import SpeakButton from "@/components/speech/SpeakButton";
import { speakSmart, stopSpeaking } from "@/lib/speech";
import { getSpeechSettings } from "@/lib/speech-settings";
import StudentLayout from "@/components/layout/StudentLayout";
import QuizPanel from "./QuizPanel";
import ExplorationPanel from "./ExplorationPanel";
import ProjectSubmitPanel from "./ProjectSubmitPanel";

interface MessageImage {
  url: string;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  images?: MessageImage[];
  audioUrl?: string;
  createdAt?: string;
  // 本次回复所用线路（后端响应头 X-Model-Route）：text=图文模型（指示点绿）、omni=全媒体模型（指示点黑）。
  // 历史消息无此字段（未存库），渲染时无指示点；仅新生成的回复显示。
  modelRoute?: "text" | "omni";
}

interface PresetConversation {
  id: string;
  title: string;
  description?: string;
  // 教师开场白（2026-10-13）：学生进入对话后 AI 的第一句话，本地渲染 + 首条发言时随上下文发送
  openingMessage?: string;
  systemPrompt?: string;
  // 📐 跨类型统一排序（2026-10-12）：4 表共用一个 sortOrder 数值空间（src/lib/activities/unified-order.ts），
  // 学生端侧边栏按它合并渲染授课顺序
  sortOrder?: number;
}

interface SubProject {
  id: string;
  title: string;
  description?: string;
  objectives: string;
  requirements: string;
  knowledgeBase?: string;
  presetConversations: PresetConversation[];
  quizActivities?: QuizInfo[];
  explorations?: ExplorationInfo[];
  projectSubmissions?: ProjectSubmissionInfo[];
}

interface ExplorationInfo {
  id: string;
  title: string;
  description?: string;
  htmlContent?: string;
  enableSubmission?: boolean;
  enableAiCompanion?: boolean;
  questionsJson?: string;
  sortOrder?: number;
}

interface QuestionData {
  id: string;
  type: string;
  content: string;
  options: string | Record<string, string>;
  answer: string;
  difficulty: string;
  order: number;
  score?: number;
}

interface QuizInfo {
  id: string;
  title: string;
  description?: string;
  status?: string;
  questions?: QuestionData[];
  _count?: { questions: number; attempts: number };
  sortOrder?: number;
}

interface ProjectSubmissionInfo {
  id: string;
  title: string;
  description?: string;
  category: "TEXT" | "IMAGE" | "VIDEO";
  visibleToClass: boolean;
  allowLike: boolean;
  fileSizeLimit: number;
  sortOrder?: number;
}

interface LearningTask {
  id: string;
  title: string;
  description?: string;
  objectives: string;
  requirements: string;
  knowledgeBase?: string;
  subProjects: SubProject[];
}

// 用户实际的对话记录
interface Conversation {
  id: string;
  presetConversationId: string | null;
  title: string;
  updatedAt: string;
  messages: { id: string; role: string; content: string; createdAt: string }[];
}

// 与服务端 /api/chat 约定的「已切换模型」流内标记：识别后显示切换提示并剥离（不入正文）
const SWITCH_PREFIX = "\u0000SWITCH\u0000";

/**
 * 📐 活动类型中文名（2026-10-15）：侧边栏活动名称 hover 时显示类型（见 ActivityNameTip），
 * 与下方活动列表的 act.type 字面量一一对应。
 * 现状约束：仅展示用，不参与排序/过滤；新增活动类型时必须同步补本映射，否则 hover 无文字。
 * 🔗 RELATED：本文件活动列表渲染处（搜索 ACTIVITY_TYPE_LABEL）；教师端"活动"命名口径同此。
 * ⛔ DO NOT REVERT：勿改回"仅靠图标区分类型"——图标对低年级/色弱学生不友好，文字是唯一语义出口。
 */
const ACTIVITY_TYPE_LABEL: Record<"conversation" | "exploration" | "project" | "quiz", string> = {
  conversation: "对话活动",
  exploration: "互动探究",
  project: "项目提交",
  quiz: "课堂作业",
};

/**
 * 📐 活动名称 hover 类型提示（2026-10-15）：鼠标移到活动名称上，显示类型名 0.5s 后自动消失。
 * 不用 TDesign Tooltip 的 duration——它只对组件首次挂载生效一次，做不到"每次 hover 都自动隐藏"，
 * 故自实现：hover 启动 500ms 定时器，到点 setVisible(false) 淡出；移开立即隐藏。
 * 现状约束：气泡 absolute 定位于 relative wrapper 上（标题 span 自带 overflow:hidden 的 truncate，
 *   气泡若放 span 内部会被裁剪）；wrapper 用 min-w-0 max-w-full 保住原 truncate 收缩/省略行为。
 * 🔗 RELATED：ACTIVITY_TYPE_LABEL（类型中文名）；本文件活动列表渲染处。
 * ⛔ DO NOT REVERT：勿换回 TDesign Tooltip（无法每次 hover 自动隐藏）；勿把气泡塞进 truncate span 内部。
 */
function ActivityNameTip({
  label,
  active,
  color,
  children,
}: {
  label: string;
  active: boolean;
  color?: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const show = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setVisible(true);
    timerRef.current = window.setTimeout(() => setVisible(false), 500);
  };
  const hide = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setVisible(false);
  };
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  return (
    <span className="relative inline-flex min-w-0 max-w-full" onMouseEnter={show} onMouseLeave={hide}>
      <span className={`text-[15px] truncate ${active ? "font-medium" : "text-[#333]"}`} style={active ? { color } : undefined}>
        {children}
      </span>
      <span
        className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#333] px-2 py-1 text-xs text-white shadow-md transition-opacity duration-150 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {label}
      </span>
    </span>
  );
}

/** 将服务端返回的 messages 列表规范化为前端 Message 结构（页面内多处使用，统一收敛）
 * 多模态消息 content 是 JSON 字符串，需要解析出文本、图片、音频。 */
function normalizeMessages(
  list: { id: string; role: string; content: string; createdAt: string }[] | undefined
): Message[] {
  return (list || []).map((m) => {
    const parsed = parseStoredContent(m.content);
    return {
      id: m.id,
      role: m.role as "user" | "assistant",
      content: parsed.text,
      images: parsed.images,
      audioUrl: parsed.audioUrl,
      createdAt: m.createdAt,
    };
  });
}

/** 解析服务端存储的消息 content：
 * - 普通文本直接返回；
 * - 多模态 JSON 数组提取 text、image_url、audio_url。 */
function parseStoredContent(content: string): {
  text: string;
  images?: MessageImage[];
  audioUrl?: string;
} {
  if (!content.startsWith("[")) {
    return { text: content };
  }
  try {
    const parts = JSON.parse(content) as Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
      | { type: "audio_url"; audio_url: { url: string } }
    >;
    if (!Array.isArray(parts)) return { text: content };

    const text = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    const images = parts
      .filter((p): p is { type: "image_url"; image_url: { url: string } } => p.type === "image_url")
      .map((p) => ({ url: p.image_url.url }));
    const audioPart = parts.find(
      (p): p is { type: "audio_url"; audio_url: { url: string } } => p.type === "audio_url"
    );
    return {
      text,
      images: images.length > 0 ? images : undefined,
      audioUrl: audioPart?.audio_url.url,
    };
  } catch {
    return { text: content };
  }
}

/** 将本地消息列表转换为对话接口要求的 API 格式（文本 / 图片 / 音频多段内容） */
function toApiMessages(messages: Message[]) {
  return messages.map((m) => {
    const hasImages = m.images && m.images.length > 0;
    const hasAudio = !!m.audioUrl;
    if (hasImages || hasAudio) {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
        | { type: "audio_url"; audio_url: { url: string } }
      > = [{ type: "text", text: m.content }];
      if (hasImages) {
        parts.push(
          ...m.images!.map((img) => ({
            type: "image_url" as const,
            image_url: { url: img.url },
          }))
        );
      }
      if (hasAudio) {
        parts.push({ type: "audio_url" as const, audio_url: { url: m.audioUrl! } });
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * 渲染探索面板（避免在 JSX 中直接用 IIFE）。
 *
 * ⚠️ GOTCHA —— 本组件 MUST STAY AT MODULE TOP LEVEL，禁止移回 StudentChatPage 函数体内：
 * 若定义在父组件函数体内，父组件每次渲染（任何 state 变化：收起/展开侧边栏、收到新消息、切换输入……）
 * 都会产生一个「新的组件类型」，React 会卸载并重挂整个子树 —— ExplorationPanel 内的 iframe 随之销毁重建，
 * 探究页面状态被重置、AI 伴学对话记录全部丢失。定义在模块顶层后组件类型恒定，父组件重渲染只引起
 * 普通 re-render，不再 remount。
 *
 * 📐 CONTRACT：props 全部显式传入（explorationId / tasks / onBack），不引用任何父组件闭包变量；
 * 探究 HTML 由本组件自行 fetch（/api/student/explorations/[id]）并持有为内部 state，
 * 与父组件的对话消息流互不干扰。
 *
 * 🔗 RELATED：./ExplorationPanel（真正渲染 iframe 的组件）；调用点在本文件
 *   「activeType === "exploration"」分支（搜索 ExplorationPanelRender）。
 * ⛔ DO NOT REVERT：不要为了「就近取用父组件变量」把它挪回函数体内 —— 那正是 iframe 重载、
 *   伴学对话丢失 bug 的根源（2026-09 实测：折叠侧边栏即触发 iframe 整页重载）。
 */
function ExplorationPanelRender({ explorationId, tasks, onBack }: { explorationId: string; tasks: LearningTask[]; onBack: () => void }) {
  const exp = tasks
    .flatMap(t => t.subProjects.flatMap(sp => sp.explorations || []))
    .find(e => e.id === explorationId);
  const [html, setHtml] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    setHtml("");
    const tk = localStorage.getItem("token");
    if (!tk) return;
    fetch(`/api/student/explorations/${explorationId}`, { headers: { Authorization: `Bearer ${tk}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.htmlContent === "string") setHtml(d.htmlContent); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [explorationId]);
  if (!exp) return null;
  return (
    <ExplorationPanel
      explorationId={exp.id}
      htmlContent={html}
      enableSubmissionEnabled={exp.enableSubmission}
      enableAiCompanion={exp.enableAiCompanion}
      onBack={onBack}
    />
  );
}

export default function StudentChatPage() {
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  // 是否显示「正在切换模型」提示（服务端流内标记触发，正文开始后随 loading 一起消失）
  const [switchNotice, setSwitchNotice] = useState(false);

  // 作业状态
  const [activeType, setActiveType] = useState<"chat" | "quiz" | "exploration" | "project" | null>(null);
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [activeExplorationId, setActiveExplorationId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // 侧边栏折叠状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 📐 课堂活动折叠状态（2026-10-12）：多课堂时默认只展开最新课堂（后端 orderBy createdAt desc，tasks[0] 最新），
  // 其他课堂折叠；当前选中活动所在课堂强制展开，避免高亮项看不见。
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  // 朗读的开关 / 音色 / 语速统一由 lib/speech-settings 管理（见 SpeechControls 组件）；
  // 这里只记录最新一条 AI 回答的下标，供自动朗读时高亮对应的朗读按钮。
  const assistantIndexRef = useRef(-1);

  // 图片 / 音频附件
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [pendingAudio, setPendingAudio] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 话筒页内录音（2026-10-15 需求：点击直接调用麦克风，再点停止，录完作为语音附件）
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePresetRef = useRef<string | null>(null);
  const isSwitchingRef = useRef(false); // 防止 switch 函数重入
  const latestDetailConvRef = useRef<string | null>(null); // 最新一次详情请求的对话 ID（竞态保护：快速切换后丢弃旧响应）
  const scrollContainerRef = useRef<HTMLDivElement>(null); // 消息滚动容器（判断是否处于底部附近）
  const messagesInnerRef = useRef<HTMLDivElement>(null); // 消息内容内层（供 ResizeObserver 观察内容高度突变）
  const prevMsgCountRef = useRef(-1); // 上一次渲染的消息条数（区分"新增消息"与"流式更新最后一条"）

  const scrollToBottom = () => {
    // 直接设置消息容器的 scrollTop：只滚动消息区，绝不波及页面级滚动。
    // scrollIntoView 默认 block:"start" 会滚动所有可滚动祖先链（含页面本身），
    // 流式期间高频调用会导致页面来回跳动、底部输入框位置闪烁。
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 组件卸载时兜底停止录音并释放麦克风
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    // 新增消息（条数变化：发送、回复首包、加载历史）→ 无条件滚到底；
    // 流式更新最后一条内容（条数不变）→ 仅当用户本就在底部附近时跟随，
    // 避免学生上滚回看流程图时被强行拉回底部
    const countChanged = prevMsgCountRef.current !== messages.length;
    prevMsgCountRef.current = messages.length;
    const el = scrollContainerRef.current;
    const nearBottom =
      !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (countChanged || nearBottom) {
      scrollToBottom();
    }
  }, [messages]);

  // 高度突变补偿：mermaid 图表渲染完成、图片加载等会撑高内容但不改变 messages，
  // 此时若用户在底部附近则跟随滚动，修复"画面停留在流程图而非最新消息"
  useEffect(() => {
    const outer = scrollContainerRef.current;
    const inner = messagesInnerRef.current;
    if (!outer || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const nearBottom =
        outer.scrollHeight - outer.scrollTop - outer.clientHeight < 120;
      if (nearBottom) {
        scrollToBottom();
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [activePresetId, activeType]);

  // 当 activePresetId 变化时，清除重入锁（让后续点击可进入 switchToChat）
  useEffect(() => {
    isSwitchingRef.current = false;
  }, [activePresetId, activeType]);

  // 根据当前选中的活动 ID，反查它属于哪个课堂（用于自动展开该课堂）。
  const getActiveTaskId = () => {
    if (!activeType) return null;
    for (const task of tasks) {
      for (const sp of task.subProjects) {
        if (activeType === "chat" && sp.presetConversations.some((pc) => pc.id === activePresetId)) return task.id;
        if (activeType === "quiz" && (sp.quizActivities || []).some((q) => q.id === activeQuizId)) return task.id;
        if (activeType === "exploration" && (sp.explorations || []).some((e) => e.id === activeExplorationId)) return task.id;
        if (activeType === "project" && (sp.projectSubmissions || []).some((p) => p.id === activeProjectId)) return task.id;
      }
    }
    return null;
  };

  // 多课堂折叠策略：首次加载默认展开最新课堂；切换活动后自动展开所在课堂。
  useEffect(() => {
    let changed = false;
    const next = new Set(expandedTaskIds);
    if (next.size === 0 && tasks.length > 0) {
      next.add(tasks[0].id);
      changed = true;
    }
    const activeTaskId = getActiveTaskId();
    if (activeTaskId && !next.has(activeTaskId)) {
      next.add(activeTaskId);
      changed = true;
    }
    if (changed) setExpandedTaskIds(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, activeType, activePresetId, activeQuizId, activeExplorationId, activeProjectId]);

  const fetchData = async () => {
    const token = localStorage.getItem("token");
    // 1) 先拉课堂列表并立即渲染（接口已瘦身，体积小、响应快）
    try {
      const tasksRes = await fetch("/api/student/tasks", { headers: { Authorization: `Bearer ${token}` } });
      if (tasksRes.ok) setTasks(await tasksRes.json());
    } catch {
      console.error("加载课堂失败");
    } finally {
      setLoadingData(false); // 列表先出来，不再等对话记录
    }
    // 2) 对话记录后台异步补充（仅影响"已学"标记，不阻塞列表渲染）
    try {
      const convsRes = await fetch("/api/conversations", { headers: { Authorization: `Bearer ${token}` } });
      if (convsRes.ok) setConversations(await convsRes.json());
    } catch {
      console.error("加载对话记录失败");
    }
  };

  // 找到对话活动对应的所有 conversations（一个预设可以有多个对话）
  const findConversations = (presetId: string): Conversation[] => {
    return conversations.filter((c) => c.presetConversationId === presetId);
  };

  // 统一的侧边栏点击处理：先清除所有状态，再设置目标状态
  const switchToChat = (presetId: string, convId?: string) => {
    // 防止快速双击导致的问题
    if (isSwitchingRef.current) return;

    // 取消正在进行的 AI 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    stopSpeaking(); // 切换对话，停止上一条朗读

    // 判断是否点击了同一个预设
    const isSamePreset = activePresetId === presetId && activeType === "chat";

    isSwitchingRef.current = true;
    setActiveType("chat");
    setActiveQuizId(null);
    setActiveExplorationId(null);
    setQuizSubmitted(false);
    setMessages([]);
    setActivePresetId(presetId);
    activePresetRef.current = presetId;

    // 加载该预设下最新的对话记录
    // 修复：本地快照仅用于"立刻出图"，可能是过期数据（本次会话新发的消息只更新
    // messages state，不回写快照），因此无论快照是否有内容，都无条件并发一次
    // 服务端请求用真数据覆盖——只要服务端有，就一定显示出来。
    const loadConv = (id?: string) => {
      const convs = findConversations(presetId);
      if (convs.length === 0) {
        setActiveConvId(null);
        setMessages([]);
        return;
      }
      const targetConv = id ? convs.find((c) => c.id === id) : convs[0];
      if (targetConv) {
        setActiveConvId(targetConv.id);
        if (targetConv.messages && targetConv.messages.length > 0) {
          // 先用本地快照立即渲染（避免白屏/闪烁），随后由服务端响应覆盖
          setMessages(normalizeMessages(targetConv.messages));
        }
        fetchConversationDetail(targetConv.id);
      } else {
        setActiveConvId(null);
        setMessages([]);
      }
    };

    if (isSamePreset) {
      loadConv(convId);
      setTimeout(() => { isSwitchingRef.current = false; }, 100);
    } else {
      loadConv(convId);
    }
  };

  // 从服务端加载单个对话详情（作为唯一事实来源覆盖本地快照）
  const fetchConversationDetail = async (convId: string) => {
    latestDetailConvRef.current = convId;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // 失败必须有日志：这类静默失败最难排查（界面停留在空/旧数据且无任何提示）
        console.error(`[对话详情] 加载失败: HTTP ${res.status}, convId=${convId}`);
        return;
      }
      const conv = await res.json();
      // 竞态保护：响应到达时若已切换到其他对话，丢弃本次结果，防止旧数据覆盖新对话
      if (latestDetailConvRef.current !== convId) return;
      setMessages(normalizeMessages(conv.messages));
      // 回写 conversations 快照，保持列表数据与服务端同步
      setConversations((prev) => prev.map((c) =>
        c.id === convId ? { ...c, messages: conv.messages } : c
      ));
    } catch (e) {
      console.error(`[对话详情] 请求异常: convId=${convId}`, e);
    }
  };

  const switchToQuiz = (quizId: string) => {
    // 每次点击作业都重置状态，确保重新加载
    setQuizSubmitted(false);
    setActiveType("quiz");
    setActiveQuizId(quizId);
    setActivePresetId(null);
    setActiveConvId(null);
    setActiveExplorationId(null);
    // 取消正在进行的 AI 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    stopSpeaking();
  };

  const switchToExploration = (expId: string) => {
    setActiveType("exploration");
    setActiveExplorationId(expId);
    setActivePresetId(null);
    setActiveConvId(null);
    setActiveQuizId(null);
    setQuizSubmitted(false);
    // 取消正在进行的 AI 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    stopSpeaking();
  };

  const switchToProject = (projectId: string) => {
    setActiveType("project");
    setActiveProjectId(projectId);
    setActivePresetId(null);
    setActiveConvId(null);
    setActiveQuizId(null);
    setActiveExplorationId(null);
    setQuizSubmitted(false);
    // 取消正在进行的 AI 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    stopSpeaking();
  };

  // 找到当前对话活动的描述
  const getCurrentPresetInfo = () => {
    for (const task of tasks) {
      for (const sp of task.subProjects) {
        for (const pc of sp.presetConversations) {
          if (pc.id === activePresetId) {
            return { task, subProject: sp, preset: pc };
          }
        }
      }
    }
    return null;
  };

  // 图片处理
  const handleImageSelect = (files: FileList | File[] | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        MessagePlugin.error("请选择图片文件");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        MessagePlugin.error("图片不能超过 10MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result as string;
        setPendingImages((prev) => [...prev, { url }]);
      };
      reader.readAsDataURL(file);
    });
  };

  // ⛔ DO NOT REVERT: 音频统一转码为 WAV。AI SDK（@ai-sdk/openai）的 file part 音频
  //   只接受 audio/wav、audio/mp3、audio/mpeg，m4a/ogg/webm 会抛 UnsupportedFunctionalityError；
  //   浏览器 Web Audio 可解码任意格式，故上传前统一转 16kHz 单声道 WAV，保证全格式可用。
  //   后端 /api/chat 收到 data:audio/wav;base64, 后转 file part 直通（见 route.ts mediaTypeToExt）。
  const transcodeAudioToWav = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const targetRate = 16000;
      const length = Math.ceil(audioBuffer.duration * targetRate);
      const offlineCtx = new OfflineAudioContext(1, length, targetRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);
      const rendered = await offlineCtx.startRendering();
      const pcm = rendered.getChannelData(0);

      // 编码 16bit PCM WAV
      const buffer = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(buffer);
      const writeStr = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + pcm.length * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // 单声道
      view.setUint32(24, targetRate, true);
      view.setUint32(28, targetRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }

      const wavBlob = new Blob([buffer], { type: "audio/wav" });
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(wavBlob);
      });
    } finally {
      void ctx.close();
    }
  };

  // 音频附件处理：选择录音/音频文件，统一转码为 16kHz 单声道 WAV 后暂存
  const handleAudioSelect = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("audio/")) {
      MessagePlugin.error("请选择音频文件");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      MessagePlugin.error("音频不能超过 20MB");
      return;
    }
    try {
      const url = await transcodeAudioToWav(file);
      setPendingAudio(url);
    } catch {
      MessagePlugin.error("音频解析失败，请换用常见格式（m4a/mp3/wav）");
    }
  };

  // ⛔ 添加文件按钮（2026-10-15 需求）：一个入口同时支持图片（jpg/png/jpeg）与音频（m4a/mp3/wav），按类型分流处理
  const handleAttachmentSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const images: File[] = [];
    const audios: File[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) images.push(file);
      else if (file.type.startsWith("audio/")) audios.push(file);
      else MessagePlugin.error(`不支持的文件：${file.name}（仅支持图片和音频）`);
    });
    if (images.length > 0) handleImageSelect(images);
    if (audios.length > 0) handleAudioSelect(audios);
  };

  // ⛔ 话筒页内录音（2026-10-15 需求：点击直接调用麦克风开始录音，再点停止，录完作为语音附件）
  // 录音统一走 transcodeAudioToWav 转 16kHz 单声道 WAV，与"选择音频文件"共用同一条发送链路
  const MAX_RECORD_SEC = 60;
  const clearRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };
  const formatRecordSec = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const toggleRecording = async () => {
    // 录音中：点击停止
    if (isRecording) {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      return;
    }
    if (!activePresetId) return;
    if (typeof MediaRecorder === "undefined") {
      MessagePlugin.error("当前浏览器不支持录音，请用 Chrome / Edge");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recordingStreamRef.current = stream;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordingChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        clearRecordingTimer();
        setIsRecording(false);
        setRecordingSec(0);
        recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size === 0) return;
        try {
          const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type });
          const url = await transcodeAudioToWav(file);
          setPendingAudio(url);
        } catch {
          MessagePlugin.error("录音解析失败，请重试");
        }
      };
      recorder.start();
      setIsRecording(true);
      setRecordingSec(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSec((s) => {
          const next = s + 1;
          if (next >= MAX_RECORD_SEC) {
            // 到时自动停止录音
            const rec = mediaRecorderRef.current;
            if (rec && rec.state !== "inactive") rec.stop();
          }
          return next;
        });
      }, 1000);
    } catch {
      MessagePlugin.error("无法访问麦克风，请检查浏览器权限设置");
    }
  };

  const removePendingAudio = () => {
    setPendingAudio(null);
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  // 发送消息（供自动发送和手动发送共用）
  const sendMessage = async (text: string, images?: MessageImage[], audioUrl?: string) => {
    if (!text.trim() || loading) return;
    stopSpeaking(); // 发送新消息，停止上一条朗读
    setSwitchNotice(false); // 新一轮对话重置切换提示
    // 使用 ref 而非 state 检查当前活动，因为 state 在 setTimeout 中可能还是旧值
    const currentPresetId = activePresetRef.current;
    if (!currentPresetId) return;

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 复用该预设对话下已有的对话，避免同一预设创建多个对话
    let snapshotConvId = activeConvId;
    if (!snapshotConvId) {
      const existingConvs = findConversations(currentPresetId);
      if (existingConvs.length > 0) {
        snapshotConvId = existingConvs[0].id;
        setActiveConvId(snapshotConvId);
      }
    }

    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const userMessage: Message = {
      role: "user",
      content: text,
      images: images && images.length > 0 ? [...images] : undefined,
      audioUrl,
    };
    // 教师开场白（2026-10-13）：对话尚未开始时，把开场白拼进首条发言的上下文，
    // AI 顺着开场白继续对话；/api/chat 新会话分支会把它落库为 assistant 首条消息，
    // 刷新后从库中读到的历史与此处渲染一致，不会重复。
    const presetInfo = getCurrentPresetInfo();
    const openingMessage: Message | null =
      presetInfo?.preset?.openingMessage && messages.length === 0
        ? { role: "assistant", content: presetInfo.preset.openingMessage }
        : null;
    // 完整历史 + 可能的开场白 + 本条新消息。开场白仅在冷启动（messages 为空）时补入，
    // 与后端"仅新会话落库一次开场白"口径一致，不会重复；历史必须展开，否则发送时
    // 界面被重置只剩一轮，AI 上下文也随之失忆（2026-10-13 回归修复）。
    const newMessages = [
      ...(openingMessage ? [openingMessage] : []),
      ...messages,
      userMessage,
    ];
    setMessages(newMessages);
    setInput("");
    if (images) setPendingImages([]);
    if (audioUrl) setPendingAudio(null);
    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const apiMessages = toApiMessages(newMessages);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          classId: user.classId,
          conversationId: snapshotConvId,
          presetConversationId: currentPresetId,
        }),
        signal: controller.signal,
      });

      // 如果用户已切换到其他活动，忽略本次响应
      if (activePresetRef.current !== currentPresetId) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "请求失败");
      }

      const newConvId = res.headers.get("X-Conversation-Id");
      // 本次回复所用线路（后端 X-Model-Route 响应头）：text=图文模型、omni=全媒体模型，
      // 渲染时在回复首个字符前显示指示点（绿=图文、黑=全媒体）
      const modelRoute = (res.headers.get("X-Model-Route") || "text") as "text" | "omni";
      // 新建对话时立即更新 activeConvId 并追加到列表（避免被后续请求覆盖）
      if (newConvId) {
        setActiveConvId(newConvId);
        if (!snapshotConvId) {
          // 新创建的对话，追加到 conversations 列表
          setConversations((prev) => [
            {
              id: newConvId,
              userId: user.id || "",
              classId: user.classId || "",
              presetConversationId: currentPresetId || null,
              title: text.slice(0, 50) || "新对话",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messages: [],
            },
            ...prev,
          ]);
        }
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let assistantAdded = false; // 标记是否已添加 assistant 气泡
      let pendingPrefix = ""; // 跨 chunk 缓冲「已切换模型」标记

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // 流式读取过程中检查是否被切换
          if (activePresetRef.current !== currentPresetId) return;
          const chunk = decoder.decode(value, { stream: true });

          // 剥离「已切换模型」标记：标记可能跨 chunk 分割（服务端单独 enqueue，网络分帧不保证一次取全）
          if (!assistantAdded) {
            const combined = pendingPrefix + chunk;
            const swIdx = combined.indexOf(SWITCH_PREFIX);
            if (swIdx === 0) {
              setSwitchNotice(true); // 标记在前：剥离后正文为空，切换提示由 loading 区显示
              pendingPrefix = "";
              assistantContent = combined.slice(SWITCH_PREFIX.length);
            } else if (swIdx > 0) {
              setSwitchNotice(true);
              pendingPrefix = "";
              assistantContent = combined.slice(0, swIdx) + combined.slice(swIdx + SWITCH_PREFIX.length);
            } else if (combined.length > 0 && SWITCH_PREFIX.startsWith(combined)) {
              pendingPrefix = combined; // 收到的仍是标记的一部分，继续等下一块
            } else {
              pendingPrefix = "";
              assistantContent = combined; // 无标记：全部当正文
            }
          } else {
            assistantContent += chunk;
          }

          if (!assistantAdded) {
            // 收到第一个 chunk 时才添加 assistant 气泡（带初始内容与线路指示点）
            assistantAdded = true;
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: assistantContent, modelRoute },
            ]);
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: assistantContent,
                modelRoute,
              };
              return updated;
            });
          }
        }
      }

      // 语音转写回显（2026-10-15）：纯语音消息发送时，后端已用全媒体模型把语音转成文字入库；
      // 流式回复结束后重拉本对话详情，把本地占位符"(发送了语音)"替换为转写文字（与刷新等价）。
      // 仅纯语音触发（文字+语音并存时，用户输入的文字即内容，无需回写）。
      const detailConvId = newConvId || snapshotConvId;
      if (audioUrl && text.trim() === "(发送了语音)" && detailConvId) {
        fetchConversationDetail(detailConvId);
      }

      // 流式回答生成完毕后，若朗读开关为开则自动朗读整段回答（讲完再读）
      if (getSpeechSettings().enabled && assistantContent.trim()) {
        // 安卓平板等设备可能没有任何语音引擎，静默失败会让学生以为"坏了"，给出可见提示
        speakSmart(assistantContent, { owner: `msg-${assistantIndexRef.current}` }).then(
          (result) => {
            if (result === "no-voice") {
              MessagePlugin.warning("自动朗读失败：当前设备没有可用的语音，请检查媒体音量或改用电脑");
            }
          },
          () => {}
        );
      }

    } catch (error) {
      // 如果是主动取消的请求，不提示错误
      if (error instanceof DOMException && error.name === "AbortError") {
        setLoading(false);
        return;
      }
      setLoading(false); // 确保即使 MessagePlugin.error 抛出也重置状态
      try { MessagePlugin.error(error instanceof Error ? error.message : "发送失败"); } catch { /* 忽略插件错误 */ }
      setMessages((prev) => {
        const updated = [...prev];
        if (
          updated.length > 0 &&
          updated[updated.length - 1].role === "assistant" &&
          !updated[updated.length - 1].content
        ) {
          updated.pop();
        }
        return updated;
      });
    } finally {
      setLoading(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  // 手动发送
  const handleSend = async () => {
    if (!input.trim() && pendingImages.length === 0 && !pendingAudio) return;
    const text = input || (pendingAudio ? "(发送了语音)" : "(发送了图片)");
    const imgs = pendingImages.length > 0 ? [...pendingImages] : undefined;
    const audio = pendingAudio || undefined;
    setInput("");
    setPendingImages([]);
    setPendingAudio(null);
    await sendMessage(text, imgs, audio);
  };

  const handleKeyDown = (value: string, context: { e: React.KeyboardEvent }) => {
    if (context.e.key === "Enter" && !context.e.shiftKey) {
      context.e.preventDefault();
      handleSend();
    }
  };

  const currentInfo = getCurrentPresetInfo();

  return (
    <StudentLayout>
      <div className="flex h-[calc(100vh-88px)] bg-white rounded-xl shadow-sm overflow-hidden">
        {/* 左侧：任务树 */}
        <div className={`${sidebarCollapsed ? 'w-10' : 'w-72'} border-r border-gray-200 flex flex-col bg-[#F7F8FA] transition-all duration-200`}>
          <div className="p-3 border-b border-gray-200 flex items-center justify-between">
            {!sidebarCollapsed && <h3 className="text-sm font-medium text-[#1A1A1A]">宁创教学智能体</h3>}
            <button
              className="text-gray-400 hover:text-gray-600 text-xs px-1"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            >
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
          </div>
          {!sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto">
            {loadingData ? (
              <div className="text-center text-gray-400 text-sm py-8">加载中...</div>
            ) : tasks.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8 px-4">
                暂无课堂，请等待教师分配
              </div>
            ) : (
              tasks.map((task) => {
                // 收集该课堂下所有生效的作业（仅显示ACTIVE状态）
                const allQuizzes = task.subProjects.flatMap((sp) => (sp.quizActivities || []).filter(q => q.status === "ACTIVE"));
                return (
                  <div key={task.id}>
                    {/* 任务标题（可点击折叠/展开课堂活动） */}
                    <div
                      className="px-3 py-2.5 border-b border-gray-100 bg-gray-50 cursor-pointer hover:bg-gray-100"
                      onClick={() => {
                        setExpandedTaskIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(task.id)) next.delete(task.id);
                          else next.add(task.id);
                          return next;
                        });
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {expandedTaskIds.has(task.id) ? (
                          <ChevronDownIcon className="text-gray-400 shrink-0" size="14px" />
                        ) : (
                          <ChevronRightIcon className="text-gray-400 shrink-0" size="14px" />
                        )}
                        {/* 课堂图标升级（2026-10-13 美化）：Folder → BookOpen + 浅蓝底座，语义更贴近"课堂" */}
                        <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#0052D9]/10">
                          <BookOpenIcon size="14px" style={{ color: "#0052D9" }} />
                        </span>
                        <span className="text-[15px] font-medium text-[#1A1A1A] truncate">
                          {task.title}
                        </span>
                      </div>
                    </div>

                    {expandedTaskIds.has(task.id) && (
                      <>
                        {/* 📐 统一活动列表（2026-10-12）：4 类活动按老师设计的跨类型顺序合并渲染。
                            排序口径 = 后端各表 sortOrder（4 表共用一个数值空间，见 src/lib/activities/unified-order.ts，
                            存量数据经 scripts/migrate-unified-activity-order.mjs 重排）。
                            ⛔ DO NOT REVERT: 不要改回按类型分组的 4 个区块——老师跨类型调的授课顺序会被拆散。
                            停用/未发布活动学生端不显示（/api/student/tasks 已按 enabled/status 过滤，
                            此处作业再按 ACTIVE 过滤一次兜底）。 */}
                        {(() => {
                          const acts = task.subProjects.flatMap((sp) => [
                            ...(sp.presetConversations || []).map((pc) => ({ type: "conversation" as const, id: pc.id, sortOrder: pc.sortOrder ?? 0, pc })),
                            ...(sp.explorations || []).map((exp) => ({ type: "exploration" as const, id: exp.id, sortOrder: exp.sortOrder ?? 0, exp })),
                            ...(sp.projectSubmissions || []).map((ps) => ({ type: "project" as const, id: ps.id, sortOrder: ps.sortOrder ?? 0, ps })),
                            ...(sp.quizActivities || []).filter((q) => q.status === "ACTIVE").map((quiz) => ({ type: "quiz" as const, id: quiz.id, sortOrder: quiz.sortOrder ?? 0, quiz })),
                          ]).sort((a, b) => a.sortOrder - b.sortOrder);
                          if (acts.length === 0) {
                            return (
                              <div className="px-3 py-3 text-center text-gray-400 text-sm border-b border-gray-50">
                                本课堂暂无活动
                              </div>
                            );
                          }
                          const colorMap = { conversation: "#0052D9", exploration: "#00A870", project: "#FF7D00", quiz: "#6366F1" } as const;
                          return acts.map((act) => {
                            const color = colorMap[act.type];
                            const isActive =
                              (act.type === "conversation" && activeType === "chat" && activePresetId === act.id) ||
                              (act.type === "exploration" && activeType === "exploration" && activeExplorationId === act.id) ||
                              (act.type === "project" && activeType === "project" && activeProjectId === act.id) ||
                              (act.type === "quiz" && activeType === "quiz" && activeQuizId === act.id);
                            const title = act.type === "conversation" ? act.pc.title : act.type === "exploration" ? act.exp.title : act.type === "project" ? act.ps.title : act.quiz.title;
                            return (
                              <div
                                key={`${act.type}-${act.id}`}
                                className={`px-3 py-2 pl-8 cursor-pointer hover:bg-gray-100 border-b border-gray-50 ${isActive ? "bg-white border-l-2" : ""}`}
                                style={isActive ? { borderLeftColor: color } : undefined}
                                onClick={() => {
                                  if (act.type === "conversation") {
                                    const convs = findConversations(act.pc.id);
                                    // 取该预设下最新的一个对话加载到聊天区
                                    const latestConv = convs.length > 0 ? convs[0] : undefined;
                                    switchToChat(act.pc.id, latestConv?.id);
                                  } else if (act.type === "exploration") {
                                    switchToExploration(act.exp.id);
                                  } else if (act.type === "project") {
                                    switchToProject(act.ps.id);
                                  } else {
                                    switchToQuiz(act.quiz.id);
                                  }
                                }}
                              >
                                <div className="flex items-center gap-2">
                                  {/* 类型图标分派 + 类型色 10% 底座（2026-10-13 美化）：4 类活动不再共用 ChatIcon，
                                      对话/探究/项目/作业一眼可辨；底色 = colorMap 色 + 1A（hex 透明度 10%） */}
                                  <span
                                    className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                                    style={{ background: `${color}1A` }}
                                  >
                                    {act.type === "conversation" ? (
                                      <ChatIcon size="14px" style={{ color }} />
                                    ) : act.type === "exploration" ? (
                                      <BrowseIcon size="14px" style={{ color }} />
                                    ) : act.type === "project" ? (
                                      <AssignmentIcon size="14px" style={{ color }} />
                                    ) : (
                                      <EditIcon size="14px" style={{ color }} />
                                    )}
                                  </span>
                                  {/* 2026-10-15：活动名称 hover 显示类型名 0.5s 后自动消失（ActivityNameTip 自实现，
                                      见常量区组件定义；不用 TDesign Tooltip——其 duration 仅首次挂载生效） */}
                                  <ActivityNameTip label={ACTIVITY_TYPE_LABEL[act.type]} active={isActive} color={color}>
                                    {title}
                                  </ActivityNameTip>
                                  {act.type === "conversation" && findConversations(act.pc.id).length > 0 && (
                                    <Tag theme="success" variant="light" size="small">
                                      已学
                                    </Tag>
                                  )}
                                  {act.type === "exploration" && act.exp.enableSubmission && (
                                    <Tag theme="success" variant="light" size="small">
                                      可答题
                                    </Tag>
                                  )}
                                  {act.type === "project" && (
                                    <Tag theme="warning" variant="light" size="small">
                                      {act.ps.category === "TEXT" ? "文本" : act.ps.category === "IMAGE" ? "图片" : "视频"}
                                    </Tag>
                                  )}
                                  {/* 2026-10-13 需求：作业名片不显示题目数量（原 {act.quiz._count.questions}题 Tag 已移除） */}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
          )}
        </div>

        {/* 右侧区域 */}
        <div className="flex-1 flex flex-col">
        {(() => {
          const currentQuiz = tasks
            .flatMap(t => t.subProjects.flatMap(sp => sp.quizActivities || []))
            .find(q => q.id === activeQuizId);
          return activeType === "quiz" && activeQuizId && currentQuiz ? (
            <QuizPanel
              key={activeQuizId + "-" + quizSubmitted}
              quizId={activeQuizId}
              initialQuizData={{ id: currentQuiz.id, title: currentQuiz.title, description: currentQuiz.description, status: currentQuiz.status || "INACTIVE" }}
              initialQuestions={currentQuiz.questions || []}
              onSubmit={() => {
                setQuizSubmitted(true);
              }}
              locked={quizSubmitted}
            />
          ) : null;
        })()}

        {activeType === "exploration" && activeExplorationId ? (
          <ExplorationPanelRender
            explorationId={activeExplorationId}
            tasks={tasks}
            onBack={() => setActiveType(null)}
          />
        ) : null}

        {activeType === "project" && activeProjectId ? (
          <ProjectSubmitPanel
            projectId={activeProjectId}
            tasks={tasks}
            onBack={() => setActiveType(null)}
            onChanged={() => fetchData()}
          />
        ) : null}

        {activeType !== "quiz" && activeType !== "exploration" && activePresetId && currentInfo && (
          <>
            <div className="px-4 py-3 border-b border-gray-200 bg-[#FAFBFC]">
              <div className="flex items-center gap-2">
                <ChatIcon className="text-[#0052D9]" size="18px" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-[#1A1A1A]">
                    {currentInfo.preset.title}
                  </h3>
                  <p className="text-xs text-[#63666F]">
                    {currentInfo.task.title} / {currentInfo.subProject.title === "默认活动" ? "对话思考" : currentInfo.subProject.title}
                  </p>
                </div>
                <SpeechControls />
              </div>

            </div>

            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
              <div ref={messagesInnerRef} className="space-y-4">
              {messages.length === 0 && currentInfo && (
                <div className="text-center text-gray-400 mt-10">
                  <p className="text-lg mb-2">{currentInfo.preset.title}</p>
                  {/* 教师开场白（2026-10-13）：仅本地展示，不入库；学生首条发言后
                      /api/chat 新会话分支会把它落库为 assistant 首条消息，出现在真实消息流中 */}
                  {currentInfo.preset.openingMessage ? (
                    <div className="flex justify-start mt-6 text-left">
                      <div className="max-w-[70%] rounded-2xl px-4 py-3 bg-gray-100 text-gray-800">
                        <div className="prose prose-sm prose-gray max-w-none overflow-hidden break-words [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5">
                          <Markdown>{currentInfo.preset.openingMessage}</Markdown>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm mt-4">开始吧！</p>
                  )}
                </div>
              )}
              {messages.map((msg, index) => (
                <div
                  key={msg.id || index}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-[#0052D9] text-white"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.images.map((img, imgIdx) => (
                          <img
                            key={imgIdx}
                            src={img.url}
                            alt="上传的图片"
                            className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                          />
                        ))}
                      </div>
                    )}
                    {msg.role === "assistant" ? (
                      <div className="relative">
                        {/* 点 + 喇叭绝对定位浮在正文左上角；正文首行 text-indent 缩进 38px 避开图标（点 8 + gap 6 + 喇叭 24），
                            第二行起回到行首顶到头，无缩进（2026-10-15 三版迭代后定稿） */}
                        {(msg.modelRoute || msg.content.trim()) && (
                          <div className="absolute left-0 top-0 flex h-[22px] items-center gap-1.5">
                            {msg.modelRoute && (
                              <span
                                title={msg.modelRoute === "omni" ? "全媒体模型" : "图文模型"}
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  msg.modelRoute === "omni" ? "bg-black" : "bg-green-500"
                                }`}
                              />
                            )}
                            {msg.content.trim() && (
                              <SpeakButton
                                owner={`msg-${index}`}
                                text={msg.content}
                                className="shrink-0"
                              />
                            )}
                          </div>
                        )}
                        <div
                          className={`prose prose-sm prose-gray max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:bg-gray-800 [&_pre]:text-gray-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs [&_pre_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-gray-400 [&_blockquote]:pl-3 [&_blockquote]:italic [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1] ${
                            msg.modelRoute || msg.content.trim()
                              ? "[&>*:first-child]:indent-[38px]"
                              : ""
                          }`}
                        >
                          <Markdown>{msg.content}</Markdown>
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                    {msg.audioUrl && (
                      <div className="mt-2">
                        <audio src={msg.audioUrl} controls className="max-w-full" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (messages.length === 0 || messages[messages.length - 1]?.role !== "assistant" || !messages[messages.length - 1]?.content) && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-3 text-gray-500">
                    {switchNotice ? "正在切换模型，请稍候..." : "AI 正在思考中..."}
                  </div>
                </div>
              )}
              </div>
            </div>

            {(pendingImages.length > 0 || pendingAudio) && (
              <div className="border-t border-gray-100 px-4 pt-3 pb-1">
                <div className="flex gap-2 flex-wrap items-center">
                  {pendingImages.map((img, idx) => (
                    <div key={idx} className="relative group">
                      <img src={img.url} alt="待发送" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                      <button
                        onClick={() => removePendingImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {pendingAudio && (
                    <div className="relative group flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white">
                      <audio src={pendingAudio} controls className="h-8 w-40" />
                      <button
                        onClick={removePendingAudio}
                        className="w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="border-t border-gray-200 p-4">
              <div className="flex gap-2 items-center">
                {/* 1 话筒：点击直接调用麦克风开始录音，再点停止，录完作为语音附件 */}
                <Button
                  theme={isRecording ? "danger" : "default"}
                  variant={isRecording ? "base" : "outline"}
                  size="large"
                  icon={<MicrophoneIcon />}
                  onClick={toggleRecording}
                  title={isRecording ? "停止录音" : "语音输入（点击开始录音）"}
                  disabled={!activePresetId}
                />
                {isRecording && (
                  <span
                    className="text-red-500 text-sm font-medium whitespace-nowrap"
                    title={`最长录音 ${MAX_RECORD_SEC} 秒`}
                  >
                    ● {formatRecordSec(recordingSec)}
                  </span>
                )}
                {/* 2 图片：直接调用相机拍照 */}
                <Button
                  theme="default"
                  variant="outline"
                  size="large"
                  icon={<ImageIcon />}
                  onClick={() => cameraInputRef.current?.click()}
                  title="拍照"
                  disabled={!activePresetId}
                />
                {/* 3 添加文件：图片 jpg/png/jpeg、音频 m4a/mp3/wav 等 */}
                <Button
                  theme="default"
                  variant="outline"
                  size="large"
                  icon={<AddIcon />}
                  onClick={() => fileInputRef.current?.click()}
                  title="添加文件"
                  disabled={!activePresetId}
                />
                <Input
                  value={input}
                  onChange={(v) => setInput(v)}
                  onKeydown={handleKeyDown}
                  placeholder="输入问题，按 Enter 发送..."
                  className="flex-1"
                  size="large"
                />
                <Button
                  theme="primary"
                  size="large"
                  icon={<SendIcon />}
                  onClick={handleSend}
                  loading={loading}
                  disabled={!input.trim() && pendingImages.length === 0 && !pendingAudio}
                >
                  发送
                </Button>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { handleImageSelect(e.target.files); e.target.value = ""; }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,audio/*"
                multiple
                className="hidden"
                onChange={(e) => { handleAttachmentSelect(e.target.files); e.target.value = ""; }}
              />
            </div>
          </>
        )}

        {activeType !== "quiz" && activeType !== "exploration" && activeType !== "project" && !activePresetId && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <p className="text-lg mb-2">👋 你好！</p>
              <p>请从左侧选择一个对话活动开始</p>
              <p className="text-sm mt-2">支持拍照或上传图片提问</p>
            </div>
          </div>
        )}
      </div>
    </div>
    </StudentLayout>
  );
}
