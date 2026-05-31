/**
 * 直接用SQL插入学生数据（SQLite版本）
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== 创建七年级(2)班学生账号 ===\n");

  // 找到七年级(2)班
  const class2 = await prisma.class.findFirst({
    where: { name: "七年级(2)班" }
  });

  if (!class2) {
    console.error("未找到七年级(2)班");
    return;
  }

  console.log("班级:", class2.name, "ID:", class2.id);

  // 创建5个学生
  const students = [
    { name: "李明", email: "liming@student.com", studentNo: "2026021" },
    { name: "王芳", email: "wangfang@student.com", studentNo: "2026022" },
    { name: "刘强", email: "liuqiang@student.com", studentNo: "2026023" },
    { name: "陈静", email: "chenjing@student.com", studentNo: "2026024" },
    { name: "赵伟", email: "zhaowei@student.com", studentNo: "2026025" },
  ];

  for (const s of students) {
    try {
      // 先查找
      const existing = await prisma.$queryRawUnsafe(
        `SELECT * FROM "User" WHERE email = '${s.email}'`
      ) as any[];

      if (existing.length > 0) {
        // 更新
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET name = '${s.name}', "studentNo" = '${s.studentNo}', "classId" = '${class2.id}' WHERE email = '${s.email}'`
        );
        console.log(`更新学生: ${s.name} (${s.email})`);
      } else {
        // 创建
        await prisma.$executeRawUnsafe(
          `INSERT INTO "User" (id, "email", password, name, "studentNo", role, "classId", "createdAt", "studentMotto")
           VALUES (lower(hex(randomblob(16))), '${s.email}', '$2b$10$dummy', '${s.name}', '${s.studentNo}', 'STUDENT', '${class2.id}', datetime('now'), '我爱数学')`
        );
        console.log(`创建学生: ${s.name} (${s.email})`);
      }
    } catch (e: any) {
      console.error(`失败: ${s.name}`, e.message);
    }
  }

  // 验证
  const studentsInClass2 = await prisma.$queryRawUnsafe(
    `SELECT name, email, "studentNo" FROM "User" WHERE "classId" = '${class2.id}'`
  ) as any[];

  console.log("\n七年级(2)班现有学生:");
  studentsInClass2.forEach(s => console.log(`  - ${s.name} (${s.email || "无邮箱"})`));

  console.log("\n完成!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());