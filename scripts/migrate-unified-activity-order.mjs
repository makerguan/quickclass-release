/**
 * 跨类型统一活动排序 —— 存量数据一次性重排（2026-10-12）
 *
 * 背景：一个学习活动（SubProject）下 4 类活动（对话/探究/项目/作业）历史上各自维护
 * sortOrder（类型内计数），现改为 4 表共用一个数值空间（跨类型统一排序）。
 * 本脚本把每个 SubProject 下的活动按「类型优先级（对话→探究→项目→作业）→ 原 sortOrder → createdAt」
 * 稳定重排为 0..n-1 连续值，重排后初始顺序与旧学生端分组展示顺序一致。
 *
 * 运行：node scripts/migrate-unified-activity-order.mjs
 * 幂等：可重复执行（同输入 → 同输出）。
 *
 * 🔗 RELATED: src/lib/activities/unified-order.ts（TYPE_PRIORITY 口径必须与本脚本一致）
 *
 * ⚠️ 运行前必须备份 dev.db：cp prisma/prisma/dev.db prisma/prisma/dev.db.bak-$(date +%Y%m%d)
 * ⛔ DO NOT REVERT: 重排后不要再把任何创建/编辑路径改回"类型内下标计数"。
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// 从 .env 读取 DATABASE_URL（DATABASE_URL 相对 prisma/schema.prisma 所在目录解析，
// 生成的 Prisma client 会以 schema 目录为基准，所以这里只需设置环境变量值本身）
try {
  const env = readFileSync(resolve(ROOT, ".env"), "utf8");
  const m = env.match(/^DATABASE_URL=["']?([^"'\r\n]+)["']?/m);
  if (m && !process.env.DATABASE_URL) process.env.DATABASE_URL = m[1].trim();
} catch {
  // .env 不存在时依赖已有环境变量
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// 与 src/lib/activities/unified-order.ts 的 TYPE_PRIORITY 保持一致
const TYPE_PRIORITY = { conversation: 0, exploration: 1, project: 2, quiz: 3 };
const MODELS = {
  conversation: "presetConversation",
  exploration: "explorationActivity",
  project: "projectSubmission",
  quiz: "quizActivity",
};

async function main() {
  const sps = await prisma.subProject.findMany({ select: { id: true, title: true }, orderBy: { sortOrder: "asc" } });
  console.log(`共 ${sps.length} 个学习活动待处理`);

  let totalMoved = 0;
  for (const sp of sps) {
    const [conversations, explorations, projects, quizzes] = await Promise.all([
      prisma.presetConversation.findMany({ where: { subProjectId: sp.id }, select: { id: true, sortOrder: true, createdAt: true } }),
      prisma.explorationActivity.findMany({ where: { subProjectId: sp.id }, select: { id: true, sortOrder: true, createdAt: true } }),
      prisma.projectSubmission.findMany({ where: { subProjectId: sp.id }, select: { id: true, sortOrder: true, createdAt: true } }),
      prisma.quizActivity.findMany({ where: { subProjectId: sp.id }, select: { id: true, sortOrder: true, createdAt: true } }),
    ]);

    const merged = [
      ...conversations.map((x) => ({ ...x, type: "conversation" })),
      ...explorations.map((x) => ({ ...x, type: "exploration" })),
      ...projects.map((x) => ({ ...x, type: "project" })),
      ...quizzes.map((x) => ({ ...x, type: "quiz" })),
    ].sort((a, b) =>
      TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] ||
      a.sortOrder - b.sortOrder ||
      a.createdAt.getTime() - b.createdAt.getTime()
    );

    const updates = [];
    merged.forEach((item, idx) => {
      if (item.sortOrder !== idx) {
        updates.push(
          prisma[MODELS[item.type]].update({ where: { id: item.id }, data: { sortOrder: idx } })
        );
      }
    });
    if (updates.length > 0) {
      await prisma.$transaction(updates);
      totalMoved += updates.length;
      console.log(
        `[SP ${sp.id}] "${sp.title}"：${merged.length} 个活动，重排 ${updates.length} 条` +
          `（对话${conversations.length}/探究${explorations.length}/项目${projects.length}/作业${quizzes.length}）`
      );
    }
  }
  console.log(`完成：共更新 ${totalMoved} 条 sortOrder`);
}

main()
  .catch((e) => {
    console.error("迁移失败:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
