import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getNextUnifiedSortOrder } from "@/lib/activities/unified-order";

// POST /api/preset-conversations
// 新建单个对话活动（名片式独立 CRUD）
// Body: { subProjectId, title, description?, systemPrompt?, analysisPrompt?, classAnalysisPrompt?, studentInsightTemplateId?, classInsightTemplateId?, enabled? }
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    const body = await req.json();
    const {
      subProjectId,
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

    if (!subProjectId) return new NextResponse("缺少 subProjectId", { status: 400 });
    if (!title?.trim()) return new NextResponse("对话活动名称不能为空", { status: 400 });

    // 校验 subProject 存在
    const sp = await prisma.subProject.findUnique({ where: { id: subProjectId } });
    if (!sp) return new NextResponse("子项目不存在", { status: 404 });

    // 📐 CONTRACT: sortOrder 取跨 4 表（对话/探究/项目/作业）统一数值空间的 max+1，
    // 支撑跨类型统一排序（详见 src/lib/activities/unified-order.ts）。
    // ⛔ DO NOT REVERT: 不要改回只查本表 max——同一 SubProject 下 4 表共用一个排序数值空间，
    // 本表 max 会让新活动插到其他类型活动的中间。
    const nextOrder = await getNextUnifiedSortOrder(prisma, subProjectId);

    const created = await prisma.presetConversation.create({
      data: {
        subProjectId,
        title: title.trim(),
        description: description || null,
        openingMessage: openingMessage || null,
        systemPrompt: systemPrompt || null,
        analysisPrompt: analysisPrompt || null,
        classAnalysisPrompt: classAnalysisPrompt || null,
        studentInsightTemplateId: studentInsightTemplateId || null,
        classInsightTemplateId: classInsightTemplateId || null,
        enabled: enabled === false ? false : true,
        sortOrder: nextOrder,
      },
    });

    return NextResponse.json({ success: true, presetConversation: created });
  } catch (e) {
    console.error(e);
    return new NextResponse("新建对话活动失败", { status: 500 });
  }
}
