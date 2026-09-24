// 双轨探究 UI 测试（playwright）：验证老师端「提交详情」页签的「收集数据/行为数据」双视图切换
// 前置：已由 test-qf-dual-track.mjs 造好数据（1 条 QF 记录 + 1 条行为提交 + 2 条操作日志 + 1 张 canvas 快照）
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const URL = `${BASE}/teacher/tasks/cmr77j8wd0004igburgzk6r9t/exploration/cmu76m7mn00031fjfpvzs9lca`;

async function getSession() {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "13338183337", password: "123456" }),
  });
  const data = await res.json();
  if (!data.token) throw new Error("登录失败: " + JSON.stringify(data));
  return data; // { token, user }
}

function assert(cond, msg) {
  console.log((cond ? "  ✅ " : "  ❌ ") + msg);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const session = await getSession();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // 先访问 origin，注入 token + user（TeacherLayout 靠 user 判断登录态），再跳探究详情页
  await page.goto(BASE + "/login");
  await page.evaluate((d) => {
    localStorage.setItem("token", d.token);
    localStorage.setItem("user", JSON.stringify(d.user));
  }, session);
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  // 等标题出现
  await page.getByText("探究分析报告", { exact: true }).waitFor({ timeout: 15000 }).catch(() => {});
  console.log("=== ① 页面加载 ===");
  assert((await page.getByText("探究分析报告", { exact: true }).count()) > 0, "探究分析页加载成功");

  // 切到「提交详情」页签
  console.log("\n=== ② 提交详情页签 ===");
  const subTab = page.getByRole("button", { name: "提交详情" });
  await subTab.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  assert((await subTab.count()) > 0, "「提交详情」页签存在");
  await subTab.click();
  await page.waitForTimeout(1200);

  // 验证双视图切换按钮
  console.log("\n=== ③ 双视图切换按钮 ===");
  const qfBtn = page.getByRole("button", { name: /收集数据/ });
  const behaviorBtn = page.getByRole("button", { name: /行为数据/ });
  await qfBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  const qfBtnText = (await qfBtn.count()) > 0 ? (await qfBtn.first().innerText()).trim() : "";
  const behaviorBtnText = (await behaviorBtn.count()) > 0 ? (await behaviorBtn.first().innerText()).trim() : "";
  console.log("  收集数据按钮:", qfBtnText || "(不存在)");
  console.log("  行为数据按钮:", behaviorBtnText || "(不存在)");
  assert(qfBtnText.includes("收集数据（1）"), "「收集数据（1）」按钮存在");
  assert(behaviorBtnText.includes("行为数据（1）"), "「行为数据（1）」按钮存在");

  // 默认「收集数据」视图：QuickFormRecordList 应显示张三的 QF 答案
  console.log("\n=== ④ 默认收集数据视图 ===");
  await page.waitForTimeout(500);
  const qfHasZhang = (await page.getByText("张三", { exact: true }).count()) > 0;
  const qfHasAnswer = (await page.getByText(/发现2/).count()) > 0;
  console.log("  收集数据视图含「张三」:", qfHasZhang, "| 含答案「发现2」:", qfHasAnswer);
  assert(qfHasZhang || qfHasAnswer, "收集数据视图展示 QF 名单/答案");

  // 切到「行为数据」视图
  console.log("\n=== ⑤ 切到行为数据视图 ===");
  await behaviorBtn.first().click();
  await page.waitForTimeout(800);
  const behaviorHasCount = (await page.getByText(/共 1 人提交/).count()) > 0;
  const behaviorHasZhang = (await page.getByText("张三", { exact: true }).count()) > 0;
  console.log("  行为数据视图「共 1 人提交」:", behaviorHasCount, "| 含「张三」:", behaviorHasZhang);
  assert(behaviorHasCount, "行为数据视图显示「共 1 人提交」");
  assert(behaviorHasZhang, "行为数据视图显示学生「张三」");

  // 展开学生，验证作品快照 + 操作记录 + 页面状态
  console.log("\n=== ⑥ 展开学生看作品快照 / 操作记录 ===");
  await page.getByText("张三", { exact: true }).first().click();
  await page.waitForTimeout(1000);

  const canvasTitle = await page.getByText("🖼️ 作品快照").count();
  const canvasImg = await page.locator('img[alt^="作品快照"]').count();
  const logTitle = await page.getByText("📋 操作记录").count();
  const logItems = await page.locator("text=click").count();
  const gameStateTitle = await page.getByText("🤖 页面状态（AI 上报）").count();

  console.log("  「🖼️ 作品快照」标题:", canvasTitle > 0);
  console.log("  canvas 快照 <img> 数量:", canvasImg);
  console.log("  「📋 操作记录」标题:", logTitle > 0);
  console.log("  操作日志条目（含 click）:", logItems > 0);
  console.log("  「🤖 页面状态」标题:", gameStateTitle > 0);

  assert(canvasTitle > 0, "「作品快照」区块渲染");
  assert(canvasImg >= 1, "canvas 快照图片已渲染（≥1 张）");
  assert(logTitle > 0, "「操作记录」区块渲染");
  assert(logItems >= 1, "操作日志条目已渲染（≥1 条）");
  assert(gameStateTitle > 0, "「页面状态」区块渲染");

  // 切回收集数据，确认切换来回正常
  console.log("\n=== ⑦ 切回收集数据视图 ===");
  await qfBtn.first().click();
  await page.waitForTimeout(500);
  const backToQf = (await page.getByText(/发现2/).count()) > 0;
  assert(backToQf, "切回收集数据视图正常");

  console.log("\n页面运行时错误:", pageErrors.length ? pageErrors : "无");
  await browser.close();
  console.log(process.exitCode ? "\n结果：❌ 存在失败断言" : "\n结果：✅ 全部通过");
}

main().catch((e) => {
  console.error("UI 测试异常:", e.message);
  process.exit(1);
});
