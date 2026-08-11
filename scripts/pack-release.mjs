#!/usr/bin/env node
/**
 * QuickClass 发布打包脚本
 * 用法: node scripts/pack-release.mjs
 * 功能:
 *   1. 生成 start.bat / start.sh / stop.sh
 *   2. 同步到跨平台安装包目录
 *   3. 自动提交并推送 quickclass-release 仓库
 *
 * 注意：此脚本不打包 zip，用户从 Gitee 仓库页下载 ZIP
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RELEASE_DIR = join(ROOT, '跨平台安装包');

// 读取版本信息
const versionMd = readFileSync(join(ROOT, 'VERSION.md'), 'utf-8');
const versionMatch = versionMd.match(/\*\*(v[^*]+)\*\*/);
const version = versionMatch ? versionMatch[1] : 'unknown';

const latestJson = JSON.parse(readFileSync(join(ROOT, 'public/latest.json'), 'utf-8'));
const changelog = latestJson.changelog || '';

console.log('==========================================');
console.log(`  QuickClass 发布打包`);
console.log(`  ${version} - ${changelog}`);
console.log('==========================================\n');

// 检查跨平台安装包目录是否存在
if (!existsSync(RELEASE_DIR)) {
  console.error(`[错误] 跨平台安装包目录不存在: ${RELEASE_DIR}`);
  console.error('请确保该目录存在（即 quickclass-release 仓库的工作目录）');
  process.exit(1);
}

// 检查是否是 git 仓库
try {
  execSync('git rev-parse --git-dir', { cwd: RELEASE_DIR, stdio: 'pipe' });
} catch {
  console.error('[错误] 跨平台安装包目录不是 git 仓库');
  process.exit(1);
}

// ============================================================
// 1. 生成 start.bat
// ============================================================
console.log('[1/5] 生成 start.bat...');

const startBat = `@echo off\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
set "DATABASE_URL=file:./dev.db"\r
\r
echo ========================================\r
echo   QuickClass 启动器 ${version}\r
echo   使用指南见 使用指南.md\r
echo ========================================\r
\r
rem 检测并应用待处理的升级\r
if exist ".upgrade-pending" (\r
    echo [升级] 检测到待处理的升级，正在应用...\r
    echo   正在备份数据库...\r
    if exist "prisma\\dev.db" copy "prisma\\dev.db" "..\\quickclass-upgrade-staging\\prisma\\dev.db" >nul 2>&1\r
    echo   正在覆盖文件...\r
    xcopy "..\\quickclass-upgrade-staging" . /E /Y /Q >nul 2>&1\r
    echo   正在清理升级标记...\r
    del /F /Q ".upgrade-pending" >nul 2>&1\r
    rmdir /S /Q "..\\quickclass-upgrade-staging" >nul 2>&1\r
    echo   正在重新安装依赖...\r
    call npm install --no-audit --no-fund\r
    echo   正在重新构建...\r
    call npm run build\r
    echo [升级] 完成！\r
)\r
\r
rem [1/5] 安装依赖\r
if not exist "node_modules\\.package-lock.json" (\r
    if exist "node_modules" (\r
        echo [1/5] 检测到 node_modules 不完整，正在重新安装依赖（2-5分钟）...\r
        rmdir /S /Q "node_modules" >nul 2>&1\r
    ) else (\r
        echo [1/5] 首次运行，正在安装依赖（2-5分钟）...\r
    )\r
    call npm install --no-audit --no-fund\r
    if errorlevel 1 (\r
        echo [错误] 安装依赖失败，请检查网络连接\r
        pause\r
        exit /b 1\r
    )\r
    rem 安装成功后标记，避免下次重复检查\r
    copy nul "node_modules\\.package-lock.json" >nul\r
)\r
\r
if not exist "prisma\\dev.db" if exist "prisma\\dev.db.initial" (\r
    copy "prisma\\dev.db.initial" "prisma\\dev.db" >nul\r
)\r
\r
echo [2/5] 正在生成 Prisma 客户端...\r
call npx prisma generate\r
if errorlevel 1 (\r
    echo   [错误] Prisma 生成失败，详细错误见上方\r
    if exist offline-packages (\r
        echo   正在尝试离线包...\r
        for %%f in (offline-packages\\*.tgz) do (\r
            call npm install "%%f" --no-save --offline 2>nul\r
        )\r
        call npx prisma generate\r
    )\r
    if errorlevel 1 (\r
        pause\r
        exit /b 1\r
    )\r
)\r
\r
echo [3/5] 正在初始化数据库（空库）...\r
if not exist "prisma\\dev.db" (\r
    call npx prisma db push --skip-generate --accept-data-loss\r
)\r
\r
echo [4/5] 正在构建生产版本...\r
if not exist ".next\\BUILD_ID" (\r
    call npm run build\r
)\r
\r
echo [5/5] 正在启动服务器...\r
echo.\r
rem 获取本机IP\r
set QC_IP=localhost\r
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do set "QC_IP=%%a" ^& goto :got_ip\r
:got_ip\r
set QC_IP=%QC_IP: =%\r
echo   教师端: http://%QC_IP%:3000\r
echo   学生端: http://%QC_IP%:3000/student\r
echo.\r
echo   [!] 首次使用？进入教师端注册教师账号。\r
echo   （此版本附带空数据库）\r
echo.\r
echo   按 Ctrl+C 停止服务器。\r
echo.\r
\r
call npx next start -H 0.0.0.0 -p 3000\r
pause`;

const batPath = join(RELEASE_DIR, 'start.bat');
writeFileSync(batPath, startBat, 'utf-8');
console.log('  start.bat 已生成（UTF-8 + CRLF，chcp 65001 保证中文显示）');

// ============================================================
// 2. 生成 start.sh
// ============================================================
console.log('[2/5] 生成 start.sh...');

const startSh = `#!/bin/bash
# QuickClass 启动脚本 (macOS/Linux)
# QuickClass 启动器 ${version}

set -e

cd "$(dirname "$0")"
export DATABASE_URL="file:./dev.db"

echo "========================================"
echo "  QuickClass 启动器 ${version}"
echo "  使用指南见 使用指南.md"
echo "========================================"

# 检测并应用待处理的升级
if [ -f ".upgrade-pending" ]; then
    echo "[升级] 检测到待处理的升级，正在应用..."
    echo "  正在备份数据库..."
    [ -f "prisma/dev.db" ] && cp prisma/dev.db ../quickclass-upgrade-staging/prisma/dev.db 2>/dev/null || true
    echo "  正在覆盖文件..."
    cp -rf ../quickclass-upgrade-staging/* . 2>/dev/null || true
    echo "  正在清理升级标记..."
    rm -f .upgrade-pending
    rm -rf ../quickclass-upgrade-staging
    echo "  正在重新安装依赖..."
    npm install --no-audit --no-fund
    echo "  正在重新构建..."
    npm run build
    echo "[升级] 完成！"
fi

# 1. 安装依赖（如缺失）
if [ ! -f "node_modules/.package-lock.json" ]; then
    if [ -d "node_modules" ]; then
        echo "[1/5] 检测到 node_modules 不完整，正在重新安装依赖（约 2-5 分钟）..."
        rm -rf node_modules
    else
        echo "[1/5] 首次启动，正在安装依赖（约 2-5 分钟）..."
    fi
    npm install --no-audit --no-fund
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败！请检查网络"
        exit 1
    fi
    # 安装成功后标记，避免下次重复检查
    touch node_modules/.package-lock.json
fi

# 2. 生成 Prisma 客户端
echo "[2/5] 正在生成 Prisma 客户端..."
npx prisma generate

# 3. 初始化数据库（空库）
echo "[3/5] 正在初始化数据库..."
if [ ! -f "prisma/dev.db" ]; then
    npx prisma db push --skip-generate --accept-data-loss
fi

# 4. 构建生产版本
echo "[4/5] 正在构建生产版本..."
if [ ! -f ".next/BUILD_ID" ]; then
    npm run build
fi

# 5. 启动
echo "[5/5] 正在启动服务器..."
echo ""

IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
IP=\${IP:-localhost}

echo "  教师端: http://$IP:3000"
echo "  学生端: http://$IP:3000/student"
echo ""
echo "  [!] 首次使用？进入教师端注册教师账号。"
echo "  （此版本附带空数据库）"
echo ""
echo "  按 Ctrl+C 停止服务器。"
echo ""

npx next start -H 0.0.0.0 -p 3000
`;

writeFileSync(join(RELEASE_DIR, 'start.sh'), startSh, 'utf-8');
execSync(`chmod +x "${join(RELEASE_DIR, 'start.sh')}"`);
console.log('  start.sh 已生成');

// ============================================================
// 3. 生成 stop.sh
// ============================================================
console.log('[3/5] 生成 stop.sh...');

const stopSh = `#!/bin/bash
PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PID" ]; then
    kill -9 $PID
    echo "QuickClass 已停止"
else
    echo "未发现运行中的 QuickClass"
fi
`;

writeFileSync(join(RELEASE_DIR, 'stop.sh'), stopSh, 'utf-8');
execSync(`chmod +x "${join(RELEASE_DIR, 'stop.sh')}"`);
console.log('  stop.sh 已生成');

// ============================================================
// ============================================================
// 4. 同步源码和配置文件
// ============================================================
console.log('[4/5] 同步源码和配置文件...');

// 同步 src/
execSync(`rsync -a --exclude='node_modules' --exclude='.next' "${join(ROOT, 'src/')}" "${join(RELEASE_DIR, 'src/')}"`, { stdio: 'inherit' });
console.log('  src/ 同步完成');

// 同步 public/
execSync(`rsync -a "${join(ROOT, 'public/')}" "${join(RELEASE_DIR, 'public/')}"`, { stdio: 'inherit' });
console.log('  public/ 同步完成');

// 同步 prisma/（排除数据库文件）
execSync(`rsync -a --exclude='dev.db*' "${join(ROOT, 'prisma/')}" "${join(RELEASE_DIR, 'prisma/')}"`, { stdio: 'inherit' });
console.log('  prisma/ 同步完成');

// 同步 scripts/
execSync(`rsync -a "${join(ROOT, 'scripts/')}" "${join(RELEASE_DIR, 'scripts/')}"`, { stdio: 'inherit' });
console.log('  scripts/ 同步完成');

// 同步根配置文件
const rootFiles = ['package.json', 'next.config.mjs', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.mjs', 'VERSION.md'];
for (const f of rootFiles) {
  const src = join(ROOT, f);
  if (existsSync(src)) {
    copyFileSync(src, join(RELEASE_DIR, f));
  }
}
console.log('  根配置文件同步完成');

// ============================================================
// 完成
// ============================================================
console.log('\n==========================================');
console.log('  同步完成！');
console.log('==========================================\n');
console.log(`  版本: ${version}`);
console.log(`  目录: ${RELEASE_DIR}\n`);
console.log('  下一步：');
console.log(`    cd 跨平台安装包/`);
console.log('    git add -A');
console.log(`    git commit -m "${version}"`);
console.log('    git push');
console.log('');
console.log('  用户从 Gitee 仓库页下载 ZIP 即可使用。');
console.log('');