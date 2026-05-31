import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// PATCH: 切换对话活动生效/失效
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ presetConversationId: string }> }
) {
  try {
    const { presetConversationId } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    const body = await req.json();
    const enabled = body.enabled === true;

    await prisma.presetConversation.update({
      where: { id: presetConversationId },
      data: { enabled },
    });

    return NextResponse.json({ success: true, enabled });
  } catch (e) {
    console.error(e);
    return new NextResponse("切换失败", { status: 500 });
  }
}
