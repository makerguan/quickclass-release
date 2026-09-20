/**
 * quickform-core —— QuickForm 数据任务核心 SDK（vendor 副本）
 *
 * ⚠️ 本目录为 vendor 目录，**QuickClass 仓内只读，禁止手改**。
 * 唯一源码地：gitee.com/markets2022/quickform-core（版本见 VENDOR.md）
 * 修改 SDK 请到源仓改 → 打 tag → 用 vendor 脚本重新同步。
 */
export { QuickFormCore, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, RESERVED_KEYS } from "./core";
export { QfError, QfErrorCode } from "./errors";
export { generateTaskId, generateRecordId } from "./id";
export { validateAgainstSchema, assertSchemaAppendOnly } from "./validation";
// 内存适配器：仅测试 / 参考用，QC 运行时用 src/lib/quickform/prisma-adapter.ts
export { MemoryAdapter } from "./adapters/memory";
export type {
  FieldDef,
  FieldType,
  TaskInfo,
  RecordData,
  SubmitMeta,
  QfRecord,
  PageOpts,
  PagedRecords,
  TaskRow,
  RecordRow,
  ListTasksOpts,
  StorageAdapter,
} from "./types";
