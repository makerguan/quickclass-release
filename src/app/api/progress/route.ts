import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

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
    const userId = searchParams.get("userId") || payload.userId;
    const classId = searchParams.get("classId");

    if (payload.role === "STUDENT" && userId !== payload.userId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const baseWhere: Record<string, string> = { userId: String(userId) };
    if (classId) baseWhere.classId = classId;

    const [progress, attempts, evaluations, conversations] = await Promise.all([
      prisma.learningProgress.findMany({ where: baseWhere, orderBy: { lastStudiedAt: "desc" } }),
      prisma.exerciseAttempt.findMany({
        where: { userId: String(userId) },
        include: { Exercise: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.evaluation.findMany({ where: baseWhere, orderBy: { createdAt: "desc" } }),
      prisma.conversation.findMany({
        where: { userId: String(userId) },
        include: { Message: { take: 1 } },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
    ]);

    const totalAttempts = attempts.length;
    const correctAttempts = attempts.filter((a) => a.isCorrect).length;
    const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0;

    return NextResponse.json({
      progress,
      attempts,
      evaluations,
      conversations,
      stats: {
        totalAttempts,
        correctAttempts,
        accuracy,
        conversationCount: conversations.length,
      },
    });
  } catch (error) {
    console.error("Get progress error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
