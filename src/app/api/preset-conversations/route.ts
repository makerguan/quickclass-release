import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

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

    // sortOrder 取当前 subProject 下最大值 +1
    const maxItem = await prisma.presetConversation.findFirst({
      where: { subProjectId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextOrder = (maxItem?.sortOrder ?? 0) + 1;

    const created = await prisma.presetConversation.create({
      data: {
        subProjectId,
        title: title.trim(),
        description: description || null,
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
