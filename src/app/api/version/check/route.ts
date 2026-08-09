import { NextResponse } from "next/server";

// 最新版本信息文件地址（存放在 Gitee 仓库中）
const LATEST_VERSION_URL =
  "https://gitee.com/maoyouhui/quickclass-release/raw/main/public/latest.json";

/**
 * 检查版本更新
 * GET /api/version/check
 */
export async function GET() {
  try {
    // 1. 读取当前版本
    const versionRes = await fetch(
      `http://localhost:${process.env.PORT || 3000}/api/version`
    ).catch(() => null);
    let currentVersion = "unknown";
    if (versionRes?.ok) {
      const data = await versionRes.json();
      currentVersion = data.version || "unknown";
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
  const clean = (v: string) => v.replace(/^v/, "").replace(/-/g, ".");
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
