/**
 * QuickForm 服务端入口 —— 组装 SDK 与存储适配器（规范 §7）
 *
 * 业务代码一律 `import { getQfCore } from "@/lib/quickform"`，
 * 不直接 new QuickFormCore / PrismaAdapter。
 */
import { prisma } from "@/lib/prisma";
import { QuickFormCore } from "@/lib/quickform-core";
import { PrismaAdapter } from "./prisma-adapter";

let core: QuickFormCore | null = null;

/** SDK 单例（复用同一个 Prisma 连接） */
export function getQfCore(): QuickFormCore {
  if (!core) core = new QuickFormCore(new PrismaAdapter(prisma));
  return core;
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
