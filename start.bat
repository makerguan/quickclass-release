@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "DATABASE_URL=file:./dev.db"

echo ========================================
echo   QuickClass 启动器 v2026.08.10
echo   知识库显示被课堂引用并增加删除确认；修复导出文件名中文丢失；修复导入课堂后知识库名称不显示需刷新的问题
echo ========================================

rem 检测并执行升级（上传升级包后的自动升级）
set "STAGING_DIR=..\quickclass-upgrade-staging"
if exist "%STAGING_DIR%\.upgrade-pending" (
    echo [升级] 检测到升级包，正在执行自动升级...
    echo   备份数据库...
    if exist "prisma\dev.db" copy "prisma\dev.db" "%STAGING_DIR%\dev.db.backup" >nul
    echo   从 staging 覆盖文件...
    xcopy "%STAGING_DIR%" . /E /Y /Q >nul 2>&1
    echo   清理升级标记...
    rmdir /S /Q "%STAGING_DIR%" >nul 2>&1
    echo   重新安装依赖...
    call npm install --no-audit --no-fund
    echo   重新构建...
    call npm run build
    echo [升级] 升级完成！
)

rem [1/4] 安装依赖
if not exist "node_modules\next" (
    echo [1/4] 首次启动，正在安装依赖（约 2-5 分钟）...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 依赖安装失败！请检查网络
        pause
        exit /b 1
    )
)

if not exist "prisma\dev.db" if exist "prisma\dev.db.initial" (
    copy "prisma\dev.db.initial" "prisma\dev.db" >nul
)

echo [2/4] 生成 Prisma 客户端...
call npx prisma generate >nul 2>&1
if errorlevel 1 (
    echo   Prisma 生成失败
    if exist offline-packages (
        echo   尝试从离线包安装...
        for %%f in (offline-packages\*.tgz) do (
            call npm install "%%f" --no-save --offline 2>nul
        )
        call npx prisma generate
    )
)

echo [3/4] 初始化数据库（空数据库）...
if not exist "prisma\dev.db" (
    call npx prisma db push --skip-generate --accept-data-loss
)

echo [4/4] 构建生产版本...
if not exist ".next\BUILD_ID" (
    call npm run build
)

echo [5/5] 启动服务...
echo.
echo   教师访问: http://localhost:3000
echo.
echo   ⚠️ 首次使用：进入 http://localhost:3000 注册教师账号
echo   （本版本数据库为空，需要自行注册）
echo.
echo   按 Ctrl+C 停止服务
echo.

call npx next start -H 0.0.0.0 -p 3000
pause
