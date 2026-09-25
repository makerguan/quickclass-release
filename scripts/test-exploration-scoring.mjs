// 端到端测试：有分数 vs 无分数 交互探究的 AI 分析效果
// 验证：
//   ① 创建两个探究（口算闯关=有评分 / 单摆模拟=无评分），collectProfile.hasScoring 判定正确
//   ② 学生提交：有分数 score 落库，无分数 score=null
//   ③ 生成 AI 分析：有分数报告含「平均得分/分数分布」，无分数报告不含（不编造分数）
// 用法：先启动 dev server（localhost:3000），再 npx node scripts/test-exploration-scoring.mjs
import { execSync } from "child_process";

const BASE = "http://localhost:3000";
// 设为 1 时跳过阶段 9 清理，保留两个测试探究 + 提交 + 报告，供后台人工核验效果
const KEEP = process.env.KEEP_TEST_DATA === "1";
const DB = "prisma/prisma/dev.db";
const SUB_PROJECT_ID = "cms05ta5u000eeius9k9iq9n2"; // 脸盆教师的「默认活动」
const CLASS_ID = "cmr77iixm0002igbunngd5lzt"; // 五一班
const TEACHER = { phone: "13338183337", password: "123456" };
const STUDENT = { phone: "13800000001", password: "123456" }; // 张三

// —— 有评分 HTML：口算闯关（含「答对/答错/得分」文案 + updateScore 上报）——
const SCORING_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>口算闯关</title></head>
<body>
  <h1>口算闯关</h1>
  <p>题目：3 + 5 = ?</p>
  <input id="ans" type="number" placeholder="输入答案">
  <button onclick="checkAnswer()">提交答案</button>
  <p id="feedback"></p>
  <script>
    var total = 0;
    function checkAnswer() {
      var v = document.getElementById('ans').value;
      if (v == 8) {
        total += 20;
        document.getElementById('feedback').innerText = '答对了！当前得分：' + total + ' 分';
        if (typeof updateScore === 'function') updateScore(total);
      } else {
        document.getElementById('feedback').innerText = '答错了，再想想';
      }
    }
  </script>
</body>
</html>`;

// —— 无评分 HTML：单摆模拟（纯探索，无任何评分文案/计分调用）——
const NOSCORING_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>单摆模拟实验</title></head>
<body>
  <h1>单摆模拟实验</h1>
  <p>拖动滑块调整摆长，观察摆动周期的变化。</p>
  <label>摆长：<input type="range" id="len" min="10" max="100" value="50"></label>
  <canvas id="board" width="400" height="300" style="border:1px solid #ccc;"></canvas>
  <p id="info">当前摆长：50</p>
  <script>
    var len = document.getElementById('len');
    var info = document.getElementById('info');
    var board = document.getElementById('board');
    var ctx = board.getContext('2d');
    function draw() {
      ctx.clearRect(0, 0, 400, 300);
      ctx.beginPath();
      ctx.arc(200, 30, 15, 0, Math.PI * 2);
      ctx.stroke();
    }
    len.addEventListener('input', function () {
      info.innerText = '当前摆长：' + len.value;
      draw();
    });
    draw();
  </script>
</body>
</html>`;

function db(sql) {
  return execSync(`sqlite3 ${DB} "${sql.replace(/"/g, '""')}"`).toString().trim();
}

async function login(phone, password) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json();
  if (!data.token) throw new Error("登录失败 " + phone + ": " + JSON.stringify(data));
  return data.token;
}

async function api(path, method, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let failed = 0;
function assert(cond, msg) {
  console.log((cond ? "  ✅ " : "  ❌ ") + msg);
  if (!cond) failed++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("=== 阶段 1：登录 ===");
  const teacherToken = await login(TEACHER.phone, TEACHER.password);
  const studentToken = await login(STUDENT.phone, STUDENT.password);
  console.log("  教师 / 学生 登录成功");

  console.log("\n=== 阶段 2：创建两个探究（开启提交，触发 collectProfile 分析）===");
  const mk = (title, html) => api("/api/exploration-activities", "POST", teacherToken, {
    subProjectId: SUB_PROJECT_ID, title, description: title, htmlContent: html, enableSubmission: true,
  });

  const scoring = await mk("测试-口算闯关(有分数)", SCORING_HTML);
  const noscoring = await mk("测试-单摆模拟(无分数)", NOSCORING_HTML);
  const scoringId = scoring.data?.id;
  const noscoringId = noscoring.data?.id;
  console.log("  有分数探究 id:", scoringId, "| status:", scoring.status);
  console.log("  无分数探究 id:", noscoringId, "| status:", noscoring.status);
  assert(scoring.status === 200 && scoringId, "有分数探究创建成功");
  assert(noscoring.status === 200 && noscoringId, "无分数探究创建成功");
  if (!scoringId || !noscoringId) { console.log("创建失败，终止"); return; }

  console.log("\n=== 阶段 3：断言 collectProfile.hasScoring ===");
  const scoringProfile = db(`SELECT collectProfile FROM ExplorationActivity WHERE id='${scoringId}';`);
  const noscoringProfile = db(`SELECT collectProfile FROM ExplorationActivity WHERE id='${noscoringId}';`);
  console.log("  有分数 collectProfile:", scoringProfile);
  console.log("  无分数 collectProfile:", noscoringProfile);
  const scoringHasScoring = JSON.parse(scoringProfile).hasScoring;
  const noscoringHasScoring = JSON.parse(noscoringProfile).hasScoring;
  assert(scoringHasScoring === true, "有分数探究 → hasScoring=true");
  assert(noscoringHasScoring === false, "无分数探究 → hasScoring=false");

  console.log("\n=== 阶段 4：学生提交 ===");
  const subScoring = await api(`/api/exploration-activities/${scoringId}/submit`, "POST", studentToken, {
    timeSpent: 90, interactions: 8, scrollDepth: 60, attempts: 1,
    score: 85, maxScore: 100, completedSections: ["口算"], gameLevel: 1,
    taskTitle: "测试-口算闯关", studentName: "张三", className: "五一班",
    actionLog: [{ type: "click", target: "提交答案", value: "8", timestamp: Date.now() }],
    answers: { "答案": "8" },
    gameState: { score: 85, maxScore: 100 },
  });
  const subNoscoring = await api(`/api/exploration-activities/${noscoringId}/submit`, "POST", studentToken, {
    timeSpent: 120, interactions: 12, scrollDepth: 40, attempts: 1,
    score: null, maxScore: null, completedSections: [], gameLevel: 1,
    taskTitle: "测试-单摆模拟", studentName: "张三", className: "五一班",
    actionLog: [{ type: "click", target: "摆长滑块", value: "拖动", timestamp: Date.now() }],
    answers: { "摆长": "50" },
    gameState: {},
  });
  console.log("  有分数提交 status:", subScoring.status, "| 响应 score:", subScoring.data?.score);
  console.log("  无分数提交 status:", subNoscoring.status, "| 响应 score:", subNoscoring.data?.score);
  assert(subScoring.status === 200 && subScoring.data?.score === 85, "有分数提交 score=85");
  assert(subNoscoring.status === 200 && subNoscoring.data?.score === null, "无分数提交 score=null");

  console.log("\n=== 阶段 5：断言 score 落库 ===");
  const dbScoringScore = db(`SELECT score FROM ExplorationSubmission WHERE explorationId='${scoringId}';`);
  const dbNoscoringScore = db(`SELECT score FROM ExplorationSubmission WHERE explorationId='${noscoringId}';`);
  console.log("  有分数落库 score:", dbScoringScore, "| 无分数落库 score:", dbNoscoringScore);
  assert(dbScoringScore === "85" || dbScoringScore === "85.0", "有分数落库 score=85");
  assert(dbNoscoringScore === "" || dbNoscoringScore === "NULL", "无分数落库 score 为空/null");

  console.log("\n=== 阶段 6：生成 AI 分析报告（调用真实 AI，约 20-40s ×2）===");
  const genScoring = await api(`/api/exploration-activities/${scoringId}/analysis/generate`, "POST", teacherToken, { classId: CLASS_ID });
  console.log("  有分数报告生成 status:", genScoring.status, "| 长度:", genScoring.data?.content?.length ?? 0);
  await sleep(1000);
  const genNoscoring = await api(`/api/exploration-activities/${noscoringId}/analysis/generate`, "POST", teacherToken, { classId: CLASS_ID });
  console.log("  无分数报告生成 status:", genNoscoring.status, "| 长度:", genNoscoring.data?.content?.length ?? 0);
  assert(genScoring.status === 200, "有分数报告生成成功");
  assert(genNoscoring.status === 200, "无分数报告生成成功");

  const scoringContent = genScoring.data?.content || "";
  const noscoringContent = genNoscoring.data?.content || "";

  console.log("\n=== 阶段 7：断言报告内容（分数维度）===");
  const scoringHasAvg = /平均得分|平均分|分数分布/.test(scoringContent);
  const noscoringHasAvg = /平均得分|平均分|分数分布/.test(noscoringContent);
  const noscoringMention = /无评分环节|本探究无评分|不涉及评分/.test(noscoringContent);
  console.log("  有分数报告含「平均得分/分数分布」:", scoringHasAvg);
  console.log("  无分数报告含「平均得分/分数分布」:", noscoringHasAvg);
  console.log("  无分数报告是否明示「无评分」:", noscoringMention);
  assert(scoringHasAvg, "有分数报告 → 含平均得分/分数分布");
  assert(!noscoringHasAvg, "无分数报告 → 不含平均得分/分数分布（未编造分数）");

  console.log("\n=== 阶段 8：报告正文摘录（供人工核验）===");
  console.log("\n----- 有分数报告（前 1200 字）-----\n" + scoringContent.slice(0, 1200));
  console.log("\n----- 无分数报告（前 1200 字）-----\n" + noscoringContent.slice(0, 1200));

  console.log("\n=== 阶段 9：清理测试数据 ===");
  if (KEEP) {
    console.log("  ⏭  KEEP_TEST_DATA=1，跳过清理，保留测试探究供后台人工核验");
    console.log("  · 有分数探究「测试-口算闯关(有分数)」 id:", scoringId);
    console.log("  · 无分数探究「测试-单摆模拟(无分数)」 id:", noscoringId);
    console.log("  · 查看入口：课堂管理 → 五一班（默认活动）→ 互动探究");
  } else {
    const del1 = await api(`/api/exploration-activities/${scoringId}`, "DELETE", teacherToken);
    const del2 = await api(`/api/exploration-activities/${noscoringId}`, "DELETE", teacherToken);
    console.log("  删除有分数探究:", del1.status, "| 删除无分数探究:", del2.status);
    // 清理测试标题的 QF 收集任务残留（qf_tasks 用 name 字段）
    db(`DELETE FROM qf_tasks WHERE name LIKE '测试-%';`);
    console.log("  QF 任务残留已清理");
  }

  console.log(failed ? "\n结果：❌ " + failed + " 个断言失败" : "\n结果：✅ 全部通过");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error("测试异常:", e.message);
  process.exit(1);
});
