// 双轨探究端到端测试（API 数据链路 + 数据库断言）
// 验证：
//   ① 开启提交 → 绑定 QuickForm 收集任务（qfTaskId 落库）
//   ② 学生提交 → QF 记录 + 行为数据 + 操作日志 三轨同时落库
//   ③ 学生重提交 → 原子替换（qf_records 一人一条，旧 recordId 删、新 recordId 在）
// 测试前已备份数据库；测完由主流程恢复。
import { execSync } from "child_process";

const BASE = "http://localhost:3000";
const DB = "prisma/prisma/dev.db";
const EXPLORATION_ID = "cmu76m7mn00031fjfpvzs9lca"; // 「面积」探究（enableSubmission=0, qfTaskId 空）

// 1x1 透明 PNG（占位 canvas 快照，验证图片字段能落库并被前端渲染）
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

function submitBody(round) {
  return {
    timeSpent: 120 + round,
    interactions: 15 + round,
    scrollDepth: 80,
    attempts: round,
    score: 85 + round,
    maxScore: 100,
    completedSections: ["环节一", "环节二"],
    gameLevel: 3,
    taskTitle: "面积",
    studentName: "张三",
    className: "五一班",
    actionLog: [
      { type: "click", target: "canvas", value: `画图-第${round}次`, timestamp: Date.now() },
      { type: "input", target: "textarea", value: `计算面积-第${round}次`, timestamp: Date.now() + 1 },
    ],
    answers: { "我的发现": `发现${round}：长方形面积=长×宽`, "结论": `结论${round}` },
    gameState: { score: 85 + round, level: 3 },
    scoreInferred: false,
    canvasSnapshots: [TINY_PNG],
    storageSnapshot: { "myKey": `value${round}` },
    textSnapshot: `页面文本快照-第${round}次`,
  };
}

function assert(cond, msg) {
  console.log((cond ? "  ✅ " : "  ❌ ") + msg);
  if (!cond) process.exitCode = 1;
}

async function main() {
  console.log("=== 阶段 1：登录 ===");
  const teacherToken = await login("13338183337", "123456");
  const studentToken = await login("13800000001", "123456");
  console.log("  教师 / 学生 登录成功");

  console.log("\n=== 阶段 2：开启提交 → 绑定 QF 任务 ===");
  const put = await api(`/api/exploration-activities/${EXPLORATION_ID}`, "PUT", teacherToken, { enableSubmission: true });
  const qfTaskId = put.data?.qfTaskId || null;
  console.log("  PUT status:", put.status, "| qfTaskId:", qfTaskId, "| 注入警告:", put.data?._injectWarnings || "无");
  assert(put.status === 200, "PUT 开启提交成功");
  assert(!!qfTaskId, "qfTaskId 已绑定落库");
  if (!qfTaskId) { console.log("qfTaskId 为空，无法继续"); return; }

  const taskCnt = db(`SELECT COUNT(*) FROM qf_tasks WHERE id='${qfTaskId}';`);
  assert(taskCnt === "1", "qf_tasks 表中存在该任务");

  console.log("\n=== 阶段 3：学生首次提交 ===");
  const sub1 = await api(`/api/exploration-activities/${EXPLORATION_ID}/submit`, "POST", studentToken, submitBody(1));
  console.log("  首次提交 status:", sub1.status, "| 响应:", JSON.stringify(sub1.data));
  assert(sub1.status === 200, "首次提交成功");
  assert(sub1.data?.answersStored === true, "QF 答案已写入（answersStored=true）");

  const recId1 = db(`SELECT qfRecordId FROM ExplorationSubmission WHERE explorationId='${EXPLORATION_ID}' AND studentId='cmr78bxl3000digbu2m6gun9a';`);
  console.log("  submission.qfRecordId =", recId1 || "(空)");
  assert(!!recId1, "submission.qfRecordId 已回填");

  const qfCnt1 = db(`SELECT COUNT(*) FROM qf_records WHERE task_id='${qfTaskId}';`);
  const subCnt1 = db(`SELECT COUNT(*) FROM ExplorationSubmission WHERE explorationId='${EXPLORATION_ID}';`);
  const logCnt1 = db(`SELECT COUNT(*) FROM ExplorationActionLog al JOIN ExplorationSubmission es ON es.id=al.submissionId WHERE es.explorationId='${EXPLORATION_ID}';`);
  console.log(`  落库：qf_records=${qfCnt1} 条，submission=${subCnt1} 条，actionLog=${logCnt1} 条`);
  assert(qfCnt1 === "1", "qf_records 恰好 1 条");
  assert(subCnt1 === "1", "ExplorationSubmission 恰好 1 条");
  assert(Number(logCnt1) >= 2, "操作日志已写入（≥2 条）");

  // 验证 QF 记录内容 + canvas 快照落库
  const qfData1 = db(`SELECT data_json, student_id FROM qf_records WHERE id='${recId1}';`);
  console.log("  首次 QF 记录 data_json:", qfData1);
  assert(qfData1.includes("发现1"), "QF 记录包含首次答案「发现1」");
  assert(qfData1.includes("cmr78bxl3000digbu2m6gun9a"), "QF 记录 student_id = 张三");
  const subAnswers1 = db(`SELECT answers FROM ExplorationSubmission WHERE id=(SELECT id FROM ExplorationSubmission WHERE explorationId='${EXPLORATION_ID}' LIMIT 1);`);
  assert(subAnswers1.includes("canvasSnapshots") && subAnswers1.includes("data:image/png"), "行为数据含 canvas 快照");

  console.log("\n=== 阶段 4：学生重提交（触发原子替换）===");
  await new Promise((r) => setTimeout(r, 300));
  const sub2 = await api(`/api/exploration-activities/${EXPLORATION_ID}/submit`, "POST", studentToken, submitBody(2));
  console.log("  重提交 status:", sub2.status, "| 响应:", JSON.stringify(sub2.data));
  assert(sub2.status === 200, "重提交成功");
  assert(sub2.data?.answersStored === true, "重提交 QF 答案已写入");

  const recId2 = db(`SELECT qfRecordId FROM ExplorationSubmission WHERE explorationId='${EXPLORATION_ID}' AND studentId='cmr78bxl3000digbu2m6gun9a';`);
  console.log("  重提交后 submission.qfRecordId =", recId2);
  assert(!!recId2 && recId2 !== recId1, "submission.qfRecordId 更新为新 recordId");

  const qfCnt2 = db(`SELECT COUNT(*) FROM qf_records WHERE task_id='${qfTaskId}';`);
  const subCnt2 = db(`SELECT COUNT(*) FROM ExplorationSubmission WHERE explorationId='${EXPLORATION_ID}';`);
  const oldRecExists = db(`SELECT COUNT(*) FROM qf_records WHERE id='${recId1}';`);
  const newRecExists = db(`SELECT COUNT(*) FROM qf_records WHERE id='${recId2}';`);
  console.log(`  重提交后：qf_records=${qfCnt2} 条（旧=${oldRecExists}，新=${newRecExists}），submission=${subCnt2} 条`);
  assert(qfCnt2 === "1", "重提交后 qf_records 仍恰好 1 条（一人一条）");
  assert(oldRecExists === "0", "旧 recordId 已删除");
  assert(newRecExists === "1", "新 recordId 已写入");
  assert(subCnt2 === "1", "重提交后 submission 仍 1 条（未重复）");

  const qfData2 = db(`SELECT data_json FROM qf_records WHERE id='${recId2}';`);
  assert(qfData2.includes("发现2") && !qfData2.includes("发现1"), "新 QF 记录内容已更新（发现2，且不含发现1）");

  console.log("\n=== 阶段 5：汇总 ===");
  console.log("qfTaskId:", qfTaskId);
  console.log("首次 recordId:", recId1);
  console.log("重提交 recordId:", recId2);
  console.log(process.exitCode ? "\n结果：❌ 存在失败断言" : "\n结果：✅ 全部通过");
}

main().catch((e) => {
  console.error("测试异常:", e.message);
  process.exit(1);
});
