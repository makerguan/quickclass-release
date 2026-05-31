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
    const classId = searchParams.get("classId");

    if (!classId) {
      return NextResponse.json({ error: "缺少 classId" }, { status: 400 });
    }

    const exercises = await prisma.exercise.findMany({
      where: { classId },
      orderBy: { createdAt: "desc" },
    });

    if (payload.role === "STUDENT") {
      const attempts = await prisma.exerciseAttempt.findMany({
        where: { userId: String(payload.userId), exerciseId: { in: exercises.map((e) => e.id) } },
      });
      const attemptMap = new Map(attempts.map((a) => [a.exerciseId, a]));
      return NextResponse.json(
        exercises.map((e) => ({
          ...e,
          userAttempt: attemptMap.get(e.id) || null,
        }))
      );
    }

    return NextResponse.json(exercises);
  } catch (error) {
    console.error("Get exercises error:", error);
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
    const { classId, materialId, question, options, answer, type, difficulty, sourceContent, explanation } = body;

    const exercise = await prisma.exercise.create({
      data: {
        classId,
        materialId,
        question,
        options,
        answer,
        type,
        difficulty,
        sourceContent,
        explanation,
      },
    });

    return NextResponse.json(exercise);
  } catch (error) {
    console.error("Create exercise error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
