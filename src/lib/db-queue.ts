import PQueue from "p-queue";

// ============================================================
// SQLite 写操作队列：将所有数据库写入串行化
// 避免 SQLite 文件锁在高并发写入时冲突
// ============================================================
export const dbWriteQueue = new PQueue({ concurrency: 1, autoStart: true });

// 封装的写操作方法，使用队列保证串行执行
export async function dbWrite<T>(operation: () => Promise<T>): Promise<T> {
  return dbWriteQueue.add(operation) as Promise<T>;
}
