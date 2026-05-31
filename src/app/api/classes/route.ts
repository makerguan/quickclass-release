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

    const rawClasses = await prisma.class.findMany({
      where: { teacherId: payload.userId as string },
      include: {
        _count: {
          select: { User_User_classIdToClass: true },
        },
      },
      orderBy: [
        { isCurrent: "desc" },
        { createdAt: "desc" },
      ],
    });

    // 映射 _count 字段名，前端期望 students
    const classes = rawClasses.map(({ _count, ...cls }) => ({
      ...cls,
      _count: { students: _count.User_User_classIdToClass },
    }));

    return NextResponse.json(classes);
  } catch (error) {
    console.error("Get classes error:", error);
    return NextResponse.json({ error: "获取班级失败" }, { status: 500 });
  }
}

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

    const { name, description, inviteCode, isCurrent, openInviteCode } = await req.json();

    if (!name || !inviteCode) {
      return NextResponse.json(
        { error: "请填写班级名称和邀请码" },
        { status: 400 }
      );
    }

    const existing = await prisma.class.findUnique({
      where: { inviteCode },
    });
    if (existing) {
      return NextResponse.json(
        { error: "邀请码已被使用" },
        { status: 409 }
      );
    }

    const teacherId = payload.userId as string;

    // 如果设置为当前班级，需要先将其他班级设为非当前
    if (isCurrent) {
      await prisma.class.updateMany({
        where: { teacherId },
        data: { isCurrent: false },
      });
    }

    const newClass = await prisma.class.create({
      data: {
        name,
        description,
        inviteCode,
        teacherId,
        isCurrent: isCurrent || false,
        openInviteCode: openInviteCode || false,
      },
    });

    return NextResponse.json(newClass);
  } catch (error) {
    console.error("Create class error:", error);
    return NextResponse.json({ error: "创建班级失败" }, { status: 500 });
  }
}
