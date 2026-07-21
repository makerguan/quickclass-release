#!/bin/bash
# QuickClass 一键打包脚本（macOS/Linux）
# 用法: bash pack-and-dist.sh
# 输出: quickclass-test-vYYYYMMDD.zip

set -e

TIMESTAMP=$(date +%Y%m%d)
PACK_NAME="quickclass-test-v${TIMESTAMP}"
DIST_DIR="dist-test"

echo "=========================================="
echo "  QuickClass 打包"
echo "  含教学研究+AI伴学修复+TS类型修复+数据库路径修复+main模块守卫+模板文件夹"
echo "=========================================="
echo ""

# 1. 清理
echo "[1/6] 清理旧构建..."
rm -rf "$DIST_DIR"

# 2. 创建分发目录
echo "[2/6] 创建分发目录 $DIST_DIR..."
mkdir -p "$DIST_DIR"

# 3. 复制核心文件
echo "[3/6] 复制项目文件..."
cp package.json "$DIST_DIR/"
cp package-lock.json "$DIST_DIR/"
cp next.config.mjs "$DIST_DIR/"
cp tsconfig.json "$DIST_DIR/"
cp tailwind.config.ts "$DIST_DIR/"
cp postcss.config.mjs "$DIST_DIR/"
cp next-env.d.ts "$DIST_DIR/"
cp VERSION.md "$DIST_DIR/" 2>/dev/null || echo "  ⚠️  VERSION.md 不存在，跳过"
cp upgrade.sh "$DIST_DIR/" 2>/dev/null || echo "  ⚠️  upgrade.sh 不存在，跳过"
cp upgrade.bat "$DIST_DIR/" 2>/dev/null || echo "  ⚠️  upgrade.bat 不存在，跳过"
cp upgrade.ps1 "$DIST_DIR/" 2>/dev/null || echo "  ⚠️  upgrade.ps1 不存在，跳过"
chmod +x "$DIST_DIR/upgrade.sh" 2>/dev/null || true

# 复制目录（不含 node_modules）
echo "  复制源码 (src/)..."
cp -r src "$DIST_DIR/"
echo "  复制 prisma..."
cp -r prisma "$DIST_DIR/"
echo "  复制 public..."
cp -r public "$DIST_DIR/"
echo "  复制 scripts..."
cp -r scripts "$DIST_DIR/"
echo "  复制 模板..."
cp -r 模板 "$DIST_DIR/"
echo "  ⏩ 跳过 node_modules（首次启动时自动安装）"

# 清理：确保 dist-test 不含任何预置数据库（首次启动由 start 脚本自动建空库）
rm -f "$DIST_DIR/prisma/dev.db" "$DIST_DIR/prisma/dev.db.initial" "$DIST_DIR/prisma/dev.db-journal" "$DIST_DIR/prisma/dev.db.bak"
echo "  🧹 已清理 dist-test 数据库（测试者首次启动自动建空库）"

# 4. 创建启动脚本（macOS/Linux）
echo "[4/6] 创建启动脚本..."

cat > "$DIST_DIR/start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
export DATABASE_URL="file:./dev.db"

echo "=========================================="
echo "   QuickClass 启动器 v2026.07.16"
echo "  含：教学研究+AI伴学修复+TS类型修复+数据库路径修复+main模块守卫+模板文件夹+main模块守卫+模板文件夹"
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
EOF
chmod +x "$DIST_DIR/start.sh"

# Windows 启动脚本（CRLF 行尾）
cat > "$DIST_DIR/start.bat" << 'EOF'
@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "DATABASE_URL=file:./dev.db"

echo ========================================
echo   QuickClass 启动器 v2026.07.16
echo   含：教学研究+AI伴学修复+TS类型修复+数据库路径修复+main模块守卫+模板文件夹+main模块守卫+模板文件夹
echo ========================================

rem [0/4] 安装依赖
if not exist "node_modules\next" (
    echo [0/4] 首次启动，正在安装依赖（约 2-5 分钟）...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 依赖安装失败！请检查网络
        pause
        exit /b 1
    )
)

if not exist "prisma\dev.db" if exist "prisma\dev.db.initial" (
    copy "prisma\dev.db.initial" "prisma\dev.db" >nul
)

echo [1/4] 生成 Prisma 客户端...
call npx prisma generate >nul 2>&1
if errorlevel 1 (
    echo   Prisma 生成失败
    if exist offline-packages (
        echo   尝试从离线包安装...
        for %%f in (offline-packages\*.tgz) do (
            call npm install "%%f" --no-save --offline 2>nul
        )
        call npx prisma generate
    )
)

echo [2/4] 初始化数据库（空数据库）...
if not exist "prisma\dev.db" (
    call npx prisma db push --skip-generate --accept-data-loss
)

echo [3/4] 构建生产版本...
if not exist ".next\BUILD_ID" (
    call npm run build
)

echo [4/4] 启动服务...
echo.
echo   教师访问: http://localhost:3000
echo.
echo   ⚠️ 首次使用：进入 http://localhost:3000 注册教师账号
echo   （本版本数据库为空，需要自行注册）
echo.
echo   按 Ctrl+C 停止服务
echo.

call npx next start -H 0.0.0.0 -p 3000
pause
EOF
awk 'BEGIN{ORS="\r\n"}1' "$DIST_DIR/start.bat" > "$DIST_DIR/start.bat.tmp" && mv "$DIST_DIR/start.bat.tmp" "$DIST_DIR/start.bat"

# 停止脚本
cat > "$DIST_DIR/stop.sh" << 'EOF'
#!/bin/bash
PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PID" ]; then
    kill -9 $PID
    echo "QuickClass 已停止"
else
    echo "未发现运行中的 QuickClass"
fi
EOF
chmod +x "$DIST_DIR/stop.sh"

# 5. 创建使用说明
echo "[5/6] 创建使用说明..."

cat > "$DIST_DIR/快速上手.txt" << 'EOF'
==========================================
   QuickClass 测试版 v2026.07.16
   含：教学研究+AI伴学修复+TS类型修复+数据库路径修复+main模块守卫+模板文件夹
==========================================

【启动】
- macOS/Linux:  终端运行 ./start.sh
- Windows:      双击 start.bat

【访问】
- 本机: http://localhost:3000
- 局域网: http://<本机IP>:3000

【首次使用】（数据库为空，需自行注册）
1. 浏览器打开 http://localhost:3000
2. 点击「教师注册」
3. 填写邮箱、密码、姓名
4. 完成注册后自动登录
5. 进入「系统设置」配置 AI 服务（API Key 等）
6. 创建班级 → 创建课堂 → 启用课堂
7. 学生通过 http://<本机IP>:3000 加入

【测试重点功能】
一、AI 伴学（互动探究）
1. 创建课堂 → 添加子项目 → 启用「互动探究」→ 开启「AI 伴学」
2. 学生端进入互动探究 → 发送消息
3. 验证 AI 能正常回复引导语（之前版本 AI 不回答，已修复）

二、课堂作业
1. 子项目 → 创建作业 → 启用作业
2. 学生端答题 → 提交
3. 教师端查看统计报告
4. 验证 AI 批改和报告生成功能

三、教学研究
1. 进入「教学研究」→「新建研究项目」
2. 勾选至少一个课堂
3. 数据类型勾选「作业数据」「对话数据」
4. 选「论文」→ 生成 10 个题目
   应看到：前 5 个带 🔬 实践研究 标签
            后 5 个带 📖 案例分析 标签
5. 或选「课题方案」→ 生成 10 个题目
   应看到：10 个题目覆盖 9 种研究方法
   （行动研究 / 案例分析 / 调查研究 / 实验研究 /
     准实验 / 叙事 / 内容分析 / 设计本位 / 混合方法）
6. 选中 1 个题目 → 点击「生成论文/课题初稿」
7. 验证生成内容结构：
   - 论文（实践研究类）：6 要素结构
   - 论文（案例分析类）：6 章节结构
   - 课题：8 章节 + 第（五）章含具体方法实施指引

【首次启动需要】
- 联网（用于 npm install 安装依赖，约 2-5 分钟）
- 之后可离线运行（除非 AI API 调用）

【停止服务】
- macOS/Linux: Ctrl+C 或 ./stop.sh
- Windows: Ctrl+C

【常见问题】
Q: 启动报 "权限被拒绝"？
A: macOS/Linux 终端运行 chmod +x start.sh

Q: 端口 3000 被占用？
A: 修改 start.sh 中的 -p 3000 为其他端口（如 3001）

Q: 首次启动很慢？
A: 首次需 npm install（2-5分钟），后续启动只需 5-10秒

Q: npm install 失败？
A: 检查网络，或切换国内镜像：
   npm config set registry https://registry.npmmirror.com

Q: AI 调用失败？
A: 系统设置 → 检查 API Key 和模型配置
   确认 DashScope 配额充足

Q: 想用预置数据？
A: 当前版本数据库为空，请使用 npm run db:seed 填充示例数据

【反馈】
请将问题截图、复现步骤、操作系统发送给开发者。

EOF

# 6. 打包成 zip
echo "[6/6] 打包成 zip..."

cd "$DIST_DIR"
zip -r "../$PACK_NAME.zip" . -x "*.DS_Store" "node_modules/.cache/*" > /dev/null
cd ..

# 显示结果
PACK_PATH="$PACK_NAME.zip"
PACK_SIZE=$(du -h "$PACK_PATH" | cut -f1)

echo ""
echo "=========================================="
echo "  打包完成！"
echo "=========================================="
echo ""
echo "  文件: $PACK_PATH"
echo "  大小: $PACK_SIZE"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "  分发方式："
echo "    1. 微信/邮件发送：$PACK_PATH"
echo "    2. U盘拷贝"
echo "    3. 网盘分享"
echo ""
echo "  测试者操作："
echo "    1. 解压 zip 到任意目录"
echo "    2. 双击 start.sh (Mac/Linux) 或 start.bat (Windows)"
echo "    3. 浏览器访问 http://localhost:3000"
echo "    4. 首次访问 http://localhost:3000 注册教师账号"
echo ""
echo "  完整路径: $(pwd)/$PACK_PATH"
echo ""