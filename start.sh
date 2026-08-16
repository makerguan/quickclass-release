#!/bin/bash
# QuickClass 启动脚本 (macOS/Linux)
# QuickClass 启动器 v2026.08.16

set -e

cd "$(dirname "$0")"
export DATABASE_URL="file:./dev.db"

echo "========================================"
echo "  QuickClass 启动器 v2026.08.16"
echo "  使用指南见 使用指南.md"
echo "========================================"

# 检测并应用待处理的升级
if [ -f ".upgrade-pending" ]; then
    echo "[升级] 检测到待处理的升级，正在应用..."
    echo "  正在备份数据库..."
    [ -f "prisma/dev.db" ] && cp prisma/dev.db ../quickclass-upgrade-staging/prisma/dev.db 2>/dev/null || true
    echo "  正在覆盖文件..."
    cp -rf ../quickclass-upgrade-staging/* . 2>/dev/null || true
    echo "  正在清理升级标记..."
    rm -f .upgrade-pending
    rm -rf ../quickclass-upgrade-staging
    echo "  正在重新安装依赖..."
    npm install --no-audit --no-fund
    echo "  正在重新构建..."
    npm run build
    echo "[升级] 完成！"
fi

# 1. 安装依赖（如缺失）
if [ ! -f "node_modules/.package-lock.json" ]; then
    if [ -d "node_modules" ]; then
        echo "[1/5] 检测到 node_modules 不完整，正在重新安装依赖（约 2-5 分钟）..."
        rm -rf node_modules
    else
        echo "[1/5] 首次启动，正在安装依赖（约 2-5 分钟）..."
    fi
    npm install --no-audit --no-fund
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败！请检查网络"
        exit 1
    fi
    # 安装成功后标记，避免下次重复检查
    touch node_modules/.package-lock.json
else
    echo "[1/5] 依赖已就绪"
fi

# 2. 生成 Prisma 客户端
echo "[2/5] 正在生成 Prisma 客户端..."
npx prisma generate

# 3. 初始化数据库（空库）
if [ ! -f "prisma/dev.db" ]; then
    echo "[3/5] 正在初始化数据库..."
    npx prisma db push --skip-generate --accept-data-loss
else
    echo "[3/5] 数据库已就绪"
fi

# 4. 构建生产版本
if [ ! -f ".next/BUILD_ID" ]; then
    echo "[4/5] 正在构建生产版本..."
    npm run build
else
    echo "[4/5] 生产版本已就绪"
fi

# 5. 启动
echo "[5/5] 正在启动服务器..."
echo ""

IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
IP=${IP:-localhost}

echo "  教师端: http://$IP:3000"
echo "  学生端: http://$IP:3000/student"
echo ""
echo "  [!] 首次使用？进入教师端注册教师账号。"
echo "  （此版本附带空数据库）"
echo ""
echo "  按 Ctrl+C 停止服务器。"
echo ""

npx next start -H 0.0.0.0 -p 3000
