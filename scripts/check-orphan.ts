import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 检查孤悬数据（无归属用户的记录）===\n');

  // 获取所有有效学生 ID
  const validStudentIds = (await prisma.user.findMany({ where: { role: 'STUDENT' }, select: { id: true } })).map(u => u.id);
  const validUserIds = (await prisma.user.findMany({ select: { id: true } })).map(u => u.id);
  console.log(`当前有效学生数: ${validStudentIds.length}`);
  console.log(`当前有效用户总数: ${validUserIds.length}\n`);

  // 1. Conversation
  const orphanConvs = await prisma.conversation.findMany({
    where: { userId: { notIn: validUserIds } },
    include: { _count: { select: { messages: true } } },
  });
  if (orphanConvs.length > 0) {
    console.log(`❌ Conversation 孤悬: ${orphanConvs.length} 条`);
    orphanConvs.forEach(c => console.log(`   ID: ${c.id}, 消息数: ${c._count.messages}, 关联class: ${c.classId}`));
  } else {
    console.log('✅ Conversation: 无孤悬数据');
  }

  // 2. ExplorationSubmission
  const orphanSubmissions = await prisma.explorationSubmission.findMany({
    where: { studentId: { notIn: validStudentIds } },
  });
  if (orphanSubmissions.length > 0) {
    console.log(`❌ ExplorationSubmission 孤悬: ${orphanSubmissions.length} 条`);
    orphanSubmissions.forEach(s => console.log(`   ID: ${s.id}, studentId: ${s.studentId}`));
  } else {
    console.log('✅ ExplorationSubmission: 无孤悬数据');
  }

  // 3. AIInsight
  const orphanInsights = await prisma.aIInsight.findMany({
    where: { userId: { not: null }, userId: { notIn: validUserIds } },
  });
  if (orphanInsights.length > 0) {
    console.log(`❌ AIInsight 孤悬: ${orphanInsights.length} 条`);
  } else {
    console.log('✅ AIInsight: 无孤悬数据');
  }

  // 4. QuizAttempt
  const orphanAttempts = await prisma.quizAttempt.findMany({
    where: { userId: { notIn: validUserIds } },
  });
  if (orphanAttempts.length > 0) {
    console.log(`❌ QuizAttempt 孤悬: ${orphanAttempts.length} 条`);
  } else {
    console.log('✅ QuizAttempt: 无孤悬数据');
  }

  // 5. ExerciseAttempt
  const orphanExercises = await prisma.exerciseAttempt.findMany({
    where: { userId: { notIn: validUserIds } },
  });
  if (orphanExercises.length > 0) {
    console.log(`❌ ExerciseAttempt 孤悬: ${orphanExercises.length} 条`);
  } else {
    console.log('✅ ExerciseAttempt: 无孤悬数据');
  }

  // 6. Evaluation
  const orphanEvals = await prisma.evaluation.findMany({
    where: { userId: { notIn: validUserIds } },
  });
  if (orphanEvals.length > 0) {
    console.log(`❌ Evaluation 孤悬: ${orphanEvals.length} 条`);
  } else {
    console.log('✅ Evaluation: 无孤悬数据');
  }

  // 7. LearningProgress
  const orphanProgress = await prisma.learningProgress.findMany({
    where: { userId: { notIn: validUserIds } },
  });
  if (orphanProgress.length > 0) {
    console.log(`❌ LearningProgress 孤悬: ${orphanProgress.length} 条`);
  } else {
    console.log('✅ LearningProgress: 无孤悬数据');
  }

  console.log('\n=== 检查完成 ===');
  await prisma.$disconnect();
}

main().catch(console.error);