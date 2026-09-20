"use client";

/**
 * 互动探究「统计信息」数据大屏（视觉 v4 · 白底数据平台风）
 *
 * 设计依据：QuickForm接入互动探究_设计_v1.md §6.1 + 2026-09-20 cc 确认的设计样稿：
 *   - 白底浅灰画布 + 白卡片栅格，克制干净的「数据平台」感（与 QuickClass 站点风格统一）；
 *   - 顶部 KPI 统计卡行（浅色，大数字）；
 *   - 图表用 recharts（与 quiz 统计页同引擎）：数值→柱状、低基数→饼图/横条、多选→横条；
 *   - 主色品牌蓝 #0052D9、时间线绿色 #00A870，不再做多色循环。
 *
 * 核心机制不变：通用大屏组件 + 字段形状自动映射，默认零 AI、秒开、零成本。
 * 数据来源：GET /api/qf/records/{taskId} → { items: QfRecord[], total }
 * 每条记录 data 是自由 JSON（键为中文，如 "学生姓名"、"年龄"）。本组件不依赖 schema。
 *
 * 字段归类口径（铁律，改前必读）：
 *   - 标识字段只按【字段名】关键词判定（姓名/学号…），绝不用「唯一值比例」启发
 *     —— 否则会把「爱好」这类自由填写误判成名单（历史事故）。
 *   - ⚠️ 本文件「纯逻辑段」与 JSX 外壳用分节注释隔开，切片单测依赖该注释，勿删。
 */

import { useMemo, type ReactNode } from "react";
import { ChartBar, ChartHBar, ChartPie } from "./DashboardCharts";

export interface QfRecordItem {
  recordId: string;
  taskId: string;
  data: Record<string, unknown>;
  submittedAt: string;
}

interface DashboardProps {
  records: QfRecordItem[];
  total: number;
}

type FieldKind = "identifier" | "numeric" | "low-cardinality" | "array" | "high-cardinality";

interface FieldAnalysis {
  key: string;
  values: unknown[];
  kind: FieldKind;
  uniqueCount: number;
}

/** 「标识类」字段名提示：命中即按名单展示，不做统计。
 *  只认字段名、不做数值启发 —— 用「唯一值比例」兜底会把「爱好」这类自由填写误判成名单。 */
const IDENTIFIER_KEY_HINTS = ["姓名", "名字", "学号", "学籍", "昵称", "name", "学生", "成员", "参与人", "报名人"];

function isNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n);
  }
  return false;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** 判断是否为标识类字段（人名/编号）：不做统计，直接列名单 */
function isIdentifier(key: string, values: unknown[]): boolean {
  if (typeof values[0] !== "string") return false;
  if (values.length < 2) return false;
  const lower = key.toLowerCase();
  return IDENTIFIER_KEY_HINTS.some((h) => lower.includes(h.toLowerCase()));
}

/** 分析所有字段：从 records 的 data 里自动发现字段并归类 */
function analyzeFields(records: QfRecordItem[]): FieldAnalysis[] {
  const fieldMap = new Map<string, unknown[]>();
  for (const r of records) {
    const data = r.data || {};
    for (const [k, v] of Object.entries(data)) {
      if (!k || k.startsWith("_")) continue;
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (!fieldMap.has(k)) fieldMap.set(k, []);
      fieldMap.get(k)!.push(v);
    }
  }

  const fields: FieldAnalysis[] = [];
  for (const [key, values] of fieldMap.entries()) {
    const nonEmpty = values.filter(
      (v) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "") && v !== false
    );
    if (nonEmpty.length === 0) continue;

    if (Array.isArray(nonEmpty[0])) {
      fields.push({ key, values: nonEmpty, kind: "array", uniqueCount: 0 });
      continue;
    }

    if (nonEmpty.every(isNumeric)) {
      fields.push({
        key,
        values: nonEmpty,
        kind: "numeric",
        uniqueCount: new Set(nonEmpty.map((v) => String(v))).size,
      });
      continue;
    }

    const uniqueCount = new Set(nonEmpty.map((v) => String(v))).size;

    if (isIdentifier(key, nonEmpty)) {
      fields.push({ key, values: nonEmpty, kind: "identifier", uniqueCount });
      continue;
    }

    fields.push({
      key,
      values: nonEmpty,
      kind: uniqueCount <= 6 ? "low-cardinality" : "high-cardinality",
      uniqueCount,
    });
  }

  // 排序：标识 → 数值 → 低基数 → 数组 → 高基数
  const rank = (f: FieldAnalysis) =>
    ({ identifier: 0, numeric: 1, "low-cardinality": 2, array: 3, "high-cardinality": 4 })[f.kind];
  return fields.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.key.localeCompare(b.key);
  });
}

/** 计数并降序排列 */
function counterEntries(values: unknown[]): [string, number][] {
  const counter = new Map<string, number>();
  for (const v of values) {
    const key = String(v);
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  return [...counter.entries()].sort((a, b) => b[1] - a[1]);
}

/** 数值分桶：取值少（≤10 种）按原值计数，否则等宽分 6 箱 */
function numericBuckets(nums: number[], uniqueCount: number): [string, number][] {
  if (uniqueCount <= 10) {
    const counter = new Map<number, number>();
    for (const n of nums) counter.set(n, (counter.get(n) || 0) + 1);
    return [...counter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([v, c]) => [fmtNum(v), c] as [string, number]);
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return [[fmtNum(min), nums.length]];
  const binCount = 6;
  const width = (max - min) / binCount;
  const buckets = new Array<number>(binCount).fill(0);
  for (const n of nums) {
    let i = Math.floor((n - min) / width);
    if (i >= binCount) i = binCount - 1;
    if (i < 0) i = 0;
    buckets[i]++;
  }
  return buckets.map((c, i) => [`${fmtNum(min + i * width)}–${fmtNum(min + (i + 1) * width)}`, c]);
}

function fmtTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ============================ 通用外壳 ============================ */

/** 白卡片：标题左 + meta 右（与设计样稿一致，无彩色顶线） */
function Card({
  title,
  meta,
  className,
  children,
}: {
  title: string;
  meta?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow p-5 ${
        className || ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="text-sm font-semibold text-gray-800 truncate" title={title}>
          {title}
        </span>
        {meta && <span className="text-[11px] text-gray-400 shrink-0">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

/** KPI 统计卡（浅色：小标签 + 大数字） */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 min-w-0">
      <div className="text-xs text-gray-400 truncate">{label}</div>
      <div className="text-3xl font-bold text-gray-900 mt-1.5 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

/* ============================ 各字段形态 ============================ */

/** 名单墙（样稿样式）：标识类字段（姓名/学号）直接列人，双列编号名单 */
function NameRoster({ field }: { field: FieldAnalysis }) {
  const names = field.values.map((v) => String(v));
  const LIMIT = 60;
  const shown = names.slice(0, LIMIT);

  return (
    <Card title={field.key} meta={`名单 · 共 ${names.length} 人`}>
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
      {names.length > LIMIT ? (
        <div className="text-[11px] text-gray-400 mt-3">还有 {names.length - LIMIT} 人未显示</div>
      ) : (
        <div className="text-[11px] text-gray-300 mt-3">标识类字段不统计，直接列名单</div>
      )}
    </Card>
  );
}

/** 数值字段：统计小卡 + 柱状分布（recharts） */
function NumericPanel({ field }: { field: FieldAnalysis }) {
  const nums = field.values.map((v) => Number(v));
  const sum = nums.reduce((a, b) => a + b, 0);
  const avg = sum / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const buckets = numericBuckets(nums, field.uniqueCount);

  return (
    <Card title={field.key} meta={`柱状 · ${nums.length} 个数值`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="rounded-lg bg-blue-50 px-3 py-1 text-center">
          <span className="text-base font-bold text-blue-700">{fmtNum(avg)}</span>
          <span className="text-[11px] text-blue-400 ml-1">平均</span>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-1 text-center">
          <span className="text-sm font-semibold text-gray-500">{fmtNum(min)}</span>
          <span className="text-[11px] text-gray-400 ml-1">最小</span>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-1 text-center">
          <span className="text-sm font-semibold text-gray-500">{fmtNum(max)}</span>
          <span className="text-[11px] text-gray-400 ml-1">最大</span>
        </div>
      </div>
      <ChartBar entries={buckets} />
    </Card>
  );
}

/** 低基数选项：≤4 种用环形饼图，更多用横向条形（Top 8） */
function OptionPanel({ field }: { field: FieldAnalysis }) {
  const entries = counterEntries(field.values);
  if (field.uniqueCount <= 4) {
    return (
      <Card title={field.key} meta={`饼图 · 共 ${entries.length} 种`}>
        <ChartPie entries={entries} />
      </Card>
    );
  }
  return (
    <Card title={field.key} meta={`Top ${Math.min(entries.length, 8)} · 共 ${entries.length} 种`}>
      <ChartHBar entries={entries.slice(0, 8)} />
      {entries.length > 8 && (
        <div className="text-[11px] text-gray-400 mt-2">另有 {entries.length - 8} 种未显示（按数量降序）</div>
      )}
    </Card>
  );
}

/** 多选数组：横向条形 Top 8 */
function ArrayPanel({ field }: { field: FieldAnalysis }) {
  const entries = counterEntries((field.values as unknown[][]).flat());
  return (
    <Card title={field.key} meta={`多选 · Top ${Math.min(entries.length, 8)}`}>
      <ChartHBar entries={entries.slice(0, 8)} />
      {entries.length > 8 && (
        <div className="text-[11px] text-gray-400 mt-2">另有 {entries.length - 8} 种未显示（按数量降序）</div>
      )}
    </Card>
  );
}

/** 高基数文本：Top N 标签（计数越高底色越深） */
function TagCloud({ field }: { field: FieldAnalysis }) {
  const entries = counterEntries(field.values);
  const LIMIT = 12;
  const shown = entries.slice(0, LIMIT);
  const max = entries[0]?.[1] || 1;

  return (
    <Card title={field.key} meta={`共 ${entries.length} 种`}>
      <div className="flex flex-wrap gap-2">
        {shown.map(([label, count]) => {
          const weight = count / max;
          return (
            <div
              key={label}
              className="rounded-full px-3 py-1 text-xs border transition-colors"
              style={{
                background: `rgba(0,82,217,${weight > 0.66 ? "0.12" : weight > 0.33 ? "0.06" : "0.03"})`,
                borderColor: "rgba(0,82,217,0.18)",
              }}
            >
              <span className="text-gray-700">{label}</span>
              <span className="ml-1.5 font-semibold text-blue-700">{count}</span>
            </div>
          );
        })}
      </div>
      {entries.length > LIMIT && (
        <div className="text-[11px] text-gray-400 mt-3">
          另有 {entries.length - LIMIT} 种未显示（按数量降序）
        </div>
      )}
    </Card>
  );
}

/** 空态引导 */
function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-blue-100 bg-gradient-to-b from-blue-50/60 to-white p-10 text-center">
      <div className="text-3xl mb-2">📊</div>
      <div className="text-sm font-medium text-gray-600">暂无收集数据</div>
      <div className="text-xs text-gray-400 mt-1.5">学生提交后，这里会自动点亮整块大屏</div>
    </div>
  );
}

/* ============================ 主组件 ============================ */

export default function QuickFormDashboard({ records, total }: DashboardProps) {
  const fields = useMemo(() => analyzeFields(records), [records]);

  /** 提交时间线（按小时聚合，最多取最近 24 个时段） */
  const timeline = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of records) {
      if (!r.submittedAt) continue;
      const d = new Date(r.submittedAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
        d.getHours()
      ).padStart(2, "0")}:00`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-24) as [string, number][];
  }, [records]);

  /** 最近一次提交时间 */
  const lastSubmit = useMemo(() => {
    const times = records
      .map((r) => new Date(r.submittedAt).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => b - a);
    if (times.length === 0) return "—";
    const d = new Date(times[0]);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${fmtTime(
      d.toISOString()
    )}`;
  }, [records]);

  const identifiers = fields.filter((f) => f.kind === "identifier");
  const numerics = fields.filter((f) => f.kind === "numeric");
  const lowCards = fields.filter((f) => f.kind === "low-cardinality");
  const arrays = fields.filter((f) => f.kind === "array");
  const highCards = fields.filter((f) => f.kind === "high-cardinality");

  /** 图表卡按归类顺序展示（视觉统一：蓝系柱状/条形 + 饼图，时间线绿色点缀） */
  const chartCards: { kind: string; field: FieldAnalysis }[] = [
    ...identifiers.map((field) => ({ kind: "identifier", field })),
    ...numerics.map((field) => ({ kind: "numeric", field })),
    ...lowCards.map((field) => ({ kind: "low-cardinality", field })),
    ...arrays.map((field) => ({ kind: "array", field })),
    ...highCards.map((field) => ({ kind: "high-cardinality", field })),
  ];

  if (records.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="已提交" value="0" />
          <StatCard label="收集字段" value="0" />
          <StatCard label="名单人数" value="0" />
          <StatCard label="最近提交" value="—" />
        </div>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部 KPI 统计卡行 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="已提交" value={String(total)} />
        <StatCard label="收集字段" value={String(fields.length)} />
        <StatCard label="名单人数" value={String(identifiers[0]?.values.length ?? records.length)} />
        <StatCard label="最近提交" value={lastSubmit} />
      </div>

      {/* 字段卡两列栅格（名单 / 柱状 / 饼图 / 条形 / 标签） */}
      {chartCards.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {chartCards.map(({ kind, field }) => {
            if (kind === "identifier") return <NameRoster key={field.key} field={field} />;
            if (kind === "numeric") return <NumericPanel key={field.key} field={field} />;
            if (kind === "low-cardinality") return <OptionPanel key={field.key} field={field} />;
            if (kind === "array") return <ArrayPanel key={field.key} field={field} />;
            return <TagCloud key={field.key} field={field} />;
          })}
        </div>
      )}

      {/* 提交时间线（绿色点缀，通栏） */}
      {timeline.length > 0 && (
        <Card title="提交时间线" meta={`按小时 · ${timeline.length} 个时段`}>
          <ChartBar entries={timeline} color="#00A870" height={180} />
        </Card>
      )}
    </div>
  );
}
