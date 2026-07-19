"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "tdesign-react";

interface ExplorationPanelProps {
  explorationId: string;
  htmlContent: string;
  enableSubmissionEnabled?: boolean;
  enableAiCompanion?: boolean;
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
  enableAiCompanion,
  onBack,
}: ExplorationPanelProps) {
  const isEnabled = enableSubmissionEnabled ?? false;
  const aiCompanionOn = enableAiCompanion ?? false;

  // 将 HTML 中的占位符替换为实际 explorationId
  // 同时清理可能被markdown代码块包裹的HTML（```html...```）
  let cleanedHtml = htmlContent.replace(/EXPLORATION_ID_PLACEHOLDER/g, explorationId);
  cleanedHtml = cleanedHtml
    .replace(/^\s*```(?:html|HTML)?\s*\n/i, "")
    .replace(/\n\s*```\s*$/i, "")
    .trim();
  const htmlContentFinal = cleanedHtml;

  const [checkingStatus, setCheckingStatus] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submissionData, setSubmissionData] = useState<SubmissionStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // 监听 AI 伴学消息
  useEffect(() => {
    if (!aiCompanionOn) return;

    const targetOrigin = "*"; // iframe 内容是同源注入，使用 *
    // 不在 useEffect 内闭包捕获 iframe 引用，避免 React 渲染时序导致 ref.current 为 null 的问题
    // 每次发送消息时动态读取最新的 iframeRef.current
    const postToIframe = (msg: any) => {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.postMessage(msg, targetOrigin);
      } else {
        console.warn("[AI-COMPANION] iframe not ready, drop message:", msg?.type);
      }
    };

    const handleAiCompanionMessage = async (e: MessageEvent) => {
      if (!e.data?.type) return;
      const token = localStorage.getItem("token") || "";

      // iframe通知：已就绪，请求历史消息
      if (e.data.type === "AI_COMPANION_READY") {
        try {
          const res = await fetch(
            `/api/exploration-activities/${explorationId}/ai-chat/history`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.ok) {
            const data = await res.json();
            postToIframe({ type: "AI_COMPANION_HISTORY", messages: data.messages || [] });
          }
        } catch {}
        return;
      }

      // iframe通知：清空对话
      if (e.data.type === "AI_COMPANION_CLEAR") {
        try {
          const res = await fetch(
            `/api/exploration-activities/${explorationId}/ai-chat/history`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (res.ok) {
            postToIframe({ type: "AI_COMPANION_CLEARED" });
          }
        } catch {}
        return;
      }

      // iframe通知：学生提问
      if (e.data.type !== "AI_COMPANION_ASK") return;

      try {
        const res = await fetch(`/api/exploration-activities/${explorationId}/ai-chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: e.data.message,
            chatHistory: e.data.chatHistory,
            context: e.data.context,
          }),
        });

        if (!res.ok) {
          postToIframe({ type: "AI_COMPANION_ERROR", error: "请求失败" });
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            postToIframe({ type: "AI_COMPANION_CHUNK", chunk });
          }
        }

        postToIframe({ type: "AI_COMPANION_DONE" });
      } catch (error) {
        postToIframe({
          type: "AI_COMPANION_ERROR",
          error: error instanceof Error ? error.message : "未知错误",
        });
      }
    };

    window.addEventListener("message", handleAiCompanionMessage);
    return () => {
      window.removeEventListener("message", handleAiCompanionMessage);
    };
  }, [explorationId, aiCompanionOn]);

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
          {aiCompanionOn && (
            <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
              🤖 AI伴学已开启
            </span>
          )}
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
              ref={iframeRef}
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
              ref={iframeRef}
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