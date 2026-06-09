@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title QuickClass 启动器
echo ====================================
echo   QuickClass 启动脚本 (Windows)
echo ====================================
echo.

::: 设置 Prisma 需要的 DATABASE_URL（指向当前目录的 prisma\dev.db）
set "DATABASE_URL=file:./dev.db"

::: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

node -e "process.exit(parseInt(process.version.slice(1))>=18?0:1)"
if %errorlevel% neq 0 (
    echo [错误] Node.js 版本过低，需要 18+，当前版本：
    node -v
    pause
    exit /b 1
)

echo Node.js 版本：
node -v
echo.

cd /d "%~dp0"

::: [1/5] 检查并安装依赖
if not exist "node_modules\prisma" (
    echo [1/5] 正在安装依赖（首次运行，约 2-5 分钟）...
    call npm install --no-audit --no-fund
    if !errorlevel! neq 0 (
        echo.
        echo [错误] 依赖安装失败！请检查：
        echo   1. 网络是否正常
        echo   2. 是否需要切换 npm 镜像：npm config set registry https://registry.npmmirror.com
        echo   3. 关闭杀毒软件后重试
        pause
        exit /b 1
    )
) else (
    echo [1/5] 依赖已安装
)
echo.

::: [2/5] 生成 Prisma 客户端（每次启动都跑，保证 prisma client 最新）
echo [2/5] 正在生成 Prisma 客户端...
call npx prisma generate
if !errorlevel! neq 0 (
    echo.
    echo [错误] Prisma 客户端生成失败！
    echo 可能原因：node_modules 不完整
    echo 修复方法：删除 node_modules 文件夹后重新双击本脚本
    pause
    exit /b 1
)
echo.

::: [3/5] 初始化数据库
if not exist "prisma\dev.db" (
    echo [3/5] 首次启动，正在初始化数据库...
    call npx prisma db push --skip-generate --accept-data-loss
    if !errorlevel! neq 0 (
        echo.
        echo [错误] 数据库初始化失败！
        pause
        exit /b 1
    )
) else (
    echo [3/5] 数据库已存在
)
echo.

::: [4/5] 检查构建缓存
if not exist ".next\BUILD_ID" (
    echo [4/5] 正在构建生产版本（首次运行，约 1-3 分钟）...
    echo.
    call npm run build
    if !errorlevel! neq 0 (
        echo.
        echo [错误] 构建失败！
        echo 修复后重新双击此脚本即可。
        pause
        exit /b 1
    )
) else (
    echo [4/5] 构建缓存已存在
)
echo.

::: [5/5] 启动服务
echo ====================================
echo   启动成功！
echo ====================================
echo.
echo   教师访问地址: http://localhost:3000
echo.
echo   学生访问地址（局域网）:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        echo     http://%%b:3000
    )
)
echo.
echo   按 Ctrl+C 停止服务
echo.

call npx next start -H 0.0.0.0

echo.
echo 服务已停止，按任意键关闭窗口...
pause
