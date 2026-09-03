import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { generateText } from "ai";
import { aiQueue } from "@/lib/ai-queue";
import {
  getSubjectCompetencies,
  validateObjectiveDimensions,
  describeValidationIssues,
} from "@/lib/subject-competencies";

/**
 * 按学科核心素养生成/优化课堂目标
 * POST /api/tasks/generate-objectives
 * body: { title, grade, subject, currentContent? }
 * - currentContent 为空：生成模式（从零生成）
 * - currentContent 非空：优化模式（以教师初稿为基础优化）
 *
 * 结构约束：目标条数 = 该学科素养维度数，每条与一个维度一一对应（不重复、不编造）。
 * 生成后做代码级校验，不通过则反馈错误自动重试一次；仍不通过则返回 warning 提示。
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    const { title, grade, subject, currentContent } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "请填写课题" }, { status: 400 });
    }
    if (!grade || typeof grade !== "string") {
      return NextResponse.json({ error: "请选择年级" }, { status: 400 });
    }
    if (!subject || typeof subject !== "string") {
      return NextResponse.json({ error: "请选择学科" }, { status: 400 });
    }

    const comp = getSubjectCompetencies(grade, subject);
    if (!comp) {
      return NextResponse.json(
        { error: `暂无「${grade}·${subject}」的学科核心素养映射，请检查年级与学科组合` },
        { status: 400 }
      );
    }

    const isOptimize = typeof currentContent === "string" && currentContent.trim().length > 0;

    const competencyList = comp.competencies
      .map((c) => (c.meaning ? `- ${c.name}：${c.meaning}` : `- ${c.name}`))
      .join("\n");

    const dimensionCount = comp.competencies.length;
    const dimensionNames = comp.competencies.map((c) => c.name).join("、");

    const prompt = `你是一位资深的中小学学科教研专家，精通《义务教育课程标准（2022年版）》和《普通高中课程标准（2017年版2020年修订）》，擅长撰写对齐学科核心素养的课堂目标。

请为以下课堂${isOptimize ? "优化" : "生成"}课堂目标。

课题：${title.trim()}
年级：${grade}（${comp.stage}）
学科：${subject}
${comp.note ? `特别说明：${comp.note}\n` : ""}该学科${comp.stage}阶段的核心素养（依据${comp.standard}）：
${competencyList}

${
  isOptimize
    ? `教师已写有课堂目标初稿：
---
${currentContent.trim()}
---
请在保留教师核心意图与设计思路的基础上进行优化：将初稿内容归入对应的素养维度（同一维度的多条内容合并为一条），初稿未覆盖的素养维度紧扣课题补写，最终恰好 ${dimensionCount} 条目标、每个维度恰好一条；规范行为动词表述，不得推翻教师原有的教学设计。`
    : `请从零生成课堂目标。`
}

要求（必须严格遵守）：
1. 【结构铁律】该学科共有 ${dimensionCount} 个核心素养维度（${dimensionNames}），必须输出恰好 ${dimensionCount} 条课堂目标，与上述维度一一对应：每个维度恰好一条、只出现一次
2. 严禁：同一维度出现两条或更多目标；输出清单之外的素养名称；目标条数多于或少于 ${dimensionCount} 条
3. 每条目标以【素养名称】开头，素养名称必须与清单中的名称逐字一致
4. 使用可观测、可评价的行为动词（如：说出、辨认、比较、归纳、概括、运用、设计、评价、迁移等），符合${grade}学生的认知发展水平
5. 内容紧扣课题「${title.trim()}」，具体可操作，避免空泛套话
6. 直接输出目标内容：每条一行、行首以序号编号（1. 2. 3. …），不要输出任何额外解释`;

    const { chatModel } = await createDashScopeClient();

    const callAI = (p: string) =>
      aiQueue.enqueue(async () =>
        generateText({
          model: chatModel,
          system: "你是一位专业的中小学学科教研专家。输出必须与给定的素养维度严格一一对应。",
          messages: [{ role: "user", content: p }],
        })
      );

    const result = await callAI(prompt);
    if (!result.text || !result.text.trim()) {
      return NextResponse.json({ error: "AI 未返回有效内容，请重试" }, { status: 500 });
    }

    let finalText = result.text.trim();
    let validation = validateObjectiveDimensions(finalText, comp.competencies);

    // 结构校验失败：反馈错误自动重试一次
    if (!validation.valid) {
      const issues = describeValidationIssues(validation);
      console.log(`[generate-objectives] 结构校验失败（${grade}·${subject}）: ${issues}，自动重试`);
      const retryPrompt = `${prompt}

你上一次的输出未通过结构校验，存在以下问题：
${issues
  .split("；")
  .map((i) => `- ${i}`)
  .join("\n")}

上一次的输出：
---
${finalText}
---

请重新输出。务必遵守：恰好 ${dimensionCount} 条目标，每条对应且只对应一个素养维度（${dimensionNames}），每个维度恰好出现一次，素养名称与清单逐字一致。`;

      const retryResult = await callAI(retryPrompt);
      if (retryResult.text && retryResult.text.trim()) {
        const retryText = retryResult.text.trim();
        const retryValidation = validateObjectiveDimensions(retryText, comp.competencies);
        if (retryValidation.valid) {
          finalText = retryText;
          validation = retryValidation;
        }
      }
    }

    return NextResponse.json({
      objectives: finalText,
      warning: validation.valid
        ? undefined
        : `生成结果与学科素养维度未严格一一对应（${describeValidationIssues(validation)}），建议重新生成或手动调整`,
    });
  } catch (error) {
    console.error("生成课堂目标失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 服务错误，请检查配置" },
      { status: 500 }
    );
  }
}
