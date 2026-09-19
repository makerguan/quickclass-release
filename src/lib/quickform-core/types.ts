/**
 * quickform-core 类型定义
 * 规范依据：quickform-core-sdk-设计规范 v0.4（接口契约冻结 v1）
 */

/** 字段类型（schema 校验用） */
export type FieldType = "text" | "textarea" | "number" | "boolean" | "select" | "date";

/** 任务字段定义（schema） */
export interface FieldDef {
  /** 字段键名（存入 data 的 key），如 student_name */
  key: string;
  /** 显示名，如 "学生姓名" */
  label: string;
  type: FieldType;
  required?: boolean;
  /** type=select 时的可选项 */
  options?: string[];
}

/** 任务信息（对外返回，不含存储细节） */
export interface TaskInfo {
  taskId: string;
  name: string;
  fields: FieldDef[];
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
}

/** 提交数据（自由 JSON；schema 定义了字段时按 schema 校验） */
export type RecordData = Record<string, unknown>;

/** 提交附加信息（HTTP 层捕获后传入） */
export interface SubmitMeta {
  /** 客户端 IP，由 QC 路由层捕获传入，SDK 自动写入 _ip */
  ip?: string;
  /** 提交学生（User.id）；匿名提交不传 */
  studentId?: string;
}

/** 单条记录（读取时返回；data 内合并 _record_id / _submitted_at / _ip 保留字段） */
export interface QfRecord {
  recordId: string;
  taskId: string;
  data: RecordData;
  submittedAt: string;
  /** 提交学生（User.id）；匿名/存量记录为 undefined */
  studentId?: string;
}

/** 分页参数 */
export interface PageOpts {
  page?: number;  // 从 1 开始
  pageSize?: number; // 默认 50，最大 500
}

/** 分页结果 */
export interface PagedRecords {
  items: QfRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** 存储行（适配器层的数据结构） */
export interface TaskRow {
  id: string;
  name: string;
  fieldsJson: string;   // FieldDef[] JSON
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
}

export interface RecordRow {
  id: string;
  taskId: string;
  dataJson: string;     // RecordData JSON
  studentId?: string | null; // 提交学生；匿名/存量记录为空
  submittedAt: string;
}

/** 查询选项（适配器契约） */
export interface ListTasksOpts {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 存储适配器契约 —— SDK 内部只依赖此接口，不依赖具体存储。
 * 默认实现：MemoryAdapter（测试/参考）。QuickClass 内置时实现 PrismaAdapter（见 docs/prisma-adapter.md）。
 * 所有方法均为异步（Prisma 等真实存储天然异步）。
 */
export interface StorageAdapter {
  saveTask(task: TaskRow): Promise<void>;
  getTask(taskId: string): Promise<TaskRow | null>;
  listTasks(opts: ListTasksOpts): Promise<{ rows: TaskRow[]; total: number }>;
  updateTask(task: TaskRow): Promise<void>;
  /** 必须级联删除该任务全部记录 */
  deleteTask(taskId: string): Promise<void>;
  saveRecord(record: RecordRow): Promise<void>;
  getRecord(taskId: string, recordId: string): Promise<RecordRow | null>;
  /** filter 为 data 字段等值匹配；无 filter 返回该任务全部记录 */
  queryRecords(taskId: string, filter?: Record<string, unknown>): Promise<RecordRow[]>;
  clearRecords(taskId: string): Promise<void>;
}
