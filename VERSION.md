# QuickClass 版本说明

当前版本：**v2026.08.10-V2**

## 版本号规则

格式：`vYYYY.MM.DD[-suffix]`

- `v2026.07.23` - 正式版本
- `v2026.07.23-beta` - 测试版本
- `v2026.07.23-rc1` - 候选版本

## 更新日志

### v2026.08.10-V2

**修复问题**
- 知识库列表显示被哪些课堂引用，删除前增加二次确认（含引用提示与警告）
- 修复导出文件名中文丢失（仅剩日期+横线）
- 修复导入课堂后知识库名称不显示、需刷新才出现的问题

---

### v2026.08.09-V3

**功能增强**
- 新建作业支持导入题目（JSON 文件），与 AI 生成并列，可混合使用
- 已有题目后支持追加导入

---

### v2026.08.09-V2

**修复问题**
- 新建探究项目 404 错误（dist-test 缺少 sub-projects API 路由同步）

---

### v2026.08.08

**核心修复**
- 课堂作业提交事务包裹，修复脏数据问题（submittedAt 有但 QuestionAttempt 空）
- 互动探究刷新丢失修复（API select 补全 htmlContent 等字段）
- 作业导入导出兼容（新格式平铺+旧格式嵌套，注释行剔除，SubProject 必填字段补全）

**功能增强**
- 课堂级学情分析纳入 AI 伴学对话（班级/个人两级）
- 课堂作业报告页独立路由（去嵌入+保留左侧菜单）
- 项目提交浏览页独立路由
- AI 伴学对话历史返回学生姓名

**界面优化**
- 系统信息：版本改为"QuickClass 开源版本"，新增邮箱
- 报告页：去分页（嵌入改路由），增加返回链接，去掉 TeacherLayout 重复菜单
- 导入错误提示显示具体原因

**技术改进**
- 导入导出后端兼容新旧双格式
- 导出去学习活动层，四类内容平铺
- Prisma `_count` → `findMany` + JS 计数（SQLite 可靠）
- AI 报告 ```html 标记清理改用正则（后端+前端双保险）
- 打包脚本加前置校验

---

### v2026.07.31

**界面优化**
- 学生端对话活动：移除教师配置的 description 展示，只保留活动名称
- 学生端对话活动：提示语改为「开始吧！」

---

### v2026.07.23

**修复问题**
- 班级管理导入学生 CSV 文件 GBK 编码乱码 → 改用 ArrayBuffer + TextDecoder 处理编码

**技术改进**
- CSV 文件优先 UTF-8 解码，失败时回退到 GBK
- Excel 文件（.xlsx/.xls）继续使用 binary string

---

### v2026.07.21

**新增功能**
- 学情分析版本切换：对话级/课堂级学生个人学情支持多版本切换查看
- 学情分析删除功能：支持删除指定版本的历史分析记录
- 学生端"全屏查看"：HTML 学情报告支持全屏查看
- 数据型分析模板零依赖：使用纯 SVG 绘制图表，无需下载外部 JS 库

**修复问题**
- 课堂级全班学情分析默认不显示历史版本 → 现在正确显示所有版本号
- 对话级学生个人分析无删除按钮 → 已补上
- 雷达图网格层颜色过淡 → 已优化为清晰可见的中灰色
- 雷达图同心多边形边数不一致 → 已强制几何一致性

**技术改进**
- 后端 API 返回全部历史版本（task_class/task_student/pc_student）
- 前端版本切换时强制重新挂载（key={ins.id}）
- 删除操作同步清理多个 state

### v2026.07.18

- 修复 AI 学伴不回答问题（React 闭包陷阱）
- 修复课堂作业多选题得分统计

### v2026.07.16

- 教学研究功能完善
- TS 类型修复
- 数据库路径修复

---

## 如何检查当前版本

启动服务后，访问 `http://localhost:3000/api/version` 可看到版本信息。

或在项目根目录查看 `VERSION.md` 文件。

---

## 升级指南

### 方法一：自动升级（推荐）

#### macOS / Linux
```bash
./upgrade.sh ~/Downloads/quickclass-test-v20260721.zip
```

#### Windows (CMD)
```cmd
upgrade.bat C:\Users\Downloads\quickclass-test-v20260721.zip
```

#### Windows (PowerShell)
```powershell
.\upgrade.ps1 -ZipPath "C:\Downloads\quickclass-test-v20260721.zip"
```

脚本会自动：
- 备份当前数据库
- 停止服务
- 解压新版本
- 迁移数据库和配置
- 替换旧版本
- 提供回滚命令

### 方法二：手动升级（保留数据）

#### macOS / Linux
```bash
# 1. 备份数据库
cp prisma/dev.db ~/quickclass-backup.db

# 2. 解压新版本到新目录
unzip quickclass-test-v20260721.zip -d quickclass-new

# 3. 迁移数据库
cp ~/quickclass-backup.db quickclass-new/prisma/dev.db

# 4. 启动新版本
cd quickclass-new && ./start.sh
```

#### Windows
```cmd
# 1. 备份数据库
copy prisma\dev.db C:\quickclass-backup.db

# 2. 解压新版本（使用 7-Zip 或右键解压）
# 假设解压到 C:\quickclass-new

# 3. 迁移数据库
copy C:\quickclass-backup.db C:\quickclass-new\prisma\dev.db

# 4. 启动新版本
cd C:\quickclass-new
start.bat
```

### 方法三：原地覆盖

1. **备份数据库**（重要！）
   - macOS/Linux: `cp prisma/dev.db ../backup.db`
   - Windows: `copy prisma\dev.db ..\backup.db`

2. **下载新版本覆盖**
   - 下载新 zip
   - 解压覆盖当前目录（**保留 `prisma/dev.db`**）

3. **重启服务**
   - macOS/Linux: `./stop.sh && ./start.sh`
   - Windows: 双击 `stop.bat` 再双击 `start.bat`

---

## 版本检测机制（未来）

### 自动检测

系统设置页面显示：
- 当前版本：v2026.07.21
- 最新版本：v2026.07.25
- 状态：有新版本可更新

### 手动检测

访问 `http://localhost:3000/api/version/check` 返回：

```json
{
  "current": "v2026.07.21",
  "latest": "v2026.07.25",
  "hasUpdate": true,
  "downloadUrl": "https://example.com/quickclass-v20260725.zip",
  "changelog": "..."
}
```
