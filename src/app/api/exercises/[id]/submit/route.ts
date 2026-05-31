import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "STUDENT") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    const { userAnswer } = body;

    const exercise = await prisma.exercise.findUnique({ where: { id: params.id } });
    if (!exercise) {
      return NextResponse.json({ error: "题目不存在" }, { status: 404 });
    }

    const isCorrect = userAnswer.trim().toLowerCase() === exercise.answer.trim().toLowerCase();
    const score = isCorrect ? 100 : 0;

    const attempt = await prisma.exerciseAttempt.create({
      data: {
        exerciseId: params.id,
        userId: String(payload.userId),
        userAnswer,
        isCorrect,
        score,
      },
    });

    return NextResponse.json({ attempt, correctAnswer: exercise.answer, explanation: exercise.explanation });
  } catch (error) {
    console.error("Submit exercise error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
