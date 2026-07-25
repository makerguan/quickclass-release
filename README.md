# QuickClass - AI 智能体项目化学习平台

**当前版本：v2026.07.23** | [查看完整更新日志](#更新日志)

QuickClass 是一个基于 AI 智能体的项目化学习平台，安装在教师电脑上，支持局域网内多学生同时访问。它将传统课堂教学与 AI 对话式学习深度融合，支持教师设计结构化课堂，学生在 AI 引导下完成探究式学习。

## 版本管理与升级

### 查看当前版本

- **系统设置页面**：教师端右上角显示版本号
- **API 接口**：访问 `http://localhost:3000/api/version`
- **命令行**：`cat VERSION.md`（macOS/Linux）或 `type VERSION.md`（Windows）

### 升级到新版本

#### 自动升级（推荐）

**macOS / Linux:**
```bash
./upgrade.sh ~/Downloads/quickclass-test-v20260721.zip
```

**Windows (CMD):**
```cmd
upgrade.bat C:\Users\Downloads\quickclass-test-v20260721.zip
```

**Windows (PowerShell):**
```powershell
.\upgrade.ps1 -ZipPath "C:\Downloads\quickclass-test-v20260721.zip"
```

升级脚本会自动：
1. 备份当前数据库（`prisma/dev.db`）
2. 停止服务
3. 解压新版本
4. 迁移数据库和配置
5. 替换旧版本
6. 提供回滚命令

#### 手动升级

1. **备份数据库**（重要！）
   - macOS/Linux: `cp prisma/dev.db ../backup.db`
   - Windows: `copy prisma\dev.db ..\backup.db`

2. **下载新版本并解压**

3. **迁移数据库**
   - 将备份的 `dev.db` 复制到新版本的 `prisma/` 目录

4. **启动新版本**
   - macOS/Linux: `./start.sh`
   - Windows: 双击 `start.bat`

> **详细升级指南**：参见 [VERSION.md](./VERSION.md)

## 核心理念与设计思维

### 从「自由对话」到「结构化学习」

传统 AI 教育应用多为开放式对话，学生容易偏离学习目标。QuickClass 引入**三级任务结构**，将学习过程结构化：

```
课堂（顶层）
  └── 学习活动（二级 - 有且只有一个）
        └── 对话活动（三级 - 学生与 AI 交互的入口）
  └── 课堂作业（二级 - 有且只有一个）
        └── 作业（三级）
```

**设计意图**：
- **课堂级**：设定整体学习目标和知识范围，建立学习边界
- **活动级**：将大任务拆解为可管理的探究单元，降低认知负荷；每个课堂仅有一个学习活动和一个课堂作业，便于组织
- **对话/作业级**：每个对话活动聚焦特定话题，AI 引导学生深入探究；作业支持独立训练与评测

### 二级学情分析架构

学情分析采用**三级结构**（课堂 → 学习活动/课堂作业 → 对话活动/作业），分析只针对**课堂整体、各对话活动、各作业**，学习活动和课堂作业不进行独立分析。分析粒度从细到粗：

| 层级 | 分析单位 | 数据来源 | 视角 | 说明 |
|------|---------|---------|------|------|
| **对话活动 / 作业分析** | 单个对话活动或单个作业下的全班学生 | 原始对话 | 班级 + 个体 | 最细粒度，始终使用原始对话 |
| **课堂分析** | 课堂下的所有对话活动和作业 | 原始对话 **或** 各活动报告 | 班级 + 个体 | 受系统设置控制 |
| **班级分析** | 班级下的所有课堂 | 原始对话 **或** 课堂报告 | 班级 + 个体 | 受系统设置控制 |

> 学习活动和课堂作业作为课堂的二级组织结构存在，不进行独立的学情分析。

**数据来源配置**（全局设置，系统设置 → 学情洞察配置）：
- **原始学生对话数据**：直接使用当前班级学生的原始对话数据进行分析
- **已存在报告**：上层分析聚合下层已生成的分析报告，保护隐私

**数据范围限定**：无论选择哪种数据来源，分析范围始终限定在**当前选中的班级**内，不包含其他班级数据。

**分析提示词模板**：每个层级均支持自定义分析提示词模板，提供「AI 自动生成」功能。

**设计意图**：
- 保留学习活动中间层，提供更细粒度的任务组织；每个课堂仅有一个学习活动和一个课堂作业，便于教学流程的统一管理
- 全局统一配置数据来源，避免逐班级重复设置
- 分析范围自动限定在当前班级，数据隔离清晰

### 课堂状态生命周期

课堂具有完整的状态生命周期，支持教学流程管理：

```
未启用 → 启用 → 结束
   ↑               ↓
   └───────────────┘（可暂存）
```

- **未启用**：课堂设计完成，学生不可见，教师可继续调整
- **启用**：学生可见并可以开始对话学习
- **结束**：课堂关闭，学生无法继续对话，但分析数据保留
- **暂存**：从「已结束」回到「未启用」状态，保留所有数据，便于后续再次启用

**设计意图**：让教师可以预先设计课堂、控制学习节奏、结束后进行总结分析。

---

## 功能特性

### 教师端

#### 1. 课堂管理
- **三级结构设计**：课堂 → 学习活动/课堂作业 → 对话活动/作业（学习活动和课堂作业不进行独立分析）
- **年级/学科标记**：课堂可标记年级和学科，便于分类管理
- **知识库附件**：课堂级和学习活动级支持上传文本文件作为知识库（全量注入 AI 上下文，总量限 50,000 字符），支持启用/禁用
- **班级分配**：一个课堂可分配给多个班级
- **课堂状态管理**：未启用 / 启用 / 结束三种状态，控制学生访问权限
- **清理对话记录**：可按班级或全部清理学生对话，支持重新开始

#### 2. 班级管理
- **创建班级**：自定义名称、邀请码（无需学科）
- **学生管理**：查看学生列表、删除学生、**重置密码**（将密码恢复为可用邀请码登录的状态）
- **~~班级学情~~**：~~查看班级学情总览和 AI 洞察分析~~（**已暂时搁置**）
- **AI 回答策略**（系统级配置，不在班级详情中）：
  - 严格依据材料（AI 只基于上传材料回答）
  - 优先材料可补充（优先基于材料，可适当扩展）
  - 自定义 Prompt（教师完全自定义 AI 角色和回答方式）

#### 3. 学情分析（最小单位：对话活动 / 作业）
系统采用**三级学情分析架构**（课堂 → 学习活动/课堂作业 → 对话活动/作业），分析只针对**课堂整体、各对话活动、各作业**，学习活动和课堂作业不进行独立分析。

**三级分析层次**：
- **对话活动分析**（最小单位）：对单个对话活动下全班学生的对话记录进行分析，始终使用原始对话
- **课堂分析**：汇总该课堂下所有对话活动的分析结果或直接分析原始对话，受系统设置控制
- **班级分析**：汇总该班级所有课堂的分析结果或直接分析原始对话，受系统设置控制

**分析数据来源**（全局配置，系统设置 → 学情洞察配置）：
- **原始学生对话数据**：直接使用当前班级学生的原始对话数据进行分析
- **已存在报告**：上层分析聚合下层已生成的分析报告

**提示词模板**：每个层级均支持自定义分析提示词模板，并提供「AI 自动生成」按钮智能生成。

**分析流程**：
```
系统设置中配置数据来源（全局）
    ↓
班级分析（使用课堂报告 or 班级所有原始对话）
    ↓
课堂分析（使用对话活动报告 or 课堂所有原始对话）
    ↓
对话活动分析（始终使用原始对话数据）
```

**分析视角**：支持班级视角（全班所有学生的分析汇总）和个体视角（每个学生的分析）两个维度。

**数据范围**：所有分析的数据来源都限定在「当前选中的班级」范围内。

#### 4. 对话记录
- 查看所有班级的学生与 AI 的对话历史
- **三维筛选**：班级 → 课堂（任务） → 对话活动，三级下拉任意组合筛选
- **分页**：每页 5 条记录，支持上一页/下一页导航
- **姓名搜索**：支持按学生姓名搜索，搜索结果同样支持分页
- 可按班级筛选

#### 5. 系统设置
- **AI 服务配置**：
  - 配置 API Base URL、API Key、AI 模型
  - **推理模式开关**：支持 DeepSeek V4 系列模型的推理思考模式（开启后对话响应可能变慢）
  - **AI 并发限制**：配置同时处理的 AI 请求数量（默认 20，范围 1-200）
    - 建议：小班课(≤30人)设 10-20，中班课(30-60人)设 20-40，大班课(60+人)设 40-100
  - **图片理解**：选择支持视觉/多模态的模型即可启用图片对话功能，推荐模型见下方说明
- **学情洞察配置**：设置各班级的数据来源模式
- **配置管理**：
  - **备份配置**：导出 AI 服务配置为 JSON 文件（默认文件名：`模型名称-日期.json`，如 `qwen-turbo-2026-05-03.json`）
  - **导入配置**：从 JSON 文件导入配置，自动应用并重载 AI 队列
- 支持多种 AI 服务：通义千问、DeepSeek、GPT、GLM 等

#### 6. 教研论文
- **跨课堂数据聚合**：选择多个班级（≥2），将对话记录、作业提交、能力评估、探究活动数据汇总，作为研究素材
- **AI 学术写作**：基于研究主题和汇总数据，自动生成学术风格论文（含摘要、引言、研究方法、研究结果、讨论、结论与建议六部分）
- **字数可调**：支持 2000-8000 字，默认 4000 字
- **提示词模板**：内置多种论文模板（教学反思型、对比研究型、案例分析型），支持自定义
- **历史管理**：保存所有生成的历史论文，可查看、重新生成、删除
- **Word 导出**：一键导出为 `.docx`，符合学术论文排版规范（标题层级、字体字号、行距、页眉页脚）

#### 7. AI 伴学
- **教师一键启用**：在互动探究编辑中开启 AI 伴学，学生端自动显示浮动对话框
- **AI 预分析**：教师首次启用时，AI 完整阅读探究 HTML，生成伴学语义提示词（教师可编辑）
- **秒开机制**：关闭后提示词保留，再次启用无需重新生成
- **学生实时提问**：在互动探究页面右下角点击 🤖 按钮，随时向 AI 提问获取指导
- **上下文感知**：AI 结合探究内容和学生当前操作状态（滚动位置、可见标题、得分等）给出精准指导
- **对话持久化**：学生对话历史自动保存至数据库，下次进入自动加载
- **清空对话**：支持一键清空对话历史（带二次确认）

#### 8. 教学研究（教研宝）
- **数据驱动的研究主题发现**：基于教师所有启用课堂的真实教学数据（互动探究、课堂作业、学生对话、AI 伴学），自动发现可立项的研究方向
- **新建项目**：填写项目名称、选择生成类型（论文/课题）、输入关键字即可创建
- **AI 生成 10 个题目**：基于真实数据特征生成 10 个研究题目，每个题目包含说明、类别、推荐分数、数据证据
- **一键生成初稿**：选择题目后，AI 流式生成完整初稿（论文约 8000 字，课题方案约 2500 字）
- **Word 下载**：生成的论文/课题方案一键下载为 `.docx`，支持 Word/WPS 打开编辑
- **项目管理**：支持查看、删除历史项目，可随时重新生成
- **数据看板**：展示参与度、学习效果、AI 应用等核心指标，自动评估数据质量

---

### 学生端

#### 1. 零注册登录
- 通过「姓名 + 邀请码」即可登录，无需注册账号
- 首次登录自动创建学生账号
- 可选：将邀请码设为密码（勾选后首次可用邀请码直接登录，后续需同时输入邀请码+密码）
- 已设密码的学生登录时需输入「姓名 + 邀请码 + 密码」
- 学生在个人中心可随时修改密码

#### 2. AI 智能体对话学习
- 基于教师上传的材料进行对话学习
- 可选择不同对话活动进行探究
- 对话历史自动保存，支持继续对话
- **图片理解**：支持拍照或上传图片发给 AI 分析（需配置支持视觉的模型）

#### 3. 练习中心
- 完成教师发布的练习题
- 查看答题结果和解析

#### 4. 学习进度追踪
- 查看各知识点的掌握程度
- 追踪学习时长和完成情况

#### 5. 能力评估报告
- 查看教师发布的评估结果
- 了解自身在各维度上的表现

---

## 技术栈

- **前端**：Next.js 14 + TypeScript + Tailwind CSS + TDesign React
- **后端**：Next.js App Router API Routes
- **数据库**：Prisma ORM + SQLite（单文件数据库，便于部署）
- **AI 服务**：Vercel AI SDK + 多模型支持（通义千问、DeepSeek、GPT、GLM 等）
- **知识库检索**：全量注入模式（知识库 ≤ 50,000 字符时整段注入 AI 上下文，零信息丢失）
- **部署**：本地运行，支持局域网访问

---

## 快速开始

### 环境要求
- Node.js 18.17+
- npm 9+

### 安装与启动

**macOS / Linux:**
```bash
./start.sh      # 启动服务
./stop.sh       # 停止服务
```

**Windows:**
```bash
start.bat       # 启动服务
stop.bat        # 停止服务
```

> **离线部署到 Windows**：如果 Windows 电脑无法连接互联网，可提前在 Mac 上打包离线依赖，复制到 Windows 上直接运行。详见下方「离线部署到 Windows」章节。

启动后，教师访问 `http://localhost:3000`，学生通过教师电脑的局域网 IP 访问（如 `http://192.168.1.100:3000`）。

### 离线部署到 Windows

适用于 Windows 电脑无法连接互联网的场景。在 Mac 上提前打包生产构建产物和离线依赖，复制到 Windows 上即可运行。

> **⚠️ 重要：打包时不要包含 `src/` 源码目录**。Windows 部署包仅包含 `.next/` 构建产物，不含源码。因此必须确保构建产物完整可用，详见下方「注意事项」。

#### 部署包内容

| 目录/文件 | 说明 |
|-----------|------|
| `.next/` | Next.js 生产构建产物（由 `npm run build` 生成） |
| `prisma/` | 数据库 schema + migrations + 数据文件 |
| `offline-packages/` | Prisma Windows 引擎 + 依赖 tgz 包 |
| `package.json`、`package-lock.json` | 项目配置 |
| `next.config.mjs`、`tailwind.config.ts`、`tsconfig.json` 等 | 配置文件 |
| `.env` | 环境变量 |
| `start.bat` | Windows 启动脚本 |
| `stop.bat` | Windows 停止脚本 |
| `安装指南.md`、`使用指南.md` | 文档 |

**部署包不包含**：`src/` 源码、`node_modules/`、`.next/cache/` 缓存。

#### 第一步：在 Mac 上打包

```bash
cd /Users/guan/data/quickchat

# 1. 构建生产版本
npm run build

# 2. 创建离线包目录
mkdir -p offline-packages

# 3. 下载所有依赖的 tgz 包
node -e "
const pkg = require('./package.json');
const deps = {...pkg.dependencies, ...pkg.devDependencies};
Object.keys(deps).forEach(name => console.log(name));
" | while read pkg; do
  echo "下载: $pkg"
  npm pack "$pkg" --pack-destination ./offline-packages 2>/dev/null
done

# 4. 下载 Prisma 5.22.0 的 Windows Engine 二进制文件（使用国内镜像）
curl -L -o ./offline-packages/libquery_engine-windows.dll.node.gz \
  "https://registry.npmmirror.com/-/binary/prisma/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/windows/query_engine.dll.node.gz"
gunzip -f ./offline-packages/libquery_engine-windows.dll.node.gz
mv ./offline-packages/query_engine.dll.node ./offline-packages/libquery_engine-windows.dll.node

# 5. 下载 schema-engine.exe（Schema 引擎）
curl -L -o ./offline-packages/schema-engine.exe.gz \
  "https://registry.npmmirror.com/-/binary/prisma/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/windows/schema-engine.exe.gz"
gunzip -f ./offline-packages/schema-engine.exe.gz

# 6. 下载 prisma-fmt.exe（格式化引擎）
curl -L -o ./offline-packages/prisma-fmt.exe.gz \
  "https://registry.npmmirror.com/-/binary/prisma/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/windows/prisma-fmt.exe.gz"
gunzip -f ./offline-packages/prisma-fmt.exe.gz

# 7. 打包生产构建包（排除源代码、缓存和开发依赖）
zip -r quickchat-windows.zip \
  .next/ \
  prisma/ \
  offline-packages/ \
  package.json \
  package-lock.json \
  next.config.mjs \
  tailwind.config.ts \
  postcss.config.mjs \
  tsconfig.json \
  next-env.d.ts \
  .env \
  start.bat \
  stop.bat \
  check-templates.ts \
  安装指南.md \
  使用指南.md \
  -x "prisma/.DS_Store" "prisma/prisma/*" ".next/cache/*"
```

#### 第二步：复制到 Windows 电脑

将 `quickchat-windows.zip` 复制到 Windows 电脑上（U 盘或移动硬盘），解压到目标目录（如 `D:\quickclass`）。

#### 第三步：在 Windows 上启动

1. **安装 Node.js 18+**（唯一需要网络的地方，从 https://nodejs.org 下载安装）
2. 解压 `quickchat-windows.zip` 到目标目录
3. **双击 `start.bat`**，脚本会自动完成：
   - 检查 Node.js 版本
   - 从 `offline-packages/` 安装所有依赖（**无需网络**）
   - 自动放置 Prisma Windows 引擎
   - 初始化数据库（首次自动创建）
   - 启动生产服务

> 首次启动时，`start.bat` 会自动执行所有步骤。如果依赖已安装、数据库已存在，会跳过对应步骤直接启动。

#### 注意事项（打包时务必检查）

1. **`src/lib/prisma.ts` 中数据库路径必须使用 `process.cwd()`**
   - ❌ 错误写法（使用 `import.meta.url`）：
     ```typescript
     const __filename = fileURLToPath(import.meta.url);
     const __dirname = path.dirname(__filename);
     const dbPath = path.join(__dirname, "..", "..", "prisma", "dev.db");
     ```
     Next.js 构建时会将 `import.meta.url` 替换为**构建机器的绝对路径**（如 `/Users/xxx/quickchat/src/lib/prisma.ts`），在 Windows 上会找不到数据库。
   - ✅ 正确写法：
     ```typescript
     const dbPath = path.join(process.cwd(), "prisma", "dev.db");
     ```
     `process.cwd()` 在运行时获取工作目录，跨平台兼容。

2. **`start.bat` 中不要包含自动构建逻辑**
   - 因为部署包不含 `src/` 源码，`npm run build` 会失败
   - `start.bat` 应只检查 `.next\BUILD_ID` 是否存在，不存在时提示用户重新解压

3. **打包前必须重新构建**
   ```bash
   npm run build
   ```
   确保 `.next/` 构建产物是最新的，且使用修正后的 Prisma 路径。

4. **不要包含 `.next/cache/`**
   缓存文件在 Windows 上不需要，可以排除以减小包体积。

5. **不要包含 `node_modules/`**
   依赖通过 `offline-packages/*.tgz` 在 Windows 上离线安装，不需要打包 Mac 版的 `node_modules`。

6. **验证打包完整性**
   打包后检查 zip 中是否包含以下关键文件：
   ```bash
   unzip -l quickchat-windows.zip | grep -E "BUILD_ID|start\.bat|prisma/dev\.db|offline-packages/libquery_engine"
   ```

7. **`.bat` 文件行尾必须是 CRLF（`\r\n`）**
   - 在 macOS 上修改 `start.bat` / `stop.bat` 后，文件会被保存为 LF（Unix 格式），Windows CMD 无法正确解析
   - 后果：CMD 把所有行当作一个长行拼接，出现类似 `start.batQuickClass'不是内部或外部命令` 的乱码错误
   - 打包前必须将 `.bat` 文件转换为 CRLF 格式：
   ```bash
   awk 'BEGIN{ORS="\r\n"}1' start.bat > start.bat.tmp && mv start.bat.tmp start.bat
   awk 'BEGIN{ORS="\r\n"}1' stop.bat > stop.bat.tmp && mv stop.bat.tmp stop.bat
   ```
   - `.sh` 文件（`start.sh` / `stop.sh`）则必须保持 LF 格式，不要转换

#### offline-packages 目录内容

打包后应包含以下 Windows 离线依赖：

```
offline-packages/
├── libquery_engine-windows.dll.node   # Prisma 查询引擎
├── schema-engine.exe                 # Prisma Schema 引擎
├── prisma-fmt.exe                    # Prisma 格式化引擎
├── ai-6.0.168.tgz
├── ai-sdk-openai-3.0.53.tgz
├── ai-sdk-react-3.0.170.tgz
├── bcryptjs-3.0.3.tgz
├── eslint-8.57.1.tgz
├── eslint-config-next-14.2.35.tgz
├── jose-6.2.2.tgz
├── next-14.2.35.tgz
├── next-auth-4.24.14.tgz
├── p-queue-8.1.1.tgz
├── postcss-8.5.12.tgz
├── prisma-5.22.0.tgz
├── prisma-client-5.22.0.tgz
├── prisma-engines-5.22.0.tgz
├── react-18.3.1.tgz
├── react-dom-18.3.1.tgz
├── react-markdown-10.1.0.tgz
├── recharts-3.8.1.tgz
├── remark-gfm-4.0.1.tgz
├── tailwindcss-3.4.1.tgz
├── tailwindcss-typography-0.5.19.tgz
├── tdesign-icons-react-0.6.4.tgz
├── tdesign-react-1.16.8.tgz
├── types-bcryptjs-2.4.6.tgz
├── types-node-20.19.39.tgz
├── types-react-18.3.28.tgz
├── types-react-dom-18.3.7.tgz
├── typescript-5.9.3.tgz
├── xenova-transformers-2.17.2.tgz
└── zustand-5.0.12.tgz
```

#### 数据同步

如果 Mac 上后续新增了数据（学生对话、课堂等），只需将 `prisma/dev.db` 文件复制到 Windows 电脑上覆盖即可，无需重新打包。

### 首次使用流程

#### 第一步：教师注册
1. 访问首页，点击「教师注册」
2. 填写邮箱、密码、姓名完成注册

#### 第二步：配置 AI 服务
1. 进入「系统设置」
2. 填写 AI Base URL（如 `https://dashscope.aliyuncs.com/compatible-mode/v1`）
3. 填写 API Key
4. 选择 AI 模型（如 `qwen-turbo`）
5. 点击「测试连接」确认配置正确
6. 点击「保存配置」

#### 第三步：创建班级
1. 进入「班级管理」
2. 点击「创建班级」
3. 填写班级名称、自定义邀请码（如 `MATH2024`）
4. 保存后记录邀请码，用于学生加入

#### 第四步：创建课堂
1. 进入「课堂管理」
2. 点击「创建课堂」
3. 填写课堂标题、年级、学科、目标、要求
4. （可选）上传知识库附件（支持 .txt .md 等文本文件，总量不超过 50,000 字符）
5. 添加学习活动（至少一个）
6. 在每个学习活动下添加对话活动
7. （可选）为学习活动上传专属知识库附件
8. 选择要分配的班级
9. 保存课堂（状态为「未启用」）

#### 第六步：启动课堂
1. 在「课堂管理」列表中找到创建的课堂
2. 点击「启用」按钮，将课堂状态切换为「启用」
3. 学生现在可以看到并开始学习

#### 第七步：学生加入
1. 学生访问教师电脑的 IP 地址
2. 点击「学生入口」
3. 输入姓名和邀请码
4. 进入后即可看到已启用的任务，选择对话活动开始学习

---

## 详细操作指南

### 课堂管理

#### 创建课堂
1. 进入「课堂管理」页面
2. 点击「创建课堂」按钮
3. 填写基本信息：
   - **课堂标题**：简短明确的名称
   - **年级/学科**：（可选）如七年级、数学，便于分类和筛选
   - **课堂目标**：学生通过此课堂应达成的学习目标
   - **课堂要求**：对学生完成课堂的明确要求
   - **知识库附件**：（可选）上传 .txt/.md 等文本文件，系统自动读取内容作为 AI 知识库（总量不超过 50,000 字符）
4. 添加学习活动：
   - 每个课堂可包含多个学习活动
   - 每个学习活动需填写标题、目标、要求
   - 学习活动可配置专属知识库附件
5. 添加对话活动：
   - 在每个学习活动下添加对话活动
   - 填写对话主题和说明/引导语
   - （可选）配置自定义系统提示词，覆盖默认 AI 行为
6. 分配班级：
   - 点击班级标签进行分配
   - 一个课堂可分配给多个班级
7. 点击「创建课堂」保存

#### 课堂状态切换
- **启用**：课堂变为「启用」状态，学生端可见并可开始对话
- **结束**：课堂变为「已结束」状态，学生无法继续对话，但分析数据保留
- **暂存**：从「已结束」回到「未启用」，保留所有数据，可重新编辑后再次启用

#### AI 自动创建课堂

教师填写课堂基本信息（标题、年级、学科、目标、要求）后，可点击「AI 自动创建」按钮，系统将：
1. 根据课堂信息，AI 自动设计 **1 个学习活动**（容器）
2. AI 根据学习目标和内容，自主决定生成 **2-4 个对话活动**
3. AI 根据课堂信息，设计 **1 个课堂作业**（含 5-10 道选择/判断题）

AI 创建后直接保存到数据库，教师可进入课堂编辑页面继续调整对话活动和作业。

**数据格式校验与修复**：
- AI 生成内容后，系统会校验 JSON 格式、字段完整性、题目答案有效性等
- 若格式不符，自动修复为一致格式（如补充必填字段、修正 answer 格式）
- 校验失败时返回错误，教师可重试或手动创建

**数据格式统一规范**（AI 创建 / 手动创建 / 导入导出 均遵循此结构）：

```typescript
interface TaskExport {
  title: string;
  description?: string;
  grade?: string;
  subject?: string;
  objectives: string;
  requirements: string;
  knowledgeBase?: string;
  subProjects: [{
    title: string;
    objectives: string;
    requirements: string;
    presetConversations: [{
      title: string;
      description?: string;
      systemPrompt: string;
      analysisPrompt: string;
    }];
    quizActivities: [{
      title: string;
      description?: string;
      questions: [{
        type: "SINGLE_CHOICE" | "TRUE_FALSE";
        content: string;
        options?: string;  // JSON string: {"A":"...","B":"...","C":"...","D":"..."}
        answer: string;    // A/B/C/D 或 T/F
        difficulty: "BASIC" | "INTERMEDIATE" | "ADVANCED";
        explanation?: string;
      }];
    }];
  }];
}
```

#### 清理对话记录
1. 在课堂列表中找到要清理的课堂
2. 点击「清理对话」按钮（刷新图标）
3. 选择要清理的班级，或选择「全部班级」
4. 确认清理

**注意**：清理操作删除对话记录和消息，但保留学情分析结果。此操作不可撤销。

### 学情分析使用

#### 课堂级学情分析
1. 在「课堂管理」列表中点击课堂的「学情分析」按钮（图表图标）
2. 选择要查看的班级
3. 查看统计数据、学习活动进展、学生个体数据
4. 点击「生成洞察」或「重新分析」生成 AI 学情报告
5. 可查看历史版本对比

#### 班级级学情总览
1. 进入「班级管理」
2. 点击班级名称进入详情
3. 查看班级统计和 AI 班级洞察
4. 查看各课堂的参与度统计

#### 学情洞察综合视图
1. 进入「学情洞察」页面
2. 选择要查看的班级
3. 查看班级学情洞察、课堂级分析、学生洞察
4. 可在此页面直接切换数据来源配置

### 数据来源配置

1. 进入「系统设置」
2. 找到「学情洞察配置」区域
3. 为每个班级选择数据来源：
   - **原始对话数据**：分析更全面，但涉及原始对话内容
   - **任务分析结果**：仅使用汇总分析，保护隐私
4. 配置即时生效，影响后续生成的班级学情洞察

---

## 项目结构

```
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API 路由
│   │   │   ├── ai-analysis/   # AI 学情分析 API
│   │   │   │   └── class-summary/  # 班级学情汇总 API
│   │   │   ├── auth/          # 认证相关 API
│   │   │   ├── classes/       # 班级管理 API
│   │   │   ├── conversations/ # 对话记录 API
│   │   │   ├── exercises/     # 练习 API
│   │   │   ├── materials/     # 学习材料 API
│   │   │   ├── student/       # 学生端 API
│   │   │   ├── system-config/ # 系统配置 API
│   │   │   └── tasks/         # 任务管理 API
│   │   │       ├── [taskId]/           # 单个任务操作
│   │   │       └── [taskId]/insights/  # 任务学情分析
│   │   ├── login/             # 教师登录页面
│   │   ├── register/          # 教师注册页面
│   │   ├── student/           # 学生端页面
│   │   │   ├── chat/          # AI 对话学习
│   │   │   ├── evaluation/    # 能力评估
│   │   │   ├── exercise/      # 练习中心
│   │   │   ├── insights/      # 学生学情查看
│   │   │   ├── join/          # 加入班级
│   │   │   └── progress/      # 学习进度
│   │   └── teacher/           # 教师端页面
│   │       ├── classes/       # 班级管理
│   │       ├── conversations/ # 对话记录查看
│   │       ├── dashboard/     # 仪表板（学情总览）
│   │       ├── insights/      # 学情洞察综合视图
│   │       ├── settings/      # 系统设置
│   │       ├── students/      # 学生管理
│   │       └── tasks/         # 任务管理
│   ├── components/            # React 组件
│   │   ├── chat/             # 聊天相关组件
│   │   └── layout/           # 布局组件
│   │       ├── StudentLayout.tsx  # 学生端布局
│   │       └── TeacherLayout.tsx  # 教师端布局
│   └── lib/                   # 工具函数和配置
│       ├── ai.ts             # AI 服务配置
│       ├── ai-queue.ts       # AI 请求队列
│       ├── auth.ts           # 认证工具
│       ├── bm25.ts           # BM25 文本检索（备用）
│       ├── chunker.ts        # 文本分块工具
│       └── prisma.ts         # Prisma 客户端
├── prisma/
│   ├── schema.prisma          # 数据库模型定义
│   └── dev.db                 # SQLite 数据库文件
├── start.sh                   # macOS/Linux 启动脚本
├── start.bat                  # Windows 启动脚本
├── stop.sh                    # macOS/Linux 停止脚本
├── stop.bat                   # Windows 停止脚本
└── next.config.mjs            # Next.js 配置
```

### 核心数据模型

```
User                          # 用户（教师/学生）
  ├── Class (teacher)         # 教师创建的班级
  ├── LearningTask            # 教师创建的课堂
  ├── Conversation            # 学生的对话记录
  └── AIInsight               # AI 学情分析结果

Class                         # 班级
  ├── students                # 班级学生
  ├── conversations           # 班级对话记录
  └── aiInsights              # 班级学情分析

LearningTask                  # 课堂（顶层）
  ├── grade / subject         # 年级、学科标记
  ├── knowledgeBase           # 知识库内容（由附件上传读取，全量注入 AI 上下文）
  ├── knowledgeBaseIds        # 引用的知识库 ID 列表（JSON，仅启用状态可选）
  ├── subProjects             # 学习活动（二级）
  │     └── presetConversations  # 对话活动（三级）
  └── assignments             # 班级分配

AIInsight                     # AI 学情分析结果
  ├── type: "class"           # 班级级分析
  ├── type: "student"         # 学生个体分析
  └── version                 # 版本号，支持历史对比
```

---

## 学情分析架构详解

### 分析层次（最小单位：对话活动 / 作业）

系统采用**三级学情分析架构**（课堂 → 学习活动/课堂作业 → 对话活动/作业），分析只针对课堂整体、各对话活动、各作业，学习活动和课堂作业不进行独立分析。分析粒度从细到粗依次为：

| 层级 | 分析对象 | 数据来源（原始对话） | 数据来源（分析结果） |
|------|---------|---------------------|---------------------|
| **对话活动 / 作业** | 单个对话活动或单个作业下的对话 | 直接分析全班原始对话（始终如此，无下层数据） | 同左侧 |
| **课堂** | 该课堂下所有对话活动和作业 | 汇总该课堂下**所有对话活动和作业**的原始对话 | 汇总该课堂下各活动/作业的**班级报告 + 学生报告** |
| **班级** | 该班级下所有课堂 | 汇总该班级**所有课堂所有对话活动和作业**的原始对话 | 汇总该班级下各课堂的**班级报告 + 学生报告** |

**分析视角**：每个层级均支持班级视角（全班汇总）和个体视角（每个学生独立分析）。

**数据范围**：所有分析的数据来源都限定在「当前选中的班级」范围内。

### 数据流向

```
系统设置中配置数据来源（全局：原始学生对话数据 或 已存在报告）
       ↓
  ┌──────────────────────────────────────────┐
  │ 对话活动分析 ─────────────→ 课堂分析     │
  │      ↓                            ↓      │
  │   班级分析（汇总各课堂报告）               │
  └──────────────────────────────────────────┘
```

### 对话活动分析（最小单位）

**分析对象**：单个对话活动下，全班所有学生的对话记录

**数据来源**：
- 无论系统设置为何种数据来源，对话活动分析均使用原始对话（无下层数据可用）

**分析维度**：
- 参与情况：该对话活动有多少学生开始对话，完成情况
- 对话质量：消息数量、学生提问深度
- 学习表现：学生对核心概念的掌握程度、常见误区

**输出**：AI 生成的对话活动分析报告

### 课堂分析

**数据来源**（受系统设置控制）：
- 若配置为「原始学生对话数据」：汇总该课堂下所有对话活动中所有学生的原始对话（范围：当前班级）
- 若配置为「已存在报告」：汇总该课堂下各对话活动的**班级报告**和**学生报告**

**分析维度**：
- 课堂目标达成情况
- 各对话活动进展对比
- 学生分层与个体关注
- 教学改进建议

**输出**：AI 生成的课堂分析报告

### 班级分析

**数据来源**（受系统设置控制）：
- 若配置为「原始学生对话数据」：汇总该班级所有课堂所有对话活动中所有学生的原始对话
- 若配置为「已存在报告」：汇总该班级下各课堂的**班级报告**和**学生报告**

**分析维度**：
- 班级整体学情总览
- 各课堂表现对比
- 学生分层与差异分析
- 教学改进建议

**输出**：AI 生成的班级分析报告

### 学生分析数据来源详解

学生分析（个体视角）的数据来源与班级分析不同，各层级在不同配置下的数据来源如下：

#### 配置为「原始学生对话数据」（CONVERSATIONS）

| 层级 | 数据来源 |
|------|---------|
| **对话活动** `pc_student` | 该学生在**该对话活动**的原始对话记录（messages） |
| **课堂** `task_student` | 该学生在**该课堂下所有对话活动**的原始对话记录（messages） |
| **班级** `student` | 该学生在**本班级所有课堂所有对话活动**的原始对话记录（messages） |

#### 配置为「已存在报告」（TASK_INSIGHTS）

| 层级 | 数据来源 | 类型 |
|------|---------|------|
| **对话活动** `pc_student` | 该学生在**该对话活动**的原始对话记录（messages） | 直接分析 |
| **课堂** `task_student` | 聚合该学生在**该课堂下各对话活动的 `pc_student` 报告** | 聚合下层结果 |
| **班级** `student` | 聚合该学生在**本班级下各课堂的 `task_student` 报告** | 聚合下层结果 |

#### 关键逻辑

- **对话活动级学生分析**：无论何种配置，都直接读取原始对话数据（因为对话活动是最小分析单位，没有下层数据）
- **课堂级学生分析**：
  - `CONVERSATIONS`：直接读取该课堂下所有对话活动的原始对话（限定当前班级）
  - `TASK_INSIGHTS`：聚合该课堂下各对话活动的 `pc_student` 分析结果
- **班级级学生分析**：
  - `CONVERSATIONS`：直接读取该班级所有课堂所有对话活动的原始对话
  - `TASK_INSIGHTS`：聚合该班级下各课堂的 `task_student` 分析结果

#### 数据存储标识

AI 分析结果存储在 `AIInsight` 表中，通过以下字段标识：

| 字段 | 说明 |
|------|------|
| `type` | 分析类型：`pc_class`（对话活动班级）、`pc_student`（对话活动学生）、`task_class`（课堂班级）、`task_student`（课堂学生）、`class`（班级总览）、`student`（班级个人） |
| `classId` | 所属班级 ID |
| `userId` | 学生分析时关联学生 ID，班级分析时为 `null` |
| `scopeId` | 作用域 ID：对话活动类型存 `presetConversationId`，课堂类型存 `taskId`，班级类型为空 |
| `version` | 版本号，重新分析时递增，支持历史对比 |

### 下级报告缺失检查

当系统配置为「已存在报告」时，生成上层分析前会检查下层分析是否完整：

1. **检查范围**：
   - 课堂级生成前：检查各对话活动的 `pc_class` 和 `pc_student`
   - 班级级生成前：检查各课堂的 `task_class` 和 `task_student`
2. **排除规则**：没有学生参与的对话活动/课堂不提示
3. **用户交互**：有缺失时弹出对话框，列出缺失项，用户可选择「忽略缺失，继续分析」或「取消」

### 学情洞察综合视图

**数据来源配置的影响**：

| 配置 | 说明 | 适用场景 |
|------|------|---------|
| **原始学生对话数据** | 直接分析当前班级学生真实对话记录，分析更详细深入 | 日常教学、深度分析 |
| **已存在报告** | 基于下层已生成的分析结果逐级汇总，不涉及具体对话内容 | 隐私保护、对外展示 |

**使用建议**：
- 日常教学中可使用「原始学生对话数据」获得更深入的分析
- 对外展示或涉及隐私顾虑时使用「已存在报告」

### 分析提示词模板

每个层级（对话活动、课堂、班级）均支持：
- **自定义提示词模板**：教师可编写适合自己教学场景的分析提示词
- **AI 自动生成**：点击按钮，AI 根据该层级的上下文智能生成提示词模板

### 分析 Prompt 优先级与字数限制

AI 分析 Prompt 的构建遵循固定的优先级规则，确保教师自定义内容与系统约束互不冲突：

**Prompt 结构（从上到下）：**
```
[分析数据内容]                ← 学生的对话记录或下层分析结果
[教师自定义分析模板]          ← 从 AnalysisTemplate 表读取的默认模板（如有）
  或
[活动级分析提示词]            ← 回退：learningTask.analysisPrompt / subProject.analysisPrompt / pc.analysisPrompt（如无模板）
---
[输出格式要求]                ← 固定的 Markdown 标题结构
[强制输出约束]                ← getWordLimitPrompt：字数硬限制 + 禁止开场白 + 末尾评分星星
                               ← 始终在最后，不能被任何模板替代
```

**优先级规则：**
1. **`AnalysisTemplate`（系统设置中的默认模板）**：优先使用，放在数据内容之后、字数限制之前
2. **`analysisPrompt`（活动级提示词）**：当未选择系统模板时，回退使用活动上配置的自定义提示词
3. **字数限制（输出压缩）**：始终作为 Prompt 的最后一部分，**不能被任何模板替代**。教师自定义模板只影响分析指令，不影响字数约束

**设计意图**：字数限制是系统级约束，确保分析结果长度可控，避免因模板内容过长导致输出不可控。教师自定义模板仅用于定制分析角度和重点，不覆盖输出长度控制。

### 学生聊天对话提示词拼接（与学情分析无关）

学情分析提示词和学生聊天对话提示词是**两套完全独立的系统**。学生与 AI 对话时使用的提示词拼接方式如下：

**代码位置**：`src/app/api/chat/route.ts`

**提示词构成 = 硬编码 + 系统数据 + 用户提示词 + 知识库**：

| 类别 | 内容 | 说明 |
|------|------|------|
| **硬编码** | `## 当前课堂：`、`年级： 学科：`、`课堂目标：`、`\n## 课堂知识库：\n`、`\n## 知识库「...」：\n`、`\n对话目标：` | 代码中写死的 6 个标题前缀 |
| **系统数据** | `task.title`、`task.grade`、`task.subject`、`task.objectives` | 教师在课堂编辑时填写的字段 |
| **知识库** | `task.knowledgeBase`（课堂级文本）、`kb.content`（引用的知识库条目） | 条件注入：有值时才出现在 prompt 中 |
| **用户提示词** | `presetConv.systemPrompt`（即"ABC"） | 教师在对话活动中填写，追加到末尾 |

**有对话活动时（`presetConversationId`）的完整 prompt 结构**：

```
## 当前课堂：${task.title}                     ← 硬编码标题 + 系统数据
年级：${task.grade}  学科：${task.subject}      ← 系统数据
课堂目标：${task.objectives}                    ← 硬编码标题 + 系统数据

## 课堂知识库：                                 ← 条件：task.knowledgeBase 有值
${task.knowledgeBase}                           ← 系统数据

## 知识库「${kb.name}」：                       ← 条件：knowledgeBaseIds 有值，每条一条
${kb.content}                                   ← 系统数据

对话目标：${presetConv.description}            ← 硬编码标题 + 系统数据
${presetConv.systemPrompt}                      ← 用户提示词（"ABC"）
```

**无对话活动时（自由聊天/班级策略）**：
1. 通过 `getClassPromptByStrategy()` 获取班级 AI 策略提示词（严格依据材料 / 优先参考材料 / 自定义）
2. 全量注入该班级的**学习材料**（`学习材料内容：[片段1]...`）

**两者共同点**：末尾如有图片消息则追加 `IMAGE_NOTICE`（提示 AI 观察图片）。

**关键区别**：聊天对话提示词**没有**字数限制、禁止开场白、评分星星等约束——这些只存在于学情分析提示词中。学生与 AI 的对话不受输出格式约束，AI 可以自由问答。

---

## 知识库与全量注入架构

### 知识库管理（独立资产）

系统提供独立的知识库管理功能，教师可以创建多个 Markdown 知识库条目，作为独立资产在课堂中引用。

**核心设计**：
- **知识库是独立资产**：以 Markdown 文档形式存储，可被多个课堂复用
- **启用/禁用控制**：知识库可单独启用或禁用，禁用后课堂中不可选择；列表中启用的排最前
- **课堂级引用**：一个课堂可引用一条或多条**已启用**的知识库，该课堂下所有学习活动和对话活动自动继承
- **全量注入**：对话时将知识库全文注入 AI 的 System Prompt，确保零信息丢失、零检索偏差
- **容量限制**：课堂引用的知识库总字符数不超过 50,000（约 15,000 tokens），在主流大模型上下文窗口内

```
知识库管理页面
  ├── 瞿秋白纪念馆资料
  ├── 光合作用参考资料
  └── 力学知识点汇总
课堂（LearningTask）
  ├── 引用知识库：[瞿秋白纪念馆资料, 光合作用参考资料]
  ├── 学习活动 1
  │     └── 对话活动 A ← 自动使用课堂引用的知识库（全文注入）
  └── 学习活动 2
        └── 对话活动 B ← 自动使用课堂引用的知识库（全文注入）
```

**使用流程**：
1. 教师进入「知识库」页面，创建知识库条目（名称 + Markdown 内容，或上传 .txt/.md 文件）
2. 上传后即可被课堂引用，无需额外操作
3. 可随时启用/禁用知识库，禁用后课堂中不再显示该知识库（已引用的不受影响）
4. 在创建/编辑课堂时，通过标签多选引用一条或多条已启用的知识库（总字符数 ≤ 50,000）
5. 学生对话时，系统将课堂引用的所有知识库全文注入 AI 的 System Prompt

### 为什么选择全量注入？

对于知识库 ≤ 50,000 字符的教学场景，全量注入优于检索增强（RAG）：

| 对比维度 | 全量注入 | RAG 检索 |
|---------|---------|---------|
| **信息完整性** | 100%，AI 看到全部资料 | 依赖召回率，可能遗漏关键内容 |
| **回答准确性** | 严格依据资料，减少幻觉 | 检索不到的部分 AI 可能编造 |
| **部署复杂度** | 零依赖，无需模型/索引 | 需要 Embedding 模型 + 向量库 + 分块策略 |
| **运行稳定性** | 纯文本拼接，不会出错 | 模型加载/推理可能失败 |
| **Token 消耗** | 较高（每次带全文 ~15K tokens） | 较低（只带检索片段 ~2K tokens） |
| **适用规模** | ≤ 50,000 字符 | 无上限 |

**成本估算**：50 人同时对话，每人平均 20 轮，知识库 20,000 字符（~8K tokens）：
- 总输入 tokens ≈ 50 × 20 × 8K = 800 万 tokens
- DeepSeek 成本 ≈ ¥8，GPT-4o-mini ≈ ¥2.4
- 教学场景下完全可以接受

### 架构示意

```
学生提问
   ↓
构建 System Prompt（系统提示 + 知识库全文 + 对话活动配置）
   ↓
云端 AI API（streamText）→ 流式回复
```

**设计要点**：
- 每个学生对话独立，互不干扰
- 同一课堂的知识库全文每次请求都完整注入
- 50,000 字符 ≈ 15,000 tokens，加上对话历史，总计在 20K tokens 以内，主流模型上下文窗口完全覆盖

### 并发能力

系统针对单机部署场景做了并发优化，支撑课堂教学使用：

| 场景 | 同时在线 | 体验说明 |
|------|---------|---------|
| **单班教学** | ~50 人 | **流畅**。全量注入无额外计算开销，仅 AI API 调用 |
| **多班同时** | 100~200 人 | **基本可用**。AI 回复排队，响应稍有延迟 |
| **大规模** | 500+ 人 | 不建议。SQLite 写锁 + API 流控会成为瓶颈 |

**优化措施**：

| 优化项 | 实现方式 | 效果 |
|--------|---------|------|
| **SQLite 写队列** | 所有数据库写入串行化排队，避免文件锁冲突 | 多人同时发消息不会超时或报错 |
| **AI 对话并发** | 最多 5 个并发 AI 请求，自动排队处理 | 充分利用 API 流控，学生请求有序响应 |
| **生产模式** | `npm start` 而非 `npm run dev` | CPU/内存效率提升 3~5 倍，连接复用 |
| **全量注入** | 无需 Embedding 计算，无检索开销 | 对话零延迟启动，无模型加载等待 |

**无需安装任何数据库软件**：SQLite 是单文件数据库（`dev.db`），复制项目时连带文件一起复制，Node.js 直接读写，开箱即用。

---

## 数据管理

所有数据保存在 **`prisma/dev.db`** 这一个 SQLite 文件中。

### 查看数据

**命令行方式：**
```bash
# 进入 SQLite 命令行
sqlite3 prisma/dev.db

# 常用命令
.tables                          # 查看所有表
.schema User                     # 查看表结构
SELECT * FROM User;              # 查询用户
SELECT * FROM Class;             # 查询班级
SELECT * FROM LearningTask;      # 查询课堂
SELECT * FROM SubProject;        # 查询学习活动
SELECT * FROM PresetConversation; # 查询对话活动
SELECT * FROM Conversation;      # 查询对话
SELECT * FROM Message;           # 查询消息
SELECT * FROM AIInsight;         # 查看 AI 分析结果
SELECT * FROM Material;          # 查看学习材料
SELECT * FROM DocumentChunk;     # 查看文本分块与向量
SELECT * FROM SystemConfig;      # 查看系统配置
.quit                            # 退出
```

**图形化工具（推荐）：**

| 工具 | 说明 |
|------|------|
| [DB Browser for SQLite](https://sqlitebrowser.org) | 免费开源，最推荐，打开 .db 文件即可浏览和编辑 |
| [DBeaver](https://dbeaver.io) | 社区版免费，功能强大 |
| [TablePlus](https://tableplus.com) | Mac 用户推荐，免费版够用 |

使用方法：打开工具 → 打开数据库 → 选择 `prisma/dev.db`，即可可视化查看所有表和数据。

### 备份与恢复

**手动备份：**
```bash
# 方法1：直接复制文件（需先停止应用）
cp prisma/dev.db prisma/dev_backup_$(date +%Y%m%d).db

# 方法2：使用 SQLite 安全导出（运行中也可执行）
sqlite3 prisma/dev.db ".backup prisma/dev_backup_$(date +%Y%m%d).db"
```

**恢复数据：**
```bash
# 停止应用后，用备份文件替换当前数据库
cp prisma/dev_backup_20260423.db prisma/dev.db
```

**导出为 SQL 文本：**
```bash
# 将整个数据库导出为 SQL 脚本
sqlite3 prisma/dev.db .dump > backup_$(date +%Y%m%d).sql

# 从 SQL 脚本恢复
rm prisma/dev.db
sqlite3 prisma/dev.db < backup_20260423.sql
```

> **提示**：建议每次修改重要设置或定期（如每周）备份一次 `prisma/dev.db` 文件。

### 数据库操作命令

所有数据库操作均通过 npm scripts 执行，**必须从项目根目录运行**：

```bash
npm run db:push      # 推送 schema 到数据库（创建/更新表结构，不迁移）
npm run db:migrate   # 运行 Prisma 迁移（开发时用）
npm run db:seed      # 填充示例数据（教师账号、班级、学生、课堂等）
npm run db:reset     # 重置数据库（删除所有数据，重新运行所有迁移）
```

**示例数据登录信息：**
- 教师：`teacher@quickclass.com` / `123456`
- 学生：`zhang@student.com` / `123456`
- 班级邀请码：`MATH2026`

> **注意**：`DATABASE_URL` 使用相对路径 `file:./prisma/dev.db`，所有命令必须从项目根目录执行，避免路径解析错误。

---

## 常见问题

### Q: 学生无法访问教师电脑上的服务？
A: 确保教师电脑防火墙允许 3000 端口访问。学生应使用教师电脑的局域网 IP 地址访问（如 `http://192.168.1.100:3000`），而非 `localhost`。

### Q: AI 无法回答问题？
A: 检查系统设置中的 AI 配置是否正确，点击「测试连接」确认。确保 API Key 有效且未过期。

### Q: 如何更换 AI 模型？
A: 进入「系统设置」，在 AI 模型下拉框中选择其他模型，或选择「自定义模型」手动输入模型名称。

### Q: 课堂创建后学生看不到？
A: 课堂创建后默认状态为「未启用」，需要点击「启用」按钮后学生才能看到。

### Q: 如何重新开始一个课堂？
A: 先将课堂状态切换为「结束」，然后使用「清理对话」功能删除学生对话记录，最后将状态暂存为「未启用」→「启用」。

### Q: 学情洞察数据来源切换后，历史分析会改变吗？
A: 不会。数据来源配置只影响后续新生成的班级学情洞察，已有的分析结果保持不变。

### Q: 首次上传知识库或对话时响应很慢？
A: 当前版本采用全量注入模式，知识库直接注入 AI 上下文，无需本地模型计算，响应速度取决于 AI API 的网络延迟。

### Q: 知识库内容有大小限制吗？
A: 课堂引用的知识库总字符数不超过 50,000（约 15,000 tokens）。这个限制确保知识库全文能完整放入 AI 的上下文窗口，保证零信息丢失。选择知识库时会实时显示总字符数进度条，超出限制的无法添加。如果单个知识库过大，建议拆分为多个独立知识库，或精简内容保留核心部分。

### Q: 知识库禁用后有什么影响？
A: 禁用的知识库不会出现在课堂管理的选择列表中，但已经被课堂引用的知识库不受影响（仍然会注入 AI 上下文）。如需从课堂中移除已禁用的知识库，需编辑课堂取消引用。

### Q: 如何完全离线部署？
A: 本版本采用全量注入，无需下载 Embedding 模型。只需安装 Node.js、配置 AI API Key 即可运行（AI API 本身需要网络连接）。如需完全离线，可在局域网内部署本地大模型服务（如 Ollama），将 AI Base URL 指向本地服务。

---

## 注意事项

- API Key 仅存储在教师本地 SQLite 数据库中，学生端完全不可见
- 项目文件夹可直接复制到其他电脑使用（需安装 Node.js）
- 数据库文件 `prisma/dev.db` 包含所有数据，请定期备份
- 如需图片理解功能，请在系统设置中将 AI 模型切换为支持视觉的模型（推荐：`qwen3.6-plus`、`qwen3.6-flash`、`qwen3.6-35b-a3b`；其他平台可用 `gpt-4o`、`claude-3-5-sonnet` 等多模态模型）
- 建议在正式使用前先在「系统设置」中测试 AI 连接是否正常
- 首次使用建议用 `npm start` 启动（生产模式），而非 `npm run dev`（开发模式），生产模式支持更高并发和更稳定运行
- 知识库采用全量注入模式，课堂引用的知识库总字符数不超过 50,000，确保 AI 能看到完整资料
- 禁用的知识库不会出现在课堂选择列表中，已引用的不受影响

---

### 2026-04-28 - 学情分析架构简化 & 对话活动排序

**学情分析架构简化**：
- 确认学情分析采用**三级结构**（课堂 → 学习活动/课堂作业 → 对话活动/作业），分析只针对课堂整体、各对话活动、各作业，学习活动和课堂作业不进行独立分析
- 课堂管理页面中，展开后的"学习活动"区域旁的"班级分析"按钮已删除（与课堂标题栏的图标分析入口重复，URL 相同）
- 保留课堂卡片标题行右侧的图表图标按钮作为课堂级洞察的唯一入口
- 每个对话活动保留独立的"分析"按钮，跳转到对话活动级洞察（`?pc=${pc.id}`）

**对话活动排序**：
- 编辑对话活动时，每个对话活动卡片新增**上移/下移**按钮，支持调整排列顺序
- 学生端对话活动列表按 `sortOrder` 升序排列，与编辑页顺序一致
- 数据库 `SubProject.sortOrder` 和 `PresetConversation.sortOrder` 字段已存在，API 查询已按 `sortOrder` 升序排列

**编辑区按钮位置调整**：
- "编辑对话活动"按钮移至编辑区底部，与"取消"/"保存"按钮同行，操作更顺手

---

### 2026-05-02 - AI 自动创建课堂 & 数据格式统一

**AI 自动创建课堂**：
教师填写课堂基本信息后，可点击「AI 自动创建」按钮，系统自动设计学习活动、对话活动和课堂作业，直接保存到数据库。

**数据格式统一规范**：
为支持课堂导入/导出功能，所有课堂数据（AI 创建、手动创建、导入、导出）均遵循统一的数据格式规范。

**冲突点修复**：
- `src/lib/prompts/quiz.ts` 新增 `replaceConversationTemplateVars` / `buildConversationGeneratePrompt` / `parseConversationsFromAIResponse`，支持单括号 `{}` 变量格式
- `src/app/api/tasks/route.ts` 扩展支持 `quizActivities` 嵌套创建

**涉及修改的文件**：
- `src/lib/prompts/quiz.ts` - 新增对话模板函数
- `src/app/api/tasks/route.ts` - 支持 quizActivities 写入
- `src/app/api/tasks/auto-generate/route.ts` - **新增**：AI 生成逻辑

---

### 2026-05-01 - 星星评分修复 & 班级分析收展 & 字数限制强化

**星星评分全面修复**：
- 所有分析模式（简易版/标准版/详细版）下，AI 输出末尾均强制要求输出 `评分：★★★★★★★` 星星评分
- 前端 `StarRating` 组件因此能稳定获取 `starCount`，姓名卡片上恢复显示星星

**开场白禁止**：
- 提示词中增加"禁止任何开场白"强约束，杜绝 AI 输出"好的""老师""以下是根据"等废话，直接输出分析报告

**班级分析卡片收展**：
- 对话活动级和课堂级的班级分析结果卡片改为**可收展**形式
- 默认收起，点击标题行展开/折叠，标题旁有 `▶` 箭头指示
- 有分析结果时，标题自动显示为活动/课堂名称 + 版本时间

**字数限制强化**：
- 从弱约束"请控制在 N 字以内"升级为硬性规定：
  - `【硬性规定】整篇分析报告总字数不得超过 N 字` + `超出将被判定为不合格`
- 提示词标记为 `## ⚠️` 并标注`（必须遵守）`，提升 AI 遵从度

**默认字数调整**：
- 标准版个人分析字数上限：300 → **100**
- 标准版班级分析字数上限：1000 → **300**
- 所有代码 + 数据库 + Prisma schema 默认值同步更新（共 10 处代码 + 1 处数据库记录 + 1 处 schema）

**涉及修改的文件**：
- `src/lib/prompts/insight.ts` - 星星评分指令 + 开场白禁止 + 字数限制强化 + 默认值
- `src/app/teacher/tasks/[taskId]/insights/page.tsx` - 班级分析卡片收展 + pc.title 引用修复
- `src/app/api/system-config/route.ts` - 默认值更新
- `src/app/api/tasks/[taskId]/insights/route.ts` - 默认值更新
- `src/app/api/subprojects/[subProjectId]/insights/route.ts` - 默认值更新
- `src/app/api/preset-conversations/[presetConversationId]/insights/route.ts` - 默认值更新
- `src/app/teacher/settings/page.tsx` - 默认值更新（5 处）
- `prisma/schema.prisma` - 数据库默认值更新

**启用/禁用功能**：
- 知识库新增 `enabled` 字段，支持启用/禁用控制
- 禁用的知识库在课堂管理中不可选择，列表中启用的排最前
- 已被课堂引用的知识库禁用后不受影响，仍会注入 AI 上下文
- 知识库卡片显示启用/禁用状态标签，禁用时半透明显示

**全量注入架构变更**：

将知识库检索方式从向量检索（RAG）切换为全量注入模式：

**核心变更**：
- **全量注入**：知识库内容 ≤ 50,000 字符时，整段注入 AI 的 System Prompt，不做检索裁剪
- **零信息丢失**：AI 能看到完整知识库资料，避免检索遗漏导致的回答偏差或幻觉
- **移除 Embedding 设置**：系统设置中移除 Embedding 模型路径配置，不再需要本地模型
- **材料上传优化**：上传材料时不再计算向量，仅做分块存储
- **UI 更名**：应用名称从 QuickChat 更名为 QuickClass（仅 UI 展示）
- **知识库索引**：向量化按钮改为"建立索引"，状态标签从"已向量化/未向量化"改为"已索引/未索引"

**技术决策**：
- 对于 ≤ 50,000 字符的知识库（约 15K tokens），全量注入优于 RAG 检索
- 50 人同时对话，每人每次带 ~8K tokens 知识库，成本可控（DeepSeek ≈ ¥8/50人×20轮）
- BM25 文本检索保留作为备用方案，供未来知识库超大规模时切换

**涉及修改的文件**：
- `src/app/api/chat/route.ts` - 知识库全文注入逻辑
- `src/app/api/knowledge-base/vectorize/route.ts` - 向量化改为索引构建
- `src/app/api/materials/route.ts` - 移除 embedding 计算
- `src/app/api/system-config/route.ts` - 移除 embeddingModelPath
- `src/app/teacher/settings/page.tsx` - 移除 Embedding 模型设置
- `src/lib/embedding.ts` - 移除数据库配置读取
- `prisma/schema.prisma` - 移除 embeddingModelPath 字段
- `src/lib/bm25.ts` - BM25 检索引擎（备用）
- `src/lib/chunker.ts` - 文本分块修复
- `src/app/teacher/knowledge-base/page.tsx` - UI 标签更新
- 多个 UI 文件 - QuickChat → QuickClass 更名

### 2026-04-24 - 分析结果字数限制配置

新增分析详细程度配置功能，教师可根据需求选择分析输出的详细程度：

| 版本 | 个人分析 | 班级分析 | 输出格式 |
|------|----------|----------|----------|
| **简易版** | - | - | 直接输出 6~10 个 ★ 评分 |
| **标准版** | 100 字（可修改） | 300 字（可修改） | 文字描述 |
| **详细版** | 450 字 | 1500 字 | 文字描述 |

**分析结构数字限制说明**：
系统设置中的"分析结构数字限制"对应 `SystemConfig` 模型的 `insightLevel` 字段：
- **`insightLevel`**（分析结构/详细程度）：`SIMPLE`（简易版，★评分）、`STANDARD`（标准版，文字报告）、`DETAILED`（详细版，详细文字报告）
- **`studentWordLimit`**：个人分析字数上限（默认 100）
- **`classWordLimit`**：班级分析字数上限（默认 300）
- **`starCount`**：简易版星的数量（默认 10，范围 6-10）

**涉及修改的文件**：
- `prisma/schema.prisma` - 新增 `insightLevel`、`studentWordLimit`、`classWordLimit`、`starCount` 字段
- `src/app/teacher/settings/page.tsx` - 添加分析详细程度选择 UI
- `src/app/api/system-config/route.ts` - 更新 API 接口支持新字段
- `src/app/api/tasks/[taskId]/insights/route.ts` - 任务级分析添加字数限制
- `src/app/api/subprojects/[subProjectId]/insights/route.ts` - 学习活动分析添加字数限制
- `src/app/api/preset-conversations/[presetConversationId]/insights/route.ts` - 对话活动分析添加字数限制
- `src/app/api/ai-analysis/class-summary/route.ts` - 班级汇总分析添加字数限制

---

## 更新日志

### v2026.07.21 - 学情分析版本切换与升级机制

**新增功能**
- **学情分析版本切换**：对话级/课堂级学生个人学情支持多版本切换查看，教师可对比不同时间的分析结果
- **学情分析删除功能**：支持删除指定版本的历史分析记录，保持数据整洁
- **学生端"全屏查看"**：HTML 学情报告支持全屏查看，提升阅读体验
- **数据型分析模板零依赖**：使用纯 SVG 绘制图表（雷达图、柱状图、饼图等），无需下载外部 JS 库，离线秒开
- **版本管理系统**：
  - VERSION.md 文件记录版本号 + 更新日志
  - `/api/version` 接口返回版本信息
  - 系统设置页面显示当前版本
- **自动升级工具**：
  - macOS/Linux: `upgrade.sh`
  - Windows CMD: `upgrade.bat`
  - Windows PowerShell: `upgrade.ps1`
  - 自动备份 DB → 解压新版本 → 迁移数据 → 替换

**修复问题**
- 课堂级全班学情分析默认不显示历史版本 → 现在正确显示所有版本号
- 对话级学生个人分析无删除按钮 → 已补上
- 雷达图网格层颜色过淡 → 已优化为清晰可见的中灰色（`#94A3B8`）
- 雷达图同心多边形边数不一致 → 已强制几何一致性（顶点数 N = 数据维度数）

**技术改进**
- 后端 API 返回全部历史版本（`task_class`/`task_student`/`pc_student`）
- 前端版本切换时强制重新挂载（`key={ins.id}`），避免 iframe 缓存问题
- 删除操作同步清理多个 state（`taskClassInsightVersions`/`pcStudentInsights`/`taskStudentInsights`）
- 数据型模板新增"图表与渲染规范"段，禁止外部 JS 库，强制纯 SVG 内联绘制

**涉及修改的文件**
- `VERSION.md` - 新增版本说明文件
- `src/app/api/version/route.ts` - 新增版本信息 API
- `src/app/api/tasks/[taskId]/insights/route.ts` - 返回全部历史版本
- `src/app/api/preset-conversations/[presetConversationId]/insights/route.ts` - 返回全部历史版本
- `src/app/student/insights/page.tsx` - 全屏查看按钮
- `src/app/teacher/tasks/[taskId]/insights/page.tsx` - 学生学情版本切换 + 删除按钮
- `src/app/teacher/settings/page.tsx` - 显示版本号
- `模板/**/*.md` - 6 个数据型模板加 SVG 规范
- `upgrade.sh` / `upgrade.bat` / `upgrade.ps1` - 跨平台升级脚本
- `pack-and-dist.sh` - 打包时包含版本文件和升级脚本
- `安装指南.md` - 加升级说明
- `README.md` - 加版本管理章节

---

### 2026-07-05 - 教学研究功能（教研宝）

**功能说明**：
在教师端新增"教学研究"模块，基于教师真实教学数据，AI 自动生成研究课题方案和学术论文初稿。

**工作流程**：
1. 教师在左侧菜单点击"教学研究"，进入项目列表
2. 新建项目：填写名称、选择类型（论文/课题）、输入关键字
3. AI 基于所有启用课堂数据生成 10 个研究题目（含推荐分数、数据证据）
4. 教师选择一个题目，AI 流式生成完整初稿
5. 下载 Word 文档，自行修订后提交

**技术实现**：
- `src/lib/research/data-collector.ts` - 多源数据聚合（课堂/探究/作业/对话）
- `src/lib/research/topic-detector.ts` - AI 驱动的题目生成器
- `src/lib/research/document-generator.ts` - 初稿生成器（论文/课题两种模式，流式输出）
- `src/lib/research/docx-generator.ts` - Word 文档生成器
- `src/app/api/research/projects/` - 6 个 API 端点（CRUD + 生成 + 下载）
- `src/app/teacher/research/` - 3 个页面（列表/新建/详情）
- 数据库：新增 `ResearchProject` 表

### 2026-07-04 - AI 伴学功能

**功能说明**：
教师启用后，学生在互动探究页面看到浮动 AI 伴学对话框，可随时提问获取指导。AI 会预先分析 HTML 生成语义提示词，结合学生当前操作状态给出上下文感知的指导。

**工作流程**：
1. 教师在互动探究编辑中开启"AI 伴学"开关
2. AI 完整阅读探究 HTML，生成伴学语义提示词（教师可编辑）
3. 学生进入探究 → 右下角 🤖 按钮 → 展开对话框 → 提问
4. AI 流式回复，结合页面上下文（滚动位置、标题、得分等）精准指导
5. 对话自动保存，下次进入自动加载

**技术实现**：
- `src/lib/prompts/ai-companion.ts` - CSS/HTML/JS 注入模板 + 提示词生成
- `src/app/api/exploration-activities/[id]/ai-chat/` - 流式对话 + 历史记录 API
- `src/app/student/chat/ExplorationPanel.tsx` - 父窗口监听 iframe 消息 + 流式转发
- 数据库：新增 `enableAiCompanion`、`aiCompanionPrompt` 字段 + `AiCompanionMessage` 表

### 2026-05-10 - 互动探究自动评分功能

**功能说明**：
教师启用互动探究的"提交功能"时，AI 会自动分析 HTML 内容，识别题目和正确答案，然后注入自动评分脚本。学生操作时系统自动判断对错并计算分数。

**工作流程**：
1. 教师点击"启用提交"开关
2. 系统调用 AI 分析 HTML，识别交互元素和题目
3. AI 返回识别到的题目列表（含类型、分值、正确答案）
4. 预览弹窗显示识别结果（选择题、填空题、拖拽题等）
5. 教师确认后，系统自动注入追踪 + 评分脚本
6. 学生操作时自动判题、自动算分

**支持的题型**：

| 类型 | AI 识别 | 自动判断 |
|------|---------|---------|
| 选择题（radio/select） | ✅ 选项和答案 | ✅ 选对加分 |
| 填空题（input/text） | ✅ 输入框 | ✅ 文本匹配 |
| 拖拽题（drag） | ✅ 拖拽目标 | ✅ 拖对加分 |

**技术实现**：
- `src/lib/prompts/exploration-submit.ts`：
  - `aiPreviewPrompt` - 新版提示词，让 AI 识别题目结构和答案
  - `generateAutoScoringScript` - 根据 AI 分析结果生成自动评分脚本
- `src/app/api/exploration-activities/preview-injection/route.ts` - 返回 autoScoreScript
- `src/app/teacher/tasks/page.tsx` - 预览弹窗显示题目，确认后注入评分脚本

---

### 2026-05-09 - 课堂导入/导出格式统一

**导出 JSON 格式**：
```json
{
  "version": "1.0",
  "exportedAt": "2026-05-09T16:01:42.806Z",
  "_filename": "教师姓名_年级_学科_课题_日期.json",
  "task": {
    "title": "...",
    "description": "...",
    "grade": "...",
    "subject": "...",
    "objectives": "...",
    "requirements": "...",
    "knowledgeBase": "",
    "analysisPrompt": "...",
    "classAnalysisPrompt": "...",
    "subProjects": [{
      "title": "默认活动",
      "presetConversations": [...],
      "quizActivities": [...],
      "explorations": [{
        "title": "...",
        "description": "...",
        "designPrompt": "...",
        "analysisPrompt": "..."
      }]
    }]
  }
}
```

**涉及修改的文件**：
- `src/app/api/tasks/[taskId]/export/route.ts` - 新文件名格式、explorations 含 designPrompt
- `src/app/api/tasks/import/route.ts` - 子项目必填字段、explorations 支持 designPrompt
- `prisma/schema.prisma` - ExplorationActivity 新增 designPrompt 字段
- `src/app/api/exploration-activities/route.ts` - 创建时支持 designPrompt
- `src/app/api/exploration-activities/[id]/route.ts` - 更新时支持 designPrompt

---

### 2026-05-07 - 多模态图片理解功能修复

**问题**：学生端发送图片后，AI 回复显示"正在思考中"后消失，无法正常对话。

**根本原因**：前端发送的图片格式为 OpenAI 的 `{ type: "image_url", image_url: { url: "data:..." } }`，但 Vercel AI SDK v6 核心消息格式不支持 `image_url` 类型（只支持 `type: "image"` 和 `type: "file"`）。之前的 `type: "file"` 转换方案在 SDK 内部 URL 下载链路中导致数据损坏，改为 `type: "image"`（AI SDK v6 原生格式）后正常工作。

**修复方案**：
- `src/app/api/chat/route.ts`：将前端 `image_url` 格式转换为 AI SDK v6 原生的 `{ type: "image", image: base64Data, mediaType }` 格式
- 添加空响应检测和错误信息透传：API 报错时错误信息直接显示在对话气泡中，而非一闪而过
- 500 错误响应改为 JSON 格式（`{ error: errMsg }`），前端能正确解析并显示真实错误

**图片理解模型要求**：
- 需选择支持视觉/多模态的 AI 模型，如阿里云百炼的 `qwen3.6-plus`、`qwen3.6-flash`、`qwen3.6-35b-a3b`
- 纯文本模型（如 `qwen-turbo`）不支持图片输入
- 更换模型后**无需重启项目**，配置即时生效（每次对话都从数据库读取最新配置）

**涉及修改的文件**：
- `src/app/api/chat/route.ts` - 图片格式转换 + 空响应检测 + 错误处理改进

---

### 2026-05-06 - 对话活动排序按钮代码优化

**对话活动排序按钮代码优化**：
- 移除 `onClick` 中不必要的 `async/await`
- 将 `subProject` 查找逻辑从内联改为先存变量再判断，避免重复查找和 `as string | undefined` 类型断言
- 增加 `_sp` 和 `_sp.id` 双重空值检查，确保类型安全

**涉及修改的文件**：
- `src/app/teacher/tasks/page.tsx` - 两处 `handleConversationReorder` 调用优化

---

### 2026-04-24 - 对话记录管理与模板设置功能

#### 对话记录管理增强
- **班级筛选**：可按班级筛选对话记录
- **删除单个对话**：点击每条对话右侧的删除图标
- **批量选择删除**：点击"选择删除"按钮进入选择模式，勾选后批量删除
- **清空班级对话**：选择特定班级后，点击"清空 [班级名]"一键删除该班级所有对话

#### 分析模板功能
- **统一命名**：所有层级的模板设置按钮统一显示为"设置分析模板"
- **模板保存实时刷新**：保存模板后自动更新页面显示，无需手动刷新
- **模板设置页面**：新增左侧菜单「模板设置」，支持：
  - **学生个人学情模板**：可创建多个模板，设置默认模板
  - **学生全班学情模板**：可创建多个模板，设置默认模板
  - 分析时自动使用默认模板，也可在分析页面手动选择其他模板

#### 模板导入/导出

模板支持导入/导出为 `.md` 文件，方便教师在不同电脑间同步模板：

**导出逻辑**：
- 每个模板右侧的绿色下载图标可导出当前模板
- 导出为 `.md` 文件：**第一行为模板名称**，**第二行起为模板内容**
- 自动下载到本地

**导入逻辑**：
- 展开模板类别后，点击「导入」按钮（位于「新建」旁）
- 选择 `.md` 文件（仅允许 `.md` 格式）
- 读取文件：第一行作为模板名称，后续行作为模板内容
- 导入的模板默认**不设为默认模板**
- 调用 API 写入数据库，成功后自动刷新列表

#### 模板变量说明

创建学生个人学情模板时，支持在提示中使用以下变量占位符：

| 变量 | 说明 | 替换方式 | 状态 |
|------|------|---------|------|
| `${学生姓名}` | 当前分析的学生姓名 | 由 AI 根据 Prompt 上下文自动推断 | **隐式替换** |
| `${对话内容}` | 学生的对话记录全文 | 由 AI 根据提供的对话数据推断 | **隐式替换** |
| `${对话主题}` | 当前对话活动的主题标题 | 由 AI 从上下文推断 | **隐式替换** |
| `${任务标题}` | 当前课堂的标题 | 由 AI 从上下文推断 | **隐式替换** |
| `${学生人数}` | 全班学生总数 | 由 AI 从数据中推断 | **隐式替换** |

> **当前机制**：这些变量目前由 AI 模型根据 Prompt 中的上下文数据（学生信息、对话记录、课堂数据等）**隐式推断替换**，无需代码层面的字符串替换。AI 模型（如 DeepSeek、GPT 等）的语义理解能力可以很好地从上下文中自动映射这些变量。

> **⚠️ 将来改进计划**：如果模板中包含复杂的逻辑依赖，隐式替换可能不够可靠。建议在 `src/app/api/preset-conversations/[presetConversationId]/insights/route.ts`（学生个人分析）等相关 API 中增加**显式字符串替换**逻辑，将 `${变量名}` 替换为实际数据后再拼接 Prompt。示例代码：
> ```typescript
> let content = templateContent || "";
> content = content
>   .replace(/\$\{学生姓名\}/g, student?.name || "")
>   .replace(/\$\{对话内容\}/g, conversations.map(c => c.messages.map(m => m.content).join("\n")).join("\n"))
>   .replace(/\$\{对话主题\}/g, task.subProjects[0]?.presetConversations[0]?.title || "")
>   .replace(/\$\{任务标题\}/g, task.title)
>   .replace(/\$\{学生人数\}/g, String(students?.length || ""));
> ```
> 应用此替换的位置在模板内容被拼接到 AI Prompt 之前（约在 `insights/route.ts` 中 `const templateSection = templateContent ? ...` 附近）。

**涉及修改的文件**：
- `src/app/api/conversations/[id]/route.ts` - 删除单个对话 API
- `src/app/api/conversations/teacher/route.ts` - 批量删除 API
- `src/app/api/conversations/teacher/class/[classId]/route.ts` - 清空班级对话 API
- `src/app/teacher/conversations/page.tsx` - 对话记录页面增加删除功能
- `src/app/teacher/tasks/[taskId]/insights/page.tsx` - 修复模板按钮名称，保存后实时刷新
- `src/app/teacher/templates/page.tsx` - 新增模板设置页面

---

### 2026-05-03 - AI 并发限制配置化与配置导入导出增强

**功能说明**：
- 将 AI 请求并发数从硬编码改为可配置，教师可在系统设置中自行调节
- 默认并发数设为 20，适合大多数班级规模，避免触发 API 限流
- **配置导入导出增强**：备份/导入配置文件现包含推理模式（`reasoningEnabled`）和并发限制（`aiMaxConcurrent`）

**技术实现**：
- `prisma/schema.prisma`：SystemConfig 模型新增 `aiMaxConcurrent` 字段（默认 20）
- `src/lib/ai-queue.ts`：从数据库读取并发配置，支持运行时重载
- `src/app/api/system-config/route.ts`：GET/PUT 接口支持 aiMaxConcurrent 字段
- `src/app/api/system-config/reload-queue/route.ts`：新增重载队列配置 API
- `src/app/teacher/settings/page.tsx`：
  - 系统设置页面新增并发数配置项
  - **备份配置**：导出 JSON 包含 `aiMaxConcurrent` 和 `reasoningEnabled`
  - **导入配置**：导入时自动应用并发配置，并调用重载 API

**配置文件格式示例**：
```json
{
  "aiBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "aiApiKey": "sk-xxx...",
  "aiModel": "qwen-turbo",
  "aiMaxConcurrent": 20,
  "reasoningEnabled": true
}
```

**使用说明**：
- 教师在系统设置中可调整 AI 并发限制（1-200）
- **建议值**：小班课(≤30人)设 10-20，中班课(30-60人)设 20-40，大班课(60+人)设 40-100
- 修改后立即生效，无需重启服务
- **备份配置**：导出文件默认命名为 `模型名称-日期.json`（如 `qwen-turbo-2026-05-03.json`）
- **导入配置**：支持导入旧格式配置文件，缺少新字段时使用默认值

**涉及修改的文件**：
- `prisma/schema.prisma` - 数据库 schema 新增字段
- `src/lib/ai-queue.ts` - 并发控制逻辑
- `src/app/api/system-config/route.ts` - 配置 API
- `src/app/api/system-config/reload-queue/route.ts` - 新增重载 API
- `src/app/teacher/settings/page.tsx` - UI 配置项 + 导入导出增强

---

### 2026-05-03 - 班级学情功能暂时搁置

**功能变更**：
- 班级详情页面中的「班级学情」标签页已移除
- 该功能涉及班级级别的 AI 学情洞察、统计数据展示等
- 课堂级学情分析功能保留不变（通过课堂管理页面访问）

**原因说明**：
- 班级学情功能与课堂级学情分析存在部分功能重复
- 暂时搁置以简化教师端操作流程,专注于课堂级分析

**涉及修改的文件**：
- `src/app/teacher/classes/[classId]/page.tsx` - 移除「班级学情」Tab 及相关代码
- `README.md` - 更新功能说明,标注该功能已暂时搁置

---

### 2026-05-04 - 对话记录三维筛选 & 学情洞察入口删除

**对话记录三维筛选增强**：
- 新增**课堂（任务）**筛选维度，实现班级 → 课堂 → 对话活动的三级联动筛选
- 任意一维、二维、三维组合均可正常工作
- 支持姓名搜索 + 筛选器组合，搜索结果正确分页
- API 层：`/api/conversations/teacher` 新增 `taskId` 参数，通过 `PresetConversation → SubProject → taskId` 关联链实现筛选
- 修复 `fetchConversations` useCallback 闭包陈旧值问题：筛选切换后立即生效

**学情洞察菜单入口删除**：
- 教师端左侧菜单「学情洞察」入口已移除（`TeacherLayout.tsx`）
- 课堂级学情分析功能保留，通过「课堂管理」页面的图标按钮访问
- 代码文件、数据结构（`AIInsight` 模型、insights API）均保留，待功能逻辑重新设计后可复用

**涉及修改的文件**：
- `src/app/api/conversations/teacher/route.ts` - 新增 taskId 筛选参数
- `src/app/teacher/conversations/page.tsx` - 三维筛选器 + 分页 + 姓名搜索
- `src/components/layout/TeacherLayout.tsx` - 删除「学情洞察」菜单项

---

### 2026-05-03 - 作业列表新增「查看分析」和「重新分析」按钮

**功能说明**：

在作业列表的每个作业卡片上，将原有的单一「分析」按钮拆分为两个独立按钮：

- **「查看分析」**：点击直接打开分析弹窗，查看已生成的作业分析报告
- **「重新分析」**：点击先打开弹窗加载数据，然后自动触发 AI 使用当前选中的分析模板重新生成分析报告

**实现细节**：

- 新增 `reanalyzingQuizId` 状态变量，控制「重新分析」按钮的 loading 状态，避免重复点击
- `handleReanalyzeQuiz` 函数：先调用 `openQuizAnalysis(q.id)` 打开弹窗并加载数据，再调用 `/api/quiz-activities/${quizId}/report/generate` 接口触发 AI 重新分析
- 分析时使用当前选中的分析模板（`selectedQuizAnalysisTemplateId`）

**涉及修改的文件**：
- `src/app/teacher/tasks/page.tsx` - 新增状态变量、新增 `handleReanalyzeQuiz` 函数、按钮 UI 调整

---

---

## 后续工作清单

> 每项任务标记 `[ ]` 为待完成，`[x]` 为已完成。新增任务时按优先级插入对应位置。

---

### 待开发功能

- [ ] **教师端「教研论文」功能**
  - **位置**：暂无对应页面/API（需新建模块）
  - **问题**：教师只能分析单班级数据，缺少跨班级综合分析工具；教学实践中的发现无法沉淀为可分享的学术成果。
  - **方案**：新建独立模块，支持「选择多个课堂 → AI 生成学术论文 → 导出 Word」完整流程。
  - **谁操作**：开发者（新建功能）
  - **操作步骤**：
    1. 数据库新增 `ResearchPaper` 表（字段：`title`、`topic`、`templateId`、`classIdsJson`、`dataScopeJson`、`content`、`wordCount`、`status`（DRAFT/GENERATED/EXPORTED）、`version`、`createdAt`、`updatedAt`），并在 `AnalysisTemplate` 表新增 `RESEARCH_PAPER` 类型用于论文模板管理。
    2. 安装依赖：`npm i docx file-saver`、`npm i -D @types/file-saver`。
    3. 新增 API 路由（4 个）：
       - `/api/research/generate`（POST）— 接收 `classIds`、`topic`、`templateId`、`wordLimit`，汇总多班数据（对话、作业、能力评估、探究提交）→ 调 AI 生成论文 → 返回 Markdown 内容 → 存入数据库。
       - `/api/research/papers`（GET）— 列出当前教师的历史论文。
       - `/api/research/papers/[id]`（GET/PUT/DELETE）— 单篇 CRUD。
       - `/api/research/templates`（GET）— 获取论文模板列表（含 3 种内置模板）。
    4. 新增教师端页面 `src/app/teacher/research/page.tsx`：
       - 顶部表单：论文标题、研究主题、字数要求
       - 班级多选区（支持搜索、全选、反选、按学科筛选，并显示每个班级的人数和对话数）
       - 提示词模板下拉选择（默认 + 自定义）
       - 数据范围筛选（起止日期）
       - 「生成论文」按钮 + 加载状态
       - 论文预览区（`ReactMarkdown` 渲染，支持重新生成）
       - 「导出 Word」按钮（生成后才显示）
       - 历史论文列表（可查看、删除）
    5. 新增 Word 导出工具 `src/lib/export-paper-docx.ts`：
       - 标题：黑体小二号、居中
       - 一级标题：黑体三号
       - 二级标题：黑体小三号
       - 正文：宋体小四、1.5 倍行距、首行缩进 2 字符
       - 页眉：论文标题（缩写）；页脚：页码居中
       - 文件名：`论文_{标题}_{日期}.docx`
       - Markdown → docx 段落转换（支持标题、正文、列表、引用、表格）
    6. 教师菜单新增入口：在 `src/components/layout/TeacherLayout.tsx` 的 `menuItems` 中新增一项：
       ```
       { key: "/teacher/research", icon: <Icon.DocumentIcon />, label: "教研论文" }
       ```
  - **数据汇总策略**（API 内部实现）：
    - 按班级聚合：每个班级输出对话样本（前 30 条学生提问）、作业正确率、高频错题、能力评估多维度均分、探究提交率
    - 控制总输入 ≤ 50K 字符（超出则按比例采样）
    - 用 `aiQueue.enqueue` 防止并发冲突
  - **默认论文提示词模板**（3 种内置，存于 `seed-full.ts`）：
    1. **教学反思型**：「教师视角」总结某主题/某班级群的教学实践经验
    2. **对比研究型**：「研究视角」对比多个班级在某能力维度上的差异
    3. **案例分析型**：「案例视角」聚焦某具体课堂做深度剖析
  - **什么界面**：教师端新增页面（侧边栏菜单「教研论文」），无学生端界面。
  - **不修改的后果示例**：教师经过一学期多班级教学实践，积累了大量有价值的跨班级对比数据（如「三年级 vs 四年级对「方程的解」概念的掌握差异」），但当前系统只能在每个班级单独查看学情报告，无法综合分析形成学术成果。AI 对话中虽能产生大量洞察，但都散落在各班级的报告里，无法沉淀为可发表、可分享的论文。教师想做教研论文或教学分享时，只能手动整理数据、手写论文，效率极低。

- [ ] **模板变量显式替换**
  - **位置**：多个 `insights/route.ts`（preset-conversations、subprojects、tasks 等）
  - **问题**：README 已记录改进计划，但尚未实现。当前 `${学生姓名}` `${对话内容}` 等变量由 AI 隐式推断，可靠性不足。
  - **方案**：在 Prompt 拼接前增加显式 `replace()` 字符串替换，在 `const templateSection = templateContent ? ...` 附近实现。
  - **谁操作**：开发者（修改 API 代码）
  - **操作步骤**：
    1. 打开 `src/app/api/preset-conversations/[presetConversationId]/insights/route.ts`
    2. 找到 `const templateSection = templateContent ? ...` 附近代码
    3. 在模板内容拼入 Prompt 前，插入 `replace()` 字符串替换：`content.replace(/\${学生姓名}/g, student?.name || "")` 等
    4. 将相同逻辑复用到 `subprojects/[subProjectId]/insights/route.ts` 和 `tasks/[taskId]/insights/route.ts`
  - **什么界面**：不涉及 UI，仅修改 API 逻辑
  - **不修改的后果示例**：教师创建模板时使用 `${学生姓名}` 占位符，AI 可能将不同学生的分析内容张冠李戴，导致学情报告不准确。例如 A 学生的报告中出现"张三同学"应替换为"A 同学"的字样。

- [ ] **教师端「能力评估报告发布」**
  - **位置**：暂无对应页面/API
  - **问题**：`/api/progress` 返回 `evaluations` 数据，但教师端没有发布评估的界面，学生端 `evaluation/page.tsx` 仅读取数据，无内容生成逻辑。
  - **谁操作**：教师（通过教师端 UI 操作）
  - **操作步骤**：
    1. 在教师端新增「发布评估报告」页面（建议位于「学情洞察」附近）
    2. 教师选择班级、学生，输入或用 AI 生成评估内容
    3. 调用 API 将评估结果写入数据库
    4. 学生端「能力评估报告」页面展示教师发布的报告
  - **什么界面**：教师端新增页面（路径 `src/app/teacher/evaluations/`），学生端复用现有 `src/app/student/evaluation/page.tsx`
  - **不修改的后果示例**：教师想给某个学生发布个性化能力评估，却无从下手——教师端没有输入评估内容的入口，`/api/progress` 返回的 `evaluations` 永远为空，学生登录后也看不到任何评估报告。

- [ ] **教师端「活动管理页面」**
  - **位置**：`src/app/teacher/activities/page.tsx`（路由空缺）
  - **问题**：教师菜单有「活动」入口但无对应页面，访问时报 404。
  - **谁操作**：教师（通过教师端 UI 操作）
  - **操作步骤**：
    1. 新建 `src/app/teacher/activities/page.tsx`
    2. 设计页面：展示所有学习活动（可按课堂筛选）、支持新增/编辑/删除活动
    3. 实现对应的 API 路由（create、update、delete）
    4. 将教师菜单「活动」指向该页面
  - **什么界面**：教师端页面（顶部导航栏「活动」菜单）
  - **不修改的后果示例**：教师点击顶部菜单「活动」，页面直接报 404 错误，导致教师以为系统损坏。实际上该入口存在但对应页面未实现，属于功能残缺。

---

### 待优化功能

- [ ] **学生端「查看分析」按钮缺失**
  - **位置**：`src/app/student/insights/page.tsx`
  - **问题**：学生只能看最新版本 + 与上次对比，无法主动选择查看其他版本的分析记录。
  - **谁操作**：学生（通过学生端 UI 操作）
  - **操作步骤**：
    1. 在 `src/app/student/insights/page.tsx` 的分析结果展示区增加版本下拉选择器
    2. 学生选择某一历史版本后，加载该版本的分析内容展示
    3. 保留现有「与上次对比」逻辑作为默认选项
  - **什么界面**：学生端 `src/app/student/insights/page.tsx`
  - **不修改的后果示例**：教师重新生成了某次作业的分析报告（覆盖了旧版），但学生想回看旧版分析了解自己的进步轨迹，旧版数据明明存在却无法查看，只能看到最新版，造成历史分析数据「不可访问」。

- [x] **学情分析 Prompt 构建重复代码** ✅ **已完成（2026-05-03）**
  - 已实现：`src/lib/prompts/insight.ts` 包含 `buildTaskClassPrompt`、`buildTaskStudentPrompt`、`buildPCClassPrompt`、`buildPCStudentPrompt` 四个函数，实现 Prompt 构建逻辑集中管理
  - 涉及修改：`src/lib/prompts/insight.ts`（新建），`src/app/api/tasks/[taskId]/insights/route.ts`（调用），`src/app/api/preset-conversations/[presetConversationId]/insights/route.ts`（调用）

- [x] **提示词预览 Dialog 重复实现** ✅ **已完成（2026-05-03）**
  - 已实现：`src/components/prompt-preview/` 组件
    - `usePromptPreview.ts` - Hook，管理预览状态和 `withPromptPreview` 方法
    - `PromptPreviewDialog.tsx` - 对话框组件，支持自定义 `renderContent` 渲染函数
    - `index.ts` - 导出入口
  - 涉及修改：`teacher/insights/page.tsx`、`teacher/dashboard/page.tsx`、`teacher/tasks/[taskId]/insights/page.tsx` 均已接入
  - 剩余：原 `subprojects/[subProjectId]/insights/route.ts` API 已删除（架构确认 SubProject 不需要分析）

- [x] **AI 并发限制硬编码** ✅ **已完成（2026-05-03）**
  - ~~**位置**：`src/lib/ai-queue.ts` - `MAX_CONCURRENT = 5`~~
  - ~~**问题**：生产环境固定 5 并发，无动态调节能力。~~
  - **已实现**：教师可在系统设置中配置并发数（默认 20），立即生效

- [ ] **学生端对话页面 Message 组件兼容性**
  - **位置**：`src/app/student/chat/page.tsx`
  - **问题**：使用 `Message`（来自 tdesign-react）但学生端未引入布局，可能导致渲染错误。
  - **谁操作**：开发者（修复 bug）
  - **操作步骤**：
    1. 在 `src/app/student/chat/page.tsx` 中检查 `Message` 组件的 import 来源
    2. 确认学生端是否正确引入了 TDesign 的样式（检查 `layout.tsx` 或全局样式）
    3. 如未引入，在 `layout.tsx` 中添加 TDesign 的 CSS import，或将 `Message` 替换为通用 div 实现
  - **什么界面**：`src/app/student/chat/page.tsx` 学生与 AI 对话页面
  - **不修改的后果示例**：学生进入对话页面，聊天消息区域显示异常（样式丢失或组件报错），无法正常进行对话学习。

- [ ] **错误处理和 Loading 状态不完整**
  - **位置**：多处
  - **问题**：部分 API 错误只 `console.error`，无用户友好提示；部分页面无 loading skeleton/骨架屏。
  - **谁操作**：开发者（完善错误处理）
  - **操作步骤**：
    1. 梳理所有 API route，将 `console.error` 替换为返回结构化错误 JSON（包含错误码和用户可读消息）
    2. 在前端页面增加全局错误提示组件（如 TDesign `Message.error()`）
    3. 在数据加载阶段增加 loading skeleton（如 TDesign `Skeleton` 组件）
    4. 重点检查：学情分析页面、作业列表页面、学生端各页面
  - **什么界面**：所有涉及异步数据加载的页面
  - **不修改的后果示例**：网络波动导致分析请求失败，学生看到的是空白页面，没有任何提示，不知道是加载中还是出错了，只能反复刷新页面。

- [x] **数据库 Schema 注释陈旧** ✅ **已完成（2026-05-03）**
  - ~~**位置**：`prisma/schema.prisma`~~
  - ~~**问题**：部分注释仍提及 "QuickChat"，与当前 QuickClass 品牌不一致。~~
  - **已完成**：
    - 确认无 "QuickChat" 遗留字样
    - 添加项目顶部说明注释
    - 添加各模块分组注释（用户与班级、系统配置、学习材料、对话消息、练习评估、学习任务等）
    - 提升 Schema 文件可读性

---

## 管理平台对接方案

> QuickClass 支持对接独立的管理平台，实现教师用户信息的集中管理和多设备同步。

### 一、系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    管理平台（独立部署）                      │
│         URL: https://manage.quickclass.com               │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  教师用户表 (Teacher)                                │ │
│  │  - id, email, password(哈希), name,                │ │
│  │    gender, phone, school, createdAt                 │ │
│  └─────────────────────────────────────────────────────┘ │
│                           │                               │
│              REST API: /api/teachers/*                   │
└─────────────────────────────────────────────────────────┘
                           ↕ HTTPS 请求
┌─────────────────────────────────────────────────────────┐
│                 本地 QuickClass（教师电脑）                  │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  SystemConfig                                        │ │
│  │  - managementPlatformUrl  (管理平台地址)              │ │
│  │  - managementApiKey        (API 密钥)                │ │
│  │  - syncToken               (同步令牌)                │ │
│  └─────────────────────────────────────────────────────┘ │
│                           │                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  User 表（教师）                                    │ │
│  │  - id, email, password, name,                        │ │
│  │    gender, phone, school                            │ │
│  │  + managementId  (关联管理平台的教师ID)              │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 二、API 接口设计

#### 管理平台提供（远程）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/teachers/login` | 教师登录，返回 token + 用户信息 |
| POST | `/api/teachers/register` | 教师注册 |
| GET | `/api/teachers/:id` | 获取教师信息 |
| PUT | `/api/teachers/:id` | 更新教师信息 |
| GET | `/api/teachers/check` | 检查邮箱是否已注册 |

#### 本地 QuickClass 提供（供管理平台回调，可选）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sync/teacher-webhook` | 管理平台推送教师信息变更 |

### 三、登录流程

```
教师打开 QuickClass
        ↓
┌───────────────────────────┐
│  检测本地 User 表          │
│  WHERE role = 'TEACHER'  │
└───────────────────────────┘
        ↓
   有教师？
    ↙    ↘
   是     否
    ↓       ↓
  本地    ┌─────────────────────────────┐
  登录     │  1. 提示"请登录管理平台"      │
  ↓       │  2. 打开 managementPlatformUrl │
          │  3. 教师在管理平台登录/注册    │
          │  4. 管理平台返回:              │
          │     - userId, email, name,     │
          │       gender, phone, school   │
          │     - syncToken               │
          │  5. 写入本地数据库             │
          │  6. 提示"本地已配置完成，请重新登录"│
          │  7. 跳转到登录页               │
          └─────────────────────────────┘
```

### 四、数据同步策略

#### 1. 本地更新用户信息时

```
教师在本地更新信息
        ↓
┌───────────────────────────────┐
│  PUT /api/auth/teacher/profile │
│  (本地保存)                    │
└───────────────────────────────┘
        ↓
   有 syncToken？
    ↙       ↘
   是       否
    ↓       ↓
  同步到   结束
  管理平台
  PUT /api/teachers/:id
```

#### 2. 冲突处理

- **本地优先**：本地操作立即完成，失败时记录到同步队列
- **重试机制**：同步失败时，标记 `syncPending = true`，下次成功时重试
- **管理平台为准**：首次同步时以管理平台数据为准

### 五、数据库变更

#### 本地 User 表新增字段

```prisma
model User {
  // ... 现有字段 ...

  // 管理平台关联
  managementId   String?   // 管理平台的教师 ID
  syncToken      String?   // 同步令牌
  syncPending    Boolean   @default(false)  // 待同步标记
  lastSyncedAt   DateTime? // 上次同步时间
}
```

#### 新增 SystemConfig 字段

```prisma
model SystemConfig {
  // ... 现有字段 ...

  managementPlatformUrl String?  // 管理平台地址
  managementApiKey     String?  // API 密钥
}
```

### 六、实现步骤

#### Phase 1: 管理平台（独立项目）

1. **创建管理平台项目**
   ```
   manage-platform/
   ├── api/
   │   └── teachers/
   │       ├── route.ts          # GET list, POST register
   │       └── [id]/route.ts     # GET, PUT
   ├── prisma/
   │   └── schema.prisma          # Teacher 模型
   └── .env
       DATABASE_URL=file:./dev.db
       JWT_SECRET=xxx
   ```

2. **实现 API**
   - `POST /api/teachers/register` - 注册
   - `POST /api/teachers/login` - 登录（返回 JWT）
   - `PUT /api/teachers/:id` - 更新（需认证）
   - `GET /api/teachers/check?email=xxx` - 检查邮箱

#### Phase 2: 本地 QuickClass 改造

1. **数据库变更**
   ```bash
   npx prisma migrate dev --name add_management_fields
   ```

2. **新增 API 路由**
   ```
   src/app/api/management/
   ├── connect/route.ts     # 连接管理平台（首次配置）
   ├── sync/route.ts        # 同步用户信息
   └── callback/route.ts    # 管理平台回调（可选）
   ```

3. **修改登录逻辑**
   - 检测无本地教师 → 跳转管理平台
   - 管理平台登录后回调 → 写入本地

4. **修改用户信息更新逻辑**
   - 本地更新成功后，同步到管理平台

### 七、关键代码伪代码

#### 首次连接管理平台

```typescript
// src/app/api/management/connect/route.ts

export async function POST(req: Request) {
  const { email, password, managementUrl } = await req.json();

  // 1. 保存管理平台配置
  await prisma.systemConfig.update({
    data: {
      managementPlatformUrl: managementUrl,
      syncPending: true,
    }
  });

  // 2. 请求管理平台登录
  const remoteRes = await fetch(`${managementUrl}/api/teachers/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!remoteRes.ok) {
    return Response.json({ error: '管理平台登录失败' }, { status: 401 });
  }

  const { token, teacher } = await remoteRes.json();

  // 3. 写入本地数据库
  await prisma.user.create({
    data: {
      email: teacher.email,
      name: teacher.name,
      gender: teacher.gender,
      phone: teacher.phone,
      school: teacher.school,
      password: 'MANAGEMENT_SYNC', // 本地不存真实密码
      role: 'TEACHER',
      managementId: teacher.id,
      syncToken: token,
    }
  });

  // 4. 更新 syncToken
  await prisma.systemConfig.update({
    data: { syncPending: false }
  });

  return Response.json({ success: true });
}
```

#### 登录流程改造

```typescript
// src/app/login/page.tsx

const handleLogin = async () => {
  // 1. 先检查本地是否有教师
  const localTeachers = await prisma.user.findFirst({
    where: { role: 'TEACHER' }
  });

  if (!localTeachers) {
    // 无本地教师 → 跳转到管理平台
    router.push('/management-connect');
    return;
  }

  // 2. 有本地教师 → 本地登录
  // ... 现有登录逻辑 ...
};
```

---

## License

MIT
