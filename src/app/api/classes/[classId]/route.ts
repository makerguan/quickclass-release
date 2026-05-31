import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

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

    // Prisma 级联删除会自动清理：
    // - User（学生）→ Conversation → Message
    // - AIInsight、Evaluation、LearningProgress、Material
    // - Exercise、TaskAssignment
    await prisma.class.delete({ where: { id: classId } });
    return NextResponse.json({ success: true, message: "班级及关联数据已删除" });
  } catch (error) {
    console.error("Delete class error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
