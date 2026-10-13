"use client";

import { useState, useRef, useEffect } from "react";
import { Button, Input, MessagePlugin, Tag } from "tdesign-react";
import {
  SendIcon,
  ImageIcon,
  AddIcon,
  FolderIcon,
  ChatIcon,
  MicrophoneIcon,
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
}

interface PresetConversation {
  id: string;
  title: string;
  description?: string;
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
  const audioInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
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
  const handleImageSelect = (files: FileList | null) => {
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

  // 音频附件处理：调用系统录音机，录完后以 base64 data URL 形式暂存
  const handleAudioSelect = (files: FileList | null) => {
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

    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setPendingAudio(url);
    };
    reader.readAsDataURL(file);
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
    const newMessages = [...messages, userMessage];
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

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // 流式读取过程中检查是否被切换
          if (activePresetRef.current !== currentPresetId) return;
          const chunk = decoder.decode(value, { stream: true });
          assistantContent += chunk;
          if (!assistantAdded) {
            // 收到第一个 chunk 时才添加 assistant 气泡（带初始内容）
            assistantAdded = true;
            setMessages((prev) => [...prev, { role: "assistant", content: assistantContent }]);
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", content: assistantContent };
              return updated;
            });
          }
        }
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
            {!sidebarCollapsed && <h3 className="text-sm font-medium text-[#1A1A1A]">课堂</h3>}
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
                        <span className="text-xs text-gray-400 w-4 text-center">
                          {expandedTaskIds.has(task.id) ? "▼" : "▶"}
                        </span>
                        <FolderIcon className="text-[#0052D9]" size="16px" />
                        <span className="text-sm font-medium text-[#1A1A1A] truncate">
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
                                  <ChatIcon
                                    className={isActive ? "" : "text-gray-400"}
                                    size="14px"
                                    style={{ color }}
                                  />
                                  <span className={`text-sm truncate ${isActive ? "font-medium" : "text-[#333]"}`} style={isActive ? { color } : undefined}>
                                    {title}
                                  </span>
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

                  <p className="text-sm mt-4">开始吧！</p>
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
                    {msg.audioUrl && (
                      <div className="mb-2">
                        <audio src={msg.audioUrl} controls className="max-w-full" />
                      </div>
                    )}
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm prose-gray max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:bg-gray-800 [&_pre]:text-gray-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs [&_pre_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-gray-400 [&_blockquote]:pl-3 [&_blockquote]:italic [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
                        <Markdown>{msg.content}</Markdown>
                        {msg.content.trim() && (
                          <div className="mt-2 flex items-center justify-end">
                            <SpeakButton owner={`msg-${index}`} text={msg.content} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (messages.length === 0 || messages[messages.length - 1]?.role !== "assistant" || !messages[messages.length - 1]?.content) && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-3 text-gray-500">
                    AI 正在思考中...
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
              <div className="flex gap-2 items-end">
                <Button
                  theme="default"
                  variant="outline"
                  size="large"
                  icon={<ImageIcon />}
                  onClick={() => cameraInputRef.current?.click()}
                  title="拍照"
                  disabled={!activePresetId}
                />
                <Button
                  theme="default"
                  variant="outline"
                  size="large"
                  icon={<AddIcon />}
                  onClick={() => fileInputRef.current?.click()}
                  title="选择图片"
                  disabled={!activePresetId}
                />
                <Button
                  theme="default"
                  variant="outline"
                  size="large"
                  icon={<MicrophoneIcon />}
                  onClick={() => audioInputRef.current?.click()}
                  title="语音输入"
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
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { handleImageSelect(e.target.files); e.target.value = ""; }}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                capture
                className="hidden"
                onChange={(e) => { handleAudioSelect(e.target.files); e.target.value = ""; }}
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
