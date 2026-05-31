import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { studentId } = await params;

    // 查找学生
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== "STUDENT") {
      return NextResponse.json({ error: "学生不存在" }, { status: 404 });
    }

    // 验证该学生所在的班级属于当前教师
    if (student.classId) {
      const classData = await prisma.class.findUnique({
        where: { id: student.classId },
      });
      if (!classData || classData.teacherId !== payload.userId) {
        return NextResponse.json({ error: "无权限" }, { status: 403 });
      }
    }

    // 1. 删除对话记录（Conversation 没有 onDelete Cascade）
    const conversations = await prisma.conversation.findMany({
      where: { userId: studentId },
      select: { id: true },
    });
    const convIds = conversations.map((c) => c.id);
    if (convIds.length > 0) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
      await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    }

    // 2. 删除互动探究提交（ExplorationSubmission.studentId 无外键关联）
    const submissions = await prisma.explorationSubmission.findMany({
      where: { studentId },
      select: { id: true },
    });
    const subIds = submissions.map((s) => s.id);
    if (subIds.length > 0) {
      await prisma.explorationActionLog.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.explorationSubmission.deleteMany({ where: { id: { in: subIds } } });
    }

    // 3. 删除练习记录（ExerciseAttempt 没有 onDelete Cascade）
    await prisma.exerciseAttempt.deleteMany({ where: { userId: studentId } });

    // 4. 删除学生（级联删除 AIInsight、QuizAttempt、Evaluation、LearningProgress）
    await prisma.user.delete({ where: { id: studentId } });

    return NextResponse.json({ success: true, message: "学生及关联数据已删除" });
  } catch (error) {
    console.error("Delete student error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
