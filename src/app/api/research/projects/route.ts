import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { collectResearchData } from "@/lib/research/data-collector";
import { generateTitles } from "@/lib/research/topic-detector";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const { projectName, projectType, keywords, dataScope, selectedTaskIds, dataTypes } = await req.json();
    if (!projectName?.trim()) return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
    if (!["PAPER", "PROPOSAL"].includes(projectType)) return NextResponse.json({ error: "生成类型无效" }, { status: 400 });

    // 兼容旧的 mode=all
    let taskIds: string[] = [];
    let types: ("quiz" | "conversation" | "quizReport" | "conversationReport")[] = [];

    if (selectedTaskIds && Array.isArray(selectedTaskIds)) {
      taskIds = selectedTaskIds;
    } else if (dataScope?.taskIds && Array.isArray(dataScope.taskIds)) {
      taskIds = dataScope.taskIds;
    } else if (dataScope?.mode === "all" || !dataScope) {
      // 旧版本兼容：拉所有启用的课堂
      const allTasks = await prisma.learningTask.findMany({
        where: { teacherId: String(payload.userId), status: "ENABLED" },
        select: { id: true },
      });
      taskIds = allTasks.map((t) => t.id);
    }
    if (dataTypes && Array.isArray(dataTypes)) {
      types = dataTypes;
    } else if (dataScope?.mode !== "selected") {
      // 默认：全选所有 4 类（兼容旧行为）
      types = ["quiz", "conversation", "quizReport", "conversationReport"];
    }

    if (taskIds.length === 0) {
      return NextResponse.json({ error: "请至少选择一个课堂" }, { status: 400 });
    }
    if (types.length === 0) {
      return NextResponse.json({ error: "请至少选择一类数据" }, { status: 400 });
    }

    const teacherId = String(payload.userId);
    const data = await collectResearchData(teacherId, taskIds, types);

    if (data.dataQuality.warnings.length > 0 && data.scope.studentCount === 0) {
      return NextResponse.json({ error: "所选课堂暂无数据", warnings: data.dataQuality.warnings }, { status: 400 });
    }

    const titles = await generateTitles(data, projectType, keywords || "", 10, teacherId);
    if (titles.length === 0) return NextResponse.json({ error: "题目生成失败，请重试" }, { status: 500 });

    const project = await prisma.researchProject.create({
      data: {
        teacherId,
        projectName: projectName.trim(),
        projectType,
        keywords: keywords || null,
        dataScope: JSON.stringify({ selectedTaskIds: taskIds, dataTypes: types }),
        generatedTitles: JSON.stringify(titles),
        status: "TITLES_READY",
        dataSnapshot: JSON.stringify(data),
        generationLog: JSON.stringify([{ step: "generate_titles", timestamp: new Date().toISOString(), count: titles.length }]),
      },
    });

    return NextResponse.json({
      id: project.id, projectName: project.projectName, projectType: project.projectType,
      generatedTitles: titles, status: project.status, dataWarnings: data.dataQuality.warnings,
      missingReports: data.dataQuality.missingReports,
    });
  } catch (error: any) {
    console.error("[POST /research/projects]", error);
    return NextResponse.json({ error: error.message || "创建失败" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const projects = await prisma.researchProject.findMany({
      where: { teacherId: String(payload.userId) },
      orderBy: { updatedAt: "desc" },
      select: { id: true, projectName: true, projectType: true, status: true, selectedTitle: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json(projects);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}