import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 获取当前班级
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

    const rawClass = await prisma.class.findFirst({
      where: { teacherId: payload.userId as string, isCurrent: true },
      include: {
        _count: {
          select: { User_User_classIdToClass: true },
        },
      },
    });

    // 映射字段名以匹配前端期望
    const currentClass = rawClass ? {
      ...rawClass,
      _count: { students: rawClass._count.User_User_classIdToClass }
    } : null;

    return NextResponse.json({ class: currentClass });
  } catch (error) {
    console.error("Get current class error:", error);
    return NextResponse.json({ error: "获取当前班级失败" }, { status: 500 });
  }
}

// POST: 设置当前班级
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

    const { classId } = await req.json();
    if (!classId) {
      return NextResponse.json({ error: "请提供班级ID" }, { status: 400 });
    }

    const teacherId = payload.userId as string;

    // 验证班级是否属于该教师
    const classData = await prisma.class.findUnique({
      where: { id: classId },
    });
    if (!classData || classData.teacherId !== teacherId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 使用事务确保只有一个当前班级
    await prisma.$transaction(async (tx) => {
      // 先将该教师的所有班级设置为非当前
      await tx.class.updateMany({
        where: { teacherId },
        data: { isCurrent: false },
      });
      // 再将指定班级设置为当前
      await tx.class.update({
        where: { id: classId },
        data: { isCurrent: true },
      });
    });

    return NextResponse.json({ success: true, message: "已设置为当前班级" });
  } catch (error) {
    console.error("Set current class error:", error);
    return NextResponse.json({ error: "设置当前班级失败" }, { status: 500 });
  }
}
