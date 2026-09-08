@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal enabledelayedexpansion

rem 数据库连接以 .env 为唯一事实来源；没有 .env 时用模板生成默认配置（默认库: prisma\dev.db）
if not exist ".env" copy ".env.example" ".env" >nul

rem 定位当前真实数据库绝对路径（读 .env 的 DATABASE_URL 并按 schema 目录解析）
set "DB_PATH="
for /f "delims=" %%i in ('node scripts\db-locate.mjs 2^>nul') do set "DB_PATH=%%i"
if not defined DB_PATH (
    echo [错误] 无法定位数据库文件路径，请检查 .env 中的 DATABASE_URL
    pause
    exit /b 1
)

echo ========================================
echo   QuickClass 启动器 v2026.09.03
echo   使用指南见 使用指南.md
echo ========================================

rem 检测并应用待处理的升级
if exist ".upgrade-pending" (
    echo [升级] 检测到待处理的升级，正在应用...
    echo   正在备份数据库 (!DB_PATH!)...
    if not exist "%DB_PATH%" (
        echo   [错误] 数据库文件缺失或为空，已中止升级（数据安全优先）
        exit /b 1
    )
    if not exist "..\quickclass-upgrade-staging\prisma" mkdir "..\quickclass-upgrade-staging\prisma" >nul 2>&1
    copy "%DB_PATH%" "..\quickclass-upgrade-staging\prisma\dev.db" >nul 2>&1
    echo   正在覆盖文件（不删除本地数据文件）...
    xcopy "..\quickclass-upgrade-staging" . /E /Y /Q >nul 2>&1
    echo   正在把数据库放回原位...
    for %%p in ("%DB_PATH%") do set "DB_DIR=%%~dpp"
    if not exist "!DB_DIR!" mkdir "!DB_DIR!" >nul 2>&1
    copy "..\quickclass-upgrade-staging\prisma\dev.db" "%DB_PATH%" >nul 2>&1
    echo   正在清理升级标记...
    del /F /Q ".upgrade-pending" >nul 2>&1
    rmdir /S /Q "..\quickclass-upgrade-staging" >nul 2>&1
    echo   正在重新安装依赖...
    call npm install --no-audit --no-fund
    rem 数据库结构增量同步（幂等，不清数据），新版本表结构自动应用
    call npx prisma db push --skip-generate
    echo   正在重新构建...
    call npm run build
    echo [升级] 完成！
)

rem [1/5] 安装依赖
if not exist "node_modules\.package-lock.json" (
    if exist "node_modules" (
        echo [1/5] 检测到 node_modules 不完整，正在重新安装依赖（2-5分钟）...
        rmdir /S /Q "node_modules" >nul 2>&1
    ) else (
        echo [1/5] 首次运行，正在安装依赖（2-5分钟）...
    )
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 安装依赖失败，请检查网络连接
        pause
        exit /b 1
    )
    rem 安装成功后标记，避免下次重复检查
    copy nul "node_modules\.package-lock.json" >nul
) else (
    echo [1/5] 依赖已就绪
)

if not exist "prisma\dev.db" if exist "prisma\dev.db.initial" (
    copy "prisma\dev.db.initial" "prisma\dev.db" >nul
)

echo [2/5] 正在生成 Prisma 客户端...
call npx prisma generate
if errorlevel 1 (
    echo   [错误] Prisma 生成失败，详细错误见上方
    if exist offline-packages (
        echo   正在尝试离线包...
        for %%f in (offline-packages\*.tgz) do (
            call npm install "%%f" --no-save --offline 2>nul
        )
        call npx prisma generate
    )
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

if not exist "%DB_PATH%" (
    echo [3/5] 正在初始化数据库 (%DB_PATH%)...
    call npx prisma db push --skip-generate --accept-data-loss
) else (
    echo [3/5] 数据库已就绪
)

if not exist ".next\BUILD_ID" (
    echo [4/5] 正在构建生产版本...
    if exist "%DB_PATH%" (
        for %%z in ("%DB_PATH%") do if not "%%~zz"=="0" (
            rem 数据库结构增量同步（幂等，不清数据），新版本表结构自动应用
            call npx prisma db push --skip-generate
        )
    )
    call npm run build
) else (
    echo [4/5] 生产版本已就绪
)

echo [5/5] 正在启动服务器...
echo.
rem 获取本机IP
set QC_IP=localhost
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do set "QC_IP=%%a" ^& goto :got_ip
:got_ip
set QC_IP=%QC_IP: =%
echo   教师端: http://%QC_IP%:3000
echo   学生端: http://%QC_IP%:3000/student
echo.
echo   [!] 首次使用？进入教师端注册教师账号。
echo   （此版本附带空数据库）
echo.
echo   按 Ctrl+C 停止服务器。
echo.

call npx next start -H 0.0.0.0 -p 3000
pause