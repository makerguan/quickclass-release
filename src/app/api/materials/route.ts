import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { chunkText } from "@/lib/chunker";
import { dbWrite } from "@/lib/db-queue";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");

    if (!classId) {
      return NextResponse.json({ error: "缺少 classId" }, { status: 400 });
    }

    const materials = await prisma.material.findMany({
      where: { classId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(materials);
  } catch (error) {
    console.error("Get materials error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    const { classId, type, filename, originalName, fileType, fileSize, content } = body;

    // 创建材料记录（写操作走队列，避免 SQLite 文件锁冲突）
    const material = await dbWrite(() =>
      prisma.material.create({
        data: {
          classId,
          teacherId: String(payload.userId),
          type,
          filename,
          originalName,
          fileType,
          fileSize,
          content,
          status: "READY",
        },
      })
    );

    // 如果有文本内容，自动分块存储（全量注入模式，无需计算向量）
    if (content && typeof content === "string" && content.trim().length > 0) {
      try {
        const chunks = chunkText(content, { chunkSize: 600, overlap: 100 });

        await dbWrite(() =>
          prisma.documentChunk.createMany({
            data: chunks.map((chunkText) => ({
              materialId: material.id,
              content: chunkText,
            })),
          })
        );
      } catch (chunkError) {
        console.error("Chunk creation error:", chunkError);
        // 分块失败不影响材料创建
      }
    }

    return NextResponse.json(material);
  } catch (error) {
    console.error("Create material error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
