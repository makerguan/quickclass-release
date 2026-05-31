@echo off
chcp 65001 >nul
echo ====================================
echo   QuickClass 打包脚本 (Windows)
echo ====================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js
    pause
    exit /b 1
)

echo [1/3] 构建生产版本...
call npm run build
if %errorlevel% neq 0 (
    echo 构建失败
    pause
    exit /b 1
)

echo [2/3] 打包发布文件...
if exist "dist" rmdir /s /q "dist"
mkdir dist

:: 复制编译产物和必要文件
xcopy /e /i /y ".next" "dist\.next" >nul
xcopy /e /i /y "public" "dist\public" >nul
xcopy /e /i /y "prisma" "dist\prisma" >nul
xcopy /e /i /y "node_modules" "dist\node_modules" >nul
copy package.json dist\ >nul
copy next.config.mjs dist\ >nul

:: 创建启动脚本
(
echo @echo off
echo chcp 65001 ^>nul
echo title QuickClass
echo echo ====================================
echo echo   QuickClass 启动器
echo echo ====================================
echo echo.
echo echo [1/2] 初始化数据库...
echo npx prisma generate
echo npx prisma migrate dev --name init --skip-generate
echo if errorlevel 1 (
echo     echo 数据库初始化失败
echo     pause
echo     exit /b 1
echo )
echo echo.
echo echo [2/2] 启动服务...
echo echo.
echo echo ====================================
echo echo   访问地址: http://localhost:3000
echo echo   按 Ctrl+C 停止服务
echo echo ====================================
echo echo.
echo npm start
echo pause
) > dist\run.bat

echo [3/3] 打包成 zip...
powershell -command "Compress-Archive -Path 'dist\*' -DestinationPath 'quickclass-dist.zip' -Force"

echo.
echo ====================================
echo   打包完成！
echo ====================================
echo.
echo   产物：
echo     dist\                 - 分发目录
echo     quickclass-dist.zip   - 压缩包
echo.
echo   使用方式（目标电脑需要安装 Node.js 18+）：
echo     1. 解压 quickclass-dist.zip
echo     2. 双击 run.bat
echo     3. 浏览器打开 http://localhost:3000
echo.
pause