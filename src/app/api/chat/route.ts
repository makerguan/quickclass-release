import { NextRequest } from "next/server";
import { streamText } from "ai";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";
import { dbWrite } from "@/lib/db-queue";
import {
  getClassPromptByStrategy,
  IMAGE_NOTICE,
  MATERIAL_CONTENT_PREFIX,
} from "@/lib/prompts";

// 多模态消息内容类型
type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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

    // 两个读查询并行（无数据依赖）
    const classDataPromise = prisma.class.findUnique({
      where: { id: classId },
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
    const [classData, materials, presetConv] = await Promise.all([
      classDataPromise,
      materialsPromise,
      presetConvPromise,
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
    }

    // 写操作 2：保存用户消息（依赖 convId 已确定）
    await dbWrite(() =>
      prisma.message.create({
        data: {
          conversationId: convId!,
          role: "user",
          content: hasImageContent(lastMessage.content)
            ? textContent + " [包含图片]"
            : textContent,
        },
      })
    );

    let systemPrompt = "";

    if (presetConv) {
      const task = presetConv.SubProject.task;

      // 构建对话活动的系统提示：硬编码标题 + 用户提示词 + 知识库
      systemPrompt = `## 当前课堂：${task.title}\n`;
      systemPrompt += `年级：${task.grade || ''}  学科：${task.subject || ''}\n`;
      systemPrompt += `课堂目标：${task.objectives}\n`;

      // 知识库（课堂级）
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

      // 对话目标 + 用户自定义提示词
      systemPrompt += `\n对话目标：${presetConv.description || ''}\n`;
      if (presetConv.systemPrompt) {
        systemPrompt += `${presetConv.systemPrompt}\n`;
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
    }

    // 如果消息包含图片，提示 AI 可以分析图片
    if (hasImageContent(lastMessage.content)) {
      systemPrompt += `\n${IMAGE_NOTICE}\n`;
    }

    const { chatModel } = await createDashScopeClient();

    // 构建消息格式，支持多模态
    const formattedMessages = messages.map((m: ChatMessage) => {
      if (typeof m.content === "string") {
        return { role: m.role as "user" | "assistant", content: m.content };
      }
      // 多模态消息：将 image_url 转为 ai v6 SDK 的 image 格式
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
        try {
          const result = await aiQueue.enqueue(async () => {
            return streamText({
              model: chatModel,
              system: systemPrompt,
              messages: formattedMessages,
            });
          });

          for await (const chunk of result.textStream) {
            chunkCount++;
            fullContent += chunk;
            controller.enqueue(encoder.encode(chunk));
          }

          // 检测空响应：streamText 可能无异常返回空流
          if (chunkCount === 0) {
            const errMsg = "AI 模型返回了空响应（可能不支持图片输入，请检查模型配置）";
            console.error("Empty stream:", errMsg);
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
