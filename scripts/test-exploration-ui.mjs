// 互动探究弹窗前端冒烟测试（不调 AI）
// 验证：① 弹窗布局元素齐全 ② 源码手动编辑失焦后纳入版本栈，可撤销/重做
import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function login(page, phone, password) {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="手机号"]').fill(phone);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForTimeout(1500);
}

const HTML_V1 = `<!DOCTYPE html><html><head><title>测试A</title></head><body><h1>版本一</h1></body></html>`;
const HTML_V2 = `<!DOCTYPE html><html><head><title>测试B</title></head><body><h1>版本二</h1></body></html>`;

// TDesign Button：disabled 时渲染成 <div>，enabled 时是 <button>；统一用 .t-button 定位
const btnByText = (scope, text) => scope.locator(".t-button, button").filter({ hasText: new RegExp(`^${text}$`) });
const isDisabled = async (loc) => (await loc.getAttribute("disabled")) !== null;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await login(page, "13338183337", "123456");
  await page.goto(`${BASE}/teacher/tasks`);

  // 等「新建探究」按钮出现（首次加载会自动展开 ENABLED 课堂）
  const newBtn = page.getByRole("button", { name: "新建探究" }).first();
  await newBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  if ((await newBtn.count()) === 0) {
    console.log("❌ 未找到「新建探究」按钮（课堂未自动展开？）");
    console.log("运行时错误:", pageErrors.length ? pageErrors : "无");
    await browser.close();
    process.exit(1);
  }
  await newBtn.click();
  await page.waitForTimeout(800);

  const dialog = page.locator(".t-dialog").first();

  // ① 弹窗布局
  console.log("=== ① 弹窗布局 ===");
  console.log("弹窗标题「新建互动探究」:", (await page.getByText("新建互动探究", { exact: true }).count()) > 0);
  console.log("标题输入框:", (await dialog.locator('input[placeholder="探究标题"]').count()) > 0);
  console.log("对话输入框:", (await dialog.locator('textarea[placeholder*="描述你想要的互动网页"]').count()) > 0);
  console.log("「发送」按钮:", (await btnByText(dialog, "发送").count()) > 0);
  console.log("「AI 帮我写」按钮:", (await btnByText(dialog, "AI 帮我写").count()) > 0);
  console.log("「撤销」按钮:", (await btnByText(dialog, "撤销").count()) > 0);
  console.log("「重做」按钮:", (await btnByText(dialog, "重做").count()) > 0);
  console.log("「上传」按钮:", (await btnByText(dialog, "上传").count()) > 0);
  console.log("「导出」按钮:", (await btnByText(dialog, "导出").count()) > 0);
  console.log("「预览」tab:", (await btnByText(dialog, "预览").count()) > 0);
  console.log("「源码」tab:", (await btnByText(dialog, "源码").count()) > 0);

  // ② 源码 onBlur 纳入版本栈
  console.log("\n=== ② 源码编辑 → 版本栈 → 撤销/重做 ===");
  const undoBtn = btnByText(dialog, "撤销");
  const redoBtn = btnByText(dialog, "重做");

  await btnByText(dialog, "源码").click();
  await page.waitForTimeout(300);

  const codeArea = dialog.locator('textarea[placeholder*="HTML 源代码"]');
  console.log("源码编辑区出现:", (await codeArea.count()) > 0);

  // 编辑第 1 版 → 失焦
  await codeArea.fill(HTML_V1);
  await codeArea.blur();
  await page.waitForTimeout(400);
  console.log("第 1 版：记录消息出现:", (await page.getByText("已记录源码编辑", { exact: false }).count()) > 0);
  console.log("第 1 版：版本指示「第 1 版」:", (await page.getByText("第 1 版", { exact: true }).count()) > 0);
  console.log("第 1 版时「撤销」disabled:", await isDisabled(undoBtn));

  // 编辑第 2 版 → 失焦
  await codeArea.fill(HTML_V2);
  await codeArea.blur();
  await page.waitForTimeout(400);
  console.log("第 2 版：版本指示「第 2 版」:", (await page.getByText("第 2 版", { exact: true }).count()) > 0);
  console.log("第 2 版时「撤销」enabled:", !(await isDisabled(undoBtn)));

  // 撤销 → 回退第 1 版
  await undoBtn.click();
  await page.waitForTimeout(400);
  const afterUndoVal = await codeArea.inputValue();
  console.log("撤销后回退「第 1 版」:", (await page.getByText("第 1 版", { exact: true }).count()) > 0);
  console.log("撤销后源码值=版本一:", afterUndoVal.includes("版本一") && !afterUndoVal.includes("版本二"));

  // 重做 → 回到第 2 版
  await redoBtn.click();
  await page.waitForTimeout(400);
  const afterRedoVal = await codeArea.inputValue();
  console.log("重做后回到「第 2 版」:", (await page.getByText("第 2 版", { exact: true }).count()) > 0);
  console.log("重做后源码值=版本二:", afterRedoVal.includes("版本二"));

  console.log("\n页面运行时错误:", pageErrors.length ? pageErrors : "无");
  await browser.close();
  console.log("UI 冒烟测试完成");
}

main().catch((e) => {
  console.error("UI 测试异常:", e.message);
  process.exit(1);
});
