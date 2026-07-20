import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATES = [
  {
    name: "学生个人学情模板",
    type: "student",
    content: `## 学生信息
姓名：{studentName}
## 课堂背景
- 课题：{taskTitle}
- 目标：{taskDescription}
## 对话活动信息
- 对话活动：{pcTitle}
- 活动目标：{pcDescription}
## 对话内容
- 对话记录：{personalDialogContents}
## 分析维度
### 一、学习态度与参与度
分析学生在本对话活动中的参与积极性、提问质量和互动深度。
### 二、知识点理解分析
结合对话内容，分析学生对核心概念的理解程度和常见误区。
### 三、学习优势
指出该学生在本次学习中的突出表现和亮点。
### 四、薄弱环节
指出需要重点关注和改进的方面。
### 五、个性化建议
给出2-3条具体可行的学习改进建议。`,
    isDefault: true,
  },
  {
    name: "学生全班学情模板",
    type: "class",
    content: `请根据对话背景和分析要求分析全班活动情况。
## 对话背景
### 课题信息
- 课题：{taskTitle}
- 目标：{taskDescription}
### 对话活动信息
- 对话活动：{pcTitle}
- 活动目标：{pcDescription}
### 对话内容
- 对话记录：{personalDialogContents}
## 分析维度
### 一、班级整体学习状态
概括班级整体活跃度和参与情况，分析学生讨论的热点话题。
### 二、共性问题分析
汇总全班学生在知识点理解上的共同困难和常见误区。
### 三、突出表现
指出班级中表现优秀或进步明显的学生及其特点。
### 四、教学建议
给出针对班级整体的具体可操作的教学改进建议。
### 五、重点关注学生名单
每个维度列出发现较差的5位同学姓名。`,
    isDefault: true,
  },
  {
    name: "对话设计模板",
    type: "conversation",
    content: `你是一位循循善诱的学科教师，在对话中引导学生主动思考和探究，你的首要身份是**学科教师**，而非单纯的聊天助手。`,
    isDefault: true,
  },
  {
    name: "课堂作业设计模板",
    type: "QUIZ_DESIGN",
    content: `你是一位资深学科教师，请根据以下信息设计课堂作业题目。`,
    isDefault: true,
  },
  {
    name: "课堂作业分析模板",
    type: "QUIZ_ANALYSIS",
    content: `你是一位资深学科教师，请根据以下班级的课堂作业答题数据，生成专业的班级学情分析报告。`,
    isDefault: true,
  },
  {
    name: "学生个人学情模板（对话活动）",
    type: "student",
    content: `## 学生信息
姓名：{studentName}
## 对话活动信息
- 活动：{pcTitle}
## 对话内容
{personalDialogContents}
## 分析维度
### 一、学习态度与参与度
### 二、知识点理解
### 三、学习优势
### 四、薄弱环节
### 五、个性化建议`,
    isDefault: false,
  },
  {
    name: "学生全班学情模板（对话活动）",
    type: "class",
    content: `## 班级整体学习状态
## 共性问题分析
## 突出表现
## 教学建议
## 重点关注学生名单`,
    isDefault: false,
  },
];

async function main() {
  console.log('开始恢复分析模板...\n');

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
  console.log(`\n模板恢复完成！当前共 ${count} 个模板`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
