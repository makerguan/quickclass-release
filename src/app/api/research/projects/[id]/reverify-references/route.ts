/**
 * 重新核查已生成论文/课题的参考文献
 *
 * 用途：
 * 1. 用户已经生成的项目可以一键重跑核查（不重新生成整篇论文）
 * 2. 修复之前未启用核查前生成的项目
 * 3. 网络/Crossref 短暂不可用后的重试
 *
 * 流程：
 * 1. 读取 project.content（JSON 结构化内容）
 * 2. 重新执行 verifyAndFilterReferences
 * 3. 用 renumberBodyText 重写所有 section.title/content 的 [N] 引用
 * 4. 把新的 references + referencesAudit 写回 content
 * 5. 同步重写 contentText（把 [REFERENCES_START]...[REFERENCES_END] 整段替换为核查后的版本，并重写正文 [N]）
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  verifyAndFilterReferences,
  renumberBodyText,
  type ReferencesAuditReport,
} from "@/lib/research/references-verifier";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const project = await prisma.researchProject.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    if (project.teacherId !== String(payload.userId))
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    if (!project.content)
      return NextResponse.json({ error: "项目尚未生成内容" }, { status: 400 });

    const contentData = JSON.parse(project.content);
    if (!Array.isArray(contentData.references) || contentData.references.length === 0) {
      return NextResponse.json({ error: "无参考文献可核查" }, { status: 400 });
    }

    // 1) 重新核查
    const verification = await verifyAndFilterReferences(contentData.references);

    // 2) 同步重写 section/abstract/keywords 的 [N]
    if (Array.isArray(contentData.sections)) {
      contentData.sections = contentData.sections.map((s: any) => ({
        title: renumberBodyText(String(s.title || ""), verification.oldToNew),
        content: renumberBodyText(String(s.content || ""), verification.oldToNew),
      }));
    }
    if (typeof contentData.abstract === "string") {
      contentData.abstract = renumberBodyText(contentData.abstract, verification.oldToNew);
    }
    if (Array.isArray(contentData.keywords)) {
      contentData.keywords = contentData.keywords.map((k: string) =>
        renumberBodyText(String(k), verification.oldToNew),
      );
    }
    contentData.references = verification.kept;
    contentData.referencesAudit = verification.report;

    // 3) 同步重写 contentText 中的 [REFERENCES_START]...[REFERENCES_END] 块与正文 [N]
    const newContentText = rewriteContentText(
      project.contentText || "",
      contentData,
      verification.oldToNew,
    );

    // 4) 写回
    const log = JSON.parse(project.generationLog || "[]");
    log.push({
      step: "reverify_references",
      total: verification.report.total,
      verified: verification.report.verified,
      official: verification.report.official,
      removed: verification.report.removed,
      duplicates: verification.report.duplicates,
      timestamp: new Date().toISOString(),
    });

    await prisma.researchProject.update({
      where: { id },
      data: {
        content: JSON.stringify(contentData),
        contentText: newContentText,
        generationLog: JSON.stringify(log),
      },
    });

    return NextResponse.json({
      ok: true,
      report: verification.report,
      newContent: {
        referencesCount: verification.kept.length,
        references: verification.kept,
      },
    });
  } catch (e: any) {
    console.error("[reverify-references] error:", e);
    return NextResponse.json({ error: e.message || "核查失败" }, { status: 500 });
  }
}

/**
 * 把 contentText 中的 [REFERENCES_START]...[REFERENCES_END] 块替换成新的 references，
 * 并用 oldToNew 全文重写 [N] 引用标记。
 */
function rewriteContentText(
  originalText: string,
  contentData: any,
  oldToNew: Map<number, number>,
): string {
  if (!originalText) return originalText;

  // 1) 全文 renumber
  let text = renumberBodyText(originalText, oldToNew);

  // 2) 替换 [REFERENCES_START]...[REFERENCES_END] 块
  const newRefsBlock =
    "[REFERENCES_START]\n" +
    (Array.isArray(contentData.references) ? contentData.references.join("\n") : "") +
    "\n[REFERENCES_END]";

  const re = /\[REFERENCES_START\][\s\S]*?\[REFERENCES_END\]/;
  if (re.test(text)) {
    text = text.replace(re, newRefsBlock);
  } else {
    // 没有标记块 → 追加到末尾
    text = text.trimEnd() + "\n\n" + newRefsBlock + "\n";
  }
  return text;
}

// Re-export for unit testing
export { rewriteContentText };
export type { ReferencesAuditReport };
