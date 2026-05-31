import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getAIConfig } from "@/lib/ai";

// GET: 获取探究 AI 分析报告的所有版本
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      include: { SubProject: { select: { task: { select: { teacherId: true } } } } },
    });
    if (!exploration) return NextResponse.json({ error: "探究不存在" }, { status: 404 });
    if (exploration.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    if (!classId) return NextResponse.json({ error: "缺少 classId" }, { status: 400 });

    const allInsights = await prisma.aIInsight.findMany({
      where: { classId, type: "exploration_class", scopeId: id },
      orderBy: { version: "desc" },
    });

    const versions = allInsights.map((i) => ({
      id: i.id,
      content: i.content,
      version: i.version,
      createdAt: i.createdAt.toISOString(),
    }));

    return NextResponse.json({
      versions,
      latest: versions.length > 0 ? versions[0] : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("获取探究AI报告版本失败:", message);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}

// POST: 生成互动探究 AI 分析报告
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { templateId, classId } = body;

    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      include: {
        SubProject: { include: { task: true } },
        ExplorationSubmission: {
          include: { ExplorationActionLog: true },
          orderBy: { submittedAt: "desc" },
        },
      },
    });
    if (!exploration) return NextResponse.json({ error: "探究不存在" }, { status: 404 });
    if (exploration.SubProject.task.teacherId !== String(payload.userId)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 获取班级信息
    let students: { id: string; name: string }[] = [];
    let className = "本班";
    if (classId) {
      const cls = await prisma.class.findUnique({ where: { id: classId }, select: { name: true } });
      if (cls) className = cls.name;
      students = await prisma.user.findMany({
        where: { classId, role: "STUDENT" },
        select: { id: true, name: true },
      });
    }

    // 计算统计数据
    const submissions = classId
      ? exploration.ExplorationSubmission.filter((s) => students.find((st) => st.id === s.studentId))
      : exploration.ExplorationSubmission;

    const submittedCount = submissions.length;
    const totalStudents = students.length || submittedCount;

    // 分数统计
    let classAvgScore = 0;
    let scoreDistributionText = "";
    if (submittedCount > 0) {
      const totalScore = submissions.reduce((sum, s) => sum + (s.score || 0), 0);
      classAvgScore = Math.round(totalScore / submittedCount);
      const buckets = { "0-59": 0, "60-79": 0, "80-89": 0, "90-100": 0 };
      for (const s of submissions) {
        const score = s.score || 0;
        if (score < 60) buckets["0-59"]++;
        else if (score < 80) buckets["60-79"]++;
        else if (score < 90) buckets["80-89"]++;
        else buckets["90-100"]++;
      }
      scoreDistributionText = Object.entries(buckets)
        .map(([range, count]) => `${range}分：${count}人`)
        .join("\n");
    }

    // 操作类型统计
    const actionTypeMap: Record<string, number> = {};
    for (const sub of submissions) {
      for (const log of sub.ExplorationActionLog) {
        actionTypeMap[log.type] = (actionTypeMap[log.type] || 0) + 1;
      }
    }
    const actionTypeStatsText = Object.entries(actionTypeMap)
      .map(([type, count]) => `${type}: ${count}次`)
      .join("、") || "无";

    // 平均时间和互动
    let avgTimeSpent = 0;
    let avgInteractions = 0;
    if (submittedCount > 0) {
      let totalTime = 0, totalInteractions = 0;
      for (const s of submissions) {
        try {
          const answers = JSON.parse(s.answers || "{}");
          totalTime += answers.timeSpent || 0;
          totalInteractions += answers.interactions || 0;
        } catch { /* ignore */ }
      }
      avgTimeSpent = Math.round(totalTime / submittedCount);
      avgInteractions = Math.round(totalInteractions / submittedCount);
    }

    // 构建提交详情文本
    const studentNameMap = new Map(students.map((s) => [s.id, s.name]));
    const submissionDetails = submissions.slice(0, 30).map((s) => {
      let answers: any = {};
      try { answers = JSON.parse(s.answers || "{}"); } catch { /* ignore */ }
      const name = studentNameMap.get(s.studentId) || s.studentId;
      const fields = [
        `得分：${s.score || 0}/${s.totalScore || 100}`,
        answers.timeSpent ? `停留：${answers.timeSpent}秒` : "",
        answers.interactions ? `互动：${answers.interactions}次` : "",
        answers.completedSections ? `完成环节：${Array.isArray(answers.completedSections) ? answers.completedSections.join("、") : answers.completedSections}` : "",
        answers.gameLevel ? `关卡：${answers.gameLevel}` : "",
        `操作：${s.ExplorationActionLog.length}条`,
      ].filter(Boolean).join("，");
      return `${name}：${fields}`;
    }).join("\n\n");

    // 获取模板
    let templateContent: string | null = null;
    if (templateId) {
      const template = await prisma.analysisTemplate.findUnique({ where: { id: templateId } });
      if (template && template.teacherId === String(payload.userId)) {
        templateContent = template.content;
      }
    }
    if (!templateContent) {
      const defaultTemplate = await prisma.analysisTemplate.findFirst({
        where: { teacherId: String(payload.userId), type: "EXPLORATION_ANALYSIS", isDefault: true },
      });
      templateContent = defaultTemplate?.content || null;
    }

    const effectivePrompt = exploration.analysisPrompt || templateContent;

    // 检测是否为 HTML 输出
    const isHtmlOutput = effectivePrompt ? (
      effectivePrompt.includes('<!DOCTYPE') ||
      effectivePrompt.includes('<html') ||
      effectivePrompt.includes('<div') ||
      effectivePrompt.includes('echarts') ||
      effectivePrompt.includes('ECharts') ||
      effectivePrompt.includes('chart') ||
      effectivePrompt.toLowerCase().includes('html')
    ) : false;

    const aiConfig = await getAIConfig();

    // 构建 prompt
    const dataSection = [
      "## 基本信息",
      `探究标题：${exploration.title}`,
      `探究描述：${exploration.description || "无"}`,
      `班级：${className}`,
      `已提交：${submittedCount}/${totalStudents}人`,
      `平均得分：${classAvgScore}分`,
      `平均停留：${avgTimeSpent}秒`,
      `平均互动：${avgInteractions}次`,
      "",
      "## 分数分布",
      scoreDistributionText || "暂无数据",
      "",
      "## 操作类型统计",
      actionTypeStatsText,
      "",
      "## 提交详情",
      submissionDetails || "暂无提交记录",
    ].join("\n");

    const systemFrame = `你是一位资深学科教师，请根据以下互动探究的学生提交数据，生成一份专业的研学分析报告。

分析要求：
1. 学生对互动内容的整体完成情况（参与度、完成率）
2. 分析学生提交数据中反映出的学习行为特点
3. 识别表现优秀和有困难的学生
4. 提出教学改进建议（2-3条）`;

    const explorationVars: Record<string, string> = {
      "explorationTitle": exploration.title,
      "exploration.title": exploration.title,
      "explorationDescription": exploration.description || "无",
      "exploration.description": exploration.description || "无",
      "className": className,
      "submittedCount": String(submittedCount),
      "totalStudents": String(totalStudents),
      "classAvgScore": `${classAvgScore}分`,
      "scoreDistribution": scoreDistributionText || "无",
      "submissionDetails": submissionDetails || "无",
      "actionTypeStats": actionTypeStatsText,
      "avgTimeSpent": `${avgTimeSpent}秒`,
      "avgInteractions": `${avgInteractions}次`,
    };

    const templateSection = effectivePrompt
      ? `\n\n## 教师自定义分析要求\n${replaceExplorationVars(effectivePrompt, explorationVars)}`
      : "";

    const wordLimit = isHtmlOutput ? undefined : (aiConfig.classWordLimit ?? 2000);
    const wordLimitText = wordLimit ? `整篇报告总字数控制在${wordLimit}字以内。` : "";
    const outputFormat = isHtmlOutput
      ? "\n\n## 输出格式\n直接输出完整的HTML内容，可包含图表（ECharts等）、样式和交互元素。"
      : "\n\n## 字数限制\n" + wordLimitText + "\n\n## 输出格式\n直接输出分析内容（Markdown格式），末尾另起一行输出综合评分：\n评分：★★★★★★";

    const prompt = `${systemFrame}\n\n${dataSection}${templateSection}${outputFormat}`;

    const requestBody: any = {
      model: aiConfig.model,
      messages: [{ role: "user", content: prompt }],
    };
    if (wordLimit) {
      requestBody.max_tokens = Math.round(wordLimit * 1.5);
    }

    const aiResponse = await fetch(`${aiConfig.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => "未知错误");
      console.error("[exploration/generate] AI 调用失败:", aiResponse.status, errText);
      return NextResponse.json({ error: "AI 分析失败: " + errText }, { status: 500 });
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "";

    // 清理 content 中的 ```html 和 ``` 标记
    if (content.startsWith("```html")) content = content.slice(7);
    else if (content.startsWith("```")) content = content.slice(3);
    if (content.endsWith("```")) content = content.slice(0, -3);
    content = content.trim();

    // 保存到 AIInsight
    const saveClassId = classId;
    let newInsightId = "";
    let newVersion = 1;
    let previousContent: string | null = null;
    let previousId: string | null = null;

    if (saveClassId) {
      const existingInsight = await prisma.aIInsight.findFirst({
        where: { type: "exploration_class", classId: saveClassId, scopeId: id },
        orderBy: { version: "desc" },
      });
      if (existingInsight) {
        newVersion = existingInsight.version + 1;
        previousContent = existingInsight.content;
        previousId = existingInsight.id;
      }

      const saved = await prisma.aIInsight.create({
        data: {
          type: "exploration_class",
          classId: saveClassId,
          scopeId: id,
          content,
          version: newVersion,
        },
      });
      newInsightId = saved.id;
    }

    return NextResponse.json({
      content,
      id: newInsightId,
      version: newVersion,
      createdAt: new Date().toISOString(),
      previousContent,
      previousId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("生成探究AI报告失败:", message);
    return NextResponse.json({ error: "生成失败: " + message }, { status: 500 });
  }
}

function replaceExplorationVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    // 转义正则特殊字符（如 .）
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\{${escapedKey}}`, "g"), value || "无");
  }
  return result;
}