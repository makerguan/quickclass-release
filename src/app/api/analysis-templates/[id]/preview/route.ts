import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import {
  generatePreview,
  hashTemplateContent,
} from "@/lib/template-preview/generate";
import { PREVIEW_SAMPLE_VER, getSampleVars, replaceSampleVars } from "@/lib/template-preview/samples";

/** 正在生成中的模板（同一进程内互斥，避免多人同时点导致重复调用 AI） */
const inFlight = new Set<string>();

async function loadTemplate(req: NextRequest, id: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") || req.headers.get("x-auth-token")?.replace("Bearer ", "");
  if (!token) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const payload = await verifyToken(token);
  if (!payload || payload.role !== "TEACHER") {
    return { error: NextResponse.json({ error: "无权限" }, { status: 403 }) };
  }

  const template = await prisma.analysisTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, type: true, content: true, teacherId: true },
  });
  if (!template) return { error: NextResponse.json({ error: "模板不存在" }, { status: 404 }) };

  const userId = String(payload.userId);
  // 公共模板（teacherId 为空）人人可预览；私有模板仅本人
  if (template.teacherId && template.teacherId !== userId) {
    return { error: NextResponse.json({ error: "无权访问该模板" }, { status: 403 }) };
  }

  return { template };
}

/** 模板里引用了、但示例数据没有的变量（只提示，不报错） */
function missingVarsOf(content: string, type: string): string[] {
  return replaceSampleVars(content, getSampleVars(type)).missingVars;
}

/** 生成一次并存库（覆盖式：一条模板只保留一份预览） */
async function regenerate(template: { id: string; name: string; type: string; content: string }) {
  if (inFlight.has(template.id)) {
    return NextResponse.json({ error: "该模板的预览正在生成中，请稍候再看" }, { status: 409 });
  }
  inFlight.add(template.id);
  try {
    const result = await generatePreview({
      content: template.content,
      name: template.name,
      type: template.type,
    });

    const data = {
      kind: result.kind,
      content: result.content,
      contentHash: hashTemplateContent(template.content),
      sampleVer: PREVIEW_SAMPLE_VER,
      model: result.model,
      generatedAt: new Date(),
    };

    await prisma.templatePreview.upsert({
      where: { templateId: template.id },
      create: { templateId: template.id, ...data },
      update: data,
    });

    return NextResponse.json({
      kind: data.kind,
      content: data.content,
      stale: false,
      truncated: result.truncated,
      generatedAt: data.generatedAt,
      missingVars: missingVarsOf(template.content, template.type),
    });
  } finally {
    inFlight.delete(template.id);
  }
}

/** GET：有缓存直接返回；已过期返回旧预览（stale=true，不自动重生成）；没有才生成 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const loaded = await loadTemplate(req, id);
    if (loaded.error) return loaded.error;
    const template = loaded.template!;

    const preview = await prisma.templatePreview.findUnique({ where: { templateId: template.id } });
    const hash = hashTemplateContent(template.content);
    const missingVars = missingVarsOf(template.content, template.type);

    if (preview) {
      const stale = preview.contentHash !== hash || preview.sampleVer !== PREVIEW_SAMPLE_VER;
      return NextResponse.json({
        kind: preview.kind,
        content: preview.content,
        stale,
        truncated: false,
        generatedAt: preview.generatedAt,
        missingVars,
      });
    }

    return await regenerate(template);
  } catch (error) {
    console.error("获取模板预览失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "预览生成失败" },
      { status: 500 }
    );
  }
}

/** POST：手动刷新预览（走与首次完全相同的生成逻辑，覆盖旧的一份） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const loaded = await loadTemplate(req, id);
    if (loaded.error) return loaded.error;
    return await regenerate(loaded.template!);
  } catch (error) {
    console.error("刷新模板预览失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "预览生成失败" },
      { status: 500 }
    );
  }
}

/** 删除预览（模板删除时由外键级联处理，这里提供一个手动清理入口） */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const loaded = await loadTemplate(req, id);
    if (loaded.error) return loaded.error;
    await prisma.templatePreview.deleteMany({ where: { templateId: id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除模板预览失败:", error);
    return NextResponse.json({ error: "删除预览失败" }, { status: 500 });
  }
}
