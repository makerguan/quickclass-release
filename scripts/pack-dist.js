/**
 * 打包发布版本（不含源码）
 * 用法: node scripts/pack-dist.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST_DIR = 'dist';
const PROJECT_NAME = 'quickclass';

console.log('📦 开始打包...\n');

// 1. 构建生产版本
console.log('🔨 构建生产版本...');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (err) {
  console.error('❌ 构建失败');
  process.exit(1);
}

// 2. 创建 dist 目录
console.log('\n📁 创建分发目录...');
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true });
}
fs.mkdirSync(DIST_DIR);

// 3. 复制必要文件
console.log('📋 复制文件...');

const filesToCopy = [
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  '.env.example',
];

const dirsToCopy = ['.next', 'prisma', 'node_modules'];

filesToCopy.forEach(file => {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(DIST_DIR, file));
    console.log(`   ✓ ${file}`);
  }
});

dirsToCopy.forEach(dir => {
  if (fs.existsSync(dir)) {
    copyDir(dir, path.join(DIST_DIR, dir));
    console.log(`   ✓ ${dir}/`);
  }
});

// 4. 创建 Windows 启动脚本
fs.writeFileSync(path.join(DIST_DIR, 'start.bat'), `@echo off
set NODE_ENV=production
echo Starting QuickClass...
npm start
`);

fs.writeFileSync(path.join(DIST_DIR, 'init-db.bat'), `@echo off
echo 初始化数据库...
npx prisma db push
pause
`);

// 5. 创建 Linux/Mac 启动脚本
fs.writeFileSync(path.join(DIST_DIR, 'start.sh'), `#!/bin/bash
export NODE_ENV=production
echo "Starting QuickClass..."
npm start
`);
fs.chmodSync(path.join(DIST_DIR, 'start.sh'), '0o755');

// 6. 创建 README
fs.writeFileSync(path.join(DIST_DIR, 'README.txt'), `QuickClass 分发包
===================

使用方法：
1. 安装 Node.js (https://nodejs.org)
2. 解压后双击 start.bat 启动（Windows）
   或运行: npm start

依赖已内置，无需联网安装。
数据库已内置测试数据。

如需重新初始化数据库，双击 init-db.bat
`);

console.log('\n🗜️  打包成 zip...');
const zipName = `${PROJECT_NAME}-dist.zip`;
if (fs.existsSync(zipName)) {
  fs.unlinkSync(zipName);
}
execSync(`zip -r "${zipName}" "${DIST_DIR}"`, { stdio: 'inherit' });

console.log('\n✅ 打包完成！');
console.log('📦 产物：');
console.log(`   dist/              ← 分发目录（直接复制到其他电脑）`);
console.log(`   ${zipName}   ← 压缩包（方便传输）`);
console.log('\n📖 使用方式：');
console.log('   1. 解压 zip 或直接使用 dist 目录');
console.log('   2. 安装 Node.js');
console.log('   3. 双击 start.bat 启动（依赖已内置）');

// 辅助函数：复制目录
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}