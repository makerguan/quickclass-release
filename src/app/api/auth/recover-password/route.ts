import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// 方式一：通过问题答案恢复密码
export async function POST(req: NextRequest) {
  try {
    const { phone, recoveryAnswer, newPassword } = await req.json();

    if (!phone || !recoveryAnswer) {
      return NextResponse.json(
        { error: "请填写所有字段" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    if (!user.recoveryAnswerHash) {
      return NextResponse.json({ error: "该用户未设置恢复问题" }, { status: 400 });
    }

    // 验证答案
    const isValid = await bcrypt.compare(recoveryAnswer, user.recoveryAnswerHash);
    if (!isValid) {
      return NextResponse.json({ error: "答案错误" }, { status: 401 });
    }

    // 更新密码
    const password = newPassword || "123456";
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return NextResponse.json({ success: true, message: "密码已恢复" });
  } catch (error) {
    console.error("Password recovery error:", error);
    return NextResponse.json({ error: "恢复失败" }, { status: 500 });
  }
}
