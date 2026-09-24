# AGENTS.md — 本项目的 AI 协作准则

> 📐 CONTRACT · **本文件是本仓库唯一的「协作规范事实来源」（Single Source of Truth）。**
> 不论你用的是 CodeBuddy / Trae / Cursor / GitHub Copilot / Codex / Windsurf / Zed / Cline / Gemini CLI / 其它任何 AI 编程助手，
> **开工前请完整读完本文件**。各工具的专属规则目录（`.trae/rules/`、`.codebuddy/rules/` 等）
> 只放**指向本文件的薄指针**，不放正文 —— 见 §0 与 §7。

---

## 0. 先让本文件在你的工具里生效（Bootstrap，一分钟）

本文件采用行业通用的 `AGENTS.md` 约定（20+ 工具原生支持），但**少数工具的桌面版默认不读**，需要开一次开关。请按下表自查：

| 你的工具 | 是否需要操作 | 怎么做 |
|---|---|---|
| **Trae（桌面版）** | ⚠️ 需要，**开一次开关即可** | 设置 → 规则 → 导入设置 → 打开「**将 AGENTS.md 包含在上下文中**」 |
| **Trae（CLI）** | ✅ 不需要 | 默认读取当前/上级目录的 `AGENTS.md` |
| Cursor / GitHub Copilot / Codex / Windsurf / Zed / RooCode / Cline / Augment / Jules / Gemini CLI / Amp / goose / opencode / Kilo Code / Warp 等 | ✅ 不需要 | 原生自动读取项目根的 `AGENTS.md` |
| **Claude Code** | ⚠️ 需要 | 它只读 `CLAUDE.md`（不读 AGENTS.md）；请在项目根建一个 2 行的 `CLAUDE.md`，内容写成 `@AGENTS.md` 即可（会自动展开引入本文件） |
| Aider | ⚠️ 需要 | 在 `.aider.conf.yml` 加 `read: AGENTS.md` |
| CodeBuddy | ✅ 不需要 | 读 `.codebuddy/rules/*.mdc`（本项目已备薄指针） |

> 🧪 MEASURED：以上“是否需要操作”依据官方文档（agents.md 兼容矩阵；Trae 官方 docs.trae.cn `ide_rules` / `cli_memories`）。
> 若你的工具不在表内：**请自行判断能否读到 `AGENTS.md`**，读不到就在该工具的规则目录（或配置文件）里建一个薄指针，
> 内容一行即可：**「本项目规范以仓库根 `AGENTS.md` 为准，开工前必须先完整阅读」**。
> ⛔ **不要把本文件正文复制过去**——那样一旦规范更新就会出现两个版本互相打架（原因见 §7）。

---

## 1. 项目速览

QuickClass（觉课智能体）—— 面向教师/学生的 AI 课堂平台。Web 应用，前后端同仓（Next.js App Router）。

| 项 | 值 |
|---|---|
| 技术栈 | Next.js 14（App Router）+ TypeScript + Prisma + SQLite + TDesign |
| 主仓库 | Gitee `maoyouhui/quickclass-release`（GitHub 有国际镜像仓库） |
| 开发分支 | `dev`（**所有改动都提到 `dev`**） |
| 生产分支 | `main`（只由项目负责人从 `dev` 合并，见 `Git协作完整指南.md`） |
| 权威协作文档 | `Git协作完整指南.md`（给人看的完整版；本文件是给 AI 看的可执行版） |

---

## 2. 最常用的命令（照抄即可，别自己发明）

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建（⚠️ 必须先 generate，构建脚本本身不含它）
npx prisma generate && npm run build

# 启动生产服务（本项目固定用 3000 端口，对外监听 0.0.0.0）
npx next start -H 0.0.0.0 -p 3000

# 重启生产服务（先杀干净再起，否则旧进程占端口）
pkill -9 -f next-server

# 类型检查（⚠️ 必做，原因见 §3-③）
npx tsc --noEmit
```

> ⚠️ **长命令/构建请用后台方式跑**（`setsid nohup ... &` 之类），跑完再回来看结果，不要阻塞在一条命令上。

---

## 3. 硬约束（🛑 必须遵守）

### ① 数据库：真库是 `prisma/prisma/dev.db`

- `.env` 里的 `DATABASE_URL` 是**相对 `schema.prisma` 所在目录**解析的 —— 别按仓库根去拼路径。
- **schema 有变更时必须显式执行** `npx prisma db push`（`npm run build` 不会替你做）。
- 改动、迁移、清理数据库前**先备份原文件**（`cp prisma/prisma/dev.db <备份名>`）。

> ⛔ DO NOT USE `bash start.sh` —— 它在某些情况下会**初始化出一个空库**，属于本项目的历史地雷。
> 需要启动就用 §2 的 `next start` 命令。

### ② 别把本地环境产物提交进仓库

`.env`、`*.db`、`node_modules/`、`.next/`、构建日志 —— **一律不提交**。凭据只存在于各自本机。

### ③ 🛑 “构建成功” ≠ “没有 bug”

`next.config.mjs` 里开了 `typescript.ignoreBuildErrors` ⇒ **`npm run build` 通过，不代表类型是对的**。
所以任何代码改动交付前，必须单独跑一次 `npx tsc --noEmit`，并把**新增**的类型错误清干净。

> 🔗 判断“是否新增”的正确姿势：比较改动前后报错的**文件集合**（不要只看错误条数，数量会因无关改动浮动）：
>
> ```bash
> # 改动前先存基线
> npx tsc --noEmit 2>&1 | grep 'error TS' | sed 's/(.*//' | sort -u > /tmp/tsc-before.txt
> # 改完再跑一次；diff 为空 = 零新增类型错误
> npx tsc --noEmit 2>&1 | grep 'error TS' | sed 's/(.*//' | sort -u > /tmp/tsc-after.txt
> diff /tmp/tsc-before.txt /tmp/tsc-after.txt
> ```

### ④ 列表接口瘦身契约（🛑 别把字段加回去）

`GET /api/tasks`（课堂列表）**故意不下发提示词正文**（`systemPrompt` / `analysisPrompt` / `classAnalysisPrompt` / `designPrompt` / `aiCompanionPrompt`）与探究 HTML 正文，
打开编辑弹窗时再由前端按需拉详情补齐。

> ⛔ DO NOT ADD THESE FIELDS BACK TO THE LIST API.
> 历史教训：早年为减小列表体积曾剥掉这些字段，但没有配套“编辑时按需拉取”，
> 后来有人为了修「编辑时看不到已填提示词」**直接把字段加回了列表**，性能优化静默消失，几个月后表现为“页面刷新很慢”。
> 正确做法是**补详情接口 + 前端按需拉取**，不是把大字段加回列表。

相关实现（改动时这几处是一套，**改一处要一起看**）：

- `src/app/api/tasks/route.ts` —— 列表 GET / POST 的 `select`（瘦身点）
- `src/app/api/tasks/[taskId]/route.ts` —— `?lite=1`（不带探究 HTML）；**不带 lite 时必须保持原行为**
- `src/app/api/preset-conversations/[presetConversationId]/route.ts` —— 单个对话活动的 GET
- `src/app/teacher/tasks/page.tsx` —— 各编辑入口“**先拉详情、再进编辑态**”，拉取失败**不要**带着空值进编辑器

### ⑤ 接口鉴权口径

前端请求用户态数据时带 **`Authorization: Bearer <token>`**（本仓库主口径）。
`x-auth-token` 只是历史兼容回退，**新增代码不要再引入新的鉴权头写法**，保持一种。

---

## 4. 开工前先做：检查并合并待处理的 PR（本项目固定流程）

**这不是可选建议。在阅读代码、修改任何文件之前，先完成本节。**

本仓库是多方协作：合作开发者通过 **Pull Request（PR）** 把改动提交到 `dev`；**PR 必须先被合并**，改动才真正进入 `dev`。
若在“PR 还没合并”的旧代码上继续开发 ⇒ 重复劳动、合并冲突、互相覆盖。

> ⛔ DO NOT SKIP 历史教训（2026-09）：曾因未先合并 PR 就基于旧代码开发，与已提 PR 的改动冲突，返工一轮。

### ① 查上游有没有待合并的 PR

用你环境里**已接入的 Gitee 能力**（Gitee 集成 / MCP / API / 网页）查看 `maoyouhui/quickclass-release` 的 open PR：

```bash
# 有 API 凭据时
curl -s -H "Authorization: Bearer $GITEE_TOKEN" \
  "https://gitee.com/api/v5/repos/maoyouhui/quickclass-release/pulls?state=open"
```

```text
# 没有凭据就直接看网页
https://gitee.com/maoyouhui/quickclass-release/pulls?state=open
```

返回空数组 / 没有 open PR ⇒ 跳到 ③。

### ② 有 PR：先报告，经用户同意后再合并

把每个 PR 的 **编号 / 标题 / 提交人 / 改动文件** 列给用户，并明确问：

> 「上游有 N 个待合并的 PR，是否现在就合并？」

**必须经用户同意后才能合并**（合并影响其他协作者且难以撤销）。同意后，用你可用的 Gitee 能力合并：

```bash
curl -s -X PUT -H "Authorization: Bearer $GITEE_TOKEN" \
  "https://gitee.com/api/v5/repos/maoyouhui/quickclass-release/pulls/<PR编号>/merge"
```

返回 `200` = 合并成功；`401` = 凭据无效；`403` = 无权限。

### ③ 同步代码，然后才开始工作

```bash
git fetch origin
git checkout dev
git pull origin dev
git status          # 确认工作区干净、无冲突，再开始
```

**凭据怎么办**：Token 由**运行本规则的 AI 环境自行解决**（Gitee 集成 / MCP / 环境变量均可）。
拿不到就**降级**为「执行 ③ + 把 PR 列表链接给用户，请他手动合并」，合并完成后继续 ③。
**不要因为缺 token 就整段跳过本检查。** Token 只在各自本机配置，**不要写入仓库、不要提交**。

### 边界

- **不要**未经用户确认就合并 PR。
- **不要**直接向 `main` 推送。
- 本节只处理**上游仓库**的 PR；不要合并你 fork 里尚未提 PR 的分支。

---

## 5. 代码注释规范：凡改过的代码都要留「护栏注释」

> 普通注释写给旁边的人看；**护栏注释写给“下一个打算改这里的人（或 AI）”看**。
> 判断标准只有一条：**明天一个完全不认识这段代码的 AI 来改它，光看注释会不会做出正确的决定？**

只要是你**检查过或修改过**的代码，就要按四段式补注释：

| 段 | 内容 |
|---|---|
| **为什么** | 这段代码为什么长这样（最好带实测数字） |
| **现状/约束** | 现在的行为边界（哪些必须保持不变） |
| **🔗 关联** | 改这里要**同步改哪几处**（列文件路径 + 位置） |
| **⛔ 别回退 + 维护** | 为什么不能改回旧写法、历史教训、以后该怎么做 |

**标记词表**（统一使用，便于 grep 巡检）：

| 标记 | 含义 |
|---|---|
| `⛔ DO NOT REVERT` | 禁止改回旧写法 / 禁止加回被剥离的东西 |
| `📐 CONTRACT` | 接口 / 数据形状契约（谁依赖它、破约后果） |
| `⚠️ GOTCHA` | 反直觉的坑（写法必须如此） |
| `🧪 MEASURED` | 实测数字及其来源 |
| `🔗 RELATED` | 关联点清单 |
| `📌 TODO(yyyy-mm-dd)` | 未完成的决定（触发条件 + 负责人）；**禁止裸 `TODO`** |

**四条硬要求**：

1. **英文祈使句在前**：`DO NOT REVERT` / `DO NOT ADD ... BACK` / `MUST STAY IN SYNC` —— 对能力较弱的模型约束力更强，中文解释负责说服人。
2. **必须写在注释行内**（写在字符串、提示词模板、`echo` 文案里的标记不算）。
3. **自包含**：别只写“见 PR #xx”，后人不一定去翻。
4. **注释与代码同一次提交**（过期注释比没注释更危险）。

---

## 6. 提交与分支约定

- 一律**提交到 `dev`**（走 PR），**不直接推 `main`**。
- 一个提交一件事；提交信息写清“**做了什么 + 为什么**”。
- 推送前自查：`git status` 干净、无 `.env` / `*.db` 混入。
- 提交信息规范见 `.trae/rules/git-commit-message.md`。

---

## 7. 关于“规范写在哪”（给后来维护者）

本仓库的规范载体设计原则是 **内容唯一、入口轻薄**：

```
AGENTS.md                      ← 唯一事实来源（跨 20+ 工具，本文件）
├── .trae/rules/*.md           ← 薄指针（Trae 项目规则目录）
├── .codebuddy/rules/*.mdc     ← 薄指针（CodeBuddy，平铺 .mdc）
└── CLAUDE.md（如需要）         ← 薄指针（Claude Code）
```

> ⛔ DO NOT COPY THE BODY INTO TOOL-SPECIFIC RULE FILES.
> 各工具的入口文件里**只写“去读 AGENTS.md”**，不写正文。
> 原因：正文一旦复制成多份，规范更新时必然漂移，出现“哪个版本才算数”的混乱。
> 新增一种工具的入口 = 加一个 3 行的指针文件，**而不是再抄一遍规范**。
