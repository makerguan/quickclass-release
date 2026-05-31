import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// DELETE /api/conversations/teacher/class/[classId] - 清空班级所有对话记录
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { classId } = await params;

    // 验证班级属于该教师
    const classInfo = await prisma.class.findUnique({ where: { id: classId } });
    if (!classInfo) {
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }
    if (classInfo.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 获取班级所有对话
    const conversations = await prisma.conversation.findMany({
      where: { classId },
      select: { id: true },
    });

    if (conversations.length === 0) {
      return NextResponse.json({ success: true, deletedCount: 0 });
    }

    // 删除所有消息和对话
    const conversationIds = conversations.map((c) => c.id);
    await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { classId } });

    return NextResponse.json({ success: true, deletedCount: conversations.length });
  } catch (error) {
    console.error("Clear class conversations error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
