// 端到端测试：用新提示词跑一次 LLM，看输出字数
import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// 编译后的 streamProposalGeneration
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";

// 先尝试编译，失败也继续（_compiled2 里可能有上次成功的产物）
try {
  mkdirSync("/Users/guan/data/quickchat/scripts/_compiled2", { recursive: true });
  execSync(
    "node /Users/guan/data/quickchat/node_modules/typescript/bin/tsc " +
    "--target ES2020 --module commonjs --moduleResolution node " +
    "--esModuleInterop --skipLibCheck --noEmitOnError false " +
    "--outDir /Users/guan/data/quickchat/scripts/_compiled2 " +
    "/Users/guan/data/quickchat/src/lib/research/document-generator.ts",
    { stdio: "pipe" }
  );
} catch (e) {
  console.log("[note] 编译有错误但继续，使用已存在的产物");
}

const { streamProposalGeneration } = require("/Users/guan/data/quickchat/scripts/_compiled2/document-generator.js");

const p = new PrismaClient();
const prj = await p.researchProject.findUnique({ where: { id: "cmrd6av42000vly4etrdbpxgk" } });
const content = JSON.parse(prj.content);
const data = content.sections[0]?.content?.slice(0, 100) || "数据示例"; // 占位
const title = prj.selectedTitle;

console.log("=== 调用 LLM 生成 ===");
console.log("标题:", title);
console.log("模型: qwen3.6-35b-a3b");
console.log("新提示词要求: 8500-10000 中文字");
console.log("开始时间:", new Date().toISOString());

const start = Date.now();
let fullText = "";
let chunkCount = 0;
try {
  const gen = streamProposalGeneration(title, {
    quizData: null,
    conversationData: null,
    quizReports: [],
    conversationReports: [],
    dataQuality: { warnings: [] },
  });
  let result = await gen.next();
  while (!result.done) {
    fullText += result.value;
    chunkCount++;
    if (chunkCount % 100 === 0) process.stdout.write(`.`);
    result = await gen.next();
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const chinese = fullText.match(/[\u4e00-\u9fa5]/g) || [];
  const allChars = fullText.length;
  console.log(`\n\n=== 生成完成 (${elapsed}s, ${chunkCount} chunks) ===`);
  console.log("全文字符数（含标点英文）:", allChars);
  console.log("中文字数:", chinese.length);
  console.log("目标区间: 8500-10000 中文字");
  console.log("达成:", chinese.length >= 8500 ? "✅" : "❌ 偏少 " + (8500 - chinese.length) + " 字");

  // 按 [SECTION] 边界拆解
  const sections = fullText.split(/\[SECTION_START\]/);
  console.log("\n=== 各章节字数 ===");
  sections.slice(1).forEach((s, i) => {
    const end = s.indexOf("[SECTION_END]");
    const content = end > 0 ? s.slice(0, end) : s.slice(0, 200);
    const c = content.match(/[\u4e00-\u9fa5]/g) || [];
    const titleLine = content.split("\n").find(l => l.trim()) || `Section ${i}`;
    console.log(`  [${i}] ${titleLine.slice(0, 25).padEnd(25)} 中文字=${c.length}`);
  });
} catch (e) {
  console.error("生成失败:", e.message);
  process.exit(1);
}

await p.$disconnect();
