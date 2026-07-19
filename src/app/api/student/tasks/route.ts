import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { upgradeAiCompanionIfNeeded } from "@/lib/prompts/ai-companion";

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
              select: { id: true, title: true, description: true, htmlContent: true, enableSubmission: true, enableAiCompanion: true, questionsJson: true },
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 惰性升级：AI 伴学 HTML 可能来自教师升级前的旧版本，学生端无教师保存入口，
    // 在这里兜底升级到当前版本，确保学生 iframe 拿到的脚本一定可解析。
    const upgrades: Promise<unknown>[] = [];
    for (const task of tasks) {
      for (const sp of task.subProjects) {
        for (const exp of sp.ExplorationActivity) {
          if (!exp.enableAiCompanion) continue;
          const upgrade = upgradeAiCompanionIfNeeded(exp.htmlContent, {
            explorationId: exp.id,
          });
          if (upgrade.changed) {
            exp.htmlContent = upgrade.html;
            upgrades.push(
              prisma.explorationActivity
                .update({ where: { id: exp.id }, data: { htmlContent: upgrade.html } })
                .catch((e) => console.error("[student/tasks] 持久化AI伴学升级失败", exp.id, e))
            );
          }
        }
      }
    }
    // 不阻塞响应：升级已先在内存中完成，写库是后台 best-effort。
    if (upgrades.length > 0) {
      Promise.allSettled(upgrades).then((results) => {
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) console.warn(`[student/tasks] ${failed}/${results.length} 个探究HTML升级写库失败，下次读取仍会重试`);
      });
    }

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