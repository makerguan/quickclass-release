import { NextRequest } from "next/server";
import { streamText } from "ai";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { buildImageInjection, MERMAID_HINT } from "@/lib/image-library";
import { aiQueue } from "@/lib/ai-queue";
import { dbWrite } from "@/lib/db-queue";
import {
  getClassPromptByStrategy,
  IMAGE_NOTICE,
  MATERIAL_CONTENT_PREFIX,
  replaceConversationVars,
  type ConversationTemplateVars,
} from "@/lib/prompts";
import { MATH_OUTPUT_RULES } from "@/lib/math-format";

// 多模态消息内容类型
type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "audio_url"; audio_url: { url: string } };

type MessageContent = string | MessageContentPart[];

interface ChatMessage {
  role: string;
  content: MessageContent;
}

// 从消息内容中提取纯文本（用于存储到数据库和关键词匹配）
function extractTextContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

// 检查消息是否包含图片
function hasImageContent(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((part) => part.type === "image_url");
}

// 检查消息是否包含音频
function hasAudioContent(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((part) => part.type === "audio_url");
}

// 判断消息是否为多模态消息（图片 / 音频）
function isMultimodalContent(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((part) => part.type === "image_url" || part.type === "audio_url");
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return new Response("未登录", { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return new Response("登录已过期", { status: 401 });
    }

    const { messages, conversationId, classId, presetConversationId } = await req.json();
    const lastMessage: ChatMessage = messages[messages.length - 1];
    const userId = String(payload.userId);
    const textContent = extractTextContent(lastMessage.content);

    // 如果没有 conversationId，自动创建新的 Conversation（写操作走队列）
    let convId = conversationId;
    const needCreate = !convId;

    // 读查询并行（无数据依赖）
    const classDataPromise = prisma.class.findUnique({
      where: { id: classId },
    });

    // 当前对话学生（用于 {studentName} 变量替换，让 AI 能叫出学生姓名）
    const currentUserPromise = prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const materialsPromise = prisma.material.findMany({
      where: { classId, type: "LEARNING" },
      include: { DocumentChunk: true },
    });

    const presetConvPromise = presetConversationId
      ? prisma.presetConversation.findUnique({
          where: { id: presetConversationId },
          include: {
            SubProject: { include: { task: true } },
          },
        })
      : Promise.resolve(null);

    // 等待读查询完成，再决定写操作
    const [classData, materials, presetConv, currentUser] = await Promise.all([
      classDataPromise,
      materialsPromise,
      presetConvPromise,
      currentUserPromise,
    ]);

    if (!classData) {
      return new Response("班级不存在", { status: 404 });
    }

    // 写操作 1：创建新对话（如需要）
    let createConvResult: { id: string } | null = null;
    if (needCreate) {
      createConvResult = await dbWrite(() =>
        prisma.conversation.create({
          data: {
            userId,
            classId,
            presetConversationId: presetConversationId || null,
            title: textContent.slice(0, 50) || "图片对话",
            updatedAt: new Date(),
          },
        })
      );
      convId = createConvResult.id;

      // 写操作 1.5：新会话预置教师开场白（assistant 首条消息，2026-10-13）。
      // ⚠️ 仅 needCreate（新会话）写入一次，复用旧会话不重复插入；
      // 前端首条发言的 apiMessages 已把开场白拼进上下文（见 student/chat sendMessage），两侧口径一致。
      if (presetConv?.openingMessage) {
        await dbWrite(() =>
          prisma.message.create({
            data: {
              conversationId: convId!,
              role: "assistant",
              content: presetConv.openingMessage!,
            },
          })
        );
      }
    }

    // 写操作 2：保存用户消息（依赖 convId 已确定）
    // 多模态消息把完整 JSON 存下来，刷新后仍能显示图片 / 音频
    await dbWrite(() =>
      prisma.message.create({
        data: {
          conversationId: convId!,
          role: "user",
          content: isMultimodalContent(lastMessage.content)
            ? JSON.stringify(lastMessage.content)
            : textContent,
        },
      })
    );

    let systemPrompt = "";

    if (presetConv) {
      const task = presetConv.SubProject.task;

      // 构建对话活动的系统提示：教师模板变量替换 + 知识库自动追加（与学情分析一致）
      const vars: ConversationTemplateVars = {
        pcTitle: presetConv.title,
        pcDescription: presetConv.description || "",
        activeCount: 0,
        totalStudents: 0,
        studentName: currentUser?.name || "",
        taskTitle: task.title,
        taskDescription: task.objectives || "",
        taskGrade: task.grade || "",
        taskSubject: task.subject || "",
      };

      const teacherTemplate = presetConv.systemPrompt || "";

      // 1. 教师对话提示词运行时变量替换（isStudent=true 注入学生姓名）
      systemPrompt = replaceConversationVars(teacherTemplate, vars, true);

      // 2. 兜底：教师模板未引用任何课堂信息变量时，自动追加基础课堂信息
      const hasTaskInfo = /\{taskTitle\}|\{taskGrade\}|\{taskSubject\}|\{taskDescription\}|\{taskObjectives\}/.test(
        teacherTemplate
      );
      if (!hasTaskInfo) {
        systemPrompt =
          `## 当前课堂：${task.title}\n` +
          `年级：${task.grade || ''}  学科：${task.subject || ''}\n` +
          `课堂目标：${task.objectives || ''}\n\n` +
          systemPrompt;
      }

      // 3. 知识库（课堂级，数据内容由软件自动追加）
      if (task.knowledgeBase) {
        systemPrompt += `\n## 课堂知识库：\n${task.knowledgeBase}\n`;
      }
      if (task.knowledgeBaseIds) {
        try {
          const kbIds = JSON.parse(task.knowledgeBaseIds) as string[];
          if (kbIds.length > 0) {
            const knowledgeBases = await prisma.knowledgeBase.findMany({
              where: { id: { in: kbIds }, teacherId: task.teacherId },
            });
            for (const kb of knowledgeBases) {
              systemPrompt += `\n## 知识库「${kb.name}」：\n${kb.content}\n`;
            }
          }
        } catch {
          // knowledgeBaseIds 解析失败，忽略
        }
      }

      // 3.5 图片组（课堂级，AI 可在回复中用 Markdown 图片语法发送组内图片）
      try {
        const imageInjection = await buildImageInjection(
          task.imageGroupIds,
          task.teacherId
        );
        if (imageInjection) {
          systemPrompt += imageInjection;
        }
      } catch {
        // 图片组注入失败，忽略（不影响对话）
      }

      // 3.6 Mermaid 示意图能力（前端 Markdown 组件渲染 ```mermaid 代码块）
      systemPrompt += MERMAID_HINT;

      // 4. 兜底：教师模板未引用 {pcDescription} 时，自动追加对话目标
      if (presetConv.description && !/\{pcDescription\}/.test(teacherTemplate)) {
        systemPrompt += `\n对话目标：${presetConv.description}\n`;
      }
    } else {
      // 无对话活动，使用原有班级策略
      const strategyPrompt = getClassPromptByStrategy(
        classData.aiPromptStrategy,
        classData.customSystemPrompt ?? undefined
      );
      systemPrompt = strategyPrompt ? `${strategyPrompt}\n\n` : "";

      // 学习材料：全量注入（材料总量通常不大）
      const allChunks = materials.flatMap((m) => m.DocumentChunk);
      if (allChunks.length > 0) {
        systemPrompt += `${MATERIAL_CONTENT_PREFIX}\n`;
        allChunks.forEach((chunk, i) => {
          systemPrompt += `[片段${i + 1}] ${chunk.content}\n`;
        });
      }

      // Mermaid 示意图能力（前端 Markdown 组件渲染 ```mermaid 代码块）
      systemPrompt += MERMAID_HINT;
    }

    // 如果消息包含图片，提示 AI 可以分析图片
    if (hasImageContent(lastMessage.content)) {
      systemPrompt += `\n${IMAGE_NOTICE}\n`;
    }

    // 统一数学公式输出格式：要求模型使用 $...$ / $$...$$ 定界符，
    // 否则模型可能输出 \(...\) / \[...\]，前端会当作普通文本，学生看到 LaTeX 源码
    systemPrompt += `\n\n${MATH_OUTPUT_RULES}`;

    const { chatModel } = await createDashScopeClient();

    // 构建消息格式，支持多模态
    const formattedMessages = messages.map((m: ChatMessage) => {
      if (typeof m.content === "string") {
        return { role: m.role as "user" | "assistant", content: m.content };
      }
      // 多模态消息：将 image_url / audio_url 转为 ai v6 SDK 的多模态格式
      const parts = m.content.map((part) => {
        if (part.type === "image_url") {
          const url = part.image_url.url;
          // 如果是 Base64 data URL，提取编码数据
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
              return {
                type: "image" as const,
                image: match[2], // 纯 base64 字符串
                mediaType: match[1],
              };
            }
          }
          // 如果是 URL 图片
          return {
            type: "image" as const,
            image: url,
            mediaType: "image/jpeg",
          };
        }
        if (part.type === "audio_url") {
          const url = part.audio_url.url;
          // 如果是 Base64 data URL，提取编码数据
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(audio\/\w+);base64,(.+)$/);
            if (match) {
              return {
                type: "audio" as const,
                audio: match[2],
                mediaType: match[1],
              };
            }
          }
          // 如果是 URL 音频
          return {
            type: "audio" as const,
            audio: url,
            mediaType: "audio/mpeg",
          };
        }
        return { type: "text" as const, text: part.text };
      });
      return { role: m.role as "user" | "assistant", content: parts };
    });

    const finalConvId = convId;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullContent = "";
        let chunkCount = 0;
        let streamError: Error | null = null;

        // 单次流式请求。AI SDK v6 在 429 限流/403 配额等错误时 for-await 不抛异常、
        // 流为空，必须借 onError 回调才能拿到真实错误（与 exploration ai-chat 路由同款防护）
        const runStream = async () => {
          const result = await aiQueue.enqueue(async () => {
            return streamText({
              model: chatModel,
              system: systemPrompt,
              messages: formattedMessages,
              // 统一输出上限 64K（网关默认 4096 会截断长输出，实测硬上限 65536）
              maxOutputTokens: 65536,
              onError: ({ error }: { error: unknown }) => {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.error("[chat] streamText onError:", errMsg);
                streamError = error instanceof Error ? error : new Error(errMsg);
              },
            });
          });

          for await (const chunk of result.textStream) {
            chunkCount++;
            fullContent += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          await result.consumeStream();

          // 空流时记录结束原因，便于区分限流/内容审核/截断
          if (chunkCount === 0) {
            try {
              const reason = await Promise.race([
                result.finishReason,
                new Promise<string>((r) => setTimeout(() => r("未知（获取超时）"), 2000)),
              ]);
              console.warn("[chat] 流为空，finishReason:", reason);
            } catch {}
          }
        };

        try {
          await runStream();

          // 空流自动重试一次：此时客户端尚未收到任何内容，重试无副作用；
          // 偶发的限流（429）/网关抖动导致的空流，重试大概率恢复
          if (chunkCount === 0) {
            console.warn("[chat] AI 返回空流，自动重试一次");
            await runStream();
          }

          // 重试后仍为空：按真实原因提示，不再一律归咎于图片输入
          if (chunkCount === 0) {
            // streamError 仅在 onError 回调内赋值，控制流分析会把它收窄为 null，需断言
            const raw = (streamError as Error | null)?.message || "";
            let errMsg: string;
            if (raw) {
              errMsg = /quota|配额|free|429|rate|limit/i.test(raw)
                ? "AI 服务繁忙（限流或配额不足），请稍后重试"
                : `AI 服务响应异常：${raw.slice(0, 100)}`;
            } else if (hasAudioContent(lastMessage.content)) {
              errMsg = "AI 模型返回了空响应（可能不支持音频输入，请检查模型配置）";
            } else if (hasImageContent(lastMessage.content)) {
              errMsg = "AI 模型返回了空响应（可能不支持图片输入，请检查模型配置）";
            } else {
              errMsg = "AI 模型返回了空响应，请重新发送试试";
            }
            console.error("[chat] Empty stream:", errMsg, raw);
            controller.enqueue(encoder.encode(errMsg));
            fullContent = errMsg;
          }
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : "AI 响应出错";
          console.error("Stream/API error:", errMsg);
          controller.enqueue(encoder.encode(`\n\n**AI 响应出错**：${errMsg}`));
          fullContent += `\n\n**AI 响应出错**：${errMsg}`;
        } finally {
          controller.close();
          if (fullContent) {
            try {
              await dbWrite(() =>
                prisma.message.create({
                  data: {
                    conversationId: finalConvId,
                    role: "assistant",
                    content: fullContent,
                  },
                })
              );
              await dbWrite(() =>
                prisma.conversation.update({
                  where: { id: finalConvId },
                  data: { updatedAt: new Date() },
                })
              );
            } catch (dbError) {
              console.error("Save AI reply error:", dbError);
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Conversation-Id": finalConvId,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "对话失败";
    console.error("Chat error:", errMsg, error instanceof Error ? error.stack : "");
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
