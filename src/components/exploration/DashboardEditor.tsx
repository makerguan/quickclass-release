"use client";

import { useState } from "react";
import { Button } from "tdesign-react";
import type {
  AiDashboardChart,
  AiDashboardConfig,
  AiDashboardKpi,
  AiDashboardTheme,
} from "@/lib/prompts/dashboard-config";
import { MAX_CHARTS } from "@/lib/prompts/dashboard-config";

const inputCls =
  "h-8 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 w-full";

const CHART_TYPES: { value: AiDashboardChart["type"]; label: string }[] = [
  { value: "bar", label: "柱状图" },
  { value: "hbar", label: "条形图" },
  { value: "pie", label: "环形图" },
  { value: "line", label: "折线图" },
  { value: "list", label: "标签列表" },
  { value: "roster", label: "名单" },
  { value: "ranking", label: "排行榜" },
  { value: "wordcloud", label: "词云" },
  { value: "scatter", label: "散点图" },
];

const THEMES: { value: AiDashboardTheme; label: string }[] = [
  { value: "blue", label: "品牌蓝" },
  { value: "teal", label: "青色" },
  { value: "green", label: "绿色" },
  { value: "amber", label: "琥珀" },
];

const AGGS: { value: AiDashboardKpi["agg"]; label: string }[] = [
  { value: "count", label: "计数" },
  { value: "unique", label: "去重" },
  { value: "avg", label: "均值" },
  { value: "sum", label: "求和" },
  { value: "max", label: "最大" },
  { value: "min", label: "最小" },
];

function emptyChart(fields: string[]): AiDashboardChart {
  return { title: "", field: fields[0] || "", type: "bar" };
}

function emptyKpi(): AiDashboardKpi {
  return { label: "", field: null, agg: "count" };
}

/** 需要 limit（显示条数）的图型 */
function useLimit(t: AiDashboardChart["type"]): boolean {
  return ["bar", "hbar", "pie", "line", "list", "wordcloud"].includes(t);
}

export default function DashboardEditor({
  config,
  fields,
  onSave,
  onCancel,
}: {
  config: AiDashboardConfig;
  fields: string[];
  onSave: (config: AiDashboardConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AiDashboardConfig>(() =>
    JSON.parse(JSON.stringify(config))
  );

  const set = (patch: Partial<AiDashboardConfig>) => setDraft((d) => ({ ...d, ...patch }));

  const setChart = (i: number, patch: Partial<AiDashboardChart>) =>
    setDraft((d) => ({
      ...d,
      charts: (d.charts || []).map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));

  const setKpi = (i: number, patch: Partial<AiDashboardKpi>) =>
    setDraft((d) => ({
      ...d,
      kpis: (d.kpis || []).map((k, idx) => (idx === i ? { ...k, ...patch } : k)),
    }));

  const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  const charts = draft.charts || [];
  const kpis = draft.kpis || [];
  const gridCols = draft.gridCols || 2;

  const fieldSelect = (value: string | undefined, onChange: (v: string | undefined) => void) => (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={inputCls}
    >
      <option value="">（选择字段）</option>
      {fields.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );

  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-4 md:p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">编辑数据大屏</h3>
        <span className="text-xs text-gray-400">保存后覆盖当前大屏配置</span>
      </div>

      {/* 全局设置 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          大屏标题
          <input
            value={draft.title || ""}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="标题（可空）"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          副标题
          <input
            value={draft.subtitle || ""}
            onChange={(e) => set({ subtitle: e.target.value })}
            placeholder="副标题（可空）"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          强调色
          <select
            value={draft.theme || "blue"}
            onChange={(e) => set({ theme: e.target.value as AiDashboardTheme })}
            className={inputCls}
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          每行列数
          <select
            value={gridCols}
            onChange={(e) => {
              const n = Number(e.target.value) as 2 | 3 | 4;
              set({
                gridCols: n,
                charts: charts.map((c) => ({ ...c, span: Math.min(n, c.span || 1) as 1 | 2 | 3 | 4 })),
              });
            }}
            className={inputCls}
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} 列
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* KPI 指标 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">KPI 指标卡</span>
          <Button size="small" variant="outline" onClick={() => set({ kpis: [...kpis, emptyKpi()] })}>
            + 添加 KPI
          </Button>
        </div>
        {kpis.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">暂无 KPI</div>
        ) : (
          <div className="space-y-2">
            {kpis.map((k, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={k.label}
                  onChange={(e) => setKpi(i, { label: e.target.value })}
                  placeholder="指标名"
                  className={`${inputCls} max-w-[140px]`}
                />
                <div className="w-40">
                  {fieldSelect(k.field || undefined, (v) => setKpi(i, { field: v || null }))}
                </div>
                <select
                  value={k.agg}
                  onChange={(e) => setKpi(i, { agg: e.target.value as AiDashboardKpi["agg"] })}
                  className={`${inputCls} w-24`}
                >
                  {AGGS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => set({ kpis: kpis.filter((_, idx) => idx !== i) })}
                  className="text-xs text-red-400 hover:text-red-600 shrink-0"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 图表卡片 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">图表卡片</span>
          <Button
            size="small"
            variant="outline"
            disabled={charts.length >= MAX_CHARTS}
            title={charts.length >= MAX_CHARTS ? `最多 ${MAX_CHARTS} 张图表卡片` : undefined}
            onClick={() => set({ charts: [...charts, emptyChart(fields)] })}
          >
            + 添加图表
          </Button>
        </div>
        {charts.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">暂无图表</div>
        ) : (
          <div className="space-y-3">
            {charts.map((c, i) => (
              <div key={i} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-2">
                {/* ⚠️ GOTCHA：标题与「类型/列数/移动删除」拆成两行——原来全挤在一行，
                    标题 input 的 flex-1 会被类型下拉 + 列数下拉 + 按钮组（合计约 250px）压到几乎不可见。 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 shrink-0">#{i + 1}</span>
                  <input
                    value={c.title}
                    onChange={(e) => setChart(i, { title: e.target.value })}
                    placeholder="卡片标题"
                    className={`${inputCls} flex-1`}
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={c.type}
                    onChange={(e) => setChart(i, { type: e.target.value as AiDashboardChart["type"] })}
                    className={`${inputCls} w-28 shrink-0`}
                  >
                    {CHART_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={Math.min(c.span || 1, gridCols)}
                    onChange={(e) => setChart(i, { span: Number(e.target.value) as 1 | 2 | 3 | 4 })}
                    className={`${inputCls} w-20 shrink-0`}
                  >
                    {Array.from({ length: gridCols }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === gridCols ? `${n} 列（通栏）` : `${n} 列`}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 shrink-0 ml-auto">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => set({ charts: move(charts, i, -1) })}
                      className="px-1.5 py-0.5 text-xs border border-gray-200 rounded disabled:opacity-30"
                      title="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === charts.length - 1}
                      onClick={() => set({ charts: move(charts, i, 1) })}
                      className="px-1.5 py-0.5 text-xs border border-gray-200 rounded disabled:opacity-30"
                      title="下移"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => set({ charts: charts.filter((_, idx) => idx !== i) })}
                      className="text-xs text-red-400 hover:text-red-600 ml-1"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {c.type === "scatter" ? (
                    <>
                      <label className="flex flex-col gap-1 text-xs text-gray-500">
                        X 轴字段
                        {fieldSelect(c.xField, (v) => setChart(i, { xField: v }))}
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-gray-500">
                        Y 轴字段
                        {fieldSelect(c.yField, (v) => setChart(i, { yField: v }))}
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-gray-500">
                        悬浮标签（可选）
                        {fieldSelect(c.labelField, (v) => setChart(i, { labelField: v }))}
                      </label>
                    </>
                  ) : c.type === "ranking" ? (
                    <>
                      <label className="flex flex-col gap-1 text-xs text-gray-500">
                        排名字段
                        {fieldSelect(c.sortField || c.field, (v) =>
                          setChart(i, { sortField: v, field: v || c.field })
                        )}
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-gray-500">
                        显示字段
                        {fieldSelect(c.labelField, (v) => setChart(i, { labelField: v }))}
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-gray-500">
                        排序
                        <select
                          value={c.order || "desc"}
                          onChange={(e) => setChart(i, { order: e.target.value as "desc" | "asc" })}
                          className={inputCls}
                        >
                          <option value="desc">降序</option>
                          <option value="asc">升序</option>
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="flex flex-col gap-1 text-xs text-gray-500">
                        字段
                        {fieldSelect(c.field, (v) => setChart(i, { field: v || "" }))}
                      </label>
                      {useLimit(c.type) && (
                        <label className="flex flex-col gap-1 text-xs text-gray-500">
                          显示条数
                          <input
                            type="number"
                            min={3}
                            max={20}
                            value={c.limit || 8}
                            onChange={(e) => setChart(i, { limit: Number(e.target.value) || 8 })}
                            className={inputCls}
                          />
                        </label>
                      )}
                    </>
                  )}
                  {/* ⚠️ GOTCHA：解读占满整行（col-span-full）而非 col-span-2——ranking/scatter 有 3 个字段控件，
                      若解读只占 2 列会与字段抢行、留出空列，看起来「排列错乱」。 */}
                  <label className="flex flex-col gap-1 text-xs text-gray-500 col-span-full">
                    解读（可选）
                    <input
                      value={c.note || ""}
                      onChange={(e) => setChart(i, { note: e.target.value })}
                      placeholder="一句话解读"
                      className={inputCls}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
        <Button variant="outline" onClick={onCancel}>
          放弃
        </Button>
        <Button theme="primary" onClick={() => onSave(draft)}>
          保存
        </Button>
      </div>
    </div>
  );
}
