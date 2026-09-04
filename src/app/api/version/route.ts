import { NextResponse } from "next/server";
import { readVersionInfoFromDir } from "@/lib/version-info";

export async function GET() {
  try {
    // 版本号权威来源：public/latest.json（当前版本号唯一真源），VERSION.md 兜底
    const { version, changelog } = readVersionInfoFromDir(process.cwd());

    return NextResponse.json({
      version,
      name: "QuickClass",
      changelog,
      buildTime: process.env.BUILD_TIME || new Date().toISOString(),
      node: process.version,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "无法读取版本信息" },
      { status: 500 }
    );
  }
}
