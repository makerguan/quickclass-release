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
              select: { id: true, title: true, description: true, enableSubmission: true, enableAiCompanion: true, questionsJson: true },
              orderBy: { sortOrder: "asc" },
            },
            ProjectSubmission: {
              where: { enabled: true },
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // （历史兜底已移除 2026-09）曾在此把库里旧版伴学 HTML 升级后写回数据库（版本号机制配套）。
    // 现读取路径统一走 renderExplorationHtml（入口无条件 purify + 注入当前版），
    // 库里无论存纯净稿还是存量注入版都能正确渲染，无需也不应在此写库（与「库存纯净稿」契约一致）。
    // 列表 select 也因此不再取 htmlContent —— 学生端按需拉 /api/student/explorations/[id] 懒加载。

    // 映射字段名以匹配前端期望
    const mappedTasks = tasks.map(task => ({
      ...task,
      subProjects: task.subProjects.map(({ ExplorationActivity, PresetConversation, QuizActivity, ProjectSubmission, ...spRest }) => ({
        ...spRest,
        presetConversations: PresetConversation,
        quizActivities: QuizActivity?.map(qa => ({
          ...qa,
          questions: qa.Question,
        })),
        explorations: ExplorationActivity,
        projectSubmissions: ProjectSubmission?.map(ps => ({
          id: ps.id,
          title: ps.title,
          description: ps.description,
          category: ps.category,
          visibleToClass: ps.visibleToClass,
          allowLike: ps.allowLike,
          fileSizeLimit: ps.fileSizeLimit,
        })),
      })),
    }));

    return NextResponse.json(mappedTasks);
  } catch (error) {
    console.error("Get student tasks error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}