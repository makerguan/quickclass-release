"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Tag, Select, MessagePlugin, Dialog } from "tdesign-react";
import { ArrowLeftIcon, ChartBarIcon } from "tdesign-icons-react";
import Markdown from "@/components/Markdown";
import TeacherLayout from "@/components/layout/TeacherLayout";

interface StudentRecord {
  studentId: string;
  studentName: string;
  score: number;
  maxScore: number;
  timeSpent: number;
  interactions: number;
  completedSections: string[];
  submittedAt: string;
  actionCount: number;
}

interface AnalysisData {
  explorationId: string;
  explorationTitle: string;
  submittedCount: number;
  totalStudents: number | null;
  classIds: string[];
  averageScore: number;
  scoreDistribution: Record<string, number>;
  avgTimeSpent: number;
  avgInteractions: number;
  actionTypeStats: Record<string, number>;
  studentRecords: StudentRecord[];
  teachingAdvice: string | null;
}

interface UserSubmission {
  id: string;
  studentName: string;
  answers: string;
  score: number | null;
  totalScore: number;
  submittedAt: string;
  actionLogs: { type: string; timestamp: string }[];
}

interface AnalysisTemplate {
  id: string;
  type: string;
  name: string;
  content: string;
  isDefault: boolean;
}

interface InsightVersion {
  id?: string;
  content: string;
  version: number;
  createdAt: string;
}

// 辅助函数：判断内容是否为 HTML
function isHtmlContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    (trimmed.includes('<html') && trimmed.includes('</html>'));
}

// 辅助函数：渲染洞察内容 - 支持 HTML 和 Markdown，带全屏按钮
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
              w.document.title = '探究 AI 分析报告';
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
          title="探究 AI 分析报告"
        />
      </div>
    );
  }
  return (
    <div className={`prose prose-sm prose-gray max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-all ${className}`}>
      <Markdown>{content}</Markdown>
    </div>
  );
}

type TabKey = "statistics" | "submissions" | "ai";

export default function ExplorationAnalysisPage() {
  const router = useRouter();
  const params = useParams();
  const explorationId = params.explorationId as string;

  const [loading, setLoading] = useState(true);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [submissions, setSubmissions] = useState<UserSubmission[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("statistics");
  const [error, setError] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedClassId, setSelectedClassId] = useState("");
  const [allClasses, setAllClasses] = useState<{ id: string; name: string }[]>([]);

  // AI 分析报告状态
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [aiReport, setAiReport] = useState<InsightVersion | null>(null);
  const [aiReportVersions, setAiReportVersions] = useState<InsightVersion[]>([]);
  const [aiVersionIndex, setAiVersionIndex] = useState(0);
  const [generatingReport, setGeneratingReport] = useState(false);

  // 删除版本
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState<{ id: string; version: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (explorationId) {
      fetchData();
      fetchTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorationId]);

  const fetchTemplates = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/analysis-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const expTemplates = data.explorationAnalysisTemplates || [];
        setTemplates(expTemplates);
        const defaultTpl = expTemplates.find((t: any) => t.isDefault);
        if (defaultTpl) setSelectedTemplateId(defaultTpl.id);
      }
    } catch { /* ignore */ }
  };

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("token");

      const res = await fetch(`/api/exploration-activities/${explorationId}/analysis`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "请求失败");
        setError(errText);
        setLoading(false);
        return;
      }
      const data: AnalysisData = await res.json();
      setAnalysisData(data);

      // 设置班级选择：优先用当前班级，否则用第一个
      // 加载班级列表
      const clsRes = await fetch("/api/classes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (clsRes.ok) {
        const clsData = await clsRes.json();
        setAllClasses(Array.isArray(clsData) ? clsData : []);
      }

      // 获取当前班级
      const curRes = await fetch("/api/classes/current", {
        headers: { Authorization: `Bearer ${token}` },
      });
      let currentClassId = "";
      if (curRes.ok) {
        const curData = await curRes.json();
        currentClassId = curData.class?.id || "";
      }
      const targetClassId = data.classIds?.includes(currentClassId)
        ? currentClassId
        : (data.classIds?.[0] || "");
      setSelectedClassId(targetClassId);

      const subRes = await fetch(`/api/exploration-activities/${explorationId}/submissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (subRes.ok) {
        const subData = await subRes.json();
        setSubmissions(Array.isArray(subData) ? subData : subData.submissions || []);
      }

      // 加载已保存的 AI 报告版本
      if (targetClassId) {
        await fetchAiVersions(targetClassId);
      }
    } catch (e: any) {
      console.error("获取分析数据失败", e);
      setError(e.message || "获取数据失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchAiVersions = async (classId: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/exploration-activities/${explorationId}/analysis/generate?classId=${classId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const versions = data.versions || [];
        setAiReportVersions(versions);
        if (versions.length > 0) {
          setAiReport(versions[0]);
          setAiVersionIndex(0);
        } else {
          setAiReport(null);
          setAiVersionIndex(0);
        }
      }
    } catch { /* ignore */ }
  };

  const handleGenerateAiReport = useCallback(async () => {
    if (!selectedClassId) {
      MessagePlugin.warning("未选择班级，请先选择班级");
      return;
    }
    setGeneratingReport(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/exploration-activities/${explorationId}/analysis/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          templateId: selectedTemplateId || undefined,
          classId: selectedClassId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const newInsight: InsightVersion = {
          id: data.id,
          content: data.content,
          version: data.version,
          createdAt: data.createdAt,
        };
        setAiReportVersions((prev) => {
          const updated = data.previousContent
            ? [{ id: data.previousId, content: data.previousContent, version: data.version - 1, createdAt: "" }, newInsight]
            : [newInsight];
          return updated;
        });
        setAiVersionIndex(0);
        setAiReport(newInsight);
        MessagePlugin.success("AI 分析报告已生成");
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || "生成失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setGeneratingReport(false);
    }
  }, [selectedClassId, explorationId, selectedTemplateId]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const TabButton = ({ tabKey, label }: { tabKey: TabKey; label: string }) => (
    <button
      className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tabKey
        ? "border-blue-500 text-blue-600"
        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
        }`}
      onClick={() => setActiveTab(tabKey)}
    >
      {label}
    </button>
  );

  const renderStatistics = () => {
    if (submissions.length === 0) return <div className="text-center py-8 text-sm text-gray-400">暂无提交数据</div>;

    const allAnswers: Record<string, any>[] = submissions.map((sub) => {
      try { return JSON.parse(sub.answers || "{}"); } catch { return {}; }
    });

    const allFields = new Set<string>();
    for (const ans of allAnswers) {
      for (const key of Object.keys(ans)) {
        const val = ans[key];
        if (val !== "" && val !== null && val !== undefined) {
          allFields.add(key);
        }
      }
    }

    const fieldLabels: Record<string, string> = {
      timeSpent: "停留时间（秒）",
      interactions: "互动次数",
      scrollDepth: "滚动深度（%）",
      attempts: "尝试次数",
      gameLevel: "游戏关卡",
      completedSections: "完成环节",
      taskTitle: "任务标题",
      studentName: "学生姓名",
      className: "班级名称",
    };

    const numericFields = ["timeSpent", "interactions", "scrollDepth", "attempts", "gameLevel"];
    const sortedFields = [...allFields].sort((a, b) => {
      const aIdx = numericFields.indexOf(a);
      const bIdx = numericFields.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-blue-700">{submissions.length}</div>
            <div className="text-xs text-blue-500 mt-1">已提交</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-green-700">
              {submissions.filter((s) => s.score !== null && s.score !== undefined).length}
            </div>
            <div className="text-xs text-green-500 mt-1">已评分</div>
          </div>
        </div>

        {sortedFields.map((field) => {
          const values = allAnswers
            .map((a) => a[field])
            .filter((v) => v !== "" && v !== null && v !== undefined && v !== false);

          if (values.length === 0) return null;

          const isNumeric = typeof values[0] === "number" || (typeof values[0] === "string" && !isNaN(Number(values[0])));
          const isArray = Array.isArray(values[0]);

          if (isNumeric && !isArray) {
            const nums = values.map((v) => Number(v));
            const avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
            const min = Math.min(...nums);
            const max = Math.max(...nums);

            return (
              <div key={field}>
                <h3 className="text-sm font-medium text-gray-600 mb-3">{fieldLabels[field] || field}</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-purple-700">{avg}</div>
                    <div className="text-xs text-purple-500">平均值</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-blue-700">{min}</div>
                    <div className="text-xs text-blue-500">最小值</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-green-700">{max}</div>
                    <div className="text-xs text-green-500">最大值</div>
                  </div>
                </div>
              </div>
            );
          }

          if (isArray) {
            const counter: Record<string, number> = {};
            for (const arr of values) {
              for (const item of arr) {
                counter[String(item)] = (counter[String(item)] || 0) + 1;
              }
            }
            const entries = Object.entries(counter).sort((a, b) => b[1] - a[1]);

            return (
              <div key={field}>
                <h3 className="text-sm font-medium text-gray-600 mb-3">{fieldLabels[field] || field}</h3>
                <div className="flex flex-wrap gap-2">
                  {entries.map(([item, count]) => (
                    <div key={item} className="bg-gray-50 rounded-full px-3 py-1 text-xs">
                      <span className="text-gray-500">{item}</span>
                      <span className="ml-1 font-medium text-gray-700">{count}人</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          const uniqueValues = [...new Set(values.map((v) => String(v)))];
          const counter: Record<string, number> = {};
          for (const v of values) {
            const key = String(v);
            counter[key] = (counter[key] || 0) + 1;
          }
          const sorted = Object.entries(counter).sort((a, b) => b[1] - a[1]);

          return (
            <div key={field}>
              <h3 className="text-sm font-medium text-gray-600 mb-3">{fieldLabels[field] || field}</h3>
              {uniqueValues.length <= 3 ? (
                <div className="space-y-2">
                  {sorted.map(([val, count]) => (
                    <div key={val} className="flex items-center gap-3 text-xs">
                      <span className="w-20 text-gray-500 truncate">{val}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3">
                        <div
                          className="bg-blue-400 rounded-full h-3 transition-all"
                          style={{ width: `${(count / values.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-gray-600 w-6">{count}人</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sorted.map(([val, count]) => (
                    <div key={val} className="bg-gray-50 rounded-full px-3 py-1 text-xs">
                      <span className="text-gray-700">{val}</span>
                      <span className="ml-1 text-gray-400">({count}人)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSubmissions = () => {
    if (loading) return <div className="text-center py-8 text-sm text-gray-400">加载中...</div>;
    if (submissions.length === 0) return <div className="text-center py-8 text-sm text-gray-400">暂无提交记录</div>;

    const toggleExpand = (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const renderAnswersDetail = (answers: Record<string, unknown>) => {
      const fieldLabels: Record<string, string> = {
        timeSpent: "停留时间（秒）",
        interactions: "互动次数",
        scrollDepth: "滚动深度（%）",
        attempts: "尝试次数",
        gameLevel: "游戏关卡",
        completedSections: "完成环节",
      };
      const items = Object.entries(answers).filter(([, v]) => v !== "" && v !== null && v !== undefined);
      if (items.length === 0) return <div className="text-xs text-gray-400">无数据</div>;

      return (
        <div className="grid grid-cols-2 gap-2">
          {items.map(([key, val]) => (
            <div key={key} className="bg-gray-50 rounded px-3 py-2">
              <div className="text-xs text-gray-400">{fieldLabels[key] || key}</div>
              <div className="text-sm font-medium text-gray-700 mt-0.5">
                {key === "completedSections"
                  ? (Array.isArray(val) && val.length > 0 ? val.join("、") : "无")
                  : Array.isArray(val) ? val.join("、") : String(val)}
              </div>
            </div>
          ))}
        </div>
      );
    };

    return (
      <div className="space-y-3">
        <div className="text-sm text-gray-500 mb-2">
          共 {submissions.length} 人提交
        </div>

        {submissions.map((sub) => {
          let answers: any = {};
          try { answers = JSON.parse(sub.answers || "{}"); } catch { }
          const isExpanded = expandedIds.has(sub.id);

          return (
            <div key={sub.id} className="border border-gray-200 rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => toggleExpand(sub.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-800">{sub.studentName}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(sub.submittedAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-gray-400 transition-transform" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                  ▼
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 py-3 space-y-4 border-t border-gray-100">
                  <div>
                    <h5 className="text-xs font-medium text-gray-500 mb-2">📊 提交数据</h5>
                    {renderAnswersDetail(answers)}
                  </div>
                  <div>
                    <h5 className="text-xs font-medium text-gray-500 mb-2">📋 操作记录</h5>
                    {sub.actionLogs && sub.actionLogs.length > 0 ? (
                      <div className="max-h-48 overflow-y-auto space-y-1 bg-gray-50 rounded p-3">
                        {sub.actionLogs.map((log, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                            <span className="text-blue-600 font-medium">{log.type}</span>
                            <span className="text-gray-400">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">无操作记录</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderAiReport = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      {/* 头部：标题 + 版本切换 + 操作按钮 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <ChartBarIcon className="text-[#FF6B35]" />
          <span className="font-medium text-gray-700 text-sm">AI 分析报告</span>
          {aiReport && (
            <span className="text-xs text-[#63666F]">
              · 第 {aiReport.version} 版 · {formatDate(aiReport.createdAt)}
            </span>
          )}
          {aiReportVersions.length > 1 && (
            <div className="flex items-center ml-3 gap-2">
              <span className="text-xs text-gray-400">版本：</span>
              {aiReportVersions.map((v, i) => (
                <div key={i} className="flex items-center gap-3">
                  <button
                    className={`px-2 py-0.5 text-xs rounded ${i === aiVersionIndex ? 'bg-[#0052D9] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => {
                      setAiVersionIndex(i);
                      setAiReport(v);
                    }}
                  >
                    v{v.version}
                  </button>
                  {v.id && (
                    <button
                      className="text-xs text-red-400 hover:text-red-600 px-0.5"
                      onClick={() => {
                        setDeleteVersion({ id: v.id!, version: v.version });
                        setDeleteVisible(true);
                      }}
                      title="删除此版本"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#0052D9]"
            >
              <option value="">默认模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isDefault ? " (默认)" : ""}
                </option>
              ))}
            </select>
          )}
          <Button
            theme="primary"
            size="small"
            loading={generatingReport}
            onClick={handleGenerateAiReport}
          >
            {aiReport ? "重新生成" : "生成报告"}
          </Button>
        </div>
      </div>

      {/* 内容 */}
      <div className="p-4">
        {aiReport ? (
          <InsightContent content={aiReport.content} />
        ) : generatingReport ? (
          <div className="text-center py-12 text-gray-400">AI 正在生成报告...</div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            点击「生成报告」按钮，AI 将基于所有提交数据生成分析报告
          </div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <TeacherLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-sm text-gray-400">加载中...</div>
        </div>
      </TeacherLayout>
    );
  }

  if (error) {
    return (
      <TeacherLayout>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <Button theme="default" variant="text" size="small" icon={<ArrowLeftIcon />} onClick={() => router.back()} />
            <h2 className="text-xl font-semibold">探究分析</h2>
          </div>
          <div className="text-center py-12">
            <div className="text-red-500 text-sm mb-4">{error}</div>
            <Button onClick={fetchData}>重试</Button>
          </div>
        </div>
      </TeacherLayout>
    );
  }

  return (
    <TeacherLayout>
      <div className="p-6">
        {/* 顶部导航 */}
        <div className="flex items-center gap-3 mb-6">
          <Button theme="default" variant="text" size="small" icon={<ArrowLeftIcon />} onClick={() => router.back()} />
          <div>
            <h2 className="text-xl font-semibold">探究分析报告</h2>
            <p className="text-sm text-gray-500 mt-0.5">{analysisData?.explorationTitle}</p>
          </div>
          {analysisData?.classIds && analysisData.classIds.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-500">班级：</span>
              <select
                value={selectedClassId}
                onChange={(e) => {
                  const cid = e.target.value;
                  setSelectedClassId(cid);
                  setAiReport(null);
                  setAiReportVersions([]);
                  setAiVersionIndex(0);
                  fetchAiVersions(cid);
                }}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0052D9]"
              >
                {analysisData.classIds.map((cid: string) => {
                  const cls = allClasses.find((c) => c.id === cid);
                  return (
                    <option key={cid} value={cid}>
                      {cls ? cls.name : cid.substring(0, 8)}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {/* Tab 切换 */}
        <div className="border-b border-gray-200 mb-6">
          <TabButton tabKey="statistics" label="统计信息" />
          <TabButton tabKey="submissions" label="提交详情" />
          <TabButton tabKey="ai" label="AI 分析报告" />
        </div>

        {/* Tab 内容 */}
        {activeTab === "statistics" && renderStatistics()}
        {activeTab === "submissions" && renderSubmissions()}
        {activeTab === "ai" && renderAiReport()}
      </div>

      {/* 删除版本确认 */}
      <Dialog
        header="删除分析版本"
        visible={deleteVisible}
        onClose={() => { setDeleteVisible(false); setDeleteVersion(null); }}
        footer={null}
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            确定要删除 <strong>v{deleteVersion?.version}</strong> 版分析吗？
          </p>
          <p className="text-sm text-red-600">此操作不可撤销！</p>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => { setDeleteVisible(false); setDeleteVersion(null); }}>取消</Button>
            <Button theme="danger" loading={deleting} onClick={async () => {
              if (!deleteVersion) return;
              setDeleting(true);
              try {
                const token = localStorage.getItem("token");
                const res = await fetch(`/api/insights/${deleteVersion.id}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  MessagePlugin.success("版本已删除");
                  const updated = aiReportVersions.filter((v) => v.id !== deleteVersion.id);
                  setAiReportVersions(updated);
                  if (updated.length > 0) {
                    const newIdx = Math.min(aiVersionIndex, updated.length - 1);
                    setAiVersionIndex(newIdx);
                    setAiReport(updated[newIdx]);
                  } else {
                    setAiReport(null);
                    setAiVersionIndex(0);
                  }
                } else {
                  MessagePlugin.error("删除失败");
                }
              } catch { MessagePlugin.error("网络错误"); }
              finally {
                setDeleting(false);
                setDeleteVisible(false);
                setDeleteVersion(null);
              }
            }}>
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>
    </TeacherLayout>
  );
}