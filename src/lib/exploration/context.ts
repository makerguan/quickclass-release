import { prisma } from "@/lib/prisma";

export interface SubProjectContext {
  taskTitle: string;
  taskDesc: string;
  knowledgeContent: string;
}

/**
 * 拉取互动探究/问卷生成所需的课堂上下文：
 * 课堂主题、目标、知识库内容（用于注入 AI 生成提示）。
 * 返回 null 表示课堂不存在。
 */
export async function getSubProjectContext(
  subProjectId: string
): Promise<SubProjectContext | null> {
  const sp = await prisma.subProject.findUnique({
    where: { id: subProjectId },
    include: {
      task: {
        select: {
          title: true,
          description: true,
          objectives: true,
          knowledgeBaseIds: true,
        },
      },
    },
  });
  if (!sp || sp.task.title === undefined) return null;

  let knowledgeContent = "";
  if (sp.task.knowledgeBaseIds) {
    try {
      const kbIds = JSON.parse(sp.task.knowledgeBaseIds) as string[];
      if (kbIds.length > 0) {
        const kbs = await prisma.knowledgeBase.findMany({
          where: { id: { in: kbIds } },
          select: { content: true },
        });
        knowledgeContent = kbs.map((kb) => kb.content).join("\n\n");
      }
    } catch {
      // knowledgeBaseIds 解析失败时忽略
    }
  }

  return {
    taskTitle: sp.task.title,
    taskDesc: sp.task.description || sp.task.objectives || "无",
    knowledgeContent: knowledgeContent || "无",
  };
}
