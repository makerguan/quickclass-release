import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { streamPaperGeneration, streamProposalGeneration } from "@/lib/research/document-generator";

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
    const startTime = Date.now();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = "";

          if (project.projectType === "PAPER") {
            const paperStyle = selectedTitle.paperStyle as "PRACTICE_RESEARCH" | "CASE_ANALYSIS" | undefined;
            const gen = streamPaperGeneration(selectedTitle.title, dataSnapshot, paperStyle);
            let genResult = await gen.next();
            while (!genResult.done) {
              const chunk = genResult.value;
              fullText += chunk;
              controller.enqueue(encoder.encode(chunk));
              genResult = await gen.next();
            }
            // genResult.value contains the return value (PaperContent)
            const contentData = genResult.value || { docType: "PAPER", title: selectedTitle.title, abstract: "", keywords: [], sections: [{ title: "正文", content: fullText }], references: [] };
            await saveDocument(id, project, selectedTitle, selectedIndex, fullText, JSON.stringify(contentData), startTime, { paperStyle });
          } else {
            const researchMethod = selectedTitle.researchMethod as string | undefined;
            const gen = streamProposalGeneration(selectedTitle.title, dataSnapshot, researchMethod);
            let genResult = await gen.next();
            while (!genResult.done) {
              const chunk = genResult.value;
              fullText += chunk;
              controller.enqueue(encoder.encode(chunk));
              genResult = await gen.next();
            }
            const contentData = genResult.value || { docType: "PROPOSAL", title: selectedTitle.title, sections: [{ title: "正文", content: fullText }] };
            await saveDocument(id, project, selectedTitle, selectedIndex, fullText, JSON.stringify(contentData), startTime, { researchMethod });
          }
        } catch (e: any) {
          controller.enqueue(encoder.encode(`\n\n[ERROR] ${e.message}`));
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
  extra?: { paperStyle?: string; researchMethod?: string },
) {
  const duration = Math.round((Date.now() - startTime) / 1000);
  const log = JSON.parse(project.generationLog || "[]");
  log.push({
    step: "generate_document",
    durationSec: duration,
    timestamp: new Date().toISOString(),
    paperStyle: extra?.paperStyle,
    researchMethod: extra?.researchMethod,
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