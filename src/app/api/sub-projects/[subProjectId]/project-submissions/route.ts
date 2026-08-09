import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { dbWrite } from "@/lib/db-queue";
import { validateFile, saveUploadedFile } from "@/lib/project-submit";

// GET: 教师获取某学习活动下的所有项目提交任务
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ subProjectId: string }> }
) {
  try {
    const { subProjectId } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return new Response("无权限", { status: 403 });

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: { task: { select: { teacherId: true } } },
    });
    if (!sp) return new Response("学习活动不存在", { status: 404 });
    if (sp.task.teacherId !== String(payload.userId))
      return new Response("无权限", { status: 403 });

    const list = await prisma.projectSubmission.findMany({
      where: { subProjectId },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(list);
  } catch (error) {
    console.error("查询项目任务失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}

// POST: 教师新建项目提交任务（可带初始示例文件，非必需）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ subProjectId: string }> }
) {
  try {
    const { subProjectId } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return new Response("无权限", { status: 403 });

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: { task: { select: { teacherId: true, grade: true, subject: true } } },
    });
    if (!sp) return new Response("学习活动不存在", { status: 404 });
    if (sp.task.teacherId !== String(payload.userId))
      return new Response("无权限", { status: 403 });

    // 优先 JSON，回退 formData（兼容两种调用方式）
    let body: Record<string, any>;
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await req.json();
    } else {
      const formData = await req.formData();
      body = {
        title: formData.get("title"),
        description: formData.get("description"),
        category: formData.get("category"),
        visibleToClass: formData.get("visibleToClass"),
        allowLike: formData.get("allowLike"),
        fileSizeLimit: formData.get("fileSizeLimit"),
      };
    }
    const title = String(body.title ?? "").trim();
    const description = body.description ? String(body.description) : null;
    const category = String(body.category || "TEXT");
    const visibleToClass = body.visibleToClass === true || body.visibleToClass === "true";
    const allowLikeRaw = body.allowLike === true || body.allowLike === "true";
    const fileSizeLimitRaw = Number(body.fileSizeLimit);
    const fileSizeLimit = Number.isFinite(fileSizeLimitRaw) && fileSizeLimitRaw > 0 ? fileSizeLimitRaw : 10;

    if (!title) return new Response("请填写项目名称", { status: 400 });
    if (!["TEXT", "IMAGE", "VIDEO"].includes(category))
      return new Response("项目类别无效", { status: 400 });

    // 允许点赞 -> 自动开全班可见
    const allowLike = allowLikeRaw;
    const visible = allowLike ? true : visibleToClass;

    const created = await dbWrite(() =>
      prisma.projectSubmission.create({
        data: {
          subProjectId,
          title,
          description,
          category,
          visibleToClass: visible,
          allowLike,
          fileSizeLimit,
        },
      })
    );

    return NextResponse.json(created);
  } catch (error) {
    console.error("新建项目任务失败:", error);
    return new Response("新建失败", { status: 500 });
  }
}
