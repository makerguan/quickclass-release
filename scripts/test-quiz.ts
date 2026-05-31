/**
 * 学生端作业功能测试 - 简化版
 * 直接打开学生聊天页并执行操作
 */
import playwright from 'playwright';

const BASE_URL = 'http://localhost:3000';

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== 学生端作业功能测试 ===\n');

  const browser = await playwright.chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on('console', msg => {
    console.log(`  [浏览器] ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log(`  [页面错误] ${err.message}`);
  });

  try {
    // Step 1: 登录
    console.log('[1] 正在登录 (POST API)...');
    const res = await fetch(`${BASE_URL}/api/auth/student-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '陈小明', inviteCode: '111111' }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error('  登录失败:', data);
      await browser.close();
      return;
    }
    console.log(`  登录成功: ${data.user.name} (${data.user.className})\n`);

    // Step 2: 打开学生聊天页面 - 使用 page.goto 而非 reload
    console.log('[2] 打开学生聊天页面...');
    await page.goto(`${BASE_URL}/student/chat`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);

    // 注入 token 和 user
    console.log('[3] 注入登录态...');
    await page.evaluate((payload) => {
      localStorage.setItem('token', payload.token);
      localStorage.setItem('user', JSON.stringify(payload.user));
    }, { token: data.token, user: data.user });
    await sleep(500);

    // 刷新页面让 fetchData 使用 localStorage 中的 token
    console.log('[4] 刷新页面加载数据...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    // 等待 React 渲染 + 网络请求
    await sleep(5000);

    // 截图
    await page.screenshot({ path: '/tmp/00-page-loaded.png', fullPage: false });
    console.log('   截图: /tmp/00-page-loaded.png');

    // Step 3: 检查页面是否渲染成功
    console.log('\n[5] 检查页面渲染...');
    const bodyText = await page.textContent('body') || '';
    const chatText = bodyText.substring(0, 300);
    console.log(`   Body 开头: ${chatText}\n`);

    // 检查 StudentLayout nav
    const navItems = page.locator('nav a, nav button');
    const navCount = await navItems.count();
    console.log(`   导航项: ${navCount} 个`);
    for (let i = 0; i < navCount; i++) {
      try {
        const text = await navItems.nth(i).textContent();
        console.log(`     [${i}] ${text?.trim().substring(0, 30)}`);
      } catch {}
    }

    // 检查侧边栏
    const sidebar = page.locator('.overflow-y-auto');
    const sidebarExists = await sidebar.count();
    console.log(`   侧边栏 (.overflow-y-auto): ${sidebarExists} 个`);

    if (sidebarExists > 0) {
      const sidebarItems = sidebar.locator('.cursor-pointer');
      const itemsCount = await sidebarItems.count();
      console.log(`   侧边栏项: ${itemsCount} 个`);

      for (let i = 0; i < itemsCount; i++) {
        try {
          const text = await sidebarItems.nth(i).textContent();
          console.log(`     [${i}] ${text?.trim().substring(0, 60)}`);
        } catch {}
      }
    }

    // Step 4: 用 DOM 方式查找并点击作业
    console.log('\n[6] 查找并点击作业...');
    const allText = await page.textContent('body') || '';
    console.log(`   页面所有文本 (前500字): ${allText.substring(0, 500)}\n`);

    // 查找解题技巧
    const quizLink = page.locator('div.cursor-pointer').filter({ hasText: /解题技巧/ });
    const quizCount = await quizLink.count();
    console.log(`   找到 "解题技巧" 链接: ${quizCount} 个`);

    if (quizCount > 0) {
      await quizLink.first().click();
      await sleep(3000);
      await page.screenshot({ path: '/tmp/01-quiz-clicked.png', fullPage: false });

      // 验证
      const afterText = await page.textContent('body') || '';
      console.log(`   点击后页面: ${afterText.substring(0, 500)}\n`);

      console.log('   ---- 检查作业内容 ----');
      console.log(`   "解题技巧": ${afterText.includes('解题技巧')}`);
      console.log(`   "一次函数": ${afterText.includes('一次函数')}`);

      // 检查选项
      for (const opt of ['A.', 'B.', 'C.', 'D.']) {
        const visible = await page.locator(`text=${opt}`).first().isVisible().catch(() => false);
        console.log(`   "${opt}" 可见: ${visible}`);
      }

      console.log(`   "提交作业": ${afterText.includes('提交作业')}`);
      console.log(`   "下一题": ${afterText.includes('下一题')}`);

      console.log('\n============================');
      if (afterText.includes('一次函数') || afterText.includes('提交作业')) {
        console.log('  ✅ 测试通过！作业题目正常显示！');
      } else {
        console.log('  ❌ 题目未显示');
      }
      console.log('============================');
    } else {
      console.log('   ❌ 未找到"解题技巧"');
      // 尝试用更通用的方式查找
      const allClickable = page.locator('div.cursor-pointer');
      const count = await allClickable.count();
      console.log(`   所有可点击 div: ${count}`);
      for (let i = 0; i < count; i++) {
        try {
          const t = await allClickable.nth(i).textContent();
          if (t) console.log(`     [${i}] ${t.trim().substring(0, 60)}`);
        } catch {}
      }
    }

    console.log('\n浏览器保持打开，按 Ctrl+C 退出');

  } catch (error) {
    console.error('测试出错:', error);
    await browser.close();
  }
}

main();