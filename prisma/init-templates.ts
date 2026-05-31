/**
 * 为所有教师创建五类默认模板
 * 用法: npx tsx prisma/init-templates.ts
 */

import { PrismaClient } from "@prisma/client";
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}`,
    },
  },
});

// 五类模板内容
const TEMPLATES = [
  {
    type: "student",
    name: "默认模板",
    content: `## 学生信息
姓名：{studentName}

## 学习活动背景
- 学习活动：{spTitle}
- 学习目标：{spObjectives}
- 学习要求：{spRequirements}

## 对话活动信息
- 对话活动：{pcTitle}
- 活动说明：{pcDescription}

## 该学生对话记录
{dialogContent}

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
  },
  {
    type: "class",
    name: "默认模板",
    content: `## 学习活动背景
- 学习活动：{spTitle}
- 学习目标：{spObjectives}
- 学习要求：{spRequirements}

## 班级参与情况
- 参与学生：{activeCount}/{totalStudents}人

## 学生对话记录
{dialogContents}

## 学生近期提问
{recentQuestions}

## 分析维度
### 一、班级整体学习状态
概括班级整体活跃度和参与情况，分析学生讨论的热点话题。

### 二、共性问题分析
汇总全班学生在知识点理解上的共同困难和常见误区。

### 三、突出表现
指出班级中表现优秀或进步明显的学生及其特点。

### 四、教学建议
给出针对班级整体的具体可操作的教学改进建议。`,
  },
  {
    type: "conversation",
    name: "默认模板",
    content: `你是一位循循善诱的学科教师，在对话活动中引导学生主动思考和探究。你的首要身份是**学科教师**，而非单纯的聊天对象。

## 对话活动目标
{pcDescription}

## 学习活动目标
{spObjectives}

## 对话要求
1. **以问代答**：多通过提问引导学生思考，而非直接给出答案
2. **鼓励质疑**：欢迎学生提出不同观点，培养批判性思维
3. **联系生活**：适当联系学生熟悉的生活实例，帮助理解抽象概念
4. **适时总结**：在学生理解关键知识点后，进行简明扼要的总结
5. **分层引导**：根据学生的回答深度调整问题难度

## 禁止行为
- 不要一次性给出太多信息，每次聚焦1-2个要点
- 不要使用成人化或过于专业的术语
- 不要代替学生完成思考过程`,
  },
  {
    type: "QUIZ_DESIGN",
    name: "默认模板",
    content: `你是一位资深学科教师，请根据以下信息设计高质量的课堂作业题目。

## 课堂信息
- 课堂名称：{taskTitle}
- 课堂目标：{taskObjectives}
- 年级：{taskGrade}
- 学科：{taskSubject}

## 参考知识库
{kbContent}

## 出题要求
1. 共设计{quizCount}道选择题（题型固定为4选1单选题）
2. 难度分布建议：基础题40%、提升题40%、拓展题20%
3. 每道题格式：[难度] 题目内容（A. 选项A B. 选项B C. 选项C D. 选项D）
4. 答案统一附在每道题后面另起一行，格式：答案：X（X为A/B/C/D）
5. 同时提供每题的详细答案解析

## 题目质量要求
- 题目表述清晰、无歧义
- 选项之间有区分度，不出现"以上都不对"等选项
- 正确答案唯一且确定
- 解析应指出学生常见的错误思维

## 输出格式
请严格按以下JSON数组格式输出，不要包含任何其他内容：
[
  {
    "type": "SINGLE_CHOICE",
    "content": "题目内容",
    "options": {"A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D"},
    "answer": "A",
    "difficulty": "BASIC",
    "explanation": "答案解析"
  }
]`,
  },
  {
    type: "QUIZ_ANALYSIS",
    name: "默认模板",
    content: `你是一位资深学科教师，请根据以下答题数据生成班级学情分析报告。

## 检测信息
- 作业名称：{quizTitle}
- 参与人数：{totalStudents}/{classSize}
- 班级平均分：{classAvgScore}

## 各题正确率
{questionStats}

## 薄弱题目
{weakQuestions}

## 低分学生（低于60分）
{lowScoreStudents}

## 分析要求
### 一、班级整体掌握情况
对本次作业整体情况做出评价，划分等级（优秀/良好/一般/较差）。

### 二、薄弱知识点分析
结合各题正确率，分析学生错误率较高的知识点，找出班级共性问题。

### 三、教学改进建议
给出2-3条针对本次作业暴露问题的具体教学改进建议。

### 四、需重点关注的学生
结合得分和平时表现，列出需要教师特别关注的学生。

## 评分输出
分析完成后，末尾另起一行输出综合评分：
评分：★★★★★★（6星最低，10星最高）`,
  },
];

async function initTemplates() {
  console.log("📥 开始初始化五类模板...\n");

  // 获取所有教师
  const teachers = await prisma.user.findMany({
    where: { role: "TEACHER" },
  });

  if (teachers.length === 0) {
    console.error("❌ 未找到教师账号，请先运行 npm run db:seed");
    process.exit(1);
  }

  console.log(`✅ 找到 ${teachers.length} 个教师\n`);

  for (const teacher of teachers) {
    console.log(`处理教师: ${teacher.name} (${teacher.email})`);

    for (const template of TEMPLATES) {
      // 检查是否已存在同类型默认模板
      const existing = await prisma.analysisTemplate.findFirst({
        where: {
          teacherId: teacher.id,
          type: template.type,
          isDefault: true,
        },
      });

      if (existing) {
        console.log(`  ⏭️  ${template.type} - 已存在默认模板，跳过`);
        continue;
      }

      // 取消同类型其他默认
      await prisma.analysisTemplate.updateMany({
        where: { teacherId: teacher.id, type: template.type, isDefault: true },
        data: { isDefault: false },
      });

      // 创建新模板
      await prisma.analysisTemplate.create({
        data: {
          teacherId: teacher.id,
          type: template.type,
          name: template.name,
          content: template.content,
          isDefault: true,
          updatedAt: new Date(),
        },
      });

      console.log(`  ✅ ${template.type} - 已创建`);
    }

    // 统计
    const count = await prisma.analysisTemplate.count({ where: { teacherId: teacher.id } });
    console.log(`  📊 当前共有 ${count} 个模板\n`);
  }

  console.log("✅ 初始化完成！");
}

initTemplates()
  .catch((e) => {
    console.error("❌ 初始化失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
