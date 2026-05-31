import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET /api/conversations/teacher - 教师查看学生对话记录
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    const studentName = searchParams.get("studentName");
    const taskId = searchParams.get("taskId");
    const presetConversationId = searchParams.get("presetConversationId");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "5", 10);

    // 构建查询条件：只查询该教师班级下的对话
    const where: Record<string, unknown> = {};
    if (classId) {
      where.classId = classId;
    } else {
      // 没指定班级，查教师所有班级
      const classes = await prisma.class.findMany({
        where: { teacherId: String(payload.userId) },
        select: { id: true },
      });
      where.classId = { in: classes.map((c) => c.id) };
    }

    // 按学生名搜索（SQLite 兼容模式搜索）
    if (studentName) {
      const students = await prisma.user.findMany({
        where: { name: { contains: studentName } },
        select: { id: true },
      });
      if (students.length > 0) {
        where.userId = { in: students.map((s) => s.id) };
      } else {
        // 没找到匹配学生，返回空结果
        return NextResponse.json({ conversations: [], total: 0 });
      }
    }

    // 按课堂(任务)和/或对话活动筛选
    if (taskId || presetConversationId) {
      const pcWhere: Record<string, unknown> = {};
      if (presetConversationId) {
        pcWhere.id = presetConversationId;
      }
      if (taskId) {
        // 通过 taskId 找到所有 subProject，再找到所有 presetConversation
        const subProjects = await prisma.subProject.findMany({
          where: { taskId },
          select: { id: true },
        });
        pcWhere.subProjectId = { in: subProjects.map((sp) => sp.id) };
      }
      const pcs = await prisma.presetConversation.findMany({
        where: pcWhere,
        select: { id: true },
      });
      where.presetConversationId = { in: pcs.map((pc) => pc.id) };
    }

    // 查询总数
    const total = await prisma.conversation.count({ where });

    // 分页查询
    const skip = (page - 1) * pageSize;
    const rawConversations = await prisma.conversation.findMany({
      where,
      include: {
        User: { select: { id: true, name: true } },
        Class: { select: { id: true, name: true } },
        PresetConversation: {
          select: {
            id: true,
            title: true,
            SubProject: {
              select: {
                id: true,
                title: true,
                task: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
              },
            },
          },
        },
        Message: {
          orderBy: { createdAt: "asc" },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
    });

    // 映射字段名，使字段名与前端期望的保持一致
    const conversations = rawConversations.map(({ User, Class, PresetConversation, Message, ...rest }) => ({
      ...rest,
      user: User,
      class: Class,
      presetConversation: PresetConversation ? {
        ...PresetConversation,
        subProject: PresetConversation.SubProject,
        SubProject: undefined,
      } : null,
      messages: Message,
    }));

    return NextResponse.json({ conversations, total, page, pageSize });
  } catch (error) {
    console.error("Get teacher conversations error:", error);
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: "服务器错误", detail: message }, { status: 500 });
  }
}

// DELETE /api/conversations/teacher/batch - 批量删除对话
export async function DELETE(req: NextRequest) {
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
    const { conversationIds } = body;

    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return NextResponse.json({ error: "未提供要删除的对话ID" }, { status: 400 });
    }

    // 验证所有对话都属于该教师的班级
    const conversations = await prisma.conversation.findMany({
      where: { id: { in: conversationIds } },
      include: { Class: true },
    });

    for (const conv of conversations) {
      if (conv.Class.teacherId !== String(payload.userId)) {
        return NextResponse.json({ error: "无权限删除部分对话" }, { status: 403 });
      }
    }

    // 删除消息和对话
    await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });

    return NextResponse.json({ success: true, deletedCount: conversationIds.length });
  } catch (error) {
    console.error("Batch delete conversations error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
