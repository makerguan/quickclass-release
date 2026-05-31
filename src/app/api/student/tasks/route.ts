import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// GET: 学生获取自己班级分配的课堂
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const userId = String(payload.userId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.classId) return NextResponse.json({ error: "未加入班级" }, { status: 403 });

    // 获取分配给本班的所有已启用的任务
    const tasks = await prisma.learningTask.findMany({
      where: {
        assignments: { some: { classId: user.classId } },
        status: "ENABLED",
      },
      include: {
        subProjects: {
          include: {
            PresetConversation: { where: { enabled: true }, orderBy: { sortOrder: "asc" } },
            QuizActivity: {
              where: { status: "ACTIVE" },
              include: {
                Question: {
                  orderBy: { order: "asc" },
                },
              },
              orderBy: { sortOrder: "asc" },
            },
            ExplorationActivity: {
              where: { enabled: true },
              select: { id: true, title: true, description: true, htmlContent: true, enableSubmission: true, questionsJson: true },
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 映射字段名以匹配前端期望
    const mappedTasks = tasks.map(task => ({
      ...task,
      subProjects: task.subProjects.map(sp => ({
        ...sp,
        presetConversations: sp.PresetConversation,
        quizActivities: sp.QuizActivity?.map(qa => ({
          ...qa,
          questions: qa.Question,
        })),
        explorations: sp.ExplorationActivity,
      })),
    }));

    return NextResponse.json(mappedTasks);
  } catch (error) {
    console.error("Get student tasks error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
