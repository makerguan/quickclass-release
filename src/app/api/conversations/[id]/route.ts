import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET /api/conversations/[id] - 获取单个对话详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        Message: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }

    // 验证权限：只能查看自己的对话
    if (conversation.userId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 映射字段名
    const { Message, ...rest } = conversation;
    return NextResponse.json({ ...rest, messages: Message });
  } catch (error) {
    console.error("Get conversation error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// DELETE /api/conversations/[id] - 删除单个对话（教师或学生）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { Class: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }

    // 教师：验证是否属于自己的班级
    if (payload.role === "TEACHER") {
      if (conversation.Class.teacherId !== String(payload.userId)) {
        return NextResponse.json({ error: "无权限" }, { status: 403 });
      }
    } else {
      // 学生：只能删除自己的对话
      if (conversation.userId !== String(payload.userId)) {
        return NextResponse.json({ error: "无权限" }, { status: 403 });
      }
    }

    // 删除对话及其消息
    await prisma.message.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
