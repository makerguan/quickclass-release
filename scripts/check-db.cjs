const { PrismaClient } = require("./src/lib/prisma");
const prisma = new PrismaClient();
async function main() {
  const attempts = await prisma.quizAttempt.findMany({
    include: { 
      user: { select: { name: true, classId: true } }, 
      quizActivity: { select: { title: true } } 
    }
  });
  console.log('=== QuizAttempts ===');
  console.log('数量:', attempts.length);
  attempts.forEach(a => {
    console.log(`  ${a.user.name} - ${a.quizActivity.title} - 分数: ${a.score} - status: ${a.status}`);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());