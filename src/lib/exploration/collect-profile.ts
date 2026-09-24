import { prisma } from "@/lib/prisma";
import { createDashScopeClient } from "@/lib/ai";
import { generateText } from "ai";
import { detectInstrumentation } from "@/lib/prompts/exploration-submit";

/**
 * 探究「采集类别清单」（Collect Profile）
 *
 * 启用提交时，先分析 HTML 决定「采哪些数据」，再按清单注入采集逻辑：
 *   - hasScoring：页面有没有「评分/计分」环节（分数、闯关得分、答题对错、评级等）。
 *                 无评分页面（纯探索/模拟/观察）不采分数，提交时 score 记 null。
 *   - hasFormControls：页面有没有标准可填控件（input/select/textarea）→ 决定是否扫描控件答案。
 *   - hasCanvas：页面有没有 <canvas> → 决定是否做画布快照。
 *
 * 为什么 hasScoring 用 AI 语义判断，而 hasFormControls/hasCanvas 用正则：
 *   - 「有没有评分环节」是语义概念（要看页面是不是在给学生打分），正则只能猜文本/变量名，
 *     易漏（自定义计分变量）也易误（页面文案带"得分"二字但无真实计分），必须 AI 判断。
 *   - 「有没有 input/canvas」是明确的 DOM 标签，正则 100% 准确，交给 AI 反而不稳。
 *
 * AI 不可用 / 失败时，用 detectCollectProfile 的正则结果兜底（偏保守，避免漏采真实分数）。
 */
export interface CollectProfile {
  hasScoring: boolean;
  hasFormControls: boolean;
  hasCanvas: boolean;
}

/**
 * 确定性检测（AI 不可用/失败时的兜底，也是 AI 结果的基座：后两项直接取这里）
 *
 * ⚠️ GOTCHA：必须在「注入前」的原始 HTML（或 AI 契约桩改造后的 HTML）上跑，
 * 不能在已注入提交功能的 HTML 上跑——注入的 basicTrackingScript 自带 `score: 0` 字样，
 * 会把无评分页面误判为有评分。
 */
export function detectCollectProfile(html: string): CollectProfile {
  const det = detectInstrumentation(html);

  // 评分信号的确定性证据，三条命中任一即视为「可能有评分」（兜底偏保守，宁多采不漏采）：
  //   1) 防御式/裸调用了 updateScore / setGameLevel（闯关计分型才会调）；
  //   2) 契约桩里给 __gameState__.score 赋值（.score= 或 ["score"]=）；
  //   3) 页面文案出现评分词（得分/分数/成绩/积分/满分/答对/答错/正确率）。
  const scoringCall =
    /typeof\s+(updateScore|setGameLevel)\s*===?\s*["']function["']/.test(html) ||
    /(?<!typeof\s)\b(updateScore|setGameLevel)\s*\(/.test(html);
  const scoreAssign = /__gameState__\s*(\.\s*score\s*=|\[\s*["']score["']\s*\]\s*=)/.test(html);
  const scoreText = /(得分|分数|成绩|积分|满分|答对|答错|正确率)/.test(html);

  return {
    hasScoring: scoringCall || scoreAssign || scoreText,
    hasFormControls: /<(input|select|textarea)\b/i.test(html),
    hasCanvas: /<canvas\b/i.test(html),
  };
}

/**
 * AI 语义分析：判断页面有没有「评分/计分」环节（主通道）。
 * 成功返回 CollectProfile，失败（无 API Key / 解析失败 / 超时异常）返回 null，调用方走 detectCollectProfile 兜底。
 */
export async function analyzeCollectProfileWithAi(html: string): Promise<CollectProfile | null> {
  try {
    const config = await prisma.systemConfig.findFirst();
    if (!config?.aiApiKey) return null;

    const prompt =
      "分析下面这个「互动探究」网页，判断它是否包含【评分/计分】环节。\n" +
      "有评分：页面会给学生打分/计分/评级/排名——例如做题得分、选择题判断题计分、闯关得分、答对得分、星级评分、得分榜、正确率、成绩等。\n" +
      "无评分：纯探索/观察/模拟类页面——学生只是拖参数、点按钮、观察现象、看图形变化，页面不给分数，也没有\"得分\"概念。\n" +
      "判断依据是页面是否存在\"给学生打分的机制\"，而不是页面文案里是否恰好出现\"分\"字。\n\n" +
      "只输出一个 JSON，不要任何额外文字：\n" +
      '{"hasScoring": true 或 false}\n\n' +
      "HTML 内容：\n" +
      html.substring(0, 8000);

    const { chatModel } = await createDashScopeClient();
    const { text } = await generateText({
      model: chatModel,
      system: "你是一个 HTML 交互分析助手，擅长判断网页是否存在评分/计分机制。",
      prompt,
      temperature: 0.1,
    });

    // 解析 JSON（AI 可能包裹 ```json 或前后有多余文字）
    let parsed: { hasScoring?: boolean } | null = null;
    try {
      parsed = JSON.parse(text.replace(/```json\n?|```\n?/g, "").trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed || typeof parsed.hasScoring !== "boolean") return null;

    return {
      hasScoring: parsed.hasScoring,
      hasFormControls: /<(input|select|textarea)\b/i.test(html),
      hasCanvas: /<canvas\b/i.test(html),
    };
  } catch {
    return null;
  }
}

/** 序列化/反序列化（存 ExplorationActivity.collectProfile 字段用） */
export function stringifyCollectProfile(profile: CollectProfile): string {
  return JSON.stringify(profile);
}

export function parseCollectProfile(json: string | null | undefined): CollectProfile | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (p && typeof p === "object" && typeof p.hasScoring === "boolean") {
      return {
        hasScoring: p.hasScoring === true,
        hasFormControls: p.hasFormControls === true,
        hasCanvas: p.hasCanvas === true,
      };
    }
    return null;
  } catch {
    return null;
  }
}
