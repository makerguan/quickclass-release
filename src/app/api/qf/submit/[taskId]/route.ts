import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getQfCore, getAuthToken, getClientIp, QfError } from "@/lib/quickform";

// POST /api/qf/submit/{taskId}
// 网页表单提交一条数据（学生端，同源调用，无 CORS）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const token = getAuthToken(req);
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    let data: unknown;
    try {
      data = await req.json();
    } catch {
      return new Response("请求体不是合法 JSON", { status: 400 });
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return new Response("提交数据必须是 JSON 对象", { status: 400 });
    }

    const record = await getQfCore().submit(
      taskId,
      data as Record<string, unknown>,
      { ip: getClientIp(req) }
    );

    return NextResponse.json({
      ok: true,
      recordId: record.recordId,
      submittedAt: record.submittedAt,
    });
  } catch (error) {
    if (error instanceof QfError) {
      return NextResponse.json(
        { ok: false, code: error.code, field: error.field, message: error.message },
        { status: 400 }
      );
    }
    console.error("QuickForm 提交失败:", error);
    return new Response("提交失败", { status: 500 });
  }
}
