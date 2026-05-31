import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// POST /api/preset-conversations/reorder
// Body: { presetConversationId: string; direction: "up" | "down"; subProjectId: string }
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    const { presetConversationId, direction, subProjectId } = await req.json();
    if (!subProjectId) return new NextResponse("缺少 subProjectId", { status: 400 });

    const items = await prisma.presetConversation.findMany({
      where: { subProjectId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true },
    });

    const idx = items.findIndex((i) => i.id === presetConversationId);
    if (idx === -1) return new NextResponse("未找到对话活动", { status: 404 });

    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) {
      return NextResponse.json({ success: true });
    }
    const cur = items[idx];
    const target = items[targetIdx];

    await prisma.$transaction([
      prisma.presetConversation.update({ where: { id: presetConversationId }, data: { sortOrder: target.sortOrder } }),
      prisma.presetConversation.update({ where: { id: target.id }, data: { sortOrder: cur.sortOrder } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return new NextResponse("排序失败", { status: 500 });
  }
}
