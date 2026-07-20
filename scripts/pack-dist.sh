#!/bin/bash
# QuickClass 打包脚本 (Mac/Linux)
# 用法: bash scripts/pack-dist.sh

echo "===================================="
echo "  QuickClass 打包脚本"
echo "===================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js"
    exit 1
fi

echo "[1/3] 构建生产版本..."
npm run build
if [ $? -ne 0 ]; then
    echo "构建失败"
    exit 1
fi

echo "[2/3] 打包发布文件..."
rm -rf dist
mkdir -p dist

# 复制编译产物和必要文件
# 先正常 cp -r 复制，再单独处理 node_modules 中的软链接
cp -r .next dist/
cp -r public dist/
cp -r prisma dist/
# 用 tar 复制 node_modules 以保留软链接
tar cf - node_modules --exclude="node_modules/.cache" 2>/dev/null | (cd dist && tar xf -)
# 如果 tar 失败，降级为 cp
if [ $? -ne 0 ]; then
    cp -r node_modules dist/
fi
cp package.json dist/
cp next.config.mjs dist/

# 创建启动脚本
cat > dist/run.sh << 'SCRIPT'
#!/bin/bash
echo "===================================="
echo "  QuickClass 启动器"
echo "===================================="
echo ""

# 设置默认数据库路径（当前目录下的 prisma/dev.db）
export DATABASE_URL="file:./dev.db"
export PRISMA_SCHEMA="./prisma/schema.prisma"

echo "[1/2] 初始化数据库..."
npx prisma generate --schema=./prisma/schema.prisma
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss
if [ $? -ne 0 ]; then
    echo "数据库初始化失败"
    exit 1
fi

echo ""
echo "[2/2] 启动服务..."
echo ""
echo "===================================="
echo "  访问地址: http://localhost:3000"
echo "  按 Ctrl+C 停止服务"
echo "===================================="
echo ""
DATABASE_URL="file:./dev.db" npm start
SCRIPT
chmod +x dist/run.sh

echo "[3/3] 打包成 zip..."
cd dist && zip -r ../quickclass-dist.zip . -x "node_modules/.cache/*" > /dev/null 2>&1 && cd ..

echo ""
echo "===================================="
echo "  打包完成！"
echo "===================================="
echo ""
echo "  产物："
echo "    dist/                 - 分发目录"
echo "    quickclass-dist.zip   - 压缩包"
echo ""
echo "  使用方式（目标电脑需要安装 Node.js 18+）："
echo "    1. 解压 quickclass-dist.zip 到任意目录"
echo "    2. 进入解压后的目录"
echo "    3. 运行 run.sh（Mac/Linux）或 run.bat（Windows）"
echo ""