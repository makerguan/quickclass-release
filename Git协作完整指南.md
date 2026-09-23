# Git 协作完整指南

本指南面向项目负责人和合作开发者，说明本项目的 Git 仓库结构、分支设计、日常协作方式，以及从开发到发布的完整流程。文档同时提供命令行操作和 Trae Code / VS Code 图形化操作两种方式。

---

## 一、项目背景与设计思路

### 1.1 为什么有两个仓库？

本项目同时维护两个代码仓库：

| 仓库 | 平台 | 面向用户 | 说明 |
|---|---|---|---|
| Gitee 仓库 | `https://gitee.com/maoyouhui/quickclass-release.git` | 国内用户 | 主仓库，日常开发和国内发布都在这里 |
| GitHub 仓库 | `https://github.com/makerguan/quickclass-release.git` | 国际用户 | 国际版仓库，只发布稳定版本 |

**设计原因：**
- 国内访问 Gitee 更快、更稳定，所以把 Gitee 作为主开发仓库。
- GitHub 是国际用户更熟悉的平台，用于发布国际版。
- GitHub 上的代码**完全等同于 Gitee 上的 `main` 分支**，不做额外修改。

### 1.2 为什么这样设计分支？

| 分支 | 用途 | 谁可以操作 |
|---|---|---|
| `dev` | 日常开发分支 | 所有合作开发者 |
| `main` | 国内发布分支 | 项目负责人 |
| `github-release/main` | 国际发布分支 | 项目负责人 |

**设计思路：**
- `dev` 是大家的"工作区"，所有新功能、修复都在这里开发。
- `main` 是"稳定区"，只有当 `dev` 测试通过后才合并进来，用于国内发布。
- `github-release/main` 是"国际稳定区"，内容和 `main` 保持一致，用于国际发布。

> 简单来说：**dev 是开发，main 是国内发布，GitHub 是国际发布。**

---

## 二、仓库配置速览

当前项目已配置好以下远程仓库：

```bash
$ git remote -v

origin          https://gitee.com/maoyouhui/quickclass-release.git (fetch)
origin          https://gitee.com/maoyouhui/quickclass-release.git (push)
github-release  https://github.com/makerguan/quickclass-release.git (fetch)
github-release  https://github.com/makerguan/quickclass-release.git (push)
```

- `origin`：对应 Gitee
- `github-release`：对应 GitHub

---

## 三、合作开发者操作指南

作为合作开发者，你只需要关心 `dev` 分支：
1. 从 `dev` 拉取最新代码。
2. 在 `dev` 上开发新功能或修复问题。
3. 把代码推送到 Gitee 的 `dev` 分支。
4. 通知项目负责人合并到 `main`。

### 3.1 首次参与项目

#### 命令行方式

```bash
# 克隆项目
git clone https://gitee.com/maoyouhui/quickclass-release.git

# 进入项目目录
cd quickclass-release

# 切换到 dev 分支
git checkout dev

# 拉取最新代码
git pull origin dev
```

#### 图形化方式（Trae Code / VS Code）

1. 打开 Trae Code，点击 **文件 → 打开文件夹**，选择项目目录。
2. 点击左侧活动栏的 **源代码管理** 图标（分支图标）。
3. 点击底部状态栏的分支名称，选择 `dev`。
4. 点击源代码管理面板顶部的 **···** → **拉取**，或 **从...拉取** → 选择 `origin/dev`。

### 3.2 日常开发流程

#### 命令行方式

```bash
# 每天开始工作前，先同步 dev
git checkout dev
git pull origin dev

# 编写代码...

# 提交代码
git add .
git commit -m "feat: 你的改动说明"

# 推送到 Gitee 的 dev
git push origin dev
```

#### 图形化方式

1. **切换分支**：点击底部状态栏分支名称 → 选择 `dev`。
2. **拉取代码**：点击 **···** → **从...拉取** → 选择 `origin/dev`。
3. **编写代码**：修改文件。
4. **暂存更改**：在源代码管理面板中，点击文件右侧的 **+** 号。
5. **填写提交信息**：在输入框中输入，例如 `feat: 新增课堂搜索功能`。
6. **提交**：点击 **提交** 按钮。
7. **推送**：点击 **推送** 按钮，将 `dev` 推送到 Gitee。

### 3.3 合作者不能做的事

- **不要直接修改 `main` 分支。**
- **不要直接推送到 `github-release`。**
- 合并到 `main` 和同步到 GitHub 由项目负责人统一操作。

---

## 四、项目负责人操作指南

作为项目负责人，你的主要职责是：
1. 管理 `dev` 分支上的开发进度。
2. 在合适的时候把 `dev` 合并到 `main`。
3. 把 `main` 推送到 Gitee。
4. 把 `main` 同步到 GitHub 国际版。

### 4.0 每天开工第一步：先处理待合并的 PR

在基于 `dev` 做任何开发之前，先确认有没有合作者提了**还没合并**的 PR —— PR 未合并 = 改动还不在 `dev` 里，在旧代码上继续开发会产生冲突。

> 若使用 AI 编程助手，这一步已由**仓库内规则文件**接管：助手在会话开始时会自动读到并提醒，无需你记得。
> 规则入口见仓库根目录 **`AGENTS.md`**（跨工具的规范事实来源；Trae 桌面版需在「设置 → 规则 → 导入设置」开一次「将 AGENTS.md 包含在上下文中」开关）。
> 各工具专属目录（`.trae/rules/`、`.codebuddy/rules/`）里**只放指向 `AGENTS.md` 的薄指针**，正文不复制 —— 详见文末「附录：AI 协作规范写在哪」。

```bash
# 查待合并的 PR
curl -s -H "Authorization: Bearer $GITEE_TOKEN" \
  "https://gitee.com/api/v5/repos/maoyouhui/quickclass-release/pulls?state=open"

# 合并某个 PR（<编号> 换成上面的 PR 编号）
curl -s -X PUT -H "Authorization: Bearer $GITEE_TOKEN" \
  "https://gitee.com/api/v5/repos/maoyouhui/quickclass-release/pulls/<编号>/merge"
```

`GITEE_TOKEN` 获取：Gitee → 设置 → 私人令牌 → 新建令牌，勾选仓库读写（`projects`）权限；在本机设为环境变量即可（Windows：`setx GITEE_TOKEN "你的令牌"`），**不要提交到仓库**。

### 4.1 在 dev 上开发

#### 命令行方式

```bash
# 切换到 dev 分支
git checkout dev

# 编写代码...

# 提交代码
git add .
git commit -m "feat: 新增 xxx 功能"

# 同步到 Gitee 上的 dev
git push origin dev
```

#### 图形化方式

与合作开发者相同：切换到 `dev` → 拉取 → 修改 → 暂存 → 提交 → 推送。

### 4.2 合并 dev 到 main 并发布

#### 命令行方式

```bash
# 1. 确保 dev 是最新的
git checkout dev
git pull origin dev

# 2. 切换到 main
git checkout main

# 3. 拉取 main 最新代码，避免覆盖他人提交
git pull origin main

# 4. 把 dev 合并到 main
git merge dev

# 5. 推送到 Gitee
git push origin main

# 6. 同步到 GitHub 国际版
git push github-release main
```

#### 图形化方式

1. **切换到 dev 并拉取最新代码**：底部状态栏选择 `dev` → **从...拉取** → `origin/dev`。
2. **切换到 main**：底部状态栏选择 `main`。
3. **拉取 main 最新代码**：**从...拉取** → `origin/main`。
4. **合并 dev 到 main**：点击底部状态栏分支名称 → **合并分支...** → 选择 `dev`。
5. **推送到 Gitee**：点击 **推送** 按钮。
6. **同步到 GitHub**：
   - 方式一（推荐）：打开底部 **终端**，输入 `git push github-release main`。
   - 方式二：点击 **···** → **推送到...** → 选择 `github-release`。

> 推送到 `github-release` 建议用终端，因为 IDE 默认只显示 `origin`，操作更直接。

### 4.3 发布前检查清单

每次发布前确认：
- [ ] `dev` 分支上的功能已经测试通过。
- [ ] 合并前先在 `main` 上执行了 `git pull origin main`。
- [ ] 合并后没有冲突。
- [ ] `main` 已推送到 Gitee。
- [ ] `main` 已同步到 GitHub。

---

## 五、完整协作流程图

```
┌─────────────────┐
│  合作开发者 A    │
│  在 dev 上开发   │
└────────┬────────┘
         │ git push origin dev
         ▼
┌─────────────────┐
│  合作开发者 B    │
│  在 dev 上开发   │
└────────┬────────┘
         │ git push origin dev
         ▼
┌─────────────────────────┐
│   Gitee 上的 dev 分支    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    项目负责人审查/测试    │
│   git checkout main     │
│   git merge dev         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Gitee 上的 main 分支   │
│   国内发布版本           │
└───────────┬─────────────┘
            │ git push github-release main
            ▼
┌─────────────────────────┐
│  GitHub 上的 main 分支   │
│   国际发布版本           │
└─────────────────────────┘
```

---

## 六、命令行与图形化操作对照表

| 目的 | 命令行 | Trae / VS Code 图形化 |
|---|---|---|
| 切换分支 | `git checkout dev` | 点击底部状态栏分支名称 → 选择分支 |
| 拉取代码 | `git pull origin dev` | **···** → **从...拉取** → 选择远程分支 |
| 暂存文件 | `git add 文件名` | 点击文件右侧 **+** |
| 提交代码 | `git commit -m "描述"` | 填写提交信息 → 点击 **提交** |
| 推送代码 | `git push origin dev` | 点击 **推送** |
| 合并分支 | `git merge dev` | 点击分支名称 → **合并分支...** |
| 推送到 GitHub | `git push github-release main` | 建议用终端执行 |

---

## 七、常见问题

### Q1：为什么合作者不直接推送到 main？

`main` 是发布分支，需要保证稳定。由项目负责人统一合并和发布，可以避免未经测试的代码进入发布版本。

### Q2：dev 分支上已经有其他人的提交，我该怎么同步？

```bash
git checkout dev
git pull origin dev
```

如果和你本地的修改有冲突，Git 会提示你解决。解决后重新提交并推送。

### Q3：我想提交一个功能，但还没有完成，可以推送吗？

可以。只要你所在的分支是 `dev`，就可以推送。如果功能没完成，建议和团队成员沟通，避免影响他人。

### Q4：项目负责人合并时出现冲突怎么办？

1. 在本地解决冲突。
2. 测试通过后再提交。
3. 然后推送 `main` 到 Gitee 和 GitHub。

```bash
git checkout main
git merge dev
# 解决冲突...
git add .
git commit -m "merge: 合并 dev 到 main"
git push origin main
git push github-release main
```

图形化方式下，冲突文件会用颜色标出，点击文件可以逐行选择保留哪一部分。

### Q5：GitHub 上的国际版和 Gitee 上的 main 必须完全一致吗？

是的。国际版只发布 `main` 分支的内容，不做额外定制。

---

## 八、命令速查表

| 目的 | 命令 |
|---|---|
| 切换到 dev | `git checkout dev` |
| 同步 dev 最新代码 | `git pull origin dev` |
| 提交代码 | `git add . && git commit -m "描述"` |
| 推送 dev 到 Gitee | `git push origin dev` |
| 切换到 main | `git checkout main` |
| 拉取 main 最新代码 | `git pull origin main` |
| 合并 dev 到 main | `git merge dev` |
| 推送 main 到 Gitee | `git push origin main` |
| 同步 main 到 GitHub | `git push github-release main` |
| 查看当前状态 | `git status` |
| 查看远程仓库 | `git remote -v` |
| 查看所有分支 | `git branch -a` |

---

## 九、可选：命令简化方案

如果觉得命令太长，可以考虑以下简化方案。这些方案**不是必须**的，只是提供参考，是否采用由团队决定。

### 方案 A：npm scripts（推荐）

在 `package.json` 中添加：

```json
"git:sync-dev": "git checkout dev && git pull origin dev",
"git:push-dev": "git push origin dev",
"git:release": "git checkout main && git pull origin main && git merge dev && git push origin main && git push github-release main"
```

使用：

```bash
npm run git:sync-dev
npm run git:release
npm run git:push-dev
```

### 方案 B：Git 别名

每个开发者本地配置：

```bash
git config --global alias.sync-dev '!git checkout dev && git pull origin dev'
git config --global alias.release '!git checkout main && git pull origin main && git merge dev && git push origin main && git push github-release main'
```

使用：

```bash
git sync-dev
git release
```

### 方案 C：Shell 脚本

创建 `scripts/release.sh`：

```bash
#!/bin/bash
set -e
git checkout dev
git pull origin dev
git checkout main
git pull origin main
git merge dev
git push origin main
git push github-release main
```

使用：

```bash
bash scripts/release.sh
```

---

## 十、总结

- **合作开发者**：只在 `dev` 分支上开发，推送到 Gitee 的 `dev`。
- **项目负责人**：审查 `dev`，合并到 `main`，推送到 Gitee，同步到 GitHub。
- **核心原则**：`main` 和 GitHub 是国际/国内发布分支，保持稳定性，不直接开发。

按照这个流程，国内版和国际版可以保持一致，团队协作也不容易出错。

---

## 附录：AI 协作规范写在哪（多工具通用）

AI 编程助手会「自动读」的规则文件，各工具互不相同。若为每种工具都维护一份规范全文，必然出现**多版本漂移**——改了一份、忘另一份，最后没人知道哪份算数。

本仓库采用 **「内容唯一、入口轻薄」**：

```
AGENTS.md                            ← 规范正文（唯一事实来源），跨工具通用
├── .trae/rules/pr-sync-guard.md         ← 薄指针：只写「去读 AGENTS.md」
├── .codebuddy/rules/pr-sync-guard.mdc   ← 薄指针
└──（未来新增工具）                       ← 再加一个 3 行的指针，不抄正文
```

**为什么选 `AGENTS.md`**：它是当前跨工具的事实标准，20+ 工具原生读取（Cursor、GitHub Copilot、Codex、Windsurf、Zed、RooCode、Cline、Gemini CLI、Jules、Amp、goose、opencode…）。**Trae 也支持**——但桌面版需在「设置 → 规则 → 导入设置」打开一次「将 AGENTS.md 包含在上下文中」；TRAE CLI 则默认读取，无需开关。

**怎么用**：不论你用什么工具，**先读根目录 `AGENTS.md`**。其 §0 有「怎么让本文件在你的工具里生效」的对照表；不在表内的工具，照 §0 说明在各自规则目录加一个**指向 `AGENTS.md` 的薄指针**即可。

> ⛔ 维护者注意：`AGENTS.md` 是唯一正文。工具专属文件里出现规范正文 = 违规，请改回指针。
