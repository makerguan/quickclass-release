import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { renderExplorationHtml } from "@/lib/exploration/render";
import { parseCollectProfile } from "@/lib/exploration/collect-profile";

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

    // 读取时渲染：按开关把「纯净稿」注入成「提交 + 伴学」渲染版（纯函数，内存现算，不落库）。
    // ⛔ 提交功能从「保存时落库」改为「读取时注入」，与伴学统一；htmlContent 存库恒为纯净稿。
    const rendered = renderExplorationHtml({
      htmlContent: item.htmlContent,
      explorationId: id,
      taskTitle: item.SubProject.task.title || "",
      enableSubmission: item.enableSubmission,
      enableAiCompanion: item.enableAiCompanion,
      collectProfile: parseCollectProfile(item.collectProfile ?? null),
    });

    const response: Record<string, unknown> = { id: item.id, htmlContent: rendered.html };
    if (rendered.warnings.length > 0) {
      response._renderWarnings = rendered.warnings;
    }
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[GET/student/explorations] 错误:", error?.message || error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}
