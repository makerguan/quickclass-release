#!/bin/bash

echo "========================================"
echo "   QuickClass 更新脚本 (macOS)"
echo "========================================"
echo ""

# 检查是否在旧版目录中运行
if [ ! -f "prisma/dev.db" ]; then
    echo "[错误] 未找到数据库文件 prisma/dev.db"
    echo "请将此脚本放在旧版 QuickClass 目录中运行"
    exit 1
fi

# 确定新版路径
NEW_DIR=""
if [ -d "../跨平台安装包" ]; then
    NEW_DIR="../跨平台安装包"
elif [ -d "../quickclass-release-main" ]; then
    NEW_DIR="../quickclass-release-main"
else
    echo "[错误] 未找到新版文件夹"
    echo ""
    echo "更新步骤："
    echo "  1. 下载最新的"跨平台安装包.zip""
    echo "  2. 解压到当前目录的同级目录（与旧版并列）"
    echo "  3. 重新运行此脚本"
    echo ""
    echo "目录结构应为："
    echo "  父目录/"
    echo "    旧版QuickClass/  （当前目录，包含此脚本）"
    echo "    跨平台安装包/    （新版，解压后）"
    echo ""
    exit 1
fi

echo "[1/5] 备份数据库..."
cp prisma/dev.db prisma/dev.db.bak
if [ $? -ne 0 ]; then
    echo "[错误] 数据库备份失败"
    exit 1
fi
echo "  已备份到 prisma/dev.db.bak"

echo ""
echo "[2/5] 复制新版文件（保留数据库）..."
# 同步新版文件，排除数据库、缓存、node_modules
rsync -av --progress \
    --exclude='prisma/dev.db' \
    --exclude='prisma/dev.db-journal' \
    --exclude='prisma/dev.db.bak' \
    --exclude='.next' \
    --exclude='node_modules' \
    --exclude='.DS_Store' \
    "$NEW_DIR/" ./

echo ""
echo "[3/5] 恢复数据库..."
cp prisma/dev.db.bak prisma/dev.db

echo ""
echo "[4/5] 更新数据库结构..."
npx prisma generate
npx prisma migrate deploy

echo ""
echo "[5/5] 重新构建..."
if [ -d ".next" ]; then
    echo "  清理旧构建缓存..."
    rm -rf .next
fi
npm run build
if [ $? -ne 0 ]; then
    echo "[错误] 构建失败"
    exit 1
fi

echo ""
echo "========================================"
echo "   更新完成！"
echo "========================================"
echo ""
echo "  数据库已保留，请运行 start-mac.sh 启动"
echo ""
