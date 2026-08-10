#!/bin/bash
cd "$(dirname "$0")"
export DATABASE_URL="file:./dev.db"

echo "=========================================="
echo "   QuickClass 启动器 v2026.08.10-V2"
echo "  知识库显示被课堂引用并增加删除确认；修复导出文件名中文丢失；修复导入课堂后知识库名称不显示需刷新的问题"
echo "=========================================="
echo ""

# 0. 检测并执行升级（上传升级包后的自动升级）
PENDING_FILE=".upgrade-pending"
if [ -f "$PENDING_FILE" ]; then
    echo "[升级] 检测到升级包，正在执行自动升级..."
    STAGING_DIR=$(python3 -c "import json; print(json.load(open('$PENDING_FILE')).get('stagingDir',''))" 2>/dev/null || echo "../quickclass-upgrade-staging")
    echo "  备份数据库..."
    cp -f prisma/dev.db "$STAGING_DIR/prisma/dev.db" 2>/dev/null || true
    echo "  从 staging 覆盖文件..."
    rsync -a --delete "$STAGING_DIR/" ./ --exclude=".upgrade-pending" --exclude="node_modules/" --exclude=".next/" 2>/dev/null || \
    cp -rf "$STAGING_DIR"/* ./ 2>/dev/null || true
    echo "  清理升级标记..."
    rm -f "$PENDING_FILE"
    rm -rf "$STAGING_DIR"
    echo "  重新安装依赖..."
    npm install --no-audit --no-fund
    echo "  重新构建..."
    npm run build
    echo "[升级] 升级完成！"
fi

# 1. 安装依赖（如缺失）
if [ ! -d "node_modules/next" ]; then
    echo "[1/4] 首次启动，正在安装依赖（约 2-5 分钟）..."
    npm install --no-audit --no-fund
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败！请检查网络"
        exit 1
    fi
fi

if [ ! -f "prisma/dev.db" ] && [ -f "prisma/dev.db.initial" ]; then
    cp prisma/dev.db.initial prisma/dev.db
fi

echo "[2/4] 生成 Prisma 客户端..."
npx prisma generate > /dev/null 2>&1 || {
    echo "  Prisma 生成失败，尝试从离线包安装..."
    if [ -d "offline-packages" ]; then
        for f in offline-packages/*.tgz; do
            [ -f "$f" ] && npm install "$f" --no-save --offline 2>/dev/null || true
        done
        npx prisma generate
    fi
}

echo "[3/4] 初始化数据库（空数据库）..."
if [ ! -f "prisma/dev.db" ]; then
    npx prisma db push --skip-generate --accept-data-loss
fi

echo "[4/4] 构建生产版本..."
if [ ! -f ".next/BUILD_ID" ]; then
    npm run build
fi

echo "[5/5] 启动服务..."
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
