"use client";

import { useState, useEffect } from "react";
import { Button, MessagePlugin } from "tdesign-react";

interface ExplorationPanelProps {
  explorationId: string;
  htmlContent: string;
  enableSubmissionEnabled?: boolean;
  onBack: () => void;
}

interface SubmissionStatus {
  submissionId: string;
  score: number;
  maxScore: number;
  status: string;
  submittedAt: string;
}

export default function ExplorationPanel({
  explorationId,
  htmlContent,
  enableSubmissionEnabled,
  onBack,
}: ExplorationPanelProps) {
  const isEnabled = enableSubmissionEnabled ?? false;

  // 将 HTML 中的占位符替换为实际 explorationId
  const htmlContentFinal = htmlContent.replace(/EXPLORATION_ID_PLACEHOLDER/g, explorationId);

  const [checkingStatus, setCheckingStatus] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submissionData, setSubmissionData] = useState<SubmissionStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 监听 iframe 提交消息
  useEffect(() => {
    if (!isEnabled) {
      setCheckingStatus(false);
      return;
    }
    // 检查已有提交状态
    const token = localStorage.getItem("token");
    fetch(`/api/exploration-activities/${explorationId}/submit`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.submissionId) {
          setSubmitted(true);
          setSubmissionData(data);
        }
      })
      .catch(() => {})
      .finally(() => setCheckingStatus(false));
    // 监听 iframe 内 postMessage 提交请求
    const handleMessage = async (e: MessageEvent) => {
      if (e.data?.type === "EXPLORATION_SUBMIT") {
        const token = localStorage.getItem("token") || "";
        const response = await fetch(`/api/exploration-activities/${explorationId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(e.data.payload),
        });
        if (response.ok) {
          const result = await response.json();
          setSubmitted(true);
          setSubmissionData(result);
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [explorationId, isEnabled]);

  if (checkingStatus) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部导航 */}
      <div className="px-4 py-3 border-b border-gray-200 bg-[#FAFBFC]">
        <div className="flex items-center gap-2">
          <Button size="small" onClick={onBack}>← 返回</Button>
          <span className="text-sm font-medium text-[#1A1A1A]">互动探究</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {submitted && submissionData ? (
          // ===== 已提交：只显示提示 =====
          <div className="p-4">
            <div className="bg-green-50 rounded-lg p-6 text-center">
              <div className="text-2xl font-bold text-green-700 mb-2">✓ 已提交</div>
              <div className="text-sm text-gray-500">
                提交时间：{new Date(submissionData.submittedAt).toLocaleString()}
              </div>
            </div>
          </div>
        ) : isEnabled ? (
          // ===== 可参与：显示互动内容（包含提交按钮） =====
          <div className="p-4">
            <div className="text-sm text-gray-500 mb-2">完成互动后，点击右下角的"提交成绩"按钮提交你的结果。</div>
            <iframe
              srcDoc={htmlContentFinal}
              className="w-full rounded-lg border border-gray-200"
              style={{ height: "calc(100vh - 200px)" }}
              sandbox="allow-scripts allow-same-origin allow-forms"
              title="探究内容"
            />
          </div>
        ) : (
          // ===== 无需提交：只展示活动内容 =====
          <div className="p-4">
            <iframe
              srcDoc={htmlContentFinal}
              className="w-full rounded-lg border border-gray-200"
              style={{ height: "calc(100vh - 160px)" }}
              sandbox="allow-scripts allow-same-origin"
              title="探究内容"
            />
          </div>
        )}
      </div>
    </div>
  );
}