import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 诊断：对话活动学情分析数据流 ===\n');

  // 1. 查找所有对话活动
  const pcs = await prisma.presetConversation.findMany({ include: { subProject: { include: { task: true } } } });
  console.log(`共 ${pcs.length} 个对话活动:\n`);

  for (const pc of pcs) {
    console.log(`┌─ 对话活动: "${pc.title}" (${pc.id})`);
    console.log(`│  analysisPrompt: ${pc.analysisPrompt ? '✅ 已设置' : '❌ 未设置'}`);
    console.log(`│  systemPrompt: ${pc.systemPrompt ? '✅ 已设置' : '❌ 未设置'}`);

    // 2. 查询该对话活动下所有班级的对话记录
    const allConvs = await prisma.conversation.findMany({
      where: { presetConversationId: pc.id },
      include: {
        user: { select: { name: true, classId: true } },
        messages: { select: { id: true, role: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    console.log(`│  对话记录数: ${allConvs.length}`);

    if (allConvs.length > 0) {
      // 按班级分组
      const classGroups = new Map<string, typeof allConvs>();
      for (const conv of allConvs) {
        const cid = conv.user.classId || 'unknown';
        if (!classGroups.has(cid)) classGroups.set(cid, []);
        classGroups.get(cid)!.push(conv);
      }

      for (const [classId, convs] of classGroups) {
        const cls = await prisma.class.findUnique({ where: { id: classId } });
        const className = cls?.name || classId;
        const uniqueStudents = new Set(convs.map((c) => c.userId));
        const totalMessages = convs.reduce((s, c) => s + c.messages.length, 0);
        console.log(`│  ├─ 班级: "${className}" (${classId})`);
        console.log(`│  │  ${uniqueStudents.size} 名学生参与, ${totalMessages} 条消息`);
      }

      // 展示第一个对话的内容示例
      const sampleConv = allConvs[0];
      console.log(`│  └─ 示例对话(${sampleConv.user.name}): ${sampleConv.messages.length} 条消息`);
      const msgTexts = sampleConv.messages.slice(0, 4).map(m => `       ${m.role}: ${m.id.substring(0, 12)}...`);
      msgTexts.forEach(m => console.log(m));
    } else {
      console.log(`│  ❌ 无对话记录！`);
    }
    console.log('│');
  }

  // 3. 检查所有班级
  console.log('\n=== 班级信息 ===');
  const classes = await prisma.class.findMany({ include: { _count: { select: { students: true } } } });
  for (const cls of classes) {
    console.log(`班级: "${cls.name}" (${cls.id}), 学生数: ${cls._count.students}`);
  }

  // 4. 检查所有学生
  const students = await prisma.user.findMany({ where: { role: 'STUDENT' } });
  console.log(`\n学生总数: ${students.length}`);
  for (const s of students.slice(0, 10)) {
    const convCount = await prisma.conversation.count({ where: { userId: s.id } });
    console.log(`  ${s.name} (${s.id}): 对话 ${convCount} 次`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);