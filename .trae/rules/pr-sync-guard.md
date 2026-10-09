---
description: 开工前必须先检查上游待合并的 PR 并同步最新代码（本项目固定流程）
alwaysApply: true
---

# 开工前协作同步检查（本项目固定流程）

> 📐 本文件是**薄指针**，不是规范正文。
> 本项目协作规范的**唯一事实来源 = 仓库根目录 `AGENTS.md`** —— 请**先完整读它**（尤其 §4 本节、§3 硬约束）。
> ⛔ DO NOT COPY THE BODY OF AGENTS.md HERE. 正文复制成多份后必然漂移，届时无人知道哪个版本算数。
> 本文件只保留**最小可执行摘要**，用于兜底。

**这不是可选建议，是本项目协作的第一步。在阅读代码、修改任何文件之前，先完成下面三步。**

## 最小可执行摘要

1. **查** —— 看 Gitee `maoyouhui/quickclass-release` 有没有 open 的 PR：
   网页 `https://gitee.com/maoyouhui/quickclass-release/pulls?state=open`，或用你环境已接入的 Gitee 能力。
2. **问** —— 有 PR 就列出「编号 / 标题 / 提交人 / 改动文件」，**先问用户是否合并**；用户同意后才合并。
   > 🛑 DO NOT MERGE WITHOUT USER CONFIRMATION.
3. **同步** —— `git fetch origin && git checkout dev && git pull origin dev`，
   确认工作区干净、无冲突，然后才开工。

**凭据拿不到不要卡住**：降级为「把 PR 列表链接给用户 + 请他手动合并」，合并完成后继续第 3 步。
**不要因为缺 token 就整段跳过本检查。** Token 只在各自本机配置，**不要写入仓库、不要提交**。

> ⛔ DO NOT SKIP 历史教训（2026-09）：曾因未先合并 PR 就基于旧代码开发，与已提 PR 的改动冲突，返工一轮。

## 边界

- 不越权：未经用户确认**不合并** PR；**不直接推 `main`**。
- 只处理**上游仓库**的 PR；不合并你 fork 里尚未提 PR 的分支。

## 🔗 关联（改本文件时务必同步）

- **规范正文**：仓库根 `AGENTS.md` §4（**以它为准**）
- **同一指针的另一份**：`.trae/rules/pr-sync-guard.md`、`.codebuddy/rules/pr-sync-guard.mdc`（两份**正文须逐字一致**，frontmatter 各按本工具格式）
- 人看的完整流程：`Git协作完整指南.md` §4.0
