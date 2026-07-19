import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectResearchData } from "@/lib/research/data-collector";
import { generateTitles } from "@/lib/research/topic-detector";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const project = await prisma.researchProject.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (project.teacherId !== String(payload.userId)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    return NextResponse.json({
      ...project,
      generatedTitles: project.generatedTitles ? JSON.parse(project.generatedTitles) : [],
      dataScope: project.dataScope ? JSON.parse(project.dataScope) : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const project = await prisma.researchProject.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (project.teacherId !== String(payload.userId)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    await prisma.researchProject.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}