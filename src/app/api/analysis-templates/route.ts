import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

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
    });

    // 按类型分组
    const studentTemplates = templates.filter((t) => t.type === "student");
    const classTemplates = templates.filter((t) => t.type === "class");
    const conversationTemplates = templates.filter((t) => t.type === "conversation");
    const quizDesignTemplates = templates.filter((t) => t.type === "QUIZ_DESIGN");
    const quizAnalysisTemplates = templates.filter((t) => t.type === "QUIZ_ANALYSIS");
    const explorationAnalysisTemplates = templates.filter((t) => t.type === "EXPLORATION_ANALYSIS");

    return NextResponse.json({
      studentTemplates,
      classTemplates,
      conversationTemplates,
      quizDesignTemplates,
      quizAnalysisTemplates,
      explorationAnalysisTemplates,
      all: templates,
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
