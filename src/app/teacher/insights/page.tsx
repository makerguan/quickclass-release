"use client";

import { useEffect, useState } from "react";
import { Card, Select, Button, MessagePlugin, Tag } from "tdesign-react";
import { RefreshIcon, UserIcon, ChartBarIcon, InfoCircleIcon } from "tdesign-icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TeacherLayout from "@/components/layout/TeacherLayout";
import { usePromptPreview, PromptPreviewDialog } from "@/components/prompt-preview";

// ===== 辅助函数 =====

/** 判断内容是否为 HTML 格式 */
function isHtmlContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('<!DOCTYPE') || 
         trimmed.startsWith('<html') ||
         (trimmed.includes('<html') && trimmed.includes('</html>'));
}

/** 渲染洞察内容 - 支持 HTML 和 Markdown，带全屏按钮 */
function InsightContent({ content, className = "" }: { content: string; className?: string }) {
  if (isHtmlContent(content)) {
    return (
      <div className="relative group">
        <button
          className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-white/80 hover:bg-white text-gray-600 rounded border border-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => {
            const w = window.open('', '_blank');
            if (w) {
              w.document.write(content);
              w.document.close();
              w.document.title = '学情分析报告';
            }
          }}
        >
          全屏查看
        </button>
        <iframe
          srcDoc={content}
          className={`w-full border-none ${className}`}
          style={{ minHeight: "400px" }}
          sandbox="allow-scripts"
          title="学情分析报告"
        />
      </div>
    );
  }
  return (
    <div className={`prose prose-sm prose-gray max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-all ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

interface ClassInfo {
  id: string;
  name: string;
  subject: string;
  _count?: { students: number; conversations: number };
}

interface TaskInsight {
  id: string;
  taskId: string;
  taskTitle: string;
  content: string;
  version: number;
  createdAt: string;
}

interface StudentInsight {
  id: string;
  userId: string;
  studentName: string;
  content: string;
  version: number;
  createdAt: string;
}

export default function TeacherInsightsPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [taskInsights, setTaskInsights] = useState<TaskInsight[]>([]);
  const [studentInsights, setStudentInsights] = useState<StudentInsight[]>([]);
  const [classSummary, setClassSummary] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [insightSource, setInsightSource] = useState<string>("");

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
    fetchClasses().then(() => {
      // fetchClasses 完成后会自动设置 selectedClassId
      // 无需额外操作，useEffect below 会处理数据获取
    });
    fetchSystemConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedClassId) {
      fetchInsights(selectedClassId);
    }
  }, [selectedClassId]);

  const fetchSystemConfig = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/system-config", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setInsightSource(data.insightDataSource || "CONVERSATIONS");
      }
    } catch {
      console.error("获取系统配置失败");
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
        // 优先选择当前班级(isCurrent=true)，否则选择第一个班级
        if (data.length > 0) {
          const currentClass = data.find((c: ClassInfo) => c.isCurrent);
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

  const fetchInsights = async (classId: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/ai-analysis/class-summary?classId=${classId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTaskInsights(data.taskInsights || []);
        setStudentInsights(data.studentInsights || []);
        setClassSummary(data.classSummary || "");
      }
    } catch {
      console.error("获取洞察数据失败");
    } finally {
      setLoading(false);
    }
  };

  const generateClassSummary = async () => {
    if (!selectedClassId) return;
    setGenerating(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/ai-analysis/class-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ classId: selectedClassId }),
      });
      if (res.ok) {
        const data = await res.json();
        setClassSummary(data.summary);
        MessagePlugin.success("班级学情洞察已生成");
      } else {
        MessagePlugin.error("生成失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setGenerating(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  return (
    <TeacherLayout>
      <div className="max-w-6xl space-y-6 pb-8">
        {/* 页面头部 */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">学情洞察</h2>
            <p className="text-[#63666F] text-sm mt-1">
              查看班级和学生的学情分析结果，支持多维度洞察
            </p>
          </div>
          <Select
            value={selectedClassId}
            onChange={(val) => setSelectedClassId(val as string)}
            options={classes.map((c) => ({ label: c.name, value: c.id }))}
            placeholder="选择班级"
            style={{ width: 200 }}
          />
        </div>

        {/* 数据来源配置（只读，由系统设置统一管理） */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-[#1A1A1A]">学情洞察数据来源</h3>
              <p className="text-sm text-[#63666F] mt-1">
                由系统设置统一配置
              </p>
            </div>
            <Tag theme={insightSource === "TASK_INSIGHTS" ? "warning" : "primary"}>
              {insightSource === "CONVERSATIONS" ? "原始对话数据" : "存在报告"}
            </Tag>
          </div>
          <div className="mt-3 p-3 bg-[#EDF1F7] rounded-lg text-sm">
            {insightSource === "CONVERSATIONS" ? (
              <p>
                <span className="text-[#0052D9] font-medium">原始对话数据：</span>
                使用学生的原始对话记录进行学情分析，可获得更全面的学生表现洞察。
              </p>
            ) : (
              <p>
                <span className="text-[#00A870] font-medium">存在报告：</span>
                使用已生成的学情分析结果，不采集学生原始对话，保护隐私。
              </p>
            )}
          </div>
        </Card>

        {/* 班级学情汇总 */}
        {selectedClass && (
          <Card
            title={
              <div className="flex items-center gap-2">
                <ChartBarIcon className="text-[#0052D9]" />
                <span>班级学情洞察</span>
              </div>
            }
          >
            {loading ? (
              <div className="text-center py-8 text-gray-400">加载中...</div>
            ) : classSummary ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Tag theme="success" variant="light">
                    AI 生成的学情洞察
                  </Tag>
                  <Button
                    theme="primary"
                    variant="outline"
                    size="small"
                    icon={<RefreshIcon />}
                    onClick={() => withPromptPreview(
                      () => selectedClassId ? {
                        endpoint: "/api/ai-analysis/class-summary",
                        body: { classId: selectedClassId }
                      } : null,
                      () => generateClassSummary()
                    )}
                    loading={generating || promptPreviewLoading}
                  >
                    重新生成
                  </Button>
                </div>
                <div className="prose prose-sm max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all">
                  <InsightContent content={classSummary} />
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-4">暂无学情洞察数据</p>
                <Button
                  theme="primary"
                  icon={<ChartBarIcon />}
                  onClick={() => withPromptPreview(
                    () => selectedClassId ? {
                      endpoint: "/api/ai-analysis/class-summary",
                      body: { classId: selectedClassId }
                    } : null,
                    () => generateClassSummary()
                  )}
                  loading={generating || promptPreviewLoading}
                >
                  生成学情洞察
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* 任务级洞察 */}
        {selectedClass && (
          <Card
            title={
              <div className="flex items-center gap-2">
                <ChartBarIcon className="text-[#00A870]" />
                <span>课堂级学情分析</span>
                <Tag theme="primary" size="small">{taskInsights.length}</Tag>
              </div>
            }
          >
            {loading ? (
              <div className="text-center py-8 text-gray-400">加载中...</div>
            ) : taskInsights.length > 0 ? (
              <div className="space-y-4">
                {taskInsights.map((insight) => (
                  <div
                    key={insight.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-[#0052D9]/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-[#1A1A1A]">{insight.taskTitle}</h4>
                      <Tag theme="success" variant="outline" size="small">
                        V{insight.version} · {formatDate(insight.createdAt)}
                      </Tag>
                    </div>
                    <div className="prose prose-sm max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all text-gray-600">
                      <InsightContent content={`${insight.content.slice(0, 300)}${insight.content.length > 300 ? "..." : ""}`} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                暂无课堂级学情分析结果
              </div>
            )}
          </Card>
        )}

        {/* 学生洞察 */}
        {selectedClass && (
          <Card
            title={
              <div className="flex items-center gap-2">
                <UserIcon className="text-[#63666F]" />
                <span>学生学情洞察</span>
                <Tag theme="primary" size="small">{studentInsights.length}</Tag>
              </div>
            }
          >
            {loading ? (
              <div className="text-center py-8 text-gray-400">加载中...</div>
            ) : studentInsights.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {studentInsights.map((insight) => (
                  <div
                    key={insight.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-[#0052D9]/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-[#1A1A1A]">{insight.studentName}</h4>
                      <Tag theme="default" variant="outline" size="small">
                        V{insight.version}
                      </Tag>
                    </div>
                    <div className="text-xs text-[#63666F] mb-2">
                      {formatDate(insight.createdAt)}
                    </div>
                    <div className="prose prose-sm max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all text-gray-600">
                      <InsightContent content={`${insight.content.slice(0, 200)}${insight.content.length > 200 ? "..." : ""}`} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                暂无学生学情洞察数据
              </div>
            )}
          </Card>
        )}

        {/* 无班级时 */}
        {classes.length === 0 && (
          <Card>
            <div className="text-center py-12">
              <ChartBarIcon className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">暂无班级</p>
              <p className="text-sm text-gray-400 mt-2">
                请先在「班级管理」中创建班级
              </p>
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
                <span className="px-2 py-0.5 bg-[#E8F0FE] text-[#0052D9] text-xs font-medium rounded">user</span>
                <span className="text-xs text-[#63666F]">
                  包含分析指令 + 嵌入的对话数据或下级分析结果
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
