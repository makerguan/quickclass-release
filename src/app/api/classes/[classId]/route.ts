import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { deleteAttachmentFile } from "@/lib/project-submit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "无效的 token" }, { status: 401 });
    }

    const { classId } = await params;
    const rawClassData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        User_Class_teacherIdToUser: { select: { id: true, name: true } },
        User_User_classIdToClass: {
          select: {
            id: true,
            name: true,
            studentNo: true,
            createdAt: true,
            password: true,
          },
        },
        Material: true,
        _count: { select: { User_User_classIdToClass: true, Conversation: true } },
      },
    });

    if (!rawClassData) {
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }

    // 映射字段名以匹配前端期望
    const { User_Class_teacherIdToUser, User_User_classIdToClass, Material, _count, ...rest } = rawClassData;
    const classData = {
      ...rest,
      teacher: User_Class_teacherIdToUser,
      students: User_User_classIdToClass,
      materials: Material,
      _count: { students: _count.User_User_classIdToClass, conversations: _count.Conversation },
    };

    if (classData.teacherId !== payload.userId && payload.role !== "STUDENT") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    return NextResponse.json(classData);
  } catch (error) {
    console.error("Get class error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
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

    const body = await req.json();
    const { name, description, inviteCode, aiPromptStrategy, customSystemPrompt, status, openInviteCode } = body;

    const { classId } = await params;
    const classData = await prisma.class.findUnique({ where: { id: classId } });
    if (!classData || classData.teacherId !== payload.userId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const updated = await prisma.class.update({
      where: { id: classId },
      data: {
        name,
        description,
        inviteCode,
        aiPromptStrategy,
        customSystemPrompt,
        status,
        openInviteCode,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update class error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// PATCH: 部分更新班级配置（包括学情洞察数据来源）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
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

    const body = await req.json();
    const { insightDataSource } = body;

    // 验证 insightDataSource 值
    if (insightDataSource && !["CONVERSATIONS", "TASK_INSIGHTS"].includes(insightDataSource)) {
      return NextResponse.json({ error: "无效的数据来源配置" }, { status: 400 });
    }

    const { classId } = await params;
    const classData = await prisma.class.findUnique({ where: { id: classId } });
    if (!classData || classData.teacherId !== payload.userId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const updateData: Record<string, string> = {};
    if (insightDataSource) {
      updateData.insightDataSource = insightDataSource;
    }

    const updated = await prisma.class.update({
      where: { id: classId },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Patch class error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
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

    const { classId } = await params;
    const classData = await prisma.class.findUnique({ where: { id: classId } });
    if (!classData || classData.teacherId !== payload.userId) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // SQLite 中部分外键是 RESTRICT（无级联），直接 delete Class 会触发 P2003 外键约束错误：
    //   Conversation.userId -> User、DocumentChunk.materialId -> Material、
    //   ExerciseAttempt.exerciseId -> Exercise / ExerciseAttempt.userId -> User
    // 因此这里显式按依赖顺序清理，再删除班级（其余关联由 Prisma 级联兜底）。
    const students = await prisma.user.findMany({
      where: { classId },
      select: { id: true },
    });
    const studentIds = students.map((s) => s.id);

    const conversations = await prisma.conversation.findMany({
      where: { classId },
      select: { id: true },
    });
    const convIds = conversations.map((c) => c.id);

    const materials = await prisma.material.findMany({
      where: { classId },
      select: { id: true },
    });
    const materialIds = materials.map((m) => m.id);

    const exercises = await prisma.exercise.findMany({
      where: { classId },
      select: { id: true },
    });
    const exerciseIds = exercises.map((e) => e.id);

    // 项目提交附件的物理文件（数据库记录由级联删除，文件需手动清理）
    const projectFiles = await prisma.projectAttachment.findMany({
      where: { Project: { classId } },
      select: { storedName: true },
    });

    await prisma.$transaction(async (tx) => {
      // 1. 对话消息 -> 对话（Conversation.userId 为 RESTRICT，必须先于学生删除）
      if (convIds.length > 0) {
        await tx.message.deleteMany({ where: { conversationId: { in: convIds } } });
        await tx.conversation.deleteMany({ where: { id: { in: convIds } } });
      }

      // 2. 练习作答记录（ExerciseAttempt 对 Exercise 与 User 均为 RESTRICT，必须先删）
      if (exerciseIds.length > 0 || studentIds.length > 0) {
        await tx.exerciseAttempt.deleteMany({
          where: {
            OR: [
              { exerciseId: { in: exerciseIds } },
              { userId: { in: studentIds } },
            ],
          },
        });
      }

      // 3. 资料切片 -> 资料（DocumentChunk.materialId 为 RESTRICT）
      if (materialIds.length > 0) {
        await tx.documentChunk.deleteMany({ where: { materialId: { in: materialIds } } });
      }
      await tx.exercise.deleteMany({ where: { classId } });
      await tx.material.deleteMany({ where: { classId } });

      // 4. 互动探究提交（ExplorationSubmission.studentId 无外键，避免删除学生后残留孤儿数据）
      if (studentIds.length > 0) {
        const submissions = await tx.explorationSubmission.findMany({
          where: { studentId: { in: studentIds } },
          select: { id: true },
        });
        const subIds = submissions.map((s) => s.id);
        if (subIds.length > 0) {
          await tx.explorationActionLog.deleteMany({ where: { submissionId: { in: subIds } } });
          await tx.explorationSubmission.deleteMany({ where: { id: { in: subIds } } });
        }
      }

      // 5. 其余关联数据（有级联，显式删除以避免级联顺序导致的偶发失败）
      await tx.aIInsight.deleteMany({ where: { classId } });
      await tx.evaluation.deleteMany({ where: { classId } });
      await tx.learningProgress.deleteMany({ where: { classId } });
      await tx.taskAssignment.deleteMany({ where: { classId } });

      // 6. 学生用户（级联清理 AIInsight、QuizAttempt、Evaluation、LearningProgress、
      //    AiCompanionMessage、StudentProject、ProjectAttachment、ProjectLike）
      if (studentIds.length > 0) {
        await tx.user.deleteMany({ where: { id: { in: studentIds } } });
      }

      await tx.class.delete({ where: { id: classId } });
    });

    // 事务提交后再清理物理文件
    projectFiles.forEach((f) => deleteAttachmentFile(f.storedName));

    return NextResponse.json({ success: true, message: "班级及关联数据已删除" });
  } catch (error) {
    console.error("Delete class error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
