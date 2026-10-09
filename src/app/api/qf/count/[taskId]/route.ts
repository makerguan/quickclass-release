import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getQfCore, getAuthToken, QfError } from "@/lib/quickform";

// GET /api/qf/count/{taskId}?filter=<json>
// 统计提交条数（课堂实时进度用）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const token = getAuthToken(req);
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    let filter: Record<string, unknown> | undefined;
    const rawFilter = req.nextUrl.searchParams.get("filter");
    if (rawFilter) {
      try {
        filter = JSON.parse(rawFilter) as Record<string, unknown>;
      } catch {
        return new Response("filter 参数不是合法 JSON", { status: 400 });
      }
    }

    const total = await getQfCore().countRecords(taskId, filter);
    return NextResponse.json({ total });
  } catch (error) {
    if (error instanceof QfError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: 404 }
      );
    }
    console.error("QuickForm 统计失败:", error);
    return new Response("统计失败", { status: 500 });
  }
}
