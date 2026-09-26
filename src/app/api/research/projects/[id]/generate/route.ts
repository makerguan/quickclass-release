import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { streamPaperGeneration, streamProposalGeneration } from "@/lib/research/document-generator";
import { classifyGenError } from "@/lib/research/error-classifier";
import { detectQualityWarnings, extractQualityContext } from "@/lib/research/quality-check";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const body = await req.json();
    const { selectedIndex } = body;

    const project = await prisma.researchProject.findUnique({ where: { id } });
    if (!project) return new Response("项目不存在", { status: 404 });
    if (project.teacherId !== String(payload.userId)) return new Response("无权限", { status: 403 });

    const titles = JSON.parse(project.generatedTitles || "[]");
    if (selectedIndex < 0 || selectedIndex >= titles.length) return new Response("题目索引无效", { status: 400 });
    const selectedTitle = titles[selectedIndex];

    const dataSnapshot = JSON.parse(project.dataSnapshot || "{}");
    // 🧪 质量检测上下文：dataSnapshot 中的学生姓名（泄漏零容忍）+ 学科提示（文献学科比例）
    // ⛔ DO NOT REVERT: 只警告不重试——8500 字重新生成成本远大于收益，论文本就是供作者编辑的初稿
    const qualityCtx = extractQualityContext(dataSnapshot);
    const startTime = Date.now();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = "";

          if (project.projectType === "PAPER") {
            const paperStyle = selectedTitle.paperStyle as "PRACTICE_RESEARCH" | "CASE_ANALYSIS" | undefined;
            // 📐 CONTRACT: 用户创建项目时填的 keywords 必须传入文章生成（贯穿文献检索+prompt 注入），
            // 漏传则 keywords 只影响标题生成、到文章环节断链（2026-09 修复的历史断链点）。
            const gen = streamPaperGeneration(selectedTitle.title, dataSnapshot, paperStyle, project.keywords || undefined);
            let genResult = await gen.next();
            while (!genResult.done) {
              const chunk = genResult.value;
              fullText += chunk;
              controller.enqueue(encoder.encode(chunk));
              genResult = await gen.next();
            }
            // genResult.value contains the return value (Promise<PaperContent>)
            const contentData = (await genResult.value) || { docType: "PAPER", title: selectedTitle.title, abstract: "", keywords: [], sections: [{ title: "正文", content: fullText }], references: [] };
            // 🧪 质量检测（AI 味/归因/姓名泄漏/学科比例/摘要字数）：结果入 generationLog + 流末尾 [QUALITY_WARN]
            const warnings = detectQualityWarnings({
              fullText,
              knownNames: qualityCtx.knownNames,
              subjectHints: qualityCtx.subjectHints,
              references: contentData.references || [],
              abstract: contentData.abstract,
            });
            await saveDocument(id, project, selectedTitle, selectedIndex, fullText, JSON.stringify(contentData), startTime, { paperStyle, warnings });
            if (warnings.length > 0) {
              controller.enqueue(encoder.encode(`\n\n[QUALITY_WARN]${JSON.stringify(warnings)}`));
            }
          } else {
            const researchMethod = selectedTitle.researchMethod as string | undefined;
            // 📐 CONTRACT: 同 PAPER 分支——keywords 须传入（PROPOSAL 的文献检索+核心概念界定注入）
            const gen = streamProposalGeneration(selectedTitle.title, dataSnapshot, researchMethod, project.keywords || undefined);
            let genResult = await gen.next();
            while (!genResult.done) {
              const chunk = genResult.value;
              fullText += chunk;
              controller.enqueue(encoder.encode(chunk));
              genResult = await gen.next();
            }
            const contentData = (await genResult.value) || { docType: "PROPOSAL", title: selectedTitle.title, sections: [{ title: "正文", content: fullText }], references: [] };
            // 🧪 质量检测（同 PAPER 分支，PROPOSAL 无姓名脱敏豁免——申报书同样不得泄漏学生姓名）
            const warnings = detectQualityWarnings({
              fullText,
              knownNames: qualityCtx.knownNames,
              subjectHints: qualityCtx.subjectHints,
              references: contentData.references || [],
            });
            await saveDocument(id, project, selectedTitle, selectedIndex, fullText, JSON.stringify(contentData), startTime, { researchMethod, warnings });
            if (warnings.length > 0) {
              controller.enqueue(encoder.encode(`\n\n[QUALITY_WARN]${JSON.stringify(warnings)}`));
            }
          }
        } catch (e: any) {
          // 结构化错误输出：FATAL 前缀 + JSON，前端精准解析，不会混进正文
          const info = classifyGenError(e);
          controller.enqueue(encoder.encode(`\n\n[FATAL]${JSON.stringify(info)}`));
          // 显式标记失败，避免 UI 卡在"生成中"
          await prisma.researchProject.update({
            where: { id },
            data: { status: "FAILED" },
          }).catch(() => {});
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

async function saveDocument(
  id: string,
  project: any,
  selectedTitle: any,
  selectedIndex: number,
  fullText: string,
  contentJson: string,
  startTime: number,
  extra?: { paperStyle?: string; researchMethod?: string; warnings?: string[] },
) {
  const duration = Math.round((Date.now() - startTime) / 1000);
  const log = JSON.parse(project.generationLog || "[]");
  log.push({
    step: "generate_document",
    durationSec: duration,
    timestamp: new Date().toISOString(),
    paperStyle: extra?.paperStyle,
    researchMethod: extra?.researchMethod,
    // 🧪 质量检测警告（AI 味/归因/姓名泄漏/学科比例），只记录不拦截
    qualityWarnings: extra?.warnings || [],
  });

  await prisma.researchProject.update({
    where: { id },
    data: {
      selectedTitle: selectedTitle.title,
      selectedIndex,
      content: contentJson,
      contentText: fullText,
      status: "COMPLETED",
      generationLog: JSON.stringify(log),
    },
  });
}