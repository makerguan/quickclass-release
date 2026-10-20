// 教师端 4 套主题视觉验证：登录 → 逐个切换主题 → 截图 dashboard 与 tasks 页
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/tmp/theme-shots";
const THEMES = [
  { key: "default", label: "默认蓝" },
  { key: "green", label: "清新绿" },
  { key: "orange", label: "活力橙" },
  { key: "violet", label: "深邃紫" },
];

(async () => {
  const fs = await import("fs");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  // 登录教师账号（13338183337 / 123456）
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder*="手机号"], input[placeholder*="账号"]', "13338183337");
  await page.fill('input[type="password"]', "123456");
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForTimeout(3000);

  for (const t of THEMES) {
    await page.evaluate((key) => {
      localStorage.setItem("teacher-theme", key);
    }, t.key);
    await page.goto(`${BASE}/teacher/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/dashboard-${t.key}.png` });
    await page.goto(`${BASE}/teacher/tasks`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/tasks-${t.key}.png` });
    console.log(`已截图: ${t.label}`);
  }

  // 设置页主题卡片
  await page.goto(`${BASE}/teacher/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const themeCard = page.locator('text=界面主题').first();
  if (await themeCard.count()) {
    await themeCard.click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${OUT}/settings-theme.png` });
  console.log("已截图: 设置页主题卡片");

  console.log(errors.length ? `⚠️ 页面错误 ${errors.length} 条:\n${errors.slice(0, 5).join("\n")}` : "✅ 无页面错误");
  await browser.close();
})();
