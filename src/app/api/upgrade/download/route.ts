import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { verifyToken } from "@/lib/auth";
import { prepareUpgradeFromZip } from "@/lib/upgrade-prepare";

/**
 * 一键在线更新：服务端自动下载官方升级包并准备升级
 * POST /api/upgrade/download
 *
 * 数据来源：Gitee 仓库 main 分支的整包 zip（与网页"下载 ZIP"按钮同源，
 * 管理者同步 dev → main 后新版本即自动可用，无需人工打包）。
 *
 * 安全设计：
 * 1. 下载地址由服务端拼接（host 锁定 gitee.com + 官方仓库路径），前端无法指定任意 URL
 * 2. 版本闸门：升级包版本必须严格高于当前版本，防降级/重复安装
 * 3. 复用公共准备逻辑：结构校验 + 真库备份（md5 校验）后才写升级标记
 */

// 与 /api/version/check 同源的官方仓库地址（版本号真源 latest.json 所在仓库）
const RELEASE_REPO_URL = "https://gitee.com/maoyouhui/quickclass-release";

const MAX_ZIP_SIZE = 200 * 1024 * 1024; // 200MB

function buildArchiveUrl(): string | null {
  try {
    const u = new URL(RELEASE_REPO_URL);
    // host 锁定 gitee.com，防止仓库地址被篡改后指向任意站点
    if (u.hostname !== "gitee.com") return null;
    const repo = u.pathname.replace(/\/+$/, "");
    return `https://gitee.com${repo}/repository/archive/main.zip`;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    // 鉴权：仅持有有效登录态的教师可触发
    const token = request.headers.get("authorization")?.replace("Bearer ", "") || "";
    const payload = token ? await verifyToken(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
    }

    // 拼接官方仓库整包直链
    const archiveUrl = buildArchiveUrl();
    if (!archiveUrl) {
      return NextResponse.json({ error: "升级源地址配置异常，已中止" }, { status: 500 });
    }

    // 服务端下载升级包（Node fetch 默认跟随 302 跳转）
    let res: Response;
    try {
      res = await fetch(archiveUrl, {
        signal: AbortSignal.timeout(120_000),
        headers: { "User-Agent": "QuickClass-Updater" },
      });
    } catch (e) {
      console.error("[一键更新] 下载失败:", e);
      return NextResponse.json(
        { error: "下载升级包失败，请检查网络后重试" },
        { status: 502 }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `下载升级包失败（HTTP ${res.status}），请稍后重试或手动上传升级包` },
        { status: 502 }
      );
    }

    // 大小校验：优先看 Content-Length，下载完成后兜底再查一次
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_ZIP_SIZE) {
      return NextResponse.json({ error: "升级包超过 200MB 限制" }, { status: 400 });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_ZIP_SIZE) {
      return NextResponse.json({ error: "升级包超过 200MB 限制" }, { status: 400 });
    }
    // zip 魔数校验（PK\x03\x04），防止把错误页/HTML 当包解压
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return NextResponse.json(
        { error: "下载内容不是有效的升级包，请稍后重试" },
        { status: 502 }
      );
    }

    // 落盘临时文件后走公共准备流程（requireNewer: 版本闸门）
    const tmpZipPath = path.join(os.tmpdir(), `quickclass-upgrade-auto-${Date.now()}.zip`);
    fs.writeFileSync(tmpZipPath, buffer);
    let result;
    try {
      result = await prepareUpgradeFromZip(tmpZipPath, { requireNewer: true });
    } finally {
      try { fs.unlinkSync(tmpZipPath); } catch {}
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      newVersion: result.newVersion,
      changelog: result.changelog,
      detail: "更新包已就绪，请重启 QuickClass 服务（重新运行 start 脚本）自动完成升级",
    });
  } catch (error) {
    console.error("一键更新失败:", error);
    return NextResponse.json(
      { error: "一键更新失败: " + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
