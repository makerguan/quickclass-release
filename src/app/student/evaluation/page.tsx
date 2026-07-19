"use client";

import { useEffect, useState } from "react";
import { Card } from "tdesign-react";
import { ChartBarIcon } from "tdesign-icons-react";
import Markdown from "@/components/Markdown";
import StudentLayout from "@/components/layout/StudentLayout";

interface InsightRecord {
  id: string;
  type: string;
  content: string;
  version: number;
  createdAt: string;
  scopeId?: string;
}

export default function StudentEvaluationPage() {
  const [insights, setInsights] = useState<InsightRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEvaluations();
  }, []);

  const fetchEvaluations = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/student/insights", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setInsights(data.personalInsights || []);
      }
    } catch {
      console.error("获取评估失败");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <StudentLayout>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">我的评估</h2>
        <p className="text-gray-500 text-sm mt-1">教师生成的学习能力评估报告</p>
      </div>

      {loading ? (
        <Card>
          <div className="text-center py-8 text-gray-400">加载中...</div>
        </Card>
      ) : insights.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <ChartBarIcon className="text-gray-300" size="32px" />
            </div>
            <p className="text-gray-500 mb-2">暂无评估数据</p>
            <p className="text-sm text-gray-400">
              教师生成学情分析后将为你生成评估报告
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {insights.map((insight) => (
            <Card key={insight.id}>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-medium text-[#1A1A1A] flex items-center gap-2">
                    学习能力评估
                    <span className="text-xs bg-[#0052D9] text-white px-2 py-0.5 rounded-full">
                      第 {insight.version} 版
                    </span>
                  </h3>
                  <p className="text-xs text-[#63666F] mt-1">
                    生成时间：{formatDate(insight.createdAt)}
                  </p>
                </div>
              </div>
              <div className="bg-[#F7F8FA] p-5 rounded-lg text-sm leading-relaxed prose prose-sm prose-gray max-w-none overflow-hidden break-words [&_pre]:overflow-x-auto [&_code]:break-all">
                <Markdown>{insight.content}</Markdown>
              </div>
            </Card>
          ))}
        </div>
      )}
    </StudentLayout>
  );
}
