@echo off
chcp 65001 >nul
title QuickClass 启动器
echo ====================================
echo   QuickClass 启动脚本 (Windows)
echo ====================================
echo.

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

::: 检查 node_modules
if not exist "node_modules" (
    echo [1/4] 正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [1/4] 依赖已安装
)

::: 生成 Prisma 客户端
echo [2/4] 生成 Prisma 客户端...
call npx prisma generate
if %errorlevel% neq 0 (
    echo [错误] Prisma 生成失败
    pause
    exit /b 1
)

::: 检查构建缓存（必须存在 BUILD_ID 文件才算有效）
if not exist ".next\BUILD_ID" (
    echo [3/4] 正在构建生产版本（首次运行，耗时约 1-3 分钟）...
    echo.
    call npm run build
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 构建失败！
        echo 请检查上方错误信息，常见原因：
        echo   - 网络问题导致依赖下载失败
        echo   - Node.js 版本过低
        echo 修复后重新双击此脚本即可。
        pause
        exit /b 1
    )
) else (
    echo [3/4] 构建缓存已存在
)

::: 再次确认构建成功
if not exist ".next\BUILD_ID" (
    echo [错误] 构建后仍未找到 BUILD_ID，请手动运行：npm run build
    pause
    exit /b 1
)

echo.
echo ====================================
echo   启动成功！
echo ====================================
echo.

::: 获取本机 IP 地址
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

::: 启动生产模式（监听所有网络接口，允许局域网访问）
call npx next start -H 0.0.0.0

echo.
echo 服务已停止，按任意键关闭窗口...
pause
