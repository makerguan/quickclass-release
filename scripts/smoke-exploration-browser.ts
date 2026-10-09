/**
 * 交互探究提交采集（双轨方案）浏览器冒烟测试
 * 运行：npx tsx scripts/smoke-exploration-browser.ts
 * 验证真实浏览器全链路：注入 → 闯关（契约轨+防御式调用）→ 提交 → postMessage payload
 * 重点覆盖 vm 测试无法验证的部分：真实 canvas.toDataURL 截图、QuickForm 面板、事件流
 */
import { chromium } from "@playwright/test";
import { writeFileSync, unlinkSync } from "node:fs";
import { injectSubmitFunctionality } from "../src/lib/prompts/exploration-submit";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

// 模拟 AI 按【数据上报规范】生成的三关计分游戏（含 canvas 绘图）
const aiHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>三关探究</title></head>
<body>
<h1>植物生长三关</h1>
<div id="status">第 1 关，得分：0</div>
<canvas id="art" width="400" height="300"></canvas>
<button id="play" onclick="advance()">过关</button>
<script>
// ===== 按数据上报规范生成（主通道 __gameState__ + 防御式调用）=====
window.__gameState__ = { score: 0, gameLevel: 1, maxScore: 300, completedSections: [] };
var level = 1, score = 0;
function advance() {
  score += 100;
  level += 1;
  window.__gameState__.score = score;
  window.__gameState__.gameLevel = level;
  window.__gameState__.completedSections.push("第" + (level - 1) + "关");
  if (typeof updateScore === "function") updateScore(score);
  if (typeof setGameLevel === "function") setGameLevel(level);
  if (typeof completeSection === "function") completeSection("第" + (level - 1) + "关");
  document.getElementById("status").textContent = "第 " + level + " 关，得分：" + score;
}
var ctx = document.getElementById("art").getContext("2d");
ctx.fillStyle = "#4CAF50";
ctx.fillRect(50, 50, 200, 150);
ctx.fillStyle = "#fff";
ctx.font = "20px sans-serif";
ctx.fillText("我的作品", 90, 135);
</script>
</body></html>`;

const { html: injected, warnings } = injectSubmitFunctionality(aiHtml, {
  explorationId: "smoke-test",
  taskTitle: "冒烟任务",
  studentName: "测试学生",
  className: "测试班",
});
console.log(`注入完成（warnings: ${warnings.length} 条）`);

// file:// 下 window.parent === window：监听自身 message 事件，把 payload 转发到 console
const wrapped = injected.replace(
  "</head>",
  `<script>window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "EXPLORATION_SUBMIT") console.log("CAPTURED:" + JSON.stringify(e.data.payload));
  });</script></head>`
);
const tmpFile = "/tmp/smoke-exploration.html";
writeFileSync(tmpFile, wrapped);

async function main() {
const browser = await chromium.launch();
const page = await browser.newPage();
const captured: any[] = [];
page.on("console", (msg) => {
  const t = msg.text();
  if (t.startsWith("CAPTURED:")) captured.push(JSON.parse(t.slice(9)));
});

try {
  await page.goto("file://" + tmpFile);

  // 闯三关
  await page.click("#play");
  await page.click("#play");
  await page.click("#play");
  const statusText = await page.textContent("#status");
  console.log(`页面状态：${statusText?.trim()}`);

  // 在 QuickForm 通用面板填写（模拟学生填写姓名与发现）
  const nameInput = page.locator('input[placeholder*="姓名"], input[name*="name"], #qf-name').first();
  if (await nameInput.count() > 0) {
    await nameInput.fill("张三");
  }

  // 提交
  await page.click("#submitBtn");
  await page.waitForTimeout(800);

  const p = captured[captured.length - 1];
  assert(!!p, "postMessage 已捕获（EXPLORATION_SUBMIT）");
  if (p) {
    console.log(`  payload 摘要: score=${p.score} maxScore=${p.maxScore} gameLevel=${p.gameLevel} sections=${JSON.stringify(p.completedSections)}`);
    assert(p.score === 300, "score = 300（三关 × 100，双轨合并）");
    assert(p.maxScore === 300, "maxScore = 300（AI 设计满分）");
    assert(p.gameLevel === 4, "gameLevel = 4（闯过三关后）");
    assert(Array.isArray(p.completedSections) && p.completedSections.length === 3, "completedSections = 3 关");
    assert(p.scoreInferred === false, "非推测值（契约轨直报）");
    assert(p.gameState && p.gameState.score === 300, "gameState 明细完整");
    assert(Array.isArray(p.canvasSnapshots) && p.canvasSnapshots.length === 1, "canvas 快照 = 1 张");
    assert(
      p.canvasSnapshots && typeof p.canvasSnapshots[0] === "string" && p.canvasSnapshots[0].startsWith("data:image/jpeg"),
      "快照为真实 jpeg dataURL"
    );
    assert(p.canvasSnapshots && p.canvasSnapshots[0].length > 1000, "快照有实际内容（>1KB，纯色图形 jpeg 本身较小）");
    assert(typeof p.textSnapshot === "string" && p.textSnapshot.includes("植物生长三关"), "文本快照含页面内容");
    assert(typeof p.timeSpent === "number", "timeSpent 已采集");
    // submitBtn 的 onclick 在 target 阶段同步执行 postMessage，document 级 click 监听（bubble）在其后，
    // 故提交瞬间的点击尚未计入 interactions，>= 3 为正常时序
    assert(p.interactions >= 3, `interactions >= 3（实际 ${p.interactions}）`);
    const autoLogs = (p.actionLog || []).filter((l: any) => String(l.type).startsWith("auto:"));
    assert(autoLogs.length >= 4, `行为流 auto:* >= 4 条（实际 ${autoLogs.length}）`);
    assert(!("token" in (p.storageSnapshot || {})), "storageSnapshot 无 token");
    const answers = p.answers || {};
    assert(Object.keys(answers).length === 0 || Object.values(answers).some((v: any) => v), "QuickForm answers 结构正常");
  }
} finally {
  await browser.close();
  try { unlinkSync(tmpFile); } catch { /* 忽略 */ }
}

console.log(`\n========== 冒烟结果：${passed} 通过 / ${failed} 失败 ==========`);
if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("冒烟测试执行失败：", e);
  process.exit(1);
});
