/**
 * 引用合理性审核模块
 *
 * 对正文中每条 [N] 引用，提取所在句子的核心论点，
 * 与参考文献的标题做语义匹配，判断引用是否合理。
 *
 * 流程：
 * 1. 扫描正文中所有 [N] 引用标记
 * 2. 提取 [N] 所在句子的上下文（前后各若干字符）
 * 3. 用 AI 判断该引用是否合理
 * 4. 输出每条引用的审核结果
 */

import { generateText } from "ai";
import { createDashScopeClient } from "@/lib/ai";
import { aiQueue } from "@/lib/ai-queue";

export type CitationStatus = "VERIFIED" | "SUSPICIOUS" | "UNVERIFIED";

export interface CitationValidationItem {
  /** 参考文献编号（重排后的新编号） */
  refIndex: number;
  /** 参考文献原文 */
  refRaw: string;
  /** 引用所在句子的上下文 */
  context: string;
  /** 审核结论 */
  status: CitationStatus;
  /** 人类可读的解释 */
  reason: string;
}

export interface CitationValidationReport {
  total: number;
  verified: number;
  suspicious: number;
  unverified: number;
  items: CitationValidationItem[];
  checkedAt: string;
}

/**
 * 从正文中提取所有 [N] 引用及其上下文
 */
function extractCitations(
  sections: { title: string; content: string }[],
  extras: string[] = [],
): { refIndex: number; context: string }[] {
  const citationMap = new Map<number, string>();

  const scanText = (text: string) => {
    const regex = /\[(\d+)\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const refIndex = parseInt(match[1], 10);
      if (isNaN(refIndex)) continue;
      // 提取 [N] 所在句子的上下文：前后各 60 个字符
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + match[0].length + 60);
      const context = text.slice(start, end).replace(/\s+/g, " ").trim();
      // 只保留第一次出现的位置（最早的上下文）
      if (!citationMap.has(refIndex)) {
        citationMap.set(refIndex, context);
      }
    }
  };

  for (const s of sections) {
    scanText(s.title);
    scanText(s.content);
  }
  for (const e of extras) {
    scanText(e);
  }

  return Array.from(citationMap.entries()).map(([refIndex, context]) => ({
    refIndex,
    context,
  }));
}

/**
 * 用 AI 批量判断引用是否合理
 *
 * 每次调用处理多条引用，减少 API 调用次数
 */
async function validateCitationsBatch(
  citations: { refIndex: number; context: string; refRaw: string }[],
): Promise<CitationValidationItem[]> {
  if (citations.length === 0) return [];

  const { chatModel } = await createDashScopeClient();

  // 构建批量审核 prompt
  const items = citations.map(
    (c, i) =>
      `引用 ${i + 1}：
- 参考文献编号：[${c.refIndex}]
- 参考文献标题：${c.refRaw.slice(0, 120)}
- 正文引用上下文：${c.context}`,
  );

  const prompt = `你是一位学术论文审稿专家。请判断以下每条引用是否合理——即正文中引用的内容是否与参考文献的主题相关。

判断标准：
- VERIFIED：正文引用上下文与参考文献标题明显相关，引用合理
- SUSPICIOUS：正文引用上下文与参考文献标题部分相关或无法确定，引用可疑
- UNVERIFIED：正文引用上下文与参考文献标题明显无关，引用不合理

请按以下 JSON 格式回复，不要包含其他内容：
{
  "results": [
    { "index": 1, "status": "VERIFIED", "reason": "简要说明判断理由" },
    ...
  ]
}

${items.join("\n\n")}`;

  const result = await aiQueue.enqueue(async () => {
    const res = await generateText({
      model: chatModel,
      prompt,
      temperature: 0.1,
      maxTokens: 2000,
    });
    return res.text;
  });

  // 解析 AI 返回的 JSON
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 返回格式异常");
    const parsed = JSON.parse(jsonMatch[0]);
    const results = parsed.results || [];

    return citations.map((c, i) => {
      const aiResult = results.find((r: any) => r.index === i + 1);
      const status: CitationStatus = aiResult?.status === "VERIFIED"
        ? "VERIFIED"
        : aiResult?.status === "SUSPICIOUS"
          ? "SUSPICIOUS"
          : "UNVERIFIED";
      return {
        refIndex: c.refIndex,
        refRaw: c.refRaw,
        context: c.context,
        status,
        reason: aiResult?.reason || "无法判断",
      };
    });
  } catch (e) {
    console.error("[citation-validator] AI 返回解析失败:", e);
    // 解析失败时全部标记为 UNVERIFIED
    return citations.map((c) => ({
      refIndex: c.refIndex,
      refRaw: c.refRaw,
      context: c.context,
      status: "UNVERIFIED" as CitationStatus,
      reason: "AI 审核解析失败，请人工核查",
    }));
  }
}

/**
 * 对论文/课题方案的正文引用进行合理性审核
 *
 * @param sections 正文章节
 * @param references 参考文献列表（已核查后的）
 * @param extras 额外文本（摘要、关键词等）
 * @returns 引用审核报告
 */
export async function validateCitations(
  sections: { title: string; content: string }[],
  references: string[],
  extras: string[] = [],
): Promise<CitationValidationReport> {
  // 1. 提取所有 [N] 引用及其上下文
  const extracted = extractCitations(sections, extras);

  if (extracted.length === 0) {
    return {
      total: 0,
      verified: 0,
      suspicious: 0,
      unverified: 0,
      items: [],
      checkedAt: new Date().toISOString(),
    };
  }

  // 2. 关联参考文献原文
  const citationsWithRefs = extracted
    .map((c) => {
      const refRaw = references[c.refIndex - 1] || `[${c.refIndex}] 未找到`;
      return { ...c, refRaw };
    })
    .filter((c) => c.refIndex <= references.length);

  // 3. 分批处理（每批最多 10 条，避免 AI 处理不过来）
  const BATCH_SIZE = 10;
  const batches: { refIndex: number; context: string; refRaw: string }[][] = [];
  for (let i = 0; i < citationsWithRefs.length; i += BATCH_SIZE) {
    batches.push(citationsWithRefs.slice(i, i + BATCH_SIZE));
  }

  const allItems: CitationValidationItem[] = [];
  for (const batch of batches) {
    const items = await validateCitationsBatch(batch);
    allItems.push(...items);
  }

  // 4. 统计
  const verified = allItems.filter((i) => i.status === "VERIFIED").length;
  const suspicious = allItems.filter((i) => i.status === "SUSPICIOUS").length;
  const unverified = allItems.filter((i) => i.status === "UNVERIFIED").length;

  return {
    total: allItems.length,
    verified,
    suspicious,
    unverified,
    items: allItems,
    checkedAt: new Date().toISOString(),
  };
}