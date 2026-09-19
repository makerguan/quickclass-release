/**
 * QuickFormRecordList —— 「提交详情」标签的 QuickForm 收集数据明细
 *
 * 设计要点（与 QuickFormDashboard 同一套数据源 /api/qf/records）：
 *   - 纯展示、零 AI、零依赖：只读 records 的 data 自由 JSON
 *   - 字段顺序：先按全量字段名出现顺序对齐，再补齐单条特有字段
 *   - 过滤 SDK 保留字段（_ 开头）
 *   - 姓名识别：优先常见姓名键，其次含「姓名」的键，兜底「提交 #n」
 *   - 无数据 → 空态；双轨：调用方在无 qfTaskId 时回退原行为数据展示
 */

import { useState } from "react";
import type { QfRecordItem } from "./QuickFormDashboard";

interface Props {
  records: QfRecordItem[];
  total: number;
}

const NAME_KEYS = ["学生姓名", "姓名", "名字", "studentName", "name", "nickname", "昵称"];

function pickName(data: Record<string, unknown>, fallbackIndex: number): string {
  for (const k of NAME_KEYS) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  for (const [k, v] of Object.entries(data)) {
    if (k.includes("姓名") && v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return `提交 #${fallbackIndex + 1}`;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join("、") : "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  const s = String(v);
  return s.trim() === "" ? "—" : s;
}

function entriesFor(data: Record<string, unknown>, order: string[]): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const k of order) {
    if (k.startsWith("_") || seen.has(k)) continue;
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      out.push([k, renderValue(data[k])]);
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("_") || seen.has(k)) continue;
    out.push([k, renderValue(v)]);
    seen.add(k);
  }
  return out;
}

function formatTime(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function QuickFormRecordList({ records, total }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 全量字段名（按出现顺序），用于统一各条记录的展示顺序
  const fieldOrder: string[] = [];
  for (const r of records) {
    for (const k of Object.keys(r.data || {})) {
      if (!k || k.startsWith("_")) continue;
      if (!fieldOrder.includes(k)) fieldOrder.push(k);
    }
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400">
        暂无收集数据{total > 0 ? `（共 ${total} 条）` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-500 mb-2">
        共 {total || records.length} 条收集记录 · {fieldOrder.length} 个字段
      </div>

      {records.map((r, idx) => {
        const data = r.data || {};
        const name = pickName(data, idx);
        const isOpen = expanded.has(r.recordId);
        const entries = entriesFor(data, fieldOrder);

        return (
          <div key={r.recordId} className="border border-gray-200 rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
              onClick={() => toggle(r.recordId)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium text-gray-800 truncate">{name}</span>
                <span className="text-xs text-gray-400 shrink-0">{formatTime(r.submittedAt)}</span>
                <span className="text-xs text-gray-300 shrink-0">{entries.length} 个字段</span>
              </div>
              <div
                className="text-gray-400 transition-transform shrink-0"
                style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                ▼
              </div>
            </div>

            {isOpen && (
              <div className="px-4 py-3 border-t border-gray-100">
                {entries.length === 0 ? (
                  <div className="text-xs text-gray-400">无字段数据</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {entries.map(([k, v]) => (
                      <div key={k} className="bg-gray-50 rounded px-3 py-2">
                        <div className="text-xs text-gray-400">{k}</div>
                        <div className="text-sm font-medium text-gray-700 mt-0.5 break-words">{v}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
