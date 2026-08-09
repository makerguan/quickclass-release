import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// PUT /api/preset-conversations/[id]
// 编辑单个对话活动（名片式独立 CRUD）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ presetConversationId: string }> }
) {
  try {
    const { presetConversationId } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    const body = await req.json();
    const {
      title,
      description,
      systemPrompt,
      analysisPrompt,
      classAnalysisPrompt,
      studentInsightTemplateId,
      classInsightTemplateId,
      enabled,
    } = body;

    // 只更新传入的字段，避免覆盖未传值
    const data: Record<string, unknown> = {};
    if (title !== undefined) {
      if (!title.trim()) return new NextResponse("对话活动名称不能为空", { status: 400 });
      data.title = title.trim();
    }
    if (description !== undefined) data.description = description || null;
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt || null;
    if (analysisPrompt !== undefined) data.analysisPrompt = analysisPrompt || null;
    if (classAnalysisPrompt !== undefined) data.classAnalysisPrompt = classAnalysisPrompt || null;
    if (studentInsightTemplateId !== undefined) data.studentInsightTemplateId = studentInsightTemplateId || null;
    if (classInsightTemplateId !== undefined) data.classInsightTemplateId = classInsightTemplateId || null;
    if (enabled !== undefined) data.enabled = enabled === true;

    const updated = await prisma.presetConversation.update({
      where: { id: presetConversationId },
      data,
    });

    return NextResponse.json({ success: true, presetConversation: updated });
  } catch (e) {
    console.error(e);
    return new NextResponse("更新对话活动失败", { status: 500 });
  }
}

// DELETE /api/preset-conversations/[id]
// 删除单个对话活动，级联清理 Conversation 与 AIInsight（复用 PUT /tasks/[taskId] 的清理范式）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ presetConversationId: string }> }
) {
  try {
    const { presetConversationId } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    // 该对话活动下的所有 Conversation
    const conversations = await prisma.conversation.findMany({
      where: { presetConversationId },
      select: { id: true },
    });
    const convIds = conversations.map((c) => c.id);

    await prisma.$transaction([
      // 1. 删除对话活动相关的 AI 学情分析结果（pc_class / pc_student，scopeId 关联）
      prisma.aIInsight.deleteMany({
        where: {
          type: { in: ["pc_class", "pc_student"] },
          scopeId: { in: [presetConversationId, ...convIds] },
        },
      }),
      // 2. 删除 Conversation 本身
      prisma.conversation.deleteMany({ where: { presetConversationId } }),
      // 3. 最后删除 PresetConversation
      prisma.presetConversation.delete({ where: { id: presetConversationId } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return new NextResponse("删除对话活动失败", { status: 500 });
  }
}
