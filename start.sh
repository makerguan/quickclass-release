#!/bin/bash
# QuickClass 启动脚本 (macOS/Linux)
# QuickClass 启动器 v2026.09.09

set -e

cd "$(dirname "$0")"

# 将本地 node_modules/.bin 加入 PATH（绕开 npx 去仓库拉最新预发布版的隐患）
export PATH="$(pwd)/node_modules/.bin:$PATH"

# npm 缓存指到项目内 .npm-cache，绕开全局缓存目录的权限限制，普通权限即可完成安装
export npm_config_cache="$(pwd)/.npm-cache"

# 依赖与 Prisma 引擎走国内镜像（npmmirror），学校/内网无法访问国外源时仍可正常安装
export npm_config_registry="https://registry.npmmirror.com"
export PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma"

echo "========================================"
echo "  QuickClass 启动器 v2026.09.09"
echo "  指南见 安装指南.md / readme.md"
echo "========================================"

# [前置检查] 必须完整解压后再运行（防止用户在压缩包预览中直接双击）
if [ ! -f "package.json" ]; then
    echo ""
    echo "  [错误] 未找到 package.json，请先将压缩包完整解压到文件夹，"
    echo "  再运行文件夹内的 start.sh（不要在压缩包里直接运行）。"
    exit 1
fi

# [前置检查] Node.js 必须已安装且在 PATH 中（后续所有步骤依赖 node/npm）
if ! command -v node >/dev/null 2>&1; then
    echo ""
    echo "  [错误] 未检测到 Node.js！"
    echo "  请先安装 Node.js LTS 版本: https://nodejs.org/zh-cn"
    echo "  安装完成后重新运行 start.sh。"
    exit 1
fi

# 数据库连接以 .env 为唯一事实来源；没有 .env 时用模板生成默认配置（默认库: prisma/dev.db）
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# 定位当前真实数据库绝对路径（读 .env 的 DATABASE_URL 并按 schema 目录解析）
DB_PATH="$(node scripts/db-locate.mjs 2>/dev/null)" || DB_PATH=""
if [ -z "$DB_PATH" ]; then
    echo "[错误] 无法定位数据库文件路径，请检查 .env 中的 DATABASE_URL"
    exit 1
fi

# 检测并应用待处理的升级
if [ -f ".upgrade-pending" ]; then
    echo "[升级] 检测到待处理的升级，正在应用..."
    echo "  正在备份数据库 ($DB_PATH) ..."
    if [ ! -f "$DB_PATH" ] || [ ! -s "$DB_PATH" ]; then
        echo "[错误] 数据库文件缺失或为空，已中止升级（数据安全优先）"
        exit 1
    fi
    mkdir -p ../quickclass-upgrade-staging/prisma
    cp -f "$DB_PATH" ../quickclass-upgrade-staging/prisma/dev.db
    echo "  正在覆盖文件（仅覆盖新包内容，不删除本地数据/补丁文件）..."
    # 用 /. 拷贝而非 * 通配：bash 的 * 不匹配点文件，会漏掉 .npmrc 等镜像配置
    cp -rf ../quickclass-upgrade-staging/. . 2>/dev/null || true
    echo "  正在把数据库放回原位..."
    mkdir -p "$(dirname "$DB_PATH")"
    cp -f ../quickclass-upgrade-staging/prisma/dev.db "$DB_PATH" 2>/dev/null || true
    echo "  正在清理升级标记..."
    rm -f .upgrade-pending
    rm -rf ../quickclass-upgrade-staging
    echo "  正在重新安装依赖..."
    npm install --no-audit --no-fund
    echo "  正在同步数据库结构（幂等，不清数据）..."
    prisma db push --skip-generate || echo "[警告] 数据库结构同步未完成，请检查上方错误"
    echo "  正在重新构建..."
    npm run build
    echo "[升级] 完成！"
fi

# 1. 安装依赖（如缺失，直接检查 prisma 二进制；旧版 .package-lock.json 空文件哨兵不可靠）
if [ ! -x "node_modules/.bin/prisma" ]; then
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
    if [ ! -x "node_modules/.bin/prisma" ]; then
        echo "[错误] 依赖安装完成但 prisma 二进制缺失，请检查上方 npm 输出"
        exit 1
    fi
else
    echo "[1/5] 依赖已就绪"
fi

# 2. 生成 Prisma 客户端
echo "[2/5] 正在生成 Prisma 客户端..."
prisma generate

# 3. 初始化数据库（空库建表；已有库做无损结构同步，升级自动补新表新列）
if [ ! -f "$DB_PATH" ]; then
    echo "[3/5] 正在初始化数据库 ($DB_PATH) ..."
    prisma db push --skip-generate --accept-data-loss
else
    echo "[3/5] 正在同步数据库结构（无损升级，不影响现有数据）..."
    prisma db push --skip-generate || echo "[警告] 数据库结构同步未完成，请检查上方错误"
    echo "  数据库结构已就绪"
fi

# 4. 构建生产版本（需要重建时先做一次数据库结构增量同步，新版本表结构自动应用）
# 构建可用性：BUILD_ID 存在且 .next/qc-version 与 public/latest.json 版本一致
# （源码 ZIP 覆盖解压到旧目录时 .next 会残留旧产物，按版本比对强制重建）
build_ready() {
    [ -f ".next/BUILD_ID" ] || return 1
    node -e "const fs=require('fs');const want=(()=>{try{return String(JSON.parse(fs.readFileSync('public/latest.json','utf8')).version||'')}catch(e){return ''}})();let have='';try{have=fs.readFileSync('.next/qc-version','utf8').trim()}catch(e){};process.exit(want&&have===want?0:1)"
}
if build_ready; then
    echo "[4/5] 生产版本已就绪"
else
    echo "[4/5] 正在构建生产版本..."
    if [ -f "$DB_PATH" ] && [ -s "$DB_PATH" ]; then
        echo "  正在同步数据库结构（幂等，不清数据）..."
        prisma db push --skip-generate || echo "[警告] 数据库结构同步未完成，请检查上方错误"
    fi
    npm run build && node -e "const fs=require('fs');try{fs.writeFileSync('.next/qc-version',String(JSON.parse(fs.readFileSync('public/latest.json','utf8')).version||''))}catch(e){}"
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

next start -H 0.0.0.0 -p 3000
