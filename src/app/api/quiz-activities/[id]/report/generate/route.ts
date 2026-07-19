import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getAIConfig } from "@/lib/ai";

// 课堂作业分析模板变量替换
function replaceQuizAnalysisVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\{${escapedKey}}`, "g"), value || "无");
  }
  return result;
}

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

    const quiz = await prisma.quizActivity.findFirst({
      where: { id, SubProject: { task: { teacherId: String(payload.userId) } } },
      include: {
        Question: { orderBy: { order: "asc" } },
        QuizAttempt: {
          include: { User: { select: { id: true, name: true, classId: true } }, QuestionAttempt: true },
        },
        SubProject: {
          include: {
            task: {
              include: {
                assignments: { select: { classId: true } },
              },
            },
          },
        },
      },
    });
    if (!quiz) return NextResponse.json({ error: "作业不存在" }, { status: 404 });

    // 仅统计已完成答题的学生
    const completedAttempts = quiz.QuizAttempt.filter(a => a.QuestionAttempt.length === quiz.Question.length);
    const totalStudents = completedAttempts.length;
    const passScore = quiz.passScore ?? 60;
    const classAvgScore = totalStudents > 0
      ? Math.round(completedAttempts.reduce((s, a) => s + a.score, 0) / totalStudents)
      : 0;

    // 各题正确率详情（分母 = 完成人数）
    const questionStatsRaw = quiz.Question.map((q) => {
      const answered = completedAttempts.flatMap((a) => a.QuestionAttempt.filter((ans) => ans.questionId === q.id));
      const correct = answered.filter((a) => a.isCorrect).length;
      return { id: q.id, content: q.content, difficulty: q.difficulty, correctRate: totalStudents > 0 ? Math.round((correct / totalStudents) * 100) : 0 };
    });

    const questionStats = questionStatsRaw.map((qs) => `[${qs.difficulty}] ${qs.content}... 正确率${qs.correctRate}%`).join("\n");
    const weakQuestions = questionStatsRaw.filter((qs) => qs.correctRate < 60).map((qs) => `${qs.content}...（${qs.correctRate}%）`).join("\n");
    const lowScoreStudents = completedAttempts.filter((a) => a.score < passScore).map((a) => `${a.User.name}（${a.score}分）`).join("\n");
    const highScoreStudents = completedAttempts.filter((a) => a.score >= 90).map((a) => `${a.User.name}（${a.score}分）`).join("\n");

    // 分数分布
    const scoreBuckets = [
      { label: "90-100", min: 90, max: 100 }, { label: "70-89", min: 70, max: 89 },
      { label: "60-69", min: 60, max: 69 }, { label: "40-59", min: 40, max: 59 }, { label: "<40", min: 0, max: 39 },
    ];
    const bucketCounts = scoreBuckets.map((b) => ({
      label: b.label, count: completedAttempts.filter((a) => a.score >= b.min && a.score <= b.max).length,
    }));
    const scoreDistribution = bucketCounts.map((b) => `${b.label}分：${b.count}人`).join("\n");

    // 获取选中的模板（备用，当 analysisPrompt 字段为空时使用）
    let templateContent: string | null = null;
    if (templateId) {
      const template = await prisma.analysisTemplate.findUnique({ where: { id: templateId } });
      if (template && template.teacherId === String(payload.userId)) {
        templateContent = template.content;
      }
    }
    if (!templateContent) {
      const defaultTemplate = await prisma.analysisTemplate.findFirst({
        where: { teacherId: String(payload.userId), type: "QUIZ_ANALYSIS", isDefault: true },
      });
      templateContent = defaultTemplate?.content || null;
    }

    // 最终使用的提示词：
    // - 前端显式传了 templateId → 强制使用所选模板内容（覆盖作业级提示词）
    // - 未传 templateId → 回退到作业级提示词（quiz.analysisPrompt），再回退到默认模板
    const effectivePrompt = templateId
      ? templateContent
      : (quiz.analysisPrompt || templateContent);

    // 检测提示词是否为 HTML 格式（含 HTML 标签或图表指令）
    const isHtmlOutput = effectivePrompt ? (
      effectivePrompt.includes('<!DOCTYPE') ||
      effectivePrompt.includes('<html') ||
      effectivePrompt.includes('<div') ||
      effectivePrompt.includes('echarts') ||
      effectivePrompt.includes('ECharts') ||
      effectivePrompt.includes('chart') ||
      effectivePrompt.toLowerCase().includes('html')
    ) : false;

    // 构建 prompt：系统框架 + 数据段 + 自定义模板段
    const dataSection = [
      "## 检测信息",
      `作业名称：${quiz.title}`,
      `班级：本班`,
      `参与人数：${totalStudents}人`,
      `合格线：${passScore}分`,
      `班级平均分：${classAvgScore}分`,
      "",
      "## 各题正确率",
      questionStats,
      "",
      "## 薄弱题目（正确率<60%）",
      weakQuestions || "无",
      "",
      `## 低分学生（<${passScore}分）`,
      lowScoreStudents || "无",
      "",
      "## 高分学生（≥90分）",
      highScoreStudents || "无",
      "",
      "## 分数分布",
      scoreDistribution,
    ].join("\n");

    const systemFrame = `你是一位资深学科教师，请根据以下班级的课堂作业答题数据，生成一份专业的班级学情分析报告。

分析要求：
1. 班级整体对本次作业的掌握情况（优秀/良好/一般/较差）
2. 根据各题正确率，分析薄弱知识点和共性问题
3. 针对薄弱点提出2-3条后续教学改进建议
4. 对低分学生给出关注和帮扶建议`;

    // 模板变量替换（统一驼峰格式，兼容旧点号格式）
    const quizAnalysisVars: Record<string, string> = {
      "quizTitle": quiz.title,
      "quiz.title": quiz.title,
      "className": "本班",
      "totalStudents": String(totalStudents),
      "classSize": String(totalStudents),
      "classAvgScore": `${classAvgScore}分`,
      "passScore": `${passScore}分`,
      "questionStats": questionStats || "无",
      "weakQuestions": weakQuestions || "无",
      "lowScoreStudents": lowScoreStudents || "无",
      "highScoreStudents": highScoreStudents || "无",
      "scoreDistribution": scoreDistribution || "无",
    };

    const templateSection = effectivePrompt
      ? `\n\n## 教师自定义分析要求\n${replaceQuizAnalysisVars(effectivePrompt, quizAnalysisVars)}`
      : "";

    const aiConfig = await getAIConfig();
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
    
    // 只有当 wordLimit 存在时才设置 max_tokens
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
      return NextResponse.json({ error: "AI 分析失败" }, { status: 500 });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // 保存到 AIInsight（使用班级ID，不是task ID）
    // 优先使用前端传递的 classId，否则使用第一个班级
    const saveClassId = classId || quiz.SubProject?.task?.assignments?.[0]?.classId;
    if (saveClassId) {
      // 获取已有版本数量，用于设置新版本号
      const existingCount = await prisma.aIInsight.count({
        where: { type: "quiz_class", classId: saveClassId, scopeId: id },
      });
      
      // 清理 content 中的 ```html 和 ``` 标记
      let cleanContent = content;
      if (cleanContent.startsWith("```html")) {
        cleanContent = cleanContent.slice(7);
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith("```")) {
        cleanContent = cleanContent.slice(0, -3);
      }
      
      // 创建新版本（不删除旧版本）
      await prisma.aIInsight.create({
        data: {
          type: "quiz_class",
          classId: saveClassId,
          scopeId: id,
          content: cleanContent.trim(),
          version: existingCount + 1,
        },
      });
    } else {
      console.warn("未找到班级ID，无法保存AI报告");
    }

    return NextResponse.json({ content });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("生成AI报告失败:", message);
    return NextResponse.json({ error: "生成失败: " + message }, { status: 500 });
  }
}
