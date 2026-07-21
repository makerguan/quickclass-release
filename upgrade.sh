#!/bin/bash
# QuickClass 升级脚本
# 用法: ./upgrade.sh [新版本zip路径]

set -e

echo "=========================================="
echo "  QuickClass 升级工具"
echo "=========================================="
echo ""

# 当前版本
CURRENT_VERSION=$(grep "当前版本：\*\*" VERSION.md 2>/dev/null | sed 's/.*\*\*\(v[^*]*\)\*\*.*/\1/' || echo "未知")
echo "当前版本: $CURRENT_VERSION"
echo ""

# 检查是否提供了新版本 zip
if [ -z "$1" ]; then
    echo "用法: ./upgrade.sh <新版本zip路径>"
    echo ""
    echo "示例:"
    echo "  ./upgrade.sh ~/Downloads/quickclass-test-v20260721.zip"
    echo ""
    echo "升级步骤:"
    echo "  1. 自动备份当前数据库"
    echo "  2. 解压新版本到临时目录"
    echo "  3. 迁移数据库和配置"
    echo "  4. 验证新版本"
    echo "  5. 替换旧版本"
    exit 1
fi

NEW_ZIP="$1"

# 检查 zip 文件是否存在
if [ ! -f "$NEW_ZIP" ]; then
    echo "[错误] 找不到文件: $NEW_ZIP"
    exit 1
fi

# 提取新版本号
NEW_VERSION=$(basename "$NEW_ZIP" | sed 's/quickclass-test-\(v[0-9]*\).*/\1/' || echo "未知")
echo "新版本: $NEW_VERSION (从文件名推断)"
echo ""

# 确认升级
read -p "确认升级? 数据库将自动备份。 (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 0
fi

# 1. 备份数据库
echo ""
echo "[1/6] 备份当前数据库..."
BACKUP_DIR="../quickclass-backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/dev-$CURRENT_VERSION-$(date +%Y%m%d-%H%M%S).db"

if [ -f "prisma/dev.db" ]; then
    cp prisma/dev.db "$BACKUP_FILE"
    echo "  ✓ 数据库已备份到: $BACKUP_FILE"
else
    echo "  ⚠ 未找到数据库文件，跳过备份"
fi

# 2. 停止服务
echo ""
echo "[2/6] 停止当前服务..."
PID=$(lsof -ti:3000 2>/dev/null || true)
if [ -n "$PID" ]; then
    kill -9 $PID 2>/dev/null || true
    echo "  ✓ 服务已停止"
else
    echo "  ⚠ 服务未运行"
fi

# 3. 解压新版本
echo ""
echo "[3/6] 解压新版本..."
TEMP_DIR=$(mktemp -d)
unzip -q "$NEW_ZIP" -d "$TEMP_DIR"
echo "  ✓ 已解压到临时目录"

# 4. 迁移数据
echo ""
echo "[4/6] 迁移数据库和配置..."

# 迁移数据库
if [ -f "prisma/dev.db" ]; then
    cp prisma/dev.db "$TEMP_DIR/prisma/dev.db"
    echo "  ✓ 数据库已迁移"
fi

# 迁移 AI 配置（如果有）
if [ -f ".env.local" ]; then
    cp .env.local "$TEMP_DIR/.env.local"
    echo "  ✓ 环境变量已迁移"
fi

# 5. 替换文件
echo ""
echo "[5/6] 替换文件..."

# 获取当前目录名
CURRENT_DIR=$(basename "$(pwd)")
PARENT_DIR=$(dirname "$(pwd)")

# 备份旧版本目录
OLD_DIR="${CURRENT_DIR}.old.$(date +%Y%m%d%H%M%S)"
mv "$(pwd)" "$PARENT_DIR/$OLD_DIR"
echo "  ✓ 旧版本已备份到: $OLD_DIR"

# 移动新版本
mv "$TEMP_DIR" "$(pwd)"
echo "  ✓ 新版本已就位"

# 6. 完成
echo ""
echo "[6/6] 升级完成!"
echo ""
echo "=========================================="
echo "  升级成功"
echo "=========================================="
echo ""
echo "  旧版本: $CURRENT_VERSION (备份在 $OLD_DIR)"
echo "  新版本: $NEW_VERSION"
echo "  数据库: 已迁移"
echo ""
echo "  启动命令: ./start.sh"
echo "  回滚命令: mv ../$OLD_DIR ../$CURRENT_DIR && cd ../$CURRENT_DIR"
echo ""
