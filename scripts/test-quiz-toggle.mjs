import { chromium } from "playwright";
const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 登录
  await page.goto(`${BASE}/login`);
  await page.locator('input').first().fill("13338183337");
  await page.locator('input[type="password"]').fill("123456");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/teacher/**", { timeout: 10000 });
  await page.goto(`${BASE}/teacher/tasks`);
  await page.waitForTimeout(3000);

  // 展开圆的认识课堂
  const circle = page.locator("text=圆的认识").first();
  if (await circle.count()) await circle.click();
  await page.waitForTimeout(1500);

  // 找到课堂作业区域的 Switch
  const switches = page.locator(".t-switch");
  const switchCount = await switches.count();
  console.log(`找到 ${switchCount} 个 Switch`);

  // 找到第一个 Switch 所在的作业卡片
  const firstSwitch = switches.first();
  if (await firstSwitch.count()) {
    // 点之前看状态
    const card = firstSwitch.locator("xpath=ancestor::div[contains(@class,'bg-white rounded-lg p-3')]");
    const title = await card?.locator("span").first().textContent().catch(() => "");
    console.log(`\n作业卡片标题: "${title}"`);
    
    const isChecked = await firstSwitch.isChecked();
    console.log(`Switch 状态: ${isChecked ? "ACTIVE(开)" : "INACTIVE(关)"}`);

    // 点击切换
    console.log("点击 Switch...");
    await firstSwitch.click();
    await page.waitForTimeout(2000);

    // 看结果
    const afterChecked = await firstSwitch.isChecked();
    console.log(`点击后 Switch 状态: ${afterChecked ? "ACTIVE(开)" : "INACTIVE(关)"}`);

    // 检查列表是否为空
    const emptyText = page.locator("text=暂无作业，点击「新建作业」创建");
    console.log(`是否显示"暂无作业": ${await emptyText.count() > 0}`);

    // 截图
    await page.screenshot({ path: "/tmp/quiz-toggle.png", fullPage: true });
    console.log("截图已保存到 /tmp/quiz-toggle.png");
  }

  // 保持打开看效果
  console.log("\n浏览器保持打开 10 秒，可手动查看...");
  await page.waitForTimeout(10000);
  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
