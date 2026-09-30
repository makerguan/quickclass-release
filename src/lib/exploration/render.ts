import {
  injectSubmitFunctionality,
  removeSubmitFunctionality,
} from "@/lib/prompts/exploration-submit";
import {
  injectAiCompanion,
  removeAiCompanion,
} from "@/lib/prompts/ai-companion";
import type { CollectProfile } from "@/lib/exploration/collect-profile";

/**
 * 探究 HTML 的「纯净稿 ↔ 渲染版」转换（单一事实来源）。
 *
 * 契约（📐 CONTRACT）：
 *   数据库 `ExplorationActivity.htmlContent` 永远只存「纯净稿」——不含提交功能注入、
 *   不含 AI 伴学注入。提交/伴学的系统注入代码一律在「读取时」内存现算、用完即弃、不落库。
 *
 * 为什么（🧪 MEASURED）：
 *   历史上一度「提交通道 = 保存时注入落库、伴学 = 读取时注入」，两套混用导致：
 *   编辑回显拿到的是注入版、开关互相覆盖（开伴学删掉提交）、保存时重复分析注入。
 *   统一成「存纯净稿 + 读取时注入」后，这三个问题一并消失。
 *
 * ⛔ DO NOT REVERT / DO NOT ADD BACK：
 *   不要在 POST/PUT 保存路径里调用 renderExplorationHtml / injectSubmitFunctionality
 *   并把结果写回 htmlContent —— 那正是「保存时重新注入」bug 的根源。
 *   🔗 RELATED：改这里要同步看
 *     - src/app/api/exploration-activities/route.ts（POST，存纯净稿）
 *     - src/app/api/exploration-activities/[id]/route.ts（PUT 存纯净稿 / GET 回显纯净稿）
 *     - src/app/api/student/explorations/[id]/route.ts（学生读路径渲染）
 *     - src/app/teacher/tasks/page.tsx（前端保存/预览，恒传纯净稿）
 */

/**
 * 剥净：把可能含存量注入（提交 + 伴学）的 html 还原成纯净稿。
 * 对纯净稿是 no-op，幂等，可安全用于旧数据自愈迁移。
 */
export function purifyExplorationHtml(html: string | null | undefined): string {
  if (!html) return "";
  return removeAiCompanion(removeSubmitFunctionality(html));
}

export interface RenderExplorationResult {
  html: string;
  warnings: string[];
}

/**
 * 渲染：按开关把纯净稿注入成「渲染版」（提交 + 伴学）。
 * 学生读路径、教师预览路径统一走这里，保证同一份纯净稿在任何时刻渲染结果一致（纯函数）。
 */
export function renderExplorationHtml(params: {
  htmlContent: string | null | undefined;
  explorationId: string;
  taskTitle?: string;
  enableSubmission?: boolean;
  enableAiCompanion?: boolean;
  collectProfile?: CollectProfile | null;
}): RenderExplorationResult {
  const warnings: string[] = [];
  let html = purifyExplorationHtml(params.htmlContent);

  if (params.enableSubmission) {
    const result = injectSubmitFunctionality(
      html,
      {
        explorationId: params.explorationId,
        taskTitle: params.taskTitle || "",
      },
      params.collectProfile ?? undefined
    );
    html = result.html;
    warnings.push(...result.warnings);
  }

  if (params.enableAiCompanion) {
    // 无条件注入当前版：入口 purifyExplorationHtml 已剥净（对纯净稿 no-op、对存量注入版剥旧），
    // 这里永远注入「当前代码」的伴学实现，代码侧修复即时对全部数据生效。
    // ⛔ DO NOT REVERT 回「版本号判断 + 快速路径放行」（2026-09 随版本号机制退役）：
    // 那条路径会放行库里存量的旧注入代码，伴学修复对存量数据永远不生效。
    const result = injectAiCompanion(html, { explorationId: params.explorationId });
    html = result.html;
    warnings.push(...result.warnings);
  }

  return { html, warnings };
}
