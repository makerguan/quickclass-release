import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { dbWrite } from "@/lib/db-queue";
import { validateFile, saveUploadedFile } from "@/lib/project-submit";

// 校验学生能否访问该任务（任务所属学习活动 + 学生在该任务关联班级内）
async function getSubmissionForStudent(submissionId: string, studentId: string) {
  const sub = await prisma.projectSubmission.findUnique({
    where: { id: submissionId },
    include: {
      SubProject: { include: { task: { select: { id: true } } } },
    },
  });
  if (!sub) return { error: "项目任务不存在", status: 404 };
  if (!sub.enabled) return { error: "该任务已关闭提交", status: 403 };
  const user = await prisma.user.findUnique({
    where: { id: studentId },
    select: { classId: true },
  });
  if (!user || !user.classId) return { error: "无法确认班级", status: 403 };
  const assignment = await prisma.taskAssignment.findFirst({
    where: { taskId: sub.SubProject.task.id, classId: user.classId },
  });
  if (!assignment) return { error: "无权限", status: 403 };
  return { sub, user };
}

// GET: 学生查看自己在该任务下的提交
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
      include: { SubProject: { include: { task: { select: { id: true } } } } },
    });
    if (!sub) return new Response("项目任务不存在", { status: 404 });

    const mine = await prisma.studentProject.findUnique({
      where: { submissionId_studentId: { submissionId: id, studentId: String(payload.userId) } },
      include: { attachments: true, _count: { select: { likes: true } } },
    });

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
      mine: mine
        ? {
            id: mine.id,
            title: mine.title,
            description: mine.description,
            pinned: mine.pinned,
            hidden: mine.hidden,
            createdAt: mine.createdAt,
            updatedAt: mine.updatedAt,
            attachment: mine.attachments[0]
              ? {
                  id: mine.attachments[0].id,
                  originalName: mine.attachments[0].originalName,
                  fileType: mine.attachments[0].fileType,
                  fileSize: mine.attachments[0].fileSize,
                }
              : null,
            likeCount: mine._count.likes,
          }
        : null,
    });
  } catch (error) {
    console.error("查询我的提交失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}

// POST: 学生提交（单文件附件）
export async function POST(
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

    const access = await getSubmissionForStudent(id, String(payload.userId));
    if ((access as any).error) return new Response((access as any).error, { status: (access as any).status });

    const sub = (access as any).sub;
    const studentId = String(payload.userId);
    const classId = (access as any).user.classId;

    // 已提交则不允许重复 POST（用 PUT 编辑）
    const existing = await prisma.studentProject.findUnique({
      where: { submissionId_studentId: { submissionId: id, studentId } },
    });
    if (existing) return new Response("你已提交，请使用编辑", { status: 409 });

    const formData = await req.formData();
    const title = (formData.get("title") as string)?.trim();
    const description = (formData.get("description") as string) || null;
    const file = formData.get("file") as File | null;

    if (!title) return new Response("请填写项目标题", { status: 400 });
    if (!file) return new Response("请上传文件", { status: 400 });

    const errMsg = validateFile(file, sub.category, sub.fileSizeLimit);
    if (errMsg) return new Response(errMsg, { status: 400 });

    const saved = await saveUploadedFile(file);

    const created = await dbWrite(() =>
      prisma.studentProject.create({
        data: {
          submissionId: id,
          studentId,
          classId,
          title,
          description,
          attachments: {
            create: {
              originalName: saved.originalName,
              storedName: saved.storedName,
              fileType: saved.fileType,
              fileSize: saved.fileSize,
            },
          },
        },
        include: { attachments: true },
      })
    );

    return NextResponse.json(created);
  } catch (error) {
    console.error("提交项目失败:", error);
    return new Response("提交失败", { status: 500 });
  }
}
