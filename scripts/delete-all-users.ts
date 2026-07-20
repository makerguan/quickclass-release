import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('开始删除所有用户及关联数据（保留模板）...\n');

  try {
    await prisma.$transaction(async (tx) => {
      // 1. 删除最外层的叶子节点
      console.log('1. 删除消息...');
      const msgCount = await tx.message.deleteMany({});
      console.log(`   删除 ${msgCount.count} 条消息`);

      console.log('2. 删除文档块...');
      const chunkCount = await tx.documentChunk.deleteMany({});
      console.log(`   删除 ${chunkCount.count} 个文档块`);

      console.log('3. 删除探究操作日志...');
      const expLogCount = await tx.explorationActionLog.deleteMany({});
      console.log(`   删除 ${expLogCount.count} 条操作日志`);

      console.log('4. 删除答题记录...');
      const qaAttemptCount = await tx.questionAttempt.deleteMany({});
      console.log(`   删除 ${qaAttemptCount.count} 条答题记录`);

      console.log('5. 删除探究提交...');
      const expSubCount = await tx.explorationSubmission.deleteMany({});
      console.log(`   删除 ${expSubCount.count} 条探究提交`);

      console.log('6. 删除题目...');
      const questionCount = await tx.question.deleteMany({});
      console.log(`   删除 ${questionCount.count} 道题目`);

      console.log('7. 删除测验尝试...');
      const quizAttemptCount = await tx.quizAttempt.deleteMany({});
      console.log(`   删除 ${quizAttemptCount.count} 次测验尝试`);

      console.log('8. 删除探究活动...');
      const expActCount = await tx.explorationActivity.deleteMany({});
      console.log(`   删除 ${expActCount.count} 个探究活动`);

      console.log('9. 删除预设对话...');
      const presetConvCount = await tx.presetConversation.deleteMany({});
      console.log(`   删除 ${presetConvCount.count} 个预设对话`);

      console.log('10. 删除课堂作业...');
      const quizActCount = await tx.quizActivity.deleteMany({});
      console.log(`   删除 ${quizActCount.count} 个课堂作业`);

      console.log('11. 删除子项目...');
      const subProjCount = await tx.subProject.deleteMany({});
      console.log(`   删除 ${subProjCount.count} 个子项目`);

      console.log('12. 删除对话...');
      const convCount = await tx.conversation.deleteMany({});
      console.log(`   删除 ${convCount.count} 个对话`);

      console.log('13. 删除任务分配...');
      const taskAssignCount = await tx.taskAssignment.deleteMany({});
      console.log(`   删除 ${taskAssignCount.count} 个任务分配`);

      console.log('14. 删除练习题...');
      const exerciseCount = await tx.exercise.deleteMany({});
      console.log(`   删除 ${exerciseCount.count} 道练习题`);

      console.log('15. 删除练习尝试...');
      const exAttemptCount = await tx.exerciseAttempt.deleteMany({});
      console.log(`   删除 ${exAttemptCount.count} 次练习尝试`);

      console.log('16. 删除资料...');
      const materialCount = await tx.material.deleteMany({});
      console.log(`   删除 ${materialCount.count} 个资料`);

      console.log('17. 删除评价...');
      const evalCount = await tx.evaluation.deleteMany({});
      console.log(`   删除 ${evalCount.count} 条评价`);

      console.log('18. 删除学习进度...');
      const progressCount = await tx.learningProgress.deleteMany({});
      console.log(`   删除 ${progressCount.count} 条学习进度`);

      console.log('19. 删除AI洞察...');
      const insightCount = await tx.aIInsight.deleteMany({});
      console.log(`   删除 ${insightCount.count} 条AI洞察`);

      console.log('20. 删除学习任务...');
      const taskCount = await tx.learningTask.deleteMany({});
      console.log(`   删除 ${taskCount.count} 个学习任务`);

      console.log('21. 删除知识库...');
      const kbCount = await tx.knowledgeBase.deleteMany({});
      console.log(`   删除 ${kbCount.count} 个知识库`);

      // 注意：不删除分析模板和洞察模板，它们是公共资源
      console.log('22. 保留分析模板（公共资源，不删除）');
      console.log('23. 保留洞察模板（公共资源，不删除）');

      console.log('24. 删除班级...');
      const classCount = await tx.class.deleteMany({});
      console.log(`   删除 ${classCount.count} 个班级`);

      console.log('25. 删除所有用户...');
      const userCount = await tx.user.deleteMany({});
      console.log(`   删除 ${userCount.count} 个用户`);
    });

    console.log('\n所有用户及关联数据已成功删除（模板已保留）！');
  } catch (error) {
    console.error('删除失败:', error);
    throw error;
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
