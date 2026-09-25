import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { clearQfRecordsForExploration } from "@/lib/exploration/qf-binding";

// POST: 清除某互动探究的全部学生提交（行为数据 + QuickForm 收集答案）。
//
// 为什么要有这个接口：
//   探究「启用提交」后，一旦有学生提交，编辑弹窗会锁定 HTML 内容
//   （有人提交即禁止改内容，见 PUT 路由的 existingSubs 分支）。
//   本接口是这条锁的「逃生口」——老师先让探究失效、点「清除提交」、
//   提交归零后即可恢复编辑。
//
// 删除范围（与「删除探究」的 DELETE 不同）：
//   - ✅ 删 ExplorationSubmission（操作日志靠 onDelete: Cascade 删，这里仍手动删双保险）
//   - ✅ 清 QuickForm 收集答案 qf_records（保留 qf_task，学生之后还能继续提交）
//   - ❌ 不删 AIInsight（AI 分析报告保留，与课堂作业 clear-attempts 口径一致）
//   - ❌ 不删 AiCompanionMessage（那是对话历史，不是提交）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const item = await prisma.explorationActivity.findFirst({
      where: { id, SubProject: { task: { teacherId: String(payload.userId) } } },
    });
    if (!item) return NextResponse.json({ error: "探究不存在" }, { status: 404 });

    // 手动级联删除提交：先删操作日志，再删提交（不依赖 SQLite 外键级联开关）。
    const submissions = await prisma.explorationSubmission.findMany({
      where: { explorationId: id },
      select: { id: true },
    });
    const subIds = submissions.map((s) => s.id);

    let deletedCount = 0;
    if (subIds.length > 0) {
      await prisma.explorationActionLog.deleteMany({ where: { submissionId: { in: subIds } } });
      const deleted = await prisma.explorationSubmission.deleteMany({ where: { explorationId: id } });
      deletedCount = deleted.count;
    }

    // 连带清 QuickForm 收集答案（保留任务本身）。
    // ⛔ 只清 records 不删 task：清除提交 ≠ 删除探究，收集任务还得继续用。
    await clearQfRecordsForExploration(item.qfTaskId);

    return NextResponse.json({ success: true, deletedCount });
  } catch (error: any) {
    console.error("[POST/clear-exploration-submissions] 错误:", error?.message || error);
    return NextResponse.json({ error: error?.message || "清除失败" }, { status: 500 });
  }
}
