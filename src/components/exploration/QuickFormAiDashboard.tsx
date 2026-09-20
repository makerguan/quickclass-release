"use client";

/**
 * QuickFormAiDashboard —— 「AI 重排」后的数据大屏渲染器（v4：白底统一风 + recharts）。
 *
 * 与默认大屏（QuickFormDashboard）的区别：
 *   默认大屏 = 前端按字段形状**自动**决定画什么；
 *   本组件   = 按 AI 产出的**设计配置**决定画什么（选字段、选图型、排主视觉、选强调色）。
 *
 * ⚠️ 安全红线：AI 只输出**配置 JSON**（强调色只能从白名单里选，颜色一律由渲染器给出），
 *    本组件据配置自行计算并渲染图表。**绝不**让 AI 产出 HTML / 脚本 / 自由样式再渲染 ——
 *    数据源是学生自由输入，那是存储型 XSS。配置里的文案走 React 文本节点渲染，天然转义。
 *
 * v4 变更（2026-09-20，cc 定调）：
 *   - 弃用 6 套深色主题（与站点风格不搭），改为**白底统一基调 + 强调色白名单**（blue/teal/green/amber）；
 *   - 图表引擎切换为 recharts（与默认大屏共用 DashboardCharts），柱/条/饼/折线为真图表；
 *   - 布局为关键：KPI 统计卡行 + 白卡片栅格 + 主视觉双栏（span=2）；
 *   - 旧配置（aurora 等旧主题名）自动落回默认蓝，无需迁移。
 */

import { useMemo } from "react";
import {
  DEFAULT_THEME,
  type AiDashboardChart,
  type AiDashboardConfig,
} from "@/lib/prompts/dashboard-config";
import { ChartBar, ChartHBar, ChartLine, ChartPie, PIE_PALETTE, type Entry } from "./DashboardCharts";
import type { QfRecordItem } from "./QuickFormDashboard";

interface Props {
  records: QfRecordItem[];
  total: number;
  config: AiDashboardConfig;
}

/* ------------------------------ 强调色白名单 ------------------------------ */

const ACCENTS: Record<string, string> = {
  blue: "#0052D9",
  teal: "#0891B2",
  green: "#00A870",
  amber: "#F59E0B",
};

function accentColor(theme: string | undefined): string {
  return ACCENTS[theme || ""] || ACCENTS[DEFAULT_THEME] || ACCENTS.blue;
}

/* ------------------------------ 小工具（纯逻辑，勿动） ------------------------------ */

function isNumericValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n);
  }
  return false;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** 收集每个字段的非空取值（多选字段会被摊平用于计数） */
function collectValues(records: QfRecordItem[]): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>();
  for (const r of records) {
    const data = r.data || {};
    for (const [k, v] of Object.entries(data)) {
      if (!k || k.startsWith("_")) continue;
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(v);
    }
  }
  return map;
}

/** 计数降序 */
function counter(values: unknown[], limit: number): Entry[] {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = String(v);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** 数值分桶：取值少（≤10 种）按原值，否则等宽 6 箱 */
function numericBuckets(nums: number[], uniqueCount: number): Entry[] {
  if (uniqueCount <= 10) {
    const m = new Map<number, number>();
    for (const n of nums) m.set(n, (m.get(n) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => [fmtNum(v), c]);
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return [[fmtNum(min), nums.length]];
  const bins = 6;
  const width = (max - min) / bins;
  const buckets = new Array<number>(bins).fill(0);
  for (const n of nums) {
    let i = Math.floor((n - min) / width);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    buckets[i]++;
  }
  return buckets.map((c, i) => [`${fmtNum(min + i * width)}–${fmtNum(min + (i + 1) * width)}`, c]);
}

/** 解析某字段在本次渲染下的分组数据 */
function entriesForField(values: unknown[], limit: number): Entry[] {
  if (values.length === 0) return [];
  if (values.every((v) => Array.isArray(v))) {
    return counter(values.flat(), limit);
  }
  if (values.every(isNumericValue)) {
    const nums = values.map((v) => Number(v));
    // 数值分桶最多 6 箱（去重 ≤10 时按原值，最多 10 列），不做 limit 截断以免丢数据
    return numericBuckets(nums, new Set(nums.map((v) => String(v))).size);
  }
  return counter(values, limit);
}

/** 计算 KPI 数值（count 已在调用方按 total 处理，这里只算字段维度） */
function kpiValue(agg: string, values: unknown[]): string {
  if (agg === "count") return String(values.length);
  const nums = values.filter(isNumericValue).map((v) => Number(v));
  switch (agg) {
    case "unique":
      return String(new Set(values.map((v) => String(v))).size);
    case "avg":
      return nums.length ? fmtNum(nums.reduce((a, b) => a + b, 0) / nums.length) : "—";
    case "sum":
      return nums.length ? fmtNum(nums.reduce((a, b) => a + b, 0)) : "—";
    case "max":
      return nums.length ? fmtNum(Math.max(...nums)) : "—";
    case "min":
      return nums.length ? fmtNum(Math.min(...nums)) : "—";
    default:
      return String(values.length);
  }
}

/* ------------------------------ 主题化外壳（白底统一） ------------------------------ */

function Card({
  color,
  hero,
  title,
  meta,
  note,
  children,
}: {
  color: string;
  hero: boolean;
  title: string;
  meta?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border bg-white shadow-sm hover:shadow-md transition-shadow p-5 h-full"
      style={{ borderColor: hero ? `${color}55` : "#f0f2f6" }}
    >
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-sm font-semibold text-gray-800 truncate" title={title}>
            {title}
          </span>
        </span>
        {meta && <span className="text-[11px] text-gray-400 shrink-0">{meta}</span>}
      </div>
      {children}
      {note && <div className="text-[11px] text-gray-400 mt-3 leading-relaxed">{note}</div>}
    </div>
  );
}

/* ------------------------------ 图形 ------------------------------ */

function ColumnChart({ entries, color }: { entries: Entry[]; color: string }) {
  return <ChartBar entries={entries} color={color} />;
}

function BarList({ entries, color }: { entries: Entry[]; color: string }) {
  return <ChartHBar entries={entries} color={color} />;
}

function PieChartView({ entries }: { entries: Entry[] }) {
  return <ChartPie entries={entries} />;
}

function LineView({ entries, color }: { entries: Entry[]; color: string }) {
  return <ChartLine entries={entries} color={color} />;
}

function NameRoster({ names }: { names: string[] }) {
  const LIMIT = 60;
  const shown = names.slice(0, LIMIT);
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        {shown.map((n, i) => (
          <div key={`${n}-${i}`} className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 text-[11px] text-gray-300 text-right shrink-0">{i + 1}</span>
            <span className="text-[13px] text-gray-700 truncate" title={n}>
              {n}
            </span>
          </div>
        ))}
      </div>
      {names.length > LIMIT && (
        <div className="text-[11px] text-gray-400 mt-3">还有 {names.length - LIMIT} 人未显示</div>
      )}
    </div>
  );
}

function TagList({ entries, color }: { entries: Entry[]; color: string }) {
  const max = entries[0]?.[1] || 1;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([label, count]) => {
        const weight = count / max;
        return (
          <div
            key={label}
            className="rounded-full px-3 py-1 text-xs border"
            style={{
              background: `${color}${weight > 0.66 ? "1f" : weight > 0.33 ? "12" : "08"}`,
              borderColor: `${color}33`,
            }}
          >
            <span className="text-gray-700">{label}</span>
            <span className="ml-1.5 font-semibold" style={{ color }}>
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ 图表分发 ------------------------------ */

function ChartBody({
  chart,
  values,
  color,
}: {
  chart: AiDashboardChart;
  values: unknown[];
  color: string;
}) {
  const limit = chart.limit ?? 8;

  if (chart.type === "roster") {
    const names = values.map((v) => String(v));
    if (names.length === 0) return null;
    return <NameRoster names={names} />;
  }

  const entries = entriesForField(values, chart.type === "list" ? limit : Math.max(limit, 6));
  if (entries.length === 0) return null;

  switch (chart.type) {
    case "line":
      return <LineView entries={entries} color={color} />;
    case "hbar":
      return <BarList entries={entries} color={color} />;
    case "pie":
      return <PieChartView entries={entries} />;
    case "list":
      return <TagList entries={entries} color={color} />;
    case "bar":
    default:
      return <ColumnChart entries={entries} color={color} />;
  }
}

/* ------------------------------ 主组件 ------------------------------ */

export default function QuickFormAiDashboard({ records, total, config }: Props) {
  const accent = accentColor(config.theme);
  const fieldValues = useMemo(() => collectValues(records), [records]);

  const kpis = (config.kpis || []).map((k) => {
    const values = k.field ? fieldValues.get(k.field) || [] : [];
    const shown = k.agg === "count" && !k.field ? String(total) : kpiValue(k.agg, values);
    return { label: k.label, value: shown };
  });

  const charts = (config.charts || [])
    .map((c) => ({ chart: c, values: fieldValues.get(c.field) || [] }))
    .filter((x) => x.values.length > 0);

  const rosterCount = (() => {
    const roster = (config.charts || []).find((c) => c.type === "roster");
    if (!roster) return null;
    return (fieldValues.get(roster.field) || []).length;
  })();

  return (
    <div className="rounded-2xl bg-[#f7f9fc] border border-gray-100 p-4 md:p-5 space-y-4">
      {/* 标题栏（白卡，克制） */}
      {(config.title || config.subtitle) && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900 tracking-wide truncate">
              {config.title || "数据大屏"}
            </div>
            {config.subtitle && (
              <div className="text-xs text-gray-400 mt-1 truncate">{config.subtitle}</div>
            )}
          </div>
          <span
            className="shrink-0 text-[10px] rounded-full px-2.5 py-1 font-medium"
            style={{ background: `${accent}14`, color: accent }}
          >
            AI 设计
          </span>
        </div>
      )}

      {/* KPI 统计卡行（浅色大数字） */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((k, i) => (
            <div
              key={`${k.label}-${i}`}
              className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-4 min-w-0"
            >
              <div className="text-xs text-gray-400 truncate" title={k.label}>
                {k.label}
              </div>
              <div className="text-3xl font-bold text-gray-900 mt-1.5 truncate" title={k.value}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 图表栅格（白卡片 + 主视觉双栏） */}
      {charts.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {charts.map(({ chart, values }, i) => {
            const hero = chart.span === 2;
            const color = chart.type === "pie" ? PIE_PALETTE[0] : accent;
            return (
              <div
                key={`${chart.field}-${chart.type}-${i}`}
                className={hero || chart.type === "roster" ? "xl:col-span-2" : ""}
              >
                <Card
                  color={chart.type === "pie" ? PIE_PALETTE[i % PIE_PALETTE.length] : color}
                  hero={hero}
                  title={chart.title || chart.field}
                  meta={chart.type === "roster" ? `名单 · 共 ${rosterCount ?? values.length} 人` : undefined}
                  note={chart.note}
                >
                  <ChartBody chart={chart} values={values} color={color} />
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-6 text-center text-sm text-gray-400">
          AI 配置里没有可渲染的图表，可点「恢复默认大屏」。
        </div>
      )}
    </div>
  );
}
