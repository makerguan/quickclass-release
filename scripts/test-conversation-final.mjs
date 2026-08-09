// 最终验证：隐藏老对话管理后，名片式 CRUD 仍正常
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
let passed = 0, failed = 0;
function log(desc, ok, detail = "") {
  if (ok) { console.log(`  ✅ ${desc}`); passed++; }
  else { console.log(`  ❌ ${desc}${detail ? " — " + detail : ""}`); failed++; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("=== 最终验证：名片式 CRUD（隐藏老入口） ===\n");
  const loginRes = await fetch(`${BASE}/api/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ phone:"13338183337", password:"123456" }) });
  const { token, user } = await loginRes.json();
  const b = await chromium.launch({ headless:true });
  const p = await b.newPage();
  p.on("pageerror", e=>console.log("  [PAGEERROR]", e.message));
  await p.goto(BASE+"/login",{waitUntil:"domcontentloaded"});
  await p.evaluate(([t,u])=>{localStorage.setItem("token",t);localStorage.setItem("user",JSON.stringify(u));},[token,user]);
  await p.goto(BASE+"/teacher/tasks",{waitUntil:"domcontentloaded"});
  await sleep(3500);

  // 老入口已隐藏
  log("老『对话管理』按钮已隐藏", (await p.locator("button:has-text('对话管理')").count()) === 0);
  // 名片式新建入口存在
  const newBtn = p.locator("button:has-text('新建对话')").first();
  log("『新建对话』按钮可见", (await newBtn.count()) > 0);

  // 新建
  await newBtn.click();
  await sleep(800);
  await p.locator("input[placeholder*='圆的认识探究对话']").fill("最终验证对话");
  await p.locator("textarea[placeholder*='希望学生达成的目标']").fill("目标");
  await p.locator("textarea[placeholder*='个人学情分析的提示词']").fill("x");
  await p.locator("textarea[placeholder*='全班学情分析的提示词']").fill("y");
  await p.locator("button:has-text('创建')").last().click({ force: true });
  await sleep(1800);
  log("新建后名片显示", (await p.locator("text=最终验证对话").count()) > 0);

  // 编辑
  await p.locator("button:has-text('编辑')").first().click();
  await sleep(800);
  await p.locator("input[placeholder*='圆的认识探究对话']").fill("最终验证对话-改");
  await p.locator("button:has-text('保存')").last().click({ force: true });
  await sleep(1500);
  log("编辑后名片更新", (await p.locator("text=最终验证对话-改").count()) > 0);

  // 删除
  await p.locator("button:has-text('删除')").first().click();
  await sleep(800);
  const confirmBtn = p.locator(".t-dialog__footer button:has-text('删除')").first();
  if (await confirmBtn.count() > 0) {
    await confirmBtn.click({ force: true });
    await sleep(1800);
  } else {
    log("删除确认弹窗出现", false);
  }
  log("删除后名片消失", (await p.locator("text=最终验证对话-改").count()) === 0);

  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  await b.close();
  if (failed > 0) process.exit(1);
})().catch(e=>{ console.error("❌ 异常:", e.message); process.exit(1); });
