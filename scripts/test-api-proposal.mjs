// 端到端：数据库 → 走 docx-template-generator → 验证 docx XML
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { generateProposalDocxFromTemplate } = require("/Users/guan/data/quickchat/scripts/_compiled/docx-template-generator.js");

const p = new PrismaClient();
const prj = await p.researchProject.findUnique({ where: { id: "cmrd6av42000vly4etrdbpxgk" } });
if (!prj) { console.error("项目不存在"); process.exit(1); }

const content = JSON.parse(prj.content);
console.log("=== 数据库项目 ===");
console.log("标题:", prj.selectedTitle);
console.log("章节数:", content.sections.length);

content.sections.forEach((s, i) => {
  const firstLine = s.content.split("\n").find(l => l.trim()) || "";
  console.log(`  [${i}] ${s.title}  (${firstLine.slice(0, 50)}...)`);
});

console.log("\n=== 生成 docx ===");
const buffer = await generateProposalDocxFromTemplate(content);
writeFileSync("/tmp/test-real-proposal.docx", buffer);
console.log("docx 大小:", buffer.length, "bytes");

console.log("\n=== 验证 docx XML ===");
const xml = execSync("unzip -p /tmp/test-real-proposal.docx word/document.xml", { encoding: "utf8" });

const superscripts = xml.match(/vertAlign[^>]*superscript[^>]*\/?/g) || [];
console.log("superscript 标记数:", superscripts.length);

const stageCnt = (xml.match(/阶段成果/g) || []).length;
const finalCnt = (xml.match(/最终成果/g) || []).length;
console.log("'阶段成果' 出现次数:", stageCnt);
console.log("'最终成果' 出现次数:", finalCnt);

const keyResults = ["研究报告", "学术论文", "教学案例集", "智能体应用平台", "数据循证", "基于数据循证", "小学几何"];
console.log("\n=== 关键成果名称检查 ===");
for (const k of keyResults) {
  const cnt = (xml.match(new RegExp(k, "g")) || []).length;
  console.log(`  '${k}': ${cnt} 次`);
}

const fail = (msg) => { console.error("❌ FAIL:", msg); process.exit(1); };
const pass = (msg) => console.log("✅", msg);

if (superscripts.length < 3) fail(`期望至少 3 个 superscript，实际 ${superscripts.length}`);
if (stageCnt < 1) fail("未找到 '阶段成果' 表格标题");
if (finalCnt < 1) fail("未找到 '最终成果' 表格标题");

pass(`真实数据端到端：${superscripts.length} 个上标 + 阶段表(${stageCnt}) + 最终表(${finalCnt})`);
await p.$disconnect();
