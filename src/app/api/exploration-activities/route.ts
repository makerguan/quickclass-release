import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const { searchParams } = new URL(req.url);
    const subProjectId = searchParams.get("subProjectId");
    if (!subProjectId) return new Response("缺少 subProjectId", { status: 400 });

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: { task: true },
    });
    if (!sp || sp.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    const items = await prisma.explorationActivity.findMany({
      where: { subProjectId },
      orderBy: [{ enabled: "desc" }, { sortOrder: "asc" }],
      include: { _count: { select: { ExplorationSubmission: true } } },
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error(error);
    return new Response("查询失败", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const body = await req.json();
    const { subProjectId, title, description, htmlContent, enableSubmission, designPrompt, analysisPrompt } = body;

    if (!subProjectId || !title?.trim()) {
      return new Response("缺少必填字段", { status: 400 });
    }

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: { task: true },
    });
    if (!sp || sp.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    const maxOrder = await prisma.explorationActivity.aggregate({
      where: { subProjectId },
      _max: { sortOrder: true },
    });

    const item = await prisma.explorationActivity.create({
      data: {
        subProjectId,
        title: title.trim(),
        description: description || "",
        htmlContent: htmlContent || "",
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        enabled: true,
        enableSubmission: enableSubmission || false,
        designPrompt: designPrompt || null,
        analysisPrompt: analysisPrompt || null,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error(error);
    return new Response("创建失败", { status: 500 });
  }
}
