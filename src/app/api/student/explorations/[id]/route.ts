import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { upgradeAiCompanionIfNeeded } from "@/lib/prompts/ai-companion";

// GET: 学生按需获取单个探究活动的 HTML 内容（懒加载）
// /api/student/tasks 列表不再返回 htmlContent，避免列表体积过大导致学生端加载缓慢；
// 学生打开某个探究活动时，由本接口按需返回 htmlContent（含 AI 伴学自愈注入）。
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { id: String(payload.userId) } });
    if (!user?.classId) return NextResponse.json({ error: "未加入班级" }, { status: 403 });

    const item = await prisma.explorationActivity.findUnique({
      where: { id },
      include: { SubProject: { include: { task: true } } },
    });
    if (!item) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (!item.SubProject) {
      return NextResponse.json({ error: "关联的项目不存在" }, { status: 400 });
    }

    // 权限校验：该探究所属任务必须已分配给当前学生班级且启用
    const assigned = await prisma.taskAssignment.findFirst({
      where: { taskId: item.SubProject.task.id, classId: user.classId },
    });
    const task = item.SubProject.task;
    if (!assigned || task.status !== "ENABLED") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 兜底升级：AI 伴学 HTML 可能来自教师升级前的旧版本，在内存中自愈注入，不持久化
    let htmlContent = item.htmlContent;
    let upgradeWarnings: string[] | undefined;
    if (item.enableAiCompanion) {
      const upgrade = upgradeAiCompanionIfNeeded(item.htmlContent, { explorationId: id });
      if (upgrade.changed) {
        upgradeWarnings = upgrade.warnings;
        htmlContent = upgrade.html;
      }
    }

    const response: Record<string, unknown> = { id: item.id, htmlContent };
    if (upgradeWarnings && upgradeWarnings.length > 0) {
      response._aiCompanionWarnings = upgradeWarnings;
    }
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[GET/student/explorations] 错误:", error?.message || error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}
