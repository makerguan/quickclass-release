// 验证「AI 帮我写」优化语义：提示词编辑区已有用户输入时，只优化用户已有提示词，禁止新增用户未提出的内容
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

async function genPrompt(token, body) {
  const res = await fetch(BASE + "/api/exploration-activities/generate-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("generate-prompt 失败 " + res.status + ": " + (await res.text()));
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

// 一段较简略的已有提示词（用户自己写的，约 30 字）
const EXISTING_PROMPT = "做一个平行四边形面积探索的网页，让学生拖动顶点观察面积变化";

async function main() {
  const token = await login();
  const tasksRes = await fetch(BASE + "/api/tasks", { headers: { Authorization: "Bearer " + token } });
  const tasks = await tasksRes.json();
  const subProjectId = tasks[0]?.subProjects?.[0]?.id;
  if (!subProjectId) throw new Error("无可用课堂");
  console.log("subProjectId:", subProjectId);

  // ① 无已有提示词：从零设计
  console.log("\n=== ① 提示词编辑区为空（从零设计）===");
  const t0 = Date.now();
  const r0 = await genPrompt(token, { subProjectId, teacherIdea: "" });
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n${r0.slice(0, 350)}`);

  // ② 已有提示词：只优化已有提示词
  console.log("\n=== ② 提示词编辑区已有输入（只优化已有提示词）===");
  const t1 = Date.now();
  const r1 = await genPrompt(token, { subProjectId, teacherIdea: EXISTING_PROMPT });
  console.log(`耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s\n${r1.slice(0, 700)}`);

  const promptPart = r1.split(/提示词[：:]/)[1] || r1;
  // 优化语义判断：
  // 1) 保留核心意图（平行四边形 + 面积 + 拖动/顶点/观察）
  const keepCore = promptPart.includes("平行四边形") && promptPart.includes("面积");
  // 2) 未新增用户未提出的探究要素/结构（不出现从零设计模板的结构化标签），且未大幅膨胀
  const noNewStructure = !/【页面结构】|【可视化与交互机制】|【引导问题|引导性问题|探究一|探究二|探究三|【真实可操作】/.test(promptPart);
  const notOverExpanded = promptPart.length < 500;
  const isOptimize = keepCore && noNewStructure && notOverExpanded;

  console.log("\n=== 结论 ===");
  console.log("用户输入长度:", EXISTING_PROMPT.length, "字");
  console.log("② 输出提示词长度:", promptPart.length, "字");
  console.log("② 保留核心意图（平行四边形+面积）:", keepCore ? "✅" : "❌");
  console.log("② 未新增用户未提出的要素/结构:", noNewStructure ? "✅" : "❌");
  console.log("② 未大幅膨胀（<500字）:", notOverExpanded ? "✅" : "❌");
  console.log("② 整体「只优化、不扩充」语义:", isOptimize ? "✅" : "⚠️（需人工核对上文）");
}

main().catch((e) => {
  console.error("测试失败:", e.message);
  process.exit(1);
});
