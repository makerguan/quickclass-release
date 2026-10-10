import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 按需取单条学生洞察正文（初始 /insights GET 已改为只回元数据，避免一次下发 N 份完整 HTML）
// ⚠️ PERF：配合前端展开式卡片，仅在老师展开某学生时调用。
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ presetConversationId: string; insightId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const { presetConversationId, insightId } = await params;

    const pc = await prisma.presetConversation.findUnique({
      where: { id: presetConversationId },
      include: { SubProject: { include: { task: { select: { teacherId: true } } } } },
    });
    if (!pc || pc.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const insight = await prisma.aIInsight.findUnique({ where: { id: insightId } });
    if (!insight || insight.scopeId !== presetConversationId) {
      return NextResponse.json({ error: "洞察不存在" }, { status: 404 });
    }

    return NextResponse.json({ content: insight.content || "" });
  } catch (error) {
    console.error("获取学生洞察正文失败:", error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}
