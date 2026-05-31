import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { students, classId } = await req.json();

    if (!Array.isArray(students) || students.length === 0) {
      return NextResponse.json({ error: "学生数据不能为空" }, { status: 400 });
    }

    if (!classId) {
      return NextResponse.json({ error: "请选择班级" }, { status: 400 });
    }

    // 验证班级属于该教师
    const classData = await prisma.class.findFirst({
      where: { id: classId, teacherId: payload.userId as string },
    });

    if (!classData) {
      return NextResponse.json({ error: "班级不存在或无权限" }, { status: 404 });
    }

    const results = { success: 0, failed: 0, errors: [] as string[], warnings: [] as string[] };
    const seenNames = new Set<string>();
    const seenStudentNos = new Set<string>();
    const DEFAULT_PASSWORD = "123456";

    for (const student of students) {
      // 姓名或学号至少一个
      const name = student.name?.trim().replace(/\s+/g, "") || "";
      const studentNo = student.studentNo?.trim() || "";

      if (!name && !studentNo) {
        results.failed++;
        results.errors.push(`缺少姓名和学号`);
        continue;
      }

      // 检查本次导入中的重复姓名
      if (name) {
        if (seenNames.has(name)) {
          results.failed++;
          results.errors.push(`"${name}" 重复导入`);
          continue;
        }
        seenNames.add(name);

        // 检查班级内已有的同名
        const existingName = await prisma.user.findFirst({
          where: { name, classId, role: "STUDENT" },
        });
        if (existingName) {
          results.failed++;
          results.errors.push(`班级中已有同名学生 "${name}"`);
          continue;
        }
      }

      // 检查本次导入中的重复学号
      if (studentNo) {
        if (seenStudentNos.has(studentNo)) {
          results.failed++;
          results.errors.push(`学号 "${studentNo}" 重复导入`);
          continue;
        }
        seenStudentNos.add(studentNo);

        // 检查班级内已有的同学号
        const existingNo = await prisma.user.findFirst({
          where: { studentNo, classId, role: "STUDENT" },
        });
        if (existingNo) {
          results.failed++;
          results.errors.push(`班级中已有同学号的学生 "${studentNo}"`);
          continue;
        }
      }

      // 如果有密码则使用，否则默认
      let hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      if (student.password && student.password.trim() !== "") {
        hashedPassword = await bcrypt.hash(student.password.trim(), 10);
      }

      try {
        await prisma.user.create({
          data: {
            name: name || `学生${studentNo}`, // name 必填，无姓名时自动生成
            studentNo: studentNo || null,
            role: "STUDENT",
            classId,
            password: hashedPassword,
          },
        });
        results.success++;
      } catch (e) {
        results.failed++;
        results.errors.push(`学生导入失败：${name || studentNo}`);
      }
    }

    return NextResponse.json({
      message: `导入完成，成功 ${results.success} 人，失败 ${results.failed} 人`,
      successCount: results.success,
      failedCount: results.failed,
      errors: results.errors,
      warnings: results.warnings,
    });
  } catch (error) {
    console.error("Import students error:", error);
    return NextResponse.json({ error: "导入失败" }, { status: 500 });
  }
}