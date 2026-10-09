import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getQfCore, getAuthToken, QfError } from "@/lib/quickform";
import { prisma } from "@/lib/prisma";

// GET /api/qf/records/{taskId}?page=1&pageSize=50&filter=<json>&classId=<id>
// 读取任务数据（老师端 / 数据大屏用）；classId 传入时只返回该班学生的记录
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

    // 班级过滤：记录上存的是学生 id，班级由学生当前所属班级推导
    const classId = sp.get("classId") || "";
    let studentIds: string[] | undefined;
    if (classId) {
      const students = await prisma.user.findMany({
        where: { classId },
        select: { id: true },
      });
      studentIds = students.map((s) => s.id);
    }

    const result = await getQfCore().listRecords(taskId, filter, { page, pageSize }, studentIds);
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
