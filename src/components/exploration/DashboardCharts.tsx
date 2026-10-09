"use client";

/**
 * 课堂数据大屏 · 共用图表组件（recharts 封装）
 *
 * 默认大屏（QuickFormDashboard）与 AI 大屏（QuickFormAiDashboard）共用，
 * 保证两个大屏视觉一致。
 *
 * 设计基调（2026-09-20 与 cc 对齐的截图样稿）：
 *   - 白底浅灰画布 + 白卡片，克制、干净的「数据平台」感；
 *   - 主色品牌蓝 #0052D9，辅助 绿 #00A870 / 青 #0891B2 / 琥珀 #F59E0B；
 *   - 图表内不再玩多色循环（cc：要的是数据大平台展示，不是颜色变化）。
 */

import type { CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

export type Entry = [string, number];

/** 品牌主色 */
export const BRAND_BLUE = "#0052D9";
/** 饼图取色序列（蓝系打头，绿/青/琥珀点缀，克制不花哨） */
export const PIE_PALETTE = ["#0052D9", "#2b7de8", "#69a9f0", "#00A870", "#0891B2", "#F59E0B"];

const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  boxShadow: "0 6px 20px rgba(15,40,80,0.10)",
  fontSize: 12,
  padding: "6px 10px",
};

const AXIS_TICK = { fontSize: 11, fill: "#8a97a8" };

/** 垂直柱状图（数值分布 / 时间线共用）：圆角柱 + 悬浮提示 */
export function ChartBar({
  entries,
  color = BRAND_BLUE,
  height = 220,
}: {
  entries: Entry[];
  color?: string;
  height?: number;
}) {
  const data = entries.map(([label, count]) => ({ label, count }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "#e5e9f0" }}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgba(0,82,217,0.06)" }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(v) => [`${v}`, "数量"]}
        />
        <Bar dataKey="count" fill={color} radius={[6, 6, 0, 0]} maxBarSize={46} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 横向条形图（低基数选项 / 多选 Top N 共用）：左标签右条 */
export function ChartHBar({
  entries,
  color = BRAND_BLUE,
  showPercent = true,
}: {
  entries: Entry[];
  color?: string;
  showPercent?: boolean;
}) {
  const total = entries.reduce((s, [, c]) => s + c, 0) || 1;
  const data = entries.map(([label, count]) => ({ label, count }));
  const height = Math.max(entries.length * 34 + 16, 96);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={92}
          tickFormatter={(v: string) => (v.length > 8 ? `${v.slice(0, 8)}…` : v)}
          tick={{ fontSize: 12, fill: "#4b5563" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,82,217,0.05)" }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(v, _n, item) => {
            const c = Number(v) || 0;
            const pct = showPercent ? `（${Math.round((c / total) * 100)}%）` : "";
            return [`${c}${pct}`, "数量"];
          }}
        />
        <Bar dataKey="count" fill={color} radius={[0, 6, 6, 0]} maxBarSize={18} background={{ fill: "#f3f5f9", radius: 6 }}>
          {data.map((d, i) => (
            <Cell key={i} fill={i === 0 ? color : `${color}b8`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 环形图（取值 3~6 种的占比）：图 + 右侧图例 */
export function ChartPie({ entries }: { entries: Entry[] }) {
  const data = entries.map(([label, count]) => ({ label, count }));
  const total = entries.reduce((s, [, c]) => s + c, 0) || 1;
  return (
    <div className="flex items-center gap-4">
      <div className="w-40 h-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}`, "数量"]} />
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }}
            />
            <span className="text-gray-600 truncate" title={d.label}>
              {d.label}
            </span>
            <span className="ml-auto shrink-0 text-gray-400">
              {d.count} · {Math.round((d.count / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 折线图（数值走势 / 时间序列） */
export function ChartLine({
  entries,
  color = BRAND_BLUE,
  height = 220,
}: {
  entries: Entry[];
  color?: string;
  height?: number;
}) {
  const data = entries.map(([label, count]) => ({ label, count }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "#e5e9f0" }} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}`, "数量"]} />
        <Line
          type="monotone"
          dataKey="count"
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#ffffff", stroke: color, strokeWidth: 2 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 散点图（两个数值字段的相关性）：recharts ScatterChart，hover 显示标签 */
export function ChartScatter({
  points,
  color = BRAND_BLUE,
  xLabel,
  yLabel,
  height = 220,
}: {
  points: { x: number; y: number; label?: string }[];
  color?: string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const data = points.map((p) => ({ x: p.x, y: p.y, label: p.label }));
  // recharts v3 的 Tooltip content 类型较复杂，这里用宽松类型只做读取
  const renderTooltip = (props: any) => {
    const { active, payload } = props;
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          boxShadow: "0 6px 20px rgba(15,40,80,0.10)",
          fontSize: 12,
          padding: "6px 10px",
        }}
      >
        {p?.label && (
          <div style={{ fontWeight: 600, color: "#374151", marginBottom: 2 }}>{p.label}</div>
        )}
        <div style={{ color: "#6b7280" }}>
          {xLabel || "x"}：{p?.x}
        </div>
        <div style={{ color: "#6b7280" }}>
          {yLabel || "y"}：{p?.y}
        </div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel || "x"}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "#e5e9f0" }}
          domain={["auto", "auto"]}
          label={
            xLabel
              ? { value: xLabel, position: "insideBottom", offset: -6, fontSize: 11, fill: "#8a97a8" }
              : undefined
          }
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel || "y"}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          domain={["auto", "auto"]}
          label={
            yLabel
              ? { value: yLabel, position: "insideLeft", angle: -90, fontSize: 11, fill: "#8a97a8" }
              : undefined
          }
        />
        <ZAxis range={[80, 80]} />
        <Tooltip content={renderTooltip} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={data} fill={color} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
