/**
 * 论文/课题方案生成后的质量检测（只警告不重试）。
 *
 * ⛔ DO NOT REVERT: 本模块阈值与 document-generator.ts 三份提示词（实践研究类/案例分析类/PROPOSAL）
 * 中的质量条款是一套契约，修改任一侧必须同步另一侧（见 document-generator.ts 顶部护栏注释）。
 * 🧪 MEASURED: AI 味阈值来源 = 真实期刊论文全量实证（2026-09 用户提供）：
 *   - AI 腔短语（综上所述/总而言之/值得注意的是/具有重要意义等）在真实期刊中 = 0 次
 *   - 空泛概念词（赋能/抓手/闭环等）全篇 ≤2 次
 *   - 朴素逻辑词 939 次 vs AI 过渡腔 17 次（真实期刊以朴素词推进）
 *
 * 设计约束：**只警告不重试**——8500 字重新生成一次成本远大于收益，论文本就是供作者编辑的初稿。
 * 检测结果写入 generationLog（持久化）+ 流末尾 [QUALITY_WARN] 输出（即时可见，与 [FATAL] 标记同构）。
 *
 * ⚠️ GOTCHA: 学科比例检测是粗粒度正则——只能识别文献标题中的显性学科词，
 * "学科相关但标题不含学科词"的文献会被漏判为不相关（低估比例），
 * 而"通用文献标题恰含宽学科词"会被误判为相关（如"科学思维"之于科学学科）。
 * warning 文案已写明"建议人工复核"，方向性正确优先于精确性。
 */

export interface QualityCheckInput {
  /** AI 生成的全文（含 SECTION/REFERENCES 标记） */
  fullText: string;
  /** dataSnapshot 中的真实学生姓名（≥2 字），用于姓名泄漏零容忍检测 */
  knownNames?: string[];
  /** 解析后的参考文献条目（content JSON 的 references 数组） */
  references?: string[];
  /** dataSnapshot.scope.subjectHints（data-collector 的 17 个学科关键词） */
  subjectHints?: string[];
  /** 解析后的摘要（content JSON 的 abstract 字段）——PAPER 传入，用于摘要字数检测 */
  abstract?: string;
}

// 🧪 MEASURED: AI 腔短语 = 0 次（真实期刊实证）
const AI_PHRASES = /(综上所述|总而言之|值得注意的是|具有重要意义|由此可见|更重要的是|与此同时|换句话说)/g;
// 🧪 MEASURED: 空泛概念词全篇 ≤2 次（真实期刊实证）
const VAGUE_WORDS = /(赋能|抓手|闭环|聚力|深耕|生态|落地|助力|凸显)/g;
// 归因严谨：用了"显著"但全文无统计检验描述
const SIGNIFICANT_RE = /显著(提升|提高|改善|降低|差异|优于)/;
const STATS_RE = /(p\s*[<＜]|t检验|ANOVA|效应量|Cohen|卡方|显著性水平|p\s*值)/;
// 成功叙事偏倚：通篇无任何局限/失败/异常表述
const LIMITATION_RE = /(未达|不足|局限|失败|意外|反常|下降|偏差|误答|错答)/;

// 学科词表：key = data-collector.ts subjectKeywords 归并后的规范名，
// value = 参考文献标题中的学科相关词正则。
// ⚠️ GOTCHA: 避免单字宽匹配（如物理的"力""电"会误中"努力""电脑"），一律用 ≥2 字学科词。
// ⚠️ GOTCHA: "信息技术"是旧课名兼容键——2022 课标改名"信息科技"后，旧快照 subjectHints
// 里存的仍是旧词，删旧键会让旧论文的学科比例检测静默跳过（find 不到 key 即不检测）。
const DISCIPLINE_WORDS: Record<string, RegExp> = {
  数学: /数学|几何|代数|统计与概率|数学通报|数学教育学报|中小学数学|数学教学|数学文化|数学思维/,
  语文: /语文|阅读教学|写作教学|识字|口语交际|汉字|作文教学|语文教学|中学语文|小学语文|古诗文|整本书阅读/,
  英语: /英语|外语|中小学外语教学|英语教学|外语界|英语课程标准|词汇教学|听说读写|英语阅读/,
  物理: /物理|力学|电学|电磁|热学|光学|物理教师|物理教学|物理实验|中学物理|物理概念/,
  化学: /化学|化学教学|化学实验|中学化学|化学反应|元素|化学教育|化学概念/,
  生物: /生物|生物学|生物教学|中学生物|细胞|遗传|实验教学|生物概念/,
  历史: /历史|历史教学|中学历史|历史课程|史料|历史教育|历史思维/,
  地理: /地理|地理教学|中学地理|地理课程|地图|自然地理|人文地理|地理实践力/,
  政治: /政治|思想政治|思想政治课|政治教学|中学政治|思政课/,
  科学: /科学课|科学教学|科学探究|小学科学|科学教育|科学素养|科学思维|探究式教学/,
  信息科技: /信息技术|信息科技|编程|计算思维|数字化|数字素养|人工智能|AI|计算机|算法|信息科技课程/,
  信息技术: /信息技术|信息科技|编程|计算思维|数字化|数字素养|人工智能|AI|计算机|算法|信息科技课程/,
  美术: /美术|美术教学|艺术教育|绘画|视觉艺术|审美|美术课程|美育/,
  音乐: /音乐|音乐教学|音乐课程|歌唱教学|节奏|音乐教育|美育/,
  体育: /体育|体育教学|体育与健康|运动技能|体能|体育课程|健康教育/,
  心理: /心理|心理健康|心理教育|心理咨询|积极心理|情绪调节|学习动机/,
  道德: /道德|道德与法治|德育|品德|思政|法治教育|价值观念/,
  法治: /法治|道德与法治|法律|宪法|规则意识|德育|法治教育/,
};

const VAGUE_THRESHOLD = 2;
const QUESTION_MIN = 2;
const NUMBER_MIN = 3;
const DISCIPLINE_RATIO_MIN = 0.8;
// 摘要字数硬性区间（含标点，不含空白）——期刊投稿常规要求，prompt 与检测共用
const ABSTRACT_MIN = 250;
const ABSTRACT_MAX = 320;

export function detectQualityWarnings(input: QualityCheckInput): string[] {
  const warnings: string[] = [];
  const { fullText, knownNames = [], references = [], subjectHints = [], abstract } = input;

  // ── 1. AI 腔短语：零容忍 ──
  const aiPhrases = fullText.match(AI_PHRASES) || [];
  if (aiPhrases.length > 0) {
    const counts = new Map<string, number>();
    for (const p of aiPhrases) counts.set(p, (counts.get(p) || 0) + 1);
    const detail = [...counts.entries()].map(([w, n]) => `"${w}"×${n}`).join("、");
    warnings.push(`AI 腔短语应为 0 次，实际检出：${detail}（真实期刊中这些短语出现率趋近 0）`);
  }

  // ── 2. 空泛概念词：全篇 ≤2 次 ──
  const vague = fullText.match(VAGUE_WORDS) || [];
  if (vague.length > VAGUE_THRESHOLD) {
    const counts = new Map<string, number>();
    for (const w of vague) counts.set(w, (counts.get(w) || 0) + 1);
    const detail = [...counts.entries()].map(([w, n]) => `"${w}"×${n}`).join("、");
    warnings.push(`空泛概念词应 ≤${VAGUE_THRESHOLD} 次，实际检出：${detail}（建议按替换表改写为具体表述）`);
  }

  // ── 3. 密度下限：问句 ≥2、数字 ≥3 ──
  const questions = (fullText.match(/[？?]/g) || []).length;
  if (questions < QUESTION_MIN) {
    warnings.push(`真实问句应 ≥${QUESTION_MIN} 处，实际仅 ${questions} 处（真实课堂论文平均每篇 40+ 个问句，缺失即疑似 AI 生成）`);
  }
  const numbers = (fullText.match(/\d+(\.\d+)?%?/g) || []).length;
  if (numbers < NUMBER_MIN) {
    warnings.push(`具体数字应 ≥${NUMBER_MIN} 处，实际仅 ${numbers} 处（课次/题号/正确率等具体量是真实论文的基本特征）`);
  }

  // ── 4. 归因严谨："显著"须有统计检验支撑 ──
  if (SIGNIFICANT_RE.test(fullText) && !STATS_RE.test(fullText)) {
    warnings.push(`使用了"显著提升/差异"但全文无统计检验描述（p 值/效应量等），属归因不严谨——建议改为具体幅度表述（如"提升 18 个百分点"）`);
  }

  // ── 5. 成功叙事偏倚 ──
  if (!LIMITATION_RE.test(fullText)) {
    warnings.push(`全文无任何局限/失败/异常分析，成功叙事偏倚——真实研究必有未达预期之处，可信度存疑`);
  }

  // ── 6. 学生姓名泄漏：零容忍（隐私问题） ──
  // ⚠️ GOTCHA: 只检测 ≥2 字姓名——"王同学"不含"王小明"三字连串，
  // 姓+同学脱敏格式天然不会误报；单字姓名（如"李"）会误匹配正文无数词，故跳过。
  for (const name of knownNames) {
    if (name && name.length >= 2 && fullText.includes(name)) {
      warnings.push(`正文出现真实学生姓名"${name}"，须脱敏为"${name[0]}同学"（隐私问题，必须修正）`);
    }
  }

  // ── 7. 参考文献学科相关性 ≥80% ──
  if (references.length > 0 && subjectHints.length > 0) {
    const subject = subjectHints.find((s) => DISCIPLINE_WORDS[s]);
    const re = subject ? DISCIPLINE_WORDS[subject] : null;
    if (re) {
      const hits = references.filter((r) => re.test(r)).length;
      const ratio = hits / references.length;
      if (ratio < DISCIPLINE_RATIO_MIN) {
        warnings.push(`参考文献学科相关性 ${(ratio * 100).toFixed(0)}%（${hits}/${references.length}，学科=${subject}），低于 80% 阈值——粗粒度检测可能低估，建议人工复核文献表学科构成`);
      }
    }
    // subjectHints 为空或词表未命中：跳过学科检测，不误报
  }

  // ── 8. 摘要字数硬性区间 250-320（含标点，不含空白） ──
  // 🔗 RELATED: document-generator.ts 两个 paper prompt 的「## 摘要（250-320字，硬性区间）」条款，
  // 改区间须同步 prompt 两处 + 此处。PROPOSAL 无摘要协议段，不传 abstract 即跳过。
  // ⚠️ GOTCHA: 口径 = 含标点去空白（期刊投稿系统通用口径），与 PROPOSAL 正文字数"纯中文"口径不同，勿统一。
  if (abstract !== undefined && abstract.trim().length > 0) {
    const abstractLen = abstract.replace(/\s/g, "").length;
    if (abstractLen < ABSTRACT_MIN || abstractLen > ABSTRACT_MAX) {
      warnings.push(`摘要字数 ${abstractLen} 字，超出 250-320 字硬性区间（含标点）——${abstractLen < ABSTRACT_MIN ? "信息量不足须扩充" : "须删减至区间内"}`);
    }
  }

  return warnings;
}

/**
 * 从 dataSnapshot 提取质量检测上下文（学生姓名 + 学科提示）。
 * 供 generate/route.ts 调用，避免 route 里散落 dataSnapshot 结构知识。
 * 🔗 RELATED: dataSnapshot 结构定义见 data-collector.ts 的 ResearchDataSnapshot。
 */
export function extractQualityContext(dataSnapshot: unknown): { knownNames: string[]; subjectHints: string[] } {
  const snap = (dataSnapshot || {}) as {
    quizData?: { attempts?: Array<{ studentName?: string }> };
    conversationData?: {
      conversations?: Array<{ studentName?: string }>;
      perPreset?: Array<{ topicSamples?: Array<{ studentName?: string }> }>;
    };
    scope?: { subjectHints?: string[] };
  };

  const names = new Set<string>();
  for (const a of snap.quizData?.attempts || []) {
    if (a.studentName && a.studentName.length >= 2) names.add(a.studentName);
  }
  for (const c of snap.conversationData?.conversations || []) {
    if (c.studentName && c.studentName.length >= 2) names.add(c.studentName);
  }
  for (const p of snap.conversationData?.perPreset || []) {
    for (const t of p.topicSamples || []) {
      if (t.studentName && t.studentName.length >= 2) names.add(t.studentName);
    }
  }

  return {
    knownNames: [...names],
    subjectHints: snap.scope?.subjectHints || [],
  };
}
