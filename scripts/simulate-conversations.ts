/**
 * 模拟学生参与对话活动
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== 模拟学生参与对话活动 ===\n");

  // 1. 找到七年级(2)班
  const class2 = await prisma.class.findFirst({
    where: { name: "七年级(2)班" }
  });

  if (!class2) {
    console.error("未找到七年级(2)班");
    return;
  }

  // 2. 找到对话活动
  const pc = await prisma.presetConversation.findFirst({
    include: { SubProject: true }
  });

  if (!pc) {
    console.error("未找到对话活动");
    return;
  }

  console.log("对话活动:", pc.title);
  console.log("SubProject:", pc.SubProject?.title);

  // 3. 获取学生
  const students = await prisma.user.findMany({
    where: { classId: class2.id, role: "STUDENT" },
    take: 5
  });

  console.log("学生数量:", students.length);

  // 4. 每个学生参与对话
  for (const student of students) {
    console.log(`\n${student.name} 参与对话...`);

    // 创建对话
    const conv = await prisma.conversation.create({
      data: {
        presetConversationId: pc.id,
        userId: student.id,
        classId: class2.id,
        title: pc.title,
        updatedAt: new Date()
      }
    });

    // 模拟发送消息
    const messages = [
      "老师好，我想问一下这个问题的答案是什么？",
      "我有点不理解，能详细解释一下吗？",
      "谢谢老师，我明白了！"
    ];

    for (const content of messages) {
      const msg = await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: "student",
          content
        }
      });
      console.log(`  ${student.name}: ${content.substring(0, 15)}...`);
    }
  }

  console.log("\n\n=== 模拟完成 ===");
}

main().catch(console.error).finally(() => prisma.$disconnect());