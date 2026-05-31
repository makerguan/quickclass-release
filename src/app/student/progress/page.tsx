"use client";

import { useEffect, useState } from "react";
import { Card, Statistic, Progress } from "tdesign-react";
import { CheckCircleIcon, ChatIcon, UserIcon } from "tdesign-icons-react";
import StudentLayout from "@/components/layout/StudentLayout";

export default function StudentProgressPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetchProgress();
  }, []);

  const fetchProgress = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/progress", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch {
      console.error("获取进度失败");
    }
  };

  const stats = (data?.stats as Record<string, number> | undefined) || { totalAttempts: 0, correctAttempts: 0, accuracy: 0, conversationCount: 0 };

  return (
    <StudentLayout>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">学习进度</h2>
        <p className="text-gray-500 text-sm mt-1">查看你的学习成果</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <div className="flex items-center gap-3">
            <CheckCircleIcon className="text-[#0052D9]" />
            <Statistic title="答题总数" value={stats.totalAttempts} />
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <UserIcon className="text-[#00A870]" />
            <Statistic title="正确率" value={stats.accuracy} suffix="%" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <ChatIcon className="text-[#ED7B2F]" />
            <Statistic title="对话次数" value={stats.conversationCount} />
          </div>
        </Card>
      </div>

      <Card title="知识点掌握度" className="mb-6">
        {(((data?.progress || []) as Record<string, unknown>[]).length > 0) ? (
          <div className="space-y-4">
            {((data?.progress || []) as Record<string, unknown>[]).map((p) => (
              <div key={String(p.id)}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{String(p.knowledgePoint)}</span>
                  <span>{Number(p.masteryLevel)}%</span>
                </div>
                <Progress percentage={Number(p.masteryLevel)} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">暂无学习进度数据，快去练习吧！</p>
        )}
      </Card>

      <Card title="最近答题记录">
        {(((data?.attempts || []) as Record<string, unknown>[]).length > 0) ? (
          <div className="space-y-2">
            {((data?.attempts || []) as Record<string, unknown>[]).slice(0, 10).map((a) => (
              <div key={String(a.id)} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <div className="text-sm truncate flex-1">{String((a.exercise as Record<string, unknown>)?.question || "").substring(0, 40)}...</div>
                <div className={`text-sm font-medium ${a.isCorrect ? "text-green-600" : "text-red-500"}`}>
                  {a.isCorrect ? "正确" : "错误"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">暂无答题记录</p>
        )}
      </Card>
    </StudentLayout>
  );
}
