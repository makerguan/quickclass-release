import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 获取该教师所有班级的学生（含密码状态）
    const classes = await prisma.class.findMany({
      where: { teacherId: payload.userId as string },
      select: {
        id: true,
        name: true,
        students: {
          select: {
            id: true,
            name: true,
            studentNo: true,
            createdAt: true,
            password: true,
          },
        },
      },
    });

    const allStudents = classes.flatMap((c) =>
      (c.students).map((s) => ({
        ...s,
        classId: c.id,
        className: c.name,
      }))
    );

    return NextResponse.json(allStudents);
  } catch (error) {
    console.error("Get teacher students error:", error);
    return NextResponse.json({ error: "获取学生列表失败" }, { status: 500 });
  }
}
