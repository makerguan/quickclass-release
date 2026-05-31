import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import bcrypt from "bcryptjs";

// GET: 获取当前用户信息
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: String(payload.userId) },
      select: {
        id: true,
        email: true,
        name: true,
        gender: true,
        phone: true,
        school: true,
        role: true,
        motto: true,
        studentMotto: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Get profile error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// PUT: 更新用户信息
export async function PUT(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const body = await req.json();
    const { password, oldPassword, motto, studentMotto, school, gender, name } = body;

    // 如果要修改密码，必须提供旧密码
    if (password && !oldPassword) {
      return NextResponse.json({ error: "请输入当前密码" }, { status: 400 });
    }

    // 构建更新数据
    const updateData: Record<string, string | null> = {};
    if (school !== undefined) updateData.school = school;
    if (gender !== undefined) updateData.gender = gender;
    if (name !== undefined) updateData.name = name;
    if (motto !== undefined) updateData.motto = motto;
    if (studentMotto !== undefined) updateData.studentMotto = studentMotto;

    // 如果要修改密码，验证旧密码
    if (password && oldPassword) {
      const user = await prisma.user.findUnique({
        where: { id: String(payload.userId) },
        select: { password: true },
      });

      if (!user?.password) {
        return NextResponse.json({ error: "用户密码不存在" }, { status: 400 });
      }

      const isValid = await bcrypt.compare(oldPassword, user.password);
      if (!isValid) {
        return NextResponse.json({ error: "当前密码错误" }, { status: 400 });
      }

      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: String(payload.userId) },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        gender: true,
        phone: true,
        school: true,
        role: true,
        motto: true,
        studentMotto: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Update profile error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
