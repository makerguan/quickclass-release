#!/usr/bin/env node
/**
 * 定位 QuickClass 当前真实使用的 SQLite 数据库绝对路径
 *
 * 为什么需要它：
 *   历史版本中，启动脚本(.env)、启动器(start.sh/start.bat)与升级脚本对
 *   DATABASE_URL / 数据库文件路径的写法不一致，导致"数据库到底在哪"取决于
 *   谁启动、怎么启动——升级备份可能备到空库，极端情况下数据文件甚至会被覆盖删除。
 *
 * 本脚本统一规则（与 Prisma 保持一致）：
 *   1. 数据库连接以 .env 中的 DATABASE_URL 为唯一事实来源；
 *      没有 .env 或未配置时，回退官方默认 file:./dev.db。
 *   2. file: 相对路径按 prisma/schema.prisma 所在目录（项目 prisma/ 目录）解析。
 *   3. 输出真实数据库文件的绝对路径；无法定位时向 stderr 报错并以退出码 2 结束。
 *
 * 用法（需在项目根目录运行）：
 *   DB_PATH=$(node scripts/db-locate.mjs)        # 输出如 /xx/quickclass/prisma/dev.db
 *   node scripts/db-locate.mjs || echo "定位失败"
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

/**
 * 解析 .env 中指定 key 的值（最简解析：跳过注释/空行，支持 export 前缀与引号）
 */
function readEnvKey(filePath, key) {
  if (!fs.existsSync(filePath)) return undefined;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // 去掉行内注释（# 前需是空白，避免误伤值内的 #）
    const cleaned = line.replace(/\s+#.*$/, "");
    const m = cleaned.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (m[1] !== key) continue;
    let val = m[2].trim();
    // 去掉首尾成对引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

/**
 * 从当前目录向上查找 prisma/schema.prisma 所在目录
 */
function locateSchemaDir() {
  let dir = ROOT;
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

function fail(msg) {
  console.error("[db-locate] " + msg);
  process.exit(2);
}

// 1. 数据库 URL：以 .env 为准，缺失则用官方默认
const dbUrl = (readEnvKey(path.join(ROOT, ".env"), "DATABASE_URL") || "file:./dev.db").trim();

// 2. 仅支持 SQLite 的 file: 协议（QuickClass 数据源固定为 sqlite）
if (!dbUrl.startsWith("file:")) {
  fail(`DATABASE_URL 不是 file: 协议（当前: ${dbUrl}），本工具仅支持 SQLite 数据库`);
}

// 3. 解析路径
const rest = dbUrl.slice("file:".length).replace(/\\/g, "/").trim();
let dbPath;
if (/^[a-zA-Z]:\//.test(rest)) {
  // Windows 绝对路径，如 file:C:/data/dev.db
  dbPath = path.resolve(rest);
} else if (rest.startsWith("/")) {
  // Unix 绝对路径，如 file:/data/dev.db
  dbPath = path.resolve(rest);
} else if (rest === "") {
  fail("DATABASE_URL 中 file: 后缺少路径");
} else {
  // 相对路径：按 prisma/schema.prisma 所在目录解析
  const schemaDir = locateSchemaDir();
  if (!schemaDir) {
    fail("未找到 prisma/schema.prisma，无法解析相对数据库路径");
  }
  dbPath = path.resolve(schemaDir, rest);
}

// 4. 输出绝对路径（即使文件尚不存在也输出，供初始化/新建场景判断）
console.log(dbPath);
