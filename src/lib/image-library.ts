import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

// 图片库物理存储目录：uploads/image-library/{groupId}/{cuid}.{ext}
export const IMAGE_LIBRARY_DIR = path.join(process.cwd(), "uploads", "image-library");

export function ensureGroupDir(groupId: string): string {
  const dir = path.join(IMAGE_LIBRARY_DIR, groupId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 删除整个图片组的物理目录（删组时调用，忽略不存在） */
export function deleteGroupDir(groupId: string) {
  const dir = path.join(IMAGE_LIBRARY_DIR, groupId);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error("删除图片组目录失败:", groupId, e);
  }
}

/** 删除单张图片物理文件（删图时调用，忽略不存在） */
export function deleteImageFile(groupId: string, filename: string) {
  const p = path.join(IMAGE_LIBRARY_DIR, groupId, filename);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error("删除图片文件失败:", filename, e);
  }
}

/** 读取图片物理文件内容（读图 API 用），不存在返回 null */
export function readImageFile(groupId: string, filename: string): Buffer | null {
  const p = path.join(IMAGE_LIBRARY_DIR, groupId, filename);
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/**
 * 构建注入 systemPrompt 的可用图片清单（对齐知识库注入模式）。
 * 课堂引用了图片组时，把组内每张图的 Markdown 图片语法 + 描述拼成清单，
 * AI 据此在合适的时机输出 ![描述](/api/images/{id}?token=...) 发给学生。
 * 返回空串表示无可用图片（不注入）。
 */
export async function buildImageInjection(
  imageGroupIds: string | null | undefined,
  teacherId: string
): Promise<string> {
  if (!imageGroupIds) return "";
  let groupIds: string[] = [];
  try {
    const parsed = JSON.parse(imageGroupIds);
    if (Array.isArray(parsed)) groupIds = parsed.map(String);
  } catch {
    return "";
  }
  if (groupIds.length === 0) return "";

  const groups = await prisma.imageGroup.findMany({
    where: { id: { in: groupIds }, teacherId, enabled: true },
    include: { images: { orderBy: { createdAt: "asc" } } },
  });
  if (groups.length === 0) return "";

  const sections: string[] = [];
  let total = 0;
  for (const g of groups) {
    if (g.images.length === 0) continue;
    total += g.images.length;
    const lines = g.images.map(
      (img) => `- ![${img.description}](${imageMarkdownUrl(img.id)}) — ${img.description}`
    );
    sections.push(
      `「${g.name}」${g.description ? `（${g.description}）` : ""}：\n${lines.join("\n")}`
    );
  }
  if (total === 0) return "";

  return (
    `\n## 可用教学图片（共 ${total} 张）\n` +
    `你可以在回复中用 Markdown 图片语法把下面的图发给学生（语法：![图片说明](URL)）。\n` +
    `${sections.join("\n")}\n` +
    `使用规则：\n` +
    `1. 只能使用上面清单中的 URL，严禁编造或修改 URL；\n` +
    `2. 图片说明文字使用清单中的描述；\n` +
    `3. 仅在图片与学生当前问题相关时才发送，无关时不发；\n` +
    `4. 发图前后用一两句话自然衔接，不要只发图片。\n`
  );
}

/** 学生端 <img> 实际访问的 URL；token 由前端 Markdown 组件自动追加 */
export function imageMarkdownUrl(imageId: string): string {
  return `/api/images/${imageId}`;
}

/**
 * Mermaid 示意图输出提示（主对话注入）。
 * 学生端 Markdown 组件会把 ```mermaid 代码块渲染成图表，
 * AI 无需外部图片即可"现画"流程图/思维导图/时间轴等示意图。
 */
export const MERMAID_HINT = `

## 示意图能力
讲解流程、关系、结构类内容时（如流程图、思维导图、时间轴、状态转换），可以用 mermaid 代码块画示意图，格式：
\`\`\`mermaid
graph TD
  A[开始] --> B{判断}
  B -->|是| C[结果1]
  B -->|否| D[结果2]
\`\`\`
规则：仅在确有助益时使用（简单内容用文字即可）；语法必须严格正确（节点 id 不用中文，标签内可以中文）；一屏最多一个图。\n`;

/**
 * 上传时用全局配置的 AI 模型自动生成图片描述（多模态模型可用）。
 * 失败（纯文本模型/网络错误）返回 null，由教师手填兜底，不阻塞上传。
 */
export async function generateImageDescription(
  base64: string,
  mediaType: string
): Promise<string | null> {
  try {
    const { generateText } = await import("ai");
    const { createDashScopeClient } = await import("@/lib/ai");
    const { chatModel } = await createDashScopeClient();
    const result = await generateText({
      model: chatModel,
      maxOutputTokens: 200,
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "image" as const, image: base64, mediaType },
            {
              type: "text" as const,
              text:
                "你是教学素材管理员。请用一句话（40字内）描述这张教学图片：图中展示了什么知识点/概念、有哪些关键视觉元素，让 AI 助教能据此判断学生在讨论什么话题时适合展示此图。只输出描述本身，不要任何前缀和解释。",
            },
          ],
        },
      ],
    });
    const desc = (result.text || "").trim().replace(/^["'"「]|["'"」]$/g, "");
    return desc ? desc.slice(0, 100) : null;
  } catch (e) {
    console.error("[image-library] 自动生成图片描述失败（将由教师手填）:", e);
    return null;
  }
}
