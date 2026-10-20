import type { PrismaClient } from "@prisma/client";

/**
 * 📐 CONTRACT: 跨类型统一活动排序（2026-10-12）
 *
 * 为什么：一个学习活动（SubProject）下有 4 类活动（对话/探究/项目/作业），
 * 历史上每类各自维护 sortOrder（类型内排序），学生端只能按类型分组展示。
 * 现改为「同一 SubProject 下 4 张表共用一个 sortOrder 数值空间」，
 * 实现"先对话、再探究、再对话"这类跨类型教学顺序。
 *
 * 现状/约束：
 * - 4 张表字段同名同义（sortOrder Int @default(0)），不需要加字段、不需要数据迁移表
 * - 学生端 /api/student/tasks 按各表 orderBy sortOrder asc 返回，前端合并渲染即得统一顺序
 * - 停用/未发布活动不参与学生端（API 已过滤 enabled=true / status=ACTIVE），
 *   教师端渲染沉底（sortEnabledFirst），重排时传给后端的顺序已含沉底结果
 *
 * 🔗 RELATED（改这里要同步看）：
 * - src/app/api/sub-projects/[subProjectId]/activities/reorder/route.ts —— 统一排序 API
 * - src/app/api/preset-conversations/route.ts、exploration-activities/route.ts、
 *   quiz-activities/route.ts、sub-projects/[subProjectId]/project-submissions/route.ts
 *   —— 4 个创建接口的跨表 max+1
 * - src/app/api/tasks/route.ts、tasks/[taskId]/route.ts —— 新建/编辑重建后的兜底重排
 * - scripts/migrate-unified-activity-order.mjs —— 存量数据一次性重排（与 TYPE_PRIORITY 口径一致）
 * - src/app/teacher/tasks/page.tsx —— 教师端统一活动列表
 * - src/app/student/chat/page.tsx —— 学生端合并渲染
 *
 * ⛔ DO NOT REVERT: 不要改回"每类各自从 0 计数"——那会让 4 表 sortOrder 并列冲突，
 *   统一排序渲染时顺序不稳定（同值次序取决于查询实现）。
 */

/** 统一活动类型标识（前端徽章、排序 API 入参、迁移脚本共用） */
export type UnifiedActivityType = "conversation" | "exploration" | "project" | "quiz";

/**
 * 类型优先级：存量数据重排 / 兜底重排时的类型间顺序。
 * 与旧学生端分组展示顺序一致（对话 → 探究 → 项目 → 作业），
 * 保证迁移/编辑重建后初始顺序与老师此前看到的学生端顺序最接近。
 */
export const TYPE_PRIORITY: Record<UnifiedActivityType, number> = {
  conversation: 0,
  exploration: 1,
  project: 2,
  quiz: 3,
};

/** 按类型更新 sortOrder（显式 switch：4 个 Prisma 委托泛型不同，联合索引调用无法通过类型检查） */
function updateSortOrder(db: UnifiedOrderDb, type: UnifiedActivityType, id: string, sortOrder: number): Promise<unknown> {
  switch (type) {
    case "conversation":
      return db.presetConversation.update({ where: { id }, data: { sortOrder } });
    case "exploration":
      return db.explorationActivity.update({ where: { id }, data: { sortOrder } });
    case "project":
      return db.projectSubmission.update({ where: { id }, data: { sortOrder } });
    case "quiz":
      return db.quizActivity.update({ where: { id }, data: { sortOrder } });
  }
}

/**
 * 可执行统一排序操作的 db 句柄。
 * ⚠️ GOTCHA: 本项目 Prisma 版本的事务回调参数类型是 Omit<PrismaClient, "$connect"|...>，
 * 不是 Prisma.TransactionClient——调用方在 prisma.$transaction(async (tx) => ...) 内把 tx 传进来，
 * 因此这里不含 $transaction（批量更新由调用方事务包裹，函数内逐条执行）。
 */
export type UnifiedOrderDb = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface UnifiedActivityRef {
  type: UnifiedActivityType;
  id: string;
}

/** 从 4 张表拉取某学习活动下的全部活动（含停用，重排需要全量） */
export async function fetchAllUnifiedActivities(
  db: UnifiedOrderDb,
  subProjectId: string
): Promise<Array<{ type: UnifiedActivityType; id: string; sortOrder: number; createdAt: Date }>> {
  const [conversations, explorations, projects, quizzes] = await Promise.all([
    db.presetConversation.findMany({ where: { subProjectId }, select: { id: true, sortOrder: true, createdAt: true } }),
    db.explorationActivity.findMany({ where: { subProjectId }, select: { id: true, sortOrder: true, createdAt: true } }),
    db.projectSubmission.findMany({ where: { subProjectId }, select: { id: true, sortOrder: true, createdAt: true } }),
    db.quizActivity.findMany({ where: { subProjectId }, select: { id: true, sortOrder: true, createdAt: true } }),
  ]);
  return [
    ...conversations.map((x) => ({ ...x, type: "conversation" as const })),
    ...explorations.map((x) => ({ ...x, type: "exploration" as const })),
    ...projects.map((x) => ({ ...x, type: "project" as const })),
    ...quizzes.map((x) => ({ ...x, type: "quiz" as const })),
  ];
}

/**
 * 下一个可用 sortOrder：跨 4 张表取最大值 +1（统一数值空间）。
 * ⛔ 各创建接口不要再自己查本表 max——那会与跨类型排序打架。
 */
export async function getNextUnifiedSortOrder(db: UnifiedOrderDb, subProjectId: string): Promise<number> {
  const all = await fetchAllUnifiedActivities(db, subProjectId);
  return all.reduce((max, x) => Math.max(max, x.sortOrder), -1) + 1;
}

/**
 * 按给定顺序重写某学习活动下全部活动的 sortOrder（0..n-1，跨表连续）。
 *
 * @param orderedIds 期望顺序（type+id 列表）。列表外的活动（含传入顺序里不存在的脏数据）
 *   按 (TYPE_PRIORITY, 原 sortOrder, createdAt) 稳定追加在后面——保证不丢活动。
 * @param orderedIds 传 undefined/null 时为纯兜底模式：全部按 (TYPE_PRIORITY, sortOrder, createdAt) 重排。
 *   用于「编辑课堂全删重建」后（此时跨类型交错顺序已不可恢复，见 tasks/[taskId]/route.ts 注释）。
 */
export async function applyUnifiedOrder(
  db: UnifiedOrderDb,
  subProjectId: string,
  orderedIds?: UnifiedActivityRef[] | null
): Promise<void> {
  const all = await fetchAllUnifiedActivities(db, subProjectId);
  const keyOf = (x: { type: UnifiedActivityType; id: string }) => `${x.type}:${x.id}`;

  const orderedMap = new Map<string, number>();
  (orderedIds ?? []).forEach((ref, idx) => {
    // 同一活动重复出现时以首次为准
    const key = keyOf(ref);
    if (!orderedMap.has(key)) orderedMap.set(key, idx);
  });

  const listed: Array<{ ref: UnifiedActivityRef; item: (typeof all)[number]; order: number }> = [];
  const rest: Array<(typeof all)[number]> = [];
  for (const item of all) {
    const order = orderedMap.get(keyOf(item));
    if (order !== undefined) listed.push({ ref: { type: item.type, id: item.id }, item, order });
    else rest.push(item);
  }
  listed.sort((a, b) => a.order - b.order);
  rest.sort((a, b) =>
    TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] || a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()
  );

  const finalOrder = [...listed.map((x) => x.item), ...rest];
  // 调用方已在 prisma.$transaction 内包裹（UnifiedOrderDb 不含 $transaction），逐条执行即可
  for (let idx = 0; idx < finalOrder.length; idx++) {
    const item = finalOrder[idx];
    if (item.sortOrder !== idx) {
      await updateSortOrder(db, item.type, item.id, idx);
    }
  }
}

/**
 * 紧凑化某学习活动下的 sortOrder（重写为 0..n-1 连续），**保持现有相对顺序不变**。
 *
 * 为什么存在：「编辑课堂保存」走全删重建，4 类活动各自恢复原 sortOrder（对话按 id 回填、
 * 作业/探究/项目快照恢复），此时顺序已是老师排好的跨类型授课顺序，绝不能再跑
 * applyUnifiedOrder(null) 的分组重排——那会把交错顺序打回分组顺序。
 * 但重建过程中可能出现撞号/空洞（如新增对话按数组下标取号），用本函数做无损规范化：
 * 仅当值与目标下标不同才写库，顺序语义完全不变。
 *
 * ⛔ DO NOT REVERT: 编辑保存后的兜底必须用本函数而不是 applyUnifiedOrder(null)——
 *   后者按类型分组重排，会摧毁老师跨类型调好的授课顺序（2026-10-12 修复，历史教训见
 *   tasks/[taskId]/route.ts 恢复段注释）。
 */
export async function dedupeUnifiedOrder(db: UnifiedOrderDb, subProjectId: string): Promise<void> {
  const all = await fetchAllUnifiedActivities(db, subProjectId);
  // 显式 tiebreaker（类型优先级 + createdAt）保证同号并列时结果跨引擎确定
  all.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
  // 调用方已在 prisma.$transaction 内包裹，逐条执行即可
  for (let idx = 0; idx < all.length; idx++) {
    const item = all[idx];
    if (item.sortOrder !== idx) {
      await updateSortOrder(db, item.type, item.id, idx);
    }
  }
}
