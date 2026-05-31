import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 获取某个探究的所有提交记录
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

    const submissions = await prisma.explorationSubmission.findMany({
      where: { explorationId: id },
      orderBy: { submittedAt: "desc" },
      include: { ExplorationActionLog: { orderBy: { timestamp: "asc" } } },
    });

    // 获取学生姓名
    const studentIds = [...new Set(submissions.map(s => s.studentId))];
    const students = await prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true },
    });
    const studentNameMap = new Map(students.map(u => [u.id, u.name]));

    const result = submissions.map((s) => ({
      id: s.id,
      studentId: s.studentId,
      studentName: studentNameMap.get(s.studentId) || s.studentId,
      answers: s.answers,
      score: s.score,
      totalScore: s.totalScore,
      submittedAt: s.submittedAt,
      actionLogs: s.ExplorationActionLog.map((log) => ({
        type: log.type,
        timestamp: log.timestamp,
      })),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("查询提交记录失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}