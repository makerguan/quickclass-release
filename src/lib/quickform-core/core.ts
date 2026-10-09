/**
 * QuickFormCore —— quickform-core SDK 主类（接口契约冻结 v1）
 *
 * 只管数据：任务 CRUD + 数据写入/查询/计数/导出。不管展示（大屏由 QuickClass 侧 AI 生成，
 * 通过 getTaskSchema + listRecords 两个接口对接）。
 *
 * 用法：
 *   const core = new QuickFormCore(new PrismaAdapter(prisma)); // QuickClass 内置
 *   const core = new QuickFormCore(new MemoryAdapter());       // 测试
 */
import type {
  FieldDef,
  PageOpts,
  PagedRecords,
  QfRecord,
  RecordData,
  RecordRow,
  StorageAdapter,
  SubmitMeta,
  TaskInfo,
  TaskRow,
} from "./types";
import { QfErrorCode, QfError } from "./errors";
import { generateRecordId, generateTaskId } from "./id";
import { assertSchemaAppendOnly, validateAgainstSchema } from "./validation";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

/** data 中的保留字段（规范 §4），读取时自动合并 */
export const RESERVED_KEYS = {
  recordId: "_record_id",
  submittedAt: "_submitted_at",
  ip: "_ip",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function rowToTaskInfo(row: TaskRow): TaskInfo {
  return {
    taskId: row.id,
    name: row.name,
    fields: JSON.parse(row.fieldsJson) as FieldDef[],
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToRecord(row: RecordRow): QfRecord {
  const data = JSON.parse(row.dataJson) as RecordData;
  // 保留字段合并进 data（沿用 QuickForm 读取时合并 submitted_at 的行为）
  data[RESERVED_KEYS.recordId] = row.id;
  data[RESERVED_KEYS.submittedAt] = row.submittedAt;
  return {
    recordId: row.id,
    taskId: row.taskId,
    data,
    submittedAt: row.submittedAt,
    ...(row.studentId ? { studentId: row.studentId } : {}),
  };
}

function matchFilter(data: RecordData, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  for (const [k, v] of Object.entries(filter)) {
    if (data[k] !== v) return false;
  }
  return true;
}

export class QuickFormCore {
  private readonly store: StorageAdapter;

  constructor(store: StorageAdapter) {
    this.store = store;
  }

  /** 建任务。fields 可选：不定义则提交为自由 JSON（QuickForm 原版行为） */
  async createTask(name: string, fields?: FieldDef[]): Promise<TaskInfo> {
    if (!name || !name.trim()) {
      throw new QfError(QfErrorCode.FIELD_REQUIRED, "任务名称不能为空", "name");
    }
    const now = nowIso();
    const row: TaskRow = {
      id: generateTaskId(),
      name: name.trim(),
      fieldsJson: JSON.stringify(fields ?? []),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveTask(row);
    return rowToTaskInfo(row);
  }

  /** 校验任务状态与数据，构造待写入的 RecordRow（submit / replaceRecord 共用，消除重复校验） */
  private async buildRecord(taskId: string, data: RecordData, meta?: SubmitMeta): Promise<RecordRow> {
    const task = await this.store.getTask(taskId);
    if (!task) throw new QfError(QfErrorCode.TASK_NOT_FOUND, `任务不存在: ${taskId}`);
    if (task.status !== "open") {
      throw new QfError(QfErrorCode.TASK_CLOSED, `任务已关闭收集: ${task.name}`);
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new QfError(QfErrorCode.FIELD_TYPE_MISMATCH, "提交数据必须是对象", "data");
    }
    const fields = JSON.parse(task.fieldsJson) as FieldDef[];
    if (fields.length > 0) validateAgainstSchema(fields, data);

    return {
      id: generateRecordId(),
      taskId: task.id,
      dataJson: JSON.stringify({ ...data, ...(meta?.ip ? { [RESERVED_KEYS.ip]: meta.ip } : {}) }),
      studentId: meta?.studentId || null,
      submittedAt: nowIso(),
    };
  }

  /** 写入一条数据。任务不存在/已关闭/校验失败抛 QfError */
  async submit(taskId: string, data: RecordData, meta?: SubmitMeta): Promise<QfRecord> {
    const row = await this.buildRecord(taskId, data, meta);
    await this.store.saveRecord(row);
    return rowToRecord(row);
  }

  /**
   * 重提交：删旧记录 + 写新记录必须原子（adapter 的 replaceRecord 保证）。
   * ⚠️ GOTCHA：不要在这里拆成「delete + submit」两步——两步之间进程崩溃会丢答案。
   */
  async replaceRecord(taskId: string, oldRecordId: string, data: RecordData, meta?: SubmitMeta): Promise<QfRecord> {
    const row = await this.buildRecord(taskId, data, meta);
    await this.store.replaceRecord(taskId, oldRecordId, row);
    return rowToRecord(row);
  }

  /** 读单条 */
  async getRecord(taskId: string, recordId: string): Promise<QfRecord> {
    await this.getTaskOrThrow(taskId);
    const row = await this.store.getRecord(taskId, recordId);
    if (!row) throw new QfError(QfErrorCode.TASK_NOT_FOUND, `记录不存在: ${recordId}`);
    return rowToRecord(row);
  }

  /** 读全部/按字段过滤/分页；studentIds 传入时只返回这些学生的记录（班级过滤用） */
  async listRecords(
    taskId: string,
    filter?: Record<string, unknown>,
    page?: PageOpts,
    studentIds?: string[]
  ): Promise<PagedRecords> {
    await this.getTaskOrThrow(taskId);
    const idSet = studentIds ? new Set(studentIds) : null;
    const rows = await this.store.queryRecords(taskId, filter);
    const matched: QfRecord[] = [];
    for (const row of rows) {
      if (idSet && (!row.studentId || !idSet.has(row.studentId))) continue;
      const rec = rowToRecord(row);
      if (matchFilter(rec.data, filter)) matched.push(rec);
    }
    matched.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)); // 新提交在前
    const pageNum = Math.max(1, page?.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, page?.pageSize ?? DEFAULT_PAGE_SIZE));
    const start = (pageNum - 1) * pageSize;
    return {
      items: matched.slice(start, start + pageSize),
      total: matched.length,
      page: pageNum,
      pageSize,
    };
  }

  /** 计数（课堂实时进度），支持按字段过滤 */
  async countRecords(taskId: string, filter?: Record<string, unknown>): Promise<number> {
    await this.getTaskOrThrow(taskId);
    const rows = await this.store.queryRecords(taskId, filter);
    let n = 0;
    for (const row of rows) {
      if (matchFilter(JSON.parse(row.dataJson) as RecordData, filter)) n++;
    }
    return n;
  }

  /** 改任务。fields 只允许追加（删除/改名/改类型 → SCHEMA_CHANGE_REJECTED） */
  async updateTask(taskId: string, patch: { name?: string; fields?: FieldDef[] }): Promise<TaskInfo> {
    const row = await this.getTaskOrThrow(taskId);
    if (patch.name !== undefined) {
      if (!patch.name.trim()) {
        throw new QfError(QfErrorCode.FIELD_REQUIRED, "任务名称不能为空", "name");
      }
      row.name = patch.name.trim();
    }
    if (patch.fields !== undefined) {
      const oldFields = JSON.parse(row.fieldsJson) as FieldDef[];
      assertSchemaAppendOnly(oldFields, patch.fields);
      row.fieldsJson = JSON.stringify(patch.fields);
    }
    row.updatedAt = nowIso();
    await this.store.updateTask(row);
    return rowToTaskInfo(row);
  }

  /** 删任务（级联删数据） */
  async deleteTask(taskId: string): Promise<void> {
    await this.getTaskOrThrow(taskId);
    await this.store.deleteTask(taskId);
  }

  /** 开/关收集。活动结束关闭，防课后乱提交 */
  async setTaskStatus(taskId: string, status: "open" | "closed"): Promise<TaskInfo> {
    const row = await this.getTaskOrThrow(taskId);
    row.status = status;
    row.updatedAt = nowIso();
    await this.store.updateTask(row);
    return rowToTaskInfo(row);
  }

  /** 任务列表（管理/找回场景） */
  async listTasks(keyword?: string, page?: PageOpts): Promise<{ tasks: TaskInfo[]; total: number }> {
    const pageNum = Math.max(1, page?.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, page?.pageSize ?? DEFAULT_PAGE_SIZE));
    const { rows, total } = await this.store.listTasks({ keyword, page: pageNum, pageSize });
    return { tasks: rows.map(rowToTaskInfo), total };
  }

  /** 清空任务数据（演示/重上场景），任务本身保留 */
  async clearRecords(taskId: string): Promise<void> {
    await this.getTaskOrThrow(taskId);
    await this.store.clearRecords(taskId);
  }

  /** 导出 CSV（UTF-8 BOM，Excel 直开不乱码）。列 = schema 字段 + 发现的额外键 + 保留字段 */
  async exportCsv(taskId: string): Promise<string> {
    const task = await this.getTaskOrThrow(taskId);
    const rows = await this.store.queryRecords(taskId);
    const records = rows.map(rowToRecord).sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

    const declared = JSON.parse(task.fieldsJson) as FieldDef[];
    const columns: string[] = declared.map((f) => f.key);
    const reserved = Object.values(RESERVED_KEYS) as string[];
    const seen = new Set<string>(columns);
    for (const rec of records) {
      for (const k of Object.keys(rec.data)) {
        if (!seen.has(k) && !reserved.includes(k)) {
          columns.push(k);
          seen.add(k);
        }
      }
    }
    columns.push(RESERVED_KEYS.recordId, RESERVED_KEYS.submittedAt);

    const escape = (v: unknown): string => {
      const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.map(escape).join(",")];
    for (const rec of records) {
      lines.push(columns.map((c) => escape(rec.data[c])).join(","));
    }
    return "\uFEFF" + lines.join("\r\n");
  }

  /** 给 AI 大屏生成器用：返回任务 schema（大屏与 SDK 的唯一契约之一） */
  async getTaskSchema(taskId: string): Promise<{ taskId: string; name: string; fields: FieldDef[] }> {
    const task = await this.getTaskOrThrow(taskId);
    return { taskId: task.id, name: task.name, fields: JSON.parse(task.fieldsJson) as FieldDef[] };
  }

  private async getTaskOrThrow(taskId: string): Promise<TaskRow> {
    const row = await this.store.getTask(taskId);
    if (!row) throw new QfError(QfErrorCode.TASK_NOT_FOUND, `任务不存在: ${taskId}`);
    return row;
  }
}
