#!/bin/bash
# Docker 容器启动时执行：初始化数据库

set -e

echo "⏳ 等待数据库就绪..."
sleep 2

echo "🔧 执行数据库迁移..."
npx prisma migrate deploy

echo "🌱 初始化种子数据..."
npx tsx prisma/seed-full.ts

echo "✅ 数据库初始化完成！"
