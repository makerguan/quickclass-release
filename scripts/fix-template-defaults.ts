import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. class 类型：只保留1个默认
  const classDefaults = await prisma.analysisTemplate.findMany({
    where: { type: 'class', isDefault: true }
  });
  console.log('class 默认模板:', classDefaults.length);

  for (let i = 1; i < classDefaults.length; i++) {
    await prisma.analysisTemplate.update({
      where: { id: classDefaults[i].id },
      data: { isDefault: false }
    });
    console.log('取消默认:', classDefaults[i].name);
  }

  // 2. 检查 EXPLORATION_ANALYSIS 是否存在默认模板
  const expDefault = await prisma.analysisTemplate.findFirst({
    where: { type: 'EXPLORATION_ANALYSIS', isDefault: true }
  });

  if (!expDefault) {
    await prisma.analysisTemplate.create({
      data: {
        type: 'EXPLORATION_ANALYSIS',
        name: '互动探究分析模板',
        content: `你是一位资深学科教师，请根据以下互动探究的学生提交数据，生成一份专业的研学分析报告。

## 基本信息
探究标题：{explorationTitle}
探究描述：{explorationDescription}
已提交：{submittedCount}/{totalStudents}人
平均得分：{classAvgScore}分
平均停留：{avgTimeSpent}秒
平均互动：{avgInteractions}次

## 分数分布
{scoreDistribution}

## 操作类型统计
{actionTypeStats}

## 提交详情
{submissionDetails}

## 分析要求
1. 学生对互动内容的整体完成情况（参与度、完成率）
2. 分析学生提交数据中反映出的学习行为特点
3. 识别表现优秀和有困难的学生
4. 提出教学改进建议（2-3条）

## 输出格式
直接输出分析内容，末尾另起一行输出综合评分：
评分：★★★★★★`,
        isDefault: true,
        updatedAt: new Date(),
      }
    });
    console.log('已创建 EXPLORATION_ANALYSIS 默认模板');
  } else {
    console.log('EXPLORATION_ANALYSIS 已有默认模板:', expDefault.name);
  }

  // 验证结果
  const allTemplates = await prisma.analysisTemplate.findMany({
    select: { name: true, type: true, isDefault: true },
    orderBy: [{ type: 'asc' }, { isDefault: 'desc' }]
  });

  const groups: Record<string, { total: number; defaults: number }> = {};
  allTemplates.forEach(t => {
    if (!groups[t.type]) groups[t.type] = { total: 0, defaults: 0 };
    groups[t.type].total++;
    if (t.isDefault) groups[t.type].defaults++;
  });

  console.log('\n=== 修复后核查 ===');
  for (const [type, info] of Object.entries(groups)) {
    const status = info.defaults === 1 ? '✅' : info.defaults > 1 ? '⚠️ 多默认' : '⚠️ 无默认';
    console.log(type, '| 总数:', info.total, '| 默认:', info.defaults, status);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
