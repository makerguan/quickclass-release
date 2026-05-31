"use client";

import { useEffect, useState } from "react";
import { Card, Button } from "tdesign-react";
import { ChartBarIcon } from "tdesign-icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import StudentLayout from "@/components/layout/StudentLayout";

interface InsightRecord {
  id: string;
  type: string;
  content: string;
  version: number;
  createdAt: string;
}

interface InsightsData {
  personalInsights: InsightRecord[];
  classInsight: InsightRecord | null;
}

export default function StudentInsightsPage() {
  const [data, setData] = useState<InsightsData>({ personalInsights: [], classInsight: null });
  const [loading, setLoading] = useState(true);
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => {
    fetchInsights();
  }, []);

  const fetchInsights = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/student/insights", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch {
      console.error("获取学习分析失败");
    } finally {
      setLoading(false);
    }
  };

  const latestInsight = data.personalInsights[0]; // 最新版本
  const previousInsight = data.personalInsights[1]; // 上一个版本

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <StudentLayout>
      <div className="space-y-6 max-w-4xl">
        {/* 页面标题 */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0052D9] to-[#00A870] flex items-center justify-center">
            <ChartBarIcon className="text-white" size="20px" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">我的学习分析</h2>
            <p className="text-sm text-[#63666F]">AI 基于你的对话记录和学习数据生成的个性化分析</p>
          </div>
        </div>

        {loading ? (
          <Card>
            <div className="text-center py-8 text-gray-400">加载中...</div>
          </Card>
        ) : !latestInsight ? (
          <Card>
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <ChartBarIcon className="text-gray-300" size="32px" />
              </div>
              <p className="text-gray-500 mb-2">暂无学习分析</p>
              <p className="text-sm text-gray-400">
                与 AI 进行更多对话后，教师将为你生成个性化的学习分析报告
              </p>
            </div>
          </Card>
        ) : (
          <>
            {/* 最新分析 */}
            <Card>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-medium text-[#1A1A1A] flex items-center gap-2">
                    最新学习分析
                    <span className="text-xs bg-[#0052D9] text-white px-2 py-0.5 rounded-full">
                      第 {latestInsight.version} 版
                    </span>
                  </h3>
                  <p className="text-xs text-[#63666F] mt-1">
                    生成时间：{formatDate(latestInsight.createdAt)}
                  </p>
                </div>
                {previousInsight && (
                  <Button
                    theme={showComparison ? "primary" : "default"}
                    variant="outline"
                    size="small"
                    onClick={() => setShowComparison(!showComparison)}
                  >
                    {showComparison ? "隐藏对比" : "与上次对比"}
                  </Button>
                )}
              </div>
              <div className="bg-[#F7F8FA] p-5 rounded-lg text-sm leading-relaxed prose prose-sm prose-gray max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{latestInsight.content}</ReactMarkdown>
              </div>
            </Card>

            {/* 对比：上一次分析 */}
            {showComparison && previousInsight && (
              <Card>
                <div className="mb-4">
                  <h3 className="font-medium text-[#1A1A1A] flex items-center gap-2">
                    上次学习分析
                    <span className="text-xs bg-gray-400 text-white px-2 py-0.5 rounded-full">
                      第 {previousInsight.version} 版
                    </span>
                  </h3>
                  <p className="text-xs text-[#63666F] mt-1">
                    生成时间：{formatDate(previousInsight.createdAt)}
                  </p>
                </div>
                <div className="bg-[#FFF8F0] p-5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap border border-[#ED7B2F]/20 break-words">
                  {previousInsight.content}
                </div>
              </Card>
            )}

            {/* 班级学情总览 */}
            {data.classInsight && (
              <Card>
                <div className="mb-4">
                  <h3 className="font-medium text-[#1A1A1A]">班级学情总览</h3>
                  <p className="text-xs text-[#63666F] mt-1">
                    教师对全班同学的学习分析（第 {data.classInsight.version} 版）
                  </p>
                </div>
                <div className="bg-[#F0F7FF] p-5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap border border-[#0052D9]/10 break-words">
                  {data.classInsight.content}
                </div>
              </Card>
            )}

            {/* 历史分析记录 */}
            {data.personalInsights.length > 1 && (
              <Card>
                <h3 className="font-medium text-[#1A1A1A] mb-3">历史分析记录</h3>
                <div className="space-y-2">
                  {data.personalInsights.map((insight, idx) => (
                    <div
                      key={insight.id}
                      className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                          V{insight.version}
                        </span>
                        <span className="text-sm text-[#63666F]">
                          {formatDate(insight.createdAt)}
                        </span>
                      </div>
                      {idx === 0 && (
                        <span className="text-xs text-[#00A870] font-medium">当前版本</span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </StudentLayout>
  );
}
