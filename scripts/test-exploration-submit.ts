/**
 * 交互探究提交采集（双轨方案）验证脚本
 * 运行：npx tsx scripts/test-exploration-submit.ts
 * 覆盖：方案《交互探究提交采集方案.md》第十节验收用例
 *  - 合并逻辑四组用例（A 只挂对象 / B 只调函数 / C 都做 / D 都没做）
 *  - 分数正则推测（含"取最后一次匹配"）
 *  - localStorage 白名单（token 不得泄露）
 *  - 行为流自动记录（auto:click / auto:fill）
 *  - 注入幂等性（二次注入不重复）
 *  - 裸调用检测（裸调用告警 / 防御式不告警 / 方法调用不告警）
 */
import vm from "node:vm";
import {
  basicTrackingScript,
  submitMessageScript,
  injectSubmitFunctionality,
} from "../src/lib/prompts/exploration-submit";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

// ---------- vm 环境构造（模拟 iframe 内浏览器全局） ----------
function createEnv(bodyText = "") {
  const listeners: Record<string, Function[]> = {};
  const postMessageCalls: any[] = [];
  const storage = new Map<string, string>([
    ["token", "secret-token-should-never-leak"],
    ["gameScore", "300"],
    ["level", "3"],
    ["theme", "dark"], // 不在白名单前缀内
  ]);
  const addListener = (type: string) => (fn: Function) => {
    (listeners[type] = listeners[type] || []).push(fn);
  };
  const sandbox: any = {
    document: {
      body: { innerText: bodyText },
      addEventListener: (t: string, f: Function) => addListener(t)(f),
      querySelectorAll: () => [] as any[],
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: () => "",
      }),
      getElementById: () => null,
    },
    localStorage: {
      get length() {
        return storage.size;
      },
      key: (i: number) => Array.from(storage.keys())[i] ?? null,
      getItem: (k: string) => storage.get(k) ?? null,
    },
    setInterval: () => 0,
    clearInterval: () => {},
    alert: () => {},
  };
  sandbox.addEventListener = (t: string, f: Function) => addListener(t)(f);
  sandbox.window = sandbox;
  sandbox.parent = { postMessage: (msg: any) => postMessageCalls.push(msg) };
  vm.createContext(sandbox);
  return { sandbox, listeners, postMessageCalls };
}

function runScripts(env: ReturnType<typeof createEnv>) {
  vm.runInContext(basicTrackingScript, env.sandbox);
  vm.runInContext(submitMessageScript, env.sandbox);
}

function submit(env: ReturnType<typeof createEnv>) {
  env.sandbox.submitResults();
  const last = env.postMessageCalls[env.postMessageCalls.length - 1];
  if (!last || last.type !== "EXPLORATION_SUBMIT") throw new Error("submitResults 未发出 EXPLORATION_SUBMIT 消息");
  return last.payload;
}

// ---------- 用例 A：只挂 __gameState__（契约轨主通道） ----------
console.log("\n[用例 A] 只挂 __gameState__ 对象，不调用任何注入函数");
{
  const env = createEnv("探究页面");
  runScripts(env);
  vm.runInContext(
    `window.__gameState__ = { score: 300, gameLevel: 3, maxScore: 400, completedSections: ["第一关", "第二关"] };`,
    env.sandbox
  );
  const p = submit(env);
  assert(p.score === 300, "score = 300（契约轨）");
  assert(p.gameLevel === 3, "gameLevel = 3（契约轨）");
  assert(p.maxScore === 400, "maxScore = 400（AI 设计满分优先）");
  assert(Array.isArray(p.completedSections) && p.completedSections.length === 2, "completedSections 透传");
  assert(p.scoreInferred === false, "非推测值");
  assert(p.gameState && p.gameState.score === 300, "gameState 明细随 payload 上报");
}

// ---------- 用例 B：只调注入函数（增强通道） ----------
console.log("\n[用例 B] 只调用注入函数 updateScore / setGameLevel / completeSection");
{
  const env = createEnv("探究页面");
  runScripts(env);
  env.sandbox.updateScore(300);
  env.sandbox.setGameLevel(3);
  env.sandbox.completeSection("第三关");
  const p = submit(env);
  assert(p.score === 300, "score = 300（函数调用轨）");
  assert(p.gameLevel === 3, "gameLevel = 3（函数调用轨）");
  assert(p.completedSections.includes("第三关"), "completeSection 记录在案");
}

// ---------- 用例 C：双轨都做（不翻倍、并集） ----------
console.log("\n[用例 C] 双轨都做：__gameState__ + 函数调用");
{
  const env = createEnv("探究页面");
  runScripts(env);
  vm.runInContext(
    `window.__gameState__ = { score: 300, gameLevel: 3, completedSections: ["第一关"] };`,
    env.sandbox
  );
  env.sandbox.updateScore(300);
  env.sandbox.completeSection("第二关");
  const p = submit(env);
  assert(p.score === 300, "score = 300（不翻倍）");
  assert(
    p.completedSections.length === 2 && p.completedSections.includes("第一关") && p.completedSections.includes("第二关"),
    "completedSections 取并集"
  );
}

// ---------- 用例 C2：反向覆盖防护（gameState 初始 0，函数轨有真实分） ----------
console.log("\n[用例 C2] gameState 挂了但 score=0，函数轨写入 300 → 不得被 0 覆盖");
{
  const env = createEnv("探究页面");
  runScripts(env);
  vm.runInContext(`window.__gameState__ = { score: 0, gameLevel: 1 };`, env.sandbox);
  env.sandbox.updateScore(300);
  env.sandbox.setGameLevel(3);
  const p = submit(env);
  assert(p.score === 300, "score = 300（函数轨兜底，未被 gameState 的 0 覆盖）");
  assert(p.gameLevel === 3, "gameLevel = 3（取较大值）");
}

// ---------- 用例 D：都没做 → 分数正则推测 ----------
console.log("\n[用例 D] 页面无任何上报，文本含「得分：280」「第 3 关」→ 正则推测");
{
  const env = createEnv("恭喜通关！\n你的得分：280\n当前第 3 关\n历史最高分：999");
  runScripts(env);
  const p = submit(env);
  assert(p.score === 280, "score = 280（正则推测）");
  assert(p.scoreInferred === true, "scoreInferred = true（标注推测值）");
  assert(p.gameLevel === 3, "gameLevel = 3（关卡正则）");
}

// ---------- 用例 D2：取最后一次匹配 ----------
console.log("\n[用例 D2] 文本含多次得分，取最后一次（游戏结束态）");
{
  const env = createEnv("初始得分：50\n中途得分：150\n最终得分：280");
  runScripts(env);
  const p = submit(env);
  assert(p.score === 280, "score = 280（最后一次匹配）");
}

// ---------- 用例 D3：完全无数据 ----------
console.log("\n[用例 D3] 纯展示页，无任何数据");
{
  const env = createEnv("欢迎来到探究页面");
  runScripts(env);
  const p = submit(env);
  assert(p.score === 0, "score = 0");
  assert(p.gameLevel === 1, "gameLevel = 1");
  assert(p.scoreInferred === false, "无推测");
}

// ---------- 用例 E：localStorage 白名单 ----------
console.log("\n[用例 E] localStorage 白名单快照（token 不得泄露）");
{
  const env = createEnv("探究页面");
  runScripts(env);
  const p = submit(env);
  assert(!("token" in p.storageSnapshot), "token 未被采集（安全红线）");
  assert(!("theme" in p.storageSnapshot), "非白名单前缀键（theme）未采集");
  assert(p.storageSnapshot.gameScore === "300", "gameScore 已采集");
  assert(p.storageSnapshot.level === "3", "level 已采集");
}

// ---------- 用例 F：行为流自动记录 ----------
console.log("\n[用例 F] 行为流自动记录（auto:click / auto:fill）");
{
  const env = createEnv("探究页面");
  runScripts(env);
  // 触发 click（basicTracking 的 interactions++ 与行为流 hook 都会收到）
  env.listeners.click.forEach((fn) =>
    fn({ target: { getAttribute: () => null, textContent: "提交答案按钮", tagName: "BUTTON" } })
  );
  env.listeners.input.forEach((fn) =>
    fn({ target: { tagName: "INPUT", getAttribute: () => null, textContent: "", value: "张三" } })
  );
  const p = submit(env);
  const autoLogs = (p.actionLog || []).filter((l: any) => String(l.type).startsWith("auto:"));
  assert(autoLogs.length === 2, "自动记录 2 条（click + fill）");
  assert(autoLogs[0] && autoLogs[0].type === "auto:click", "auto:click 类型正确");
  assert(autoLogs[0] && autoLogs[0].target === "提交答案按钮", "click 目标描述正确");
  assert(autoLogs[1] && autoLogs[1].value === "张三", "fill 记录了输入值");
  assert(p.interactions >= 1, "interactions 计数正常（不因行为流翻倍）");
}

// ---------- 用例 G：注入幂等性 ----------
console.log("\n[用例 G] 注入幂等性（二次注入不重复）");
{
  const ctx = { explorationId: "e1", taskTitle: "任务", studentName: "学生", className: "班级" };
  const html = "<html><body><div>探究内容</div></body></html>";
  const r1 = injectSubmitFunctionality(html, ctx);
  const r2 = injectSubmitFunctionality(r1.html, ctx);
  const count = (s: string, sub: string) => s.split(sub).length - 1;
  assert(count(r2.html, 'id="quickclass-submit-root"') === 1, "提交按钮唯一");
  assert(count(r2.html, "function submitResults") === 1, "submitResults 定义唯一");
  assert(count(r2.html, "window.__explorationData__ =") === 1, "追踪初始化唯一");
  assert(count(r2.html, "qfCollectAnswers") >= 1, "QuickForm 块剥离重注（幂等）");
  assert(r2.html.includes("</html>"), "HTML 结构完整");
}

// ---------- 用例 H：裸调用检测 ----------
console.log("\n[用例 H] 裸调用检测（告警 / 防御式不告警 / 方法调用不告警）");
{
  const ctx = { explorationId: "e1", taskTitle: "任务", studentName: "学生", className: "班级" };
  const base = (script: string) =>
    `<html><body><script>${script}</script></body></html>`;

  const r1 = injectSubmitFunctionality(base("var s = 0; function win() { s += 100; updateScore(s); }"), ctx);
  assert(r1.warnings.some((w) => w.includes("裸调用")), "裸调用 → 告警");

  const r2 = injectSubmitFunctionality(
    base('if (typeof updateScore === "function") updateScore(100);'),
    ctx
  );
  assert(!r2.warnings.some((w) => w.includes("裸调用")), "typeof 防御式 → 不告警");

  const r3 = injectSubmitFunctionality(base("obj.updateScore(100);"), ctx);
  assert(!r3.warnings.some((w) => w.includes("裸调用")), "方法调用 obj.updateScore → 不告警");

  const r4 = injectSubmitFunctionality(base("function updateScore(x) { return x; } updateScore(1);"), ctx);
  assert(!r4.warnings.some((w) => w.includes("裸调用")), "页面自定义同名函数 → 不告警（走 _INJ 后缀机制）");
}

// ---------- 汇总 ----------
console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
if (failed > 0) {
  process.exit(1);
}
