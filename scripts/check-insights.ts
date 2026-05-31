import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== AIInsight 记录检查 ===\n');

  const allInsights = await prisma.aIInsight.findMany({ orderBy: { createdAt: 'desc' } });
  console.log(`AIInsight 总数: ${allInsights.length}\n`);
  
  for (const ins of allInsights) {
    const cls = await prisma.class.findUnique({ where: { id: ins.classId } });
    const className = cls?.name || '未知';
    console.log(`ID: ${ins.id}`);
    console.log(`  类型: ${ins.type}`);
    console.log(`  班级: ${className} (${ins.classId})`);
    console.log(`  scopeId: ${ins.scopeId}`);
    console.log(`  userId: ${ins.userId || '(无)'}`);
    console.log(`  版本: ${ins.version}`);
    console.log(`  内容前50字: ${ins.content.substring(0, 50)}`);
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(console.error);