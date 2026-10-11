"use client";

import { useState, useEffect, useRef } from "react";
import { Button, MessagePlugin } from "tdesign-react";
import { Robot2FilledIcon } from "tdesign-icons-react";
import SpeechControls from "@/components/speech/SpeechControls";
import { stopSpeaking } from "@/lib/speech";

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

  // 朗读的开关 / 音色 / 语速统一由 lib/speech-settings 管理（见 SpeechControls 组件）。
  // AI 伴学对话的朗读由 iframe 内的组件自己负责（每条回答右下角的播放按钮），
  // 这里不再代为播报，避免两个声音叠在一起。

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
        // 校验消息来源为当前 iframe，防止其它窗口伪造提交
        if (e.source !== iframeRef.current?.contentWindow) return;
        const token = localStorage.getItem("token") || "";
        try {
          const response = await fetch(`/api/exploration-activities/${explorationId}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(e.data.payload),
          });
          if (response.ok) {
            const result = await response.json();
            setSubmitted(true);
            setSubmissionData(result);
          } else {
            MessagePlugin.error(`提交失败（${response.status}），请重试`);
          }
        } catch {
          MessagePlugin.error("提交失败，请检查网络后重试");
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [explorationId, isEnabled]);

  // 切换探究活动时停掉上一段朗读
  useEffect(() => {
    stopSpeaking();
  }, [explorationId]);

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
      // 校验消息来源为当前 iframe，防止多实例/异常消息串台
      if (e.source !== null && e.source !== iframeRef.current?.contentWindow) return;
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

        // 朗读由 iframe 内组件在收到 DONE 后自行处理（含自动朗读与逐条点播）
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
            <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded inline-flex items-center gap-1">
              <Robot2FilledIcon size="14px" className="text-orange-500" />
              AI伴学已开启
            </span>
          )}
          <div className="flex-1" />
          {aiCompanionOn && <SpeechControls />}
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
            {/* ⛔ DO NOT REVERT: iframe sandbox 必须包含 allow-popups，否则内部 <a target="_blank"> / window.open 会被浏览器静默拦截。
                原因：探究 HTML 由教师/AI 生成，常嵌入外部资源链接，学生点击需弹出新标签页。
                关联：src/app/teacher/tasks/[taskId]/exploration/[explorationId]/page.tsx 的预览 iframe 同理，若未来也支持外部链接需同步。
                测试：修改后可用带 target="_blank" 的探究内容验证点击能否打开新标签页。 */}
            <iframe
              ref={iframeRef}
              srcDoc={htmlContentFinal}
              className="w-full rounded-lg border border-gray-200"
              style={{ height: "calc(100vh - 200px)" }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-autoplay allow-popups allow-popups-to-escape-sandbox"
              title="探究内容"
            />
          </div>
        ) : (
          // ===== 无需提交：只展示活动内容 =====
          <div className="p-4">
            {/* ⛔ DO NOT REVERT: 同上方可提交态 iframe，探究内容中外部链接需弹出新标签页，sandbox 必须带 allow-popups。 */}
            <iframe
              ref={iframeRef}
              srcDoc={htmlContentFinal}
              className="w-full rounded-lg border border-gray-200"
              style={{ height: "calc(100vh - 160px)" }}
              sandbox="allow-scripts allow-same-origin allow-autoplay allow-popups allow-popups-to-escape-sandbox"
              title="探究内容"
            />
          </div>
        )}
      </div>
    </div>
  );
}