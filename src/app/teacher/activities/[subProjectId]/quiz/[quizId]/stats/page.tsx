"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import { Card, Button, Select, Tag, Loading, MessagePlugin } from "tdesign-react";
import { ChevronLeftIcon, ChartBarIcon, RefreshIcon } from "tdesign-icons-react";
import TeacherLayout from "@/components/layout/TeacherLayout";
import Markdown from "@/components/Markdown";
import { cleanInsightContent } from "@/lib/insight-clean";

interface QuestionStat {
  questionId: string;
  content: string;
  type: string;
  difficulty: string;
  correctRate: number;
}

interface ScoreBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

interface DifficultyStat {
  name: string;
  nameEn: string;
  correctRate: number;
  total: number;
}

interface StudentScore {
  name: string;
  score: number;
  userId: string;
}

interface Stats {
  maxScore: number;
  minScore: number;
  median: number;
  passRate: number;
}

export default function QuizStatsPage() {
  const params = useParams();
  const router = useRouter();
  const subProjectId = params.subProjectId as string;
  const quizId = params.quizId as string;

  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);
  const [quizInfo, setQuizInfo] = useState<{ title: string; description?: string } | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [generatingAI, setGeneratingAI] = useState(false);

  useEffect(() => {
    fetchQuizInfo();
  }, [quizId]);

  useEffect(() => {
    if (selectedClassId) {
      fetchReport();
    }
  }, [selectedClassId]);

  const fetchQuizInfo = async () => {
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${quizId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQuizInfo({ title: data.title, description: data.description });

        // 获取当前班级
        const currentRes = await fetch("/api/classes/current", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (currentRes.ok) {
          const currentData = await currentRes.json();
          const currentClassId = currentData.class?.id || "";
          // 获取 classIds 并设置默认班级
          const initRes = await fetch(`/api/quiz-activities/${quizId}/report`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (initRes.ok) {
            const initData = await initRes.json();
            const targetClassId = initData.classIds?.includes(currentClassId)
              ? currentClassId
              : (initData.classIds?.[0] || "");
            setSelectedClassId(targetClassId);
          } else {
            setSelectedClassId("");
          }
        }
      }
    } catch (e) {
      MessagePlugin.error("获取作业信息失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchReport = async () => {
    if (!selectedClassId) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("token") || "";
      const classParam = selectedClassId ? `?classId=${selectedClassId}` : "";
      const res = await fetch(`/api/quiz-activities/${quizId}/report${classParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      } else {
        MessagePlugin.error("获取统计数据失败");
      }
    } catch (e) {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const generateQuizAIAnalysis = async () => {
    if (!quizId) return;
    setGeneratingAI(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/quiz-activities/${quizId}/report/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ classId: selectedClassId || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setReportData((prev: any) => ({ ...prev, aiContent: data.content }));
        MessagePlugin.success("AI 分析生成完成");
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || "生成失败");
      }
    } catch (e) {
      MessagePlugin.error("网络错误");
    } finally {
      setGeneratingAI(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  // 获取班级选项
  const classOptions = reportData?.classIds?.map((id: string) => ({ label: `班级${id.slice(-4)}`, value: id })) || [];

  if (loading && !reportData) {
    return (
      <TeacherLayout>
        <div className="flex items-center justify-center h-64">
          <Loading text="加载中..." />
        </div>
      </TeacherLayout>
    );
  }

  return (
    <TeacherLayout>
      <div className="space-y-6 pb-8">
        {/* 顶部导航 */}
        <div className="flex items-center gap-3">
          <Button
            theme="primary"
            variant="text"
            icon={<ChevronLeftIcon />}
            onClick={() => router.push("/teacher/tasks")}
          >
            返回课堂管理
          </Button>
        </div>

        {/* 作业基本信息 */}
        {quizInfo && (
          <Card>
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-[var(--title)]">{quizInfo.title}</h2>
                  {quizInfo.description && <p className="text-sm text-[var(--muted)] mt-1">{quizInfo.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--muted)]">班级：</span>
                  <Select
                    value={selectedClassId}
                    onChange={(val) => setSelectedClassId(String(val))}
                    options={classOptions}
                    placeholder="选择班级"
                    style={{ width: 180 }}
                    size="medium"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tag theme="primary" variant="light" size="small">
                  作业统计
                </Tag>
                {reportData && (
                  <Tag theme="success" variant="light" size="small">
                    {reportData.totalStudents} 人已作答
                  </Tag>
                )}
              </div>
            </div>
          </Card>
        )}

        {reportData && (
          <>
            {/* 核心统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-[var(--card-bg)] rounded-lg p-4 border border-[var(--card-border)]">
                <div className="text-sm text-[var(--muted)] mb-1">班级平均分</div>
                <div className="text-2xl font-bold text-[var(--primary)]">{reportData.classAvgScore}</div>
                <div className="text-xs text-[var(--muted)] mt-1">总分100</div>
              </div>
              <div className="bg-[var(--card-bg)] rounded-lg p-4 border border-[var(--card-border)]">
                <div className="text-sm text-[var(--muted)] mb-1">最高分</div>
                <div className="text-2xl font-bold text-[var(--accent)]">{reportData.stats?.maxScore || 0}</div>
              </div>
              <div className="bg-[var(--card-bg)] rounded-lg p-4 border border-[var(--card-border)]">
                <div className="text-sm text-[var(--muted)] mb-1">最低分</div>
                <div className="text-2xl font-bold text-[var(--warning)]">{reportData.stats?.minScore || 0}</div>
              </div>
              <div className="bg-[var(--card-bg)] rounded-lg p-4 border border-[var(--card-border)]">
                <div className="text-sm text-[var(--muted)] mb-1">合格率</div>
                <div className="text-2xl font-bold text-[var(--success)]">{reportData.stats?.passRate || 0}%</div>
                <div className="text-xs text-[var(--muted)] mt-1">合格线{reportData.passScore ?? 60}分</div>
              </div>
              <div className="bg-[var(--card-bg)] rounded-lg p-4 border border-[var(--card-border)]">
                <div className="text-sm text-[var(--muted)] mb-1">已完成人数</div>
                <div className="text-2xl font-bold text-[var(--accent)]">{reportData.totalStudents}</div>
                <div className="text-xs text-[var(--muted)] mt-1">人已答完</div>
              </div>
            </div>

            {/* 分数段分布 */}
            {reportData.scoreBuckets && reportData.scoreBuckets.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--primary)]" />
                  <h3 className="font-medium text-[var(--foreground)]">分数段分布</h3>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={reportData.scoreBuckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: any) => [`${value}人`, "人数"] as any}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e0e0e0" }}
                    />
                    <Bar dataKey="count" fill="#0052D9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* 难度维度雷达图 */}
            {reportData.difficultyStats && reportData.difficultyStats.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--success)]" />
                  <h3 className="font-medium text-[var(--foreground)]">难度维度分析</h3>
                </div>
                <div className="flex justify-center">
                  <ResponsiveContainer width="100%" height={280}>
                    <RadarChart data={reportData.difficultyStats}>
                      <PolarGrid stroke="#e0e0e0" />
                      <PolarAngleAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Radar name="正确率" dataKey="correctRate" stroke="#0052D9" fill="#0052D9" fillOpacity={0.3} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-2 text-xs text-[var(--muted)]">
                  {reportData.difficultyStats.map((d: DifficultyStat, idx: number) => (
                    <span key={idx}>
                      {d.name}（{d.total}题，正确率{d.correctRate}%）
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {/* 各题正确率 */}
            {reportData.questionStats && reportData.questionStats.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--muted)]" />
                  <h3 className="font-medium text-[var(--foreground)]">各题正确率</h3>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(150, reportData.questionStats.length * 40)}>
                  <BarChart
                    data={reportData.questionStats.map((qs: QuestionStat, idx: number) => ({
                      index: `第${idx + 1}题`,
                      correctRate: qs.correctRate,
                      difficulty: qs.difficulty,
                    }))}
                    layout="vertical"
                    margin={{ left: 60, right: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="index" tick={{ fontSize: 11 }} width={55} />
                    <Tooltip
                      formatter={(value: any, name: any, props: any) => [
                        `${value}%（${props.payload.difficulty}）`,
                        "正确率",
                      ] as [string, string]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e0e0e0" }}
                    />
                    <Bar
                      dataKey="correctRate"
                      radius={[0, 4, 4, 0]}
                      {...({ cell: ((props: any) => {
                        const rate = props.payload.correctRate;
                        let fill = "#0052D9";
                        if (rate < 40) fill = "#E34D41";
                        else if (rate < 60) fill = "#ED7B2F";
                        else if (rate < 80) fill = "#FFC72C";
                        else fill = "#00A870";
                        return <Cell fill={fill} />;
                      }) } as any)}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* 学生排名列表 */}
            {reportData.studentScores && reportData.studentScores.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--muted)]" />
                  <h3 className="font-medium text-[var(--foreground)]">学生得分排名</h3>
                  <Tag theme="primary" size="small">{reportData.studentScores.length}人</Tag>
                </div>
                <div className="space-y-2">
                  {reportData.studentScores.map((s: StudentScore, idx: number) => (
                    <div
                      key={s.userId}
                      className={`flex items-center justify-between px-4 py-2 rounded-lg ${
                        idx < 3
                          ? idx === 0
                            ? "bg-[var(--warning-light)]"
                            : idx === 1
                            ? "bg-[var(--hover-bg)]"
                            : "bg-[var(--warning-light)]"
                          : "bg-[var(--primary-lighter)]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                            idx === 0
                              ? "bg-[var(--warning)] text-white"
                              : idx === 1
                              ? "bg-[var(--muted-light)] text-white"
                              : idx === 2
                              ? "bg-[var(--warning)] text-white"
                              : "bg-[var(--hover-bg)] text-[var(--muted)]"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="font-medium text-[var(--foreground)]">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {s.score >= 90 && <Tag theme="success" size="small">优秀</Tag>}
                        {s.score < 60 && <Tag theme="danger" size="small">不及格</Tag>}
                        <span className="text-lg font-bold text-[var(--primary)]">{s.score}</span>
                        <span className="text-xs text-[var(--muted)]">分</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 薄弱题目 */}
            {reportData.weakQuestions && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--warning)]" />
                  <h3 className="font-medium text-[var(--foreground)]">薄弱题目</h3>
                  <Tag theme="warning" size="small">正确率 &lt; 60%</Tag>
                </div>
                <div className="space-y-2 text-sm">
                  {reportData.weakQuestions.split("\n").filter(Boolean).map((wq: string, idx: number) => (
                    <div key={idx} className="px-3 py-2 bg-[var(--warning-light)] rounded-lg text-[var(--warning)]">
                      <Markdown inline>{wq}</Markdown>
                    </div>
                  ))}
                  {!reportData.weakQuestions && (
                    <p className="text-[var(--muted-light)]">暂无薄弱题目</p>
                  )}
                </div>
              </Card>
            )}

            {/* 低分学生 */}
            {reportData.lowScoreStudentsList && reportData.lowScoreStudentsList.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--danger)]" />
                  <h3 className="font-medium text-[var(--foreground)]">需要关注的学生</h3>
                  <Tag theme="danger" size="small">&lt; {reportData.passScore ?? 60}分 · {reportData.lowScoreStudentsList.length}人</Tag>
                </div>
                <div className="flex flex-wrap gap-2">
                  {reportData.lowScoreStudentsList.map((s: StudentScore) => (
                    <div key={s.userId} className="px-3 py-2 bg-[var(--danger-light)] rounded-lg flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--danger)]">{s.name}</span>
                      <span className="text-xs text-[var(--danger)]">{s.score}分</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 未完成作业的学生 */}
            {reportData.incompleteStudents && reportData.incompleteStudents.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--warning)]" />
                  <h3 className="font-medium text-[var(--foreground)]">未完成作业的学生</h3>
                  <Tag theme="warning" size="small">{reportData.incompleteStudents.length}人</Tag>
                </div>
                <div className="flex flex-wrap gap-2">
                  {reportData.incompleteStudents.map((s: any) => (
                    <div key={s.userId || s.name} className="px-3 py-2 bg-[var(--warning-light)] rounded-lg flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--warning)]">{s.name}</span>
                      <span className="text-xs text-[var(--warning)]">已答{s.answered}/{s.total}题</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 未参加作业的学生 */}
            {reportData.notAttemptedStudents && reportData.notAttemptedStudents.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[var(--muted-light)]" />
                  <h3 className="font-medium text-[var(--foreground)]">未参加作业的学生</h3>
                  <Tag theme="default" size="small">{reportData.notAttemptedStudents.length}人</Tag>
                </div>
                <div className="flex flex-wrap gap-2">
                  {reportData.notAttemptedStudents.map((s: any) => (
                    <div key={s.userId} className="px-3 py-2 bg-[var(--hover-bg)] rounded-lg flex items-center gap-2">
                      <span className="text-sm text-[var(--muted)]">{s.name}</span>
                      <span className="text-xs text-[var(--muted-light)]">未参加</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* AI 分析报告 */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ChartBarIcon className="text-[var(--accent)]" />
                  <h3 className="font-medium text-[var(--foreground)]">AI 智能分析报告</h3>
                </div>
                <Button
                  theme="primary"
                  variant="outline"
                  size="small"
                  icon={<RefreshIcon />}
                  loading={generatingAI}
                  onClick={generateQuizAIAnalysis}
                >
                  {reportData?.aiContent ? "重新分析" : "生成分析"}
                </Button>
              </div>
              {reportData?.aiContent ? (() => {
                // 清理：剥围栏 + 截取 HTML 主体（丢弃前后说明文字）；HTML 报告用 iframe 渲染
                const cleanContent = cleanInsightContent(reportData.aiContent);
                const isHtml = cleanContent.includes("<!DOCTYPE") ||
                  cleanContent.includes("<html") ||
                  (cleanContent.includes("<div") && cleanContent.includes("</div>"));
                return isHtml ? (
                  <iframe
                    srcDoc={cleanContent}
                    className="w-full border-none rounded-lg bg-[var(--card-bg)]"
                    style={{ minHeight: "400px" }}
                    sandbox="allow-scripts"
                    title="AI 学情分析报告"
                  />
                ) : (
                  <div className="bg-[var(--primary-lighter)] rounded-lg p-4 text-sm text-[var(--foreground)] whitespace-pre-line prose prose-sm prose-gray max-w-none [&_pre]:overflow-x-auto [&_code]:break-all">
                    <Markdown>{cleanContent}</Markdown>
                  </div>
                );
              })() : (
                <div className="text-center py-8 text-[var(--muted-light)]">
                  <p>点击「生成分析」按钮，AI 将基于作业数据生成智能分析报告</p>
                </div>
              )}
            </Card>
          </>
        )}

        {/* 无数据时 */}
        {!reportData && (
          <Card>
            <div className="text-center py-12">
              <ChartBarIcon className="w-12 h-12 mx-auto text-[var(--muted-light)] mb-4" />
              <p className="text-[var(--muted)]">暂无统计数据</p>
              <p className="text-sm text-[var(--muted-light)] mt-2">
                请等待学生完成作业后再查看统计
              </p>
            </div>
          </Card>
        )}
      </div>
    </TeacherLayout>
  );
}