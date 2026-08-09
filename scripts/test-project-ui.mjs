import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function login(page, phone, password) {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(500);
  await page.locator('input').first().fill(phone);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: "登录" }).click().catch(() => {});
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await login(page, "13338183337", "123456");
  await page.goto(`${BASE}/teacher/tasks`);
  await page.waitForTimeout(2500);

  const newBtn = page.getByRole("button", { name: "新建项目" });
  console.log("教师端「新建项目」按钮:", (await newBtn.count()) > 0 ? "存在" : "缺失");
  if (await newBtn.count()) {
    await newBtn.first().click();
    await page.waitForTimeout(600);
    console.log("弹窗标题含「新建项目」:", (await page.getByText("新建项目", { exact: false }).count()) > 0);
    await page.keyboard.press("Escape");
  }

  // 找一个已有项目（若该课堂已布置），点击浏览是否在当前页面内切换为浏览视图（URL 不变、非独立页面、非弹窗）
  await page.waitForTimeout(500);
  const browseBtn = page.getByRole("button", { name: "浏览" });
  console.log("存在「浏览」按钮:", (await browseBtn.count()) > 0);
  if (await browseBtn.count()) {
    await browseBtn.first().click();
    await page.waitForTimeout(1200);
    console.log("浏览后 URL 仍在本页（非独立页面）:", page.url().includes("/teacher/tasks") && !page.url().includes("/project/"));
    console.log("视图出现「返回」按钮:", (await page.getByRole("button", { name: "返回" }).count()) > 0);
    console.log("视图出现「已提交」统计:", (await page.getByText("已提交", { exact: false }).count()) > 0);
    // 点击返回，回到列表
    const backBtn = page.getByRole("button", { name: "返回" });
    if (await backBtn.count()) {
      await backBtn.first().click();
      await page.waitForTimeout(600);
      console.log("点击返回后回到列表（无浏览视图）:", (await page.getByText("已提交", { exact: false }).count()) === 0);
    }
  }

  // 测试课堂分析视图切换（Tooltip 内的分析按钮，点击后 iframe 视图出现 ← 返回）
  const chartBtns = page.locator('button .t-icon-chart-bar');
  if (await chartBtns.count() > 0) {
    await chartBtns.first().click();
    await page.waitForTimeout(1500);
    console.log("课堂分析视图出现「← 返回」:", (await page.getByRole("button", { name: "← 返回" }).count()) > 0);
    await page.getByRole("button", { name: "← 返回" }).first().click();
    await page.waitForTimeout(600);
    console.log("返回后回到列表:", (await page.getByRole("button", { name: "← 返回" }).count()) === 0);
  } else {
    console.log("未找到 ChartBar 图标按钮（课堂无分析入口）");
  }

  console.log("页面运行时错误:", pageErrors.length ? pageErrors : "无");
  await browser.close();
  console.log("UI 测试完成");
}

main().catch((e) => {
  console.error("UI 测试异常:", e.message);
  process.exit(1);
});
