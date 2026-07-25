import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    // 读取 VERSION.md
    const versionPath = path.join(process.cwd(), "VERSION.md");
    let version = "unknown";
    let changelog = "";

    if (fs.existsSync(versionPath)) {
      const content = fs.readFileSync(versionPath, "utf-8");
      
      // 提取版本号
      const versionMatch = content.match(/当前版本：\*\*(v[\d.]+(?:-[\w]+)?)\*\*/);
      if (versionMatch) {
        version = versionMatch[1];
      }

      // 提取当前版本的更新日志
      const changelogMatch = content.match(
        new RegExp(`### ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=### |---|$)`)
      );
      if (changelogMatch) {
        changelog = changelogMatch[0].trim();
      }
    }

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
