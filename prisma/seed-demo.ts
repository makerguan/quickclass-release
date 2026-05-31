import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 开始填充演示数据...\n");

  // ========== 1. 系统配置 ==========
  const config = await prisma.systemConfig.findFirst();
  if (!config) {
    await prisma.systemConfig.create({
      data: {
        aiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        aiModel: "qwen-turbo",
        reasoningEnabled: true,
        insightDataSource: "CONVERSATIONS",
        requireStarRating: false,
      },
    });
    console.log("✅ 创建默认系统配置");
  }

  // ========== 2. 教师 ==========
  const teacherEmail = "teacher@quickclass.com";
  const teacherPassword = "123456";
  const hashedPassword = await bcrypt.hash(teacherPassword, 10);

  let teacher = await prisma.user.findUnique({ where: { email: teacherEmail } });
  if (!teacher) {
    teacher = await prisma.user.create({
      data: {
        email: teacherEmail,
        password: hashedPassword,
        name: "李老师",
        role: "TEACHER",
      },
    });
    console.log(`✅ 创建教师: ${teacherEmail} / ${teacherPassword}`);
  } else {
    console.log("ℹ️ 教师已存在");
  }

  // ========== 3. 班级 ==========
  let cls = await prisma.class.findFirst({ where: { teacherId: teacher.id } });
  if (!cls) {
    cls = await prisma.class.create({
      data: {
        name: "七年级(1)班",
        description: "七年级第一学期数学实验班",
        teacherId: teacher.id,
        inviteCode: "MATH2026",
        status: "ACTIVE",
        aiPromptStrategy: "PRIORITY_MATERIAL",
        isCurrent: true,
      },
    });
    console.log(`✅ 创建班级: ${cls.name}`);
  }

  // ========== 4. 3位学生 ==========
  const studentData = [
    { name: "张小明", email: "zhang@student.com", studentNo: "2026001" },
    { name: "李小红", email: "li@student.com", studentNo: "2026002" },
    { name: "王建国", email: "wang@student.com", studentNo: "2026003" },
  ];

  const students: any[] = [];
  for (const s of studentData) {
    let student = await prisma.user.findUnique({ where: { email: s.email } });
    if (!student) {
      student = await prisma.user.create({
        data: {
          email: s.email,
          password: hashedPassword,
          name: s.name,
          studentNo: s.studentNo,
          role: "STUDENT",
          classId: cls!.id,
        },
      });
      console.log(`✅ 创建学生: ${s.name}`);
    }
    students.push(student!);
  }

  // ========== 5. 学习任务 + 子项目 ==========
  let task = await prisma.learningTask.findFirst({ where: { teacherId: teacher.id } });
  if (!task) {
    task = await prisma.learningTask.create({
      data: {
        title: "一元一次方程",
        description: "掌握一元一次方程的概念、解法和应用",
        grade: "七年级",
        subject: "数学",
        objectives: "1. 理解一元一次方程的定义\n2. 掌握移项、去括号、去分母的方法\n3. 能够列方程解决实际问题",
        requirements: "认真完成每个对话活动，积极参与讨论",
        status: "ENABLED",
        teacherId: teacher.id,
      },
    });

    // 子项目1 - 认识方程（含对话）
    const sp1 = await prisma.subProject.create({
      data: {
        taskId: task.id,
        title: "认识方程",
        description: "通过生活实例理解方程的意义",
        objectives: "能从实际问题中找出未知数，建立等量关系",
        requirements: "认真阅读材料，完成引导对话",
        sortOrder: 1,
      },
    });

    // 子项目2 - 解方程练习（含对话 + 作业）
    const sp2 = await prisma.subProject.create({
      data: {
        taskId: task.id,
        title: "解方程练习",
        description: "掌握一元一次方程的标准解法",
        objectives: "熟练运用移项、去括号、去分母解方程",
        requirements: "完成所有练习题，至少达到80%正确率",
        sortOrder: 2,
      },
    });

    // --- 对话1: 什么是方程？ ---
    const pc1 = await prisma.presetConversation.create({
      data: {
        subProjectId: sp1.id,
        title: "什么是方程？",
        description: "通过对话帮助你理解方程的基本概念",
        systemPrompt: "你是一位耐心的数学老师，用生动有趣的比喻帮助学生理解方程的概念。",
        sortOrder: 1,
      },
    });

    // --- 对话2: 找等量关系 ---
    const pc2 = await prisma.presetConversation.create({
      data: {
        subProjectId: sp1.id,
        title: "找等量关系",
        description: "练习从实际问题中找出等量关系",
        systemPrompt: "你是一位数学教练，引导学生从生活情境中抽象出等量关系。",
        sortOrder: 2,
      },
    });

    // --- 对话3: 移项法则 ---
    const pc3 = await prisma.presetConversation.create({
      data: {
        subProjectId: sp2.id,
        title: "移项法则",
        description: "学习解方程的第一步：移项",
        systemPrompt: "你是一位经验丰富的数学教师，用例题讲解移项的原理和注意事项。",
        sortOrder: 1,
      },
    });

    console.log(`✅ 创建学习任务: ${task.title}`);
    console.log(`✅ 创建子项目: ${sp1.title}, ${sp2.title}`);
    console.log(`✅ 创建预设对话: ${pc1.title}, ${pc2.title}, ${pc3.title}`);

    // ========== 6. 作业1 - 方程基础测验（在子项目1下） ==========
    const quiz1 = await prisma.quizActivity.create({
      data: {
        subProjectId: sp1.id,
        title: "方程基础测验",
        description: "检测对方程基本概念的理解",
        status: "PUBLISHED",
        sortOrder: 1,
      },
    });

    await prisma.question.createMany({
      data: [
        {
          quizActivityId: quiz1.id,
          type: "SINGLE_CHOICE",
          content: "下列哪个是方程？",
          options: JSON.stringify({ A: "3 + 5 = 8", B: "x + 5", C: "2x + 3 = 7", D: "5 > 3" }),
          answer: "C",
          difficulty: "BASIC",
          explanation: "方程是含有未知数的等式，2x + 3 = 7 含有未知数 x 且是等式。",
          order: 1,
        },
        {
          quizActivityId: quiz1.id,
          type: "SINGLE_CHOICE",
          content: "方程 x + 5 = 12 的解是？",
          options: JSON.stringify({ A: "x = 5", B: "x = 7", C: "x = 12", D: "x = 17" }),
          answer: "B",
          difficulty: "BASIC",
          explanation: "x + 5 = 12，两边同时减去5，得 x = 7。",
          order: 2,
        },
        {
          quizActivityId: quiz1.id,
          type: "SINGLE_CHOICE",
          content: "小明比小红大3岁，两人年龄之和是15岁。设小明x岁，下列方程正确的是？",
          options: JSON.stringify({ A: "x + (x + 3) = 15", B: "x + (x - 3) = 15", C: "2x = 15", D: "x + 3 = 15" }),
          answer: "A",
          difficulty: "INTERMEDIATE",
          explanation: "小明x岁，小红(x-3)岁，两人年龄和 x + (x - 3) = 15，化简得 2x - 3 = 15。", // 这里修正：小红比小明小3岁
          order: 3,
        },
      ],
    });
    console.log(`✅ 创建作业: ${quiz1.title} (3道题)`);

    // ========== 7. 作业2 - 解方程测试（在子项目2下） ==========
    const quiz2 = await prisma.quizActivity.create({
      data: {
        subProjectId: sp2.id,
        title: "解方程综合测试",
        description: "检验解方程的实际掌握情况",
        status: "PUBLISHED",
        sortOrder: 1,
      },
    });

    await prisma.question.createMany({
      data: [
        {
          quizActivityId: quiz2.id,
          type: "SINGLE_CHOICE",
          content: "方程 3x = 18 的解是？",
          options: JSON.stringify({ A: "x = 3", B: "x = 6", C: "x = 9", D: "x = 15" }),
          answer: "B",
          difficulty: "BASIC",
          explanation: "3x = 18，两边同时除以3，得 x = 6。",
          order: 1,
        },
        {
          quizActivityId: quiz2.id,
          type: "SINGLE_CHOICE",
          content: "方程 2x + 3 = 11 的解是？",
          options: JSON.stringify({ A: "x = 2", B: "x = 3", C: "x = 4", D: "x = 5" }),
          answer: "C",
          difficulty: "BASIC",
          explanation: "2x + 3 = 11，移项得 2x = 8，两边除以2得 x = 4。",
          order: 2,
        },
        {
          quizActivityId: quiz2.id,
          type: "SINGLE_CHOICE",
          content: "解方程 2(x - 3) = 10，去括号后得到？",
          options: JSON.stringify({ A: "2x - 3 = 10", B: "2x - 6 = 10", C: "2x + 6 = 10", D: "x - 6 = 10" }),
          answer: "B",
          difficulty: "INTERMEDIATE",
          explanation: "2(x - 3) = 10，去括号：2 × x - 2 × 3 = 2x - 6 = 10。",
          order: 3,
        },
        {
          quizActivityId: quiz2.id,
          type: "TRUE_FALSE",
          content: "方程 5x + 2 = 3x + 8 的解是 x = 3。",
          options: JSON.stringify({ T: "正确", F: "错误" }),
          answer: "T",
          difficulty: "INTERMEDIATE",
          explanation: "5x + 2 = 3x + 8，移项得 2x = 6，所以 x = 3。",
          order: 4,
        },
      ],
    });
    console.log(`✅ 创建作业: ${quiz2.title} (4道题)`);

    // ========== 8. 任务分配 ==========
    await prisma.taskAssignment.create({
      data: { taskId: task.id, classId: cls!.id },
    });
    console.log("✅ 任务已分配到班级");

    // ========== 9. 学生对话示例 ==========
    for (const student of students) {
      const conv1 = await prisma.conversation.create({
        data: {
          userId: student.id,
          classId: cls!.id,
          presetConversationId: pc1.id,
          title: "什么是方程？",
        },
      });

      await prisma.message.createMany({
        data: [
          {
            conversationId: conv1.id,
            role: "user",
            content: "老师，什么是方程？我看数学书上有这个词，但不太懂。",
          },
          {
            conversationId: conv1.id,
            role: "assistant",
            content: "同学你好！方程其实就像一个天平。想象一下，天平左边放东西，右边也放东西，只有两边重量相等时，天平才能平衡。\n\n方程就是这个道理：等号左边的\"东西\"和右边的\"东西\"必须相等。比如：x + 3 = 10，这个等式中 x + 3 的结果必须等于 10，所以 x = 7。\n\n简单说，方程就是含有未知数（通常用 x、y 这些字母表示）的等式。你能举个例子，说说生活中哪里见过这种\"等量关系\"吗？",
          },
          {
            conversationId: conv1.id,
            role: "user",
            content: "哦！我想起来了，买东西的时候，比如我买了一个文具盒花了5元，又买了几支铅笔，每支2元，一共花了15元，那就是 5 + 2x = 15，对吗？",
          },
          {
            conversationId: conv1.id,
            role: "assistant",
            content: "太棒了！这个例子非常准确！\n- 文具盒5元 + x支铅笔(每支2元) = 总价15元\n- 方程：5 + 2x = 15\n- 来算一下，x 等于几？你买了几支铅笔？",
          },
          {
            conversationId: conv1.id,
            role: "user",
            content: "5 + 2x = 15，两边同时减去5，得到 2x = 10，然后除以2，x = 5！买了5支铅笔！",
          },
          {
            conversationId: conv1.id,
            role: "assistant",
            content: "完全正确！你已经掌握了方程的基本用法，继续加油！",
          },
        ],
      });

      const conv2 = await prisma.conversation.create({
        data: {
          userId: student.id,
          classId: cls!.id,
          presetConversationId: pc3.id,
          title: "移项法则",
        },
      });

      await prisma.message.createMany({
        data: [
          {
            conversationId: conv2.id,
            role: "user",
            content: "老师，移项到底是什么意思？我总是搞不清什么时候要移项。",
          },
          {
            conversationId: conv2.id,
            role: "assistant",
            content: "好问题！记住一个口诀：**移项要变号**。\n\n把一边的项搬到另一边时，加号变减号，减号变加号。\n\n例如：x + 3 = 10\n↓ 把 +3 移到右边变成 -3\nx = 10 - 3\n↓ 计算\nx = 7\n\n试试这个：x - 5 = 12，x 等于多少？",
          },
          {
            conversationId: conv2.id,
            role: "user",
            content: "x - 5 = 12，把 -5 移到右边变成 +5，所以 x = 12 + 5 = 17！",
          },
          {
            conversationId: conv2.id,
            role: "assistant",
            content: "非常棒！你已经掌握了移项法则！记住：**移项要变号**。",
          },
        ],
      });
    }

    console.log(`✅ 为 ${students.length} 名学生各创建了对话记录`);
  } else {
    console.log("ℹ️ 任务已存在，跳过");
  }

  // ========== 完成 ==========
  console.log("\n🎉 演示数据填充完成！");
  console.log("\n📋 登录信息：");
  console.log("   教师: teacher@quickclass.com / 123456");
  console.log("   学生: zhang@student.com / 123456");
  console.log("          li@student.com / 123456");
  console.log("          wang@student.com / 123456");
}

main()
  .catch((e) => {
    console.error("❌ 填充失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
