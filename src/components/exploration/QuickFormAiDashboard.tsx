"use client";

/**
 * QuickFormAiDashboard —— 「AI 重排」后的数据大屏渲染器。
 *
 * 与默认大屏（QuickFormDashboard）的区别：
 *   默认大屏 = 前端按字段形状**自动**决定画什么；
 *   本组件   = 按 AI 产出的**图表配置**决定画什么（选字段、选图型、写标题与解读）。
 *
 * ⚠️ 安全红线：AI 只输出**配置 JSON**，本组件据配置自行计算并渲染图表。
 *    **绝不**让 AI 产出 HTML / 脚本 / 样式再渲染 —— 数据源是学生自由输入，那是存储型 XSS。
 *    配置里的文案（title/subtitle/note）走 React 文本节点渲染，天然转义。
 */

import { useMemo, type ReactNode } from "react";
import type { AiDashboardChart, AiDashboardConfig } from "@/lib/prompts/dashboard-config";
import type { QfRecordItem } from "./QuickFormDashboard";

interface Props {
  records: QfRecordItem[];
  total: number;
  config: AiDashboardConfig;
}

/* ------------------------------ 小工具 ------------------------------ */

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

type Entry = [string, number];

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

/* ------------------------------ 通用外壳 ------------------------------ */

function Card({
  title,
  meta,
  note,
  children,
}: {
  title: string;
  meta?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-medium text-gray-700 truncate" title={title}>
          {title}
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
  const max = entries.reduce((m, [, c]) => Math.max(m, c), 1);
  return (
    <div>
      <div className="flex items-end gap-1.5 h-28 border-b border-gray-100">
        {entries.map(([label, count], i) => (
          <div
            key={`${label}-${i}`}
            className="flex-1 flex flex-col items-center justify-end h-full"
            title={`${label} · ${count}`}
          >
            <span className="text-[10px] text-gray-500 mb-0.5">{count}</span>
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${Math.max((count / max) * 100, count > 0 ? 4 : 1)}%`,
                background: color,
                opacity: 0.55 + 0.45 * (count / max),
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {entries.map(([label], i) => (
          <span
            key={`${label}-lab-${i}`}
            className="flex-1 text-[10px] text-gray-400 text-center truncate"
            title={label}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function LineChart({ entries, color }: { entries: Entry[]; color: string }) {
  const W = 320;
  const H = 112;
  const max = entries.reduce((m, [, c]) => Math.max(m, c), 1);
  const step = entries.length > 1 ? W / (entries.length - 1) : 0;
  const pts = entries.map(([, c], i) => [i * step, H - (c / max) * (H - 12)] as [number, number]);
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${poly} ${W},${H}`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
        <polygon points={area} fill={color} opacity="0.12" />
        <polyline points={poly} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" fill="#fff" stroke={color} strokeWidth="1.5" />
        ))}
      </svg>
      <div className="flex gap-1.5 mt-1">
        {entries.map(([label], i) => (
          <span
            key={`${label}-lab-${i}`}
            className="flex-1 text-[10px] text-gray-400 text-center truncate"
            title={label}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function BarList({ entries, color }: { entries: Entry[]; color: string }) {
  const max = entries[0]?.[1] || 1;
  const base = entries.reduce((s, [, c]) => s + c, 0);
  return (
    <div className="space-y-2">
      {entries.map(([label, count]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-20 text-xs text-gray-500 truncate text-right shrink-0" title={label}>
            {label}
          </span>
          <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
            <div
              className="h-4 rounded-full transition-all"
              style={{ width: `${(count / max) * 100}%`, background: color }}
            />
          </div>
          <span className="w-16 text-[11px] text-gray-500 shrink-0 text-right">
            {count}
            <span className="text-gray-300"> {base > 0 ? `${Math.round((count / base) * 100)}%` : ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const PIE_COLORS = ["#0052D9", "#00A870", "#ED7B2F", "#7c5cff", "#D54941", "#F2C55C", "#0E9BC0", "#8B9FB3"];

function PieChart({ entries }: { entries: Entry[] }) {
  const total = entries.reduce((s, [, c]) => s + c, 0) || 1;
  const R = 46;
  const r = 28;
  const cx = 56;
  const cy = 56;
  let angle = -Math.PI / 2;

  const slices = entries.map(([label, count], i) => {
    const frac = count / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + R * Math.cos(a0);
    const y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    const xi1 = cx + r * Math.cos(a1);
    const yi1 = cy + r * Math.sin(a1);
    const xi0 = cx + r * Math.cos(a0);
    const yi0 = cy + r * Math.sin(a0);
    const d = [
      `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
      `A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `L ${xi1.toFixed(2)} ${yi1.toFixed(2)}`,
      `A ${r} ${r} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)}`,
      "Z",
    ].join(" ");
    return { label, count, d, color: PIE_COLORS[i % PIE_COLORS.length] };
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 112 112" className="w-28 h-28 shrink-0">
        {slices.map((s) => (
          <path key={s.label} d={s.d} fill={s.color} />
        ))}
        <circle cx={cx} cy={cy} r={r - 0.5} fill="#fff" />
      </svg>
      <div className="flex-1 space-y-1.5 min-w-0">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-gray-600 truncate" title={s.label}>
              {s.label}
            </span>
            <span className="ml-auto text-gray-400 shrink-0">
              {s.count} · {Math.round((s.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NameRoster({ names }: { names: string[] }) {
  const LIMIT = 60;
  const shown = names.slice(0, LIMIT);
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-2">
        {shown.map((n, i) => (
          <div key={`${n}-${i}`} className="flex items-center gap-2 min-w-0">
            <span className="w-5 h-5 shrink-0 rounded-full bg-blue-50 text-blue-600 text-[11px] flex items-center justify-center">
              {i + 1}
            </span>
            <span className="text-[13px] text-gray-700 truncate" title={n}>
              {n}
            </span>
          </div>
        ))}
      </div>
      {names.length > LIMIT && (
        <div className="text-[11px] text-gray-400 mt-2">还有 {names.length - LIMIT} 人未显示</div>
      )}
    </div>
  );
}

function TagList({ entries }: { entries: Entry[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([label, count]) => (
        <div key={label} className="bg-gray-50 rounded-full px-3 py-1 text-xs border border-gray-100">
          <span className="text-gray-700">{label}</span>
          <span className="ml-1.5 text-gray-400">{count}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ 图表分发 ------------------------------ */

const CHART_COLOR: Record<string, string> = {
  bar: "#378ADD",
  line: "#00A870",
  hbar: "#0052D9",
  pie: "#0052D9",
  list: "#7c5cff",
};

function ChartBody({ chart, values }: { chart: AiDashboardChart; values: unknown[] }) {
  const limit = chart.limit ?? 8;

  if (chart.type === "roster") {
    const names = values.map((v) => String(v));
    if (names.length === 0) return null;
    return <NameRoster names={names} />;
  }

  const entries = entriesForField(values, chart.type === "list" ? limit : Math.max(limit, 6));
  if (entries.length === 0) return null;

  const color = CHART_COLOR[chart.type] || "#0052D9";
  switch (chart.type) {
    case "line":
      return <LineChart entries={entries} color={color} />;
    case "hbar":
      return <BarList entries={entries} color={color} />;
    case "pie":
      return <PieChart entries={entries} />;
    case "list":
      return <TagList entries={entries} />;
    case "bar":
    default:
      return <ColumnChart entries={entries} color={color} />;
  }
}

/* ------------------------------ 主组件 ------------------------------ */

export default function QuickFormAiDashboard({ records, total, config }: Props) {
  const fieldValues = useMemo(() => collectValues(records), [records]);

  const kpis = (config.kpis || []).map((k) => {
    const values = k.field ? fieldValues.get(k.field) || [] : [];
    const shown = k.agg === "count" && !k.field ? String(total) : kpiValue(k.agg, values);
    return { label: k.label, value: shown, field: k.field };
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
    <div className="space-y-4">
      {/* 标题条 */}
      {(config.title || config.subtitle) && (
        <div className="rounded-xl bg-gradient-to-r from-blue-50 to-white border border-blue-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-800">
              {config.title || "数据大屏"}
            </span>
            <span className="text-[10px] rounded-full bg-blue-600 text-white px-2 py-0.5">AI 重排</span>
          </div>
          {config.subtitle && (
            <div className="text-xs text-gray-500 mt-0.5">{config.subtitle}</div>
          )}
        </div>
      )}

      {/* KPI 条 */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k, i) => (
            <div key={`${k.label}-${i}`} className="rounded-xl border border-gray-100 bg-white shadow-sm px-4 py-3">
              <div className="text-[11px] text-gray-400 truncate" title={k.label}>
                {k.label}
              </div>
              <div
                className={`text-2xl font-bold mt-0.5 truncate ${
                  i === 0 ? "text-[#0052D9]" : "text-gray-800"
                }`}
              >
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 图表栅格 */}
      {charts.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {charts.map(({ chart, values }, i) => (
            <div key={`${chart.field}-${chart.type}-${i}`} className={chart.type === "roster" ? "xl:col-span-2" : ""}>
              <Card
                title={chart.title || chart.field}
                meta={chart.type === "roster" ? `名单 · 共 ${rosterCount ?? values.length} 人` : undefined}
                note={chart.note}
              >
                <ChartBody chart={chart} values={values} />
              </Card>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center text-sm text-gray-400">
          AI 配置里没有可渲染的图表，可点「恢复默认大屏」。
        </div>
      )}
    </div>
  );
}
