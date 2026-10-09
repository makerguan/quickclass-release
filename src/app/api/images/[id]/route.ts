import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { readImageFile } from "@/lib/image-library";

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

// GET: 读取图片。鉴权支持两种方式：
// - Authorization: Bearer xxx（常规请求）
// - ?token=xxx（<img> 标签无法携带 header，前端 Markdown 组件自动追加）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token =
      new URL(req.url).searchParams.get("token") ||
      req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new NextResponse("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new NextResponse("登录已过期", { status: 401 });

    const image = await prisma.imageAsset.findUnique({
      where: { id },
      include: { ImageGroup: { select: { enabled: true } } },
    });
    if (!image || !image.ImageGroup.enabled) {
      return new NextResponse("图片不存在", { status: 404 });
    }

    const data = readImageFile(image.groupId, image.filename);
    if (!data) return new NextResponse("图片文件缺失", { status: 404 });

    const contentType = MIME_MAP[image.fileType] || "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        // 图片内容对同一 id 永不变更，可长缓存
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Get image error:", error);
    return new NextResponse("服务器错误", { status: 500 });
  }
}
