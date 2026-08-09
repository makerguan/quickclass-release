import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { dbWrite } from "@/lib/db-queue";
import { deleteAttachmentFile } from "@/lib/project-submit";

// 校验教师对该项目任务的权限
async function authorizeTeacher(submissionId: string, teacherId: string) {
  const sub = await prisma.projectSubmission.findUnique({
    where: { id: submissionId },
    include: { SubProject: { include: { task: { select: { teacherId: true } } } } },
  });
  if (!sub) return { error: "项目任务不存在", status: 404 };
  if (sub.SubProject.task.teacherId !== teacherId)
    return { error: "无权限", status: 403 };
  return { sub };
}

// GET: 教师查看任务详情 + 全班提交统计/列表（支持分页与搜索）
export async function GET(
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

    const auth = await authorizeTeacher(id, String(payload.userId));
    if (auth.error) return new Response(auth.error, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 20));
    const search = (searchParams.get("search") || "").trim();

    // 该任务下所有学生提交
    const where: any = { submissionId: id };
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { User: { name: { contains: search } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.studentProject.count({ where }),
      prisma.studentProject.findMany({
        where,
        orderBy: [{ pinned: "desc" }, { hidden: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          User: { select: { id: true, name: true } },
          attachments: true,
          _count: { select: { likes: true } },
          likes: { where: { studentId: String(payload.userId) }, select: { id: true } },
        },
      }),
    ]);

    // 统计：总提交人数、占用空间
    const sizeAgg = await prisma.projectAttachment.aggregate({
      where: { Project: { submissionId: id } },
      _sum: { fileSize: true },
    });

    const classIds = (
      await prisma.taskAssignment.findMany({
        where: { taskId: auth.sub!.SubProject.task.id },
        select: { classId: true },
      })
    ).map((a) => a.classId);
    const classStudentCount = await prisma.user.count({
      where: { classId: { in: classIds }, role: "STUDENT" },
    });

    const result = items.map((it) => ({
      id: it.id,
      studentId: it.studentId,
      // 下架的项目不显示学生姓名
      studentName: it.hidden ? "***" : it.User.name,
      title: it.title,
      description: it.description,
      pinned: it.pinned,
      hidden: it.hidden,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      attachment: it.attachments[0]
        ? {
            id: it.attachments[0].id,
            originalName: it.attachments[0].originalName,
            fileType: it.attachments[0].fileType,
            fileSize: it.attachments[0].fileSize,
          }
        : null,
      likeCount: it._count.likes,
      likedByMe: it.likes.length > 0,
    }));

    return NextResponse.json({
      submission: auth.sub,
      total,
      pageSize,
      page,
      totalPages: Math.ceil(total / pageSize),
      totalSize: sizeAgg._sum.fileSize || 0,
      items: result,
    });
  } catch (error) {
    console.error("查看项目任务失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}

// PUT: 教师编辑任务（不影响已提交学生项目）
export async function PUT(
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

    const auth = await authorizeTeacher(id, String(payload.userId));
    if (auth.error) return new Response(auth.error, { status: auth.status });

    const body = await req.json();
    const { title, description, category, visibleToClass, allowLike, fileSizeLimit, enabled } = body;

    const updateData: any = {};
    if (title !== undefined) updateData.title = String(title).trim();
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) {
      if (!["TEXT", "IMAGE", "VIDEO"].includes(category))
        return new Response("项目类别无效", { status: 400 });
      updateData.category = category;
    }
    if (visibleToClass !== undefined) updateData.visibleToClass = !!visibleToClass;
    if (allowLike !== undefined) {
      updateData.allowLike = !!allowLike;
      if (allowLike) updateData.visibleToClass = true; // 点赞自动开可见
    }
    if (fileSizeLimit !== undefined) {
      const n = Number(fileSizeLimit);
      updateData.fileSizeLimit = Number.isFinite(n) && n > 0 ? n : 10;
    }
    if (enabled !== undefined) updateData.enabled = !!enabled;

    const updated = await dbWrite(() =>
      prisma.projectSubmission.update({ where: { id }, data: updateData })
    );
    return NextResponse.json(updated);
  } catch (error) {
    console.error("编辑项目任务失败:", error);
    return new Response("编辑失败", { status: 500 });
  }
}

// DELETE: 教师删除任务（级联删所有学生提交 + 物理删附件）
export async function DELETE(
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

    const auth = await authorizeTeacher(id, String(payload.userId));
    if (auth.error) return new Response(auth.error, { status: auth.status });

    // 收集所有附件文件名用于物理删除
    const attachments = await prisma.projectAttachment.findMany({
      where: { Project: { submissionId: id } },
      select: { storedName: true },
    });

    await dbWrite(() =>
      prisma.projectSubmission.delete({ where: { id } })
    );

    // 物理删除文件
    attachments.forEach((a) => deleteAttachmentFile(a.storedName));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除项目任务失败:", error);
    return new Response("删除失败", { status: 500 });
  }
}
