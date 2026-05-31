import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import bcrypt from "bcryptjs";

const ANALYTICS_URL = process.env.ANALYTICS_URL || process.env.NEXT_PUBLIC_ANALYTICS_URL || "";

async function reportLogin(user: { name: string; phone: string; email: string | null; school: string | null }) {
  if (!ANALYTICS_URL) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(ANALYTICS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: `server-${user.phone}`,
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        schoolName: user.school || "未设置",
        teacherName: user.name || "未知",
        phone: user.phone || "",
        email: user.email || "",
        action: "login",
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    // 静默处理
  }
}

export async function POST(req: NextRequest) {
  try {
    const { phone, password } = await req.json();

    if (!phone || !password) {
      return NextResponse.json(
        { error: "请填写手机号和密码" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({
      where: { phone },
    });
    if (!user || !user.password) {
      return NextResponse.json(
        { error: "手机号或密码错误" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return NextResponse.json(
        { error: "手机号或密码错误" },
        { status: 401 }
      );
    }

    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    // 服务端上报（不阻塞响应）
    reportLogin(user);

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        school: user.school,
        role: user.role,
        motto: user.motto,
        studentMotto: user.studentMotto,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    const message = error instanceof Error ? error.message : "登录失败";
    return NextResponse.json({ error: "登录失败", detail: message }, { status: 500 });
  }
}
