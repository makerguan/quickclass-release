import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const config = await prisma.systemConfig.findFirst();
    if (!config) {
      const newConfig = await prisma.systemConfig.create({
        data: {
          aiMaxConcurrent: 20,
          requireStarRating: false,
          conversationWarningThreshold: 20000,
          updatedAt: new Date(),
        },
      });
      // 统计对话数量
      const conversationCount = await prisma.conversation.count();
      return NextResponse.json({ ...newConfig, conversationCount });
    }

    // 统计对话数量
    const conversationCount = await prisma.conversation.count();
    return NextResponse.json({ ...config, conversationCount });
  } catch (error) {
    console.error("Get system config error:", error);
    return NextResponse.json({ error: "获取配置失败" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    console.log("[System Config] 接收到的更新数据:", JSON.stringify(body, null, 2));
    
    const {
      aiBaseUrl,
      aiApiKey,
      aiModel,
      aiMaxConcurrent,
      reasoningEnabled,
      studentWordLimit,
      classWordLimit,
      requireStarRating,
      teacherName,
      grade,
      subject,
      conversationWarningThreshold,
      studentMotto,
    } = body;

    // 构建更新数据，只包含有实际值的字段
    const updateData: Record<string, unknown> = {};
    if (aiBaseUrl !== undefined) updateData.aiBaseUrl = aiBaseUrl;
    if (aiApiKey !== undefined) updateData.aiApiKey = aiApiKey;
    if (aiModel !== undefined) updateData.aiModel = aiModel;
    if (aiMaxConcurrent !== undefined && aiMaxConcurrent !== null) updateData.aiMaxConcurrent = aiMaxConcurrent;
    if (reasoningEnabled !== undefined) updateData.reasoningEnabled = reasoningEnabled;
    if (studentWordLimit !== undefined && studentWordLimit !== null) updateData.studentWordLimit = studentWordLimit;
    else if (studentWordLimit === null) updateData.studentWordLimit = null;
    if (classWordLimit !== undefined && classWordLimit !== null) updateData.classWordLimit = classWordLimit;
    else if (classWordLimit === null) updateData.classWordLimit = null;
    if (requireStarRating !== undefined && requireStarRating !== null) updateData.requireStarRating = requireStarRating;
    if (teacherName !== undefined) updateData.teacherName = teacherName;
    if (grade !== undefined) updateData.grade = grade;
    if (subject !== undefined) updateData.subject = subject;
    if (studentMotto !== undefined) updateData.studentMotto = studentMotto;
    if (conversationWarningThreshold !== undefined && conversationWarningThreshold !== null) {
      updateData.conversationWarningThreshold = conversationWarningThreshold;
    }

    let config = await prisma.systemConfig.findFirst();
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          aiBaseUrl: aiBaseUrl || "",
          aiApiKey: aiApiKey || null,
          aiModel: aiModel || "qwen-turbo",
          aiMaxConcurrent: aiMaxConcurrent || 20,
          reasoningEnabled: reasoningEnabled ?? false,
          studentWordLimit: studentWordLimit ?? null,
          classWordLimit: classWordLimit ?? null,
          requireStarRating: requireStarRating ?? false,
          teacherName: teacherName ?? null,
          grade: grade ?? null,
          subject: subject ?? null,
          conversationWarningThreshold: conversationWarningThreshold ?? 20000,
          studentMotto: studentMotto ?? null,
          updatedAt: new Date(),
        },
      });
    } else {
      console.log("[System Config] 更新现有配置，updateData:", JSON.stringify(updateData, null, 2));
      config = await prisma.systemConfig.update({
        where: { id: config.id },
        data: updateData,
      });
    }

    console.log("[System Config] 更新成功");
    return NextResponse.json(config);
  } catch (error) {
    console.error("[System Config] 更新失败:", error);
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: "更新配置失败", details: errorMessage }, { status: 500 });
  }
}
