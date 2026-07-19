"use client";

import { useState, useRef, useEffect } from "react";
import { Button, Input, MessagePlugin, Tag } from "tdesign-react";
import {
  SendIcon,
  ImageIcon,
  AddIcon,
  FolderIcon,
  ChatIcon,
} from "tdesign-icons-react";
import Markdown from "@/components/Markdown";
import StudentLayout from "@/components/layout/StudentLayout";
import QuizPanel from "./QuizPanel";
import ExplorationPanel from "./ExplorationPanel";

interface MessageImage {
  url: string;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  images?: MessageImage[];
  createdAt?: string;
}

interface PresetConversation {
  id: string;
  title: string;
  description?: string;
  systemPrompt?: string;
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
}

interface ExplorationInfo {
  id: string;
  title: string;
  description?: string;
  htmlContent?: string;
  enableSubmission?: boolean;
  enableAiCompanion?: boolean;
  questionsJson?: string;
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
  const [activeType, setActiveType] = useState<"chat" | "quiz" | "exploration" | null>(null);
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [activeExplorationId, setActiveExplorationId] = useState<string | null>(null);

  // 侧边栏折叠状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 图片
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activePresetRef = useRef<string | null>(null);
  const isSwitchingRef = useRef(false); // 防止 switch 函数重入

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 当 activePresetId 变化时，清除重入锁（让后续点击可进入 switchToChat）
  useEffect(() => {
    isSwitchingRef.current = false;
  }, [activePresetId, activeType]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem("token");
      const [tasksRes, convsRes] = await Promise.all([
        fetch("/api/student/tasks", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/conversations", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (tasksRes.ok) setTasks(await tasksRes.json());
      if (convsRes.ok) setConversations(await convsRes.json());
    } catch {
      console.error("加载数据失败");
    } finally {
      setLoadingData(false);
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
    const loadConv = (id?: string) => {
      const convs = findConversations(presetId);
      if (convs.length === 0) {
        setActiveConvId(null);
        setMessages([]);
        return;
      }
      const targetConv = id ? convs.find((c) => c.id === id) : convs[0];
      if (targetConv && targetConv.messages && targetConv.messages.length > 0) {
        setActiveConvId(targetConv.id);
        setMessages(targetConv.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
        })));
      } else if (targetConv) {
        // messages 为空时从服务端刷新
        setActiveConvId(targetConv.id);
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

  // 从服务端加载单个对话详情
  const fetchConversationDetail = async (convId: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const conv = await res.json();
        setMessages(conv.messages.map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
        })));
        // 更新 conversations 列表中的消息
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, messages: conv.messages } : c
        ));
      }
    } catch { /* ignore */ }
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
  };

  // 渲染探索面板（避免在 JSX 中直接用 IIFE）
  function ExplorationPanelRender({ explorationId, tasks, onBack }: { explorationId: string; tasks: LearningTask[]; onBack: () => void }) {
    const exp = tasks
      .flatMap(t => t.subProjects.flatMap(sp => sp.explorations || []))
      .find(e => e.id === explorationId);
    if (!exp) return null;
    return (
      <ExplorationPanel
        explorationId={exp.id}
        htmlContent={exp.htmlContent || ""}
        enableSubmissionEnabled={exp.enableSubmission}
        enableAiCompanion={exp.enableAiCompanion}
        onBack={onBack}
      />
    );
  }

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

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  // 发送消息（供自动发送和手动发送共用）
  const sendMessage = async (text: string, images?: MessageImage[]) => {
    if (!text.trim() || loading) return;
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
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    if (images) setPendingImages([]);
    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const apiMessages = newMessages.map((m) => {
        if (m.images && m.images.length > 0) {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              ...m.images.map((img) => ({
                type: "image_url",
                image_url: { url: img.url },
              })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      });

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
    if (!input.trim() && pendingImages.length === 0) return;
    const text = input || "(发送了图片)";
    const imgs = pendingImages.length > 0 ? [...pendingImages] : undefined;
    setInput("");
    setPendingImages([]);
    await sendMessage(text, imgs);
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
                    {/* 任务标题 */}
                    <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50">
                      <div className="flex items-center gap-2">
                        <FolderIcon className="text-[#0052D9]" size="16px" />
                        <span className="text-sm font-medium text-[#1A1A1A] truncate">
                          {task.title}
                        </span>
                      </div>
                    </div>

                    {/* 学习活动 + 对话活动 */}
                    {task.subProjects.map((sp) => (
                      <div key={sp.id}>
                        <div className="px-3 py-2 pl-8 border-b border-gray-50 bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <FolderIcon className="text-[#ED7B2F]" size="14px" />
                            <span className="text-sm text-[#333] truncate">{sp.title === "默认活动" ? "对话思考" : sp.title}</span>
                          </div>
                        </div>

                        {/* 对话活动 */}
                        {sp.presetConversations.map((pc) => {
                          const convs = findConversations(pc.id);
                          const isActive = activeType === "chat" && activePresetId === pc.id;
                          // 取该预设下最新的一个对话加载到聊天区
                          const latestConv = convs.length > 0 ? convs[0] : undefined;
                          return (
                            <div
                              key={pc.id}
                              className={`px-3 py-2 pl-14 cursor-pointer hover:bg-gray-100 border-b border-gray-50 ${
                                isActive ? "bg-white border-l-2 border-l-[#0052D9]" : ""
                              }`}
                              onClick={() => {
                                switchToChat(pc.id, latestConv?.id);
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <ChatIcon
                                  className={convs.length > 0 ? "text-[#00A870]" : "text-gray-400"}
                                  size="14px"
                                />
                                <span className={`text-sm truncate ${isActive ? "text-[#0052D9] font-medium" : "text-[#333]"}`}>
                                  {pc.title}
                                </span>
                                {convs.length > 0 && (
                                  <Tag theme="success" variant="light" size="small">
                                    已学
                                  </Tag>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}

                    {/* 互动探究入口 */}
                    {task.subProjects.flatMap(sp => sp.explorations || []).length > 0 && (
                      <div>
                        <div className="px-3 py-2 pl-8 border-b border-gray-50 bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <FolderIcon className="text-[#00A870]" size="14px" />
                            <span className="text-sm font-medium text-[#63666F]">互动探究</span>
                          </div>
                        </div>
                        {task.subProjects.flatMap(sp =>
                          (sp.explorations || []).map((exp: ExplorationInfo) => {
                            const isActive = activeType === "exploration" && activeExplorationId === exp.id;
                            return (
                              <div
                                key={exp.id}
                                className={`px-3 py-2 pl-14 cursor-pointer hover:bg-gray-100 border-b border-gray-50 ${
                                  isActive ? "bg-white border-l-2 border-l-[#00A870]" : ""
                                }`}
onClick={() => {
                                switchToExploration(exp.id);
                              }}
                              >
                                <div className="flex items-center gap-2">
                                  <ChatIcon
                                    className={isActive ? "text-[#00A870]" : "text-gray-400"}
                                    size="14px"
                                  />
                                  <span className={`text-sm truncate ${isActive ? "text-[#00A870] font-medium" : "text-[#333]"}`}>
                                    {exp.title}
                                  </span>
                                  {exp.enableSubmission && (
                                    <Tag theme="success" variant="light" size="small">
                                      可答题
                                    </Tag>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                    {/* 作业入口 */}
                    {allQuizzes.length > 0 && (
                      <div>
                        <div className="px-3 py-2 pl-8 border-b border-gray-50 bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <FolderIcon className="text-[#6366F1]" size="14px" />
                            <span className="text-sm font-medium text-[#63666F]">课堂作业</span>
                          </div>
                        </div>
                        {allQuizzes.map((quiz) => {
                          const isActive = activeType === "quiz" && activeQuizId === quiz.id;
                          return (
                            <div
                              key={quiz.id}
                              className={`px-3 py-2 pl-14 cursor-pointer hover:bg-gray-100 border-b border-gray-50 ${
                                isActive ? "bg-white border-l-2 border-l-[#6366F1]" : ""
                              }`}
                              onClick={() => {
                                switchToQuiz(quiz.id);
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <ChatIcon
                                  className={isActive ? "text-[#6366F1]" : "text-gray-400"}
                                  size="14px"
                                />
                                <span className={`text-sm truncate ${isActive ? "text-[#6366F1] font-medium" : "text-[#333]"}`}>
                                  {quiz.title}
                                </span>
                                {quiz._count?.questions ? (
                                  <Tag theme="primary" variant="light" size="small">
                                    {quiz._count.questions}题
                                  </Tag>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
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

        {activeType !== "quiz" && activeType !== "exploration" && activePresetId && currentInfo && (
          <>
            <div className="px-4 py-3 border-b border-gray-200 bg-[#FAFBFC]">
              <div className="flex items-center gap-2">
                <ChatIcon className="text-[#0052D9]" size="18px" />
                <div>
                  <h3 className="text-sm font-medium text-[#1A1A1A]">
                    {currentInfo.preset.title}
                  </h3>
                  <p className="text-xs text-[#63666F]">
                    {currentInfo.task.title} / {currentInfo.subProject.title === "默认活动" ? "对话思考" : currentInfo.subProject.title}
                  </p>
                </div>
              </div>
              {currentInfo.preset.description && (
                <p className="text-xs text-[#63666F] mt-1 ml-7">
                  {currentInfo.preset.description}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && currentInfo && (
                <div className="text-center text-gray-400 mt-10">
                  <p className="text-lg mb-2">{currentInfo.preset.title}</p>
                  {currentInfo.preset.description && (
                    <p className="text-sm">{currentInfo.preset.description}</p>
                  )}
                  <p className="text-sm mt-4">开始提问吧！</p>
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
                      <div className="prose prose-sm prose-gray max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:bg-gray-800 [&_pre]:text-gray-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs [&_pre_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-gray-400 [&_blockquote]:pl-3 [&_blockquote]:italic [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
                        <Markdown>{msg.content}</Markdown>
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
              <div ref={messagesEndRef} />
            </div>

            {pendingImages.length > 0 && (
              <div className="border-t border-gray-100 px-4 pt-3 pb-1">
                <div className="flex gap-2 flex-wrap">
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
                  disabled={!input.trim() && pendingImages.length === 0}
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
            </div>
          </>
        )}

        {activeType !== "quiz" && activeType !== "exploration" && !activePresetId && (
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
