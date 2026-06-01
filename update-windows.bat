@echo off
chcp 65001 >nul
title QuickClass 更新脚本
echo ====================================
echo   QuickClass 更新脚本 (Windows)
echo ====================================
echo.

::: 检查是否在旧版目录中运行
if not exist "prisma\dev.db" (
    echo [错误] 未找到数据库文件 prisma\dev.db
    echo 请将此脚本放在旧版 QuickClass 目录中运行
    pause
    exit /b 1
)

::: 检查是否已解压新版
if not exist "..\跨平台安装包" (
    if not exist "..\quickclass-release-main" (
        echo [错误] 未找到新版文件夹
        echo.
        echo 更新步骤：
        echo   1. 下载最新的"跨平台安装包.zip"
        echo   2. 解压到当前目录的同级目录（与旧版并列）
        echo   3. 重新运行此脚本
        echo.
        echo 目录结构应为：
        echo   父目录\
        echo     旧版QuickClass\  （当前目录，包含此脚本）
        echo     跨平台安装包\    （新版，解压后）
        echo.
        pause
        exit /b 1
    )
)

::: 确定新版路径
set "NEW_DIR="
if exist "..\跨平台安装包" set "NEW_DIR=..\跨平台安装包"
if exist "..\quickclass-release-main" set "NEW_DIR=..\quickclass-release-main"

echo [1/5] 备份数据库...
copy "prisma\dev.db" "prisma\dev.db.bak" >nul
if %errorlevel% neq 0 (
    echo [错误] 数据库备份失败
    pause
    exit /b 1
)
echo   已备份到 prisma\dev.db.bak

echo.
echo [2/5] 复制新版文件（保留数据库）...
::: 复制新版文件，排除数据库和缓存
xcopy "%NEW_DIR%\*" "." /E /Y /Q /EXCLUDE:exclude-list.txt 2>nul
if %errorlevel% neq 0 (
    ::: 如果排除列表不存在，直接覆盖（数据库会被备份恢复）
    xcopy "%NEW_DIR%\*" "." /E /Y /Q
)

echo.
echo [3/5] 恢复数据库...
copy /Y "prisma\dev.db.bak" "prisma\dev.db" >nul

echo.
echo [4/5] 更新数据库结构...
call npx prisma generate
call npx prisma migrate deploy

echo.
echo [5/5] 重新构建...
if exist ".next\BUILD_ID" (
    echo   清理旧构建缓存...
    rmdir /s /q ".next" 2>nul
)
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 构建失败
    pause
    exit /b 1
)

echo.
echo ====================================
echo   更新完成！
echo ====================================
echo.
echo   数据库已保留，请运行 start-windows.bat 启动
echo.
pause
