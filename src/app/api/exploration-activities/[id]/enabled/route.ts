import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const body = await req.json();
    const enabled = body.enabled === true;

    const item = await prisma.explorationActivity.findUnique({
      where: { id },
      include: { SubProject: { select: { task: { select: { teacherId: true } } } } },
    });
    if (!item) return new Response("不存在", { status: 404 });
    if (item.SubProject.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    await prisma.explorationActivity.update({
      where: { id },
      data: { enabled },
    });

    return NextResponse.json({ success: true, enabled });
  } catch (e) {
    console.error(e);
    return new Response("切换失败", { status: 500 });
  }
}
