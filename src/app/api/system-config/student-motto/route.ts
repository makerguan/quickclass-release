import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET: 获取学生座右铭（无需登录）
export async function GET() {
  try {
    const config = await prisma.systemConfig.findFirst({
      select: { studentMotto: true },
    });
    return NextResponse.json({ studentMotto: config?.studentMotto || null });
  } catch (error) {
    console.error("Get student motto error:", error);
    return NextResponse.json({ studentMotto: null });
  }
}