"use client";

/**
 * 朗读控件（开关 + 语速 + 音色），学生端所有使用朗读的地方共用。
 *
 * 「对话思考」页头与「互动探究」面板引入的都是这一个组件，
 * 配置读写统一走 lib/speech-settings，所以任意一处改动，另一处立即同步。
 */

import { Slider } from "tdesign-react";
import { SoundIcon, SoundMuteIcon } from "tdesign-icons-react";
import { MAX_VOICE_RATE, MIN_VOICE_RATE } from "@/lib/speech-settings";
import { stopSpeaking } from "@/lib/speech";
import { TTS_VOICES } from "@/lib/tts-voices";
import { useSpeechSettings } from "@/lib/use-speech-settings";

export default function SpeechControls({ className = "" }: { className?: string }) {
  const { settings, update } = useSpeechSettings();

  return (
    <div className={`flex items-center gap-3 shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => {
          const enabled = !settings.enabled;
          update({ enabled });
          if (!enabled) stopSpeaking();
        }}
        className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
          settings.enabled ? "text-[#0052D9] bg-[#E8F1FF]" : "text-[#63666F] hover:bg-gray-100"
        }`}
        title={settings.enabled ? "关闭自动朗读" : "开启自动朗读"}
        aria-label={settings.enabled ? "关闭自动朗读" : "开启自动朗读"}
      >
        {settings.enabled ? <SoundIcon size="18px" /> : <SoundMuteIcon size="18px" />}
      </button>

      <Slider
        value={settings.rate}
        onChange={(value) => update({ rate: Array.isArray(value) ? value[0] : value })}
        min={MIN_VOICE_RATE}
        max={MAX_VOICE_RATE}
        step={0.1}
        label={false}
        style={{ width: 96 }}
      />
      <span className="text-xs font-medium text-[#0052D9] tabular-nums" style={{ width: 34 }}>
        {settings.rate.toFixed(1)}x
      </span>

      <div
        className="flex items-center rounded border border-gray-200 overflow-hidden"
        role="group"
        aria-label="朗读音色"
      >
        {TTS_VOICES.map((v) => {
          const active = settings.voice === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => update({ voice: v.id })}
              title={v.hint}
              className={`px-2 py-0.5 text-xs transition-colors ${
                active
                  ? "bg-[#0052D9] text-white"
                  : "bg-white text-[#63666F] hover:bg-gray-50"
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
