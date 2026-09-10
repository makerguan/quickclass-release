@echo off
chcp 65001 >nul
title QuickClass 启动器
cd /d "%~dp0"

rem 将本地 node_modules\.bin 加入 PATH，避免 npx 去仓库拉最新预发布版
set "PATH=%CD%\node_modules\.bin;%PATH%"

rem npm 缓存指到项目内 .npm-cache，绕开全局缓存目录(如 E:\node_js\node_cache)的权限限制，
rem 普通用户权限即可正常安装依赖，无需以管理员身份运行
set "npm_config_cache=%CD%\.npm-cache"

setlocal enabledelayedexpansion

echo ========================================
echo   QuickClass 启动器 v2026.09.09
echo   指南见 readme.md / 安装指南.md
echo ========================================

rem [前置] 必须完整解压后再运行
if exist "package.json" goto :pkg_ok
echo.
echo   [错误] 未找到 package.json，请先将压缩包完整解压到文件夹，
echo   再双击文件夹内的 start.bat，不要在压缩包里直接运行。
echo 失败 未解压直接运行 >> start.log
pause
exit /b 1
:pkg_ok

rem [前置] Node.js 必须已安装
where node >nul 2>nul
if not errorlevel 1 goto :node_ok
echo.
echo   [错误] 未检测到 Node.js！
echo   请先安装 Node.js LTS 版本：https://nodejs.org/zh-cn
echo   安装完成后，请关闭本窗口，重新双击 start.bat。
echo 失败 Node.js 未安装 >> start.log
pause
exit /b 1
:node_ok
node -e "process.exit(parseInt(process.version.slice(1))>=18?0:1)"
if not errorlevel 1 goto :ver_ok
echo.
echo   [错误] Node.js 版本过低，需要 18 以上，当前版本：
node -v
echo 失败 Node 版本过低 >> start.log
pause
exit /b 1
:ver_ok

rem .env 为数据库配置唯一事实来源，缺失时按模板生成
if exist ".env" goto :env_ok
copy ".env.example" ".env" >nul
:env_ok

rem 定位真实数据库路径
set "DB_PATH="
for /f "delims=" %%i in ('node scripts\db-locate.mjs 2^>nul') do set "DB_PATH=%%i"
if defined DB_PATH goto :db_ok
echo.
echo   [错误] 无法定位数据库文件路径，请检查 .env 中的 DATABASE_URL
echo   或将 .env 删除后重试，会自动按模板重建。
echo 失败 db-locate 失败 >> start.log
pause
exit /b 1
:db_ok

rem 检测并应用待处理的升级
if not exist ".upgrade-pending" goto :no_upgrade
echo [升级] 检测到待处理的升级，正在应用...
echo   正在备份数据库：!DB_PATH!
set "DB_ABORT="
if exist "%DB_PATH%" goto :db_exists
set "DB_ABORT=1"
:db_exists
for %%z in ("%DB_PATH%") do if "%%~zz"=="0" set "DB_ABORT=1"
if not defined DB_ABORT goto :db_good
echo   [错误] 数据库文件缺失或为空，已中止升级，数据安全优先。
echo 失败 升级中止：数据库缺失或为空 >> start.log
pause
exit /b 1
:db_good
if not exist "..\quickclass-upgrade-staging\prisma" mkdir "..\quickclass-upgrade-staging\prisma" >nul 2>&1
copy "%DB_PATH%" "..\quickclass-upgrade-staging\prisma\dev.db" >nul 2>&1
echo   正在覆盖文件，不删除本地数据文件...
xcopy "..\quickclass-upgrade-staging" . /E /Y /Q >nul 2>&1
echo   正在把数据库放回原位...
for %%p in ("%DB_PATH%") do set "DB_DIR=%%~dpp"
if exist "!DB_DIR!" goto :dir_ok
mkdir "!DB_DIR!" >nul 2>&1
:dir_ok
copy "..\quickclass-upgrade-staging\prisma\dev.db" "%DB_PATH%" >nul 2>&1
echo   正在清理升级标记...
del /F /Q ".upgrade-pending" >nul 2>&1
rmdir /S /Q "..\quickclass-upgrade-staging" >nul 2>&1
echo   正在重新安装依赖...
call npm install --no-audit --no-fund
call prisma db push --skip-generate
echo   正在重新构建...
call npm run build
echo [升级] 完成！
:no_upgrade

rem [1/5] 依赖：检查 prisma 二进制是否真实存在
if exist "node_modules\.bin\prisma.cmd" goto :deps_ok
if exist "node_modules" goto :reinstall
echo [1/5] 首次运行，正在安装依赖，约 2-5 分钟...
goto :do_install
:reinstall
echo [1/5] 检测到 node_modules 不完整，正在重新安装依赖，约 2-5 分钟...
rmdir /S /Q "node_modules" >nul 2>&1
:do_install
call npm install --no-audit --no-fund
if not errorlevel 1 goto :install_done
echo [错误] 安装依赖失败，请检查网络连接
echo   可尝试切换国内镜像：npm config set registry https://registry.npmmirror.com
echo   或关闭杀毒软件后重试
echo 失败 npm install 失败 >> start.log
pause
exit /b 1
:install_done
if exist "node_modules\.bin\prisma.cmd" goto :deps_ok
echo [错误] 依赖安装完成但 prisma 缺失，请检查上方 npm 输出
echo 失败 npm install 后 prisma 缺失 >> start.log
pause
exit /b 1
:deps_ok
echo [1/5] 依赖已就绪

if not exist "prisma\dev.db" if exist "prisma\dev.db.initial" copy "prisma\dev.db.initial" "prisma\dev.db" >nul

echo [2/5] 正在生成 Prisma 客户端...
call prisma generate
if not errorlevel 1 goto :gen_ok
echo   [错误] Prisma 生成失败，详细错误见上方
if not exist offline-packages goto :gen_fail
echo   正在尝试离线包...
for %%f in (offline-packages\*.tgz) do call npm install "%%f" --no-save --offline 2>nul
call prisma generate
if not errorlevel 1 goto :gen_ok
:gen_fail
echo 失败 prisma generate 失败 >> start.log
pause
exit /b 1
:gen_ok

if exist "%DB_PATH%" goto :db_ready
echo [3/5] 正在初始化数据库：!DB_PATH!
call prisma db push --skip-generate --accept-data-loss
goto :after_db
:db_ready
echo [3/5] 数据库已就绪
:after_db

if exist ".next\BUILD_ID" goto :build_ok
echo [4/5] 正在构建生产版本...
if not exist "%DB_PATH%" goto :do_build
for %%z in ("%DB_PATH%") do if not "%%~zz"=="0" call prisma db push --skip-generate
:do_build
call npm run build
goto :after_build
:build_ok
echo [4/5] 生产版本已就绪
:after_build

echo [5/5] 正在启动服务器...
echo.
set "QC_IP=localhost"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do set "QC_IP=%%a" ^& goto :got_ip
:got_ip
set QC_IP=%QC_IP: =%
echo   教师端：http://%QC_IP%:3000
echo   学生端：http://%QC_IP%:3000/student
echo.
echo   首次使用？进入教师端注册教师账号。
echo.
echo   按 Ctrl+C 停止服务器。
echo.

call next start -H 0.0.0.0 -p 3000
pause
