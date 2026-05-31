"use client";

import { useState, useCallback } from "react";

export interface PromptPreviewOptions {
  forcePreview?: boolean; // 是否强制预览（跳过直接执行）
}

export interface PromptPreviewResult {
  promptPreviewLoading: boolean;
  promptPreviewContent: string;
  promptPreviewVisible: boolean;
  pendingPreviewAction: (() => Promise<void>) | null;
  setPromptPreviewVisible: (visible: boolean) => void;
  withPromptPreview: (
    buildPreviewParams: () => { endpoint: string; body: object } | null,
    executeAction: () => Promise<void>,
    options?: PromptPreviewOptions
  ) => Promise<void>;
}

export function usePromptPreview(): PromptPreviewResult {
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false);
  const [promptPreviewContent, setPromptPreviewContent] = useState("");
  const [promptPreviewVisible, setPromptPreviewVisible] = useState(false);
  const [pendingPreviewAction, setPendingPreviewAction] = useState<(() => Promise<void>) | null>(null);

  const withPromptPreview = useCallback(
    async (
      buildPreviewParams: () => { endpoint: string; body: object } | null,
      executeAction: () => Promise<void>,
      options: PromptPreviewOptions = {}
    ) => {
      const params = buildPreviewParams();
      if (!params) return;

      // 非强制预览模式：直接执行，跳过预览确认对话框
      if (!options.forcePreview) {
        await executeAction();
        return;
      }

      // 强制预览模式：显示预览对话框让用户确认后再执行
      setPromptPreviewLoading(true);
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(params.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...params.body, previewOnly: true }),
        });
        if (res.ok) {
          const data = await res.json();
          setPromptPreviewContent(data.prompt);
          setPendingPreviewAction(() => executeAction);
          setPromptPreviewVisible(true);
        } else {
          await executeAction();
        }
      } catch {
        await executeAction();
      } finally {
        setPromptPreviewLoading(false);
      }
    },
    []
  );

  return {
    promptPreviewLoading,
    promptPreviewContent,
    promptPreviewVisible,
    pendingPreviewAction,
    setPromptPreviewVisible,
    withPromptPreview,
  };
}