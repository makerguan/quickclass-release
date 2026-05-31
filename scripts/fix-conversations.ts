import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 修复：重新创建对话记录 ===\n');

  // 1. 清理旧的无效对话（pcId=null）
  const oldConvs = await prisma.conversation.findMany({ where: { presetConversationId: null } });
  console.log(`发现 ${oldConvs.length} 条无关联对话，正在清理...`);
  for (const conv of oldConvs) {
    await prisma.message.deleteMany({ where: { conversationId: conv.id } });
    await prisma.conversation.delete({ where: { id: conv.id } });
  }
  console.log('✅ 已清理无关联对话');

  // 2. 查找班级、任务、子项目、对话活动
  const cls = await prisma.class.findFirst({ where: { name: '七年级(1)班' } });
  if (!cls) { console.error('未找到班级'); return; }
  console.log(`班级: ${cls.name} (${cls.id})`);

  const task = await prisma.learningTask.findFirst({ where: { title: '一元一次方程' } });
  if (!task) { console.error('未找到任务'); return; }

  const sps = await prisma.subProject.findMany({ where: { taskId: task.id }, orderBy: { sortOrder: 'asc' } });
  let sp = sps[0];
  if (!sp) { console.error('未找到子项目'); return; }
  console.log(`子项目: ${sp.title} (${sp.id})`);

  let pc = await prisma.presetConversation.findFirst({
    where: { subProjectId: sp.id, title: '理解方程' },
  });
  if (!pc) {
    pc = await prisma.presetConversation.create({
      data: {
        subProjectId: sp.id,
        title: '理解方程',
        description: '从生活实例中理解方程的本质',
        systemPrompt: '你是一位善于用生活比喻讲解数学的老师...',
        analysisPrompt: `## 学生信息\n姓名：{studentName}\n## 对话活动信息\n- 活动：{pcTitle}\n## 对话内容\n{personalDialogContents}\n## 分析维度\n### 一、学习态度与参与度\n### 二、知识点理解\n### 三、学习优势\n### 四、薄弱环节\n### 五、个性化建议`,
        sortOrder: 2,
      },
    });
    console.log(`✅ 创建对话活动: ${pc.title} (${pc.id})`);
  } else {
    console.log(`对话活动: ${pc.title} (${pc.id})`);
  }

  // 3. 查找或创建学生
  const testStudents = [
    { name: '赵小明', email: 'zhao_test@test.com', studentNo: 'S001' },
    { name: '钱小红', email: 'qian_test@test.com', studentNo: 'S002' },
    { name: '孙小刚', email: 'sun_test@test.com', studentNo: 'S003' },
    { name: '李小花', email: 'lihua_test@test.com', studentNo: 'S004' },
    { name: '周小伟', email: 'zhou_test@test.com', studentNo: 'S005' },
  ];
  const hashedPassword = await bcrypt.hash('123456', 10);
  const students: { id: string; name: string }[] = [];

  for (const s of testStudents) {
    let user = await prisma.user.findUnique({ where: { email: s.email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email: s.email, password: hashedPassword, name: s.name, studentNo: s.studentNo, role: 'STUDENT', classId: cls.id },
      });
    } else if (user.classId !== cls.id) {
      await prisma.user.update({ where: { id: user.id }, data: { classId: cls.id } });
    }
    students.push({ id: user.id, name: user.name });
  }
  console.log(`✅ ${students.length} 名学生: ${students.map(s => s.name).join('、')}`);

  // 4. 分配任务到班级
  const assign = await prisma.taskAssignment.findFirst({ where: { taskId: task.id, classId: cls.id } });
  if (!assign) {
    await prisma.taskAssignment.create({ data: { taskId: task.id, classId: cls.id } });
    console.log('✅ 任务已分配到班级');
  }

  // 5. 创建对话记录（每人3条消息）
  const now = new Date();
  const dialogues = [
    {
      messages: [
        { role: 'user', content: '老师，方程到底是什么？为什么叫"方程"？' },
        { role: 'assistant', content: '问得好！"方程"就是含有未知数的等式。比如 x + 5 = 12，这里的 x 就是未知数。' },
        { role: 'user', content: '哦！就是有不知道的数，然后找一个等式来表示它。' },
      ],
    },
    {
      messages: [
        { role: 'user', content: '老师，我分不清什么是方程、什么是算式？3 + 5 = 8也是等式呀？' },
        { role: 'assistant', content: '好问题！关键区别在于：算式里全是已知数，而方程里有未知数需要求解。' },
        { role: 'user', content: '所以方程就是"藏了一个数字的算式"，我们要把它解开！' },
      ],
    },
    {
      messages: [
        { role: 'user', content: '老师，方程真的有用吗？生活中为什么要用方程？' },
        { role: 'assistant', content: '特别有用！买东西算价钱、做菜调配方，都能用到方程。方程就是工具！' },
        { role: 'user', content: '原来方程是生活里的"谜题解答器"！我怎么知道设什么为x？' },
      ],
    },
    {
      messages: [
        { role: 'user', content: '老师，我觉得方程好难理解，为什么有等号就是等式？' },
        { role: 'assistant', content: '可以把等号想象成天平的支点！两边必须一样重才能平衡。' },
        { role: 'user', content: '那天平两边都可以加东西减东西？只要做一样的操作就可以？' },
      ],
    },
    {
      messages: [
        { role: 'user', content: '老师，我怎么知道什么时候用方程？题目里哪些词提示我？' },
        { role: 'assistant', content: '这些关键词是信号："比...多/少"、"的几倍"、"一共"、"剩余"。把每句话翻译成数学语言。' },
        { role: 'user', content: '原来要先把题目拆开，把"比"和"共"的关系变成数学式子！' },
      ],
    },
  ];

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const dialog = dialogues[i];

    const conv = await prisma.conversation.create({
      data: {
        userId: student.id,
        classId: cls.id,
        presetConversationId: pc.id,  // 确保关联到对话活动
        title: '理解方程',
        createdAt: new Date(now.getTime() - (5 - i) * 3600000),
        updatedAt: new Date(now.getTime() - (5 - i) * 3600000 + dialog.messages.length * 60000),
      },
    });

    const messages = dialog.messages.map((msg, idx) => ({
      conversationId: conv.id,
      role: msg.role,
      content: msg.content,
      createdAt: new Date(now.getTime() - (5 - i) * 3600000 + idx * 60000),
    }));
    await prisma.message.createMany({ data: messages });

    console.log(`✅ ${student.name}: 对话已创建 (${messages.length}条消息, pcId=${pc.id})`);
  }

  // 6. 验证
  const verifyCount = await prisma.conversation.count({ where: { presetConversationId: pc.id } });
  const verifyMsgCount = await prisma.message.count({ where: { conversation: { presetConversationId: pc.id } } });
  console.log(`\n🎉 完成！验证：${verifyCount}条对话, ${verifyMsgCount}条消息`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('❌', e); process.exit(1); });