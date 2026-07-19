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
      <div className="max-w-6xl space-y-6 pb-8">
        {/* 顶部导航 */}
        <div className="flex items-center gap-3">
          <Button
            theme="default"
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
                  <h2 className="text-xl font-semibold text-[#1A1A1A]">{quizInfo.title}</h2>
                  {quizInfo.description && <p className="text-sm text-[#63666F] mt-1">{quizInfo.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#63666F]">班级：</span>
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
              <div className="bg-white rounded-lg p-4 border border-gray-100">
                <div className="text-sm text-[#63666F] mb-1">班级平均分</div>
                <div className="text-2xl font-bold text-[#0052D9]">{reportData.classAvgScore}</div>
                <div className="text-xs text-[#63666F] mt-1">总分100</div>
              </div>
              <div className="bg-white rounded-lg p-4 border border-gray-100">
                <div className="text-sm text-[#63666F] mb-1">最高分</div>
                <div className="text-2xl font-bold text-purple-600">{reportData.stats?.maxScore || 0}</div>
              </div>
              <div className="bg-white rounded-lg p-4 border border-gray-100">
                <div className="text-sm text-[#63666F] mb-1">最低分</div>
                <div className="text-2xl font-bold text-orange-600">{reportData.stats?.minScore || 0}</div>
              </div>
              <div className="bg-white rounded-lg p-4 border border-gray-100">
                <div className="text-sm text-[#63666F] mb-1">合格率</div>
                <div className="text-2xl font-bold text-teal-600">{reportData.stats?.passRate || 0}%</div>
                <div className="text-xs text-[#63666F] mt-1">合格线{reportData.passScore ?? 60}分</div>
              </div>
              <div className="bg-white rounded-lg p-4 border border-gray-100">
                <div className="text-sm text-[#63666F] mb-1">已完成人数</div>
                <div className="text-2xl font-bold text-indigo-600">{reportData.totalStudents}</div>
                <div className="text-xs text-[#63666F] mt-1">人已答完</div>
              </div>
            </div>

            {/* 分数段分布 */}
            {reportData.scoreBuckets && reportData.scoreBuckets.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[#0052D9]" />
                  <h3 className="font-medium text-[#1A1A1A]">分数段分布</h3>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={reportData.scoreBuckets}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: number) => [`${value}人`, "人数"] as any}
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
                  <ChartBarIcon className="text-[#00A870]" />
                  <h3 className="font-medium text-[#1A1A1A]">难度维度分析</h3>
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
                <div className="flex justify-center gap-6 mt-2 text-xs text-[#63666F]">
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
                  <ChartBarIcon className="text-[#63666F]" />
                  <h3 className="font-medium text-[#1A1A1A]">各题正确率</h3>
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
                      formatter={(value: number, name: string, props: any) => [
                        `${value}%（${props.payload.difficulty}）`,
                        "正确率",
                      ] as [string, string]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e0e0e0" }}
                    />
                    <Bar
                      dataKey="correctRate"
                      radius={[0, 4, 4, 0]}
                      cell={(props: any) => {
                        const rate = props.payload.correctRate;
                        let fill = "#0052D9";
                        if (rate < 40) fill = "#E34D41";
                        else if (rate < 60) fill = "#ED7B2F";
                        else if (rate < 80) fill = "#FFC72C";
                        else fill = "#00A870";
                        return <Cell fill={fill} />;
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* 学生排名列表 */}
            {reportData.studentScores && reportData.studentScores.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[#63666F]" />
                  <h3 className="font-medium text-[#1A1A1A]">学生得分排名</h3>
                  <Tag theme="primary" size="small">{reportData.studentScores.length}人</Tag>
                </div>
                <div className="space-y-2">
                  {reportData.studentScores.map((s: StudentScore, idx: number) => (
                    <div
                      key={s.userId}
                      className={`flex items-center justify-between px-4 py-2 rounded-lg ${
                        idx < 3
                          ? idx === 0
                            ? "bg-yellow-50"
                            : idx === 1
                            ? "bg-gray-50"
                            : "bg-orange-50"
                          : "bg-[#F7F8FA]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                            idx === 0
                              ? "bg-yellow-400 text-white"
                              : idx === 1
                              ? "bg-gray-400 text-white"
                              : idx === 2
                              ? "bg-orange-400 text-white"
                              : "bg-gray-200 text-gray-600"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="font-medium text-[#1A1A1A]">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {s.score >= 90 && <Tag theme="success" size="small">优秀</Tag>}
                        {s.score < 60 && <Tag theme="danger" size="small">不及格</Tag>}
                        <span className="text-lg font-bold text-[#0052D9]">{s.score}</span>
                        <span className="text-xs text-[#63666F]">分</span>
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
                  <ChartBarIcon className="text-[#ED7B2F]" />
                  <h3 className="font-medium text-[#1A1A1A]">薄弱题目</h3>
                  <Tag theme="warning" size="small">正确率 &lt; 60%</Tag>
                </div>
                <div className="space-y-2 text-sm">
                  {reportData.weakQuestions.split("\n").filter(Boolean).map((wq: string, idx: number) => (
                    <div key={idx} className="px-3 py-2 bg-[#FFF8F0] rounded-lg text-[#ED7B2F]">
                      {wq}
                    </div>
                  ))}
                  {!reportData.weakQuestions && (
                    <p className="text-gray-400">暂无薄弱题目</p>
                  )}
                </div>
              </Card>
            )}

            {/* 低分学生 */}
            {reportData.lowScoreStudentsList && reportData.lowScoreStudentsList.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[#E34D41]" />
                  <h3 className="font-medium text-[#1A1A1A]">需要关注的学生</h3>
                  <Tag theme="danger" size="small">&lt; {reportData.passScore ?? 60}分 · {reportData.lowScoreStudentsList.length}人</Tag>
                </div>
                <div className="flex flex-wrap gap-2">
                  {reportData.lowScoreStudentsList.map((s: StudentScore) => (
                    <div key={s.userId} className="px-3 py-2 bg-red-50 rounded-lg flex items-center gap-2">
                      <span className="text-sm font-medium text-[#E34D41]">{s.name}</span>
                      <span className="text-xs text-red-400">{s.score}分</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 未完成作业的学生 */}
            {reportData.incompleteStudents && reportData.incompleteStudents.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-[#ED7B2F]" />
                  <h3 className="font-medium text-[#1A1A1A]">未完成作业的学生</h3>
                  <Tag theme="warning" size="small">{reportData.incompleteStudents.length}人</Tag>
                </div>
                <div className="flex flex-wrap gap-2">
                  {reportData.incompleteStudents.map((s: any) => (
                    <div key={s.userId || s.name} className="px-3 py-2 bg-orange-50 rounded-lg flex items-center gap-2">
                      <span className="text-sm font-medium text-[#ED7B2F]">{s.name}</span>
                      <span className="text-xs text-orange-400">已答{s.answered}/{s.total}题</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 未参加作业的学生 */}
            {reportData.notAttemptedStudents && reportData.notAttemptedStudents.length > 0 && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <ChartBarIcon className="text-gray-400" />
                  <h3 className="font-medium text-[#1A1A1A]">未参加作业的学生</h3>
                  <Tag theme="default" size="small">{reportData.notAttemptedStudents.length}人</Tag>
                </div>
                <div className="flex flex-wrap gap-2">
                  {reportData.notAttemptedStudents.map((s: any) => (
                    <div key={s.userId} className="px-3 py-2 bg-gray-50 rounded-lg flex items-center gap-2">
                      <span className="text-sm text-gray-500">{s.name}</span>
                      <span className="text-xs text-gray-400">未参加</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* AI 分析报告 */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ChartBarIcon className="text-purple-600" />
                  <h3 className="font-medium text-[#1A1A1A]">AI 智能分析报告</h3>
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
              {reportData?.aiContent ? (
                <div className="bg-purple-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-line">
                  {reportData.aiContent}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
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
              <ChartBarIcon className="w-12 h-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">暂无统计数据</p>
              <p className="text-sm text-gray-400 mt-2">
                请等待学生完成作业后再查看统计
              </p>
            </div>
          </Card>
        )}
      </div>
    </TeacherLayout>
  );
}