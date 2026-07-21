# QuickClass 升级脚本 (PowerShell)
# 用法: .\upgrade.ps1 -ZipPath "C:\Downloads\quickclass-test-v20260721.zip"

param(
    [Parameter(Mandatory=$true, HelpMessage="新版本 zip 文件路径")]
    [string]$ZipPath
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  QuickClass 升级工具 (PowerShell)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 zip 文件
if (-not (Test-Path $ZipPath)) {
    Write-Host "[错误] 找不到文件: $ZipPath" -ForegroundColor Red
    exit 1
}

# 获取当前版本
$CurrentVersion = "未知"
if (Test-Path "VERSION.md") {
    $content = Get-Content "VERSION.md" -Raw
    if ($content -match "当前版本：\*\*(v[\d.]+(?:-[\w]+)?)\*\*") {
        $CurrentVersion = $matches[1]
    }
}

Write-Host "当前版本: $CurrentVersion" -ForegroundColor Green
Write-Host "新版本 zip: $ZipPath" -ForegroundColor Green
Write-Host ""

# 确认升级
$confirm = Read-Host "确认升级? 数据库将自动备份。 (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "已取消" -ForegroundColor Yellow
    exit 0
}

# 1. 备份数据库
Write-Host ""
Write-Host "[1/6] 备份当前数据库..." -ForegroundColor Yellow

$BackupDir = Join-Path (Split-Path (Get-Location) -Parent) "quickclass-backups"
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupFile = Join-Path $BackupDir "dev-$CurrentVersion-$Timestamp.db"

if (Test-Path "prisma\dev.db") {
    Copy-Item "prisma\dev.db" $BackupFile -Force
    Write-Host "  ✓ 数据库已备份到: $BackupFile" -ForegroundColor Green
} else {
    Write-Host "  ⚠ 未找到数据库文件，跳过备份" -ForegroundColor Yellow
}

# 2. 停止服务
Write-Host ""
Write-Host "[2/6] 停止当前服务..." -ForegroundColor Yellow

$nodeProcess = Get-Process -Name "node" -ErrorAction SilentlyContinue | 
    Where-Object { $_.MainWindowTitle -like "*3000*" -or $_.CommandLine -like "*next*" }

if ($nodeProcess) {
    Stop-Process -Id $nodeProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ 服务已停止" -ForegroundColor Green
} else {
    # 尝试通过端口查找
    $connections = netstat -ano | Select-String ":3000.*LISTENING"
    if ($connections) {
        $connections | ForEach-Object {
            $pid = ($_ -split '\s+')[-1]
            if ($pid -match '^\d+$') {
                Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Host "  ✓ 服务已停止" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ 服务未运行" -ForegroundColor Yellow
    }
}

# 3. 解压新版本
Write-Host ""
Write-Host "[3/6] 解压新版本..." -ForegroundColor Yellow

$TempDir = Join-Path $env:TEMP "quickclass-upgrade-$Timestamp"
if (Test-Path $TempDir) {
    Remove-Item $TempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    # PowerShell 5.0+ 使用 Expand-Archive
    Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force
    Write-Host "  ✓ 已解压到临时目录" -ForegroundColor Green
} catch {
    Write-Host "[错误] 解压失败: $_" -ForegroundColor Red
    exit 1
}

# 4. 迁移数据
Write-Host ""
Write-Host "[4/6] 迁移数据库和配置..." -ForegroundColor Yellow

# 迁移数据库
if (Test-Path "prisma\dev.db") {
    Copy-Item "prisma\dev.db" "$TempDir\prisma\dev.db" -Force
    Write-Host "  ✓ 数据库已迁移" -ForegroundColor Green
}

# 迁移环境变量
if (Test-Path ".env.local") {
    Copy-Item ".env.local" "$TempDir\.env.local" -Force
    Write-Host "  ✓ 环境变量已迁移" -ForegroundColor Green
}

# 5. 替换文件
Write-Host ""
Write-Host "[5/6] 替换文件..." -ForegroundColor Yellow

$CurrentDir = Split-Path (Get-Location) -Leaf
$ParentDir = Split-Path (Get-Location) -Parent
$OldDir = "$CurrentDir.old.$Timestamp"

# 备份旧版本目录
Rename-Item (Get-Location) $OldDir
Write-Host "  ✓ 旧版本已备份到: $OldDir" -ForegroundColor Green

# 移动新版本
Move-Item $TempDir (Join-Path $ParentDir $CurrentDir)
Set-Location (Join-Path $ParentDir $CurrentDir)

Write-Host "  ✓ 新版本已就位" -ForegroundColor Green

# 6. 完成
Write-Host ""
Write-Host "[6/6] 升级完成!" -ForegroundColor Yellow
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  升级成功" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  旧版本: $CurrentVersion (备份在 $OldDir)"
Write-Host "  新版本: 已安装"
Write-Host "  数据库: 已迁移"
Write-Host ""
Write-Host "  启动命令: .\start.bat" -ForegroundColor Green
Write-Host "  回滚命令: cd ..; Rename-Item '$OldDir' '$CurrentDir'; cd '$CurrentDir'" -ForegroundColor Yellow
Write-Host ""
