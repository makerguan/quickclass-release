/**
 * 互动探究 ↔ QuickForm 收集任务 的绑定与写入（Part 1 服务端）
 *
 * 三条原则：
 * 1. **一个探究一个 QF 任务**：首次开启提交时创建，之后每次保存复用；
 *    探究改名只同步任务名，不换 id —— 历史数据始终连续。
 * 2. **任务 id 只存 DB 字段**（`ExplorationActivity.qfTaskId`），不写进 HTML。
 *    AI 每次重生成网页会覆盖 htmlContent，写进 HTML 的绑定一定会丢。
 * 3. **绝不因为 QF 出问题就丢掉学生原有数据**：本模块所有写库失败只返回错误信息，
 *    不抛出（学生提交路径上，行为数据比答案更重要）。
 */
import { getQfCore, submitQfRecord, QfError, QfErrorCode } from "@/lib/quickform";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface EnsureQfTaskResult {
  /** 绑定成功后的 QF 任务 id；失败为 null */
  taskId: string | null;
  /** 本次是否新建了任务 */
  created: boolean;
  /** 本次是否同步了任务名 */
  renamed: boolean;
  error?: string;
}

/**
 * 取得（必要时创建）该探究对应的 QF 任务。
 *
 * - 已有 `currentTaskId`：校验任务还在（不在就重建，说明数据已被清）；
 *   名称与探究标题不一致时同步名称。
 * - 没有：按探究标题新建。
 */
export async function ensureQfTaskForExploration(params: {
  currentTaskId: string | null;
  title: string;
}): Promise<EnsureQfTaskResult> {
  const core = getQfCore();
  const title = (params.title || "").trim() || "互动探究";
  const current = params.currentTaskId;

  if (current) {
    try {
      const schema = await core.getTaskSchema(current);
      if (schema.name !== title) {
        await core.updateTask(current, { name: title });
        return { taskId: current, created: false, renamed: true };
      }
      return { taskId: current, created: false, renamed: false };
    } catch (e) {
      if (e instanceof QfError && e.code === QfErrorCode.TASK_NOT_FOUND) {
        // 任务已被删除（清库 / 演示重上）→ 落到下面重建
      } else {
        return { taskId: current, created: false, renamed: false, error: errText(e) };
      }
    }
  }

  try {
    const task = await core.createTask(title);
    return { taskId: task.taskId, created: true, renamed: false };
  } catch (e) {
    return { taskId: null, created: false, renamed: false, error: errText(e) };
  }
}

export type WriteAnswersResult = { recordId: string } | { error: string };

/**
 * 把网页里采集到的答案写进 QF 任务。
 *
 * - 过滤空值；跳过 `_` 开头的键（那是 SDK 的保留字段）
 * - `replaceRecordId` 用于「同一学生重新提交」：先删旧记录再写新的，保持一人一条
 * - 学生没在面板里填姓名时，用登录账号的姓名兜底
 */
export async function writeCollectedAnswers(
  qfTaskId: string,
  answers: Record<string, unknown>,
  opts?: {
    replaceRecordId?: string | null;
    identity?: { studentName?: string; studentNo?: string; studentId?: string };
  }
): Promise<WriteAnswersResult> {
  const data: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(answers || {})) {
    if (!k || k.startsWith("_")) continue;
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) continue;
      data[k] = s;
    } else if (typeof v === "number" || typeof v === "boolean") {
      data[k] = v;
    }
    // 其他类型（对象 / 数组）不收：网页采集结果天然是扁平的
  }

  if (!data["学生姓名"] && opts?.identity?.studentName) {
    data["学生姓名"] = opts.identity.studentName;
  }
  if (!data["学号"] && opts?.identity?.studentNo) {
    data["学号"] = opts.identity.studentNo;
  }

  if (Object.keys(data).length === 0) {
    return { error: "没有采集到可写入的内容" };
  }

  try {
    const rec = await submitQfRecord(qfTaskId, data, opts?.replaceRecordId, {
      studentId: opts?.identity?.studentId || undefined,
    });
    return { recordId: rec.recordId };
  } catch (e) {
    return { error: errText(e) };
  }
}
