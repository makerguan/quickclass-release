import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// PATCH /api/student-projects/[id]/pin
// Body: { pinned: boolean }
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

    const { pinned } = await req.json();

    // 验证权限：该提交属于该教师的课堂
    const project = await prisma.studentProject.findUnique({
      where: { id },
      include: { ProjectSubmission: { include: { SubProject: { include: { task: { select: { teacherId: true } } } } } } },
    });
    if (!project) return new Response("提交不存在", { status: 404 });
    if (project.ProjectSubmission.SubProject.task.teacherId !== String(payload.userId))
      return new Response("无权限", { status: 403 });

    const project2 = await prisma.studentProject.findUnique({ where: { id } });
    if (!project2) return new Response("提交不存在", { status: 404 });
    // 下架状态下不允许置顶，必须先取消下架
    if (pinned && project2.hidden) {
      return new Response("该项目已下架，请先恢复显示后再置顶", { status: 400 });
    }

    await prisma.studentProject.update({
      where: { id },
      data: { pinned: !!pinned },
    });

    return NextResponse.json({ success: true, pinned: !!pinned });
  } catch (error) {
    console.error("锁定操作失败:", error);
    return new Response("操作失败", { status: 500 });
  }
}
