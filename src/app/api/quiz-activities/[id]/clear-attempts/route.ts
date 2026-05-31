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
    });
    if (!quiz) return new Response("作业不存在", { status: 404 });

    // 删除答题记录（QuestionAttempt 通过 onDelete: Cascade 自动删除）
    const deleted = await prisma.quizAttempt.deleteMany({ where: { quizActivityId: id } });

    return NextResponse.json({ success: true, deletedCount: deleted.count });
  } catch (error: any) {
    console.error("清除答题记录失败:", error);
    return NextResponse.json({ error: error?.message || "清除失败" }, { status: 500 });
  }
}