/**
 * 模拟5个七年级(2)班学生答题
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== 模拟学生参与答题 ===\n");

  // 1. 找到七年级(2)班
  const class2 = await prisma.class.findFirst({
    where: { name: "七年级(2)班" }
  });

  if (!class2) {
    console.error("未找到七年级(2)班");
    return;
  }

  // 2. 找到该班级参与的课堂
  const assignments = await prisma.taskAssignment.findMany({
    where: { classId: class2.id },
    include: {
      task: {
        include: {
          subProjects: {
            include: {
              PresetConversation: true,
              QuizActivity: {
                include: {
                  Question: { orderBy: { order: "asc" } }
                }
              }
            }
          }
        }
      }
    }
  });

  if (assignments.length === 0) {
    console.error("该班级未参与任何课堂");
    return;
  }

  // 找一个有作业的课堂
  const activeAssignment = assignments.find(a => 
    a.task.subProjects.some(sp => sp.QuizActivity.length > 0)
  );

  if (!activeAssignment) {
    console.error("未找到有作业的课堂");
    return;
  }

  const task = activeAssignment.task;
  console.log(`课堂: ${task.title}`);

  // 3. 获取学生
  const students = await prisma.user.findMany({
    where: { classId: class2.id },
    take: 5
  });

  console.log(`学生: ${students.length}人`);

  // 4. 找作业
  const subProject = task.subProjects.find(sp => sp.QuizActivity.length > 0);
  if (!subProject || subProject.QuizActivity.length === 0) {
    console.error("未找到作业");
    return;
  }

  const quiz = subProject.QuizActivity[0];
  console.log(`\n作业: ${quiz.title}`);
  console.log(`题目数量: ${quiz.Question.length}`);

  if (quiz.Question.length === 0) {
    console.log("该作业暂无题目");
    return;
  }

  // 5. 每个学生答题
  for (const student of students) {
    console.log(`\n${student.name} 答题中...`);

    // 创建 QuizAttempt
    const attempt = await prisma.quizAttempt.create({
      data: {
        quizActivityId: quiz.id,
        userId: student.id,
        score: 0,
        startedAt: new Date(),
      }
    });

    let totalScore = 0;

    // 每道题都回答
    for (const q of quiz.Question) {
      // 模拟答案 - 随机对错（70%正确率）
      const isCorrect = Math.random() < 0.7;
      const maxScore = q.score || 10;
      
      let selectedAnswer = q.answer; // 正确
      if (!isCorrect) {
        // 错误答案
        if (q.type === "SINGLE_CHOICE") {
          const opts = ["A", "B", "C", "D"].filter(o => o !== q.answer);
          selectedAnswer = opts[Math.floor(Math.random() * opts.length)];
        } else if (q.type === "TRUE_FALSE") {
          selectedAnswer = q.answer === "T" ? "F" : "T";
        } else if (q.type === "MULTIPLE_CHOICE") {
          const allOpts = q.answer.split(",").map((s: string) => s.trim());
          const wrongOpts = ["A", "B", "C", "D"].filter(o => !allOpts.includes(o));
          selectedAnswer = wrongOpts[Math.floor(Math.random() * wrongOpts.length)];
        }
      }

      await prisma.questionAttempt.create({
        data: {
          quizAttemptId: attempt.id,
          questionId: q.id,
          selectedAnswer,
          isCorrect,
          score: isCorrect ? maxScore : 0
        }
      });

      totalScore += isCorrect ? maxScore : 0;
    }

    // 更新总分
    await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: { score: totalScore }
    });

    console.log(`  完成! 分数: ${totalScore}/${quiz.Question.reduce((s: number, q: any) => s + (q.score || 10), 0)}`);
  }

  console.log("\n\n=== 模拟完成 ===");
  console.log("你现在可以在教师端查看作业报告，看到5个学生的答题数据。");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());