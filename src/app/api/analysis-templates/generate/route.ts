import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { generateText } from "ai";
import { aiQueue } from "@/lib/ai-queue";
import {
  AI_WRITE_SUPPORTED_TYPES,
  CONVERSATION_VARIABLES,
  QUIZ_DESIGN_VARIABLES,
  QUIZ_ANALYSIS_VARIABLES,
  EXPLORATION_ANALYSIS_VARIABLES,
  buildConversationPrompts,
  buildQuizDesignPrompts,
  buildQuizAnalysisPrompts,
  buildExplorationPrompts,
  buildInsightPrompts,
  buildInsightVariableList,
  validateTemplateVariables,
  stripCodeFence,
  type InsightTemplateType,
  type InsightWriteMode,
  type InsightReportStyle,
} from "@/lib/template-writing-guide";

/** 生成模式（无初稿）必须提供意图，各类型给教师可读懂的提示 */
const INTENT_REQUIRED_HINT: Record<string, string> = {
  conversation: "请先用一句话描述你想让这段对话怎么教",
  QUIZ_DESIGN: "请先用一句话描述你想让这份作业怎么出",
  student: "请先用一句话描述你想让学生学情分析重点看什么",
  class: "请先用一句话描述你想让全班学情分析重点看什么",
  QUIZ_ANALYSIS: "请先用一句话描述你想让这份作业分析重点看什么",
  EXPLORATION_ANALYSIS: "请先用一句话描述你想让探究分析重点看什么",
};

/**
 * AI 帮我写模板（支持 conversation 对话设计 + QUIZ_DESIGN 课堂作业设计 + student/class 学情分析
 *   + QUIZ_ANALYSIS 课堂作业分析 + EXPLORATION_ANALYSIS 互动探究分析）
 * POST /api/analysis-templates/generate
 * body: { type, intent, currentContent?, mode?, scope?, style? }
 * - currentContent 为空：生成模式（凭教师意图从零生成）
 * - currentContent 非空：优化模式（以教师初稿为基础改写，不推翻其设计）
 * - mode="generic"|"custom"（通用/个性）与 style="text"|"html"（文本型/网页型）对三类模板生效：
 *   student/class 学情分析（generic 必须另选 scope="task"|"pc"，变量清单按作用域裁剪）
 *   QUIZ_ANALYSIS / EXPLORATION_ANALYSIS（无 scope 维度；⚠️ 输出形态判定：html 版模板正文必须含
 *   <!DOCTYPE html> 供运行时 isHtmlOutput 关键词识别；text 版避免 HTML 结构特征词（<!DOCTYPE、<html、
 *   <div、echarts、html 等），chart 已不再嗅探，不写任何格式代码或示例块——见 buildAnalysisWritingRules 注释）
 *
 * 质量护栏（学 /api/tasks/generate-objectives 的校验+重试范式）：
 * 生成后代码级校验 {变量} 全部在类型清单内，越界则把越界变量反馈给 AI 自动重试 1 次；
 * 仍越界不阻断，返回 content + warning（运行时会把这些变量替换为空串，教师需手动修正）。
 * 写作知识（变量清单/骨架/范例）统一来自 src/lib/template-writing-guide.ts。
 * 🔗 RELATED：前端入口在 src/app/teacher/templates/page.tsx 模板编辑弹窗。
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
    const { type, intent, currentContent, mode, scope, style } = body as {
      type?: string;
      intent?: string;
      currentContent?: string;
      mode?: string;
      scope?: string;
      style?: string;
    };

    if (!type || !(AI_WRITE_SUPPORTED_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: "该模板类型暂不支持 AI 生成（当前支持：对话设计、课堂作业设计、学生个人学情、全班学情、课堂作业分析、互动探究分析）" },
        { status: 400 }
      );
    }

    const trimmedIntent = typeof intent === "string" ? intent.trim() : "";
    const trimmedCurrent =
      typeof currentContent === "string" ? currentContent.trim() : "";
    const isOptimize = trimmedCurrent.length > 0;

    // 生成模式必须有意图，否则只能产出与默认模板雷同的通用模板
    if (!isOptimize && !trimmedIntent) {
      return NextResponse.json(
        { error: INTENT_REQUIRED_HINT[type] || "请先用一句话描述你的想法" },
        { status: 400 }
      );
    }

    // 按 type 分发到对应类型的知识库拼装与变量清单（知识库见 template-writing-guide.ts）
    let system: string;
    let user: string;
    let allowedNames: string[];
    if (type === "student" || type === "class") {
      // 学情分析：generic 通用模板必须选作用域（变量清单按作用域裁剪，防引用另一作用域无效变量）；
      // custom 个性模板作用域由 AI 按意图判断，变量清单为全量合集（分组语义见知识库）
      const writeMode: InsightWriteMode = mode === "custom" ? "custom" : "generic";
      const insightScope =
        writeMode === "generic" ? (scope === "pc" ? "pc" : scope === "task" ? "task" : null) : undefined;
      if (writeMode === "generic" && !insightScope) {
        return NextResponse.json(
          { error: "通用模板请先选择适用范围（课堂级 / 对话活动级）" },
          { status: 400 }
        );
      }
      const insightType = type as InsightTemplateType;
      // 报告样式：html=网页型（模板要求分析 AI 输出完整 HTML 文档）；其余一律按纯文本处理
      const reportStyle: InsightReportStyle = style === "html" ? "html" : "text";
      ({ system, user } = buildInsightPrompts(
        insightType,
        trimmedIntent,
        writeMode,
        insightScope ?? undefined,
        trimmedCurrent,
        reportStyle
      ));
      allowedNames = buildInsightVariableList(insightType, insightScope ?? undefined).map(
        (v) => v.name
      );
    } else if (type === "QUIZ_ANALYSIS" || type === "EXPLORATION_ANALYSIS") {
      // 分析报告类：模板正文运行时作为「教师自定义分析要求」追加在平台默认分析框架之后
      // （变量契约见知识库段首 CONTRACT 注释：与两个报告生成路由的替换表严格一致）
      // mode/style 与学情分析同维度（通用/个性 × 文本/网页）；⚠️ 触发词契约见知识库
      // buildAnalysisWritingRules 注释：html 版正文含 <!DOCTYPE html>，text 版严禁 chart/html 字样
      const analysisMode: InsightWriteMode = mode === "custom" ? "custom" : "generic";
      const reportStyle: InsightReportStyle = style === "html" ? "html" : "text";
      ({ system, user } =
        type === "QUIZ_ANALYSIS"
          ? buildQuizAnalysisPrompts(trimmedIntent, trimmedCurrent, analysisMode, reportStyle)
          : buildExplorationPrompts(trimmedIntent, trimmedCurrent, analysisMode, reportStyle));
      allowedNames = (
        type === "QUIZ_ANALYSIS"
          ? QUIZ_ANALYSIS_VARIABLES
          : EXPLORATION_ANALYSIS_VARIABLES
      ).map((v) => v.name);
    } else {
      ({ system, user } =
        type === "QUIZ_DESIGN"
          ? buildQuizDesignPrompts(trimmedIntent, trimmedCurrent)
          : buildConversationPrompts(trimmedIntent, trimmedCurrent));
      allowedNames = (
        type === "QUIZ_DESIGN" ? QUIZ_DESIGN_VARIABLES : CONVERSATION_VARIABLES
      ).map((v) => v.name);
    }

    const { chatModel } = await createDashScopeClient();

    const callAI = (p: string) =>
      aiQueue.enqueue(async () =>
        generateText({
          model: chatModel,
          system,
          messages: [{ role: "user", content: p }],
          // 统一输出上限 64K（网关默认 4096 会截断长输出，实测硬上限 65536）
          maxOutputTokens: 65536,
        })
      );

    const result = await callAI(user);
    if (!result.text || !result.text.trim()) {
      return NextResponse.json({ error: "AI 未返回有效内容，请重试" }, { status: 500 });
    }

    let finalText = stripCodeFence(result.text.trim());
    let validation = validateTemplateVariables(finalText, allowedNames);

    // 变量校验失败：反馈越界变量自动重试一次
    if (!validation.valid) {
      console.log(
        `[analysis-templates/generate] 变量校验失败（${type}）: ${validation.invalid.join("、")}，自动重试`
      );
      const retryPrompt = `${user}

你上一次输出的模板中使用了以下清单外的无效变量：${validation.invalid.map((v) => `{${v}}`).join("、")}。
无效变量在运行时会被替换成空字符串，严禁使用。请改用清单内变量（${allowedNames.map((v) => `{${v}}`).join("、")}）或改用文字描述，重新输出完整模板正文。`;

      const retryResult = await callAI(retryPrompt);
      if (retryResult.text && retryResult.text.trim()) {
        const retryText = stripCodeFence(retryResult.text.trim());
        const retryValidation = validateTemplateVariables(retryText, allowedNames);
        if (retryValidation.valid) {
          finalText = retryText;
          validation = retryValidation;
        }
      }
    }

    return NextResponse.json({
      content: finalText,
      warning: validation.valid
        ? undefined
        : `模板中仍有清单外变量（${validation.invalid.map((v) => `{${v}}`).join("、")}），运行时会被替换为空，请手动修正`,
    });
  } catch (error) {
    console.error("AI 生成模板失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 服务错误，请检查配置" },
      { status: 500 }
    );
  }
}
