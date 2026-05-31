import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const { id: quizId, versionId } = await params;

    // 验证权限：必须是该作业的老师才能删除
    const quiz = await prisma.quizActivity.findFirst({
      where: { id: quizId, SubProject: { task: { teacherId: String(payload.userId) } } },
    });
    if (!quiz) return NextResponse.json({ error: "作业不存在或无权限" }, { status: 404 });

    // 删除指定版本
    const deleted = await prisma.aIInsight.delete({
      where: { id: versionId },
    });

    return NextResponse.json({ success: true, deletedVersion: deleted.version });
  } catch (error) {
    console.error("删除报告版本失败:", error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}