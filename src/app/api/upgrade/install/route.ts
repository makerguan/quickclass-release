import { NextResponse } from "next/server";
import { prepareUpgradeFromBuffer } from "@/lib/upgrade-prepare";

/**
 * 安装升级包
 * POST /api/upgrade/install
 * Body: multipart/form-data, field name="file"
 *
 * 公共准备逻辑（解压/校验/备份数据库/写标记）见 @/lib/upgrade-prepare
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "未收到升级包文件" },
        { status: 400 }
      );
    }

    if (!file.name.endsWith(".zip")) {
      return NextResponse.json(
        { error: "升级包必须是 .zip 格式" },
        { status: 400 }
      );
    }

    // 限制文件大小 200MB
    if (file.size > 200 * 1024 * 1024) {
      return NextResponse.json(
        { error: "升级包不能超过 200MB" },
        { status: 400 }
      );
    }

    // 读取文件内容并走公共升级准备流程
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await prepareUpgradeFromBuffer(buffer);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: "升级包已准备就绪",
      newVersion: result.newVersion,
      detail: "请重启 QuickClass 服务以完成升级",
    });
  } catch (error) {
    console.error("升级安装失败:", error);
    return NextResponse.json(
      { error: "升级安装失败: " + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
