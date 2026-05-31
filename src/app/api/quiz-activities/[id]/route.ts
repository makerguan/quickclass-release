import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const role = String(payload.role || "");
    const where: any = { id };
    if (role === "TEACHER") {
      where.SubProject = { task: { teacherId: String(payload.userId) } };
    }

    // 先查 quiz 本身
    const quiz = await prisma.quizActivity.findFirst({ where });

    if (!quiz) return new Response("作业不存在", { status: 404 });

    // 分别查询关联数据，避免 Prisma 嵌套 include 问题
    const [subProject, quizDesignTemplate, questions, count] = await Promise.all([
      prisma.subProject.findFirst({
        where: { id: quiz.subProjectId },
        select: { id: true, title: true, task: { select: { id: true, title: true, grade: true, subject: true, objectives: true, knowledgeBase: true, knowledgeBaseIds: true } } },
      }),
      quiz.quizDesignTemplateId ? prisma.analysisTemplate.findUnique({
        where: { id: quiz.quizDesignTemplateId },
        select: { id: true, name: true, content: true },
      }) : null,
      prisma.question.findMany({
        where: { quizActivityId: id },
        select: { id: true, type: true, content: true, options: true, answer: true, difficulty: true, score: true, explanation: true, order: true },
        orderBy: { order: "asc" },
      }),
      prisma.quizAttempt.count({ where: { quizActivityId: id } }),
    ]);

    return NextResponse.json({ ...quiz, SubProject: subProject, quizDesignTemplate, questions, _count: { attempts: count } });
  } catch (error) {
    console.error("查询作业详情失败:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response("查询失败: " + message, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const quiz = await prisma.quizActivity.findFirst({
      where: { id, SubProject: { task: { teacherId: String(payload.userId) } } },
    });
    if (!quiz) return new Response("作业不存在", { status: 404 });

    const body = await req.json();
    const updated = await prisma.quizActivity.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        quizDesignTemplateId: body.quizDesignTemplateId,
        analysisPrompt: body.analysisPrompt,
        // 保存后强制变为失效状态
        status: "INACTIVE",
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("更新作业失败:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response("更新失败: " + message, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const quiz = await prisma.quizActivity.findFirst({
      where: { id, SubProject: { task: { teacherId: String(payload.userId) } } },
    });
    if (!quiz) return new Response("作业不存在", { status: 404 });

    await prisma.quizActivity.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除作业失败:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response("删除失败: " + message, { status: 500 });
  }
}