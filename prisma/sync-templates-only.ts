import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  console.log("开始同步分析模板...\n");

  // 3. 公共模板（teacherId=null，所有教师可见）
  const publicTemplates = [
    {
      name: "学生个人学情分析模板",
      type: "student",
      content: fs.readFileSync(path.join(__dirname, "../学生个人学情模板.md"), "utf-8"),
      isDefault: true,
    },
    {
      name: "全班学情分析模板",
      type: "class",
      content: fs.readFileSync(path.join(__dirname, "../学生全班学情模板.md"), "utf-8"),
      isDefault: true,
    },
    {
      name: "对话分析模板",
      type: "conversation",
      content: fs.readFileSync(path.join(__dirname, "../学生对话设计模板.md"), "utf-8"),
      isDefault: true,
    },
    {
      name: "课堂作业设计模板",
      type: "QUIZ_DESIGN",
      content: fs.readFileSync(path.join(__dirname, "../课堂作业设计模板.md"), "utf-8"),
      isDefault: true,
    },
    {
      name: "课堂作业分析模板",
      type: "QUIZ_ANALYSIS",
      content: fs.readFileSync(path.join(__dirname, "../课堂作业分析模板.md"), "utf-8"),
      isDefault: true,
    },
    {
      name: "探索分析模板",
      type: "EXPLORATION_ANALYSIS",
      content: fs.readFileSync(path.join(__dirname, "../互动探究分析模板.md"), "utf-8"),
      isDefault: true,
    },
  ];

  console.log("准备同步公共模板...\n");

  // 同步公共模板
  for (const tpl of publicTemplates) {
    const existing = await prisma.analysisTemplate.findFirst({
      where: { name: tpl.name, teacherId: null },
    });
    if (existing) {
      await prisma.analysisTemplate.update({
        where: { id: existing.id },
        data: {
          type: tpl.type,
          content: tpl.content,
          isDefault: tpl.isDefault,
          updatedAt: new Date(),
        },
      });
      console.log("更新公共模板:", tpl.name);
    } else {
      await prisma.analysisTemplate.create({
        data: {
          teacherId: null, // 公共模板
          name: tpl.name,
          type: tpl.type,
          content: tpl.content,
          isDefault: tpl.isDefault,
          updatedAt: new Date(),
        },
      });
      console.log("创建公共模板:", tpl.name);
    }
  }

  // 4. 统计结果
  const count = await prisma.analysisTemplate.count();
  console.log("\n=== 同步完成 ===");
  console.log("当前分析模板总数:", count);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());