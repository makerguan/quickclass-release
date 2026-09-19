"use client";

/**
 * 朗读设置的 React 绑定。
 *
 * 任意组件调用 useSpeechSettings() 都拿到**同一份**设置，并在
 * 任意一处修改后实时同步（同页面事件 + 跨标签 storage 事件）。
 */

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SPEECH_SETTINGS,
  getSpeechSettings,
  subscribeSpeechSettings,
  updateSpeechSettings,
  type SpeechSettings,
} from "./speech-settings";

export function useSpeechSettings() {
  // 首屏用默认值，挂载后立刻同步真实值（服务端渲染与客户端首次渲染保持一致）
  const [settings, setSettings] = useState<SpeechSettings>(DEFAULT_SPEECH_SETTINGS);

  useEffect(() => {
    setSettings(getSpeechSettings());
    return subscribeSpeechSettings(setSettings);
  }, []);

  const update = useCallback(
    (patch: Partial<SpeechSettings>) => setSettings(updateSpeechSettings(patch)),
    []
  );

  return { settings, update };
}
