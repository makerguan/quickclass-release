/**
 * 学生端浏览器模拟脚本
 * 使用 Playwright 模拟学生登录、参加对话和作业
 * 
 * 运行方式：
 * echo "1" | npx ts-node --esm scripts/simulate-student.ts
 */

import playwright from 'playwright';

const BASE_URL = 'http://localhost:3000';

// 学生账号列表（从数据库读取）
const STUDENTS = [
  { name: '张小明', classInviteCode: 'MATH2026' },
  { name: '李小红', classInviteCode: 'MATH2026' },
  { name: '陈小明', classInviteCode: '111111' },
];

// 对话活动列表
const CONVERSATIONS = ['找等量关系', '移项法则', '什么是方程？'];

// 学生发送的消息示例
const MESSAGES = [
  '你好，我想学习这个话题',
  '能给我举个例子吗？',
  '请问这道题怎么做？',
  '明白了，谢谢老师！',
];

// 等待页面加载
async function waitForPageLoad(page: playwright.Page, timeout = 30000) {
  await page.waitForLoadState('networkidle', { timeout });
}

// 学生登录
async function studentLogin(page: playwright.Page, name: string, inviteCode: string): Promise<boolean> {
  try {
    console.log(`\n[${name}] 正在登录...`);
    await page.goto(`${BASE_URL}/student`);
    await waitForPageLoad(page);

    // 输入姓名
    await page.fill('input[placeholder="姓名"]', name);
    await page.waitForTimeout(300);

    // 输入邀请码
    await page.fill('input[placeholder="班级邀请码"]', inviteCode);
    await page.waitForTimeout(300);

    // 点击进入学习按钮
    await page.click('button:has-text("进入学习")');
    await page.waitForTimeout(3000);

    // 检查是否登录成功
    const url = page.url();
    if (url.includes('/student/chat')) {
      console.log(`[${name}] 登录成功！`);
      return true;
    }
    console.log(`[${name}] 登录失败，当前URL: ${url}`);
    return false;
  } catch (error) {
    console.error(`[${name}] 登录异常:`, error);
    return false;
  }
}

// 等待对话加载
async function waitForChat(page: playwright.Page) {
  // 等待输入框出现
  try {
    await page.waitForSelector('textarea', { timeout: 10000 });
    await page.waitForTimeout(500);
  } catch {
    console.log('  等待聊天框超时');
  }
}

// 发送消息
async function sendMessage(page: playwright.Page, message: string): Promise<boolean> {
  try {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 3000 })) {
      await textarea.fill(message);
      await page.waitForTimeout(300);
      
      // 发送按钮
      const sendButton = page.locator('button[type="submit"]').first();
      if (await sendButton.isVisible()) {
        await sendButton.click();
        console.log(`  发送: "${message.substring(0, 15)}...`);
        // 等待AI回复
        await page.waitForTimeout(4000);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// 进入对话
async function enterConversation(page: playwright.Page, convName: string): Promise<boolean> {
  try {
    console.log(`  正在进入: ${convName}...`);
    const convElement = page.locator(`text="${convName}"]`).first();
    if (await convElement.isVisible({ timeout: 5000 })) {
      await convElement.click();
      await page.waitForTimeout(2000);
      await waitForChat(page);
      console.log(`  已进入: ${convName}`);
      return true;
    }
    console.log(`  未找到对话: ${convName}`);
    return false;
  } catch {
    console.log(`  进入对话失败: ${convName}`);
    return false;
  }
}

// 查找并点击任务
async function expandTask(page: playwright.Page, taskName: string): Promise<boolean> {
  try {
    const taskElement = page.locator(`text=${taskName}`).first();
    if (await taskElement.isVisible({ timeout: 5000 })) {
      await taskElement.click();
      await page.waitForTimeout(1000);
      console.log(`  已展开任务: ${taskName}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// 主函数
async function main() {
  // 检查服务是否运行
  try {
    const response = await fetch(BASE_URL);
    if (!response.ok) throw new Error('服务未启动');
  } catch {
    console.error('错误: QuickClass 服务未启动，请先运行 npm start');
    process.exit(1);
  }

  console.log('===========================================');
  console.log('  学生端浏览器模拟测试');
  console.log('===========================================');
  console.log(`\n目标服务器: ${BASE_URL}`);

  // 显示可选学生
  console.log('\n可选学生账号:');
  STUDENTS.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name} (邀请码: ${s.classInviteCode})`);
  });

  const readline = await import('readline');
  function ask(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  const studentIndex = parseInt(await ask('\n请选择学生编号 (1-3): ')) - 1;
  if (studentIndex < 0 || studentIndex >= STUDENTS.length) {
    console.log('无效的选择');
    process.exit(1);
  }
  const selectedStudent = STUDENTS[studentIndex];

  const browser = await playwright.chromium.launch({ headless: false }); // 显示浏览器
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. 登录
    const loggedIn = await studentLogin(page, selectedStudent.name, selectedStudent.classInviteCode);
    if (!loggedIn) throw new Error('登录失败');

    // 2. 进入对话学习页面
    console.log('\n正在进入对话学习页面...');
    await page.goto(`${BASE_URL}/student/chat`);
    await waitForPageLoad(page);
    await page.waitForTimeout(2000);

    // 3. 展开任务
    console.log('\n正在查找任务...');
    await expandTask(page, '一元一次方程');

    // 4. 参加对话
    console.log('\n正在查找对话活动...');
    for (const conv of CONVERSATIONS) {
      const entered = await enterConversation(page, conv);
      if (entered) {
        // 发送消息
        console.log('\n  正在发送消息...');
        for (const msg of MESSAGES) {
          await sendMessage(page, msg);
        }
        break; // 只参加第一个对话
      }
    }

    // 5. 完成作业（如果有）
    console.log('\n正在检查作业...');
    await page.goto(`${BASE_URL}/student/exercise`);
    await waitForPageLoad(page);
    await page.waitForTimeout(1000);
    console.log('  已进入作业页面');

    console.log('\n===========================================');
    console.log('  模拟测试完成！');
    console.log('===========================================');
    console.log('\n提示: 浏览器保持打开，可继续手动操作测试');

  } catch (error) {
    console.error('测试过程出错:', error);
  }
}

main();
