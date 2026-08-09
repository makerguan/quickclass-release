// 端到端：对话活动 新建 → 通栏显示 → 编辑 → 删除确认弹窗 → 删除
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
let passed = 0, failed = 0;
function log(desc, ok, detail = "") {
  if (ok) { console.log(`  ✅ ${desc}`); passed++; }
  else { console.log(`  ❌ ${desc}${detail ? " — " + detail : ""}`); failed++; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("=== 对话活动端到端（通栏单列） ===\n");
  const loginRes = await fetch(`${BASE}/api/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ phone:"13338183337", password:"123456" }) });
  const { token, user } = await loginRes.json();
  const b = await chromium.launch({ headless:true });
  const p = await b.newPage();
  p.on("pageerror", e=>console.log("  [PAGEERROR]", e.message));
  await p.goto(BASE+"/login",{waitUntil:"domcontentloaded"});
  await p.evaluate(([t,u])=>{localStorage.setItem("token",t);localStorage.setItem("user",JSON.stringify(u));},[token,user]);
  await p.goto(BASE+"/teacher/tasks",{waitUntil:"domcontentloaded"});
  await sleep(3500);

  // 对话活动区块内定位（避免误点互动探究/作业）
  const convScope = p.locator("text=对话活动").first().locator("..").locator("..").locator("..").locator("..");

  // 新建
  await convScope.locator("button:has-text('新建对话')").first().click();
  await sleep(800);
  await p.locator("input[placeholder*='圆的认识探究对话']").fill("端到端验证对话");
  await p.locator("textarea[placeholder*='希望学生达成的目标']").fill("目标");
  await p.locator("textarea[placeholder*='个人学情分析的提示词']").fill("x");
  await p.locator("textarea[placeholder*='全班学情分析的提示词']").fill("y");
  await p.locator("button:has-text('创建')").last().click({ force: true });
  await sleep(1800);
  log("新建后名片显示（通栏）", (await p.locator("text=端到端验证对话").count()) > 0);

  // 编辑（对话活动区内的编辑按钮）
  const card = convScope.locator("div.border.border-\\[\\#E7EAF0\\]:has-text('端到端验证对话')").first();
  await card.locator("button:has-text('编辑')").first().click();
  await sleep(800);
  await p.locator("input[placeholder*='圆的认识探究对话']").fill("端到端验证对话-改");
  await p.locator("button:has-text('保存')").last().click({ force: true });
  await sleep(1500);
  log("编辑后名片更新", (await p.locator("text=端到端验证对话-改").count()) > 0);

  // 删除（对话活动区内的删除按钮 → 确认弹窗）
  const card2 = convScope.locator("div.border.border-\\[\\#E7EAF0\\]:has-text('端到端验证对话-改')").first();
  await card2.locator("button:has-text('删除')").first().click();
  await sleep(900);
  log("删除确认弹窗出现", (await p.locator("text=删除对话活动").count()) > 0 && (await p.locator(".t-dialog__footer button:has-text('删除')").count()) > 0);
  // 确认删除
  await p.locator(".t-dialog__footer button:has-text('删除')").first().click({ force: true });
  await sleep(1700);
  log("删除后名片消失", (await p.locator("text=端到端验证对话-改").count()) === 0);

  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  await b.close();
  if (failed > 0) process.exit(1);
})().catch(e=>{ console.error("❌ 异常:", e.message); process.exit(1); });
