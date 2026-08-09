// 验证：新建对话弹窗三项均支持模板填充 + 可编辑
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
let passed = 0, failed = 0;
function log(desc, ok, detail = "") {
  if (ok) { console.log(`  ✅ ${desc}`); passed++; }
  else { console.log(`  ❌ ${desc}${detail ? " — " + detail : ""}`); failed++; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("=== 验证：对话活动弹窗模板填充 ===\n");
  const loginRes = await fetch(`${BASE}/api/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ phone:"13338183337", password:"123456" }) });
  const { token, user } = await loginRes.json();
  const b = await chromium.launch({ headless:true });
  const p = await b.newPage();
  p.on("pageerror", e=>console.log("  [PAGEERROR]", e.message));
  await p.goto(BASE+"/login",{waitUntil:"domcontentloaded"});
  await p.evaluate(([t,u])=>{localStorage.setItem("token",t);localStorage.setItem("user",JSON.stringify(u));},[token,user]);
  await p.goto(BASE+"/teacher/tasks",{waitUntil:"domcontentloaded"});
  await sleep(3500);

  const newBtn = p.locator("button:has-text('新建对话')").first();
  log("『新建对话』按钮可见", (await newBtn.count()) > 0);
  await newBtn.click();
  await sleep(900);

  // 三个模板下拉占位文案
  const phs = ["选择对话设计模板填充...", "选择个人学情模板填充...", "选择全班学情模板填充..."];
  for (const ph of phs) {
    log(`模板下拉存在: ${ph}`, (await p.locator(`input[placeholder='${ph}']`).count()) > 0);
  }

  // 选对话设计模板 → systemPrompt 文本域被填充
  await p.locator("input[placeholder='选择对话设计模板填充...']").click();
  await sleep(400);
  const dd1 = p.locator(".t-select__dropdown").filter({ hasText: /公共/ }).last();
  const opts1 = dd1.locator("div,li").filter({ hasText: /^公共_默认_对话设计模板$/ });
  const opt1Count = await opts1.count();
  log("对话设计模板有选项", opt1Count > 0, `选项数=${opt1Count}`);
  if (opt1Count > 0) { await opts1.nth(0).click(); await sleep(500); }
  const sysVal = await p.locator("textarea[placeholder*='手动修改']").inputValue();
  log("选模板后对话设计提示词被填充", sysVal.trim().length > 0, `长度=${sysVal.length}`);

  // 选个人学情模板 → analysisPrompt 填充
  await p.locator("input[placeholder='选择个人学情模板填充...']").click();
  await sleep(400);
  const dd2 = p.locator(".t-select__dropdown").last();
  const opts2 = dd2.locator("div,li").filter({ hasText: /^(?!选择).*个人/ });
  const opt2Count = await opts2.count();
  log("个人学情模板有选项", opt2Count > 0, `选项数=${opt2Count}`);
  if (opt2Count > 0) { await opts2.nth(0).click(); await sleep(500); }
  const anaVal = await p.locator("textarea[placeholder*='个人学情分析的提示词']").inputValue();
  log("选模板后个人学情提示词被填充", anaVal.trim().length > 0, `长度=${anaVal.length}`);

  // 选全班学情模板 → classAnalysisPrompt 填充
  await p.locator("input[placeholder='选择全班学情模板填充...']").click();
  await sleep(400);
  const dd3 = p.locator(".t-select__dropdown").last();
  const opts3 = dd3.locator("div,li").filter({ hasText: /^(?!选择).*全班/ });
  const opt3Count = await opts3.count();
  log("全班学情模板有选项", opt3Count > 0, `选项数=${opt3Count}`);
  if (opt3Count > 0) { await opts3.nth(0).click(); await sleep(500); }
  const clsVal = await p.locator("textarea[placeholder*='全班学情分析的提示词']").inputValue();
  log("选模板后全班学情提示词被填充", clsVal.trim().length > 0, `长度=${clsVal.length}`);

  // 可编辑：手动在系统提示词追加标记
  const sysTa = p.locator("textarea[placeholder*='手动修改']");
  await sysTa.fill(sysVal + "\n# 手动追加标记");
  await sleep(300);
  const edited = await sysTa.inputValue();
  log("文本域可手动编辑", edited.includes("# 手动追加标记"));

  // 关闭弹窗
  await p.locator("button:has-text('取消')").last().click();
  await sleep(500);

  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  await b.close();
  if (failed > 0) process.exit(1);
})().catch(e=>{ console.error("❌ 异常:", e.message); process.exit(1); });
