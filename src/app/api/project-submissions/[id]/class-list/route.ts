import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 同班学生查看全班可见的项目提交列表（不含文件内容，仅预览信息）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "STUDENT")
      return new Response("无权限", { status: 403 });

    const sub = await prisma.projectSubmission.findUnique({
      where: { id },
      include: {
        SubProject: { include: { task: { select: { id: true } } } },
      },
    });
    if (!sub) return new Response("项目任务不存在", { status: 404 });
    if (!sub.visibleToClass)
      return new Response("该任务未对全班可见", { status: 403 });

    const me = await prisma.user.findUnique({
      where: { id: String(payload.userId) },
      select: { classId: true },
    });
    if (!me?.classId) return new Response("无法确认班级", { status: 403 });
    const assignment = await prisma.taskAssignment.findFirst({
      where: { taskId: sub.SubProject.task.id, classId: me.classId },
    });
    if (!assignment) return new Response("无权限", { status: 403 });

    const projects = await prisma.studentProject.findMany({
      where: {
        submissionId: id,
        // 学生端不显示被下架的（除非是自己的）
        OR: [
          { hidden: false },
          { studentId: String(payload.userId) },
        ],
      },
      orderBy: [{ pinned: "desc" }, { hidden: "asc" }, { createdAt: "asc" }],
      include: {
        User: { select: { id: true, name: true } },
        attachments: true,
        _count: { select: { likes: true } },
        likes: { where: { studentId: String(payload.userId) }, select: { id: true } },
      },
    });

    const items = projects.map((p) => ({
      id: p.id,
      studentId: p.studentId,
      studentName: p.User.name,
      title: p.title,
      description: p.description,
      pinned: p.pinned,
      hidden: p.hidden,
      createdAt: p.createdAt,
      attachment: p.attachments[0]
        ? {
            id: p.attachments[0].id,
            originalName: p.attachments[0].originalName,
            fileType: p.attachments[0].fileType,
            fileSize: p.attachments[0].fileSize,
          }
        : null,
      likeCount: p._count.likes,
      likedByMe: p.likes.length > 0,
      isMine: p.studentId === String(payload.userId),
    }));

    return NextResponse.json({
      submission: {
        id: sub.id,
        title: sub.title,
        description: sub.description,
        category: sub.category,
        visibleToClass: sub.visibleToClass,
        allowLike: sub.allowLike,
        fileSizeLimit: sub.fileSizeLimit,
      },
      items,
    });
  } catch (error) {
    console.error("查看全班提交失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}
