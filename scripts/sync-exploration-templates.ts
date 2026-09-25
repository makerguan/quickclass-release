/**
 * 同步「交互探究分析」数据型/文本型模板到 DB（无评分探究适配版）
 * 用法: npx tsx scripts/sync-exploration-templates.ts
 *
 * 策略（保护教师自定义）：
 *   - 只更新「系统模板」：内容含 {explorationTitle} 占位符
 *   - 按内容特征区分：数据型（图表协议/<!DOCTYPE）→ 数据型.md；文本型（评分：★★★★★★）→ 文本型.md
 *   - 教师完全自定义（不含占位符）的模板不碰
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient({
  datasources: { db: { url: "file:" + path.join(process.cwd(), "prisma", "prisma", "dev.db") } },
});

async function main() {
  const dataMd = fs.readFileSync(path.join(process.cwd(), "模板/交互探究分析/数据型.md"), "utf-8").trim();
  const textMd = fs.readFileSync(path.join(process.cwd(), "模板/交互探究分析/文本型.md"), "utf-8").trim();

  const templates = await prisma.analysisTemplate.findMany({
    where: { type: "EXPLORATION_ANALYSIS" },
    select: { id: true, name: true, isDefault: true, teacherId: true, content: true },
  });

  console.log(`发现 ${templates.length} 个 EXPLORATION_ANALYSIS 模板：\n`);
  for (const t of templates) {
    const kind = t.content.includes("图表协议") || t.content.includes("<!DOCTYPE")
      ? "数据型(HTML)"
      : t.content.includes("评分：★★★★★★") ? "文本型" : "自定义/其他";
    console.log(`  - [${kind}] name=${t.name} | isDefault=${t.isDefault} | teacher=${t.teacherId ?? "公共"} | id=${t.id.slice(-6)}`);
  }
  console.log("");

  let updated = 0;
  for (const t of templates) {
    // 只更新系统模板：含 {explorationTitle} 占位符
    if (!t.content.includes("{explorationTitle}")) {
      console.log(`  ⚠️  跳过（非系统模板，保护自定义）：${t.name}`);
      continue;
    }
    const isData = t.content.includes("图表协议") || t.content.includes("<!DOCTYPE");
    const target = isData ? dataMd : textMd;
    if (t.content.trim() === target) {
      console.log(`  ⏭️  已同步：${t.name}`);
      continue;
    }
    await prisma.analysisTemplate.update({ where: { id: t.id }, data: { content: target } });
    console.log(`  ✅ 更新：${t.name} → ${isData ? "数据型" : "文本型"}`);
    updated++;
  }
  console.log(`\n完成：更新 ${updated} 个模板`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
