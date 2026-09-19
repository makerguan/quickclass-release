"use client";

/**
 * QuickFormAiDashboard —— 「AI 重排」后的数据大屏渲染器（v2：主题换肤）。
 *
 * 与默认大屏（QuickFormDashboard）的区别：
 *   默认大屏 = 前端按字段形状**自动**决定画什么；
 *   本组件   = 按 AI 产出的**设计配置**决定画什么、长什么样（选主题、选字段、选图型、排主视觉）。
 *
 * ⚠️ 安全红线：AI 只输出**配置 JSON**（theme 只能从预制主题里选，颜色一律由渲染器给出），
 *    本组件据配置自行计算并渲染图表。**绝不**让 AI 产出 HTML / 脚本 / 自由样式再渲染 ——
 *    数据源是学生自由输入，那是存储型 XSS。配置里的文案走 React 文本节点渲染，天然转义。
 *
 * v2 变更：支持 theme（6 套预制主题整屏换肤，深色玻璃卡 / 浅色渐变底）与 span 主视觉双栏。
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_THEME,
  type AiDashboardChart,
  type AiDashboardConfig,
} from "@/lib/prompts/dashboard-config";
import type { QfRecordItem } from "./QuickFormDashboard";

interface Props {
  records: QfRecordItem[];
  total: number;
  config: AiDashboardConfig;
}

/* ------------------------------ 主题 ------------------------------ */

interface ThemeSpec {
  dark: boolean;
  /** 外层容器背景 */
  page: CSSProperties;
  /** 卡片背景 */
  cardBg: string;
  cardBorder: string;
  /** 卡片标题色 */
  cardTitle: string;
  /** 大标题色 */
  titleColor: string;
  subtitleColor: string;
  /** 小字（轴标签/注释）色 */
  axisColor: string;
  noteColor: string;
  metaColor: string;
  badge: CSSProperties;
  palette: string[];
  /** 主横幅背景 */
  banner: CSSProperties;
  /** 环形图中心孔颜色（近似卡片底） */
  hole: string;
  /** 条形轨道底色 */
  track: string;
  /** 正文文字色 */
  text: string;
}

function darkBadge(): CSSProperties {
  return {
    background: "rgba(125,180,255,0.16)",
    border: "1px solid rgba(125,180,255,0.4)",
    color: "#9cc3ff",
  };
}

function lightBadge(): CSSProperties {
  return { background: "rgba(255,255,255,0.28)", color: "#ffffff" };
}

const THEMES: Record<string, ThemeSpec> = {
  aurora: {
    dark: true,
    page: {
      background:
        "radial-gradient(1100px 420px at 18% 0%, rgba(91,141,255,0.22), transparent)," +
        "radial-gradient(900px 380px at 88% 8%, rgba(167,139,250,0.16), transparent)," +
        "linear-gradient(135deg,#040b26 0%,#0a1c4e 48%,#0e1533 100%)",
    },
    cardBg: "rgba(255,255,255,0.055)",
    cardBorder: "1px solid rgba(255,255,255,0.12)",
    cardTitle: "#e8eeff",
    titleColor: "#f5f8ff",
    subtitleColor: "rgba(214,226,255,0.62)",
    axisColor: "rgba(255,255,255,0.42)",
    noteColor: "rgba(255,255,255,0.38)",
    metaColor: "rgba(255,255,255,0.45)",
    badge: darkBadge(),
    palette: ["#5b8dff", "#2dd4bf", "#a78bfa", "#34d399", "#f472b6", "#fbbf24", "#38bdf8", "#e879f9"],
    banner: {
      background:
        "linear-gradient(90deg, rgba(91,141,255,0.22), rgba(167,139,250,0.14) 55%, rgba(255,255,255,0.03))",
      border: "1px solid rgba(255,255,255,0.14)",
    },
    hole: "rgba(8,18,48,0.95)",
    track: "rgba(255,255,255,0.08)",
    text: "#dbe6ff",
  },
  violet: {
    dark: true,
    page: {
      background:
        "radial-gradient(1000px 400px at 15% 0%, rgba(217,70,239,0.2), transparent)," +
        "radial-gradient(900px 380px at 85% 10%, rgba(56,189,248,0.13), transparent)," +
        "linear-gradient(135deg,#150b33 0%,#251052 50%,#12082b 100%)",
    },
    cardBg: "rgba(255,255,255,0.055)",
    cardBorder: "1px solid rgba(255,255,255,0.12)",
    cardTitle: "#f3e9ff",
    titleColor: "#fdf7ff",
    subtitleColor: "rgba(240,222,255,0.62)",
    axisColor: "rgba(255,255,255,0.42)",
    noteColor: "rgba(255,255,255,0.38)",
    metaColor: "rgba(255,255,255,0.45)",
    badge: {
      background: "rgba(216,132,252,0.16)",
      border: "1px solid rgba(216,132,252,0.4)",
      color: "#e3b8fc",
    },
    palette: ["#c084fc", "#f472b6", "#38bdf8", "#a78bfa", "#e879f9", "#22d3ee", "#fb7185", "#facc15"],
    banner: {
      background:
        "linear-gradient(90deg, rgba(192,132,252,0.22), rgba(244,114,182,0.14) 55%, rgba(255,255,255,0.03))",
      border: "1px solid rgba(255,255,255,0.14)",
    },
    hole: "rgba(24,10,52,0.95)",
    track: "rgba(255,255,255,0.08)",
    text: "#efe4ff",
  },
  ocean: {
    dark: false,
    page: { background: "linear-gradient(160deg,#eef6ff 0%,#e2f1fb 52%,#eaf8f4 100%)" },
    cardBg: "#ffffff",
    cardBorder: "1px solid #d9e8f6",
    cardTitle: "#1e3a5f",
    titleColor: "#0f3567",
    subtitleColor: "#5b7ba0",
    axisColor: "#8aa3bd",
    noteColor: "#93aec7",
    metaColor: "#8aa3bd",
    badge: lightBadge(),
    palette: ["#0e7ce8", "#06b6d4", "#10b981", "#6366f1", "#f59e0b", "#ef4444", "#0ea5e9", "#14b8a6"],
    banner: {
      background: "linear-gradient(95deg,#0e7ce8 0%,#06b6d4 78%,#10b981 100%)",
      boxShadow: "0 8px 22px rgba(14,124,232,0.28)",
    },
    hole: "#ffffff",
    track: "#e8f0f8",
    text: "#334155",
  },
  sunset: {
    dark: false,
    page: { background: "linear-gradient(160deg,#fff8ef 0%,#ffeeda 55%,#fdeef0 100%)" },
    cardBg: "#ffffff",
    cardBorder: "1px solid #f5e2cd",
    cardTitle: "#7c3a12",
    titleColor: "#8a3a10",
    subtitleColor: "#a9714b",
    axisColor: "#bb8b66",
    noteColor: "#c49a7a",
    metaColor: "#bb8b66",
    badge: lightBadge(),
    palette: ["#f97316", "#ef4444", "#ec4899", "#f59e0b", "#e11d48", "#fb923c", "#d946ef", "#f43f5e"],
    banner: {
      background: "linear-gradient(95deg,#f97316 0%,#ef4444 78%,#ec4899 100%)",
      boxShadow: "0 8px 22px rgba(249,115,22,0.26)",
    },
    hole: "#ffffff",
    track: "#f8ede1",
    text: "#57341b",
  },
  forest: {
    dark: false,
    page: { background: "linear-gradient(160deg,#f0fdf4 0%,#e9fbf1 52%,#f4fdea 100%)" },
    cardBg: "#ffffff",
    cardBorder: "1px solid #d3eedd",
    cardTitle: "#14532d",
    titleColor: "#14532d",
    subtitleColor: "#5f8a6e",
    axisColor: "#8aab94",
    noteColor: "#94b89e",
    metaColor: "#8aab94",
    badge: lightBadge(),
    palette: ["#059669", "#10b981", "#84cc16", "#0d9488", "#65a30d", "#22c55e", "#0ea5e9", "#eab308"],
    banner: {
      background: "linear-gradient(95deg,#047857 0%,#10b981 78%,#84cc16 100%)",
      boxShadow: "0 8px 22px rgba(5,150,105,0.24)",
    },
    hole: "#ffffff",
    track: "#e8f4ec",
    text: "#1f4a33",
  },
  slate: {
    dark: false,
    page: { background: "linear-gradient(160deg,#f8fafc 0%,#f1f5f9 60%,#eef2f7 100%)" },
    cardBg: "#ffffff",
    cardBorder: "1px solid #e2e8f0",
    cardTitle: "#1e293b",
    titleColor: "#0f172a",
    subtitleColor: "#64748b",
    axisColor: "#94a3b8",
    noteColor: "#9aa8ba",
    metaColor: "#94a3b8",
    badge: { background: "rgba(30,41,59,0.85)", color: "#f1f5f9" },
    palette: ["#2563eb", "#0ea5e9", "#10b981", "#6366f1", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"],
    banner: {
      background: "linear-gradient(95deg,#1e293b 0%,#334155 80%,#475569 100%)",
      boxShadow: "0 8px 22px rgba(30,41,59,0.22)",
    },
    hole: "#ffffff",
    track: "#eef2f7",
    text: "#334155",
  },
};

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

/* ------------------------------ 主题化外壳 ------------------------------ */

function Card({
  theme,
  color,
  hero,
  title,
  meta,
  note,
  children,
}: {
  theme: ThemeSpec;
  color: string;
  hero: boolean;
  title: string;
  meta?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-4 h-full"
      style={{
        background: theme.cardBg,
        border: hero ? `1.5px solid ${color}88` : theme.cardBorder,
        boxShadow: theme.dark
          ? hero
            ? `0 0 26px ${color}33, inset 0 1px 0 rgba(255,255,255,0.06)`
            : "0 4px 18px rgba(0,0,0,0.25)"
          : "0 2px 10px rgba(15,40,80,0.06)",
      }}
    >
      {/* 彩色顶线 */}
      <div
        className="h-[3px] w-9 rounded-full mb-3"
        style={{ background: `linear-gradient(90deg, ${color}, ${color}55)` }}
      />
      <div className="flex items-center justify-between gap-2 mb-3">
        <span
          className="text-sm font-semibold truncate"
          style={{ color: theme.cardTitle }}
          title={title}
        >
          {title}
        </span>
        {meta && (
          <span className="text-[11px] shrink-0" style={{ color: theme.metaColor }}>
            {meta}
          </span>
        )}
      </div>
      {children}
      {note && (
        <div className="text-[11px] mt-3 leading-relaxed" style={{ color: theme.noteColor }}>
          {note}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ 图形 ------------------------------ */

function ColumnChart({ entries, color, theme }: { entries: Entry[]; color: string; theme: ThemeSpec }) {
  const max = entries.reduce((m, [, c]) => Math.max(m, c), 1);
  return (
    <div>
      <div
        className="flex items-end gap-1.5 h-28"
        style={{ borderBottom: theme.dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #e8eef5" }}
      >
        {entries.map(([label, count], i) => {
          const isMax = count === max;
          return (
            <div
              key={`${label}-${i}`}
              className="flex-1 flex flex-col items-center justify-end h-full"
              title={`${label} · ${count}`}
            >
              <span className="text-[10px] mb-0.5" style={{ color: theme.axisColor }}>
                {count}
              </span>
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${Math.max((count / max) * 100, count > 0 ? 4 : 1)}%`,
                  background: `linear-gradient(180deg, ${color}, ${color}77)`,
                  boxShadow: isMax ? `0 0 14px ${color}66` : undefined,
                  opacity: 0.65 + 0.35 * (count / max),
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {entries.map(([label], i) => (
          <span
            key={`${label}-lab-${i}`}
            className="flex-1 text-[10px] text-center truncate"
            style={{ color: theme.axisColor }}
            title={label}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function LineChart({ entries, color, theme }: { entries: Entry[]; color: string; theme: ThemeSpec }) {
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
        <defs>
          <linearGradient id={`lg-${color.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#lg-${color.replace(/[^a-zA-Z0-9]/g, "")})`} />
        <polyline
          points={poly}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="3"
            fill={theme.dark ? theme.hole : "#fff"}
            stroke={color}
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="flex gap-1.5 mt-1">
        {entries.map(([label], i) => (
          <span
            key={`${label}-lab-${i}`}
            className="flex-1 text-[10px] text-center truncate"
            style={{ color: theme.axisColor }}
            title={label}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function BarList({
  entries,
  color,
  theme,
}: {
  entries: Entry[];
  color: string;
  theme: ThemeSpec;
}) {
  const max = entries[0]?.[1] || 1;
  const base = entries.reduce((s, [, c]) => s + c, 0);
  return (
    <div className="space-y-2">
      {entries.map(([label, count]) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className="w-20 text-xs truncate text-right shrink-0"
            style={{ color: theme.text }}
            title={label}
          >
            {label}
          </span>
          <div className="flex-1 rounded-full h-4 overflow-hidden" style={{ background: theme.track }}>
            <div
              className="h-4 rounded-full transition-all"
              style={{
                width: `${(count / max) * 100}%`,
                background: `linear-gradient(90deg, ${color}cc, ${color})`,
              }}
            />
          </div>
          <span className="w-16 text-[11px] shrink-0 text-right" style={{ color: theme.axisColor }}>
            {count}
            <span style={{ opacity: 0.6 }}> {base > 0 ? `${Math.round((count / base) * 100)}%` : ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function PieChart({
  entries,
  palette,
  theme,
}: {
  entries: Entry[];
  palette: string[];
  theme: ThemeSpec;
}) {
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
    return { label, count, d, color: palette[i % palette.length] };
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 112 112" className="w-28 h-28 shrink-0">
        {slices.map((s) => (
          <path key={s.label} d={s.d} fill={s.color} />
        ))}
        <circle cx={cx} cy={cy} r={r - 0.5} fill={theme.hole} />
      </svg>
      <div className="flex-1 space-y-1.5 min-w-0">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: s.color, boxShadow: `0 0 6px ${s.color}66` }}
            />
            <span className="truncate" style={{ color: theme.text }} title={s.label}>
              {s.label}
            </span>
            <span className="ml-auto shrink-0" style={{ color: theme.axisColor }}>
              {s.count} · {Math.round((s.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NameRoster({
  names,
  palette,
  theme,
}: {
  names: string[];
  palette: string[];
  theme: ThemeSpec;
}) {
  const LIMIT = 60;
  const shown = names.slice(0, LIMIT);
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-2">
        {shown.map((n, i) => {
          const c = palette[i % palette.length];
          return (
            <div key={`${n}-${i}`} className="flex items-center gap-2 min-w-0">
              <span
                className="w-6 h-6 shrink-0 rounded-full text-[11px] font-semibold flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${c}, ${c}b3)`,
                  color: "#fff",
                  boxShadow: theme.dark ? `0 0 10px ${c}44` : undefined,
                }}
              >
                {n.slice(-1)}
              </span>
              <span className="text-[13px] truncate" style={{ color: theme.text }} title={n}>
                {n}
              </span>
            </div>
          );
        })}
      </div>
      {names.length > LIMIT && (
        <div className="text-[11px] mt-2" style={{ color: theme.axisColor }}>
          还有 {names.length - LIMIT} 人未显示
        </div>
      )}
    </div>
  );
}

function TagList({
  entries,
  palette,
  theme,
}: {
  entries: Entry[];
  palette: string[];
  theme: ThemeSpec;
}) {
  const max = entries[0]?.[1] || 1;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([label, count], i) => {
        const c = palette[i % palette.length];
        const strength = 0.1 + 0.26 * (count / max);
        return (
          <div
            key={label}
            className="rounded-full px-3 py-1 text-xs"
            style={{
              background: theme.dark
                ? `rgba(255,255,255,${0.05 + 0.1 * (count / max)})`
                : `${c}${Math.round(strength * 255)
                    .toString(16)
                    .padStart(2, "0")}`,
              border: `1px solid ${c}55`,
            }}
          >
            <span style={{ color: theme.text }}>{label}</span>
            <span className="ml-1.5 font-semibold" style={{ color: c }}>
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
  palette,
  theme,
}: {
  chart: AiDashboardChart;
  values: unknown[];
  color: string;
  palette: string[];
  theme: ThemeSpec;
}) {
  const limit = chart.limit ?? 8;

  if (chart.type === "roster") {
    const names = values.map((v) => String(v));
    if (names.length === 0) return null;
    return <NameRoster names={names} palette={palette} theme={theme} />;
  }

  const entries = entriesForField(values, chart.type === "list" ? limit : Math.max(limit, 6));
  if (entries.length === 0) return null;

  switch (chart.type) {
    case "line":
      return <LineChart entries={entries} color={color} theme={theme} />;
    case "hbar":
      return <BarList entries={entries} color={color} theme={theme} />;
    case "pie":
      return <PieChart entries={entries} palette={palette} theme={theme} />;
    case "list":
      return <TagList entries={entries} palette={palette} theme={theme} />;
    case "bar":
    default:
      return <ColumnChart entries={entries} color={color} theme={theme} />;
  }
}

/* ------------------------------ 主组件 ------------------------------ */

export default function QuickFormAiDashboard({ records, total, config }: Props) {
  const theme = THEMES[config.theme || ""] || THEMES[DEFAULT_THEME];
  const palette = theme.palette;
  const fieldValues = useMemo(() => collectValues(records), [records]);

  const kpis = (config.kpis || []).map((k, i) => {
    const values = k.field ? fieldValues.get(k.field) || [] : [];
    const shown = k.agg === "count" && !k.field ? String(total) : kpiValue(k.agg, values);
    return { label: k.label, value: shown, color: palette[i % palette.length] };
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
    <div className="rounded-2xl p-4 md:p-5 space-y-4" style={theme.page}>
      {/* 标题横幅 */}
      {(config.title || config.subtitle) && (
        <div
          className="rounded-2xl px-5 py-4 flex items-center justify-between gap-3"
          style={theme.banner}
        >
          <div className="min-w-0">
            <div
              className="text-lg font-bold tracking-wide truncate"
              style={{ color: theme.dark ? theme.titleColor : "#ffffff" }}
            >
              {config.title || "数据大屏"}
            </div>
            {config.subtitle && (
              <div
                className="text-xs mt-1 truncate"
                style={{ color: theme.dark ? theme.subtitleColor : "rgba(255,255,255,0.85)" }}
              >
                {config.subtitle}
              </div>
            )}
          </div>
          <span
            className="shrink-0 text-[10px] rounded-full px-2.5 py-1 font-medium"
            style={theme.badge}
          >
            AI 设计
          </span>
        </div>
      )}

      {/* KPI 指标条 */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k, i) => (
            <div
              key={`${k.label}-${i}`}
              className="rounded-2xl px-4 py-3.5"
              style={{
                background: theme.dark
                  ? `linear-gradient(135deg, ${k.color}2e, rgba(255,255,255,0.045))`
                  : "#ffffff",
                border: theme.dark ? `1px solid ${k.color}55` : theme.cardBorder,
                boxShadow: theme.dark ? `0 0 18px ${k.color}22` : "0 2px 10px rgba(15,40,80,0.06)",
              }}
            >
              <div
                className="text-[11px] truncate"
                style={{ color: theme.dark ? theme.subtitleColor : theme.axisColor }}
                title={k.label}
              >
                {k.label}
              </div>
              <div
                className="text-[26px] leading-8 font-extrabold mt-1 truncate"
                style={{
                  color: theme.dark ? "#ffffff" : k.color,
                  textShadow: theme.dark ? `0 0 16px ${k.color}88` : undefined,
                }}
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
          {charts.map(({ chart, values }, i) => {
            const color = palette[i % palette.length];
            const hero = chart.span === 2;
            return (
              <div
                key={`${chart.field}-${chart.type}-${i}`}
                className={hero || chart.type === "roster" ? "xl:col-span-2" : ""}
              >
                <Card
                  theme={theme}
                  color={color}
                  hero={hero}
                  title={chart.title || chart.field}
                  meta={chart.type === "roster" ? `名单 · 共 ${rosterCount ?? values.length} 人` : undefined}
                  note={chart.note}
                >
                  <ChartBody
                    chart={chart}
                    values={values}
                    color={color}
                    palette={palette}
                    theme={theme}
                  />
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="rounded-2xl border border-dashed p-6 text-center text-sm"
          style={{
            borderColor: theme.dark ? "rgba(255,255,255,0.2)" : "#c9d8e8",
            color: theme.axisColor,
            background: theme.dark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.5)",
          }}
        >
          AI 配置里没有可渲染的图表，可点「恢复默认大屏」。
        </div>
      )}
    </div>
  );
}
