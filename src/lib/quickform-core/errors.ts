/**
 * 统一错误码（规范 §8 第 3 条，契约冻结）
 */
export const QfErrorCode = {
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  TASK_CLOSED: "TASK_CLOSED",
  FIELD_REQUIRED: "FIELD_REQUIRED",
  FIELD_TYPE_MISMATCH: "FIELD_TYPE_MISMATCH",
  TASK_NOT_OPEN: "TASK_NOT_OPEN",
  SCHEMA_CHANGE_REJECTED: "SCHEMA_CHANGE_REJECTED",
} as const;

export type QfErrorCodeValue = (typeof QfErrorCode)[keyof typeof QfErrorCode];

export class QfError extends Error {
  readonly code: QfErrorCodeValue;
  /** 出错字段的 key（FIELD_REQUIRED / FIELD_TYPE_MISMATCH / SCHEMA_CHANGE_REJECTED 时提供） */
  readonly field?: string;

  constructor(code: QfErrorCodeValue, message: string, field?: string) {
    super(`[${code}] ${message}`);
    this.name = "QfError";
    this.code = code;
    this.field = field;
  }
}
