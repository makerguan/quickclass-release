@echo off
cd /d "%~dp0"
set "DATABASE_URL=file:./dev.db"

echo ========================================
echo   QuickClass Launcher v
echo   See quickstart.txt for changelog.
echo ========================================

rem Detect and apply pending upgrade
if exist ".upgrade-pending" (
    echo [Upgrade] Pending upgrade detected, applying...
    echo   Backing up database...
    if exist "prisma\dev.db" copy "prisma\dev.db" "..\quickclass-upgrade-staging\prisma\dev.db" >nul 2>&1
    echo   Overwriting files from staging...
    xcopy "..\quickclass-upgrade-staging" . /E /Y /Q >nul 2>&1
    echo   Cleaning upgrade marker...
    del /F /Q ".upgrade-pending" >nul 2>&1
    rmdir /S /Q "..\quickclass-upgrade-staging" >nul 2>&1
    echo   Reinstalling dependencies...
    call npm install --no-audit --no-fund
    echo   Rebuilding...
    call npm run build
    echo [Upgrade] Done!
)

rem [1/4] Install dependencies
if not exist "node_modules\next" (
    echo [1/4] First run, installing dependencies (2-5 min)...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [Error] npm install failed, check your network
        pause
        exit /b 1
    )
)

if not exist "prisma\dev.db" if exist "prisma\dev.db.initial" (
    copy "prisma\dev.db.initial" "prisma\dev.db" >nul
)

echo [2/4] Generating Prisma client...
call npx prisma generate >nul 2>&1
if errorlevel 1 (
    echo   Prisma generate failed
    if exist offline-packages (
        echo   Trying offline packages...
        for %%f in (offline-packages\*.tgz) do (
            call npm install "%%f" --no-save --offline 2>nul
        )
        call npx prisma generate
    )
)

echo [3/4] Initializing database (empty)...
if not exist "prisma\dev.db" (
    call npx prisma db push --skip-generate --accept-data-loss
)

echo [4/4] Building production bundle...
if not exist ".next\BUILD_ID" (
    call npm run build
)

echo [5/5] Starting server...
echo.
echo   Teacher URL: http://localhost:3000
echo.
echo   [!] First time? Register a teacher account at the URL above.
echo   (This release ships with an empty database.)
echo.
echo   Press Ctrl+C to stop.
echo.

call npx next start -H 0.0.0.0 -p 3000
pause
