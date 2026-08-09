// 验证 AI 伴学修复的 API 测试
const BASE = "http://localhost:3000";

let passed = 0, failed = 0;
function log(desc, ok, detail = "") {
  if (ok) { console.log(`  ✅ ${desc}`); passed++; }
  else { console.log(`  ❌ ${desc}${detail ? " — " + detail : ""}`); failed++; }
}

const cleanHtml = "<!DOCTYPE html><html><head><title>测试</title></head><body><h1>Hello</h1></body></html>";

async function main() {
  console.log("=== AI 伴学修复 API 测试 ===\n");

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "13338183337", password: "123456" }),
  });
  if (!loginRes.ok) { console.error("登录失败"); process.exit(1); }
  const { token } = await loginRes.json();
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  console.log("  登录成功\n");

  const TITLE = "伴学修复测试-" + Date.now();
  const updateHtml = "<!DOCTYPE html><html><head><title>更新</title></head><body><h1>Updated</h1><p>这里有个 </head> 字面量在文本中</p></body></html>";

  // === 测试1: POST 新建 enableAiCompanion=true → 不持久化 ===
  console.log("─ 测试1: POST新建后 htmlContent 无注入标记 ─");
  const cRes = await fetch(`${BASE}/api/exploration-activities`, {
    method: "POST", headers: H,
    body: JSON.stringify({ subProjectId: "cms5xkah70002me8tgwtxh9oi", title: TITLE, htmlContent: cleanHtml, enableAiCompanion: true }),
  });
  const item = await cRes.json();
  if (!cRes.ok) { console.log("  POST 失败:", cRes.status); process.exit(1); }
  const expId = item.id;
  log("POST新建 htmlContent 无注入标记", !item.htmlContent?.includes("ai-companion-trigger") && !item.htmlContent?.includes("__AI_COMPANION_INJECTED__"));
  log("POST新建 enableAiCompanion=true", item.enableAiCompanion === true);

  // === 测试2: PUT enableAiCompanion=true → 不持久化 ===
  console.log("\n─ 测试2: PUT更新后 htmlContent 无注入标记 ─");
  const pRes = await fetch(`${BASE}/api/exploration-activities/${expId}`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ title: TITLE + "(更新)", htmlContent: updateHtml, enableAiCompanion: true }),
  });
  const pData = await pRes.json();
  log("PUT更新后 htmlContent 无注入标记", !pData.htmlContent?.includes("ai-companion-trigger") || false);
  log("PUT更新后 htmlContent 保持原稿", pData.htmlContent === updateHtml);

  // === 测试3: GET 预览自愈注入 ===
  console.log("\n─ 测试3: GET预览时 upgradeAiCompanionIfNeeded 触发注入 ─");
  const gRes = await fetch(`${BASE}/api/exploration-activities/${expId}`, { headers: H });
  const gData = await gRes.json();
  if (!gRes.ok) {
    console.log("  GET 状态:", gRes.status, "body:", JSON.stringify(gData));
    log("GET预览自愈注入", false, `HTTP ${gRes.status}: ${gData.error}`);
  } else {
    if (!gData.htmlContent) {
      console.log("  gData keys:", Object.keys(gData));
      log("GET预览自愈注入", false, "htmlContent 字段不存在, keys: " + Object.keys(gData).join(","));
    } else {
      const gInj = gData.htmlContent.includes("ai-companion-trigger") || gData.htmlContent.includes("__AI_COMPANION_INJECTED__");
      log("GET预览时 htmlContent 含伴学注入（内存自愈）", gInj, !gInj ? "自愈注入未触发!" : "");
    }
  }

  // 清理
  await fetch(`${BASE}/api/exploration-activities/${expId}`, { method: "DELETE", headers: H }).catch(() => {});

  console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
  if (failed > 0) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
