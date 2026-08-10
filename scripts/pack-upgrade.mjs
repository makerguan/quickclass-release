#!/usr/bin/env node
/**
 * 打包独立安装包（也是升级包）
 * 
 * 用法: node scripts/pack-upgrade.mjs
 * 
 * 产物: quickclass-upgrade-v{version}.zip
 * 这个包既是独立安装包（解压即跑），也是升级包（上传自动升级）
 * 不含 node_modules 和 .next（跨平台兼容），首次启动时自动构建
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "dist-test");
const VERSION_PATH = path.join(ROOT, "VERSION.md");

// 1. 读取当前版本
let version = "unknown";
if (fs.existsSync(VERSION_PATH)) {
  const content = fs.readFileSync(VERSION_PATH, "utf-8");
  const m = content.match(/当前版本：\*\*(v[\d.]+(?:-[\w]+)?)\*\*/);
  if (m) version = m[1];
}

// 如果 dist-test 有自己的 VERSION.md，优先使用
const distVersionPath = path.join(SRC_DIR, "VERSION.md");
if (fs.existsSync(distVersionPath)) {
  const content = fs.readFileSync(distVersionPath, "utf-8");
  const m = content.match(/当前版本：\*\*(v[\d.]+(?:-[\w]+)?)\*\*/);
  if (m) version = m[1];
}

const zipName = `quickclass-upgrade-${version}.zip`;
const zipPath = path.join(ROOT, zipName);

console.log("📦 打包升级包");
console.log(`   版本: ${version}`);
console.log(`   来源: dist-test/`);
console.log(`   输出: ${zipName}`);
console.log("");

// 2. 检查 dist-test 目录
if (!fs.existsSync(SRC_DIR)) {
  console.error("❌ dist-test/ 目录不存在，请先同步 dist-test");
  process.exit(1);
}

// 2.5 校验 dist-test 必要文件
const requiredFiles = ["package.json", "prisma/schema.prisma", "src", "start.sh"];
for (const f of requiredFiles) {
  if (!fs.existsSync(path.join(SRC_DIR, f))) {
    console.error(`❌ dist-test 缺少必要文件: ${f}`);
    process.exit(1);
  }
}
console.log("✅ dist-test 结构校验通过");

// 2.8 构建校验：如果 dist-test 没有 .next，说明需要构建
// 注意：跨平台安装包应该已经构建好，这里只是校验
const hasBuild = fs.existsSync(path.join(SRC_DIR, ".next", "BUILD_ID"));
if (!hasBuild) {
  console.log("⚠️  dist-test 未构建，开始构建校验...");
  // 如果 node_modules 不存在，先安装依赖
  if (!fs.existsSync(path.join(SRC_DIR, "node_modules"))) {
    console.log("📥 安装依赖中...");
    try {
      execSync(`cd "${SRC_DIR}" && npm install`, { stdio: "inherit", shell: true });
    } catch (err) {
      console.error("❌ 依赖安装失败！");
      process.exit(1);
    }
  }
  console.log("🔨 构建中...");
  try {
    execSync(`cd "${SRC_DIR}" && npm run build`, { stdio: "inherit", shell: true });
  } catch (err) {
    console.error("");
    console.error("❌ 构建失败！升级包不会生成。");
    console.error("   请先修复构建错误，再重新打包。");
    process.exit(1);
  }
  console.log("✅ 构建完成");
  console.log("");
} else {
  console.log("✅ dist-test 已构建，跳过构建校验");
  console.log("");
}

// 3. 打包
// 排除: node_modules, .next（跨平台兼容）, prisma/dev.db, .DS_Store, .upgrade-pending
// 用户首次启动时 start.sh/start.bat 自动 npm install + npm run build
const excludes = [
  "node_modules/*",
  ".next/*",
  "prisma/dev.db",
  "prisma/dev.db-journal",
  "prisma/dev.db*",
  ".DS_Store",
  ".upgrade-pending",
  "*.zip", // 不打包已有的 zip
];

const excludeArgs = excludes.map((e) => `-x "dist-test/${e}"`).join(" ");

console.log("🗜️  压缩中...");
try {
  // 把 dist-test/ 里的内容直接压到 zip 根目录（不含 dist-test/ 包裹层）
  // 这样老版本 install API（无自动拆层逻辑）也能直接读到 package.json
  const zipPath = path.join(ROOT, zipName);
  const flatExcludes = excludes.map(e => `-x "${e}"`).join(" ");
  execSync(
    `cd "${SRC_DIR}" && zip -r "${zipPath}" . ${flatExcludes}`,
    { stdio: "inherit", shell: true }
  );
} catch (err) {
  // 如果 zip 命令不可用，尝试用 tar
  console.log("   zip 不可用，尝试 tar...");
  try {
    execSync(
      `cd "${ROOT}" && tar --exclude='node_modules' --exclude='.next' --exclude='dev.db' --exclude='dev.db-journal' --exclude='.DS_Store' -czf "quickclass-upgrade-${version}.tar.gz" dist-test/`,
      { stdio: "inherit" }
    );
    console.log("\n⚠️  已生成 tar.gz 格式（系统不支持 zip）");
    console.log(`📦 ${ROOT}/quickclass-upgrade-${version}.tar.gz`);
    process.exit(0);
  } catch {
    console.error("❌ 请安装 zip 或 tar 命令行工具");
    process.exit(1);
  }
}

// 4. 检查产物大小
const stat = fs.statSync(zipPath);
const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

console.log("");
console.log("✅ 打包完成！");
console.log(`📦 ${zipPath}`);
console.log(`   大小: ${sizeMB} MB`);
console.log("");
console.log("📖 使用方式：");
console.log("   1. 将升级包分发给用户");
console.log("   2. 用户进入 QuickClass → 系统设置 → 系统升级");
console.log("   3. 上传此 zip 文件");
console.log("   4. 重启 QuickClass 服务");
console.log("   5. 启动脚本会自动完成升级（数据库保留）");
console.log("");
