import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// PATCH: 教师复审（修改某题分数和评语）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const { id, sid } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    // 验证教师权限
    const exploration = await prisma.explorationActivity.findFirst({
      where: { id },
      include: {
        SubProject: { select: { task: { select: { teacherId: true } } } },
      },
    });
    if (!exploration) return new Response("探究不存在", { status: 404 });
    if (exploration.SubProject.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    const submission = await prisma.explorationSubmission.findUnique({
      where: { id: sid },
    });
    if (!submission || submission.explorationId !== id) {
      return new Response("提交记录不存在", { status: 404 });
    }

    const { answers, finalScore } = await req.json();

    await prisma.explorationSubmission.update({
      where: { id: sid },
      data: {
        answers: JSON.stringify(answers),
        score: finalScore,
        status: "graded",
        gradedAt: new Date(),
      },
    });

    const updated = await prisma.explorationSubmission.findUnique({ where: { id: sid } });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("复审失败:", error);
    return new Response("复审失败", { status: 500 });
  }
}

// GET: 获取某个学生的提交详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const { id, sid } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const submission = await prisma.explorationSubmission.findUnique({
      where: { id: sid },
      include: { ExplorationActivity: true },
    });
    if (!submission || submission.explorationId !== id) {
      return new Response("提交记录不存在", { status: 404 });
    }

    return NextResponse.json(submission);
  } catch (error) {
    console.error("查询提交详情失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}