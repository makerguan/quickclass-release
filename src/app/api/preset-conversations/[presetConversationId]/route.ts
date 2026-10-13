import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/preset-conversations/[id]
// ══════════════════════════════════════════════════════════════════════════════
// 读取单个对话活动的**完整**字段（含 systemPrompt / analysisPrompt /
// classAnalysisPrompt 三个提示词正文）。
//
// 为什么需要它（别删）：
//   列表接口 GET /api/tasks 出于性能考虑**有意不下发**这几个提示词正文
//   （8 个课堂的列表响应 372 KiB 里 89% 是提示词，详情与完整背景见
//   src/app/api/tasks/route.ts GET 分支顶部的「列表瘦身契约」）。
//   而「编辑对话活动」弹窗必须把三个提示词回填到输入框，否则用户一保存
//   就会把库里的提示词清空。故新增本接口按需补齐。
//   ⛔ 不要因为「列表接口里已经有这些字段了」而删掉本接口 —— 那一定是因为
//      有人把列表瘦身回退了，请先去看上面那份契约说明，而不是删这里。
//
// 鉴权口径：与同目录 PUT / DELETE 保持一致（仅校验登录态，不校验归属）。
//
// 关联：调用方 src/app/teacher/tasks/page.tsx 的 openEditConversationDialog()。
// 维护：将来 PresetConversation 新增「长文本」字段，应加在这里返回，
//       而**不是**加回列表接口。
// ══════════════════════════════════════════════════════════════════════════════
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ presetConversationId: string }> }
) {
  try {
    const { presetConversationId } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    const presetConversation = await prisma.presetConversation.findUnique({
      where: { id: presetConversationId },
    });
    if (!presetConversation) return new NextResponse("对话活动不存在", { status: 404 });

    return NextResponse.json({ success: true, presetConversation });
  } catch (e) {
    console.error(e);
    return new NextResponse("读取对话活动失败", { status: 500 });
  }
}

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
      openingMessage,
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
    if (openingMessage !== undefined) data.openingMessage = openingMessage || null;
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
