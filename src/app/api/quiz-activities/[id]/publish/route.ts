import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function POST(
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
      include: { Question: { select: { id: true } } },
    });
    if (!quiz) return new Response("作业不存在", { status: 404 });
    if (quiz.Question.length === 0) {
      return new Response("请先添加题目，再生效作业", { status: 400 });
    }

    const updated = await prisma.quizActivity.update({
      where: { id },
      data: { status: "ACTIVE" },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("生效作业失败:", error);
    const message = error instanceof Error ? error.message : "生效失败";
    return new Response(message, { status: 500 });
  }
}
