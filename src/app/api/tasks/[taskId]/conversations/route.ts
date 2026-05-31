import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// DELETE: 清理任务下指定班级或所有班级的学生对话记录
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER")
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { taskId } = await params;
    const existing = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: { assignments: true },
    });
    if (!existing || existing.teacherId !== String(payload.userId))
      return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { classId } = body; // 如果不传 classId，则清理所有班级的对话

    let classIds: string[];
    if (classId) {
      // 只清理指定班级
      const assigned = existing.assignments.some((a) => a.classId === classId);
      if (!assigned) return NextResponse.json({ error: "该班级未分配此任务" }, { status: 400 });
      classIds = [classId];
    } else {
      // 清理所有班级
      classIds = existing.assignments.map((a) => a.classId);
    }

    if (classIds.length === 0) {
      return NextResponse.json({ success: true, message: "无班级需要清理" });
    }

    // 获取目标班级的所有学生 ID
    const students = await prisma.user.findMany({
      where: { classId: { in: classIds }, role: "STUDENT" },
      select: { id: true },
    });
    const studentIds = students.map((s) => s.id);

    // 获取任务下所有的预设对话ID
    const presetConversations = await prisma.presetConversation.findMany({
      where: { SubProject: { taskId } },
      select: { id: true },
    });
    const presetIds = presetConversations.map((pc) => pc.id);

    // 找出需要删除的对话（属于这些班级且关联了任务预设对话的）
    const conversationsToDelete = await prisma.conversation.findMany({
      where: {
        classId: { in: classIds },
        presetConversationId: { in: presetIds },
      },
      select: { id: true },
    });
    const conversationIds = conversationsToDelete.map((c) => c.id);

    // 获取任务下所有互动探究和作业
    const explorations = await prisma.explorationActivity.findMany({
      where: { SubProject: { taskId } },
      select: { id: true },
    });
    const explorationIds = explorations.map((e) => e.id);

    const quizActivities = await prisma.quizActivity.findMany({
      where: { SubProject: { taskId } },
      select: { id: true },
    });
    const quizActivityIds = quizActivities.map((q) => q.id);

    let deletedConversations = 0;
    let deletedMessages = 0;
    let deletedSubmissions = 0;
    let deletedQuizAttempts = 0;

    if (conversationIds.length > 0) {
      // 先删除消息
      const msgResult = await prisma.message.deleteMany({
        where: { conversationId: { in: conversationIds } },
      });
      deletedMessages = msgResult.count;

      // 再删除对话
      const convResult = await prisma.conversation.deleteMany({
        where: { id: { in: conversationIds } },
      });
      deletedConversations = convResult.count;
    }

    // 删除互动探究学生提交记录（级联删除 actionLogs）
    if (explorationIds.length > 0 && studentIds.length > 0) {
      const subResult = await prisma.explorationSubmission.deleteMany({
        where: {
          explorationId: { in: explorationIds },
          studentId: { in: studentIds },
        },
      });
      deletedSubmissions = subResult.count;
    }

    // 删除作业学生答题记录（级联删除 questionAttempts）
    if (quizActivityIds.length > 0 && studentIds.length > 0) {
      const quizResult = await prisma.quizAttempt.deleteMany({
        where: {
          quizActivityId: { in: quizActivityIds },
          userId: { in: studentIds },
        },
      });
      deletedQuizAttempts = quizResult.count;
    }

    // 删除 AI 学情分析结果（按班级和任务关联删除）
    if (classIds.length > 0) {
      // task 级别的分析
      await prisma.aIInsight.deleteMany({
        where: { classId: { in: classIds }, scopeId: taskId },
      });
      // subProject 级别的分析
      const subProjects = await prisma.subProject.findMany({
        where: { taskId },
        select: { id: true },
      });
      const subProjectIds = subProjects.map((sp) => sp.id);
      if (subProjectIds.length > 0) {
        await prisma.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: subProjectIds } },
        });
      }
      // 预设对话级别的分析
      if (presetIds.length > 0) {
        await prisma.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: presetIds } },
        });
      }
      // 作业级别的分析（quiz_class 和 quiz_student）
      if (quizActivityIds.length > 0) {
        await prisma.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: quizActivityIds }, type: "quiz_class" },
        });
        await prisma.aIInsight.deleteMany({
          where: { classId: { in: classIds }, scopeId: { in: quizActivityIds }, type: "quiz_student" },
        });
      }
    }

    const parts: string[] = [];
    if (deletedConversations > 0 || deletedMessages > 0) {
      parts.push(`对话 ${deletedConversations} 条`);
    }
    if (deletedSubmissions > 0) {
      parts.push(`互动探究提交 ${deletedSubmissions} 份`);
    }
    if (deletedQuizAttempts > 0) {
      parts.push(`作业记录 ${deletedQuizAttempts} 条`);
    }
    const message = parts.length > 0
      ? `已清理：${parts.join("，")}`
      : "无数据需要清理";

    return NextResponse.json({
      success: true,
      message,
      stats: { conversations: deletedConversations, messages: deletedMessages, submissions: deletedSubmissions, quizAttempts: deletedQuizAttempts },
    });
  } catch (error) {
    console.error("Clear conversations error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
