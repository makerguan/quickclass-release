#!/usr/bin/env node
/**
 * 打包升级包（也用作独立安装包）
 * 
 * 用法: node scripts/pack-upgrade.mjs
 * 
 * 产物: quickclass-upgrade-v{version}.zip
 * 直接从源码目录打包，不使用中间目录
 * 不含 node_modules / .next / dev.db（跨平台兼容），首次启动时自动构建
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";

const ROOT = path.resolve(import.meta.dirname, "..");
const VERSION_PATH = path.join(ROOT, "VERSION.md");
const LATEST_PATH = path.join(ROOT, "public", "latest.json");

// 1. 读取版本：优先 public/latest.json（当前版本号唯一真源），VERSION.md 兜底
let version = "unknown";
let changelog = "";
if (fs.existsSync(LATEST_PATH)) {
  const latest = JSON.parse(fs.readFileSync(LATEST_PATH, "utf-8"));
  if (latest.version) version = latest.version;
  changelog = latest.changelog || "";
}
if (version === "unknown" && fs.existsSync(VERSION_PATH)) {
  const content = fs.readFileSync(VERSION_PATH, "utf-8");
  const m = content.match(/当前版本：\*\*(v[\d.]+(?:-[\w]+)?)\*\*/);
  if (m) version = m[1];
}

const zipName = `quickclass-upgrade-${version}.zip`;
const zipPath = path.join(ROOT, zipName);

console.log(`📦 打包升级包`);
console.log(`   版本: ${version}`);
console.log(`   输出: ${zipName}`);
console.log("");

// 2. 必要文件校验
const requiredFiles = ["package.json", "prisma/schema.prisma", "src"];
for (const f of requiredFiles) {
  if (!fs.existsSync(path.join(ROOT, f))) {
    console.error(`❌ 缺少必要文件: ${f}`);
    process.exit(1);
  }
}
console.log("✅ 源码结构校验通过");
console.log("");

// 2.5 msedge-tts 版本检查。
// 该库跟随微软语音端点变更频繁发版（如 403 修复 2.0.7 → 2.1.0），
// 升级包内含 package-lock.json，用户升级时按 lock 精确安装 ——
// 打包时 lock 是什么版本，用户就装什么版本。所以必须在打包前把 lock 升到最新。
function checkMsedgeTts() {
  let localVer = "";
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf-8"));
    localVer = lock.packages?.["node_modules/msedge-tts"]?.version || "";
  } catch {}
  let remoteVer = "";
  try {
    remoteVer = execSync("npm view msedge-tts version", { encoding: "utf-8", timeout: 20000 }).trim();
  } catch {
    console.log("⚠️  无法联网检查 msedge-tts 新版本，按当前版本继续打包");
    return;
  }
  if (!remoteVer) return;
  if (remoteVer === localVer) {
    console.log(`✅ msedge-tts 已是最新版本 (${localVer})`);
    return;
  }
  // 跨 major 可能含破坏性变更，不自动升，留给开发者确认
  if (localVer && localVer.split(".")[0] !== remoteVer.split(".")[0]) {
    console.log(`⚠️  msedge-tts 有跨大版本更新 (${localVer} → ${remoteVer})，可能含破坏性变更，未自动升级。`);
    console.log(`    确认兼容后手动执行: npm install msedge-tts@${remoteVer}，再重新打包`);
    return;
  }
  console.log(`⬆️  msedge-tts 有新版本 (${localVer || "未记录"} → ${remoteVer})，自动升级后打包...`);
  execSync(`npm install msedge-tts@${remoteVer} --no-audit --no-fund`, { cwd: ROOT, stdio: "inherit" });
  console.log(`✅ msedge-tts 已升级到 ${remoteVer}`);
}
checkMsedgeTts();
console.log("");

// 3. 创建临时目录，生成动态脚本
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-pack-"));
const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });

console.log("🔧 生成启动脚本...");

// --- start.sh ---
const startSh = `#!/bin/bash
cd "$(dirname "$0")"

# 数据库连接以 .env 为唯一事实来源；没有 .env 时用模板生成默认配置（默认库: prisma/dev.db）
if [ ! -f ".env" ]; then cp .env.example .env; fi

# 定位当前真实数据库绝对路径（读 .env 的 DATABASE_URL 并按 schema 目录解析）
DB_PATH="\$(node scripts/db-locate.mjs 2>/dev/null)" || DB_PATH=""
if [ -z "\$DB_PATH" ]; then
    echo "[错误] 无法定位数据库文件路径，请检查 .env 中的 DATABASE_URL"
    exit 1
fi

echo "=========================================="
echo "   QuickClass 启动器 ${version}"
echo "  ${changelog}"
echo "=========================================="
echo ""

# 0. 检测并执行升级
PENDING_FILE=".upgrade-pending"
if [ -f "\$PENDING_FILE" ]; then
    echo "[升级] 检测到升级包，正在执行自动升级..."
    STAGING_DIR=\$(python3 -c "import json; print(json.load(open('\$PENDING_FILE')).get('stagingDir',''))" 2>/dev/null || echo "../quickclass-upgrade-staging")
    echo "  备份数据库 (\$DB_PATH) ..."
    if [ ! -f "\$DB_PATH" ] || [ ! -s "\$DB_PATH" ]; then
        echo "[错误] 数据库文件缺失或为空，已中止升级（数据安全优先）"
        exit 1
    fi
    mkdir -p "\$STAGING_DIR/prisma"
    cp -f "\$DB_PATH" "\$STAGING_DIR/prisma/dev.db"
    echo "  从 staging 覆盖文件（不删除本地数据/补丁文件）..."
    rsync -a "\$STAGING_DIR/" ./ --exclude=".upgrade-pending" --exclude="node_modules/" --exclude=".next/" 2>/dev/null || \
    cp -rf "\$STAGING_DIR"/* ./ 2>/dev/null || true
    echo "  把数据库放回原位..."
    mkdir -p "\$(dirname "\$DB_PATH")"
    cp -f "\$STAGING_DIR/prisma/dev.db" "\$DB_PATH" 2>/dev/null || true
    echo "  清理升级标记..."
    rm -f "\$PENDING_FILE"
    rm -rf "\$STAGING_DIR"
    echo "  重新安装依赖..."
    npm install --no-audit --no-fund
    echo "  同步数据库结构（幂等，不清数据）..."
    npx prisma db push --skip-generate || echo "[警告] 数据库结构同步未完成，请检查上方错误"
    echo "  重新构建..."
    npm run build
    echo "[升级] 升级完成！"
fi

# 1. 安装依赖
if [ ! -d "node_modules/next" ]; then
    echo "[1/4] 首次启动，正在安装依赖（约 2-5 分钟）..."
    npm install --no-audit --no-fund
    if [ \$? -ne 0 ]; then
        echo "[错误] 依赖安装失败！请检查网络"
        exit 1
    fi
fi

if [ ! -f "\$DB_PATH" ] && [ -f "prisma/dev.db.initial" ]; then
    mkdir -p "\$(dirname "\$DB_PATH")"
    cp prisma/dev.db.initial "\$DB_PATH"
fi

echo "[2/4] 生成 Prisma 客户端..."
npx prisma generate > /dev/null 2>&1 || {
    echo "  Prisma 生成失败，尝试从离线包安装..."
    if [ -d "offline-packages" ]; then
        for f in offline-packages/*.tgz; do
            [ -f "\$f" ] && npm install "\$f" --no-save --offline 2>/dev/null || true
        done
        npx prisma generate
    fi
}

echo "[3/4] 初始化数据库（仅在真实数据库不存在时创建）..."
if [ ! -f "\$DB_PATH" ]; then
    npx prisma db push --skip-generate --accept-data-loss
fi

echo "[4/4] 构建生产版本..."
if [ ! -f ".next/BUILD_ID" ]; then
    if [ -f "\$DB_PATH" ] && [ -s "\$DB_PATH" ]; then
        echo "  同步数据库结构（幂等，不清数据）..."
        npx prisma db push --skip-generate || echo "[警告] 数据库结构同步未完成，请检查上方错误"
    fi
    npm run build
fi

echo "[5/5] 启动服务..."
echo ""

IP=\$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print \$2}' | head -1)

echo "  教师访问: http://localhost:3000"
if [ -n "\$IP" ]; then
    echo "  局域网访问: http://\$IP:3000"
fi
echo ""
echo "  ⚠️ 首次使用：进入 http://localhost:3000 注册教师账号"
echo "  （本版本数据库为空，需要自行注册）"
echo ""
echo "  按 Ctrl+C 停止服务"
echo ""

npx next start -H 0.0.0.0 -p 3000
`;
fs.writeFileSync(path.join(tmpDir, "start.sh"), startSh, { mode: 0o755 });

// --- start.bat ---
const startBat = `@echo off\r
cd /d "%~dp0"\r
setlocal enabledelayedexpansion\r
\r
rem 数据库连接以 .env 为唯一事实来源；没有 .env 时用模板生成默认配置（默认库: prisma\\dev.db）\r
if not exist ".env" copy ".env.example" ".env" >nul\r
\r
rem 定位当前真实数据库绝对路径\r
set "DB_PATH="\r
for /f "delims=" %%i in ('node scripts\\db-locate.mjs 2^>nul') do set "DB_PATH=%%i"\r
if not defined DB_PATH (\r
    echo [错误] 无法定位数据库文件路径，请检查 .env 中的 DATABASE_URL\r
    pause\r
    exit /b 1\r
)\r
\r
echo ========================================\r
echo   QuickClass 启动器 ${version}\r
echo   更新日志见 quickstart.txt\r
echo ========================================\r
\r
rem 检测并应用待处理的升级\r
if exist ".upgrade-pending" (\r
    echo [升级] 检测到待处理的升级，正在应用...\r
    echo   正在备份数据库 (!DB_PATH!)...\r
    if not exist "%DB_PATH%" (\r
        echo   [错误] 数据库文件缺失或为空，已中止升级（数据安全优先）\r
        exit /b 1\r
    )\r
    if not exist "..\\quickclass-upgrade-staging\\prisma" mkdir "..\\quickclass-upgrade-staging\\prisma" >nul 2>&1\r
    copy "%DB_PATH%" "..\\quickclass-upgrade-staging\\prisma\\dev.db" >nul 2>&1\r
    echo   正在覆盖文件（不删除本地数据文件）...\r
    xcopy "..\\quickclass-upgrade-staging" . /E /Y /Q >nul 2>&1\r
    echo   正在把数据库放回原位...\r
    for %%p in ("%DB_PATH%") do set "DB_DIR=%%~dpp"\r
    if not exist "!DB_DIR!" mkdir "!DB_DIR!" >nul 2>&1\r
    copy "..\\quickclass-upgrade-staging\\prisma\\dev.db" "%DB_PATH%" >nul 2>&1\r
    echo   正在清理升级标记...\r
    del /F /Q ".upgrade-pending" >nul 2>&1\r
    rmdir /S /Q "..\\quickclass-upgrade-staging" >nul 2>&1\r
    echo   正在重新安装依赖...\r
    call npm install --no-audit --no-fund\r
    rem 数据库结构增量同步（幂等，不清数据），新版本表结构自动应用\r
    call npx prisma db push --skip-generate\r
    echo   正在重新构建...\r
    call npm run build\r
    echo [升级] 完成！\r
)\r
\r
rem [1/5] 安装依赖\r
if not exist "node_modules\\next" (\r
    echo [1/5] 首次运行，正在安装依赖（2-5分钟）...\r
    call npm install --no-audit --no-fund\r
    if errorlevel 1 (\r
        echo [错误] 安装依赖失败，请检查网络连接\r
        pause\r
        exit /b 1\r
    )\r
)\r
\r
if not exist "%DB_PATH%" if exist "prisma\\dev.db.initial" (\r
    for %%p in ("%DB_PATH%") do set "DB_DIR=%%~dpp"\r
    if not exist "!DB_DIR!" mkdir "!DB_DIR!" >nul 2>&1\r
    copy "prisma\\dev.db.initial" "%DB_PATH%" >nul\r
)\r
\r
echo [2/5] 正在生成 Prisma 客户端...\r
call npx prisma generate >nul 2>&1\r
if errorlevel 1 (\r
    echo   Prisma 生成失败\r
    if exist offline-packages (\r
        echo   正在尝试离线包...\r
        for %%f in (offline-packages\\*.tgz) do (\r
            call npm install "%%f" --no-save --offline 2>nul\r
        )\r
        call npx prisma generate\r
    )\r
)\r
\r
echo [3/5] 正在初始化数据库（仅在真实数据库不存在时创建）...\r
if not exist "%DB_PATH%" (\r
    call npx prisma db push --skip-generate --accept-data-loss\r
)\r
\r
echo [4/5] 正在构建生产版本...\r
if not exist ".next\\BUILD_ID" (\r
    if exist "%DB_PATH%" (\r
        rem 数据库结构增量同步（幂等，不清数据），新版本表结构自动应用\r
        for %%z in ("%DB_PATH%") do if not "%%~zz"=="0" (\r
            call npx prisma db push --skip-generate\r
        )\r
    )\r
    call npm run build\r
)\r
\r
echo [5/5] 正在启动服务器...\r
echo.\r
echo   教师端地址: http://localhost:3000\r
echo.\r
echo   [!] 首次使用？在上方地址注册教师账号。\r
echo   （此版本附带空数据库）\r
echo.\r
echo   按 Ctrl+C 停止服务器。\r
echo.\r
\r
call npx next start -H 0.0.0.0 -p 3000\r
pause\r
`;
// Write start.bat with GBK encoding (ANSI for Windows compatibility)
const batPath = path.join(tmpDir, "start.bat");
try {
  // macOS/Linux: use iconv via stdin pipe
  const gbkBuf = execSync('iconv -f UTF-8 -t GBK', { input: startBat });
  fs.writeFileSync(batPath, gbkBuf);
} catch {
  // Windows fallback: write UTF-8 (Win10+ default code page 65001 can handle it)
  fs.writeFileSync(batPath, startBat);
}

// --- stop.sh ---
fs.writeFileSync(path.join(tmpDir, "stop.sh"), `#!/bin/bash
PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PID" ]; then
    kill -9 $PID
    echo "QuickClass 已停止"
else
    echo "未发现运行中的 QuickClass"
fi
`, { mode: 0o755 });

// --- 快速上手.txt ---
const quickstart = `==========================================
   QuickClass 测试版 ${version}
   ${changelog}
==========================================

【启动】
- macOS/Linux:  终端运行 ./start.sh
- Windows:      双击 start.bat

【访问】
- 本机: http://localhost:3000
- 局域网: http://<本机IP>:3000

【首次使用】（数据库为空，需自行注册）
1. 浏览器打开 http://localhost:3000
2. 点击「教师注册」
3. 填写邮箱、密码、姓名
4. 完成注册后自动登录
5. 进入「系统设置」配置 AI 服务（API Key 等）
6. 创建班级 → 创建课堂 → 启用课堂
7. 学生通过 http://<本机IP>:3000 加入

【测试重点功能】
一、AI 伴学（互动探究）
二、课堂作业
三、教学研究

【首次启动需要】
- 联网（用于 npm install 安装依赖，约 2-5 分钟）
- 之后可离线运行（除非 AI API 调用）

【停止服务】
- macOS/Linux: Ctrl+C 或 ./stop.sh
- Windows: Ctrl+C

【反馈】
请将问题截图、复现步骤、操作系统发送给开发者。
`;
fs.writeFileSync(path.join(tmpDir, "快速上手.txt"), quickstart);

// 4. 打包
console.log("🗜️  打包中...");

try {
  // 1) 源码目录 + 配置文件（直接从项目根目录）
  execSync(
    `cd "${ROOT}" && zip -r "${zipPath}" \
      src prisma public scripts 模板 \
      .env.example package.json package-lock.json \
      next.config.mjs tsconfig.json tailwind.config.ts \
      postcss.config.mjs next-env.d.ts VERSION.md \
      upgrade.sh upgrade.bat upgrade.ps1 \
      -x "*.DS_Store" \
      "prisma/dev.db" "prisma/dev.db-*" \
      "*/node_modules/*" "*/node_modules/.*" \
      "*/.next/*" "*/.next/.*"`,
    { stdio: "inherit", shell: true }
  );

  // 2) 追加生成的脚本（压平到根目录）
  execSync(
    `cd "${tmpDir}" && zip -j "${zipPath}" start.sh start.bat stop.sh "快速上手.txt"`,
    { stdio: "inherit", shell: true }
  );
} catch (err) {
  console.error("❌ 打包失败:", err.message);
  process.exit(1);
}

// 5. 结果
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
