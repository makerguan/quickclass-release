#!/bin/bash

echo "========================================"
echo "   QuickClass 启动脚本 (macOS)"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js，请先安装 Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "[错误] Node.js 版本过低，需要 18+，当前版本：$(node -v)"
    exit 1
fi

echo "Node.js 版本：$(node -v)"
echo ""

# 检查 node_modules
if [ ! -d "node_modules" ]; then
    echo "[1/4] 正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败"
        exit 1
    fi
else
    echo "[1/4] 依赖已安装"
fi

# 生成 Prisma 客户端
echo "[2/4] 生成 Prisma 客户端..."
npx prisma generate
if [ $? -ne 0 ]; then
    echo "[错误] Prisma 生成失败"
    exit 1
fi

# 初始化数据库（首次运行时建表）
if [ ! -f "prisma/dev.db" ]; then
    echo "[2.5/4] 首次启动，正在初始化数据库..."
    npx prisma db push --skip-generate --accept-data-loss
    if [ $? -ne 0 ]; then
        echo "[错误] 数据库初始化失败"
        exit 1
    fi
else
    echo "[2.5/4] 数据库已存在"
fi

# 检查构建缓存
if [ ! -f ".next/BUILD_ID" ]; then
    echo "[3/4] 正在构建生产版本（首次运行，耗时约 1-3 分钟）..."
    echo ""
    npm run build
    if [ $? -ne 0 ]; then
        echo ""
        echo "[错误] 构建失败！"
        echo "修复后重新运行：bash start-mac.sh"
        exit 1
    fi
else
    echo "[3/4] 构建缓存已存在"
fi

# 再次确认
if [ ! -f ".next/BUILD_ID" ]; then
    echo "[错误] 构建后仍未找到 BUILD_ID，请手动运行：npm run build"
    exit 1
fi

echo ""

# 获取本机 IP 地址
IP_ADDRESSES=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -5)

echo "========================================"
echo "   QuickClass 启动成功！"
echo "========================================"
echo ""
echo "教师访问地址："
echo "  http://localhost:3000"
echo ""
if [ -n "$IP_ADDRESSES" ]; then
    echo "学生访问地址（局域网）："
    for ip in $IP_ADDRESSES; do
        echo "  http://$ip:3000"
    done
fi
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

# 启动服务（监听所有网络接口，允许局域网访问）
npx next start -H 0.0.0.0