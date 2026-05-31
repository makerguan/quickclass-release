import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "STUDENT") {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const { oldPassword, newPassword } = await req.json();

    if (!newPassword || newPassword.length < 1) {
      return NextResponse.json(
        { error: "新密码不能为空" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId as string },
    });

    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    // 如果之前设置过密码，则必须验证旧密码
    if (user.password != null) {
      if (!oldPassword) {
        return NextResponse.json(
          { error: "请输入当前密码" },
          { status: 400 }
        );
      }
      const valid = await bcrypt.compare(oldPassword, user.password);
      if (!valid) {
        return NextResponse.json(
          { error: "当前密码错误" },
          { status: 401 }
        );
      }
    }

    // 使用 bcrypt 加密新密码
    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    });

    return NextResponse.json({ message: "密码修改成功" });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json({ error: "修改失败" }, { status: 500 });
  }
}
