"use client";

import { useState } from "react";
import { MessagePlugin } from "tdesign-react";
import { BrowseIcon, RefreshIcon } from "tdesign-icons-react";
import Markdown from "@/components/Markdown";

/**
 * 模板「效果预览」按钮 + 预览弹窗。
 *
 * 所有位置共用这一套：
 *  - 点击 → 调 GET /api/analysis-templates/[id]/preview
 *  - 有缓存且未过期 → 直接显示（0 成本）
 *  - 已过期 → 显示旧预览 + 「模板已修改」提示，由老师点刷新
 *  - 首次 → AI 用示例数据生成一次并把结果存库
 * 只要换了位置，直接复用本组件即可，不需要另写逻辑。
 *
 * 渲染必须与真实报告页保持一致（否则预览会"看起来不像真实效果"）：
 *  - 文本类：走项目统一的 <Markdown/>（GFM + 数学公式）+ prose 排版容器
 *  - 网页类：沙箱 iframe（sandbox="allow-scripts"，与学情报告页同一策略）
 *  - 图表：生成端已把 ```chart 数据块渲染成确定性 SVG，这里不需要也不应再解析
 */

type PreviewState = "none" | "ok" | "stale";

interface PreviewData {
  kind: "text" | "html";
  content: string;
  stale: boolean;
  truncated?: boolean;
  generatedAt?: string | null;
  missingVars?: string[];
}

interface Props {
  templateId: string;
  templateName: string;
  templateType?: string;
  /** 列表接口带下来的预览状态（避免每张卡片都发一次请求） */
  hasPreview?: boolean;
  previewStale?: boolean;
  /** 生成/刷新成功后回传状态，让卡片上的按钮颜色跟着变 */
  onStateChange?: (state: PreviewState) => void;
}

/** 模板类型 → 中文标签（弹窗头部徽章用） */
const TYPE_LABEL: Record<string, string> = {
  student: "学生个人学情",
  class: "学生全班学情",
  conversation: "对话设计",
  QUIZ_DESIGN: "作业设计",
  QUIZ_ANALYSIS: "作业分析",
  EXPLORATION_ANALYSIS: "互动探究分析",
};

export default function TemplatePreviewButton({
  templateId,
  templateName,
  templateType,
  hasPreview = false,
  previewStale = false,
  onStateChange,
}: Props) {
  const [state, setState] = useState<PreviewState>(hasPreview ? (previewStale ? "stale" : "ok") : "none");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PreviewData | null>(null);

  const applyState = (s: PreviewState) => {
    setState(s);
    onStateChange?.(s);
  };

  const load = async (force: boolean) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(`/api/analysis-templates/${templateId}/preview`, {
        method: force ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string }));
        MessagePlugin.error(err.error || "预览获取失败，请稍后重试");
        return;
      }
      const json = (await res.json()) as PreviewData;
      setData(json);
      applyState(json.stale ? "stale" : "ok");
    } catch {
      MessagePlugin.error("预览获取失败，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  };

  const open = () => {
    setVisible(true);
    if (!data) load(false);
  };

  // 颜色即状态：灰=还没生成 / 绿=已有预览 / 红=模板已改需刷新
  const tone =
    state === "ok"
      ? "text-[#2BA471] border-[#bfe4d5] bg-[#e6f5ef] hover:bg-[#d6efe5]"
      : state === "stale"
      ? "text-[#d54941] border-[#f6cdc9] bg-[#fdeeee] hover:bg-[#fbe0dd]"
      : "text-[#9aa3b2] border-[#e2e6ec] bg-[#fbfcfe] hover:bg-[#f2f4f8]";

  const tip =
    state === "ok"
      ? "已有预览，点开即看"
      : state === "stale"
      ? "模板已修改，预览为旧版，点开可刷新"
      : "还没生成预览，点一下生成（约 10 秒）";

  return (
    <>
      <button
        type="button"
        title={tip}
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
        className={`inline-flex items-center gap-1.5 text-[13px] leading-none rounded-lg border px-2.5 py-1.5 transition-colors ${tone}`}
      >
        <BrowseIcon size="15px" />
        预览
      </button>

      {visible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVisible(false);
          }}
        >
          <div className="flex max-h-[88vh] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl bg-white">
            {/* 报告头：模板名 + 类型徽章 + 生成时间 + 示例数据标记 */}
            <div className="flex items-start gap-3 border-b border-[#e5e9f0] px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-[#1f2937]">{templateName}</span>
                  {templateType && TYPE_LABEL[templateType] && (
                    <span className="shrink-0 rounded-md bg-[#eef4ff] px-2 py-0.5 text-[11px] leading-4 text-[#0052D9]">
                      {TYPE_LABEL[templateType]}
                    </span>
                  )}
                  <span className="shrink-0 rounded-md bg-[#f2f4f8] px-2 py-0.5 text-[11px] leading-4 text-[#6b7280]">
                    示例数据
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-[#6b7280]">
                  {loading && !data
                    ? "首次生成中…"
                    : data?.generatedAt
                    ? `预览生成于 ${new Date(data.generatedAt).toLocaleString("zh-CN")}`
                    : "模板效果预览"}
                </div>
              </div>
              <button
                type="button"
                className="ml-auto text-[20px] leading-none text-[#9aa3b2] hover:text-[#4b5563]"
                onClick={() => setVisible(false)}
              >
                ×
              </button>
            </div>

            {data?.stale && !loading && (
              <div className="flex flex-wrap items-center gap-2 bg-[#fdf3e6] px-5 py-2.5 text-[13px] text-[#8a4b0c]">
                模板的内容已被修改，下面展示的是<b className="font-medium">上一版</b>的效果
                <button type="button" className="ml-auto text-[#0052D9] underline" onClick={() => load(true)}>
                  刷新预览
                </button>
              </div>
            )}

            {!!data?.missingVars?.length && (
              <div className="bg-[#f5f7fa] px-5 py-2 text-[12px] text-[#6b7280]">
                模板引用了这些变量：{data.missingVars.map((v) => `{${v}}`).join("、")}
                ——示例数据里没有对应内容，预览中为占位或按上下文推断。
              </div>
            )}

            <div className="flex-1 overflow-auto bg-[#fbfcfe] p-6">
              {loading ? (
                <div className="flex h-[400px] flex-col items-center justify-center gap-3 text-[13px] text-[#6b7280]">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#dbe3ee] border-t-[#0052D9]" />
                  首次生成中，请稍候…（约 10 秒，之后看同一模板即刻打开）
                </div>
              ) : !data ? (
                <div className="py-16 text-center text-[13px] text-[#6b7280]">暂未获取到预览内容</div>
              ) : data.kind === "html" ? (
                <div className="relative">
                  <button
                    type="button"
                    className="absolute right-3 top-3 z-10 rounded-md border border-[#e5e9f0] bg-white/90 px-2.5 py-1 text-[12px] text-[#4b5563] hover:bg-white"
                    onClick={() => {
                      const w = window.open("", "_blank");
                      if (w) {
                        w.document.write(data.content);
                        w.document.close();
                        w.document.title = `${templateName} · 效果预览`;
                      }
                    }}
                  >
                    全屏查看
                  </button>
                  <iframe
                    title={`${templateName} 预览`}
                    srcDoc={data.content}
                    sandbox="allow-scripts"
                    className="h-[62vh] w-full rounded-xl border border-[#e5e9f0] bg-white"
                  />
                </div>
              ) : (
                // 文本类：走项目统一的 Markdown 渲染 + prose 排版（与真实学情报告页一致）
                <div className="rounded-xl border border-[#e5e9f0] bg-white px-7 py-6">
                  <div className="prose prose-sm prose-gray max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-all">
                    <Markdown>{data.content}</Markdown>
                  </div>
                  {data.truncated && (
                    <p className="mt-4 text-[12px] text-[#6b7280]">内容较长，预览已截断。</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-[#e5e9f0] px-5 py-3">
              <span className="text-[12px] text-[#6b7280]">以上内容由示例数据生成，不含任何真实学生数据</span>
              <button
                type="button"
                disabled={loading}
                onClick={() => load(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#e5e9f0] px-3.5 py-1.5 text-[13px] text-[#1f2937] hover:bg-[#fafbfd] disabled:opacity-50"
              >
                <RefreshIcon size="15px" />
                {loading ? "生成中…" : state === "stale" ? "刷新预览" : "重新生成"}
              </button>
              <button
                type="button"
                onClick={() => setVisible(false)}
                className="rounded-lg bg-[#0052D9] px-3.5 py-1.5 text-[13px] text-white hover:bg-[#0046b8]"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
