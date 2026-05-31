import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// POST: 学生提交探究成绩
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

    const studentId = String(payload.userId);

    const exploration = await prisma.explorationActivity.findFirst({
      where: { id, enabled: true },
    });
    if (!exploration) return new Response("探究不存在或未启用", { status: 404 });
    if (!exploration.enableSubmission) {
      return new Response("该探究未开启提交功能", { status: 400 });
    }

    // 接收注入脚本发送的全部字段
    const body = await req.json();
    const {
      timeSpent, interactions, scrollDepth, attempts,
      score, maxScore, completedSections, gameLevel,
      actionLog,
      taskTitle, studentName, className,
    } = body;

    const finalScore = typeof score === "number" ? score : 0;
    const finalMaxScore = typeof maxScore === "number" ? maxScore : 100;

    // 行为数据汇总（存 JSON，不含 actionLog）
    const extraData = {
      timeSpent: timeSpent ?? 0,
      interactions: interactions ?? 0,
      scrollDepth: scrollDepth ?? 0,
      attempts: attempts ?? 1,
      completedSections: completedSections ?? [],
      gameLevel: gameLevel ?? 1,
      taskTitle: taskTitle ?? "",
      studentName: studentName ?? "",
      className: className ?? "",
    };

    // actionLog 明细写入独立表
    const logs = Array.isArray(actionLog)
      ? actionLog.map((log: { type?: string; target?: string; value?: string; timestamp?: number }) => ({
          type: log.type ?? "click",
          target: log.target ?? "",
          value: log.value ?? "",
          timestamp: log.timestamp ?? Date.now(),
        }))
      : [];

    // 事务：创建/更新提交记录 + 写入操作日志
    const submission = await prisma.$transaction(async (tx) => {
      // 查找已有提交
      const existing = await tx.explorationSubmission.findUnique({
        where: { explorationId_studentId: { explorationId: id, studentId } },
      });

      let sub;
      if (existing) {
        // 更新已有提交
        sub = await tx.explorationSubmission.update({
          where: { id: existing.id },
          data: {
            score: finalScore,
            totalScore: finalMaxScore,
            status: "graded",
            gradedAt: new Date(),
            answers: JSON.stringify(extraData),
          },
        });
        // 删除旧日志，重新写入
        await tx.explorationActionLog.deleteMany({ where: { submissionId: existing.id } });
      } else {
        // 创建新提交
        sub = await tx.explorationSubmission.create({
          data: {
            explorationId: id,
            studentId,
            score: finalScore,
            totalScore: finalMaxScore,
            status: "graded",
            gradedAt: new Date(),
            answers: JSON.stringify(extraData),
          },
        });
      }

      // 写入操作日志
      if (logs.length > 0) {
        await tx.explorationActionLog.createMany({
          data: logs.map((log) => ({
            submissionId: sub.id,
            type: log.type,
            target: log.target,
            value: log.value,
            timestamp: log.timestamp,
          })),
        });
      }

      return sub;
    });

    return NextResponse.json({
      submissionId: submission.id,
      score: finalScore,
      maxScore: finalMaxScore,
      status: "graded",
      submittedAt: submission.submittedAt,
    });
  } catch (error: any) {
    console.error("提交探究成绩失败:", error);
    return new Response(error?.message || "提交失败", { status: 500 });
  }
}

// GET: 获取学生自己的提交状态
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

    const studentId = String(payload.userId);

    const submission = await prisma.explorationSubmission.findUnique({
      where: { explorationId_studentId: { explorationId: id, studentId } },
    });

    if (!submission) return NextResponse.json(null);

    return NextResponse.json({
      submissionId: submission.id,
      score: submission.score,
      maxScore: submission.totalScore,
      status: submission.status,
      submittedAt: submission.submittedAt,
    });
  } catch (error) {
    console.error("查询探究提交失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}