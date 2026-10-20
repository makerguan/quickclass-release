import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { applyUnifiedOrder, type UnifiedActivityRef, type UnifiedActivityType } from "@/lib/activities/unified-order";

const VALID_TYPES: UnifiedActivityType[] = ["conversation", "exploration", "project", "quiz"];

// 📐 CONTRACT: 跨类型统一活动排序 API
// POST /api/sub-projects/[subProjectId]/activities/reorder
// Body: { activities: [{ type: "conversation"|"exploration"|"project"|"quiz", id: string }] }
//   —— activities = 教师端统一列表的当前显示顺序（启用在前按新顺序、停用沉底），
//      后端按下标 0..n-1 跨 4 表重写 sortOrder；未列出的活动按类型优先级稳定追加。
// 🔗 RELATED: src/lib/activities/unified-order.ts（核心逻辑与本文件契约说明）
// ⛔ DO NOT REVERT: 不要退回 4 个旧 reorder 接口（/api/{类型}/reorder）——它们只在同表内
//   交换 sortOrder，统一数值空间下会把其他类型"挤"到错误位置（例：[对话0,探究1,对话2,作业3]
//   内部交换两个对话后变成 [对话2,探究1,对话0,作业3]，探究被夹在中间）。
//   旧接口保留仅为兼容，前端已全部切到本接口。
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ subProjectId: string }> }
) {
  try {
    const { subProjectId } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    const sp = await prisma.subProject.findUnique({
      where: { id: subProjectId },
      include: { task: { select: { teacherId: true } } },
    });
    if (!sp) return new NextResponse("学习活动不存在", { status: 404 });
    if (sp.task.teacherId !== String(payload.userId)) {
      return new NextResponse("无权限", { status: 403 });
    }

    const body = await req.json();
    const activities = body?.activities;
    if (!Array.isArray(activities)) {
      return new NextResponse("缺少 activities 数组", { status: 400 });
    }
    const orderedRefs: UnifiedActivityRef[] = [];
    for (const a of activities) {
      if (!a || !VALID_TYPES.includes(a.type) || typeof a.id !== "string" || !a.id) {
        return new NextResponse("activities 元素格式错误（需含合法 type 与 id）", { status: 400 });
      }
      orderedRefs.push({ type: a.type, id: a.id });
    }

    await prisma.$transaction(async (tx) => {
      await applyUnifiedOrder(tx, subProjectId, orderedRefs);
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[unified reorder]", e);
    return new NextResponse("排序失败", { status: 500 });
  }
}
