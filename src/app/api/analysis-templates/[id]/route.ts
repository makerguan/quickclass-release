import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// PUT /api/analysis-templates/[id] - 更新模板
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name, content, isDefault, type } = body;

    // 验证模板属于该教师
    const template = await prisma.analysisTemplate.findUnique({ where: { id } });
    if (!template) {
      return NextResponse.json({ error: "模板不存在" }, { status: 404 });
    }
    // 允许编辑：如果模板属于该教师，或者是公共模板（teacherId为null）
    if (template.teacherId !== null && template.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 如果设为默认，先取消同类型的其他默认（仅取消本人的）
    if (isDefault) {
      await prisma.analysisTemplate.updateMany({
        where: { teacherId: String(payload.userId), type: template.type, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.analysisTemplate.update({
      where: { id },
      data: {
        name: name ?? template.name,
        content: content ?? template.content,
        isDefault: isDefault ?? template.isDefault,
        type: type ?? template.type,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update template error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// DELETE /api/analysis-templates/[id] - 删除模板
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { id } = await params;

    // 验证模板属于该教师
    const template = await prisma.analysisTemplate.findUnique({ where: { id } });
    if (!template) {
      return NextResponse.json({ error: "模板不存在" }, { status: 404 });
    }
    // 允许删除：如果模板属于该教师，或者是公共模板（teacherId为null）
    if (template.teacherId !== null && template.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    await prisma.analysisTemplate.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete template error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
