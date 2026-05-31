import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ insightId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { insightId } = await params;

    const insight = await prisma.aIInsight.findUnique({ where: { id: insightId } });
    if (!insight) return NextResponse.json({ error: "分析记录不存在" }, { status: 404 });

    await prisma.aIInsight.delete({ where: { id: insightId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete insight error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}