import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// PATCH /api/student-projects/[id]/hide
// Body: { hidden: boolean }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return new Response("无权限", { status: 403 });

    const { hidden } = await req.json();

    const project = await prisma.studentProject.findUnique({
      where: { id },
      include: { ProjectSubmission: { include: { SubProject: { include: { task: { select: { teacherId: true } } } } } } },
    });
    if (!project) return new Response("提交不存在", { status: 404 });
    if (project.ProjectSubmission.SubProject.task.teacherId !== String(payload.userId))
      return new Response("无权限", { status: 403 });

    const project2 = await prisma.studentProject.findUnique({ where: { id } });
    if (!project2) return new Response("提交不存在", { status: 404 });
    // 置顶状态下不允许下架，必须先取消置顶
    if (hidden && project2.pinned) {
      return new Response("该项目已置顶，请先取消置顶后再下架", { status: 400 });
    }

    await prisma.studentProject.update({
      where: { id },
      data: { hidden: !!hidden },
    });

    return NextResponse.json({ success: true, hidden: !!hidden });
  } catch (error) {
    console.error("下架操作失败:", error);
    return new Response("操作失败", { status: 500 });
  }
}
