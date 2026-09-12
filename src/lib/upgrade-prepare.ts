import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { readVersionInfoFromDir } from "@/lib/version-info";

export const STAGING_DIR = path.join(process.cwd(), "..", "quickclass-upgrade-staging");

/**
 * 升级准备公共逻辑（供 /api/upgrade/install 与 /api/upgrade/download 共用）
 *
 * 流程：清空 staging → 解压 → 展平单层目录 → 结构校验 →（可选）版本闸门
 *      → 备份当前数据库（md5 校验）→ 复制 .env.local → 写 .upgrade-pending 标记
 */

/** 解析当前正在使用的 SQLite 数据库绝对路径（以运行时 DATABASE_URL 为唯一事实来源） */
function resolveRealDbPath(): string | null {
  const url = (process.env.DATABASE_URL || "file:./dev.db").trim();
  if (!url.startsWith("file:")) return null;

  const rest = url.slice("file:".length).replace(/\\/g, "/").trim();
  if (/^[a-zA-Z]:\//.test(rest) || rest.startsWith("/")) {
    // 绝对路径（Windows 盘符 / Unix 根路径）
    return path.resolve(rest);
  }
  if (rest === "") return null;

  const schemaDir = locateSchemaDir();
  if (!schemaDir) return null;
  return path.resolve(schemaDir, rest);
}

/** 从当前目录向上查找 prisma/schema.prisma 所在目录 */
function locateSchemaDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "prisma", "schema.prisma"))) {
      return path.join(dir, "prisma");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 计算文件 md5（十六进制） */
function md5File(filePath: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * 使用 Node.js 原生 API 解压 zip 文件（跨平台兼容）
 * 不依赖系统命令（unzip / PowerShell），避免 Windows 路径问题
 */
async function extractZipNative(zipPath: string, destDir: string): Promise<void> {
  // 使用动态导入 adm-zip（Next.js 内置可用）
  try {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
    return;
  } catch {
    // adm-zip 不可用，尝试其他方式
  }

  // 回退：调用系统命令
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
 * 比较两个版本号（如 v2026.09.12 / 2026.9.12），返回正数表示 a 更新、负数表示 b 更新、0 相等
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface PrepareUpgradeResult {
  ok: boolean;
  status: number;
  error?: string;
  newVersion?: string;
  changelog?: string;
}

/**
 * 从已落盘的升级包 zip 准备升级（核心公共函数）
 *
 * @param tmpZipPath 升级包 zip 的本地路径
 * @param options.requireNewer 是否要求升级包版本严格高于当前版本（一键在线更新用，防止降级/重复安装）
 */
export async function prepareUpgradeFromZip(
  tmpZipPath: string,
  options: { requireNewer?: boolean } = {}
): Promise<PrepareUpgradeResult> {
  try {
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
      return { ok: false, status: 400, error: "解压失败，请确认升级包完整未损坏" };
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

    // 校验升级包结构
    if (!fs.existsSync(path.join(STAGING_DIR, "package.json"))) {
      const detail = `Staging: ${STAGING_DIR}, 内容: ${fs.readdirSync(STAGING_DIR).join(", ")}`;
      console.error("缺少 package.json:", detail);
      cleanStaging();
      return { ok: false, status: 400, error: "无效的升级包：缺少 package.json" };
    }

    // 读取新包版本号：优先 public/latest.json（当前版本号唯一真源），VERSION.md 兜底
    const newPkgInfo = readVersionInfoFromDir(STAGING_DIR);
    let newVersion = "未知";
    if (newPkgInfo.version && newPkgInfo.version !== "unknown") {
      newVersion = newPkgInfo.version;
    }

    if (!fs.existsSync(path.join(STAGING_DIR, "prisma", "schema.prisma"))) {
      cleanStaging();
      return { ok: false, status: 400, error: "无效的升级包：缺少 prisma/schema.prisma" };
    }

    if (!fs.existsSync(path.join(STAGING_DIR, "src"))) {
      cleanStaging();
      return { ok: false, status: 400, error: "无效的升级包：缺少 src/ 目录" };
    }

    // 版本闸门（一键在线更新）：新包版本必须严格高于当前版本，防降级/重复安装
    if (options.requireNewer) {
      const currentInfo = readVersionInfoFromDir(process.cwd());
      if (
        currentInfo.version !== "unknown" &&
        newVersion !== "未知" &&
        compareVersions(newVersion, currentInfo.version) <= 0
      ) {
        cleanStaging();
        return {
          ok: false,
          status: 400,
          error: `升级包版本 ${newVersion} 不高于当前版本 ${currentInfo.version}，无需更新`,
        };
      }
    }

    // ===== 备份当前数据库（数据安全优先）=====
    // 1) 以运行时 DATABASE_URL 定位真实数据库，绝不写死路径（历史 bug：写死 prisma/dev.db 备份到空库）
    const currentDb = resolveRealDbPath();
    if (!currentDb) {
      cleanStaging();
      return {
        ok: false,
        status: 400,
        error: "无法定位当前数据库：DATABASE_URL 不是 file: SQLite 路径，已中止升级（数据安全优先）",
      };
    }

    // 2) 自检：数据库文件必须真实存在且非空，防止"备份空库/错库"后仍继续升级
    if (!fs.existsSync(currentDb)) {
      cleanStaging();
      return {
        ok: false,
        status: 400,
        error: `未找到数据库文件: ${currentDb}，已中止升级（数据安全优先，请确认 .env 中 DATABASE_URL 正确）`,
      };
    }
    const dbStat = fs.statSync(currentDb);
    if (!dbStat.isFile() || dbStat.size === 0) {
      cleanStaging();
      return {
        ok: false,
        status: 400,
        error: `数据库文件为空(0 字节): ${currentDb}，拒绝以空库继续升级（数据安全优先）`,
      };
    }

    // 3) 备份到 staging，并校验备份完整性（大小与 md5 一致才允许继续）
    const stagingPrisma = path.join(STAGING_DIR, "prisma");
    if (!fs.existsSync(stagingPrisma)) {
      fs.mkdirSync(stagingPrisma, { recursive: true });
    }
    const stagedDb = path.join(stagingPrisma, "dev.db");
    fs.copyFileSync(currentDb, stagedDb);
    const backupOk =
      fs.statSync(stagedDb).size === dbStat.size && md5File(stagedDb) === md5File(currentDb);
    if (!backupOk) {
      cleanStaging();
      return {
        ok: false,
        status: 500,
        error: "数据库备份校验失败（大小或 md5 不一致），已中止升级（数据安全优先）",
      };
    }
    console.log(`[升级] 数据库已备份: ${currentDb} (${dbStat.size} bytes)`);

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

    return { ok: true, status: 200, newVersion, changelog: newPkgInfo.changelog };
  } catch (error) {
    console.error("升级准备失败:", error);
    cleanStaging();
    return {
      ok: false,
      status: 500,
      error: "升级准备失败: " + (error instanceof Error ? error.message : String(error)),
    };
  }
}

/** 将上传的升级包写入临时文件后调用公共准备逻辑 */
export function cleanStaging() {
  try {
    if (fs.existsSync(STAGING_DIR)) {
      fs.rmSync(STAGING_DIR, { recursive: true });
    }
  } catch {}
}

export async function prepareUpgradeFromBuffer(buffer: Buffer): Promise<PrepareUpgradeResult> {
  const tmpZipPath = path.join(os.tmpdir(), `quickclass-upgrade-${Date.now()}.zip`);
  fs.writeFileSync(tmpZipPath, buffer);
  try {
    return await prepareUpgradeFromZip(tmpZipPath);
  } finally {
    // 清理临时 zip
    try { fs.unlinkSync(tmpZipPath); } catch {}
  }
}
