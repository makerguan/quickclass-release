import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const quizId = "cmp7ng1sv003kgesa19mr4hs8";
  const teacherId = "cmp5nejzc00009gxbouyoa8y0";

  try {
    const quiz = await prisma.quizActivity.findFirst({
      where: { id: quizId, SubProject: { task: { teacherId } } },
      include: {
        Question: { orderBy: { order: "asc" } },
        QuizAttempt: {
          include: { User: { select: { id: true, name: true, classId: true } }, QuestionAttempt: true },
        },
      },
    });

    if (!quiz) {
      console.log("未找到作业");
      return;
    }

    console.log("找到作业:", quiz.title);
    console.log("学生数量:", quiz.QuizAttempt.length);
    
    for (const a of quiz.QuizAttempt) {
      console.log(`学生 ${a.User.name}: ${a.QuestionAttempt.length} 题答题记录`);
    }

    console.log("\n测试完成");
  } catch (e) {
    console.error("错误:", String(e));
  }
}

main().finally(() => prisma.$disconnect());