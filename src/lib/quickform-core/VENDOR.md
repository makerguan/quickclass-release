# Vendor 说明：quickform-core

本目录是 **QuickForm 核心 SDK** 的 vendor 副本，随 QuickClass 源码一起分发。

| 项 | 值 |
|---|---|
| 唯一源码地 | `gitee.com/markets2022/quickform-core`（公开仓） |
| 内置版本 | **v1.0.0**（提交 `1d08e4a9`） |
| 同步日期 | 2026-09-19 |
| 接口契约 | quickform-core-sdk-设计规范 v0.4 · 契约冻结 v1 |

## 只读约定

**本目录在 QuickClass 仓内只读，禁止手改。** 需要改 SDK 时：

1. 到源仓（quickform-core）修改 + 补单测
2. 打新 tag
3. 用 vendor 脚本重新同步（见下）

## 同步方式（唯一路径：拷贝，禁止运行时拉取）

源仓与目标仓是两套独立代码，**不能 merge/subtree**，只能文件级拷贝。同步时需要做**一处归一化**：

| 差异 | 原因 | 处理 |
|---|---|---|
| 源仓 import 带 `.ts` 扩展名（如 `from "./types.ts"`） | Node 22 `--experimental-strip-types` 跑单测要求显式扩展名 | 同步时去掉扩展名（`from "./types"`）——QC 的 tsconfig `moduleResolution: bundler` 且未开 `allowImportingTsExtensions`，带扩展名会导致 `next build` 类型检查失败 |

同步的 6 个文件：`core.ts` / `types.ts` / `errors.ts` / `id.ts` / `validation.ts` / `adapters/memory.ts`
（`index.ts` 与 `VENDOR.md` 是本仓自有的封装层，不在源仓中）

## 不要做的事

- ❌ 不要 `npm install quickform-core`（源码直发模式，无 npm 环节）
- ❌ 不要在运行时从 Gitee 拉取（老师机器不该有网络依赖，且多一个故障点）
- ❌ 不要在 QC 业务代码里 import 本目录的子文件路径，一律 `from "@/lib/quickform-core"`

## 数据库与路由（不在本目录）

| 内容 | 位置 |
|---|---|
| 数据表 | `prisma/schema.prisma` 的 `QfTask` / `QfRecord` |
| Prisma 适配器 | `src/lib/quickform/prisma-adapter.ts` |
| HTTP 路由 | `src/app/api/qf/*` |
