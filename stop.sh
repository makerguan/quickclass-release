#!/bin/bash
# 停止 QuickClass 服务

echo "正在停止 QuickClass 服务..."

# 查找并终止运行在 3000 端口的 Node.js 进程
PID=$(lsof -ti:3000)

if [ -n "$PID" ]; then
  echo "终止进程 PID: $PID"
  kill $PID
  echo "服务已停止"
else
  echo "未找到运行中的服务"
fi
