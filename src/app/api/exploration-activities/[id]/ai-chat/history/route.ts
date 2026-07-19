import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 获取学生在该探究中的AI伴学对话历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      select: { id: true, enableAiCompanion: true },
    });
    if (!exploration) return NextResponse.json({ error: "探究不存在" }, { status: 404 });
    if (!exploration.enableAiCompanion) {
      return NextResponse.json({ error: "AI伴学未启用" }, { status: 403 });
    }

    const userId = String(payload.userId);
    const messages = await prisma.aiCompanionMessage.findMany({
      where: { explorationId: id, studentId: userId },
      select: { id: true, role: true, content: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("[ai-chat/history GET] 错误:", error?.message || error);
    return NextResponse.json(
      { error: error?.message || "获取历史失败" },
      { status: 500 }
    );
  }
}

// DELETE: 清空学生在该探究中的AI伴学对话历史
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      select: { id: true, enableAiCompanion: true },
    });
    if (!exploration) return NextResponse.json({ error: "探究不存在" }, { status: 404 });
    if (!exploration.enableAiCompanion) {
      return NextResponse.json({ error: "AI伴学未启用" }, { status: 403 });
    }

    const userId = String(payload.userId);
    const result = await prisma.aiCompanionMessage.deleteMany({
      where: { explorationId: id, studentId: userId },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
    });
  } catch (error: any) {
    console.error("[ai-chat/history DELETE] 错误:", error?.message || error);
    return NextResponse.json(
      { error: error?.message || "清空失败" },
      { status: 500 }
    );
  }
}