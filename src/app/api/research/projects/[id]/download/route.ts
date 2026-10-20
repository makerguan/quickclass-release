import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generatePaperDocx } from "@/lib/research/docx-generator";
import { generateProposalDocxFromTemplate } from "@/lib/research/docx-template-generator";
import { extractFrameworkJSON, generateFrameworkDiagram } from "@/lib/research/framework-diagram";
import AdmZip from "adm-zip";
import { randomUUID, createHash } from "crypto";

/**
 * ⛔ DO NOT REVERT / 📐 CONTRACT
 * 在导出的 docx 包内注入一个 Word 不识别、界面不可见/不可改的隐藏标记 part：
 *   - quickclassMeta/export.json：source=QuickClass、exportId、exportedAt、文档内容 sha256
 *   - 同时向 [Content_Types].xml 补一条 Override 声明（OPC 规范要求，否则 Word 严格校验会报文档损坏）
 * 为什么：普通用户用 Word 查看/编辑/另存都看不到此标记、也无法经 Word 操作删除；
 *         只有懂 docx 结构（unzip 改包）的人才能改动——这是"一般用户不可见、高手可改"的预期边界。
 * 🔗 RELATED：论文与课题方案两条导出链路共用此函数，改逻辑需同时校验两者。
 * 维护：docx 库生成的 zip 为标准 OPC 包，adm-zip 重打包会保留其余 entry；若 Word 打开报损坏，
 *       优先检查 [Content_Types].xml 的 Override 是否被后续改动覆盖。
 */
function stampQuickClassExport(buffer: Buffer): Buffer {
  const zip = new AdmZip(buffer);
  zip.addFile("quickclassMeta/export.json", Buffer.from(JSON.stringify({
    source: "QuickClass",
    exportId: `QC-EXPORT:${randomUUID()}`,
    exportedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(buffer).digest("hex"),
  }), "utf8"));
  const ct = zip.readAsText("[Content_Types].xml").replace(
    "</Types>",
    '<Override PartName="/quickclassMeta/export.json" ContentType="application/json"/></Types>'
  );
  zip.updateFile("[Content_Types].xml", Buffer.from(ct, "utf8"));
  return zip.toBuffer();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

    const project = await prisma.researchProject.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    if (project.teacherId !== String(payload.userId)) return NextResponse.json({ error: "无权限" }, { status: 403 });
    if (!project.content && !project.contentText) {
      return NextResponse.json({ error: "项目尚未生成内容" }, { status: 400 });
    }

    // Parse content, fallback to contentText if content is empty
    let contentData: any = null;
    if (project.content && project.content.length > 10) {
      try {
        contentData = JSON.parse(project.content);
        console.log("[download] JSON.parse success, sections count:", contentData?.sections?.length);
        if (contentData?.sections?.length > 0) {
          console.log("[download] section titles:", contentData.sections.map((s: any) => s.title?.substring(0, 30)).join(" | "));
        }
      } catch (e) {
        console.error("[download] JSON.parse failed:", e);
        contentData = null;
      }
    }
    if (!contentData && project.contentText) {
      console.log("[download] using fallback contentText, length:", project.contentText.length);
      contentData = {
        docType: project.projectType === "PAPER" ? "PAPER" : "PROPOSAL",
        title: project.selectedTitle || "",
        sections: [{ title: "正文内容", content: project.contentText }],
        ...(project.projectType === "PAPER" ? { abstract: "", keywords: [], references: [] } : {}),
      };
    }

    let buffer: Buffer;
    let filename: string;

    const docTitle = contentData?.title || project.selectedTitle || project.projectName;

    if (project.projectType === "PAPER") {
      buffer = await generatePaperDocx(contentData);
      buffer = stampQuickClassExport(buffer);
      filename = `${docTitle}.docx`;
    } else {
      // ── 课题方案：尝试提取框架图 JSON 并插入（第（五）章前）──
      let frameworkDiagram: Buffer | undefined;
      try {
        // 同时从 contentText 和 content 提取（content 中 JSON 可能已被 filter）
        const fullText = (project.contentText || "") + "\n" + (project.content || "");
        const frameworkData = extractFrameworkJSON(fullText);
        console.log("[framework-diagram] extract result:", frameworkData ? `rows=${frameworkData.rows.length}` : "NULL");
        if (frameworkData) {
          frameworkDiagram = await generateFrameworkDiagram(frameworkData);
          console.log("[framework-diagram] PNG size:", frameworkDiagram.length);
        }
      } catch (e) {
        console.error("[framework-diagram] 生成失败:", e);
        // 容错：不插入图，继续生成 doc
      }
      buffer = await generateProposalDocxFromTemplate(contentData, { frameworkDiagram });
      buffer = stampQuickClassExport(buffer);
      filename = `${docTitle}.docx`;
    }

    return new NextResponse(buffer as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}