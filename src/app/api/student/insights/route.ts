import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const userId = String(payload.userId);

    // 获取该学生的所有洞察（按版本降序）
    // 查询 task_student 类型（教师从课堂学情分析生成的学生评价）
    const insights = await prisma.aIInsight.findMany({
      where: { userId, type: "task_student" },
      orderBy: { version: "desc" },
    });

    return NextResponse.json({
      personalInsights: insights,
    });
  } catch (error) {
    console.error("Get student insights error:", error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}
