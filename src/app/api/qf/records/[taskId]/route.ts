import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getQfCore, getAuthToken, QfError } from "@/lib/quickform";

// GET /api/qf/records/{taskId}?page=1&pageSize=50&filter=<json>
// 读取任务数据（老师端 / 数据大屏用）
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

    const sp = req.nextUrl.searchParams;
    const page = Number(sp.get("page") || "1") || 1;
    const pageSize = Number(sp.get("pageSize") || "50") || 50;

    let filter: Record<string, unknown> | undefined;
    const rawFilter = sp.get("filter");
    if (rawFilter) {
      try {
        filter = JSON.parse(rawFilter) as Record<string, unknown>;
      } catch {
        return new Response("filter 参数不是合法 JSON", { status: 400 });
      }
    }

    const result = await getQfCore().listRecords(taskId, filter, {
      page,
      pageSize,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof QfError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: 404 }
      );
    }
    console.error("QuickForm 查询数据失败:", error);
    return new Response("查询失败", { status: 500 });
  }
}
