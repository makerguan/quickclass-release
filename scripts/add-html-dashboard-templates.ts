import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATES = [
  {
    name: "全班学情大屏（对话分析）",
    type: "class",
    content: `请根据以下班级对话数据，生成一份精美的 HTML 数据大屏页面。

## 课堂信息
- 课题：{taskTitle}
- 年级：{taskGrade}
- 学科：{taskSubject}
- 对话活动：{pcTitle}
- 活动目标：{pcDescription}
- 参与学生：{activeCount}/{totalStudents}人

## 学生对话记录
{personalDialogContents}

## 设计要求

### 整体风格
- 深色科技风大屏，背景使用深蓝渐变（#0c1445 → #1a237e → #0d47a1）
- 使用 ECharts 5.x（CDN: https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js）绘制图表
- 所有内容在单个 HTML 文件中完成，不依赖外部图片

### 布局结构
1. **顶部标题栏**：课题名称 + 对话活动名称 + 参与率统计
2. **左侧区域**：
   - 学生参与度柱状图（按对话条数排序）
   - 互动活跃度雷达图（提问质量、回答深度、互动频率等维度）
3. **中间区域**：
   - 知识点掌握热力图（根据对话内容分析各知识点掌握程度）
   - 共性问题词云或列表
4. **右侧区域**：
   - 学生表现分层饼图（优秀/良好/一般/需关注）
   - 优秀学生名单（绿色标签）和需关注学生名单（橙色标签）
5. **底部区域**：
   - 教学建议卡片（2-3条具体建议）

### 图表配色
- 主色：#2196f3（蓝）、#4caf50（绿）、#ff9800（橙）、#f44336（红）
- 图表背景透明，文字白色，网格线半透明白色

### 技术要求
- 必须包含完整的 <!DOCTYPE html>、<html>、<head>、<body> 结构
- ECharts 图表使用 resize 监听实现自适应
- 页面宽度 1920px 基准，使用百分比布局适配
- 所有数据直接写在 JS 变量中，不依赖外部 API`,
    isDefault: false,
  },
  {
    name: "全班学情大屏（作业分析）",
    type: "QUIZ_ANALYSIS",
    content: `请根据以下班级作业答题数据，生成一份精美的 HTML 数据大屏页面。

## 检测信息
- 作业名称：{quizTitle}
- 班级名称：{className}
- 参与人数：{totalStudents}/{classSize}人
- 班级平均分：{classAvgScore}

## 各题正确率
{questionStats}

## 薄弱题目（正确率<60%）
{weakQuestions}

## 低分学生（<60分）
{lowScoreStudents}

## 高分学生（≥90分）
{highScoreStudents}

## 分数分布
{scoreDistribution}

## 设计要求

### 整体风格
- 深色科技风大屏，背景使用深蓝渐变（#0c1445 → #1a237e → #0d47a1）
- 使用 ECharts 5.x（CDN: https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js）绘制图表
- 所有内容在单个 HTML 文件中完成，不依赖外部图片

### 布局结构
1. **顶部标题栏**：作业名称 + 班级 + 平均分 + 参与率 四大指标卡片
2. **左侧区域**：
   - 分数分布柱状图（各分数段人数）
   - 题目正确率横向柱状图（按题目排序，低于60%标红）
3. **中间区域**：
   - 知识点掌握雷达图（基础/提升/拓展各维度）
   - 难度分析环形图（基础题/提升题/拓展题正确率对比）
4. **右侧区域**：
   - 成绩等级饼图（优秀≥90/良好≥75/及格≥60/不及格<60）
   - 高分学生榜单（绿色标签）和低分学生预警（红色标签）
5. **底部区域**：
   - 薄弱知识点卡片（红色警示）
   - 教学改进建议卡片（2-3条具体建议）

### 图表配色
- 主色：#2196f3（蓝）、#4caf50（绿）、#ff9800（橙）、#f44336（红）
- 正确率≥80%绿色，60%-80%橙色，<60%红色
- 图表背景透明，文字白色，网格线半透明白色

### 技术要求
- 必须包含完整的 <!DOCTYPE html>、<html>、<head>、<body> 结构
- ECharts 图表使用 resize 监听实现自适应
- 页面宽度 1920px 基准，使用百分比布局适配
- 所有数据直接写在 JS 变量中，不依赖外部 API`,
    isDefault: false,
  },
];

async function main() {
  console.log('开始添加 HTML 大屏模板...\n');

  for (const tpl of TEMPLATES) {
    const existing = await prisma.analysisTemplate.findFirst({
      where: { name: tpl.name },
    });
    if (existing) {
      await prisma.analysisTemplate.update({
        where: { id: existing.id },
        data: {
          type: tpl.type,
          content: tpl.content,
          isDefault: tpl.isDefault,
          updatedAt: new Date(),
        },
      });
      console.log(`更新模板: ${tpl.name}`);
    } else {
      await prisma.analysisTemplate.create({
        data: {
          name: tpl.name,
          type: tpl.type,
          content: tpl.content,
          isDefault: tpl.isDefault,
          updatedAt: new Date(),
        },
      });
      console.log(`创建模板: ${tpl.name}`);
    }
  }

  const count = await prisma.analysisTemplate.count();
  console.log(`\n完成！当前共 ${count} 个模板`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
