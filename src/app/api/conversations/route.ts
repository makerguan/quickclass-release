import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");

    const where: Record<string, unknown> = { userId: String(payload.userId) };
    if (classId) where.classId = classId;

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        Message: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // 将 Prisma 返回的 Message 映射为前端期望的 messages
    const mapped = conversations.map((c) => ({
      ...c,
      messages: c.Message,
    }));

    return NextResponse.json(mapped);
  } catch (error) {
    console.error("Get conversations error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const body = await req.json();
    const { classId, title } = body;

    const conversation = await prisma.conversation.create({
      data: {
        userId: String(payload.userId),
        classId,
        title: title || "新对话",
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Create conversation error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
