/**
 * 学生端作业测试 - CommonJS 快速版
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('=== 学生端作业测试 ===\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('pageerror', err => console.log(`[错误] ${err.message}`));

  try {
    // 1. 登录获取 token
    console.log('[1] 登录...');
    const res = await fetch(`${BASE_URL}/api/auth/student-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '陈小明', inviteCode: '111111' }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('登录失败'); await browser.close(); return; }
    console.log(`   ${data.user.name} (${data.user.className})\n`);

    // 2. 打开页面并注入 token
    console.log('[2] 打开聊天页面...');
    await page.goto(`${BASE_URL}/student/chat`);
    await page.waitForTimeout(1000);
    await page.evaluate(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, { token: data.token, user: data.user });

    // 3. 刷新加载数据
    console.log('[3] 刷新页面...');
    await page.reload();
    await page.waitForTimeout(5000);

    // 4. 截图
    await page.screenshot({ path: '/tmp/quiz-test.png' });
    console.log('   截图: /tmp/quiz-test.png\n');

    // 5. 检查页面内容
    const text = await page.textContent('body');
    console.log(`   页面文本: ${text?.substring(0, 300)}\n`);

    // 6. 查找作业
    const quizDivs = page.locator('div').filter({ hasText: /解题技巧/ });
    const n = await quizDivs.count();
    console.log(`   找到"解题技巧": ${n} 个`);

    if (n > 0) {
      await quizDivs.first().click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/quiz-after-click.png' });

      const after = await page.textContent('body');
      console.log(`\n   点击后: ${after?.substring(0, 300)}\n`);

      const hasFn = after?.includes('一次函数');
      const hasSub = after?.includes('提交作业');
      console.log(`   "一次函数": ${hasFn}`);
      console.log(`   "提交作业": ${hasSub}`);
      console.log('\n============================');
      console.log(hasFn || hasSub ? '  ✅ 测试通过！' : '  ❌ 题目未显示');
      console.log('============================');
    } else {
      console.log('   ❌ 未找到作业链接');
    }

    console.log('\n浏览器保持打开');
  } catch(e) {
    console.error('出错:', e.message);
  }
}

setTimeout(() => { console.log('超时'); process.exit(0); }, 60000);
main();
