import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 获取教师的所有知识库
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const knowledgeBases = await prisma.knowledgeBase.findMany({
      where: { teacherId: String(payload.userId) },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(knowledgeBases);
  } catch (error) {
    console.error("Get knowledge bases error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST: 创建知识库（上传 MD 文件）
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const formData = await req.formData();
    const name = formData.get("name") as string;
    const file = formData.get("file") as File | null;

    if (!name) {
      return NextResponse.json({ error: "请填写知识库名称" }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: "请上传 MD 文件" }, { status: 400 });
    }

    // 读取文件内容
    const content = await file.text();
    if (!content.trim()) {
      return NextResponse.json({ error: "文件内容为空" }, { status: 400 });
    }
    if (content.length > 50000) {
      return NextResponse.json({
        error: `文件内容超出限制（${content.length.toLocaleString()} / 50,000 字符），请精简后重新上传`,
      }, { status: 400 });
    }

    const kb = await prisma.knowledgeBase.create({
      data: {
        name,
        content,
        filename: file.name,
        fileSize: file.size,
        teacherId: String(payload.userId),
        status: "VECTORIZED", // 全量注入模式，上传即可用
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(kb);
  } catch (error) {
    console.error("Create knowledge base error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT: 更新知识库（可重新上传文件）
export async function PUT(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const formData = await req.formData();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const file = formData.get("file") as File | null;

    if (!id || !name) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const existing = await prisma.knowledgeBase.findUnique({ where: { id } });
    if (!existing || existing.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const updateData: Record<string, unknown> = { name };

    if (file) {
      const content = await file.text();
      if (!content.trim()) {
        return NextResponse.json({ error: "文件内容为空" }, { status: 400 });
      }
      if (content.length > 50000) {
        return NextResponse.json({
          error: `文件内容超出限制（${content.length.toLocaleString()} / 50,000 字符），请精简后重新上传`,
        }, { status: 400 });
      }
      updateData.content = content;
      updateData.filename = file.name;
      updateData.fileSize = file.size;
      updateData.status = "VECTORIZED"; // 全量注入模式，更新即可用
      updateData.vectorData = null;
      updateData.updatedAt = new Date();
    }

    const kb = await prisma.knowledgeBase.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(kb);
  } catch (error) {
    console.error("Update knowledge base error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH: 切换知识库启用/禁用
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

    const existing = await prisma.knowledgeBase.findUnique({ where: { id } });
    if (!existing || existing.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const kb = await prisma.knowledgeBase.update({
      where: { id },
      data: { enabled },
    });

    return NextResponse.json(kb);
  } catch (error) {
    console.error("Toggle knowledge base error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE: 删除知识库
export async function DELETE(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少 ID" }, { status: 400 });
    }

    const existing = await prisma.knowledgeBase.findUnique({ where: { id } });
    if (!existing || existing.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    await prisma.knowledgeBase.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete knowledge base error:", error);
    const msg = error instanceof Error ? error.message : "服务器错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}