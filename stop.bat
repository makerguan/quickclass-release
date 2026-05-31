@echo off
chcp 65001 >nul
echo ======================================
echo QuickClass 停止脚本
echo ======================================
echo.
echo 正在停止 QuickClass 服务...

::: 查找并终止运行在 3000 端口的 Node.js 进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo 终止进程 PID: %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo 服务已停止。重新启动请运行 start-windows.bat
pause
