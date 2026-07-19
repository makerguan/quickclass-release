import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// 系统配置的期望值
const SYSTEM_CONFIG = {
  aiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  aiApiKey: "sk-f0d70dd6e3b64334b958a319f38f4c03",
  aiModel: "qwen3-35b-a3b",
  insightDataSource: "CONVERSATIONS",
  requireStarRating: false,
  studentWordLimit: 100,
  classWordLimit: 2005,
  reasoningEnabled: true,
  teacherName: "管老师",
  grade: "七年级",
  subject: "数学",
  conversationWarningThreshold: 20000,
};

/**
 * 同步系统配置（id=system-config-1）
 * 由 npm run db:seed 调用
 */
export async function seedSystemConfig() {
  const config = await prisma.systemConfig.upsert({
    where: { id: "system-config-1" },
    update: { ...SYSTEM_CONFIG, updatedAt: new Date() },
    create: { id: "system-config-1", ...SYSTEM_CONFIG, updatedAt: new Date() },
  });
  console.log("系统配置已同步");
  return config;
}

/**
 * 同步教师专属数据：班级、学生、任务、子项目、预设对话、任务分配、分析模板
 * @param teacherId 已有教师 ID（不创建/更新教师账号）
 * @param teacherName 教师姓名（用于日志）
 *
 * 由 npm run db:seed 调用，或由新教师注册时通过 prisma/seed-demo.ts 间接调用
 */
export async function seedTeacherData(teacherId: string, teacherName: string, includeTemplates = true) {
  console.log(`开始同步教师 [${teacherName}] 的专属数据...`);

  const hashedPassword = await bcrypt.hash("123456", 10);


  // 3. 班级 - 使用 upsert 基于 inviteCode
  const cls1 = await prisma.class.upsert({
    where: { inviteCode: "MATH2026" },
    update: {
      name: "七年级(1)班",
      description: "七年级第一学期数学实验班",
      teacherId,
      status: "ACTIVE",
      isCurrent: true,
    },
    create: {
      name: "七年级(1)班",
      description: "七年级第一学期数学实验班",
      teacherId,
      inviteCode: "MATH2026",
      status: "ACTIVE",
      aiPromptStrategy: "PRIORITY_MATERIAL",
      isCurrent: true,
    },
  });
  console.log("班级1已同步:", cls1.name);

  const cls2 = await prisma.class.upsert({
    where: { inviteCode: "MATH2026B" },
    update: {
      name: "七年级(2)班",
      description: "七年级第二班",
      teacherId,
      status: "ACTIVE",
      isCurrent: false,
    },
    create: {
      name: "七年级(2)班",
      description: "七年级第二班",
      teacherId,
      inviteCode: "MATH2026B",
      status: "ACTIVE",
      aiPromptStrategy: "PRIORITY_MATERIAL",
      isCurrent: false,
    },
  });
  console.log("班级2已同步:", cls2.name);

  // 4. 学生 - 使用 upsert 基于 email
  const studentData = [
    { name: "张小明", email: "zhang@student.com", studentNo: "2026001", classId: cls1.id },
    { name: "李小红", email: "li@student.com", studentNo: "2026002", classId: cls1.id },
    { name: "王建国", email: "wang@student.com", studentNo: "2026003", classId: cls1.id },
    { name: "陈思思", email: "chen@student.com", studentNo: "2026004", classId: cls1.id },
    { name: "刘洋", email: "liu@student.com", studentNo: "2026005", classId: cls1.id },
    { name: "张伟", email: "zhangwei@student.com", studentNo: "2026006", classId: cls2.id },
    { name: "李四", email: "lisi@student.com", studentNo: "2026007", classId: cls2.id },
    { name: "王五", email: "wangwu@student.com", studentNo: "2026008", classId: cls2.id },
    { name: "赵丽颖", email: "zhaoli@student.com", studentNo: "2026009", classId: cls2.id },
    { name: "王俊凯", email: "wangjunkai@student.com", studentNo: "2026010", classId: cls2.id },
    { name: "张杰", email: "zhangjie@student.com", studentNo: "2026011", classId: cls2.id },
  ];

  for (const s of studentData) {
    const existing = await prisma.user.findFirst({ where: { email: s.email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: s.name, studentNo: s.studentNo, classId: s.classId },
      });
    } else {
      await prisma.user.create({
        data: {
          email: s.email,
          password: hashedPassword,
          name: s.name,
          studentNo: s.studentNo,
          role: "STUDENT",
          classId: s.classId,
        },
      });
    }
  }
  console.log("学生已同步:", studentData.length, "人");

  // 5. 任务 - 查找或创建（基于标题和教师）
  let task = await prisma.learningTask.findFirst({
    where: { title: "一元一次方程", teacherId },
  });
  if (!task) {
    task = await prisma.learningTask.create({
      data: {
        title: "一元一次方程",
        description: "掌握一元一次方程的概念、解法和应用",
        grade: "七年级",
        subject: "数学",
        objectives:
          "1. 理解一元一次方程的定义\n2. 掌握移项、去括号、去分母的方法\n3. 能够列方程解决实际问题",
        requirements: "认真完成每个对话活动，积极参与讨论",
        status: "ENABLED",
        teacherId,
        updatedAt: new Date(),
      },
    });
    console.log("创建任务: 一元一次方程");
  } else {
    console.log("任务已存在:", task.title);
  }

  // 6. 子项目 - 查找或创建（仅1个，学生端显示为"对话思考"）
  let sp1 = await prisma.subProject.findFirst({
    where: { taskId: task.id, title: "默认活动" },
  });
  if (!sp1) {
    sp1 = await prisma.subProject.create({
      data: {
        taskId: task.id,
        title: "默认活动",
        description: "通过对话、练习和探究活动学习一元一次方程",
        objectives: "理解方程概念，掌握解法，能解决实际问题",
        requirements: "认真完成每个对话活动，积极参与讨论",
        sortOrder: 1,
        enabled: true,
      },
    });
    console.log("创建子项目: 默认活动（学生端显示为对话思考）");
  }

  // 7. 预设对话 - 查找或创建（全部挂在这个子项目下）
  const pcData = [
    {
      subProjectId: sp1.id,
      title: "什么是方程？",
      description: "通过对话帮助你理解方程的基本概念",
      systemPrompt: "你是一位耐心的数学老师，用生动有趣的比喻帮助学生理解方程的概念。",
      sortOrder: 1,
    },
    {
      subProjectId: sp1.id,
      title: "找等量关系",
      description: "练习从实际问题中找出等量关系",
      systemPrompt: "你是一位数学教练，引导学生从生活情境中抽象出等量关系。",
      sortOrder: 2,
    },
    {
      subProjectId: sp1.id,
      title: "移项法则",
      description: "学习解方程的第一步：移项",
      systemPrompt: "你是一位经验丰富的数学教师，用例题讲解移项的原理和注意事项。",
      sortOrder: 3,
    },
  ];

  for (const pc of pcData) {
    const existing = await prisma.presetConversation.findFirst({
      where: { subProjectId: pc.subProjectId, title: pc.title },
    });
    if (!existing) {
      await prisma.presetConversation.create({
        data: {
          subProjectId: pc.subProjectId,
          title: pc.title,
          description: pc.description,
          systemPrompt: pc.systemPrompt,
          sortOrder: pc.sortOrder,
          enabled: true,
        },
      });
      console.log("创建预设对话:", pc.title);
    }
  }

  // 8. 任务分配 - 使用 upsert
  await prisma.taskAssignment.upsert({
    where: { taskId_classId: { taskId: task.id, classId: cls1.id } },
    update: {},
    create: { taskId: task.id, classId: cls1.id },
  });
  await prisma.taskAssignment.upsert({
    where: { taskId_classId: { taskId: task.id, classId: cls2.id } },
    update: {},
    create: { taskId: task.id, classId: cls2.id },
  });
  console.log("任务分配已同步");

  // 9. 分析模板 - 使用 upsert 基于 name + teacherId（可选，注册时跳过）
  if (!includeTemplates) {
    console.log("跳过分析模板创建（includeTemplates=false）");
  } else {
  const templates = [
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

  for (const tpl of templates) {
    // 查找同名模板
    const existing = await prisma.analysisTemplate.findFirst({
      where: { name: tpl.name, teacherId },
    });
    if (existing) {
      // 更新内容
      await prisma.analysisTemplate.update({
        where: { id: existing.id },
        data: {
          type: tpl.type,
          content: tpl.content,
          isDefault: tpl.isDefault,
          updatedAt: new Date(),
        },
      });
    } else {
      // 创建新模板
      await prisma.analysisTemplate.create({
        data: {
          teacherId,
          name: tpl.name,
          type: tpl.type,
          content: tpl.content,
          isDefault: tpl.isDefault,
          updatedAt: new Date(),
        },
      });
    }
  }
  console.log("分析模板已同步:", templates.length, "个");
  }

  return { cls1, cls2, task, sp1 };
}

async function main() {
  console.log("开始同步数据...\n");

  await seedSystemConfig();

  // 教师 - 查找或创建（仅开发者 npm run db:seed 使用）
  const hashedPassword = await bcrypt.hash("123456", 10);
  let teacher = await prisma.user.findFirst({
    where: { role: "TEACHER" },
  });
  if (!teacher) {
    teacher = await prisma.user.create({
      data: {
        email: "teacher@quickclass.com",
        password: hashedPassword,
        name: "管老师",
        role: "TEACHER",
      },
    });
    console.log("创建教师: teacher@quickclass.com");
  } else {
    teacher = await prisma.user.update({
      where: { id: teacher.id },
      data: { name: "管老师" },
    });
    console.log("教师已存在，已更新信息");
  }

  await seedTeacherData(teacher.id, teacher.name);

  console.log("\n=== 数据统计 ===");
  console.log("用户:", await prisma.user.count());
  console.log("班级:", await prisma.class.count());
  console.log("任务:", await prisma.learningTask.count());
  console.log("子项目:", await prisma.subProject.count());
  console.log("预设对话:", await prisma.presetConversation.count());
  console.log("模板:", await prisma.analysisTemplate.count());
  console.log("任务分配:", await prisma.taskAssignment.count());

  console.log("\n数据同步完成！");
  console.log("登录信息：teacher@quickclass.com / 123456");
}

// 仅当直接执行时（npm run db:seed）运行 main()，被导入时不运行
const isMainModule = process.argv[1]?.endsWith("seed-full.ts");
if (isMainModule) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}