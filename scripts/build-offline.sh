#!/bin/bash
# QuickClass 离线镜像构建脚本（在 Mac 上运行，有网络）
# 用法: ./scripts/build-offline.sh

set -e

IMAGE_NAME="quickclass"
IMAGE_TAG="latest"
EXPORT_FILE="quickclass-offline.tar"

echo "======================================"
echo "QuickClass 离线镜像构建"
echo "======================================"

# 1. 构建镜像
echo ""
echo "[1/3] 构建 Docker 镜像..."
docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .

# 2. 导出为 tar
echo ""
echo "[2/3] 导出为离线安装包: ${EXPORT_FILE}..."
docker save ${IMAGE_NAME}:${IMAGE_TAG} -o ${EXPORT_FILE}

# 3. 显示文件大小
echo ""
echo "[3/3] 构建完成！"
echo "镜像文件: $(pwd)/${EXPORT_FILE}"
echo "文件大小: $(du -h ${EXPORT_FILE} | cut -f1)"
echo ""
echo "下一步："
echo "1. 将 quickclass-offline.tar 复制到 Windows 电脑"
echo "2. 在 Windows 上运行: docker load -i quickclass-offline.tar"
echo "3. 运行 start.bat 启动"
