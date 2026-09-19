/**
 * QuickForm 服务端入口 —— 组装 SDK 与存储适配器（规范 §7）
 *
 * 业务代码一律 `import { getQfCore } from "@/lib/quickform"`，
 * 不直接 new QuickFormCore / PrismaAdapter。
 */
import { prisma } from "@/lib/prisma";
import { QuickFormCore } from "@/lib/quickform-core";
import type { QfRecord } from "@/lib/quickform-core";
import { PrismaAdapter } from "./prisma-adapter";

let adapter: PrismaAdapter | null = null;
let core: QuickFormCore | null = null;

/** 存储适配器单例（PrismaAdapter 有 SDK 契约之外的扩展方法，业务层有时要直接取用） */
export function getQfAdapter(): PrismaAdapter {
  if (!adapter) adapter = new PrismaAdapter(prisma);
  return adapter;
}

/** SDK 单例（复用同一个 Prisma 连接） */
export function getQfCore(): QuickFormCore {
  if (!core) core = new QuickFormCore(getQfAdapter());
  return core;
}

/**
 * 写入一条收集数据。
 *
 * 传了 `replaceRecordId` 时先删旧记录再写新记录：SDK 契约里没有 updateRecord，
 * 这是「同一学生重新提交」不产生重复记录的唯一做法（保持一人一条）。
 */
export async function submitQfRecord(
  taskId: string,
  data: Record<string, unknown>,
  replaceRecordId?: string | null
): Promise<QfRecord> {
  const qfCore = getQfCore();
  if (replaceRecordId) {
    await getQfAdapter().deleteRecord(taskId, replaceRecordId);
  }
  return qfCore.submit(taskId, data);
}

/**
 * 从请求里取鉴权 token。
 * 上游 QC 前端统一用 `Authorization: Bearer <token>`；
 * 同时兼容 `x-auth-token`（魔搭适配线在用），避免两条线分叉。
 */
export function getAuthToken(req: {
  headers: { get(name: string): string | null };
}): string | null {
  const raw =
    req.headers.get("x-auth-token") || req.headers.get("authorization");
  if (!raw) return null;
  return raw.startsWith("Bearer ") ? raw.slice(7) : raw;
}

/** 取客户端 IP（写入记录的 _ip 保留字段） */
export function getClientIp(req: {
  headers: { get(name: string): string | null };
}): string | undefined {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || undefined;
}

export { QfError, QfErrorCode } from "@/lib/quickform-core";
