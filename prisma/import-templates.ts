/**
 * 导入模板文件到数据库
 * 用法: npx tsx prisma/import-templates.ts
 *
 * 模板文件格式（markdown）:
 * - 第一行：模板名称
 * - 第二行起：模板内容
 *
 * 变量格式统一使用 {变量名}，与现有代码中的 replaceTemplateVars 兼容
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

// 与 src/lib/prisma.ts 保持一致，使用 process.cwd() 解析数据库路径
const dbPath = path.join(process.cwd(), "prisma", "dev.db");

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}`,
    },
  },
});

// 模板文件与类型的映射
const TEMPLATE_FILES: Record<string, string> = {
  "学生个人学情模板.md": "student",
  "学生全班学情模板.md": "class",
  "学生对话设计模板.md": "conversation",
  "课堂作业设计模板.md": "QUIZ_DESIGN",
  "课堂作业分析模板.md": "QUIZ_ANALYSIS",
};

async function importTemplates() {
  console.log("📥 开始导入模板文件...\n");

  // 读取 .env 获取 teacherId
  const teacher = await prisma.user.findFirst({
    where: { role: "TEACHER" },
    orderBy: { createdAt: "asc" },
  });

  if (!teacher) {
    console.error("❌ 未找到教师账号，请先运行 npm run db:seed");
    process.exit(1);
  }

  console.log(`✅ 找到教师: ${teacher.name} (${teacher.email})\n`);

  const results: { file: string; status: "created" | "skipped" | "error"; message: string }[] = [];

  for (const [filename, type] of Object.entries(TEMPLATE_FILES)) {
    const filePath = path.join(process.cwd(), filename);

    if (!fs.existsSync(filePath)) {
      results.push({ file: filename, status: "error", message: "文件不存在" });
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    if (lines.length < 2) {
      results.push({ file: filename, status: "error", message: "文件内容不足（需要第一行标题 + 内容）" });
      continue;
    }

    const templateName = lines[0].trim();
    const templateContent = lines.slice(1).join("\n").trim();

    if (!templateName) {
      results.push({ file: filename, status: "error", message: "第一行标题为空" });
      continue;
    }

    // 检查是否已存在同名模板
    const existing = await prisma.analysisTemplate.findFirst({
      where: { teacherId: teacher.id, type, name: templateName },
    });

    if (existing) {
      // 更新已有模板
      await prisma.analysisTemplate.update({
        where: { id: existing.id },
        data: { content: templateContent, isDefault: true },
      });
      results.push({ file: filename, status: "skipped", message: `已更新现有模板（ID: ${existing.id}）` });
    } else {
      // 取消同类型其他默认
      await prisma.analysisTemplate.updateMany({
        where: { teacherId: teacher.id, type, isDefault: true },
        data: { isDefault: false },
      });

      // 创建新模板
      await prisma.analysisTemplate.create({
        data: {
          teacherId: teacher.id,
          type,
          name: templateName,
          content: templateContent,
          isDefault: true,
        },
      });
      results.push({ file: filename, status: "created", message: `类型: ${type}` });
    }
  }

  // 输出结果
  console.log("导入结果：");
  console.log("─".repeat(60));
  for (const r of results) {
    const icon = r.status === "created" ? "✅" : r.status === "skipped" ? "⏭️ " : "❌";
    console.log(`${icon} ${r.file}`);
    console.log(`   ${r.message}`);
  }
  console.log("─".repeat(60));

  // 验证
  const count = await prisma.analysisTemplate.count({ where: { teacherId: teacher.id } });
  console.log(`\n📊 教师 ${teacher.name} 当前共有 ${count} 个模板\n`);

  const byType = await prisma.analysisTemplate.groupBy({
    by: ["type"],
    where: { teacherId: teacher.id },
    _count: true,
  });
  for (const t of byType) {
    console.log(`   - ${t.type}: ${t._count} 个`);
  }
}

importTemplates()
  .catch((e) => {
    console.error("❌ 导入失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
