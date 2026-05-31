import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import bcrypt from "bcryptjs";

// 导入已有账号
export async function POST(req: NextRequest) {
  try {
    const { keyFile } = await req.json();

    if (!keyFile) {
      return NextResponse.json({ error: "请上传密钥文件" }, { status: 400 });
    }

    // 检查本地是否已有账号
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json(
        { error: "本地已有账号，请先删除本地数据再导入" },
        { status: 400 }
      );
    }

    // 解析密钥文件
    // 格式：手机号|姓名|密码哈希|签名
    // 这里先实现简单版本，等待资源广场对接
    const lines = keyFile.trim().split("\n");
    let phone = "", name = "", passwordHash = "";

    for (const line of lines) {
      if (line.startsWith("手机号:") || line.startsWith("phone:")) {
        phone = line.split(":")[1]?.trim() || "";
      } else if (line.startsWith("姓名:") || line.startsWith("name:")) {
        name = line.split(":")[1]?.trim() || "";
      } else if (line.startsWith("密钥:") || line.startsWith("key:")) {
        // 密钥文件格式的备用解析
        const parts = line.substring(line.indexOf(":") + 1).split("|");
        if (parts.length >= 2) {
          phone = parts[0].trim();
        }
      }
    }

    if (!phone || !name) {
      return NextResponse.json(
        { error: "密钥文件格式不正确，请使用资源广场生成的密钥文件" },
        { status: 400 }
      );
    }

    // TODO: 验证密钥签名（等资源广场提供公钥）

    // 检查是否已有此手机号的用户
    const existing = await prisma.user.findFirst({ where: { phone } });
    if (existing) {
      return NextResponse.json(
        { error: "该手机号已在本地存在，请勿重复导入" },
        { status: 409 }
      );
    }

    // 生成随机密码（用户首次需设置）
    const tempPassword = crypto.randomUUID().replace(/-/g, "").substring(0, 12);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // 创建本地账号
    const user = await prisma.user.create({
      data: {
        phone,
        name,
        password: hashedPassword,
        role: "TEACHER",
      },
    });

    // TODO: 标记密钥已使用（调用资源广场 API）

    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      tempPassword, // 返回临时密码，用户需立即修改
      needResetPassword: true,
    });
  } catch (error) {
    console.error("Import account error:", error);
    return NextResponse.json({ error: "导入失败" }, { status: 500 });
  }
}