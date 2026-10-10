import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { generateText } from "ai";
import { aiQueue } from "@/lib/ai-queue";
import {
  AI_WRITE_SUPPORTED_TYPES,
  CONVERSATION_VARIABLES,
  QUIZ_DESIGN_VARIABLES,
  buildConversationPrompts,
  buildQuizDesignPrompts,
  validateTemplateVariables,
  stripCodeFence,
} from "@/lib/template-writing-guide";

/** 生成模式（无初稿）必须提供意图，各类型给教师可读懂的提示 */
const INTENT_REQUIRED_HINT: Record<string, string> = {
  conversation: "请先用一句话描述你想让这段对话怎么教",
  QUIZ_DESIGN: "请先用一句话描述你想让这份作业怎么出",
};

/**
 * AI 帮我写模板（支持 conversation 对话设计 + QUIZ_DESIGN 课堂作业设计）
 * POST /api/analysis-templates/generate
 * body: { type: "conversation" | "QUIZ_DESIGN", intent: string, currentContent?: string }
 * - currentContent 为空：生成模式（凭教师意图从零生成）
 * - currentContent 非空：优化模式（以教师初稿为基础改写，不推翻其设计）
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
    const { type, intent, currentContent } = body as {
      type?: string;
      intent?: string;
      currentContent?: string;
    };

    if (!type || !(AI_WRITE_SUPPORTED_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: "该模板类型暂不支持 AI 生成（当前支持：对话设计、课堂作业设计）" },
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
    const { system, user } =
      type === "QUIZ_DESIGN"
        ? buildQuizDesignPrompts(trimmedIntent, trimmedCurrent)
        : buildConversationPrompts(trimmedIntent, trimmedCurrent);
    const allowedNames = (
      type === "QUIZ_DESIGN" ? QUIZ_DESIGN_VARIABLES : CONVERSATION_VARIABLES
    ).map((v) => v.name);

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
