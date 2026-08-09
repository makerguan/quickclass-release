import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import fs from "fs";
import path from "path";
import { UPLOAD_DIR } from "@/lib/project-submit";

// GET: 下载/预览附件。权限：本人 / 本班教师 / （任务全班可见时同班学生）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> }
) {
  try {
    const { id, aid } = await params;
    // 支持 URL 参数 token（用于 <img> 标签直接加载场景）
    const url = new URL(req.url);
    const token = req.headers.get("authorization")?.replace("Bearer ", "") || url.searchParams.get("token") || "";
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("无权限", { status: 403 });

    const project = await prisma.studentProject.findUnique({
      where: { id },
      include: {
        attachments: { where: { id: aid } },
        ProjectSubmission: {
          include: { SubProject: { include: { task: { select: { id: true, teacherId: true } } } } },
        },
        User: { select: { classId: true } },
      },
    });
    if (!project || project.attachments.length === 0)
      return new Response("附件不存在", { status: 404 });

    const att = project.attachments[0];
    const isOwner = project.studentId === String(payload.userId);
    const isTeacher = payload.role === "TEACHER" && project.ProjectSubmission.SubProject.task.teacherId === String(payload.userId);
    // 同班学生 + 任务全班可见
    const me = await prisma.user.findUnique({ where: { id: String(payload.userId) }, select: { classId: true } });
    const taskClassIds = (
      await prisma.taskAssignment.findMany({
        where: { taskId: project.ProjectSubmission.SubProject.task.id },
        select: { classId: true },
      })
    ).map((a) => a.classId);
    const sameClassVisible =
      payload.role === "STUDENT" &&
      project.ProjectSubmission.visibleToClass &&
      !!me?.classId &&
      me.classId === project.User.classId &&
      taskClassIds.includes(me.classId);

    if (!isOwner && !isTeacher && !sameClassVisible)
      return new Response("无权限", { status: 403 });

    const filePath = path.join(UPLOAD_DIR, att.storedName);
    if (!fs.existsSync(filePath)) return new Response("文件已丢失", { status: 404 });

    const data = fs.readFileSync(filePath);
    const mimeMap: Record<string, string> = {
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      txt: "text/plain",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      mkv: "video/x-matroska",
    };
    const mime = mimeMap[att.fileType] || "application/octet-stream";
    // 支持 inline 预览参数
    const forceInline = url.searchParams.get("inline") === "1";
    const previewTypes = ["jpg", "jpeg", "png", "gif", "webp", "svg", "mp4", "webm", "mov", "avi", "mkv", "pdf", "txt", "csv", "mp3", "wav", "ogg"];
    const disposition = forceInline || previewTypes.includes(att.fileType)
      ? "inline"
      : `attachment; filename*=UTF-8''${encodeURIComponent(att.originalName)}`;

    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": disposition,
        "Content-Length": String(data.length),
      },
    });
  } catch (error) {
    console.error("下载附件失败:", error);
    return new Response("下载失败", { status: 500 });
  }
}
