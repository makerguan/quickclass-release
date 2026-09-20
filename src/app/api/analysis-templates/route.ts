import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { hashTemplateContent } from "@/lib/template-preview/generate";
import { PREVIEW_SAMPLE_VER } from "@/lib/template-preview/samples";

// GET /api/analysis-templates - 获取教师的所有模板
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const templates = await prisma.analysisTemplate.findMany({
      where: {
        OR: [
          { teacherId: String(payload.userId) },
          { teacherId: null },
        ],
      },
      orderBy: [{ type: "asc" }, { isDefault: "desc" }, { createdAt: "desc" }],
      // 只取预览的"状态字段"，不取预览正文（正文可能很大，列表接口要保持轻量）
      include: {
        preview: { select: { contentHash: true, sampleVer: true, generatedAt: true } },
      },
    });

    // 给模板附上预览状态：hasPreview=已生成过；previewStale=模板内容已改或示例数据已升级
    const withPreviewState = templates.map((t) => {
      const { preview, ...rest } = t;
      return {
        ...rest,
        hasPreview: !!preview,
        previewStale: preview
          ? preview.contentHash !== hashTemplateContent(t.content) || preview.sampleVer !== PREVIEW_SAMPLE_VER
          : false,
        previewAt: preview?.generatedAt ?? null,
      };
    });

    // 按类型分组
    const studentTemplates = withPreviewState.filter((t) => t.type === "student");
    const classTemplates = withPreviewState.filter((t) => t.type === "class");
    const conversationTemplates = withPreviewState.filter((t) => t.type === "conversation");
    const quizDesignTemplates = withPreviewState.filter((t) => t.type === "QUIZ_DESIGN");
    const quizAnalysisTemplates = withPreviewState.filter((t) => t.type === "QUIZ_ANALYSIS");
    const explorationAnalysisTemplates = withPreviewState.filter((t) => t.type === "EXPLORATION_ANALYSIS");

    return NextResponse.json({
      studentTemplates,
      classTemplates,
      conversationTemplates,
      quizDesignTemplates,
      quizAnalysisTemplates,
      explorationAnalysisTemplates,
      all: withPreviewState,
    });
  } catch (error) {
    console.error("Get templates error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// POST /api/analysis-templates - 创建模板
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
    const { type, name, content, isDefault } = body;

    if (!type || !name || !content) {
      return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
    }

    if (!["student", "class", "conversation", "QUIZ_DESIGN", "QUIZ_ANALYSIS", "EXPLORATION_ANALYSIS"].includes(type)) {
      return NextResponse.json({ error: "类型不合法" }, { status: 400 });
    }

    // 如果设为默认，先取消同类型的其他默认
    if (isDefault) {
      await prisma.analysisTemplate.updateMany({
        where: { teacherId: String(payload.userId), type },
        data: { isDefault: false },
      });
    }

    const template = await prisma.analysisTemplate.create({
      data: {
        teacherId: String(payload.userId),
        type,
        name,
        content,
        isDefault: isDefault || false,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    console.error("Create template error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
