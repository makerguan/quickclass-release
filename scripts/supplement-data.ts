import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const TEACHER_ID = "cmoviqgye0001y0yl6qqrrmnc";

async function main() {
  console.log("开始补充数据...\n");

  const hashedPassword = await bcrypt.hash("123456", 10);

  // 1. 补充七年级(2)班
  let class2 = await prisma.class.findUnique({ where: { inviteCode: "MATH2026B" } });
  if (!class2) {
    class2 = await prisma.class.create({
      data: {
        name: "七年级(2)班",
        description: "七年级第二班",
        teacherId: TEACHER_ID,
        inviteCode: "MATH2026B",
        status: "ACTIVE",
        aiPromptStrategy: "PRIORITY_MATERIAL",
        isCurrent: false,
      },
    });
    console.log("创建班级: 七年级(2)班, id:", class2.id);
  } else {
    console.log("七年级(2)班已存在, id:", class2.id);
  }

  const class1Id = "cmoviqgyh0003y0yl3uexfru6";

  // 2. 补充更多学生
  const existingStudents = await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { email: true },
  });
  const existingEmails = new Set(existingStudents.map((s) => s.email));

  interface StudentInfo {
    name: string;
    email: string;
    studentNo: string;
    classId: string;
  }

  const additionalStudents: StudentInfo[] = [
    { name: "王建国", email: "wang@student.com", studentNo: "2026003", classId: class1Id },
    { name: "陈思思", email: "chen@student.com", studentNo: "2026004", classId: class1Id },
    { name: "刘洋", email: "liu@student.com", studentNo: "2026005", classId: class1Id },
    { name: "张伟", email: "zhangwei@student.com", studentNo: "2026006", classId: class2.id },
    { name: "李四", email: "lisi@student.com", studentNo: "2026007", classId: class2.id },
    { name: "王五", email: "wangwu@student.com", studentNo: "2026008", classId: class2.id },
    { name: "赵丽颖", email: "zhaoli@student.com", studentNo: "2026009", classId: class2.id },
    { name: "王俊凯", email: "wangjunkai@student.com", studentNo: "2026010", classId: class2.id },
    { name: "张杰", email: "zhangjie@student.com", studentNo: "2026011", classId: class2.id },
  ];

  for (const s of additionalStudents) {
    if (existingEmails.has(s.email)) {
      console.log(`学生 ${s.name} 已存在，跳过`);
      continue;
    }
    await prisma.user.create({
      data: {
        email: s.email,
        password: hashedPassword,
        name: s.name,
        studentNo: s.studentNo,
        role: "STUDENT",
        classId: s.classId,
      },
    });
    console.log(`创建学生: ${s.name} (${s.email})`);
  }

  // 3. 补充班级2的任务分配
  const taskId = "cmoviqgyu000fy0ylxnnzpxor";
  const existingTA = await prisma.taskAssignment.findUnique({
    where: { taskId_classId: { taskId, classId: class2.id } },
  });
  if (!existingTA) {
    await prisma.taskAssignment.create({
      data: { taskId, classId: class2.id },
    });
    console.log("创建任务分配: 班级2");
  } else {
    console.log("任务分配(班级2)已存在，跳过");
  }

  console.log("\n数据补充完成！");
  console.log(`用户总数: ${await prisma.user.count()}`);
  console.log(`班级总数: ${await prisma.class.count()}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());