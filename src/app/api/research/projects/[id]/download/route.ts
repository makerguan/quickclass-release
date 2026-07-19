import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generatePaperDocx } from "@/lib/research/docx-generator";
import { generateProposalDocxFromTemplate } from "@/lib/research/docx-template-generator";
import { extractFrameworkJSON, generateFrameworkDiagram } from "@/lib/research/framework-diagram";

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
      try { contentData = JSON.parse(project.content); } catch { contentData = null; }
    }
    if (!contentData && project.contentText) {
      contentData = {
        docType: project.projectType === "PAPER" ? "PAPER" : "PROPOSAL",
        title: project.selectedTitle || "",
        sections: [{ title: "正文内容", content: project.contentText }],
        ...(project.projectType === "PAPER" ? { abstract: "", keywords: [], references: [] } : {}),
      };
    }

    let buffer: Buffer;
    let filename: string;

    if (project.projectType === "PAPER") {
      buffer = await generatePaperDocx(contentData);
      filename = `${project.projectName}-论文.docx`;
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
      filename = `${project.projectName}-课题.docx`;
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