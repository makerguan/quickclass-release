import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getAIConfig, chatCompletionsFetch } from "@/lib/ai";
import { getReportTime, buildChartPolicySection } from "@/lib/prompts/insight";
import { cleanInsightContent } from "@/lib/insight-clean";
import { buildQfAnswersText } from "@/lib/exploration/qf-report";
import { parseCollectProfile, detectCollectProfile } from "@/lib/exploration/collect-profile";
import { removeSubmitFunctionality } from "@/lib/prompts/exploration-submit";

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
      // 展示层统一清理：历史脏数据入库时未剥说明文字/围栏，返回前截取 HTML 主体（幂等，库数据不动）
      content: cleanInsightContent(i.content || ""),
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

    // 是否评分探究：collectProfile 由启用提交时 AI 分析得出；旧数据在去除注入脚本的 HTML 上正则兜底
    const profile = parseCollectProfile(exploration.collectProfile) ??
      detectCollectProfile(removeSubmitFunctionality(exploration.htmlContent));
    const hasScoring = profile.hasScoring !== false;

    // 分数统计（无评分探究不统计分数）
    let classAvgScore = 0;
    let scoreDistributionText = "";
    if (hasScoring && submittedCount > 0) {
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
        hasScoring ? `得分：${s.score || 0}/${s.totalScore || 100}` : "",
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
      // 显式信号：新 chart 协议数据型模板（确定性判定，优先于关键词嗅探）
      effectivePrompt.includes('图表协议') ||
      effectivePrompt.includes('<!DOCTYPE') ||
      effectivePrompt.includes('<html') ||
      effectivePrompt.includes('<div') ||
      effectivePrompt.includes('echarts') ||
      effectivePrompt.includes('ECharts') ||
      effectivePrompt.includes('chart') ||
      effectivePrompt.toLowerCase().includes('html')
    ) : false;

    const aiConfig = await getAIConfig();

    // 学生填写的探究答案（QF 采集）聚成文本，供报告数据段与模板变量使用。
    // ⚠️ GOTCHA：双轨采集下行为数据进 ExplorationSubmission，学生答案进 QfRecord；
    //   早先报告只喂行为数据，导致「老师在大屏看得到答案、AI 报告里看不到」。
    //   这里把答案一并拼进数据段，消除数据割裂。
    const qfAnswersText = await buildQfAnswersText(exploration.qfTaskId);

    // 构建 prompt
    // 无评分探究不输出「平均得分/分数分布」，让 AI 无从编造分数
    const scoreLines = hasScoring
      ? [`平均得分：${classAvgScore}分`, "", "## 分数分布", scoreDistributionText || "暂无数据", ""]
      : [];

    const dataSection = [
      "## 基本信息",
      `探究标题：${exploration.title}`,
      `探究描述：${exploration.description || "无"}`,
      `班级：${className}`,
      `已提交：${submittedCount}/${totalStudents}人`,
      `平均停留：${avgTimeSpent}秒`,
      `平均互动：${avgInteractions}次`,
      "",
      ...scoreLines,
      "## 操作类型统计",
      actionTypeStatsText,
      "",
      "## 提交详情",
      submissionDetails || "暂无提交记录",
      "",
      "## 学生作答内容",
      qfAnswersText || "暂无作答",
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
      "classAvgScore": hasScoring ? `${classAvgScore}分` : "本探究无评分环节",
      "scoreDistribution": hasScoring ? (scoreDistributionText || "无") : "本探究无评分环节，无分数分布",
      "submissionDetails": submissionDetails || "无",
      "actionTypeStats": actionTypeStatsText,
      "avgTimeSpent": `${avgTimeSpent}秒`,
      "avgInteractions": `${avgInteractions}次`,
      "qfAnswers": qfAnswersText || "无",
      "reportTime": getReportTime(),
    };

    const templateSection = effectivePrompt
      ? `\n\n## 教师自定义分析要求\n${replaceExplorationVars(effectivePrompt, explorationVars)}`
      : "";

    const wordLimit = isHtmlOutput ? undefined : (aiConfig.classWordLimit ?? 2000);
    const wordLimitText = wordLimit ? `整篇报告总字数控制在${wordLimit}字以内。` : "";
    // 星级评分（「评分：★★★★★★」）是否输出，只由模板 content / 探究 analysisPrompt 决定，route 不再硬编码。
    // ⛔ DO NOT REVERT：不要把「评分：★★★★★★」写回这里——否则无论探究有没有评分环节、
    //   教师模板写没写，报告末尾都会被强加一行星级，绕过模板控制。
    const outputFormat = isHtmlOutput
      ? "\n\n## 输出格式\n直接输出完整的HTML内容，所有图表用纯 SVG 内联绘制，禁止引入任何外部 JS 图表库或 CDN 资源，保存为 .html 后离线可完整打开。"
      // 📐 CONTRACT：text 分支按模板意图分流图表策略（与 quiz-activities/[id]/report/generate
      // 同口径，共享 buildChartPolicySection）：模板含图表意图词（雷达图/饼图等）→ 注入 chart
      // 协议 → 分析 AI 输出 ```chart 块 → 写库前渲染成 SVG → 前端 qc-chart 白名单直出；
      // 未要求 → 注入画图禁令。
      // ⛔ DO NOT REVERT：不要改回纯 Markdown 输出——曾因 text 分支无协议，文本型探究报告
      // 永远无图，与学情分析线能力不对齐。
      // ⚠️ GOTCHA：模板正文必须纯中文表述——isHtmlOutput 嗅探含 includes('chart')，模板混入
      // 英文 chart 会被误判为网页型输出，与模板要求的 Markdown 形态错乱。
      : "\n\n## 字数限制\n" + wordLimitText + "\n\n" + buildChartPolicySection(effectivePrompt ?? undefined) + "\n\n## 输出格式\n直接输出分析内容（Markdown格式）";

    const prompt = `${systemFrame}\n\n${dataSection}${templateSection}${outputFormat}`;

    const requestBody: any = {
      model: aiConfig.model,
      messages: [{ role: "user", content: prompt }],
    };

    // ⛔ DO NOT REVERT：不要改回裸 fetch。2026-09-25 网络抖动让本路由以
    // 「生成失败: fetch failed」直透前端（无超时/无重试/错误不可读），
    // 统一走 src/lib/ai.ts 的 chatCompletionsFetch（超时+网络级重试+友好错误）。
    const aiResponse = await chatCompletionsFetch(aiConfig, requestBody);

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => "未知错误");
      console.error("[exploration/generate] AI 调用失败:", aiResponse.status, errText);
      return NextResponse.json({ error: "AI 分析失败: " + errText }, { status: 500 });
    }

    const aiData = await aiResponse.json();
    // 统一清理：chart 数据块渲染 + 剥 markdown 围栏 + 截取 HTML 文档主体（丢弃前后说明文字）
    let content = cleanInsightContent(aiData.choices?.[0]?.message?.content || "");

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