// 多轮对话生成 HTML 端到端测试
// 验证：第一轮生成完整 HTML；第二轮基于 v0 增量修改（标题改了、正文保留，而非重写）
const BASE = "http://localhost:3000";

async function login() {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "13338183337", password: "123456" }),
  });
  const data = await res.json();
  if (!data.token) throw new Error("登录失败: " + JSON.stringify(data));
  return data.token;
}

// 流式读取 generate 接口（text/plain chunked）
async function generate(token, body) {
  const res = await fetch(BASE + "/api/exploration-activities/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("generate 失败 " + res.status + ": " + err);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

// 提取纯文本（去掉 script/style/tag）
function textContent(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

// 正文重叠率：v0 的 4 字中文片段在 v1 中的命中比例（>50% 视为增量修改，<30% 视为重写）
function overlapRate(v0, v1) {
  const t0 = textContent(v0);
  const t1 = textContent(v1);
  const frags = new Set();
  for (let i = 0; i + 4 <= t0.length; i++) {
    const seg = t0.slice(i, i + 4);
    if (/^[\u4e00-\u9fa5]{4}$/.test(seg)) frags.add(seg);
  }
  if (frags.size === 0) return null;
  let hit = 0;
  for (const f of frags) if (t1.includes(f)) hit++;
  return ((hit / frags.size) * 100).toFixed(1);
}

async function main() {
  const token = await login();

  const tasksRes = await fetch(BASE + "/api/tasks", { headers: { Authorization: "Bearer " + token } });
  if (!tasksRes.ok) throw new Error("获取课堂失败 " + tasksRes.status);
  const tasks = await tasksRes.json();
  const subProjectId = tasks[0]?.subProjects?.[0]?.id;
  if (!subProjectId) throw new Error("无可用课堂（subProject）");

  console.log("课堂:", tasks[0].title, "| subProjectId:", subProjectId);

  // 第一轮：生成完整 HTML
  console.log("\n=== 第一轮生成（完整 HTML）===");
  const t0 = Date.now();
  const v0 = await generate(token, {
    subProjectId,
    initialPrompt: "做一个探索三角形内角和为180度的互动网页",
    currentHtml: "",
    instruction: "做一个探索三角形内角和为180度的互动网页",
  });
  console.log("耗时:", ((Date.now() - t0) / 1000).toFixed(1) + "s | 长度:", v0.length, "字符");
  console.log("v0 完整 HTML:", /<!DOCTYPE html>/i.test(v0) && /<script/i.test(v0));

  // 第二轮：基于 v0 改标题
  console.log("\n=== 第二轮（改标题）===");
  const t1 = Date.now();
  const v1 = await generate(token, {
    subProjectId,
    initialPrompt: "做一个探索三角形内角和为180度的互动网页",
    currentHtml: v0,
    instruction: "把页面标题改成《三角形内角和探索》，其他保持不变",
  });
  console.log("耗时:", ((Date.now() - t1) / 1000).toFixed(1) + "s | 长度:", v1.length, "字符");

  const hasNewTitle = v1.includes("三角形内角和探索");
  const lenDiff = Math.abs(v1.length - v0.length);
  const overlap = overlapRate(v0, v1);

  console.log("\n=== 验证结果 ===");
  console.log("v1 完整 HTML:", /<!DOCTYPE html>/i.test(v1) && /<script/i.test(v1));
  console.log("v1 包含新标题:", hasNewTitle);
  console.log("v0/v1 长度差异:", lenDiff, "字符 (", (lenDiff / Math.max(v0.length, 1) * 100).toFixed(1) + "% )");
  console.log("正文重叠率:", overlap === null ? "（无可判定中文文案）" : overlap + "%");

  const pass = hasNewTitle && overlap !== null && Number(overlap) >= 50;
  console.log("\n结论:", pass ? "✅ 第二轮是「增量修改」而非「重写」" : "⚠️ 需人工复核：可能发生了重写");
  if (!pass) {
    console.log("\n--- v0 首 300 字 ---\n" + v0.slice(0, 300));
    console.log("\n--- v1 首 300 字 ---\n" + v1.slice(0, 300));
  }
}

main().catch((e) => {
  console.error("测试失败:", e.message);
  process.exit(1);
});
