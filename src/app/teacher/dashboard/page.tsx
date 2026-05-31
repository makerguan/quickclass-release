"use client";

import { useEffect, useState, useRef } from "react";
import { Card, Statistic, Button, MessagePlugin, Select } from "tdesign-react";
import { DashboardIcon, ChatIcon, UserIcon, RefreshIcon, ChartBarIcon, InfoCircleIcon } from "tdesign-icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TeacherLayout from "@/components/layout/TeacherLayout";
import { usePromptPreview, PromptPreviewDialog } from "@/components/prompt-preview";

interface ClassInfo {
  id: string;
  name: string;
  subject: string;
  _count?: { students: number };
}

interface StudentInfo {
  id: string;
  name: string;
  convCount: number;
  msgCount: number;
  hasInsight: boolean;
  insightVersion: number;
}

interface SavedInsight {
  id: string;
  type: string;
  content: string;
  version: number;
  createdAt: string;
  userId?: string;
}

export default function TeacherDashboardPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalConversations: 0,
    totalMessages: 0,
  });
  const [classInsight, setClassInsight] = useState<SavedInsight | null>(null);
  const [studentInsights, setStudentInsights] = useState<Record<string, SavedInsight>>({});
  const [loadingClassInsight, setLoadingClassInsight] = useState(false);
  const [loadingStudentId, setLoadingStudentId] = useState<string | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState<Record<string, boolean>>({});
  const [previousInsights, setPreviousInsights] = useState<Record<string, string>>({});
  const insightRef = useRef<HTMLDivElement>(null);

  // 提示词预览
  const {
    promptPreviewLoading,
    promptPreviewContent,
    promptPreviewVisible,
    pendingPreviewAction,
    setPromptPreviewVisible,
    withPromptPreview,
  } = usePromptPreview();

  useEffect(() => {
    fetchClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedClassId) {
      fetchClassData(selectedClassId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  const fetchClasses = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setClasses(data);
        // 优先选择当前班级(isCurrent=true)，否则选择第一个班级
        if (data.length > 0) {
          const currentClass = data.find((c: { isCurrent?: boolean }) => c.isCurrent);
          const targetClassId = currentClass?.id || data[0].id;
          if (!selectedClassId || selectedClassId !== targetClassId) {
            setSelectedClassId(targetClassId);
          }
        }
      }
    } catch {
      console.error("获取班级失败");
    }
  };

  const fetchClassData = async (classId: string) => {
    try {
      const token = localStorage.getItem("token");
      const [classRes, convRes, insightsRes] = await Promise.all([
        fetch(`/api/classes/${classId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/conversations/teacher?classId=${classId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/ai-analysis?classId=${classId}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const classData = classRes.ok ? await classRes.json() : null;
      const convData = convRes.ok ? await convRes.json() : [];
      const allInsights: SavedInsight[] = insightsRes.ok ? await insightsRes.json() : [];

      // 分离班级洞察和学生洞察
      const classIns = allInsights.find((i) => i.type === "class" && !i.userId);
      setClassInsight(classIns || null);

      const studentInsMap: Record<string, SavedInsight> = {};
      const studentVersionMap: Record<string, number> = {};
      for (const ins of allInsights) {
        if (ins.type === "student" && ins.userId) {
          if (!studentVersionMap[ins.userId] || ins.version > studentVersionMap[ins.userId]) {
            studentVersionMap[ins.userId] = ins.version;
            studentInsMap[ins.userId] = ins;
          }
        }
      }
      setStudentInsights(studentInsMap);

      // 构建学生列表
      const studentList: StudentInfo[] = [];
      if (classData?.students) {
        for (const s of classData.students) {
          const studentConvs = convData.filter((c: { userId: string }) => c.userId === s.id);
          const msgCount = studentConvs.reduce((sum: number, c: { messages: unknown[] }) => sum + c.messages.length, 0);
          const insight = studentInsMap[s.id];
          studentList.push({
            id: s.id,
            name: s.name,
            convCount: studentConvs.length,
            msgCount,
            hasInsight: !!insight,
            insightVersion: insight?.version || 0,
          });
        }
      }

      const totalConvs = convData.length;
      const totalMsgs = convData.reduce((sum: number, c: { messages: unknown[] }) => sum + c.messages.length, 0);

      setStats({
        totalStudents: studentList.length,
        totalConversations: totalConvs,
        totalMessages: totalMsgs,
      });
      setStudents(studentList);
    } catch {
      console.error("获取班级数据失败");
    }
  };

  // 全班一键分析
  const analyzeAllStudents = async () => {
    if (!selectedClassId) return;
    setLoadingAll(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId: selectedClassId, analyzeAll: true }),
      });
      if (res.ok) {
        const result = await res.json();
        MessagePlugin.success(`全班分析完成！班级洞察 + ${result.studentResults?.filter((r: { success: boolean }) => r.success).length || 0} 名学生分析已生成`);
        // 刷新数据
        await fetchClassData(selectedClassId);
      } else {
        const data = await res.json().catch(() => ({}));
        MessagePlugin.error(data.error || "全班分析失败");
      }
    } catch {
      MessagePlugin.error("全班分析失败");
    } finally {
      setLoadingAll(false);
    }
  };

  // 单个班级洞察
  const generateClassInsight = async () => {
    if (!selectedClassId) return;
    setLoadingClassInsight(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "class", classId: selectedClassId }),
      });
      if (res.ok) {
        const result = await res.json();
        setClassInsight({
          id: "",
          type: "class",
          content: result.content,
          version: result.version,
          createdAt: new Date().toISOString(),
        });
        if (result.previousContent) {
          setPreviousInsights((prev) => ({ ...prev, class: result.previousContent }));
        }
        MessagePlugin.success("班级洞察已生成并保存");
      } else {
        const data = await res.json().catch(() => ({}));
        MessagePlugin.error(data.error || "生成洞察失败");
      }
    } catch {
      MessagePlugin.error("生成洞察失败");
    } finally {
      setLoadingClassInsight(false);
    }
  };

  // 单个学生洞察
  const generateStudentInsight = async (studentId: string) => {
    if (!selectedClassId) return;
    setLoadingStudentId(studentId);
    setExpandedStudent(studentId);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "student", classId: selectedClassId, studentId }),
      });
      if (res.ok) {
        const result = await res.json();
        setStudentInsights((prev) => ({
          ...prev,
          [studentId]: {
            id: "",
            type: "student",
            content: result.content,
            version: result.version,
            createdAt: new Date().toISOString(),
            userId: studentId,
          },
        }));
        // 更新学生列表中的状态
        setStudents((prev) =>
          prev.map((s) => s.id === studentId ? { ...s, hasInsight: true, insightVersion: result.version } : s)
        );
        if (result.previousContent) {
          setPreviousInsights((prev) => ({ ...prev, [studentId]: result.previousContent }));
        }
        MessagePlugin.success("学生分析已生成并保存");
      } else {
        const data = await res.json().catch(() => ({}));
        MessagePlugin.error(data.error || "生成洞察失败");
      }
    } catch {
      MessagePlugin.error("生成洞察失败");
    } finally {
      setLoadingStudentId(null);
    }
  };

  const toggleStudent = (studentId: string) => {
    setExpandedStudent(expandedStudent === studentId ? null : studentId);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <TeacherLayout>
      <div className="space-y-6 pb-8">
        {/* 页面标题 + 班级选择 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">学情仪表盘</h2>
            <p className="text-[#63666F] text-sm mt-1">基于 AI 对话记录分析班级学习情况</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#63666F]">班级：</span>
            <Select
              value={selectedClassId}
              onChange={(val) => setSelectedClassId(String(val))}
              options={classes.map((c) => ({ label: c.name, value: c.id }))}
              placeholder="选择班级"
              style={{ width: 200 }}
              size="medium"
            />
          </div>
        </div>

        {selectedClassId ? (
          <>
            {/* 统计卡片 */}
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <div className="flex items-center gap-3">
                  <UserIcon className="text-[#0052D9]" />
                  <Statistic title="学生人数" value={stats.totalStudents} />
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <ChatIcon className="text-[#00A870]" />
                  <Statistic title="对话总数" value={stats.totalConversations} />
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <DashboardIcon className="text-[#ED7B2F]" />
                  <Statistic title="消息总数" value={stats.totalMessages} />
                </div>
              </Card>
            </div>

            {/* 班级学情洞察 */}
            <Card>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-medium text-[#1A1A1A]">AI 学情洞察</h3>
                  <p className="text-xs text-[#63666F] mt-0.5">
                    {classInsight
                      ? `第 ${classInsight.version} 版 · ${formatDate(classInsight.createdAt)}`
                      : "基于班级学生的 AI 对话记录与学习数据智能分析"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {classInsight && previousInsights.class && (
                    <Button
                      theme={showComparison.class ? "warning" : "default"}
                      variant="outline"
                      size="small"
                      onClick={() => setShowComparison((prev) => ({ ...prev, class: !prev.class }))}
                    >
                      {showComparison.class ? "隐藏对比" : "与上次对比"}
                    </Button>
                  )}
                  <Button
                    theme="primary"
                    size="small"
                    loading={loadingClassInsight || promptPreviewLoading}
                    onClick={() => withPromptPreview(
                      () => selectedClassId ? {
                        endpoint: "/api/ai-analysis",
                        body: { type: "class", classId: selectedClassId }
                      } : null,
                      () => generateClassInsight()
                    )}
                    icon={!loadingClassInsight ? <RefreshIcon /> : undefined}
                  >
                    {classInsight ? "重新分析" : "生成洞察"}
                  </Button>
                </div>
              </div>
              <div
                ref={insightRef}
                className="bg-[#F7F8FA] p-5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap min-h-[120px] max-h-[600px] overflow-y-auto break-words"
              >
                {classInsight ? classInsight.content : (
                  <span className="text-gray-400">点击「生成洞察」按钮，AI 将读取班级学生的对话记录和学习数据，生成详细的学情分析报告...</span>
                )}
              </div>
              {/* 对比区域 */}
              {showComparison.class && previousInsights.class && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-[#ED7B2F] mb-2">上一次分析结果：</h4>
                  <div className="bg-[#FFF8F0] p-5 rounded-lg text-sm leading-relaxed max-h-[400px] overflow-y-auto border border-[#ED7B2F]/20 break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{previousInsights.class}</ReactMarkdown>
                  </div>
                </div>
              )}
            </Card>

            {/* 学生列表 */}
            <Card>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-medium text-[#1A1A1A]">学生学习洞察</h3>
                  <p className="text-xs text-[#63666F] mt-0.5">
                    {students.filter((s) => s.hasInsight).length}/{students.length} 名学生已生成分析
                  </p>
                </div>
                <Button
                  theme="success"
                  size="small"
                  loading={loadingAll || promptPreviewLoading}
                  onClick={() => withPromptPreview(
                    () => selectedClassId ? {
                      endpoint: "/api/ai-analysis",
                      body: { classId: selectedClassId, analyzeAll: true }
                    } : null,
                    () => analyzeAllStudents()
                  )}
                  icon={!loadingAll ? <ChartBarIcon /> : undefined}
                >
                  {loadingAll ? "正在分析全班..." : "一键分析全班"}
                </Button>
              </div>

              {students.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <p>暂无学生数据</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {students.map((student) => {
                    const isExpanded = expandedStudent === student.id;
                    const insight = studentInsights[student.id];
                    const isLoading = loadingStudentId === student.id;

                    return (
                      <div
                        key={student.id}
                        className={`border rounded-lg transition-all ${isExpanded ? "border-[#0052D9] border-opacity-40 shadow-sm" : "border-gray-200"}`}
                      >
                        <div
                          className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                          onClick={() => toggleStudent(student.id)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#0052D9] bg-opacity-10 flex items-center justify-center">
                              <span className="text-[#0052D9] text-xs font-medium">
                                {student.name.charAt(0)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium text-[#1A1A1A] text-sm">{student.name}</span>
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className="text-xs text-[#63666F]">{student.convCount} 次对话</span>
                                <span className="text-xs text-[#63666F]">{student.msgCount} 条消息</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {student.hasInsight && (
                              <span className="text-xs text-[#00A870] bg-green-50 px-2 py-0.5 rounded">
                                V{student.insightVersion}
                              </span>
                            )}
                            {student.convCount > 0 && !student.hasInsight && !isLoading && (
                              <Button
                                theme="primary"
                                variant="text"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  withPromptPreview(
                                    () => selectedClassId ? {
                                      endpoint: "/api/ai-analysis",
                                      body: { type: "student", classId: selectedClassId, studentId: student.id }
                                    } : null,
                                    () => generateStudentInsight(student.id)
                                  );
                                }}
                              >
                                AI 分析
                              </Button>
                            )}
                            {isLoading && (
                              <span className="text-xs text-[#0052D9]">分析中...</span>
                            )}
                            <svg
                              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                            {insight ? (
                              <>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs text-[#63666F]">
                                    第 {insight.version} 版 · {formatDate(insight.createdAt)}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {previousInsights[student.id] && (
                                      <Button
                                        theme={showComparison[student.id] ? "warning" : "default"}
                                        variant="text"
                                        size="small"
                                        onClick={() => setShowComparison((prev) => ({ ...prev, [student.id]: !prev[student.id] }))}
                                      >
                                        {showComparison[student.id] ? "隐藏对比" : "与上次对比"}
                                      </Button>
                                    )}
                                    <Button
                                      theme="default"
                                      variant="text"
                                      size="small"
                                      onClick={() => withPromptPreview(
                                        () => selectedClassId ? {
                                          endpoint: "/api/ai-analysis",
                                          body: { type: "student", classId: selectedClassId, studentId: student.id }
                                        } : null,
                                        () => generateStudentInsight(student.id)
                                      )}
                                      loading={loadingStudentId === student.id || promptPreviewLoading}
                                      icon={<RefreshIcon />}
                                    >
                                      重新分析
                                    </Button>
                                  </div>
                                </div>
                                <div className="bg-[#F7F8FA] p-4 rounded-lg text-sm leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto break-words">
                                  {insight.content}
                                </div>
                                {showComparison[student.id] && previousInsights[student.id] && (
                                  <div className="mt-3">
                                    <h4 className="text-xs font-medium text-[#ED7B2F] mb-2">上一次分析：</h4>
                                    <div className="bg-[#FFF8F0] p-4 rounded-lg text-sm leading-relaxed max-h-[400px] overflow-y-auto border border-[#ED7B2F]/20 prose prose-sm prose-gray max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-all">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{previousInsights[student.id]}</ReactMarkdown>
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : isLoading ? (
                              <div className="bg-[#F7F8FA] p-4 rounded-lg text-sm text-gray-400 text-center">
                                AI 正在分析 {student.name} 的学习数据...
                              </div>
                            ) : (
                              <div className="bg-[#F7F8FA] p-4 rounded-lg text-sm text-gray-400 text-center">
                                {student.convCount > 0
                                  ? "点击「AI 分析」按钮生成个性化学习洞察"
                                  : "该学生暂无对话记录，无法生成分析"}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        ) : (
          <Card>
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg mb-2">📚</p>
              <p>请先选择一个班级查看学情数据</p>
              {classes.length === 0 && (
                <p className="text-sm mt-2">您还未创建班级，请先前往「班级管理」创建班级</p>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* 提示词预览确认对话框 */}
      <PromptPreviewDialog
        loading={promptPreviewLoading}
        content={promptPreviewContent}
        visible={promptPreviewVisible}
        onVisibleChange={setPromptPreviewVisible}
        onConfirm={async () => {
          setPromptPreviewVisible(false);
          await pendingPreviewAction?.();
        }}
        renderContent={(content) => (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 bg-[#F0F5FF] rounded-lg">
              <InfoCircleIcon className="text-[#0052D9] mt-0.5 shrink-0" />
              <p className="text-sm text-[#1A1A1A]">
                以下是将一次性发送给 AI 模型的完整消息。确认无误后点击「同意并发送」。
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-[#E8F0FE] text-[#0052D9] text-xs font-medium rounded">system</span>
                <span className="text-xs text-[#63666F]">
                  AI 分析师角色设定，告知课堂信息
                </span>
              </div>
              <div className="bg-[#1E1E1E] text-[#D4D4D4] rounded-lg p-4 font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto whitespace-pre-wrap break-all">
                {content}
              </div>
            </div>
          </div>
        )}
      />
    </TeacherLayout>
  );
}
