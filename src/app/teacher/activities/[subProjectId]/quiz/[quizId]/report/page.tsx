"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Switch, MessagePlugin, Dialog } from "tdesign-react";
import TeacherLayout from "@/components/layout/TeacherLayout";

interface Question {
  id?: string;
  type: string;
  content: string;
  options: string | Record<string, string>;
  answer: string;
  difficulty: string;
  explanation?: string;
  order?: number;
}

export default function QuizReportPage() {
  const params = useParams();
  const router = useRouter();
  const subProjectId = params.subProjectId as string;
  const quizId = params.quizId as string;

  const [quiz, setQuiz] = useState<any>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "ai" | "details">("overview");
  const [aiReport, setAiReport] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);
  // AI 报告版本管理
  const [aiReportVersions, setAiReportVersions] = useState<{ id: string; content: string; version: number; createdAt: string }[]>([]);
  const [aiReportVersionIndex, setAiReportVersionIndex] = useState(0);
  const [deleteVersionDialogVisible, setDeleteVersionDialogVisible] = useState(false);
  const [deleteVersionInfo, setDeleteVersionInfo] = useState<{ id: string; version: number } | null>(null);
  const [deletingVersion, setDeletingVersion] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [classes, setClasses] = useState<any[]>([]);
  const [reportClassId, setReportClassId] = useState("");
  const [sortBy, setSortBy] = useState<string>("score");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [detailExpanded, setDetailExpanded] = useState<boolean>(false);
  const [notAttemptedStudents, setNotAttemptedStudents] = useState<any[]>([]);
  const [incompleteStudents, setIncompleteStudents] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }

    fetch(`/api/quiz-activities/${quizId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          throw new Error(text || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data) => {
        if (!data || !data.id) throw new Error("作业不存在");
        setQuiz(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("加载作业失败:", err);
        setLoading(false);
        setError(err.message || "加载失败");
      });
  }, [quizId, router]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch("/api/classes", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setClasses(data);
          if (!reportClassId) setReportClassId(data.find((c: any) => c.isCurrent)?.id || data[0].id);
        }
      })
      .catch(console.error);
  }, []);

  // reportClassId 确定后自动加载报告
  useEffect(() => {
    if (reportClassId) handleViewReport();
  }, [reportClassId]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch("/api/analysis-templates", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        const quizAnalysisTemplates = data.quizAnalysisTemplates || [];
        setTemplates(quizAnalysisTemplates);
        const defaultTpl = quizAnalysisTemplates.find((t: any) => t.isDefault);
        if (defaultTpl) setSelectedTemplateId(defaultTpl.id);
      })
      .catch(console.error);
  }, []);

  const handleViewReport = async (overrideClassId?: string) => {
    const token = localStorage.getItem("token") || "";
    const classId = overrideClassId ?? reportClassId;
    console.log("[handleViewReport] classId:", classId, "reportClassId:", reportClassId, "overrideClassId:", overrideClassId);
    const url = `/api/quiz-activities/${quizId}/report${classId ? `?classId=${classId}` : ""}`;
    console.log("[handleViewReport] Fetching:", url);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    
    // 详细打印所有字段
    console.log("[handleViewReport] Response keys:", Object.keys(data));
    console.log("[handleViewReport] aiContent in data:", 'aiContent' in data, "value:", data.aiContent);
    console.log("[handleViewReport] data.aiContent === null:", data.aiContent === null);
    console.log("[handleViewReport] data.aiContent === undefined:", data.aiContent === undefined);
    console.log("[handleViewReport] data.aiContent type:", typeof data.aiContent);
    
    console.log("[handleViewReport] Response:", { 
      totalStudents: data.totalStudents, 
      hasAiContent: !!data.aiContent, 
      aiContentLength: data.aiContent?.length,
      notAttempted: data.notAttemptedStudents?.length,
      incomplete: data.incompleteStudents?.length,
    });
    // 无答题记录但有 AI 历史报告，仍可查看报告
    if (!data.totalStudents && !data.studentScores?.length) {
      if (data.aiReportVersions && data.aiReportVersions.length > 0) {
        setReportData(data);
        setNotAttemptedStudents([]);
        setIncompleteStudents([]);
      } else {
        setReportData(null);
        setNotAttemptedStudents([]);
        setIncompleteStudents([]);
        MessagePlugin.warning("无学生答题");
        return;
      }
    }
    setReportData(data);
    // 设置未参加和未完成学生名单
    setNotAttemptedStudents(data.notAttemptedStudents || []);
    setIncompleteStudents(data.incompleteStudents || []);
    // 加载已保存的 AI 报告
    if (data.aiReportVersions && data.aiReportVersions.length > 0) {
      console.log("[handleViewReport] Setting AI report versions:", data.aiReportVersions.length);
      setAiReportVersions(data.aiReportVersions);
      setAiReportVersionIndex(0);
      setAiReport(data.aiReportVersions[0].content);
    } else {
      setAiReportVersions([]);
      setAiReport("");
    }
  };

  const handleGenerateAiReport = async () => {
    setGeneratingReport(true);
    const token = localStorage.getItem("token") || "";
    try {
      const res = await fetch(`/api/quiz-activities/${quizId}/report/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          templateId: selectedTemplateId || undefined,
          classId: reportClassId, // 传递当前选中的班级 ID
        }),
      });
      const data = await res.json();
      
      if (data.content || data.aiContent) {
        const newContent = data.content || data.aiContent;
        
        // 生成报告后，刷新获取所有版本
        await handleViewReport();
        
        // 自动切换到最新版本（索引为0）
        if (aiReportVersions.length > 0) {
          setAiReportVersionIndex(0);
          setAiReport(aiReportVersions[0].content);
        } else {
          setAiReport(newContent);
        }
        setActiveTab("ai");
        MessagePlugin.success("报告生成成功");
      } else {
        setAiReport("生成失败");
      }
    } catch {
      setAiReport("生成失败");
      MessagePlugin.error("生成报告失败");
    } finally {
      setGeneratingReport(false);
    }
  };

  // 切换到指定版本
  const handleSwitchVersion = (index: number) => {
    if (aiReportVersions[index]) {
      setAiReportVersionIndex(index);
      setAiReport(aiReportVersions[index].content);
    }
  };

  // 删除指定版本
  const handleDeleteVersion = async (versionId: string) => {
    setDeletingVersion(true);
    const token = localStorage.getItem("token") || "";
    try {
      const res = await fetch(`/api/quiz-activities/${quizId}/report/versions/${versionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success("版本已删除");
        setDeleteVersionDialogVisible(false);
        // 刷新数据
        await handleViewReport();
        // 如果还有版本，切换到最新版本
        if (aiReportVersions.length > 1) {
          setAiReportVersionIndex(0);
          setAiReport(aiReportVersions[0].content);
        }
      } else {
        MessagePlugin.error("删除失败");
      }
    } catch {
      MessagePlugin.error("删除失败");
    } finally {
      setDeletingVersion(false);
    }
  };

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(key);
      setSortAsc(false);
    }
  };

  const getSortedRows = (rows: any[]) => {
    return (rows || []).filter(row => !row.notAttempted).slice().sort((a: any, b: any) => {
      let cmp = 0;
      if (sortBy.startsWith("q")) {
        const qIdx = parseInt(sortBy.slice(1));
        cmp = (a.answers?.[qIdx]?.isCorrect ? 1 : 0) - (b.answers?.[qIdx]?.isCorrect ? 1 : 0);
      } else if (sortBy === "score") {
        // 处理 null 分数（理论上不会到这里，因为已过滤 notAttempted）
        const scoreA = a.score ?? -1;
        const scoreB = b.score ?? -1;
        cmp = scoreB - scoreA;
      } else {
        cmp = a.name?.localeCompare(b.name, "zh-CN") || 0;
      }
      return sortAsc ? -cmp : cmp;
    });
  };

  const sortLabel = (key: string) => {
    if (sortBy !== key) return key;
    return sortAsc ? `${key} ▲` : `${key} ▼`;
  };

  if (loading) return <div className="p-6 text-center">加载中...</div>;
  if (error) return (
    <TeacherLayout>
      <div className="p-6 text-center">
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={() => router.back()} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">返回</button>
      </div>
    </TeacherLayout>
  );
  if (!quiz) return <div className="p-6 text-center">作业不存在</div>;

  return (
    <TeacherLayout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button onClick={() => router.push("/teacher/tasks")} className="text-sm text-gray-400 hover:text-gray-600 mb-1">← 返回课堂管理</button>
            <h1 className="text-xl font-semibold text-gray-800">{quiz.title} · 课堂作业报告</h1>
            <div className="text-sm text-gray-400">{quiz.description || "无说明"}</div>
          </div>
          <div className="flex gap-2 items-center">
            {classes.length > 0 && (
              <select 
                value={reportClassId} 
                onChange={async e => {
                  const newClassId = e.target.value;
                  setReportClassId(newClassId);
                  await handleViewReport(newClassId);
                }} 
                className="text-sm border rounded px-2 py-1"
              >
                {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button 
              onClick={() => window.print()} 
              className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
            >
              📄 打印
            </button>
          </div>
        </div>

        {/* 子导航Tab */}
        <div className="flex gap-1 border-b mb-6">
          {([
            { key: "overview", label: "📊 数据概览" },
            { key: "ai", label: "🤖 AI 分析报告" },
            { key: "details", label: "📋 学生详情" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key);
                // AI 报告 tab：如果没有报告内容，则加载
                if (t.key === "ai" && !aiReport && reportClassId) {
                  handleViewReport();
                } else if ((t.key === "overview" || t.key === "details") && !reportData) {
                  handleViewReport();
                }
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 数据概览 */}
        {activeTab === "overview" && (
          <div className="space-y-5">
            {reportData ? (
              <>
                {/* 顶部综合指标卡 */}
                <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
                  {[
                    { label: "参与人数", value: reportData.totalStudents, color: "text-blue-600", bg: "bg-blue-50" },
                    { label: "班级均分", value: reportData.classAvgScore, color: "text-green-600", bg: "bg-green-50" },
                    { label: "最高分", value: reportData.stats?.maxScore, color: "text-purple-600", bg: "bg-purple-50" },
                    { label: "最低分", value: reportData.stats?.minScore, color: "text-orange-600", bg: "bg-orange-50" },
                    { label: "中位数", value: reportData.stats?.median, color: "text-teal-600", bg: "bg-teal-50" },
                    { label: "及格率", value: `${reportData.stats?.passRate ?? 0}%`, color: "text-rose-600", bg: "bg-rose-50" },
                    { label: "标准差", value: reportData.stats?.stdDev, color: "text-indigo-600", bg: "bg-indigo-50" },
                  ].map((stat) => (
                    <div key={stat.label} className={`${stat.bg} rounded-xl p-3 text-center`}>
                      <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* 图表区：左雷达图 + 右分数分布 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {reportData.difficultyStats && reportData.difficultyStats.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm p-5">
                      <div className="font-medium text-gray-700 mb-3 text-sm">知识点掌握雷达图</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <RadarChart data={reportData.difficultyStats}>
                          <PolarGrid stroke="#e5e7eb" />
                          <PolarAngleAxis dataKey="name" tick={{ fontSize: 12, fill: "#6b7280" }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} />
                          <Radar name="正确率" dataKey="correctRate" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {reportData.scoreBuckets && reportData.scoreBuckets.some((b: any) => b.count > 0) && (
                    <div className="bg-white rounded-xl shadow-sm p-5">
                      <div className="font-medium text-gray-700 mb-3 text-sm">分数段分布</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={reportData.scoreBuckets.filter((b: any) => b.count > 0)} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                          <XAxis type="number" domain={[0, reportData.totalStudents]} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} width={50} />
                          <Tooltip formatter={(v: any) => [`${v}人`, "人数"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                            {(reportData.scoreBuckets.filter((b: any) => b.count > 0) as any[]).map((entry, i) => (
                              <Cell key={i} fill={i === 0 ? "#22c55e" : i === 1 ? "#6366f1" : i === 2 ? "#f59e0b" : i === 3 ? "#ef4444" : "#9ca3af"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* 班级认知负荷指数 */}
                {reportData.cognitiveLoadIndex !== undefined && (
                  <div className="bg-white rounded-xl shadow-sm p-5">
                    <div className="font-medium text-gray-700 mb-3 text-sm">班级认知负荷指数</div>
                    <div className="flex items-center gap-4">
                      <div className="text-4xl font-bold text-indigo-600">{reportData.cognitiveLoadIndex}</div>
                      <div className="text-sm text-gray-500">
                        综合反映班级应对<strong className="text-gray-700">基础→提升→拓展</strong>各难度题目的整体表现。
                        {reportData.cognitiveLoadIndex >= 70
                          ? " 班级整体掌握较好，建议适当引入挑战性题目。"
                          : reportData.cognitiveLoadIndex >= 50
                          ? " 班级有一定基础，拓展题需加强练习。"
                          : " 基础还不够扎实，建议回归基础训练。"}
                      </div>
                    </div>
                  </div>
                )}

                {/* 题目区分度 */}
                {reportData.questionDiscrimination && reportData.questionDiscrimination.length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm p-5">
                    <div className="font-medium text-gray-700 mb-3 text-sm">题目区分度（-1~1，相关系数）</div>
                    <div className="space-y-2">
                      {reportData.questionDiscrimination.map((d: any, idx: number) => (
                        <div key={d.questionId} className="flex items-center gap-3 text-sm">
                          <span className="w-8 text-gray-400 text-right shrink-0">题{idx + 1}</span>
                          <div className="w-24 text-gray-600 truncate shrink-0">{d.content}...</div>
                          <div className="flex-1 bg-gray-100 rounded-full h-2 relative overflow-hidden">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${
                                d.discrimination >= 0.3 ? "bg-green-400" : d.discrimination >= 0.1 ? "bg-yellow-400" : "bg-red-400"
                              }`}
                              style={{ width: `${Math.abs(d.discrimination) * 100}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold w-14 text-right shrink-0 ${
                            d.discrimination >= 0.3 ? "text-green-600" : d.discrimination >= 0.1 ? "text-yellow-600" : "text-red-500"
                          }`}>
                            {d.discrimination >= 0 ? "+" : ""}{d.discrimination}
                          </span>
                          <span className="text-xs text-gray-400 w-32 shrink-0">
                            {d.discrimination >= 0.3 ? "区分度好" : d.discrimination >= 0.1 ? "区分度一般" : "无区分度"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 高频错选项 */}
                {reportData.questionWrongOptions && reportData.questionWrongOptions.some((o: any) => o.topWrongOption) && (
                  <div className="bg-white rounded-xl shadow-sm p-5">
                    <div className="font-medium text-gray-700 mb-3 text-sm">各题高频错选答案</div>
                    <div className="space-y-2">
                      {reportData.questionWrongOptions.filter((o: any) => o.topWrongOption).map((o: any, idx: number) => (
                        <div key={o.questionId} className="flex items-center gap-3 text-sm">
                          <span className="w-8 text-gray-400 text-right shrink-0">题{idx + 1}</span>
                          <span className="w-20 text-center font-bold text-red-500 bg-red-50 rounded px-1.5 py-0.5">{o.topWrongOption}</span>
                          <span className="text-xs text-gray-400">{o.topWrongCount}人错选</span>
                          <span className="text-gray-500 truncate flex-1">{o.content}...</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 排名前5 + 排名后5 */}
                {reportData.studentQuestionMatrix && reportData.studentQuestionMatrix.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {(() => {
                      const sorted = [...reportData.studentQuestionMatrix].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
                      const top5 = sorted.slice(0, 5);
                      const bottom5 = sorted.slice(-5).reverse();
                      return (
                        <>
                          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-5">
                            <div className="font-medium text-green-700 mb-3 flex items-center gap-2 text-sm">
                              <span className="w-2 h-2 bg-green-400 rounded-full" />
                              排名前 5
                            </div>
                            <div className="space-y-2">
                              {top5.map((s: any, i: number) => (
                                <div key={s.userId} className="flex items-center gap-3 bg-white/60 rounded-lg px-3 py-2">
                                  <span className="text-green-600 font-bold text-sm w-6 text-center">#{i + 1}</span>
                                  <span className="text-sm font-medium text-gray-700 flex-1">{s.name}</span>
                                  <span className="text-sm font-bold text-green-600">{s.score}分</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="bg-gradient-to-br from-yellow-50 to-amber-50 border border-yellow-200 rounded-xl p-5">
                            <div className="font-medium text-yellow-700 mb-3 flex items-center gap-2 text-sm">
                              <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                              需关注（排名后 5）
                            </div>
                            <div className="space-y-2">
                              {bottom5.map((s: any, i: number) => (
                                <div key={s.userId} className="flex items-center gap-3 bg-white/60 rounded-lg px-3 py-2">
                                  <span className="text-yellow-600 font-bold text-sm w-6 text-center">#{sorted.length - 4 + i}</span>
                                  <span className="text-sm font-medium text-gray-700 flex-1">{s.name}</span>
                                  <span className="text-sm font-bold text-yellow-600">{s.score}分</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-gray-400">
                请选择班级查看报告数据
              </div>
            )}
          </div>
        )}

        {/* AI 分析报告 */}
        {activeTab === "ai" && (
          <div className="bg-white rounded-xl shadow-sm">
            {/* 头部：标题 + 版本切换 + 操作按钮 */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <div className="font-medium text-gray-700 text-sm">✨ AI 学情分析报告</div>
                {aiReport && aiReportVersions.length > 0 && (
                  <span className="text-xs text-[#63666F]">
                    · 第 {aiReportVersions[aiReportVersionIndex]?.version} 版 · {aiReportVersions[aiReportVersionIndex]?.createdAt ? new Date(aiReportVersions[aiReportVersionIndex].createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                )}
                {/* 版本切换 + 删除 */}
                {aiReportVersions.length > 1 && (
                  <div className="flex items-center ml-3 gap-2">
                    <span className="text-xs text-gray-400">版本：</span>
                    {aiReportVersions.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-3">
                        <button
                          onClick={() => handleSwitchVersion(i)}
                          className={`px-2 py-0.5 text-xs rounded ${i === aiReportVersionIndex ? 'bg-[#0052D9] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          v{v.version}
                        </button>
                        {v.id && (
                          <button
                            className="text-xs text-red-400 hover:text-red-600 px-0.5"
                            onClick={() => {
                              setDeleteVersionInfo({ id: v.id, version: v.version });
                              setDeleteVersionDialogVisible(true);
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
                    className="text-xs border rounded px-2 py-1.5"
                  >
                    {templates.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.isDefault ? " (默认)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                <button 
                  onClick={handleGenerateAiReport} 
                  disabled={generatingReport} 
                  className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {generatingReport ? "生成中..." : aiReport ? "重新生成" : "生成报告"}
                </button>
              </div>
            </div>
            
            {/* 报告内容 */}
            <div className="p-4">
              {aiReport ? (
                <div className="text-sm text-gray-700 leading-relaxed">
                  {/* 检测是否为 HTML 内容 */}
                  {aiReport.includes('<!DOCTYPE') ||
                   aiReport.includes('<html') ||
                   aiReport.includes('<div') ||
                   aiReport.includes('echarts') ||
                   aiReport.includes('ECharts') ||
                   aiReport.includes('chart') ||
                   aiReport.toLowerCase().includes('html') ? (
                    // 使用 iframe 隔离 HTML 样式，带全屏按钮
                    <div className="relative group">
                      <button
                        className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-white/80 hover:bg-white text-gray-600 rounded border border-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          const w = window.open('', '_blank');
                          if (w) {
                            w.document.write(aiReport);
                            w.document.close();
                            w.document.title = '作业 AI 分析报告';
                          }
                        }}
                      >
                        全屏查看
                      </button>
                      <iframe
                        srcDoc={aiReport}
                        className="w-full border-none"
                        style={{ minHeight: "400px" }}
                        sandbox="allow-scripts"
                        title="AI 学情分析报告"
                      />
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {aiReport}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  点击「生成报告」按钮生成 AI 学情分析报告
                </div>
              )}
            </div>
          </div>
        )}

        {/* 学生详情 */}
        {activeTab === "details" && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {reportData?.studentQuestionMatrix && reportData.studentQuestionMatrix.length > 0 ? (
              <>
                <div className="px-5 py-3 border-b bg-gray-50">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-400">图例：</span>
                    <span className="flex items-center gap-1">
                      <span className="w-4 h-4 rounded bg-green-100 text-green-600 flex items-center justify-center text-xs font-bold">A</span>
                      <span className="text-green-600">正确</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-4 h-4 rounded bg-red-100 text-red-500 flex items-center justify-center text-xs font-bold">B</span>
                      <span className="text-red-500">错误</span>
                    </span>
                    <span className="text-gray-400 ml-2">| 点击表头排序</span>
                  </div>
                </div>
                <div className="px-5 py-2 border-b">
                  <div className="flex items-center gap-3 text-xs">
                    <button 
                      onClick={() => handleSort("name")}
                      className={`${sortBy === "name" ? "text-gray-800 font-medium" : "text-gray-400 hover:text-gray-600"}`}
                    >
                      {sortLabel("姓名")}
                    </button>
                    <button 
                      onClick={() => handleSort("score")}
                      className={`${sortBy === "score" ? "text-gray-800 font-medium" : "text-gray-400 hover:text-gray-600"}`}
                    >
                      {sortLabel("得分")}
                    </button>
                    <span className="text-gray-400">对比</span>
                    {reportData.questionStats?.map((_: any, i: number) => (
                      <button 
                        key={i} 
                        onClick={() => handleSort(`q${i}`)}
                        className={`${sortBy === `q${i}` ? "text-gray-800 font-medium" : "text-gray-400 hover:text-gray-600"}`}
                      >
                        {sortLabel(`题${i + 1}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="px-5 overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {/* 已参加作业的学生（参与排序） */}
                      {getSortedRows(reportData.studentQuestionMatrix.filter((row: any) => !row.notAttempted)).map((row: any) => (
                        <tr key={row.userId} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2.5 pr-3 font-medium text-gray-700">{row.name}</td>
                          <td className="py-2.5 pr-3 text-center">
                            <span className={`font-bold ${row.score >= 90 ? "text-green-600" : row.score >= 60 ? "text-blue-600" : "text-red-500"}`}>{row.score}</span>
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden mx-auto">
                              <div className={`h-2 rounded-full ${row.score >= 90 ? "bg-green-400" : row.score >= 60 ? "bg-blue-400" : "bg-red-400"}`} style={{ width: (row.score || 0) + "%" }} />
                            </div>
                          </td>
                          {row.answers.map((ans: any, qi: number) => {
                            const questionType = reportData.questionStats?.[qi]?.type;
                            const isCorrect = ans.isCorrect;
                            return (
                              <td key={qi} className="py-2.5 px-1 text-center">
                                <div className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${ans.selectedAnswer ? (isCorrect ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500") : "bg-gray-100 text-gray-400"}`}>
                                  {ans.selectedAnswer || "-"}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      
                      {/* 未参加作业的学生（不参与排序，放在最后） */}
                      {reportData.studentQuestionMatrix.filter((row: any) => row.notAttempted).map((row: any) => (
                        <tr key={row.userId} className="border-b border-gray-50 bg-gray-50">
                          <td className="py-2.5 pr-3 font-medium text-gray-400">{row.name}（未参加）</td>
                          <td className="py-2.5 pr-3 text-center text-gray-400">-</td>
                          <td className="py-2.5 px-2 text-center">
                            <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden mx-auto">
                              <div className="h-2 rounded-full bg-gray-300" style={{ width: "0%" }} />
                            </div>
                          </td>
                          {row.answers.map((ans: any, qi: number) => (
                            <td key={qi} className="py-2.5 px-1 text-center">
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold bg-gray-100 text-gray-400">-</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* 未完成作业的学生名单 */}
                {incompleteStudents.length > 0 && (
                  <div className="px-5 py-3 border-t bg-yellow-50">
                    <div className="text-sm font-medium text-yellow-700 mb-2">未完成作业的学生（已参加但题目未做完）：</div>
                    <div className="flex flex-wrap gap-2">
                      {incompleteStudents.map((s: any, i: number) => (
                        <span key={i} className="inline-block px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs">
                          {s.name}（完成{s.answered}/{s.total}题）
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 未参加作业的学生名单 */}
                {notAttemptedStudents.length > 0 && (
                  <div className="px-5 py-3 border-t bg-gray-50">
                    <div className="text-sm font-medium text-gray-500 mb-2">未参加作业的学生：</div>
                    <div className="flex flex-wrap gap-2">
                      {notAttemptedStudents.map((s: any, i: number) => (
                        <span key={i} className="inline-block px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="p-6 text-center text-gray-400">
                请选择班级查看学生详情
              </div>
            )}
          </div>
        )}

        {/* 删除版本确认对话框 */}
        <Dialog
          header="删除报告版本"
          visible={deleteVersionDialogVisible}
          onClose={() => setDeleteVersionDialogVisible(false)}
          onConfirm={() => deleteVersionInfo && handleDeleteVersion(deleteVersionInfo.id)}
          confirmBtn={deletingVersion ? "删除中..." : "确认删除"}
          cancelBtn="取消"
        >
          <div className="text-center py-4">
            <p className="text-gray-600">确定要删除 <strong>v{deleteVersionInfo?.version}</strong> 版本吗？</p>
            <p className="text-gray-400 text-sm mt-2">删除后无法恢复</p>
          </div>
        </Dialog>
      </div>
    </TeacherLayout>
  );
}
