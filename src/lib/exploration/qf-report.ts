/**
 * 探究 AI 报告 / 教学建议的 QF 答案段拼接（Part 1 服务端）
 *
 * 为什么要有这个文件：
 *   互动探究采集是「双轨」——行为数据进 ExplorationSubmission.answers，
 *   学生填写的探究答案进 QfRecord.dataJson。早先 AI 报告与教学建议只喂
 *   行为数据（得分/停留/互动/操作日志），学生真正填写的答案从不进报告，
 *   导致「老师在大屏看得到答案、AI 报告里却看不到」的数据割裂。
 *   本文件把 QF 答案聚成一段纯文本，供两个 AI 端点统一拼接。
 *
 * 🔗 RELATED（改这里要同步看）：
 *   - src/app/api/exploration-activities/[id]/analysis/generate/route.ts（AI 分析报告）
 *   - src/app/api/exploration-activities/[id]/analysis/route.ts（教学建议）
 *   - 姓名识别键与 src/components/exploration/QuickFormRecordList.tsx 的 NAME_KEYS 对齐
 * ⛔ DO NOT REVERT：不要把 QF 答案段从 AI 报告里摘掉——那会退回「答案只进大屏不进报告」的割裂。
 */
import { prisma } from "@/lib/prisma";

/** 姓名识别键（与老师端 QuickFormRecordList 保持一致，避免两处口径漂移） */
const NAME_KEYS = ["学生姓名", "姓名", "名字", "studentName", "name", "nickname", "昵称"];

/** 报告里最多纳入的学生答案条数（与行为数据 submissionDetails 的 slice(0,30) 对齐） */
const MAX_ROWS = 30;

function pickName(data: Record<string, unknown>): string {
  for (const k of NAME_KEYS) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  for (const [k, v] of Object.entries(data)) {
    if (k.includes("姓名") && v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "";
}

/**
 * 把某探究的 QF 采集答案聚成一段纯文本。
 *
 * @returns 空串表示该探究未绑定 QF 任务、或暂无答案（调用方据此回退到「无作答」）。
 */
export async function buildQfAnswersText(qfTaskId: string | null): Promise<string> {
  if (!qfTaskId) return "";

  const records = await prisma.qfRecord.findMany({ where: { taskId: qfTaskId } });
  if (records.length === 0) return "";

  const lines = records.slice(0, MAX_ROWS).map((r, i) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(r.dataJson || "{}") as Record<string, unknown>;
    } catch {
      data = {};
    }
    const name = pickName(data) || `提交 #${i + 1}`;
    const fields = Object.entries(data)
      .filter(([k, v]) => !k.startsWith("_") && v !== null && v !== undefined && String(v).trim() !== "")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join("，");
    return `${name}：${fields || "（无内容）"}`;
  });

  return lines.join("\n");
}
