import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 最新版本信息文件地址（存放在 Gitee 仓库中）
const LATEST_VERSION_URL =
  "https://gitee.com/maoyouhui/quickclass-release/raw/main/public/latest.json";

/**
 * 检查版本更新
 * GET /api/version/check
 */
export async function GET() {
  try {
    // 1. 直接读取本地版本号（避免通过 HTTP 请求自身）
    const versionPath = path.join(process.cwd(), "VERSION.md");
    let currentVersion = "unknown";
    if (fs.existsSync(versionPath)) {
      const content = fs.readFileSync(versionPath, "utf-8");
      const versionMatch = content.match(/当前版本：\*\*(v[\d.]+(?:-[\w]+)?)\*\*/);
      if (versionMatch) {
        currentVersion = versionMatch[1];
      }
    }

    // 2. 拉取最新版本信息
    const res = await fetch(LATEST_VERSION_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000), // 5 秒超时
    });

    if (!res.ok) {
      return NextResponse.json({
        current: currentVersion,
        hasUpdate: false,
        error: "无法获取最新版本信息",
      });
    }

    const latest = await res.json();
    const latestVersion = latest.version || "";

    // 3. 比较版本号
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    return NextResponse.json({
      current: currentVersion,
      latest: latestVersion,
      hasUpdate,
      downloadUrl: latest.downloadUrl || "",
      changelog: latest.changelog || "",
      releaseDate: latest.releaseDate || "",
    });
  } catch {
    return NextResponse.json({
      current: "unknown",
      hasUpdate: false,
      error: "版本检查失败",
    });
  }
}

/**
 * 比较版本号，返回 1 表示 v1 > v2，-1 表示 v1 < v2，0 表示相等
 */
function compareVersions(v1: string, v2: string): number {
  // 如果没有小版本号（如 -V2），默认补上 -V1
  const normalize = (v: string) => {
    const cleaned = v.replace(/^v/, "");
    return cleaned.includes("-") ? cleaned : `${cleaned}-V1`;
  };
  const clean = (v: string) => normalize(v).replace(/-/g, ".");
  const parts1 = clean(v1).split(".").map(Number);
  const parts2 = clean(v2).split(".").map(Number);
  const len = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < len; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}
