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

// GET: 获取某个学生的提交详情（教师或提交本人）
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
      include: {
        ExplorationActivity: {
          select: {
            id: true,
            title: true,
            enabled: true,
            enableAiCompanion: true,
            SubProject: { select: { task: { select: { teacherId: true } } } },
          },
        },
      },
    });
    if (!submission || submission.explorationId !== id) {
      return new Response("提交记录不存在", { status: 404 });
    }

    // 鉴权：教师必须是该课堂所有者；学生只能看自己
    const taskTeacherId = submission.ExplorationActivity?.SubProject?.task?.teacherId;
    const role = String(payload.role || "").toUpperCase();
    if (role === "TEACHER" || role === "ADMIN") {
      if (taskTeacherId !== String(payload.userId)) {
        return new Response("无权限", { status: 403 });
      }
    } else if (role === "STUDENT") {
      if (submission.studentId !== String(payload.userId)) {
        return new Response("无权限", { status: 403 });
      }
    } else {
      return new Response("无权限", { status: 403 });
    }

    // 不再透传 htmlContent（详情页不需要 iframe 渲染；同时彻底规避升级盲区与泄露）
    const { ExplorationActivity, ...safe } = submission;
    const liteExploration = ExplorationActivity
      ? {
          id: ExplorationActivity.id,
          title: ExplorationActivity.title,
          enabled: ExplorationActivity.enabled,
          enableAiCompanion: ExplorationActivity.enableAiCompanion,
        }
      : null;

    return NextResponse.json({ ...safe, ExplorationActivity: liteExploration });
  } catch (error) {
    console.error("查询提交详情失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}