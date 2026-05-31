import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// PATCH: 更新对话活动的 analysisPrompt
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string; presetConversationId: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { taskId, presetConversationId } = await params;
    const body = await req.json();
    const { analysisPrompt } = body;

    // 验证任务归属
    const task = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: {
        subProjects: {
          include: { PresetConversation: true },
        },
      },
    });
    if (!task || task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 找到对应的 presetConversation
    let foundPc = null;
    for (const sp of task.subProjects) {
      const pc = sp.PresetConversation.find((p) => p.id === presetConversationId);
      if (pc) {
        foundPc = pc;
        break;
      }
    }

    if (!foundPc) {
      return NextResponse.json({ error: "对话活动不存在" }, { status: 404 });
    }

    // 更新 presetConversation 的 analysisPrompt
    await prisma.presetConversation.update({
      where: { id: presetConversationId },
      data: { analysisPrompt },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update preset conversation prompt error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
