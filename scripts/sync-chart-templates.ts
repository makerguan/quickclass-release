/**
 * 同步 chart 协议版数据型模板到 DB（v2，覆盖全部 6 个数据型模板）
 * 用法: npx tsx scripts/sync-chart-templates.ts
 *
 * 匹配策略：按内容签名（数据段占位符组合）而非模板名——
 * 开发库存在重名/长短名变体，签名匹配对全部变体幂等生效。
 * 注意：默认模板整体替换；教师若在数据段做过定制会被覆盖（默认模板场景可接受）。
 */
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

const prisma = new PrismaClient({
  datasources: { db: { url: "file:" + path.join(process.cwd(), "prisma", "prisma", "dev.db") } },
});

// 每个变体的唯一签名：数据段占位符组合（互不重叠，可精确区分）
const VARIANTS: { file: string; sigs: string[]; label: string }[] = [
  {
    label: "全班学情·课堂",
    file: "模板/学生全班学情/公共_默认_全班学情分析模板_课堂_数据型.md",
    sigs: ["{classDialogAnalysisReport}"],
  },
  {
    label: "全班学情·对话活动",
    file: "模板/学生全班学情/公共_默认_全班学情分析模板_对话活动_数据型.md",
    sigs: ["{personalDialogAnalysisReport}"],
  },
  {
    label: "个人学情·课堂",
    file: "模板/学生个人学情/公共_默认_学生个人学情分析模板_课堂_数据型.md",
    sigs: ["{personalQuizStats}"],
  },
  {
    label: "个人学情·对话活动",
    file: "模板/学生个人学情/公共_默认_学生个人学情分析模板_对话活动_数据型.md",
    sigs: ["{studentName}", "{pcTitle}"],
  },
  {
    label: "互动探究分析",
    file: "模板/交互探究分析/公共_默认_互动探究分析模板_数据型.md",
    sigs: ["{explorationTitle}"],
  },
  {
    label: "课堂作业分析",
    file: "模板/课堂作业分析/公共_默认_课堂作业分析模板_数据型.md",
    sigs: ["{quizTitle}", "{questionStats}"],
  },
];

async function main() {
  const all = await prisma.analysisTemplate.findMany({
    select: { id: true, name: true, type: true, content: true },
  });
  let totalUpdated = 0;

  for (const v of VARIANTS) {
    const content = fs.readFileSync(path.join(process.cwd(), v.file), "utf-8");
    // 守卫：只更新含旧图表规范或已是新协议的模板（数据型专属标记）。
    // 文本型模板与数据型共享数据段占位符，但不含图表段标记——必须排除，防止误覆盖。
    const hits = all.filter(
      (t) =>
        v.sigs.every((s) => t.content.includes(s)) &&
        (t.content.includes("## 图表与渲染规范（无依赖版）") || t.content.includes("## 图表协议"))
    );
    for (const t of hits) {
      if (t.content.trim() === content.trim()) continue; // 已同步
      await prisma.analysisTemplate.update({ where: { id: t.id }, data: { content } });
      console.log(`[${v.label}] 更新 ${t.type}/${t.name} (${t.id.slice(-6)})`);
      totalUpdated++;
    }
    console.log(`[${v.label}] 匹配 ${hits.length} 个模板`);
  }
  console.log(`\n完成：共更新 ${totalUpdated} 个模板`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
