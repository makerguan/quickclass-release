"use client";

/**
 * 单条回答上的朗读按钮。
 *
 * 每条 AI 回答都能单独点击播报；正在朗读的那条会显示为可停止状态。
 * `owner` 由调用方给出（用消息下标即可），与 lib/speech 的朗读状态广播对齐。
 */

import { useEffect, useState } from "react";
import { MessagePlugin } from "tdesign-react";
import { PlayCircleIcon, StopCircleIcon } from "tdesign-icons-react";
import { speakSmart, stopSpeaking, subscribeSpeakingOwner } from "@/lib/speech";

interface Props {
  /** 要朗读的原文（Markdown + LaTeX） */
  text: string;
  /** 本条回答的唯一标识，用于对齐"正在朗读"状态 */
  owner: string;
  className?: string;
}

export default function SpeakButton({ text, owner, className = "" }: Props) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => subscribeSpeakingOwner((current) => setPlaying(current === owner)), [owner]);

  const disabled = !text.trim();

  const handleClick = async () => {
    if (playing) {
      stopSpeaking();
      return;
    }
    try {
      const result = await speakSmart(text, { owner });
      if (result === "fallback") {
        MessagePlugin.warning("语音服务暂不可用，已改用浏览器内置音色");
      } else if (result === "no-voice") {
        MessagePlugin.warning("当前设备没有可用的语音，请检查媒体音量或改用其他设备");
      }
    } catch {
      MessagePlugin.error("朗读失败，请稍后重试");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={playing ? "停止朗读" : "朗读这条回答"}
      aria-label={playing ? "停止朗读" : "朗读这条回答"}
      className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
        playing
          ? "text-[#0052D9] bg-[#E8F1FF]"
          : "text-[#8A8D94] hover:text-[#0052D9] hover:bg-gray-100"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}
    >
      {playing ? <StopCircleIcon size="16px" /> : <PlayCircleIcon size="16px" />}
    </button>
  );
}
