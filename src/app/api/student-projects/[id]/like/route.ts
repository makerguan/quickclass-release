import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { dbWrite } from "@/lib/db-queue";

// 校验用户可对该提交点赞（任务允许点赞 + 同班/教师）
async function canLike(projectId: string, userId: string) {
  const p = await prisma.studentProject.findUnique({
    where: { id: projectId },
    include: {
      ProjectSubmission: {
        include: { SubProject: { include: { task: { select: { id: true, teacherId: true } } } } },
      },
      User: { select: { classId: true } },
    },
  });
  if (!p) return { error: "提交不存在", status: 404 };
  if (!p.ProjectSubmission.allowLike) return { error: "该任务未开启点赞", status: 403 };
  // 教师可以点赞任何人的提交
  if (p.ProjectSubmission.SubProject.task.teacherId === userId) return { p };
  // 学生不能给自己点赞
  if (p.studentId === userId) return { error: "不能给自己点赞", status: 403 };
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { classId: true } });
  if (!me || !me.classId || me.classId !== p.User.classId)
    return { error: "无权限", status: 403 };
  return { p };
}

// POST: 点赞
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || (payload.role !== "STUDENT" && payload.role !== "TEACHER"))
      return new Response("无权限", { status: 403 });

    const chk = await canLike(id, String(payload.userId));
    if (chk.error) return new Response(chk.error, { status: chk.status });

    const like = await dbWrite(() =>
      prisma.projectLike.upsert({
        where: { projectId_studentId: { projectId: id, studentId: String(payload.userId) } },
        create: { projectId: id, studentId: String(payload.userId) },
        update: {},
      })
    );
    return NextResponse.json({ success: true, like });
  } catch (error) {
    console.error("点赞失败:", error);
    return new Response("点赞失败", { status: 500 });
  }
}

// DELETE: 取消点赞
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || (payload.role !== "STUDENT" && payload.role !== "TEACHER"))
      return new Response("无权限", { status: 403 });

    await dbWrite(() =>
      prisma.projectLike.deleteMany({
        where: { projectId: id, studentId: String(payload.userId) },
      })
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("取消点赞失败:", error);
    return new Response("取消失败", { status: 500 });
  }
}
