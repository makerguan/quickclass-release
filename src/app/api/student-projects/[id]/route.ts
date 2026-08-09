import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { dbWrite } from "@/lib/db-queue";
import { validateFile, saveUploadedFile, deleteAttachmentFile } from "@/lib/project-submit";

// 校验学生拥有该提交
async function authorizeStudent(projectId: string, studentId: string) {
  const p = await prisma.studentProject.findUnique({
    where: { id: projectId },
    include: {
      ProjectSubmission: { select: { category: true, fileSizeLimit: true } },
      attachments: true,
    },
  });
  if (!p) return { error: "提交不存在", status: 404 };
  if (p.studentId !== studentId) return { error: "无权限", status: 403 };
  return { p };
}

// GET: 查看自己的提交详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("无权限", { status: 403 });

    const p = await prisma.studentProject.findUnique({
      where: { id },
      include: {
        attachments: true,
        _count: { select: { likes: true } },
        ProjectSubmission: { select: { visibleToClass: true, allowLike: true } },
      },
    });
    if (!p) return new Response("提交不存在", { status: 404 });

    // 本人可见；全班可见时同班学生可见；教师可见（由教师端另查，这里宽松）
    return NextResponse.json({
      id: p.id,
      title: p.title,
      description: p.description,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      submissionId: p.submissionId,
      attachment: p.attachments[0]
        ? {
            id: p.attachments[0].id,
            originalName: p.attachments[0].originalName,
            fileType: p.attachments[0].fileType,
            fileSize: p.attachments[0].fileSize,
          }
        : null,
      likeCount: p._count.likes,
      allowLike: p.ProjectSubmission.allowLike,
    });
  } catch (error) {
    console.error("查看提交失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}

// PUT: 学生编辑（标题/说明，可替换附件）
export async function PUT(
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

    const auth = await authorizeStudent(id, String(payload.userId));
    if (auth.error) return new Response(auth.error, { status: auth.status });

    const formData = await req.formData();
    const title = (formData.get("title") as string)?.trim();
    const description = (formData.get("description") as string) || null;
    const file = formData.get("file") as File | null;

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;

    // 若上传新文件，校验并替换
    let oldStored: string | null = null;
    if (file && file.size > 0) {
      const errMsg = validateFile(file, auth.p!.ProjectSubmission.category, auth.p!.ProjectSubmission.fileSizeLimit);
      if (errMsg) return new Response(errMsg, { status: 400 });
      const saved = await saveUploadedFile(file);
      oldStored = auth.p!.attachments[0]?.storedName || null;
      updateData.attachments = {
        upsert: {
          create: {
            originalName: saved.originalName,
            storedName: saved.storedName,
            fileType: saved.fileType,
            fileSize: saved.fileSize,
          },
          update: {
            originalName: saved.originalName,
            storedName: saved.storedName,
            fileType: saved.fileType,
            fileSize: saved.fileSize,
          },
        },
      };
    }

    const updated = await dbWrite(() =>
      prisma.studentProject.update({ where: { id }, data: updateData })
    );

    if (oldStored) deleteAttachmentFile(oldStored);

    return NextResponse.json(updated);
  } catch (error) {
    console.error("编辑提交失败:", error);
    return new Response("编辑失败", { status: 500 });
  }
}

// DELETE: 学生删除自己的提交（级联删附件 + 物理文件）
export async function DELETE(
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

    const auth = await authorizeStudent(id, String(payload.userId));
    if (auth.error) return new Response(auth.error, { status: auth.status });

    const stored = auth.p!.attachments[0]?.storedName || null;

    await dbWrite(() => prisma.studentProject.delete({ where: { id } }));
    if (stored) deleteAttachmentFile(stored);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除提交失败:", error);
    return new Response("删除失败", { status: 500 });
  }
}
