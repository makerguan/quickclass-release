import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const config = await prisma.systemConfig.findFirst();
  console.log('=== 系统配置 ===');
  console.log(`insightDataSource: ${config?.insightDataSource || 'CONVERSATIONS'}`);

  const task = await prisma.learningTask.findFirst({ where: { title: '一元一次方程' } });
  if (!task) { console.log('未找到任务'); return; }
  console.log(`\n任务: ${task.title} (${task.id})`);

  const sps = await prisma.subProject.findMany({ where: { taskId: task.id }, include: { presetConversations: true } });
  console.log(`子项目数: ${sps.length}`);
  for (const sp of sps) {
    console.log(`  ${sp.title} (${sp.id}): ${sp.presetConversations.length} 个对话活动`);
    for (const pc of sp.presetConversations) {
      const convCount = await prisma.conversation.count({ where: { presetConversationId: pc.id } });
      const msgCount = await prisma.message.count({ where: { conversation: { presetConversationId: pc.id } } });
      console.log(`    "${pc.title}" (${pc.id}): ${convCount} 次对话, ${msgCount} 条消息`);
    }
  }

  // 直接查数据库中是否存在对话
  const allConvs = await prisma.conversation.findMany({ take: 10 });
  console.log(`\n数据库中总对话记录: ${await prisma.conversation.count()}`);
  console.log(`数据库中总消息记录: ${await prisma.message.count()}`);
  console.log(`数据库中总学生数: ${await prisma.user.count({ where: { role: 'STUDENT' } })}`);

  if (allConvs.length > 0) {
    console.log('\n=== 对话示例 ===');
    allConvs.slice(0, 3).forEach(c => console.log(`  convId=${c.id}, userId=${c.userId}, classId=${c.classId}, pcId=${c.presetConversationId}, title=${c.title}`));
  }

  await prisma.$disconnect();
}

main().catch(console.error);