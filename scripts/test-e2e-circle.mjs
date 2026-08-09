/**
 * 端到端测试：圆的认识课堂 - 添加活动、学生对话、课堂作业答题
 */
const BASE = "http://localhost:3000";

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

async function main() {
  // 1. 教师登录
  console.log("=== 1. 教师登录 ===");
  const login = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "13338183337", password: "123456" }),
  });
  console.log("登录:", login.status, login.data?.user?.name);
  const token = login.data?.token;
  if (!token) { console.error("登录失败"); return; }
  const tAuth = { Authorization: `Bearer ${token}` };

  // 2. 学生登录
  console.log("\n=== 2. 学生登录 ===");
  const stuLogin = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "13800000001", password: "123456" }),
  });
  const stuToken = stuLogin.data?.token;
  console.log("学生:", stuLogin.status, stuLogin.data?.user?.name);
  const sAuth = { Authorization: `Bearer ${stuToken}` };

  const taskId = "cmr77j8wd0004igburgzk6r9t";
  const spId = "cms05ta5u000eeius9k9iq9n2";
  const classId = "cmr77iixm0002igbunngd5lzt";

  // 3. 确认课堂
  console.log("\n=== 3. 确认课堂 ===");
  const task = await api(`/api/tasks`, { headers: tAuth });
  const circle = task.data?.find(t => t.id === taskId);
  console.log(circle?.title, "状态:", circle?.status);

  // 4. 添加预设对话
  console.log("\n=== 4. 添加预设对话 ===");
  const createPc = await api("/api/preset-conversations", {
    method: "POST",
    headers: { ...tAuth, "Content-Type": "application/json" },
    body: JSON.stringify({
      subProjectId: spId,
      title: "圆的基本概念",
      description: "圆的定义、圆心、半径、直径等基本概念",
      analysisPrompt: "分析学生对圆的基本概念的理解程度",
    }),
  });
  console.log("预设对话:", createPc.status, createPc.data?.title, createPc.data?.id);
  const pcId = createPc.data?.id;

  // 5. 启用预设对话
  if (pcId) {
    console.log("\n=== 5. 启用预设对话 ===");
    const enable = await api(`/api/preset-conversations/${pcId}/enabled`, {
      method: "PUT",
      headers: { ...tAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    console.log("启用:", enable.status);
  }

  // 6. 学生对话（使用 /api/chat，自动创建 conversation）
  console.log("\n=== 6. 学生对话 ===");
  const chatRes = await api("/api/chat", {
    method: "POST",
    headers: { ...sAuth, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "老师好，我想了解圆的定义和基本概念" }],
      classId,
      presetConversationId: pcId,
    }),
  });
  console.log("对话响应:", chatRes.status, chatRes.text?.slice(0, 200));

  // 7. 创建课堂作业
  console.log("\n=== 7. 创建课堂作业 ===");
  const createQuiz = await api("/api/quiz-activities", {
    method: "POST",
    headers: { ...tAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ subProjectId: spId, title: "圆的练习题", description: "圆的基本概念练习" }),
  });
  console.log("创建作业:", createQuiz.status, createQuiz.data?.title, createQuiz.data?.id);
  const quizId = createQuiz.data?.id;

  // 8. 添加题目
  if (quizId) {
    console.log("\n=== 8. 添加题目 ===");
    const saveQ = await api(`/api/quiz-activities/${quizId}/questions`, {
      method: "PUT",
      headers: { ...tAuth, "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: [
          {
            type: "SINGLE_CHOICE",
            content: "圆的半径和直径的关系是？",
            options: { A: "半径=直径", B: "半径=直径/2", C: "半径=直径×2", D: "半径=直径×π" },
            answer: "B",
            difficulty: "BASIC",
            score: 5,
          },
          {
            type: "SINGLE_CHOICE",
            content: "圆心决定圆的什么？",
            options: { A: "大小", B: "位置", C: "周长", D: "面积" },
            answer: "B",
            difficulty: "BASIC",
            score: 5,
          },
        ],
      }),
    });
    console.log("添加题目:", saveQ.status, saveQ.data?.count, "题");
  }

  // 9. 生效作业
  if (quizId) {
    console.log("\n=== 9. 生效作业 ===");
    const publish = await api(`/api/quiz-activities/${quizId}/publish`, {
      method: "POST",
      headers: { ...tAuth },
    });
    console.log("生效:", publish.status, publish.data?.status);
  }

  // 10. 获取题目列表（拿 questionId）
  let questionIds = [];
  if (quizId) {
    console.log("\n=== 10. 获取题目 ===");
    const questions = await api(`/api/quiz-activities/${quizId}/questions`, { headers: tAuth });
    console.log("题目数:", questions.data?.length);
    questionIds = questions.data?.map(q => q.id) || [];
    console.log("题目ID:", questionIds);
  }

  // 11. 清空旧答题（如果有）
  if (quizId) {
    const clear = await api(`/api/quiz-activities/${quizId}/clear-attempts`, {
      method: "POST",
      headers: { ...tAuth },
    });
    console.log("\n=== 11. 清空旧答题 ===");
    console.log("清空:", clear.status);
  }

  // 12. 学生答题
  if (quizId && questionIds.length) {
    console.log("\n=== 12. 学生答题 ===");
    const attempt = await api(`/api/quiz-activities/${quizId}/attempts`, {
      method: "POST",
      headers: { ...sAuth, "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: [
          { questionId: questionIds[0], selectedAnswer: "B" },
          { questionId: questionIds[1], selectedAnswer: "B" },
        ],
      }),
    });
    console.log("答题:", attempt.status);
    console.log("得分:", attempt.data?.score, "/", attempt.data?.maxTotalScore, "正确:", attempt.data?.correctCount, "/", attempt.data?.totalQuestions);
  }

  // 13. 教师查看报告
  if (quizId) {
    console.log("\n=== 13. 教师查看报告 ===");
    const report = await api(`/api/quiz-activities/${quizId}/report`, { headers: tAuth });
    console.log("报告:", report.status);
    if (report.data) {
      console.log("总提交:", report.data.totalAttempts, "平均分:", report.data.averageScore);
    }
  }

  console.log("\n=== 测试完成 ===");
}

main().catch(e => { console.error("异常:", e.message); process.exit(1); });
