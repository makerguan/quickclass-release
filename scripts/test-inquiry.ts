import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 查找对话活动"理解方程"
  const pc = await prisma.presetConversation.findFirst({
    where: { title: '理解方程' },
    include: {
      subProject: {
        include: { task: true }
      }
    }
  });
  
  console.log('=== 对话活动 ===');
  if (pc) {
    console.log(`ID: ${pc.id}`);
    console.log(`标题: ${pc.title}`);
    console.log(`描述: ${pc.description}`);
    console.log(`SystemPrompt: ${pc.systemPrompt}`);
    console.log(`子项目: ${pc.subProject.title}`);
    console.log(`课堂: ${pc.subProject.task.title}`);
  } else {
    console.log('未找到"理解方程"对话活动');
  }
  
  // 查找班级"七年级（1）班"
  const cls = await prisma.class.findFirst({
    where: { name: '七年级（1）班' },
    include: { teacher: true }
  });
  
  console.log('\n=== 班级 ===');
  if (cls) {
    console.log(`ID: ${cls.id}`);
    console.log(`名称: ${cls.name}`);
    console.log(`教师: ${cls.teacher.name}`);
  } else {
    console.log('未找到"七年级（1）班"');
  }
  
  // 查找该班级的学生
  if (cls) {
    const students = await prisma.user.findMany({
      where: { classId: cls.id, role: 'STUDENT' },
      take: 10
    });
    console.log('\n=== 该班学生 ===');
    console.log(`共 ${students.length} 名学生`);
    students.forEach(s => {
      console.log(`ID: ${s.id}, 名称: ${s.name}`);
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());