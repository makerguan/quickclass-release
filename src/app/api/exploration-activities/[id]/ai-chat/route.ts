import { NextRequest } from "next/server";
import { streamText } from "ai";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { buildAiCompanionSystemPrompt } from "@/lib/prompts/ai-companion";
import { buildImageInjection } from "@/lib/image-library";

// POST: 学生AI伴学对话（流式），并在流结束后保存对话记录
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    // 验证探究是否启用AI伴学
    const exploration = await prisma.explorationActivity.findUnique({
      where: { id },
      include: {
        SubProject: {
          include: { task: true },
        },
      },
    });

    if (!exploration) {
      return new Response("探究不存在", { status: 404 });
    }

    if (!exploration.enableAiCompanion) {
      return new Response("AI伴学未启用", { status: 403 });
    }

    const { message, chatHistory, context } = await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return new Response("消息不能为空", { status: 400 });
    }

    const userId = String(payload.userId);

    // 构建system prompt（结合预生成提示词+实时上下文）
    let systemPrompt = buildAiCompanionSystemPrompt({
      aiCompanionPrompt: exploration.aiCompanionPrompt,
      title: exploration.title,
      description: exploration.description || undefined,
      taskTitle: exploration.SubProject?.task?.title,
      taskObjectives: exploration.SubProject?.task?.objectives,
      context: context || {},
    });

    // 课堂引用的图片组：AI 伴学可智能发送组内图片（与 chat 路由同款注入）
    try {
      const task = exploration.SubProject?.task;
      if (task) {
        const imageInjection = await buildImageInjection(
          (task as any).imageGroupIds,
          task.teacherId
        );
        if (imageInjection) {
          systemPrompt += imageInjection;
        }
      }
    } catch {
      // 图片组注入失败，忽略（不影响对话）
    }

    const { chatModel } = await createDashScopeClient();

    // 构建消息列表
    const formattedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      for (const m of chatHistory) {
        if (m && m.role && m.content) {
          formattedMessages.push({
            role: m.role as "user" | "assistant",
            content: String(m.content),
          });
        }
      }
    }
    // 确保最后一条是用户当前消息
    if (
      formattedMessages.length === 0 ||
      formattedMessages[formattedMessages.length - 1].content !== message
    ) {
      formattedMessages.push({ role: "user", content: message });
    }

    // 立即保存用户消息到数据库
    await prisma.aiCompanionMessage.create({
      data: {
        explorationId: id,
        studentId: userId,
        role: "user",
        content: message,
      },
    });

    const encoder = new TextEncoder();
    let streamError: Error | null = null;
    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        try {
          const result = await aiQueue.enqueue(async () => {
            return streamText({
              model: chatModel,
              system: systemPrompt,
              messages: formattedMessages,
              // 统一输出上限 64K（网关默认 4096 会截断长输出，实测硬上限 65536）
              maxOutputTokens: 65536,
              onError: ({ error }: { error: unknown }) => {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.error("[ai-chat] streamText onError:", errMsg);
                streamError = error instanceof Error ? error : new Error(errMsg);
              },
            });
          });

          for await (const chunk of result.textStream) {
            fullContent += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          await result.consumeStream();

          // AI SDK v6 在 403 等错误时可能不抛异常但流为空，主动检查
          if (fullContent.trim() === "" && !streamError) {
            streamError = new Error("AI服务返回空响应，可能是配额不足或服务异常");
            console.error("[ai-chat] 流为空但无错误，判定为配额/服务问题");
          }

          // 流结束后保存AI回复到数据库
          if (fullContent.trim()) {
            try {
              await prisma.aiCompanionMessage.create({
                data: {
                  explorationId: id,
                  studentId: userId,
                  role: "assistant",
                  content: fullContent,
                },
              });
            } catch (dbErr) {
              console.error("[ai-chat] 保存AI回复失败:", dbErr);
            }
          }
        } catch (error: any) {
          const errMsg =
            error instanceof Error ? error.message : "AI响应出错";
          console.error("[ai-chat] 错误:", errMsg);
          if (!streamError) streamError = error instanceof Error ? error : new Error(errMsg);
          const errorMsg = `抱歉，AI响应失败：${errMsg}`;
          controller.enqueue(encoder.encode(errorMsg));
          try {
            await prisma.aiCompanionMessage.create({
              data: {
                explorationId: id,
                studentId: userId,
                role: "assistant",
                content: `[错误] ${errMsg}`,
              },
            });
          } catch {}
        } finally {
          // 关键修复：AI SDK v6 在 403/配额等错误时 for-await 不会抛异常。
          // 通过 onError 回调 + finally 兜底逻辑确保错误能传递给客户端。
          if (streamError) {
            const errMsg = streamError.message;
            // ⛔ DO NOT REVERT: 本项目 streamText 固定 maxOutputTokens=65536（见上方调用处），
            // 部署点若配了输出上限 <64K 的模型（如 deepseek-flash 上限 32768），网关返回
            // 400 InternalError.Algo.InvalidParameter: "Range of max tokens should be [1, 32768]"，
            // 原样透传学生看不懂（2026-10-21 课堂实测）→ 必须译成人话并给行动指引。
            // 🔗 RELATED: src/app/api/chat/route.ts 空流分支有同款判断，两处须同步。
            const userFriendlyMsg = /max.?tokens|InvalidParameter/i.test(errMsg)
              ? "抱歉，AI 模型输出上限设置超限，请联系老师，更换 64K 及以上大模型。"
              : errMsg.includes("quota") || errMsg.includes("配额") || errMsg.includes("free")
              ? "抱歉，AI 服务配额已用完，请稍后再试或联系管理员补充配额。"
              : `抱歉，AI 服务响应异常：${errMsg.slice(0, 100)}`;
            try {
              controller.enqueue(encoder.encode(userFriendlyMsg));
            } catch (e) {
              // controller 可能已关闭，忽略
            }
            try {
              await prisma.aiCompanionMessage.create({
                data: {
                  explorationId: id,
                  studentId: userId,
                  role: "assistant",
                  content: `[AI错误] ${errMsg}`,
                },
              });
            } catch {}
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: any) {
    console.error("[ai-chat] 错误:", error?.message || error);
    return new Response(
      JSON.stringify({ error: error?.message || "对话失败" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}