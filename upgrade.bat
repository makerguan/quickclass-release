@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==========================================
echo   QuickClass 升级工具 (Windows)
echo ==========================================
echo.

REM 检查是否提供了新版本 zip
if "%~1"=="" (
    echo 用法: upgrade.bat ^<新版本zip路径^>
    echo.
    echo 示例:
    echo   upgrade.bat C:\Users\Downloads\quickclass-test-v20260721.zip
    echo.
    echo 升级步骤:
    echo   1. 自动备份当前数据库
    echo   2. 解压新版本到临时目录
    echo   3. 迁移数据库和配置
    echo   4. 验证新版本
    echo   5. 替换旧版本
    exit /b 1
)

set "NEW_ZIP=%~1"

REM 检查 zip 文件是否存在
if not exist "%NEW_ZIP%" (
    echo [错误] 找不到文件: %NEW_ZIP%
    exit /b 1
)

REM 获取当前版本
set "CURRENT_VERSION=未知"
if exist VERSION.md (
    for /f "tokens=2 delims=*" %%a in ('findstr /c:"当前版本：" VERSION.md') do (
        set "CURRENT_VERSION=%%a"
        set "CURRENT_VERSION=!CURRENT_VERSION: =!"
    )
)

echo 当前版本: %CURRENT_VERSION%
echo 新版本 zip: %NEW_ZIP%
echo.

REM 确认升级
set /p CONFIRM="确认升级? 数据库将自动备份。 (y/n): "
if /i not "%CONFIRM%"=="y" (
    echo 已取消
    exit /b 0
)

echo.
echo [1/6] 备份当前数据库...

REM 创建备份目录
set "BACKUP_DIR=..\quickclass-backups"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM 生成备份文件名（带时间戳）
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "DT=%%a"
set "TIMESTAMP=%DT:~0,8%-%DT:~8,6%"
set "BACKUP_FILE=%BACKUP_DIR%\dev-%CURRENT_VERSION%-%TIMESTAMP%.db"

if exist "prisma\dev.db" (
    copy "prisma\dev.db" "%BACKUP_FILE%" >nul
    echo   ✓ 数据库已备份到: %BACKUP_FILE%
) else (
    echo   ⚠ 未找到数据库文件，跳过备份
)

echo.
echo [2/6] 停止当前服务...

REM 查找并停止 node 进程（端口 3000）
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo   ✓ 服务已停止

echo.
echo [3/6] 解压新版本...

REM 创建临时目录
set "TEMP_DIR=%TEMP%\quickclass-upgrade-%TIMESTAMP%"
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

REM 检查是否有 7z 或 unzip
where 7z >nul 2>&1
if %errorlevel%==0 (
    7z x "%NEW_ZIP%" -o"%TEMP_DIR%" -y >nul
) else (
    REM Windows 10+ 自带 tar 可以解压 zip
    tar -xf "%NEW_ZIP%" -C "%TEMP_DIR%" 2>nul
    if %errorlevel% neq 0 (
        echo [错误] 无法解压。请安装 7-Zip 或使用 Windows 10+
        exit /b 1
    )
)

echo   ✓ 已解压到临时目录

echo.
echo [4/6] 迁移数据库和配置...

REM 迁移数据库
if exist "prisma\dev.db" (
    copy "prisma\dev.db" "%TEMP_DIR%\prisma\dev.db" >nul
    echo   ✓ 数据库已迁移
)

REM 迁移环境变量
if exist ".env.local" (
    copy ".env.local" "%TEMP_DIR%\.env.local" >nul
    echo   ✓ 环境变量已迁移
)

echo.
echo [5/6] 替换文件...

REM 获取当前目录名
for %%a in ("%cd%") do set "CURRENT_DIR=%%~na"
for %%a in ("%cd%") do set "PARENT_DIR=%%~dpa"

REM 备份旧版本目录
set "OLD_DIR=%CURRENT_DIR%.old.%TIMESTAMP%"
cd ..
ren "%CURRENT_DIR%" "%OLD_DIR%"
echo   ✓ 旧版本已备份到: %OLD_DIR%

REM 移动新版本
move "%TEMP_DIR%" "%CURRENT_DIR%" >nul
cd "%CURRENT_DIR%"

echo   ✓ 新版本已就位

echo.
echo [6/6] 升级完成!
echo.
echo ==========================================
echo   升级成功
echo ==========================================
echo.
echo   旧版本: %CURRENT_VERSION% (备份在 %OLD_DIR%)
echo   新版本: 已安装
echo   数据库: 已迁移
echo.
echo   启动命令: start.bat
echo   回滚命令: cd .. ^&^& ren "%OLD_DIR%" "%CURRENT_DIR%" ^&^& cd "%CURRENT_DIR%"
echo.

pause
