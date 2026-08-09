import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { createReadStream } from "fs";
import { createWriteStream } from "fs";
import { Readable } from "stream";

const STAGING_DIR = path.join(process.cwd(), "..", "quickclass-upgrade-staging");

/**
 * 使用 Node.js 原生 API 解压 zip 文件（跨平台兼容）
 * 不依赖系统命令（unzip / PowerShell），避免 Windows 路径问题
 */
async function extractZipNative(zipPath: string, destDir: string): Promise<void> {
  // 使用动态导入 adm-zip（Next.js 内置可用）
  // 如果不可用，回退到系统命令
  try {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
    return;
  } catch {
    // adm-zip 不可用，尝试其他方式
  }

  // 回退：使用 Node.js 内置的 zlib 解压
  // zip 格式需要解析中央目录，这里用 child_process 调用系统命令
  const platform = os.platform();
  if (platform === "win32") {
    // Windows: 用 tar 命令（Windows 10+ 内置）
    try {
      execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: "pipe" });
      return;
    } catch {
      // tar 不可用，尝试 PowerShell
    }
    // PowerShell: 用 -LiteralPath 避免转义问题，路径用双引号包裹
    const psCmd = `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`;
    execSync(`powershell -Command "${psCmd}"`, { stdio: "pipe" });
  } else {
    // macOS / Linux
    execSync(`unzip -q "${zipPath}" -d "${destDir}"`, { stdio: "pipe" });
  }
}

/**
 * 安装升级包
 * POST /api/upgrade/install
 * Body: multipart/form-data, field name="file"
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

    // 读取文件内容
    const buffer = Buffer.from(await file.arrayBuffer());
    const tmpZipPath = path.join(os.tmpdir(), `quickclass-upgrade-${Date.now()}.zip`);

    // 写入临时文件
    fs.writeFileSync(tmpZipPath, buffer);

    // 清空 staging 目录
    if (fs.existsSync(STAGING_DIR)) {
      fs.rmSync(STAGING_DIR, { recursive: true });
    }
    fs.mkdirSync(STAGING_DIR, { recursive: true });

    // 解压到 staging 目录
    try {
      await extractZipNative(tmpZipPath, STAGING_DIR);
    } catch (extractErr) {
      console.error("解压失败:", extractErr);
      cleanStaging();
      return NextResponse.json(
        { error: "解压失败，请确认升级包完整未损坏" },
        { status: 400 }
      );
    } finally {
      // 清理临时 zip
      try { fs.unlinkSync(tmpZipPath); } catch {}
    }

    // 处理可能的多层目录（zip 里可能包了一层文件夹）
    const entries = fs.readdirSync(STAGING_DIR);
    if (entries.length === 1) {
      const single = path.join(STAGING_DIR, entries[0]);
      if (fs.statSync(single).isDirectory()) {
        // zip 里多了一层目录，把内容提上来
        const inner = fs.readdirSync(single);
        for (const name of inner) {
          fs.renameSync(path.join(single, name), path.join(STAGING_DIR, name));
        }
        fs.rmdirSync(single);
      }
    }

    // 调试：列出 staging 目录内容（帮助排查问题）
    console.log("Staging 目录内容:", fs.readdirSync(STAGING_DIR));

    // 校验升级包结构
    if (!fs.existsSync(path.join(STAGING_DIR, "package.json"))) {
      const detail = `Staging: ${STAGING_DIR}, 内容: ${fs.readdirSync(STAGING_DIR).join(", ")}`;
      console.error("缺少 package.json:", detail);
      cleanStaging();
      return NextResponse.json(
        { error: "无效的升级包：缺少 package.json" },
        { status: 400 }
      );
    }

    // 读取版本号
    let newVersion = "未知";
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(STAGING_DIR, "package.json"), "utf-8")
      );
      if (pkg.version) newVersion = pkg.version;
    } catch {}

    // 读取 VERSION.md 获取版本号
    const versionMdPath = path.join(STAGING_DIR, "VERSION.md");
    if (fs.existsSync(versionMdPath)) {
      const content = fs.readFileSync(versionMdPath, "utf-8");
      const m = content.match(/当前版本：\*\*(v[^*]+)\*\*/);
      if (m) newVersion = m[1];
    }

    if (!fs.existsSync(path.join(STAGING_DIR, "prisma", "schema.prisma"))) {
      cleanStaging();
      return NextResponse.json(
        { error: "无效的升级包：缺少 prisma/schema.prisma" },
        { status: 400 }
      );
    }

    if (!fs.existsSync(path.join(STAGING_DIR, "src"))) {
      cleanStaging();
      return NextResponse.json(
        { error: "无效的升级包：缺少 src/ 目录" },
        { status: 400 }
      );
    }

    // 备份当前数据库到 staging
    const currentDb = path.join(process.cwd(), "prisma", "dev.db");
    if (fs.existsSync(currentDb)) {
      const stagingPrisma = path.join(STAGING_DIR, "prisma");
      if (!fs.existsSync(stagingPrisma)) {
        fs.mkdirSync(stagingPrisma, { recursive: true });
      }
      fs.copyFileSync(currentDb, path.join(stagingPrisma, "dev.db"));
    }

    // 复制 .env.local 到 staging（如果有）
    const envLocal = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envLocal)) {
      fs.copyFileSync(envLocal, path.join(STAGING_DIR, ".env.local"));
    }

    // 写入升级标记文件
    const markerPath = path.join(process.cwd(), ".upgrade-pending");
    fs.writeFileSync(
      markerPath,
      JSON.stringify({
        stagingDir: STAGING_DIR,
        newVersion,
        timestamp: new Date().toISOString(),
      })
    );

    return NextResponse.json({
      success: true,
      message: "升级包已准备就绪",
      newVersion,
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

function cleanStaging() {
  try {
    if (fs.existsSync(STAGING_DIR)) {
      fs.rmSync(STAGING_DIR, { recursive: true });
    }
  } catch {}
}
