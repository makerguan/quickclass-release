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

    const quiz = await prisma.quizActivity.findFirst({
      where: { id, SubProject: { task: { teacherId: String(payload.userId) } } },
      include: { Question: { orderBy: { order: "asc" } } },
    });
    if (!quiz) return new Response("作业不存在", { status: 404 });

    return NextResponse.json(quiz.Question);
  } catch {
    return new Response("查询失败", { status: 500 });
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

    // 有学生提交时禁止修改题目
    const attemptCount = await prisma.quizAttempt.count({ where: { quizActivityId: id } });
    if (attemptCount > 0) {
      return NextResponse.json({ error: "已有学生提交作业，无法修改题目。请先清空答题记录。" }, { status: 403 });
    }

    const { questions } = await req.json();
    if (!Array.isArray(questions)) {
      return new Response("题目数据格式错误", { status: 400 });
    }

    // 删除旧题目（同时清除关联的学生答题记录和报告）
    await prisma.quizAttempt.deleteMany({ where: { quizActivityId: id } });
    await prisma.question.deleteMany({ where: { quizActivityId: id } });

    // 写入新题目
    const totalScore = questions.reduce((sum: number, q: any) => sum + (q.score || 0), 100 / questions.length);
    const created = await Promise.all(
      questions.map((q: any, idx: number) =>
        prisma.question.create({
          data: {
            quizActivityId: id,
            type: q.type || "SINGLE_CHOICE",
            content: q.content,
            options: q.type === "TRUE_FALSE" || q.type === "JUDGEMENT"
              ? "{}"
              : (typeof q.options === "string" ? q.options : JSON.stringify(q.options || {})),
            answer: q.answer || "A",
            score: q.score || 0,
            difficulty: q.difficulty || "BASIC",
            explanation: q.explanation || null,
            order: idx,
          },
        })
      )
    );

    // 保存题目后强制变为失效状态（保护学生端数据一致性）
    await prisma.quizActivity.update({
      where: { id },
      data: { status: "INACTIVE" },
    });

    return NextResponse.json({ questions: created, count: created.length });
  } catch (error: any) {
    console.error("保存题目失败:", error);
    const message = error?.message || "保存失败";
    return NextResponse.json({ message }, { status: 500 });
  }
}