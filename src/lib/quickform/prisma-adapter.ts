/**
 * PrismaAdapter —— QuickForm SDK 的 StorageAdapter 实现（规范 §7）
 *
 * 只依赖 QfTask / QfRecord 两张表（qf_ 前缀独立命名空间），
 * 不与 QuickClass 业务表建立任何关系，互不影响。
 */
import type { PrismaClient } from "@prisma/client";
import type {
  ListTasksOpts,
  RecordRow,
  StorageAdapter,
  TaskRow,
} from "@/lib/quickform-core";

/** Prisma 返回的行（日期为 Date，需转 ISO 字符串交给 SDK） */
interface QfTaskRow {
  id: string;
  name: string;
  fieldsJson: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface QfRecordRow {
  id: string;
  taskId: string;
  dataJson: string;
  studentId: string | null;
  submittedAt: Date;
}

function toTaskRow(m: QfTaskRow): TaskRow {
  return {
    id: m.id,
    name: m.name,
    fieldsJson: m.fieldsJson,
    // DB 里是自由字符串，收窄回 SDK 契约的联合类型
    status: m.status === "closed" ? "closed" : "open",
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function toRecordRow(m: QfRecordRow): RecordRow {
  return {
    id: m.id,
    taskId: m.taskId,
    dataJson: m.dataJson,
    studentId: m.studentId,
    submittedAt: m.submittedAt.toISOString(),
  };
}

export class PrismaAdapter implements StorageAdapter {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async saveTask(task: TaskRow): Promise<void> {
    await this.prisma.qfTask.create({
      data: {
        id: task.id,
        name: task.name,
        fieldsJson: task.fieldsJson,
        status: task.status,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt),
      },
    });
  }

  async getTask(taskId: string): Promise<TaskRow | null> {
    const row = await this.prisma.qfTask.findUnique({ where: { id: taskId } });
    return row ? toTaskRow(row) : null;
  }

  async listTasks(opts: ListTasksOpts): Promise<{ rows: TaskRow[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.max(1, Math.min(500, opts.pageSize ?? 50));
    const keyword = opts.keyword?.trim();
    const where = keyword ? { name: { contains: keyword } } : {};

    const [rows, total] = await Promise.all([
      this.prisma.qfTask.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.qfTask.count({ where }),
    ]);
    return { rows: rows.map(toTaskRow), total };
  }

  async updateTask(task: TaskRow): Promise<void> {
    await this.prisma.qfTask.update({
      where: { id: task.id },
      data: {
        name: task.name,
        fieldsJson: task.fieldsJson,
        status: task.status,
        updatedAt: new Date(task.updatedAt),
      },
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    // 显式先删记录：不依赖 SQLite 外键级联开关，行为确定
    await this.prisma.$transaction([
      this.prisma.qfRecord.deleteMany({ where: { taskId } }),
      this.prisma.qfTask.delete({ where: { id: taskId } }),
    ]);
  }

  async saveRecord(record: RecordRow): Promise<void> {
    await this.prisma.qfRecord.create({
      data: {
        id: record.id,
        taskId: record.taskId,
        dataJson: record.dataJson,
        studentId: record.studentId || null,
        submittedAt: new Date(record.submittedAt),
      },
    });
  }

  /**
   * 原子替换：删旧记录 + 写新记录放进同一条事务。
   * ⚠️ GOTCHA：若拆成 deleteMany 后再 create，两步之间进程崩溃会丢答案；
   *   这里用 $transaction 保证「要么都成、要么都不成」，堵住崩溃窗口。
   * ⛔ DO NOT REVERT：不要改回「先 deleteRecord 再 saveRecord」的两步写法。
   */
  async replaceRecord(taskId: string, oldRecordId: string, record: RecordRow): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.qfRecord.deleteMany({ where: { id: oldRecordId, taskId } }),
      this.prisma.qfRecord.create({
        data: {
          id: record.id,
          taskId: record.taskId,
          dataJson: record.dataJson,
          studentId: record.studentId || null,
          submittedAt: new Date(record.submittedAt),
        },
      }),
    ]);
  }

  async getRecord(taskId: string, recordId: string): Promise<RecordRow | null> {
    const row = await this.prisma.qfRecord.findFirst({
      where: { id: recordId, taskId },
    });
    return row ? toRecordRow(row) : null;
  }

  async queryRecords(
    taskId: string,
    filter?: Record<string, unknown>
  ): Promise<RecordRow[]> {
    const rows = await this.prisma.qfRecord.findMany({ where: { taskId } });
    const mapped = rows.map(toRecordRow);
    if (!filter || Object.keys(filter).length === 0) return mapped;

    // data 以 JSON 文本存储，等值过滤只能在内存做。
    // SDK 层（listRecords / countRecords）还会再过滤一次，幂等无害。
    return mapped.filter((r) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(r.dataJson) as Record<string, unknown>;
      } catch {
        return false;
      }
      return Object.entries(filter).every(([k, v]) => data[k] === v);
    });
  }

  async clearRecords(taskId: string): Promise<void> {
    await this.prisma.qfRecord.deleteMany({ where: { taskId } });
  }
}
