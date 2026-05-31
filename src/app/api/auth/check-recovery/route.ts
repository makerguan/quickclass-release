import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();

    if (!phone) {
      return NextResponse.json({ error: "请提供手机号" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({ where: { phone } });
    if (!user) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    return NextResponse.json({
      hasQuestion: !!user.recoveryQuestion,
      hasKey: !!user.passwordKeyHash,
    });
  } catch (error) {
    console.error("Check recovery error:", error);
    return NextResponse.json({ error: "检查失败" }, { status: 500 });
  }
}