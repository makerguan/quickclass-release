import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// 方式二：通过密钥文件恢复密码
export async function POST(req: NextRequest) {
  try {
    const { phone, recoveryKey, newPassword } = await req.json();

    if (!phone || !recoveryKey) {
      return NextResponse.json(
        { error: "请上传密钥文件并填写信息" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    if (!user.passwordKeyHash) {
      return NextResponse.json({ error: "该用户未生成密钥文件" }, { status: 400 });
    }

    // 验证密钥文件
    const isValid = await bcrypt.compare(recoveryKey, user.passwordKeyHash);
    if (!isValid) {
      return NextResponse.json({ error: "密钥文件无效" }, { status: 401 });
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
