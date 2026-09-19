"use client";

/**
 * QuickFormRecordList —— 「提交详情」标签的 QuickForm 收集数据名单表
 *
 * 设计要点（与 QuickFormDashboard 同一套数据源 /api/qf/records）：
 *   - 纯展示、零 AI、零依赖：只读 records 的 data 自由 JSON
 *   - 表格式名单：姓名列 + 主要字段列 + 提交时间；点击行展开单条完整详情
 *   - 字段顺序：按全量字段名出现顺序对齐
 *   - 过滤 SDK 保留字段（_ 开头）
 *   - 姓名识别：优先常见姓名键，其次含「姓名」的键，兜底「提交 #n」
 *   - 无数据 → 空态；双轨：调用方在无 qfTaskId 时回退原行为数据展示
 */

import { Fragment, useMemo, useState } from "react";
import type { QfRecordItem } from "./QuickFormDashboard";

interface Props {
  records: QfRecordItem[];
  total: number;
}

const NAME_KEYS = ["学生姓名", "姓名", "名字", "studentName", "name", "nickname", "昵称"];

/** 表格内最多平铺展示的字段列数，超出的收进展开详情 */
const MAX_COLS = 4;

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

function formatTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export default function QuickFormRecordList({ records, total }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");

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
  const fieldOrder = useMemo(() => {
    const order: string[] = [];
    for (const r of records) {
      for (const k of Object.keys(r.data || {})) {
        if (!k || k.startsWith("_")) continue;
        if (!order.includes(k)) order.push(k);
      }
    }
    return order;
  }, [records]);

  // 姓名列：优先命中的姓名键，其次含「姓名」的键
  const nameKey = useMemo(() => {
    for (const k of NAME_KEYS) if (fieldOrder.includes(k)) return k;
    return fieldOrder.find((k) => k.includes("姓名")) ?? null;
  }, [fieldOrder]);

  const detailKeys = useMemo(() => fieldOrder.filter((k) => k !== nameKey), [fieldOrder, nameKey]);
  const shownKeys = detailKeys.slice(0, MAX_COLS);
  const hiddenCount = detailKeys.length - shownKeys.length;
  const colCount = 1 + shownKeys.length + 2; // 姓名 + 字段列 + 提交时间 + 展开箭头

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => JSON.stringify(r.data || {}).toLowerCase().includes(q));
  }, [records, keyword]);

  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400">
        暂无收集数据{total > 0 ? `（共 ${total} 条）` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-500">
          共 {total || records.length} 名学生提交 · {fieldOrder.length} 个字段
          {hiddenCount > 0 && <span className="text-gray-400">（表格显示前 {MAX_COLS} 个，点开看全部）</span>}
        </div>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索姓名或任意内容"
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0052D9] w-56"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">姓名</th>
              {shownKeys.map((k) => (
                <th key={k} className="text-left font-medium px-4 py-2.5 whitespace-nowrap max-w-[220px]" title={k}>
                  <span className="block truncate">{k}</span>
                </th>
              ))}
              <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">提交时间</th>
              <th className="w-10 px-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-gray-400">
                  没有匹配「{keyword}」的记录
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const data = r.data || {};
              const isOpen = expanded.has(r.recordId);
              const name = nameKey ? renderValue(data[nameKey]) : pickName(data, records.indexOf(r));
              const allEntries: [string, string][] = fieldOrder.map((k) => [k, renderValue(data[k])]);

              return (
                <Fragment key={r.recordId}>
                  <tr
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggle(r.recordId)}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-5 h-5 shrink-0 rounded-full bg-blue-50 text-blue-600 text-[11px] flex items-center justify-center">
                          {records.indexOf(r) + 1}
                        </span>
                        {name}
                      </span>
                    </td>
                    {shownKeys.map((k) => (
                      <td key={k} className="px-4 py-2.5 text-gray-600 max-w-[220px]">
                        <span className="block truncate" title={renderValue(data[k])}>
                          {renderValue(data[k])}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                      {formatTime(r.submittedAt)}
                    </td>
                    <td className="px-2 text-gray-300 transition-transform text-center">
                      <span
                        className="inline-block"
                        style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                      >
                        ▼
                      </span>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={colCount} className="px-4 py-3">
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                          {allEntries.map(([k, v]) => (
                            <div key={k} className="bg-white rounded border border-gray-100 px-3 py-2">
                              <div className="text-[11px] text-gray-400 truncate" title={k}>
                                {k}
                              </div>
                              <div className="text-sm font-medium text-gray-700 mt-0.5 break-words">{v}</div>
                            </div>
                          ))}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-2">
                          记录 ID：{r.recordId} · 提交于 {formatTime(r.submittedAt)}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
