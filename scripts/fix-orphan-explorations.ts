import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixOrphanExplorations() {
  console.log('=== 检测孤立 ExplorationActivity 记录 ===\n');

  const allExplorations = await prisma.explorationActivity.findMany({
    include: { SubProject: true },
  });

  const orphans = allExplorations.filter(e => !e.SubProject);
  const valid = allExplorations.filter(e => e.SubProject);

  console.log(`总数: ${allExplorations.length}`);
  console.log(`正常: ${valid.length}`);
  console.log(`孤立(需修复): ${orphans.length}\n`);

  if (orphans.length === 0) {
    console.log('✅ 没有孤立记录，数据库正常');
    await prisma.$disconnect();
    return;
  }

  console.log('孤立记录详情:');
  for (const o of orphans) {
    console.log(`  - ID: ${o.id}, 标题: ${o.title}, subProjectId: ${o.subProjectId}`);
  }

  console.log('\n⚙️  开始修复...');

  // 方案1: 删除孤立记录（如果相关子项目已不可恢复）
  console.log('\n选项:');
  console.log('  1) 删除所有孤立记录');
  console.log('  2) 只查看，不操作');
  console.log('\n执行: 使用方案1');

  for (const o of orphans) {
    await prisma.explorationSubmission.deleteMany({
      where: { explorationId: o.id },
    });
    await prisma.explorationActivity.delete({
      where: { id: o.id },
    });
    console.log(`  ✅ 已删除孤立记录: ${o.title} (${o.id})`);
  }

  console.log(`\n✅ 修复完成，共删除 ${orphans.length} 条孤立记录`);

  await prisma.$disconnect();
}

fixOrphanExplorations().catch((e) => {
  console.error('脚本执行失败:', e);
  prisma.$disconnect();
  process.exit(1);
});
