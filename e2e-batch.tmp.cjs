// e2e：前端「一键分析全部」批量行为测试（对话维度，5 个学生）
// 断言：进度显示、批量中点单独分析弹 warning、防重复触发、完成后统一刷新+成功提示
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const TASK_ID = "cmr77j8wd0004igburgzk6r9t";
const PC_ID = "cmsigamxs000x17a76p8hc3co";
const URL = `${BASE}/teacher/tasks/${TASK_ID}/insights?pc=${PC_ID}`;
const RESULTS = [];
const check = (name, pass, detail) => {
  RESULTS.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. 登录
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("手机号").fill("13338183337");
  await page.getByPlaceholder("密码").fill("123456");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/teacher/, { timeout: 15000 }).catch(() => {});
  const token = await page.evaluate(() => localStorage.getItem("token"));
  check("登录成功获取token", !!token, token ? "" : "localStorage 无 token");

  // 记录批量前该 PC 下学生洞察总数（API）
  const before = await page.evaluate(async ({ pc, classId, token }) => {
    const r = await fetch(`/api/preset-conversations/${pc}/insights?classId=${classId}`, { headers: { Authorization: `Bearer ${token}` } });
    return (await r.json());
  }, { pc: PC_ID, classId: "cmr77iixm0002igbunngd5lzt", token });
  const beforeCount = before.studentInsights.length;
  console.log(`批量前 studentInsights=${beforeCount}, 可分析学生=${before.students.filter(s => s.convCount > 0).length}`);

  // 2. 进入对话维度分析页
  await page.goto(URL);
  const batchBtn = page.locator("button", { hasText: "一键分析全部" }).first();
  await batchBtn.waitFor({ state: "visible", timeout: 20000 });
  check("页面加载出「一键分析全部」按钮", true);

  // 3. 点击批量分析 → 按钮变为进度
  await batchBtn.click();
  const progText = await page.locator("button", { hasText: "分析中" }).first().textContent({ timeout: 8000 }).catch(() => null);
  check("批量启动，按钮显示「分析中 0/5」", progText && /分析中\s*0\/5/.test(progText), `实际: "${(progText || "").trim()}"`);

  // 4. 批量进行中：点某个学生的单独「分析」按钮 → 应出现 warning
  try {
    const analyzeBtn = page.locator("button", { hasText: "分析", exact: true }).first();
    await analyzeBtn.click({ timeout: 3000 });
    const warn = await page.locator(".t-message", { hasText: "批量分析进行中" }).first().textContent({ timeout: 3000 }).catch(() => null);
    check("批量中点单独分析 → warning 提示", !!warn, warn ? warn.trim() : "未捕获提示（可能按钮结构不同）");
  } catch (e) {
    check("批量中点单独分析 → warning 提示", false, "未找到单独分析按钮: " + e.message.split("\n")[0]);
  }

  // 5. 防重复触发：进度 >=1 后再点一次批量按钮，进度不应重置为 0
  try {
    await page.locator("button", { hasText: "分析中" }).first().waitForFunction(
      (el) => /分析中\s*[1-5]\/5/.test(el.textContent || ""), null, { timeout: 240000 }
    );
    const reached = await page.locator("button", { hasText: "分析中" }).first().textContent();
    // 再次点击批量按钮（同一按钮文案已变为进度）
    await page.locator("button", { hasText: "分析中" }).first().click();
    await page.waitForTimeout(1500);
    const after2 = await page.locator("button", { hasText: "分析中" }).first().textContent().catch(() => null);
    check("防重复触发（进度不重置为0）", after2 && !/分析中\s*0\/5/.test(after2), `进度: "${(reached || "").trim()}" → "${(after2 || "").trim()}"`);
  } catch (e) {
    check("防重复触发（进度不重置为0）", false, e.message.split("\n")[0]);
  }

  // 6. 等待批量完成：按钮变回「一键分析全部」+ 成功提示
  const t0 = Date.now();
  try {
    await page.locator("button", { hasText: "分析中" }).first().waitFor({ state: "hidden", timeout: 480000 });
    const success = await page.locator(".t-message", { hasText: "已完成" }).first().textContent({ timeout: 5000 }).catch(() => null);
    check("批量完成 → 按钮复原", true, `耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    check("批量完成 → 成功提示「已完成 5 名学生的分析」", !!success && /已完成\s*5\s*名/.test(success), `实际: "${(success || "").trim()}"`);
  } catch (e) {
    check("批量完成 → 按钮复原", false, e.message.split("\n")[0]);
  }

  // 7. 统一刷新断言：API 里学生洞察数应为 beforeCount + 5
  await page.waitForTimeout(2000);
  const after = await page.evaluate(async ({ pc, classId, token }) => {
    const r = await fetch(`/api/preset-conversations/${pc}/insights?classId=${classId}`, { headers: { Authorization: `Bearer ${token}` } });
    return (await r.json());
  }, { pc: PC_ID, classId: "cmr77iixm0002igbunngd5lzt", token });
  check("完成后统一刷新（洞察 +5）", after.studentInsights.length === beforeCount + 5, `before=${beforeCount} after=${after.studentInsights.length}`);

  await page.screenshot({ path: "/tmp/e2e-batch-final.png", fullPage: false });
  await browser.close();

  const pass = RESULTS.filter(r => r.pass).length;
  console.log(`\n===== e2e 结果：${pass}/${RESULTS.length} PASS =====`);
  process.exit(pass === RESULTS.length ? 0 : 1);
})().catch(e => { console.error("E2E ERR:", e.message); process.exit(1); });
