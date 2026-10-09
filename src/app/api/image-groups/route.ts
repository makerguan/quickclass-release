import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { deleteGroupDir } from "@/lib/image-library";

// GET: 教师的所有图片组（含组内图片 + 被引用课堂）
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const groups = await prisma.imageGroup.findMany({
      where: { teacherId: String(payload.userId) },
      include: { images: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
    });

    // 反查课堂引用（对齐知识库的 referencedBy）
    const referencedByMap: Record<string, { id: string; title: string }[]> = {};
    try {
      const tasks = await prisma.learningTask.findMany({
        where: { teacherId: String(payload.userId) },
        select: { id: true, title: true, imageGroupIds: true },
      });
      for (const task of tasks) {
        if (!task.imageGroupIds) continue;
        let ids: string[] = [];
        try {
          const parsed = JSON.parse(task.imageGroupIds);
          if (Array.isArray(parsed)) ids = parsed.map(String);
        } catch {
          continue;
        }
        for (const gid of ids) {
          if (!referencedByMap[gid]) referencedByMap[gid] = [];
          referencedByMap[gid].push({ id: task.id, title: task.title });
        }
      }
    } catch (err) {
      console.error("Build imageGroup referencedBy map error:", err);
    }

    return NextResponse.json(
      groups.map((g) => ({ ...g, referencedBy: referencedByMap[g.id] || [] }))
    );
  } catch (error) {
    console.error("Get image groups error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST: 创建图片组
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { name, description } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "请填写图片组名称" }, { status: 400 });
    }

    const group = await prisma.imageGroup.create({
      data: {
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        teacherId: String(payload.userId),
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(group);
  } catch (error) {
    console.error("Create image group error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT: 更新图片组名称/描述
export async function PUT(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id, name, description } = await req.json();
    if (!id || !name || !String(name).trim()) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const existing = await prisma.imageGroup.findUnique({ where: { id } });
    if (!existing || existing.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const group = await prisma.imageGroup.update({
      where: { id },
      data: {
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(group);
  } catch (error) {
    console.error("Update image group error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH: 启用/禁用图片组
export async function PATCH(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id, enabled } = await req.json();
    if (!id || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const existing = await prisma.imageGroup.findUnique({ where: { id } });
    if (!existing || existing.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const group = await prisma.imageGroup.update({
      where: { id },
      data: { enabled, updatedAt: new Date() },
    });
    return NextResponse.json(group);
  } catch (error) {
    console.error("Toggle image group error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE: 删除图片组（级联删图片记录 + 物理目录）
export async function DELETE(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少 ID" }, { status: 400 });

    const existing = await prisma.imageGroup.findUnique({ where: { id } });
    if (!existing || existing.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    await prisma.imageGroup.delete({ where: { id } });
    deleteGroupDir(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete image group error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
