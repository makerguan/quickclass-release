import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

async function exportTemplates() {
  const templates = await prisma.analysisTemplate.findMany({
    orderBy: [{ type: "asc" }, { teacherId: "asc" }],
  });

  // 创建导出目录
  const exportDir = path.join(process.cwd(), "模板");
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const typeNames: Record<string, string> = {
    student: "学生个人学情",
    class: "学生全班学情",
    conversation: "学生对话设计",
    QUIZ_DESIGN: "课堂作业设计",
    QUIZ_ANALYSIS: "课堂作业分析",
    EXPLORATION_ANALYSIS: "探索分析",
  };

  for (const tpl of templates) {
    // 确定文件夹
    const folderName = typeNames[tpl.type] || tpl.type;
    const folderPath = path.join(exportDir, folderName);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // 确定前缀
    let prefix;
    if (!tpl.teacherId) {
      prefix = "公共_默认";
    } else {
      const teacher = await prisma.user.findUnique({ where: { id: tpl.teacherId } });
      prefix = `${teacher?.name || "未知"}_自定义`;
    }

    // 清理文件名
    const safeName = tpl.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
    const fileName = `${prefix}_${safeName}.md`;
    const filePath = path.join(folderPath, fileName);

    // 写入文件
    fs.writeFileSync(filePath, tpl.content);
    console.log(`导出: ${filePath}`);
  }

  console.log(`\n=== 导出完成，共 ${templates.length} 个模板 ===`);
}

exportTemplates()
  .catch(console.error)
  .finally(() => prisma.$disconnect());