/**
 * schema 校验
 * 规则（规范 §4）：
 * - 任务未定义 fields → 自由 JSON，不校验（与 QuickForm 原版行为一致）
 * - 定义了 fields → required 字段必须存在且非空；已有字段类型必须匹配；未声明的键放行（保留 QuickForm 灵活性）
 * - 中途 schema 变更只允许追加字段，不允许删除/改名/改类型（SCHEMA_CHANGE_REJECTED）
 */
import type { FieldDef, FieldType, RecordData } from "./types";
import { QfErrorCode, QfError } from "./errors";

function checkType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "text":
    case "textarea":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "select":
      return typeof value === "string";
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }
}

export function validateAgainstSchema(fields: FieldDef[], data: RecordData): void {
  for (const f of fields) {
    const v = data[f.key];
    const missing = v === undefined || v === null || v === "";
    if (f.required && missing) {
      throw new QfError(QfErrorCode.FIELD_REQUIRED, `必填字段缺失: ${f.label}(${f.key})`, f.key);
    }
    if (!missing && !checkType(v, f.type)) {
      throw new QfError(
        QfErrorCode.FIELD_TYPE_MISMATCH,
        `字段类型不匹配: ${f.label}(${f.key}) 期望 ${f.type}`,
        f.key
      );
    }
    if (!missing && f.type === "select" && f.options && !f.options.includes(v as string)) {
      throw new QfError(
        QfErrorCode.FIELD_TYPE_MISMATCH,
        `字段值不在可选项内: ${f.label}(${f.key})`,
        f.key
      );
    }
  }
}

/**
 * 校验 schema 变更：只允许追加。旧字段被删除、改名或改类型即拒绝。
 */
export function assertSchemaAppendOnly(oldFields: FieldDef[], newFields: FieldDef[]): void {
  for (const o of oldFields) {
    const n = newFields.find((f) => f.key === o.key);
    if (!n) {
      throw new QfError(
        QfErrorCode.SCHEMA_CHANGE_REJECTED,
        `不允许删除字段: ${o.label}(${o.key})，schema 只允许追加`,
        o.key
      );
    }
    if (n.type !== o.type) {
      throw new QfError(
        QfErrorCode.SCHEMA_CHANGE_REJECTED,
        `不允许修改字段类型: ${o.label}(${o.key}) ${o.type} -> ${n.type}`,
        o.key
      );
    }
  }
}
