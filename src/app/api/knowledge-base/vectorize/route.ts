import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// 知识库字符数上限
const MAX_CONTENT_LENGTH = 50000;

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    // 全量注入模式：仅标记为已索引，无需预计算分块
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "缺少 ID" }, { status: 400 });
    }

    let kb;
    try {
      kb = await prisma.knowledgeBase.findUnique({ where: { id } });
    } catch (e) {
      console.error("Prisma findUnique error:", e);
      return NextResponse.json(
        { error: "数据库查询失败：" + (e instanceof Error ? e.message : "未知错误") },
        { status: 500 }
      );
    }

    if (!kb || kb.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    if (!kb.content || !kb.content.trim()) {
      return NextResponse.json({ error: "知识库内容为空" }, { status: 400 });
    }

    // 检查字符数限制
    if (kb.content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({
        error: `知识库内容超出限制（${kb.content.length.toLocaleString()} / ${MAX_CONTENT_LENGTH.toLocaleString()} 字符），请精简内容后重试`,
      }, { status: 400 });
    }

    // 更新状态为已索引（全量注入不需要 vectorData）
    try {
      await prisma.knowledgeBase.update({
        where: { id },
        data: {
          status: "VECTORIZED",
          vectorData: null,
        },
      });
    } catch (e) {
      console.error("Prisma update error:", e);
      return NextResponse.json(
        { error: "数据库更新失败：" + (e instanceof Error ? e.message : "未知错误") },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      charCount: kb.content.length,
      method: "全量注入",
    });
  } catch (error) {
    console.error("Index knowledge base error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "索引构建失败" },
      { status: 500 }
    );
  }
}
