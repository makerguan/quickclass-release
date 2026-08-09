@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "DATABASE_URL=file:./dev.db"

echo ========================================
echo   QuickClass 启动器 v2026.08.10
echo   知识库显示被课堂引用并增加删除确认；修复导出文件名中文丢失；修复导入课堂后知识库名称不显示需刷新的问题
echo ========================================

rem [0/4] 安装依赖
if not exist "node_modules\next" (
    echo [0/4] 首次启动，正在安装依赖（约 2-5 分钟）...
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

echo [1/4] 生成 Prisma 客户端...
call npx prisma generate >nul 2>&1

echo [2/4] 初始化数据库（空数据库）...
if not exist "prisma\dev.db" (
    call npx prisma db push --skip-generate --accept-data-loss
)

echo [3/4] 构建生产版本...
if not exist ".next\BUILD_ID" (
    call npm run build
)

echo [4/4] 启动服务...
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
