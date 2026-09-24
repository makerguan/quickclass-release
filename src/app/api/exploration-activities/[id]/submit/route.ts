import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { writeCollectedAnswers } from "@/lib/exploration/qf-binding";

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
      // QuickForm 采集块带上来的学生答案（没有采集块时为空）
      answers,
      // 双轨采集新增：契约轨明细 + 兜底采集
      gameState, scoreInferred,
      canvasSnapshots, storageSnapshot, textSnapshot,
    } = body;

    // 无评分页面（采集类别 hasScoring=false）注入脚本上报 score=null，这里原样存 null，
    // 老师端按 collectProfile 隐藏分数维度，不再把「无评分」误记为 0 分。
    // ⛔ DO NOT REVERT：不要退回 `: 0`，否则无评分探究会被记为 0 分并进入平均分统计。
    const finalScore = typeof score === "number" ? score : null;
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
      // 契约轨明细（AI 挂载的 __gameState__ 原样存档，教师端展示用）
      gameState: gameState && typeof gameState === "object" && !Array.isArray(gameState) ? gameState : null,
      // 分数是否为正则推测值（非契约/函数上报）
      scoreInferred: scoreInferred === true,
      // 兜底采集：canvas 快照（每张限 500KB、最多 3 张）
      canvasSnapshots: Array.isArray(canvasSnapshots)
        ? canvasSnapshots.filter((s: unknown) => typeof s === "string" && s.length < 500_000).slice(0, 3)
        : [],
      // 兜底采集：localStorage 白名单快照（注入端已限 20 键 × 200 字符）
      storageSnapshot: storageSnapshot && typeof storageSnapshot === "object" && !Array.isArray(storageSnapshot)
        ? storageSnapshot
        : {},
      // 兜底采集：页面文本快照（限 10KB）
      textSnapshot: typeof textSnapshot === "string" ? textSnapshot.slice(0, 10000) : "",
    };

    // actionLog 明细写入独立表。
    // ⚠️ GOTCHA：canvas/textSnapshot 注入端与这里都有上限，唯独 actionLog 曾是无上限全量写入，
    //   恶意/异常提交可撑爆 ExplorationActionLog 表 → 服务端兜底截断到最近 500 条（轨迹足够用）。
    // ⛔ DO NOT REVERT：不要去掉 slice(0, 500)，否则回到「日志条数无上限」的数据膨胀风险。
    const logs = Array.isArray(actionLog)
      ? actionLog
          .slice(0, 500)
          .map((log: { type?: string; target?: string; value?: string; timestamp?: number }) => ({
            type: log.type ?? "click",
            target: log.target ?? "",
            value: log.value ?? "",
            timestamp: log.timestamp ?? Date.now(),
          }))
      : [];

    // 事务：创建/更新提交记录 + 写入操作日志
    const { submission, previousQfRecordId } = await prisma.$transaction(async (tx) => {
      // 查找已有提交
      const existing = await tx.explorationSubmission.findUnique({
        where: { explorationId_studentId: { explorationId: id, studentId } },
      });

      let sub;
      if (existing) {
        // 更新已有提交。
        // ⚠️ GOTCHA：重提交时 submittedAt 必须刷新，否则老师端与 QF 记录（删旧写新、时间是新的）
        //   时间戳会不一致，学生改完重交后老师看到的仍是首次提交时间。
        // ⛔ DO NOT REVERT：不要去掉 submittedAt，否则重提交时间戳不更新。
        sub = await tx.explorationSubmission.update({
          where: { id: existing.id },
          data: {
            score: finalScore,
            totalScore: finalMaxScore,
            status: "graded",
            gradedAt: new Date(),
            submittedAt: new Date(),
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

      return { submission: sub, previousQfRecordId: existing?.qfRecordId ?? null };
    });

    // ===== QuickForm 答案落库（行为数据已落库，这一步失败不回滚、不影响学生提交）=====
    let answersStored = false;
    let qfError: string | undefined;
    if (
      exploration.qfTaskId &&
      answers &&
      typeof answers === "object" &&
      !Array.isArray(answers) &&
      Object.keys(answers).length > 0
    ) {
      const student = await prisma.user.findUnique({
        where: { id: studentId },
        select: { name: true, studentNo: true },
      });
      const result = await writeCollectedAnswers(
        exploration.qfTaskId,
        answers as Record<string, unknown>,
        {
          // 学生重新提交：先删旧记录再写新的，保持一人一条
          replaceRecordId: previousQfRecordId,
          identity: {
            studentName: student?.name ?? undefined,
            studentNo: student?.studentNo ?? undefined,
            studentId,
          },
        }
      );
      if ("recordId" in result) {
        answersStored = true;
        await prisma.explorationSubmission.update({
          where: { id: submission.id },
          data: { qfRecordId: result.recordId },
        });
      } else {
        qfError = result.error;
        console.error("[QF] 答案写入失败（行为数据已正常落库）:", result.error);
      }
    }

    return NextResponse.json({
      submissionId: submission.id,
      score: finalScore,
      maxScore: finalMaxScore,
      status: "graded",
      submittedAt: submission.submittedAt,
      answersStored,
      ...(qfError ? { answersError: qfError } : {}),
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