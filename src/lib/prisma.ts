import { PrismaClient } from "@prisma/client";

// 生产环境使用环境变量的 DATABASE_URL（PostgreSQL）
// 开发环境使用本地 dev.db（SQLite）
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
