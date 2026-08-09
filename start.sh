#!/bin/bash
cd "$(dirname "$0")"
export DATABASE_URL="file:./dev.db"

echo "=========================================="
echo "   QuickClass 启动器 v2026.08.10"
echo "  知识库显示被课堂引用并增加删除确认；修复导出文件名中文丢失；修复导入课堂后知识库名称不显示需刷新的问题"
echo "=========================================="
echo ""

# 0. 安装依赖（如缺失）
if [ ! -d "node_modules/next" ]; then
    echo "[0/4] 首次启动，正在安装依赖（约 2-5 分钟）..."
    npm install --no-audit --no-fund
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败！请检查网络"
        exit 1
    fi
fi

if [ ! -f "prisma/dev.db" ] && [ -f "prisma/dev.db.initial" ]; then
    cp prisma/dev.db.initial prisma/dev.db
fi

echo "[1/4] 生成 Prisma 客户端..."
npx prisma generate > /dev/null 2>&1 || {
    echo "  Prisma 生成失败，尝试从离线包安装..."
    if [ -d "offline-packages" ]; then
        for f in offline-packages/*.tgz; do
            [ -f "$f" ] && npm install "$f" --no-save --offline 2>/dev/null || true
        done
        npx prisma generate
    fi
}

echo "[2/4] 初始化数据库（空数据库）..."
if [ ! -f "prisma/dev.db" ]; then
    npx prisma db push --skip-generate --accept-data-loss
fi

echo "[3/4] 构建生产版本..."
if [ ! -f ".next/BUILD_ID" ]; then
    npm run build
fi

echo "[4/4] 启动服务..."
echo ""

IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

echo "  教师访问: http://localhost:3000"
if [ -n "$IP" ]; then
    echo "  局域网访问: http://$IP:3000"
fi
echo ""
echo "  ⚠️ 首次使用：进入 http://localhost:3000 注册教师账号"
echo "  （本版本数据库为空，需要自行注册）"
echo ""
echo "  按 Ctrl+C 停止服务"
echo ""

npx next start -H 0.0.0.0 -p 3000
