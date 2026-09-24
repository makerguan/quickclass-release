/**
 * MemoryAdapter —— 内存存储适配器（参考实现 + 单测用）
 * QuickClass 内置时请用 PrismaAdapter（见 docs/prisma-adapter.md）
 */
import type {
  ListTasksOpts,
  RecordRow,
  StorageAdapter,
  TaskRow,
} from "../types";

export class MemoryAdapter implements StorageAdapter {
  private tasks = new Map<string, TaskRow>();
  private records = new Map<string, RecordRow>(); // key: recordId

  async saveTask(task: TaskRow): Promise<void> {
    this.tasks.set(task.id, { ...task });
  }
  async getTask(taskId: string): Promise<TaskRow | null> {
    const t = this.tasks.get(taskId);
    return t ? { ...t } : null;
  }
  async listTasks(opts: ListTasksOpts): Promise<{ rows: TaskRow[]; total: number }> {
    let rows = [...this.tasks.values()];
    if (opts.keyword) {
      const kw = opts.keyword.toLowerCase();
      rows = rows.filter((t) => t.name.toLowerCase().includes(kw) || t.id.toLowerCase().includes(kw));
    }
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const page = Math.max(1, opts.page ?? 1);
    const size = Math.max(1, opts.pageSize ?? 50);
    return { rows: rows.slice((page - 1) * size, page * size).map((t) => ({ ...t })), total: rows.length };
  }
  async updateTask(task: TaskRow): Promise<void> {
    if (!this.tasks.has(task.id)) throw new Error(`task not found: ${task.id}`);
    this.tasks.set(task.id, { ...task });
  }
  async deleteTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    for (const [rid, r] of [...this.records]) {
      if (r.taskId === taskId) this.records.delete(rid);
    }
  }
  async saveRecord(record: RecordRow): Promise<void> {
    this.records.set(record.id, { ...record });
  }
  async replaceRecord(taskId: string, oldRecordId: string, record: RecordRow): Promise<void> {
    for (const [rid, r] of [...this.records]) {
      if (r.taskId === taskId && rid === oldRecordId) this.records.delete(rid);
    }
    this.records.set(record.id, { ...record });
  }
  async getRecord(taskId: string, recordId: string): Promise<RecordRow | null> {
    const r = this.records.get(recordId);
    return r && r.taskId === taskId ? { ...r } : null;
  }
  async queryRecords(taskId: string): Promise<RecordRow[]> {
    const out: RecordRow[] = [];
    for (const r of this.records.values()) {
      if (r.taskId === taskId) out.push({ ...r });
    }
    return out;
  }
  async clearRecords(taskId: string): Promise<void> {
    for (const [rid, r] of [...this.records]) {
      if (r.taskId === taskId) this.records.delete(rid);
    }
  }
}
