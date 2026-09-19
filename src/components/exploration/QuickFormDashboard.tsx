"use client";

/**
 * 互动探究「统计信息」数据大屏（Part 2.2 视觉重做版）
 *
 * 设计依据：QuickForm接入互动探究_设计_v1.md §6.1
 * 核心机制：通用大屏组件 + 字段形状自动映射，默认零 AI、秒开、零成本。
 *
 * 数据来源：GET /api/qf/records/{taskId} → { items: QfRecord[], total }
 * 每条记录 data 是自由 JSON（键为中文，如 "学生姓名"、"年龄"）。
 * 本组件不依赖 schema，直接从 data 自动推断字段类型并渲染图表：
 *   - 标识字段（姓名/学号等）→ 名单墙（不统计，直接列人）
 *   - 数值字段       → KPI 卡 + 柱状分布
 *   - 低基数文本/选项 → 横向条形（带占比）
 *   - 数组（多选）   → 横向条形
 *   - 高基数文本     → 标签列表（Top N）
 *   - 保留字段       → 提交数 + 提交时间线（柱状）
 *   - 无数据         → 空态骨架
 */

import { useMemo, type ReactNode } from "react";

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
    <div className={`rounded-xl border border-gray-100 bg-white shadow-sm p-4 ${className || ""}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-medium text-gray-700 truncate" title={title}>
          {title}
        </span>
        {meta && <span className="text-[11px] text-gray-400 shrink-0">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function MetricTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-4 py-3">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 truncate ${accent || "text-gray-800"}`}>{value}</div>
    </div>
  );
}

/* ============================ 各字段形态 ============================ */

/** 名单墙：标识类字段（姓名/学号）直接列人 */
function NameRoster({ field }: { field: FieldAnalysis }) {
  const names = field.values.map((v) => String(v));
  const LIMIT = 60;
  const shown = names.slice(0, LIMIT);

  return (
    <Card title={field.key} meta={`名单 · 共 ${names.length} 人`}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-3 gap-y-2">
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
    </Card>
  );
}

/** 垂直柱状图（数值分布 / 时间线共用） */
function ColumnChart({ entries, color }: { entries: [string, number][]; color: string }) {
  const max = entries.reduce((m, [, c]) => Math.max(m, c), 1);
  return (
    <div>
      <div className="flex items-end gap-1.5 h-28 border-b border-gray-100">
        {entries.map(([label, count], i) => (
          <div
            key={`${label}-${i}`}
            className="flex-1 flex flex-col items-center justify-end h-full group"
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

/** 数值字段：KPI + 柱状分布 */
function NumericPanel({ field }: { field: FieldAnalysis }) {
  const nums = field.values.map((v) => Number(v));
  const sum = nums.reduce((a, b) => a + b, 0);
  const avg = sum / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const buckets = numericBuckets(nums, field.uniqueCount);

  return (
    <Card title={field.key} meta={`${nums.length} 个数值`}>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-center">
          <div className="text-lg font-bold text-blue-700">{fmtNum(avg)}</div>
          <div className="text-[11px] text-blue-500">平均</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
          <div className="text-lg font-bold text-gray-600">{fmtNum(min)}</div>
          <div className="text-[11px] text-gray-400">最小</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
          <div className="text-lg font-bold text-gray-600">{fmtNum(max)}</div>
          <div className="text-[11px] text-gray-400">最大</div>
        </div>
      </div>
      <ColumnChart entries={buckets} color="#378ADD" />
    </Card>
  );
}

/** 横向条形（低基数分布 / 数组多选共用） */
function BarList({ field, color }: { field: FieldAnalysis; color: string }) {
  const entries =
    field.kind === "array"
      ? counterEntries((field.values as unknown[][]).flat())
      : counterEntries(field.values);
  const max = entries[0]?.[1] || 1;
  const baseCount = field.values.length;

  return (
    <Card
      title={field.key}
      meta={`${field.kind === "array" ? "多选" : "分布"} · 共 ${entries.length} 种`}
    >
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
              {count} 人
              <span className="text-gray-300">
                {" "}
                {baseCount > 0 ? `${Math.round((count / baseCount) * 100)}%` : ""}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 高基数文本：Top N 标签 */
function TagCloud({ field }: { field: FieldAnalysis }) {
  const entries = counterEntries(field.values);
  const LIMIT = 12;
  const shown = entries.slice(0, LIMIT);

  return (
    <Card title={field.key} meta={`共 ${entries.length} 种`}>
      <div className="flex flex-wrap gap-2">
        {shown.map(([label, count]) => (
          <div key={label} className="bg-gray-50 rounded-full px-3 py-1 text-xs border border-gray-100">
            <span className="text-gray-700">{label}</span>
            <span className="ml-1.5 text-gray-400">{count}</span>
          </div>
        ))}
      </div>
      {entries.length > LIMIT && (
        <div className="text-[11px] text-gray-400 mt-2">
          另有 {entries.length - LIMIT} 种未显示（按数量降序）
        </div>
      )}
    </Card>
  );
}

/** 空态骨架：框架在，数据来了自动刷 */
function EmptySkeleton() {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center">
      <div className="text-sm text-gray-400">暂无 QuickForm 收集数据</div>
      <div className="text-xs text-gray-300 mt-1">学生提交后，数据大屏会自动填充</div>
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

  if (records.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricTile label="已提交" value="0" accent="text-gray-300" />
          <MetricTile label="收集字段" value="0" accent="text-gray-300" />
          <MetricTile label="最近提交" value="—" accent="text-gray-300" />
          <MetricTile label="数据完整度" value="—" accent="text-gray-300" />
        </div>
        <EmptySkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部 KPI 条 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricTile label="已提交" value={String(total)} accent="text-[#0052D9]" />
        <MetricTile label="收集字段" value={String(fields.length)} />
        <MetricTile label="最近提交" value={lastSubmit} accent="text-gray-700" />
        <MetricTile
          label="名单人数"
          value={String(identifiers[0]?.values.length ?? records.length)}
        />
      </div>

      {/* 标识字段：名单墙 */}
      {identifiers.map((f) => (
        <NameRoster key={f.key} field={f} />
      ))}

      {/* 提交时间线 */}
      {timeline.length > 0 && (
        <Card title="提交时间线" meta={`${timeline.length} 个时段`}>
          <ColumnChart entries={timeline} color="#00A870" />
        </Card>
      )}

      {/* 其余字段：两列栅格 */}
      {numerics.length + lowCards.length + arrays.length + highCards.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {numerics.map((f) => (
            <NumericPanel key={f.key} field={f} />
          ))}
          {lowCards.map((f) => (
            <BarList key={f.key} field={f} color="#0052D9" />
          ))}
          {arrays.map((f) => (
            <BarList key={f.key} field={f} color="#7c5cff" />
          ))}
          {highCards.map((f) => (
            <TagCloud key={f.key} field={f} />
          ))}
        </div>
      )}
    </div>
  );
}
