/**
 * 新教师注册时自动填充演示数据
 *
 * 由 src/app/api/auth/register/route.ts 在第一个教师注册成功后调用
 * 仅当该教师名下还没有任何班级/学生/任务时执行（避免重复填充）
 *
 * 包含：
 *  1. seedTeacherData() —— 班级、学生、任务、子项目、预设对话、分析模板
 *  2. 真实学生对话数据（Conversation + Message）
 *  3. 课堂作业（QuizActivity + Question + QuizAttempt + QuestionAttempt）
 *  4. 互动探究（ExplorationActivity + ExplorationSubmission + AiCompanionMessage）
 */

import { PrismaClient } from "@prisma/client";
import { seedTeacherData } from "./seed-full";

const prisma = new PrismaClient();

interface SeedResult {
  classes: number;
  students: number;
  tasks: number;
  subProjects: number;
  presetConversations: number;
  realConversations: number;
  messages: number;
  quizActivities: number;
  questions: number;
  quizAttempts: number;
  questionAttempts: number;
  explorationActivities: number;
  explorationSubmissions: number;
  aiCompanionMessages: number;
  templates: number;
}

/**
 * 填充该教师的真实学生对话数据
 */
async function seedRealConversations(
  classId: string,
  students: { id: string; name: string }[],
  presetConvs: { id: string; title: string }[]
) {
  let convCount = 0;
  let msgCount = 0;

  for (let i = 0; i < Math.min(2, students.length); i++) {
    const student = students[i];
    const pc = presetConvs[i % presetConvs.length];
    if (!pc) continue;

    const existing = await prisma.conversation.findFirst({
      where: { userId: student.id, presetConversationId: pc.id },
    });
    if (existing) continue;

    const conversation = await prisma.conversation.create({
      data: {
        userId: student.id,
        classId,
        presetConversationId: pc.id,
        title: pc.title,
        createdAt: new Date(Date.now() - 86400000 * 3),
        updatedAt: new Date(Date.now() - 86400000 * 2),
      },
    });
    convCount++;

    const messages: { role: string; content: string; createdAt: Date }[] = [
      {
        role: "user",
        content: `${pc.title.replace(/？$/, "")}是什么意思呀？老师能给我讲讲吗？`,
        createdAt: new Date(Date.now() - 86400000 * 3 + 60000),
      },
      {
        role: "assistant",
        content: `好的，${student.name}同学！我们一起从生活中的例子开始吧。\n\n比如说，你买 3 支铅笔，每支 x 元，一共花了 12 元。这里我们想求 x，就是"${pc.title.replace(/？$/, "")}"的问题。\n\n你能想到 3 支铅笔的总价怎么用 x 表示吗？`,
        createdAt: new Date(Date.now() - 86400000 * 3 + 90000),
      },
      {
        role: "user",
        content: "3x = 12，那 x = 4 元",
        createdAt: new Date(Date.now() - 86400000 * 3 + 120000),
      },
      {
        role: "assistant",
        content: `非常棒！你很快就把 ${pc.title.replace(/？$/, "")}的核心抓住了。\n\n如果再复杂一点：3x + 5 = 17 怎么解呢？先观察一下，跟刚才的 3x = 12 比，多了什么？`,
        createdAt: new Date(Date.now() - 86400000 * 3 + 150000),
      },
      {
        role: "user",
        content: "多了个 +5，那应该把 5 移到右边？",
        createdAt: new Date(Date.now() - 86400000 * 2),
      },
      {
        role: "assistant",
        content: `完全正确！这就是"移项"——把常数项从左边移到右边要变号。\n\n所以 3x = 12，x = 4。\n\n下一题你可以试着自己列出方程：比 5 多 3 倍的数是 14，求这个数。`,
        createdAt: new Date(Date.now() - 86400000 * 2 + 30000),
      },
    ];

    for (const m of messages) {
      await prisma.message.create({
        data: { ...m, conversationId: conversation.id },
      });
      msgCount++;
    }
  }

  return { convCount, msgCount };
}

/**
 * 填充课堂作业 + 学生作答
 */
async function seedQuizActivity(
  subProjectId: string,
  taskTitle: string,
  students: { id: string; name: string }[]
) {
  const existing = await prisma.quizActivity.findFirst({
    where: { subProjectId, title: "解方程小测" },
  });
  if (existing) return { qaCount: 0 };

  const quiz = await prisma.quizActivity.create({
    data: {
      subProjectId,
      title: "解方程小测",
      description: `检测对${taskTitle}的掌握情况`,
      status: "PUBLISHED",
      passScore: 60,
      sortOrder: 1,
      updatedAt: new Date(),
    },
  });

  const questions = [
    {
      type: "SINGLE_CHOICE",
      content: "方程 2x + 3 = 11 的解是？",
      options: JSON.stringify({ A: "3", B: "4", C: "5", D: "6" }),
      answer: "B",
      score: 30,
      difficulty: "EASY",
      order: 1,
      explanation: "移项：2x = 11 - 3 = 8，所以 x = 4。",
    },
    {
      type: "FILL_BLANK",
      content: "若 3x - 7 = 8，则 x = ___",
      options: null,
      answer: "5",
      score: 30,
      difficulty: "EASY",
      order: 2,
      explanation: "移项：3x = 8 + 7 = 15，x = 5。",
    },
    {
      type: "SHORT_ANSWER",
      content: "小明买了 5 支笔共 25 元，每支笔多少元？请列出方程并求解。",
      options: null,
      answer: "5x = 25, x = 5，每支笔 5 元",
      score: 40,
      difficulty: "MEDIUM",
      order: 3,
      explanation: "设每支笔 x 元，列方程 5x = 25，解得 x = 5。",
    },
  ];

  const createdQuestions = [];
  for (const q of questions) {
    const cq = await prisma.question.create({
      data: { ...q, quizActivityId: quiz.id },
    });
    createdQuestions.push(cq);
  }

  // 2 个学生作答
  const answers = [
    { name: "B", q2: "5", q3: "5x=25, x=5，每支笔 5 元", correctCount: 3, score: 100 },
    { name: "B", q2: "6", q3: "5x=25, x=5", correctCount: 2, score: 70 },
  ];

  let qaCount = 0;
  for (let i = 0; i < Math.min(2, students.length); i++) {
    const student = students[i];
    const ans = answers[i] || answers[0];

    const attempt = await prisma.quizAttempt.create({
      data: {
        userId: student.id,
        quizActivityId: quiz.id,
        score: ans.score,
        totalQuestions: 3,
        correctCount: ans.correctCount,
        totalScore: 100,
        maxTotalScore: 100,
        startedAt: new Date(Date.now() - 86400000),
        submittedAt: new Date(Date.now() - 86400000 + 1800000),
      },
    });

    await prisma.questionAttempt.create({
      data: {
        quizAttemptId: attempt.id,
        questionId: createdQuestions[0].id,
        selectedAnswer: ans.name,
        isCorrect: true,
        score: 30,
        maxScore: 30,
        gradedBy: "auto",
      },
    });
    qaCount++;

    await prisma.questionAttempt.create({
      data: {
        quizAttemptId: attempt.id,
        questionId: createdQuestions[1].id,
        selectedAnswer: ans.q2,
        isCorrect: i === 0,
        score: i === 0 ? 30 : 0,
        maxScore: 30,
        comment: i === 0 ? null : "正确答案：3x-7=8 → 3x=15 → x=5",
        gradedBy: "auto",
      },
    });
    qaCount++;

    await prisma.questionAttempt.create({
      data: {
        quizAttemptId: attempt.id,
        questionId: createdQuestions[2].id,
        selectedAnswer: ans.q3,
        isCorrect: true,
        score: 40,
        maxScore: 40,
        comment: "列方程正确，解答清晰。",
        gradedBy: "ai",
      },
    });
    qaCount++;
  }

  return { qaCount, questionCount: createdQuestions.length, attemptCount: Math.min(2, students.length) };
}

/**
 * 填充互动探究 + 学生提交 + AI 伴学对话
 */
async function seedExplorationActivity(
  subProjectId: string,
  students: { id: string; name: string }[]
) {
  const existing = await prisma.explorationActivity.findFirst({
    where: { subProjectId, title: "探索一元一次方程" },
  });

  if (existing) {
    // 仍补充提交（如果还没有）
    const subCount0 = await prisma.explorationSubmission.count({
      where: { explorationId: existing.id },
    });
    if (subCount0 === 0) {
      const added = await seedExplorationSubmissions(existing.id, students);
      return { subCount: added, msgCount: 0 };
    }
    return { subCount: 0, msgCount: 0 };
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>探索一元一次方程</title>
<style>
body{font-family:'Microsoft YaHei',sans-serif;max-width:900px;margin:20px auto;padding:0 20px;line-height:1.8;color:#1a1a1a}
.box{background:#f0f9ff;border-left:4px solid #0052d9;padding:16px 20px;border-radius:8px;margin:20px 0}
h1{color:#0052d9}
.equation{font-size:24px;text-align:center;margin:30px 0;padding:20px;background:#fff8e6;border-radius:8px}
button{background:#0052d9;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:15px;margin:8px 4px}
button:hover{background:#003da6}
input{padding:8px 12px;border:2px solid #ddd;border-radius:6px;font-size:16px;width:120px}
.result{margin-top:20px;padding:16px;border-radius:8px;display:none}
</style></head><body>
<h1>探索一元一次方程</h1>
<div class="box">
<p>方程是含有未知数的等式。试着解出下面方程的 x：</p>
<div class="equation" id="eq">3x + 5 = 14</div>
<p>提示：先把常数项移到等号右边，再两边同除以 x 的系数。</p>
<p>请输入 x = <input type="number" id="answer" placeholder="?" /></p>
<button onclick="check()">提交</button>
<button onclick="show()">显示解题步骤</button>
</div>
<div class="result" id="result"></div>
<script>
function check(){
  var v=parseInt(document.getElementById('answer').value);
  var r=document.getElementById('result');
  r.style.display='block';
  if(v===3){
    r.style.background='#e6f7ed';
    r.innerHTML='<h3>✓ 完全正确！</h3><p>你解对了 3x+5=14 的解是 x=3。</p><p>把 5 移到右边：3x = 9，再两边除以 3：x = 3。</p>';
  } else {
    r.style.background='#fff0f0';
    r.innerHTML='<h3>✗ 再试试</h3><p>你输入的是 '+v+'，正确答案是 3。</p><p>移项：3x = 14 - 5 = 9，x = 9 ÷ 3 = 3。</p>';
  }
  window.parent.postMessage({type:'EXPLORATION_SUBMIT', payload:{answer: v, isCorrect: v===3, attempts: 1}}, '*');
}
function show(){
  var r=document.getElementById('result');
  r.style.display='block';
  r.style.background='#f0f9ff';
  r.innerHTML='<h3>解题步骤</h3><p>原方程：3x + 5 = 14</p><p>第一步：移项（5 从左边移到右边变号）：3x = 14 - 5 = 9</p><p>第二步：两边同除以 3：x = 9 ÷ 3 = 3</p><p>所以 x = 3。</p>';
}
</script>
</body></html>`;

  const exp = await prisma.explorationActivity.create({
    data: {
      subProjectId,
      title: "探索一元一次方程",
      description: "通过交互式探究，理解移项与解方程",
      htmlContent,
      sortOrder: 1,
      enabled: true,
      enableSubmission: true,
      enableAiCompanion: true,
      aiCompanionPrompt: `你是一位耐心的一元一次方程辅导老师。
学生正在探究 3x + 5 = 14 的解法。
引导学生思考"移项"的本质——为什么 5 从左边移到右边要变号。
不要直接给出答案，而是用天平等比喻启发学生。`,
      questionsJson: JSON.stringify([
        { id: "q1", type: "FILL_BLANK", content: "方程 3x + 5 = 14 中，x = ___", answer: "3", score: 100 },
      ]),
    },
  });

  // 学生提交
  const subCount = await seedExplorationSubmissions(exp.id, students);

  // AI 伴学对话
  let msgCount = 0;
  if (students.length > 0) {
    const messages = [
      { role: "user", content: "3x+5=14 我不会做，可以给点提示吗？" },
      { role: "assistant", content: "可以的！想象一下，你面前有一个天平。左边放 3 个 x 加一个 5 的砝码，右边放 14 的砝码。现在你想办法让天平平衡。你会怎么移动 5 这个砝码？" },
      { role: "user", content: "放到右边？" },
      { role: "assistant", content: "对！放到右边要换成减号，因为天平要保持平衡。所以 3x = 14 - 5 = 9。继续，x 等于多少？" },
      { role: "user", content: "x = 3！" },
      { role: "assistant", content: "完全正确！🎉 移项的核心就是：跨过等号的数要变号。你学会了吗？" },
    ];

    for (const m of messages) {
      await prisma.aiCompanionMessage.create({
        data: {
          explorationId: exp.id,
          studentId: students[0].id,
          role: m.role,
          content: m.content,
        },
      });
      msgCount++;
    }
  }

  return { subCount, msgCount };
}

async function seedExplorationSubmissions(
  explorationId: string,
  students: { id: string; name: string }[]
) {
  let count = 0;
  const submissions = [
    { answer: "3", score: 95, advice: "解法清晰，移项过程准确。继续保持！" },
    { answer: "4", score: 60, advice: "移项过程正确（3x=9），但最后一步 9÷3=3 而不是 4。检查一下除法。" },
  ];

  for (let i = 0; i < Math.min(2, students.length); i++) {
    const student = students[i];
    const sub = submissions[i] || submissions[0];

    const existing = await prisma.explorationSubmission.findFirst({
      where: { explorationId, studentId: student.id },
    });
    if (existing) continue;

    await prisma.explorationSubmission.create({
      data: {
        explorationId,
        studentId: student.id,
        answers: JSON.stringify({ q1: sub.answer }),
        score: sub.score,
        totalScore: 100,
        learningAdvice: sub.advice,
        status: "graded",
        submittedAt: new Date(Date.now() - 86400000 * (i + 1)),
        gradedAt: new Date(Date.now() - 86400000 * (i + 1) + 3600000),
      },
    });
    count++;
  }

  return count;
}

/**
 * 演示数据入口
 * 幂等：检测到该教师已有班级时跳过
 */
export async function seedDemoForNewTeacher(
  teacherId: string,
  teacherName: string
): Promise<SeedResult> {
  const result: SeedResult = {
    classes: 0, students: 0, tasks: 0, subProjects: 0, presetConversations: 0,
    realConversations: 0, messages: 0, quizActivities: 0, questions: 0,
    quizAttempts: 0, questionAttempts: 0, explorationActivities: 0,
    explorationSubmissions: 0, aiCompanionMessages: 0, templates: 0,
  };

  const existingClassCount = await prisma.class.count({ where: { teacherId } });
  if (existingClassCount > 0) {
    console.log(`[seed-demo] 教师 [${teacherName}] 已有 ${existingClassCount} 个班级，跳过演示数据填充`);
    return result;
  }

  console.log(`[seed-demo] 开始为教师 [${teacherName}] 填充演示数据...`);

  // 1) 基础数据（不填充分析模板，不创建互动探究）
  const base = await seedTeacherData(teacherId, teacherName, false);
  result.classes = 2;
  const studentList = await prisma.user.findMany({
    where: { classId: { in: [base.cls1.id, base.cls2.id] }, role: "STUDENT" },
    orderBy: { studentNo: "asc" },
  });
  result.students = studentList.length;
  result.tasks = 1;
  result.subProjects = 1;
  result.presetConversations = 3;
  result.templates = 0;

  // 2) 真实学生对话（为两个班都填充，所有预设对话都在 sp1 下）
  // 先获取所有预设对话（sp1 下的）
  const presetConvs = await prisma.presetConversation.findMany({
    where: { subProjectId: base.sp1.id },
    orderBy: { sortOrder: "asc" },
  });

  for (const cls of [base.cls1, base.cls2]) {
    const clsStudents = studentList.filter((s: any) => s.classId === cls.id);
    const { convCount, msgCount } = await seedRealConversations(
      cls.id, clsStudents, presetConvs
    );
    result.realConversations += convCount;
    result.messages += msgCount;
  }

  console.log(`[seed-demo] 完成：${JSON.stringify(result)}`);
  return result;
}
