"use client";

import { useEffect, useState, useCallback } from "react";
import { Input, Card, MessagePlugin, Dialog } from "tdesign-react";
import { SearchIcon, DeleteIcon, CheckCircleIcon } from "tdesign-icons-react";
import Markdown from "@/components/Markdown";
import TeacherLayout from "@/components/layout/TeacherLayout";

interface UserInfo {
  id: string;
  name: string;
}

interface ClassInfo {
  id: string;
  name: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface PresetConversationInfo {
  id: string;
  title: string;
  subProject: {
    id: string;
    title: string;
    task: {
      id: string;
      title: string;
    };
  };
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  user: UserInfo;
  class: ClassInfo;
  presetConversation: PresetConversationInfo | null;
  messages: Message[];
}

interface ClassOption {
  id: string;
  name: string;
  conversationCount?: number;
}

interface PresetConversationOption {
  id: string;
  title: string;
  taskTitle: string;
  subProjectTitle: string;
  conversationCount?: number;
}

interface TaskOption {
  id: string;
  title: string;
  conversationCount?: number;
}

export default function TeacherConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [firstLoaded, setFirstLoaded] = useState(false);
  
  // 选择相关状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
// 班级列表
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("all");

  // 课堂(任务)列表
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("all");

  // 对话活动列表
  const [presetConversations, setPresetConversations] = useState<PresetConversationOption[]>([]);
  const [selectedPresetConversationId, setSelectedPresetConversationId] = useState<string>("all");
  
  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 5;
  
  // 删除确认弹窗
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [clearClassDialogVisible, setClearClassDialogVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "single" | "batch"; ids: string[] } | null>(null);
  const [clearClassTarget, setClearClassTarget] = useState<ClassOption | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 获取班级列表
  const fetchClasses = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // 获取该教师所有对话来统计各班级的对话数量
        const allRes = await fetch("/api/conversations/teacher?pageSize=1000", {
          headers: { Authorization: `Bearer ${token}` },
        });
        let allTotal = 0;
        let classCounts: Record<string, number> = {};
        if (allRes.ok) {
          const allData = await allRes.json();
          allTotal = allData.total || 0;
          const allConvs = allData.conversations || [];
          classCounts = allConvs.reduce((acc: Record<string, number>, conv: Conversation) => {
            acc[conv.class.id] = (acc[conv.class.id] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
        }
        setClasses([
          { id: "all", name: "全部班级", conversationCount: allTotal },
          ...data.map((c: { id: string; name: string }) => ({
            ...c,
            conversationCount: classCounts[c.id] || 0,
          })),
        ]);
      }
    } catch {
      // ignore
    }
  }, []);

  // 获取课堂(任务)列表
  const fetchTasks = useCallback(async () => {
    if (selectedClassId === "all") {
      setTasks([]);
      return;
    }
    try {
      const token = localStorage.getItem("token");
      // 获取教师所有任务，过滤出分配到该班级的任务
      const tasksRes = await fetch("/api/tasks", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!tasksRes.ok) return;
      const allTasks = await tasksRes.json();
      // 过滤：任务分配中包含该班级
      const classTasks = allTasks.filter((t: { assignments: { classId: string }[] }) =>
        t.assignments.some((a: { classId: string }) => a.classId === selectedClassId)
      );
      // 获取该班级的所有对话来统计各任务的对话数
      const countRes = await fetch(`/api/conversations/teacher?classId=${selectedClassId}&pageSize=1000`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let taskCounts: Record<string, number> = {};
      let totalCount = 0;
      if (countRes.ok) {
        const countData = await countRes.json();
        const allConvs = countData.conversations || [];
        totalCount = countData.total || 0;
        for (const conv of allConvs) {
          const taskId = conv.presetConversation?.subProject?.task?.id;
          if (taskId) taskCounts[taskId] = (taskCounts[taskId] || 0) + 1;
        }
      }
      setTasks([
        { id: "all", title: "全部课堂", conversationCount: totalCount },
        ...classTasks.map((t: { id: string; title: string }) => ({
          id: t.id,
          title: t.title,
          conversationCount: taskCounts[t.id] || 0,
        })),
      ]);
    } catch {
      // ignore
    }
  }, [selectedClassId]);

  // 获取对话活动列表（按课堂/对话活动两级结构）
  const fetchPresetConversations = useCallback(async () => {
    if (selectedClassId === "all") {
      setPresetConversations([]);
      return;
    }
    try {
      const token = localStorage.getItem("token");
      // 获取该班级的所有对话，不限页码
      const params = new URLSearchParams({ classId: selectedClassId, pageSize: "1000" });
      if (selectedTaskId !== "all") params.set("taskId", selectedTaskId);
      const res = await fetch(`/api/conversations/teacher?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const conversations = data.conversations || [];
        // 按对话活动统计
        const pcCounts: Record<string, { id: string; title: string; taskTitle: string; subProjectTitle: string; conversationCount: number }> = {};
        let totalInClass = 0;
        for (const conv of conversations) {
          totalInClass++;
          if (conv.presetConversation) {
            const pc = conv.presetConversation;
            if (!pcCounts[pc.id]) {
              pcCounts[pc.id] = {
                id: pc.id,
                title: pc.title,
                taskTitle: pc.subProject?.task?.title || "",
                subProjectTitle: pc.subProject?.title || "",
                conversationCount: 0,
              };
            }
            pcCounts[pc.id].conversationCount++;
          }
        }
        setPresetConversations([
          { id: "all", title: "全部题目", taskTitle: "", subProjectTitle: "", conversationCount: totalInClass },
          ...Object.values(pcCounts).map(p => ({
            id: p.id,
            title: p.title,
            taskTitle: p.taskTitle,
            subProjectTitle: p.subProjectTitle,
            conversationCount: p.conversationCount,
          })),
        ]);
      }
    } catch {
      // ignore
    }
  }, [selectedClassId, selectedTaskId]);

  const fetchConversations = useCallback(async (studentName?: string, page?: number, pcId?: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const pageNum = page ?? currentPage;
      // 优先使用显式传入的值，否则使用状态值
      const activePcId = pcId ?? selectedPresetConversationId;
      const params = new URLSearchParams();
      if (studentName) params.set("studentName", studentName);
      if (selectedClassId !== "all") params.set("classId", selectedClassId);
      if (selectedTaskId !== "all") params.set("taskId", selectedTaskId);
      if (activePcId !== "all") params.set("presetConversationId", activePcId);
      params.set("page", String(pageNum));
      params.set("pageSize", String(PAGE_SIZE));

      const res = await fetch(`/api/conversations/teacher?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
        setTotalCount(data.total || 0);
      } else {
        MessagePlugin.error("获取对话记录失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
      setFirstLoaded(true);
    }
  }, [selectedClassId, selectedTaskId]);

  useEffect(() => {
    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 切换班级时重置页码、课堂和对话活动选择
    setCurrentPage(1);
    setSelectedTaskId("all");
    setSelectedPresetConversationId("all");
    fetchTasks();
    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  useEffect(() => {
    // 切换课堂时重置页码和对话活动选择
    setCurrentPage(1);
    setSelectedPresetConversationId("all");
    fetchPresetConversations();
    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);

  useEffect(() => {
    fetchConversations(undefined, currentPage, selectedPresetConversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresetConversationId, currentPage]);

  const handleSearch = () => {
    setCurrentPage(1);
    const keyword = searchInput.trim();
    setSearchKeyword(keyword);
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    fetchConversations(keyword || undefined, 1, selectedPresetConversationId);
  };

  const handleKeyDown = (value: string, context: { e: React.KeyboardEvent }) => {
    if (context.e.key === "Enter") {
      context.e.preventDefault();
      handleSearch();
    }
  };

  const handleClearSearch = () => {
    setCurrentPage(1);
    setSearchInput("");
    setSearchKeyword("");
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    fetchConversations(undefined, 1, selectedPresetConversationId);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // 选择/取消选择
  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedIds.size === conversations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(conversations.map((c) => c.id)));
    }
  };

  // 进入选择模式
  const enterSelectionMode = () => {
    setIsSelectionMode(true);
    setSelectedIds(new Set());
  };

  // 退出选择模式
  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  // 删除单个对话
  const handleDeleteSingle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget({ type: "single", ids: [id] });
    setDeleteDialogVisible(true);
  };

  // 批量删除
  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    setDeleteTarget({ type: "batch", ids: Array.from(selectedIds) });
    setDeleteDialogVisible(true);
  };

  // 确认删除
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem("token");
      let res;
      
      if (deleteTarget.type === "single") {
        res = await fetch(`/api/conversations/${deleteTarget.ids[0]}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        res = await fetch("/api/conversations/teacher", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ conversationIds: deleteTarget.ids }),
        });
      }

      if (res.ok) {
        MessagePlugin.success(`成功删除 ${deleteTarget.ids.length} 个对话`);
        setDeleteDialogVisible(false);
        setDeleteTarget(null);
        exitSelectionMode();
        fetchConversations(undefined, currentPage);
        fetchClasses();
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

  // 清空班级对话
  const handleClearClass = (cls: ClassOption, e: React.MouseEvent) => {
    e.stopPropagation();
    setClearClassTarget(cls);
    setClearClassDialogVisible(true);
  };

  // 确认清空班级
  const confirmClearClass = async () => {
    if (!clearClassTarget) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/conversations/teacher/class/${clearClassTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        MessagePlugin.success(`成功清空 ${clearClassTarget.name}，删除 ${data.deletedCount} 个对话`);
        setClearClassDialogVisible(false);
        setClearClassTarget(null);
        fetchConversations(undefined, currentPage);
        fetchClasses();
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "清空失败");
      }
    } catch {
      MessagePlugin.error("清空失败");
    } finally {
      setDeleting(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  // 按学生分组统计
  const studentStats: Record<string, { count: number; msgCount: number }> = {};
  for (const conv of conversations) {
    const name = conv.user.name;
    if (!studentStats[name]) studentStats[name] = { count: 0, msgCount: 0 };
    studentStats[name].count++;
    studentStats[name].msgCount += conv.messages.length;
  }

  return (
    <TeacherLayout>
      <div className="max-w-5xl space-y-6 pb-8">
        {/* 页面标题 */}
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">对话记录</h1>
          <p className="text-[#63666F] mt-1">查看学生与 AI 的对话记录，了解学习情况</p>
        </div>

        {/* 操作栏 */}
        <Card>
          <div className="flex items-center gap-3 flex-wrap">
            {/* 班级筛选 */}
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9] focus:border-transparent"
            >
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} {cls.conversationCount !== undefined ? `(${cls.conversationCount})` : ""}
                </option>
              ))}
            </select>

            {/* 课堂筛选 */}
            {tasks.length > 0 && (
              <select
                value={selectedTaskId}
                onChange={(e) => {
                  setSelectedTaskId(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9] focus:border-transparent"
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} {t.conversationCount !== undefined ? `(${t.conversationCount})` : ""}
                  </option>
                ))}
              </select>
            )}

            {/* 课堂题目筛选 */}
            {presetConversations.length > 0 && (
              <select
                value={selectedPresetConversationId}
                onChange={(e) => {
                  setSelectedPresetConversationId(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9] focus:border-transparent"
              >
                {presetConversations.map((pc) => (
                  <option key={pc.id} value={pc.id}>
                    {pc.title} {pc.conversationCount !== undefined ? `(${pc.conversationCount})` : ""}
                  </option>
                ))}
              </select>
            )}

            {/* 搜索框 */}
            <div className="flex-1 min-w-[200px]">
              <Input
                value={searchInput}
                onChange={(val) => setSearchInput(val)}
                onKeydown={handleKeyDown}
                placeholder="输入学生姓名搜索..."
                suffixIcon={
                  <div className="flex items-center gap-1">
                    {searchKeyword && (
                      <button
                        onClick={handleClearSearch}
                        className="text-gray-400 hover:text-gray-600 text-sm px-1"
                      >
                        清除
                      </button>
                    )}
                    <button
                      onClick={handleSearch}
                      className="text-[#0052D9] hover:text-[#003DA6] px-1"
                    >
                      <SearchIcon />
                    </button>
                  </div>
                }
                size="medium"
              />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2">
              {isSelectionMode ? (
                <>
                  <button
                    onClick={toggleSelectAll}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1"
                  >
                    <CheckCircleIcon />
                    {selectedIds.size === conversations.length ? "取消全选" : "全选"}
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    disabled={selectedIds.size === 0}
                    className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 ${
                      selectedIds.size > 0
                        ? "bg-red-500 text-white hover:bg-red-600"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    <DeleteIcon />
                    删除 ({selectedIds.size})
                  </button>
                  <button
                    onClick={exitSelectionMode}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={enterSelectionMode}
                    disabled={conversations.length === 0}
                    className={`px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1 ${
                      conversations.length === 0 ? "text-gray-400 cursor-not-allowed" : ""
                    }`}
                  >
                    <CheckCircleIcon />
                    选择删除
                  </button>
                  {selectedClassId !== "all" && (
                    <button
                      onClick={(e) => {
                        const cls = classes.find((c) => c.id === selectedClassId);
                        if (cls) handleClearClass(cls, e);
                      }}
                      disabled={(classes.find((c) => c.id === selectedClassId)?.conversationCount || 0) === 0}
                      className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 ${
                        (classes.find((c) => c.id === selectedClassId)?.conversationCount || 0) > 0
                          ? "bg-orange-500 text-white hover:bg-orange-600"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed"
                      }`}
                    >
                      <DeleteIcon />
                      清空 {classes.find((c) => c.id === selectedClassId)?.name || ""}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {searchKeyword && (
            <div className="mt-2 text-sm text-[#63666F]">
              搜索 &quot;{searchKeyword}&quot; 的结果：共 {totalCount} 个对话
            </div>
          )}
        </Card>

        {/* 对话列表 */}
        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : !firstLoaded ? null : conversations.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="text-lg mb-2">📋</p>
            <p>{searchKeyword ? "未找到匹配的对话记录" : "暂无对话记录"}</p>
            {!searchKeyword && (
              <p className="text-sm mt-2">学生开始与 AI 对话后，记录将在此显示</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map((conv) => {
              const isExpanded = expandedId === conv.id;
              const msgCount = conv.messages.length;
              const isSelected = selectedIds.has(conv.id);

              return (
                <Card
                  key={conv.id}
                  className={`transition-all ${
                    isSelected ? "ring-2 ring-red-400 ring-opacity-50 bg-red-50" : ""
                  } ${isExpanded && !isSelectionMode ? "ring-2 ring-[#0052D9] ring-opacity-30" : "hover:shadow-md"}`}
                >
                  {/* 对话头部 */}
                  <div className="flex items-center gap-3">
                    {/* 选择框 */}
                    {isSelectionMode && (
                      <div
                        onClick={(e) => toggleSelect(conv.id, e)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-red-500 border-red-500"
                            : "border-gray-300 hover:border-red-400"
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    )}

                    {/* 内容区域 */}
                    <div
                      className={`flex-1 cursor-pointer ${!isSelectionMode ? "" : ""}`}
                      onClick={() => {
                        if (isSelectionMode) {
                          toggleSelect(conv.id, new MouseEvent("click") as unknown as React.MouseEvent);
                        } else {
                          toggleExpand(conv.id);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#0052D9] bg-opacity-10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[#0052D9] text-xs font-medium">
                              {conv.user.name.charAt(0)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-[#1A1A1A]">{conv.user.name}</span>
                              <span className="text-xs text-[#63666F] bg-[#EDF1F7] px-1.5 py-0.5 rounded">
                                {conv.class.name}
                              </span>
                              {conv.presetConversation && (
                                <span className="text-xs text-[#0052D9] bg-[#E8F0FE] px-1.5 py-0.5 rounded truncate max-w-[200px]" title={`${conv.presetConversation.subProject.task.title} / ${conv.presetConversation.subProject.title} / ${conv.presetConversation.title}`}>
                                  {conv.presetConversation.subProject.task.title} / {conv.presetConversation.subProject.title} / {conv.presetConversation.title}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-[#63666F]">{conv.title}</span>
                              <span className="text-xs text-gray-400">{formatTime(conv.updatedAt)}</span>
                              <span className="text-xs text-gray-400">{msgCount} 条消息</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* 删除按钮 */}
                          <button
                            onClick={(e) => handleDeleteSingle(conv.id, e)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="删除此对话"
                          >
                            <DeleteIcon />
                          </button>
                          {/* 展开箭头 */}
                          {!isSelectionMode && (
                            <div className="text-gray-400">
                              <svg
                                className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>


                    </div>
                  </div>

                  {/* 展开时显示完整对话 */}
                  {isExpanded && !isSelectionMode && (
                    <div className="mt-4 pt-4 border-t border-gray-100 pl-12 space-y-3 max-h-[250px] overflow-y-auto overflow-x-hidden w-full min-w-0">
                      {conv.messages.length === 0 ? (
                        <p className="text-sm text-gray-400">暂无消息</p>
                      ) : (
                        conv.messages.map((msg) => (
                          <div key={msg.id} className="flex gap-2 w-full min-w-0">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs bg-[#0052D9] text-white">
                              {msg.role === "user" ? "生" : "AI"}
                            </div>
                            <div className="flex-1 min-w-0 w-full" style={{ maxWidth: 'calc(100% - 2rem)' }}>
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-medium text-[#1A1A1A]">
                                  {msg.role === "user" ? conv.user.name : "AI 助手"}
                                </span>
                                <span className="text-xs text-gray-400">{formatTime(msg.createdAt)}</span>
                              </div>
                              <div className="text-sm text-[#333] break-words bg-[#F7F8FA] rounded-lg p-3 overflow-hidden w-full">
                                {msg.role === "assistant" ? (
                                  <div className="!max-w-full prose prose-sm prose-gray [&_*]:break-words [&_*]:!max-w-full [&_*]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:!max-w-full [&_code]:break-all [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:bg-gray-800 [&_pre]:text-gray-100 [&_pre]:rounded-lg [&_pre]:!overflow-x-auto [&_pre]:p-3 [&_pre_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-gray-400 [&_blockquote]:pl-3 [&_blockquote]:italic [&_table]:text-xs [&_table]:table-auto [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
                                    <Markdown>{msg.content}</Markdown>
                                  </div>
                                ) : (
                                  <div className="whitespace-pre-wrap break-all w-full">{msg.content}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* 分页 */}
        {!loading && totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="text-sm text-gray-500">
              第 {currentPage} / {Math.ceil(totalCount / PAGE_SIZE)} 页
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(Math.ceil(totalCount / PAGE_SIZE), p + 1))}
              disabled={currentPage >= Math.ceil(totalCount / PAGE_SIZE)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        )}

        {/* 统计信息 */}
        {!loading && totalCount > 0 && !searchKeyword && (
          <div className="grid grid-cols-3 gap-4 mt-4">
            <Card className="text-center py-3">
              <div className="text-xl font-bold text-[#0052D9]">{Object.keys(studentStats).length}</div>
              <div className="text-xs text-[#63666F] mt-0.5">对话学生数</div>
            </Card>
            <Card className="text-center py-3">
              <div className="text-xl font-bold text-[#0052D9]">{totalCount}</div>
              <div className="text-xs text-[#63666F] mt-0.5">对话总数</div>
            </Card>
            <Card className="text-center py-3">
              <div className="text-xl font-bold text-[#0052D9]">
                {conversations.reduce((sum, c) => sum + c.messages.length, 0)}
              </div>
              <div className="text-xs text-[#63666F] mt-0.5">消息总数</div>
            </Card>
          </div>
        )}

        {/* 底部统计 */}
        {!loading && conversations.length > 0 && (
          <div className="text-center text-sm text-gray-400 mt-2">
            共 {totalCount} 个对话
            {searchKeyword && ` · 搜索: "${searchKeyword}"`}
          </div>
        )}

        {/* 删除确认弹窗 */}
        <Dialog
          header="确认删除"
          visible={deleteDialogVisible}
          onClose={() => setDeleteDialogVisible(false)}
          footer={null}
        >
          <div className="space-y-4">
            <p>
              确定要删除 {deleteTarget?.ids.length} 个对话记录吗？
            </p>
            <p className="text-red-500 text-sm">此操作不可撤销，对话和消息将被永久删除。</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteDialogVisible(false)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center gap-2"
              >
                {deleting && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                确认删除
              </button>
            </div>
          </div>
        </Dialog>

        {/* 清空班级确认弹窗 */}
        <Dialog
          header="确认清空班级对话"
          visible={clearClassDialogVisible}
          onClose={() => setClearClassDialogVisible(false)}
          footer={null}
        >
          <div className="space-y-4">
            <p>
              确定要清空 <strong>{clearClassTarget?.name}</strong> 的所有对话记录吗？
            </p>
            <p className="text-orange-500 text-sm">
              将删除该班级下 {clearClassTarget?.conversationCount || 0} 个对话记录，此操作不可撤销。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setClearClassDialogVisible(false)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmClearClass}
                disabled={deleting}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
              >
                {deleting && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                确认清空
              </button>
            </div>
          </div>
        </Dialog>
      </div>
    </TeacherLayout>
  );
}
