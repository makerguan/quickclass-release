"use client";

/**
 * 互动探究「统计信息」数据大屏（Part 2，零 AI 版）
 *
 * 设计依据：QuickForm接入互动探究_设计_v1.md §6.1
 * 核心机制：通用大屏组件 + 字段形状自动映射，默认零 AI、秒开、零成本。
 *
 * 数据来源：GET /api/qf/records/{taskId} → { items: QfRecord[], total }
 * 每条记录 data 是自由 JSON（键为中文，如 "学生姓名"、"停留时间（秒）"）。
 * 本组件不依赖 schema，直接从 data 自动推断字段类型并渲染图表：
 *   - 数值字段       → KPI 卡（均值/最小/最大）
 *   - 低基数文本/选项 → 分布条形
 *   - 数组（多选）   → 计数条形
 *   - 高基数文本     → 标签列表
 *   - 保留字段       → 提交数 + 提交时间线
 *   - 无数据         → 空态骨架
 */

import { useMemo } from "react";

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

/** 判断一个值是否为可统计的数值 */
function isNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n);
  }
  return false;
}

/** 字段分析结果 */
interface FieldAnalysis {
  key: string;
  values: unknown[];
  kind: "numeric" | "low-cardinality" | "array" | "high-cardinality";
}

/** 分析所有字段：从 records 的 data 里自动发现字段并归类 */
function analyzeFields(records: QfRecordItem[]): FieldAnalysis[] {
  const fieldMap = new Map<string, unknown[]>();
  for (const r of records) {
    const data = r.data || {};
    for (const [k, v] of Object.entries(data)) {
      // 跳过 SDK 保留字段
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

    // 数组 → 数组类型
    if (Array.isArray(nonEmpty[0])) {
      fields.push({ key, values: nonEmpty, kind: "array" });
      continue;
    }

    // 全为数值 → 数值类型
    if (nonEmpty.every(isNumeric)) {
      fields.push({ key, values: nonEmpty, kind: "numeric" });
      continue;
    }

    // 低基数：去重后 ≤ 6 种取值 → 分布条形；否则高基数 → 标签列表
    const unique = new Set(nonEmpty.map((v) => String(v)));
    if (unique.size <= 6) {
      fields.push({ key, values: nonEmpty, kind: "low-cardinality" });
    } else {
      fields.push({ key, values: nonEmpty, kind: "high-cardinality" });
    }
  }

  // 数值字段优先，其余按 key 稳定排序
  return fields.sort((a, b) => {
    const rank = (f: FieldAnalysis) => (f.kind === "numeric" ? 0 : 1);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.key.localeCompare(b.key);
  });
}

/** 数值 KPI 卡 */
function NumericCard({ field }: { field: FieldAnalysis }) {
  const nums = field.values.map((v) => Number(v));
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const isInteger = nums.every((n) => Number.isInteger(n));
  const fmt = (n: number) => (isInteger ? String(Math.round(n)) : n.toFixed(1));

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="text-xs text-gray-400 mb-2 truncate" title={field.key}>{field.key}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold text-gray-800">{fmt(avg)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">平均值</div>
        </div>
        <div className="flex gap-3 text-right">
          <div>
            <div className="text-sm font-semibold text-green-600">{fmt(min)}</div>
            <div className="text-[11px] text-gray-400">最小</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-blue-600">{fmt(max)}</div>
            <div className="text-[11px] text-gray-400">最大</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 低基数分布条形 */
function DistributionBar({ field }: { field: FieldAnalysis }) {
  const counter = new Map<string, number>();
  for (const v of field.values) {
    const key = String(v);
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  const entries = [...counter.entries()].sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="text-xs text-gray-400 mb-3 truncate" title={field.key}>{field.key}</div>
      <div className="space-y-2">
        {entries.map(([label, count]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-16 text-xs text-gray-500 truncate text-right shrink-0" title={label}>{label}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
              <div
                className="h-4 rounded-full bg-gradient-to-r from-[#00A870] to-[#4fc3a0] transition-all"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-xs text-gray-600 shrink-0">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 数组（多选）计数条形 */
function ArrayBar({ field }: { field: FieldAnalysis }) {
  const counter = new Map<string, number>();
  for (const arr of field.values) {
    for (const item of arr as unknown[]) {
      const key = String(item);
      counter.set(key, (counter.get(key) || 0) + 1);
    }
  }
  const entries = [...counter.entries()].sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="text-xs text-gray-400 mb-3 truncate" title={field.key}>{field.key}</div>
      <div className="space-y-2">
        {entries.map(([label, count]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-20 text-xs text-gray-500 truncate text-right shrink-0" title={label}>{label}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
              <div
                className="h-4 rounded-full bg-gradient-to-r from-[#7c5cff] to-[#a794ff] transition-all"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-xs text-gray-600 shrink-0">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 高基数标签列表 */
function TagCloud({ field }: { field: FieldAnalysis }) {
  const counter = new Map<string, number>();
  for (const v of field.values) {
    const key = String(v);
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  const entries = [...counter.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="text-xs text-gray-400 mb-3 truncate" title={field.key}>{field.key}</div>
      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
        {entries.map(([label, count]) => (
          <div key={label} className="bg-gray-50 rounded-full px-3 py-1 text-xs border border-gray-100">
            <span className="text-gray-700">{label}</span>
            <span className="ml-1.5 text-gray-400">{count}</span>
          </div>
        ))}
      </div>
    </div>
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

export default function QuickFormDashboard({ records, total }: DashboardProps) {
  const fields = useMemo(() => analyzeFields(records), [records]);

  // 提交时间线（按小时聚合）
  const timeline = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of records) {
      if (!r.submittedAt) continue;
      const d = new Date(r.submittedAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [records]);

  const timelineMax = useMemo(
    () => timeline.reduce((m, [, c]) => Math.max(m, c), 1),
    [timeline]
  );

  if (records.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
            <div className="text-2xl font-bold text-gray-300">0</div>
            <div className="text-[11px] text-gray-400 mt-0.5">已提交</div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
            <div className="text-2xl font-bold text-gray-300">0</div>
            <div className="text-[11px] text-gray-400 mt-0.5">收集字段</div>
          </div>
        </div>
        <EmptySkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部 KPI 总览 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-800">{total}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">已提交</div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-800">{fields.length}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">收集字段</div>
        </div>
      </div>

      {/* 数值字段 KPI 卡 */}
      {fields.filter((f) => f.kind === "numeric").length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.filter((f) => f.kind === "numeric").map((f) => (
            <NumericCard key={f.key} field={f} />
          ))}
        </div>
      )}

      {/* 提交时间线 */}
      {timeline.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
          <div className="text-xs text-gray-400 mb-3">提交时间线</div>
          <div className="flex items-end gap-1 h-20">
            {timeline.map(([label, count]) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-1" title={`${label} · ${count} 份`}>
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-[#00A870] to-[#4fc3a0] transition-all"
                    style={{ height: `${(count / timelineMax) * 100}%`, minHeight: count > 0 ? "4px" : "1px" }}
                  />
                  <span className="text-[9px] text-gray-400 rotate-45 origin-top-left whitespace-nowrap">{label}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 低基数分布 */}
      {fields.filter((f) => f.kind === "low-cardinality").map((f) => (
        <DistributionBar key={f.key} field={f} />
      ))}

      {/* 数组多选 */}
      {fields.filter((f) => f.kind === "array").map((f) => (
        <ArrayBar key={f.key} field={f} />
      ))}

      {/* 高基数标签 */}
      {fields.filter((f) => f.kind === "high-cardinality").map((f) => (
        <TagCloud key={f.key} field={f} />
      ))}
    </div>
  );
}
