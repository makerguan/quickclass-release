/**
 * 端到端管线验证：AI 写的分析模板能否真的分析出结果
 * 运行：npx tsx scripts/test-template-pipeline.ts
 *
 * 覆盖（全部调用真实生产函数，非 mock）：
 * A. 写模板端护栏 —— validateTemplateVariables（= analysis-templates/generate/route.ts 同款校验）
 * B. 运行时嗅探判定 —— 复刻 tasks/insights 与 quiz/report 两路由的 isHtmlOutput 逻辑（逐字相同）
 * C. 学情线提示词拼装 —— renderTaskClassTemplate / renderTaskStudentTemplate（真实函数）
 * D. 作业/探究线提示词拼装 —— 复刻 quiz 路由的变量替换 + buildChartPolicySection（真实函数）
 * E. 报告写库前渲染 —— cleanInsightContent / processChartBlocks / renderChart（真实函数）
 * F. 图表意图分流 —— buildChartPolicySection（真实函数）
 * G. 指数模式短路 —— buildConstraintsSection（真实函数）
 */
import {
  validateTemplateVariables,
  buildInsightVariableList,
  QUIZ_ANALYSIS_VARIABLES,
  EXPLORATION_ANALYSIS_VARIABLES,
} from "../src/lib/template-writing-guide";
import {
  renderTaskClassTemplate,
  renderTaskStudentTemplate,
  buildChartPolicySection,
  buildConstraintsSection,
  getDefaultConstraints,
} from "../src/lib/prompts/insight";
import type { TaskTemplateVars } from "../src/lib/prompts/insight";
import { cleanInsightContent } from "../src/lib/insight-clean";

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (detail ? ` | ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " | " + detail : ""}`); }
}

// ─────────────────────────────────────────────
// 代表性模板（按 template-writing-guide 写作规则应产出的形态）
// ─────────────────────────────────────────────
const CHART_EXAMPLE = '```chart\n{"type":"pie","title":"图表示例：各层级人数占比","data":[{"name":"优秀","value":10},{"name":"待提升","value":18}]}\n```';

/** 学情文本带图模板（class/task 级，仿 CLASS_INSIGHT_EXAMPLE：图表条目 + 末尾 chart 示例块） */
const insightTextWithChart = `你是该班级的学情分析教师，请基于以下信息生成全班学情分析报告，供授课教师调整教学使用。

## 课堂背景
- 课题：{taskTitle}（{taskGrade} · {taskSubject}）
- 课堂目标：{taskDescription}

## 数据输入
- 对话记录：{personalDialogContents}
- 全班作业数据：{classQuizStats}
- 全班探究数据：{classExplorationStats}

## 分析要求
1. 班级整体学习状态：结合 {classQuizStats} 概括整体掌握情况，指出讨论热点。
2. 共性问题：从作业数据与对话内容中汇总共性困难，按严重程度排序，每条注明数据依据。
3. 教学建议：针对共性问题给出可操作的教学调整建议。

## 输出要求
1. 插入 chart 块（type=bar）展示分数段人数分布（数据来源 {classQuizStats}，单位：人）
2. 每张图表下方附数据核对表（Markdown 表格，列名与图中数据一致）
3. 面向授课教师，先结论后依据；正文 600 字以内。

（模板要求了插图，按规则在末尾原样附 1 个 chart 协议示例块：）
${CHART_EXAMPLE}`;

/** 学情文本无图模板（输出要求含"禁止输出 chart 数据块"禁令——注意禁令本身含英文 chart） */
const insightTextNoChart = `你是该班级的学情分析教师，请基于以下信息生成全班学情分析报告。

## 分析要求
1. 结合 {classQuizStats} 概括整体掌握情况。
2. 指出共性困难，给出教学建议。

## 输出要求
1. 本报告为纯文本 Markdown 格式，数据一律以 Markdown 表格呈现，禁止输出 chart 数据块或任何 JSON 图表代码。
2. 正文 600 字以内。`;

/** 作业文本模板（纯中文，仿 QUIZ_ANALYSIS_EXAMPLE） */
const quizText = `## 重点关注
- 开头一句话点明{className}的{quizTitle}整体情况（平均{classAvgScore}，及格线{passScore}），先给结论再给依据
- 配一张雷达图展示{questionStats}中各考查维度的掌握度（把逐题正确率按知识点归并成 3-8 个维度，正确率取值 0-100）
- 结合 {questionStats} 的各题正确率先判断整体掌握情况，对正确率低于 60% 的考点归因到具体知识环节

## 分层关注
- 对 {lowScoreStudents} 中的学生：每人指出 1 个最可能的失分原因
- 对 {highScoreStudents} 中的学生：不重复表扬正确率，给出 1 个进阶学习方向

## 建议要求
- 每条建议写清"哪个知识点 + 用什么方式补 + 建议安排在哪个环节"

## 禁止行为
- 不要照抄数据，每个数据都要有解读
- 不要编造数据中没有的学生表现`;

/** 作业网页型模板（输出要求含 <!DOCTYPE html> 确定性触发词） */
const quizHtml = quizText + `\n\n## 输出要求\n报告以完整 HTML 文档输出（<!DOCTYPE html> 开头，样式内联，图表用纯 SVG 内联绘制，禁止引入任何外部 JS 图表库或 CDN 资源）`;

/** 探究文本模板（纯中文，仿 EXPLORATION_ANALYSIS_EXAMPLE） */
const explorationText = `## 重点关注
- 开头一句话概括{explorationTitle}的完成面：{submittedCount}/{totalStudents} 人提交、平均停留 {avgTimeSpent}、平均互动 {avgInteractions} 次
- 配一张柱状图展示{actionTypeStats}中各操作类型的占比
- 结合 {actionTypeStats} 分析探究习惯

## 分层关注
- 对表现优秀的学生：说明好在哪里
- 对有困难的学生：指出卡在哪个环节

## 建议要求
- 每条建议写清"调整哪个探究环节 + 怎么调"

## 禁止行为
- 不要只罗列数据不做解读`;

// ─────────────────────────────────────────────
// A. 写模板端护栏（与 analysis-templates/generate/route.ts 同款校验）
// ─────────────────────────────────────────────
console.log("== A. 变量校验护栏（AI 写模板端）==");
{
  const insightAllowed = buildInsightVariableList("class", "task").map((v) => v.name);
  const quizAllowed = QUIZ_ANALYSIS_VARIABLES.map((v) => v.name);
  const explorationAllowed = EXPLORATION_ANALYSIS_VARIABLES.map((v) => v.name);
  check("A1 学情带图模板变量全部合法", validateTemplateVariables(insightTextWithChart, insightAllowed).valid);
  check("A2 学情无图模板变量全部合法", validateTemplateVariables(insightTextNoChart, insightAllowed).valid);
  check("A3 作业文本模板变量全部合法", validateTemplateVariables(quizText, quizAllowed).valid);
  check("A4 作业网页模板变量全部合法", validateTemplateVariables(quizHtml, quizAllowed).valid);
  check("A5 探究模板变量全部合法", validateTemplateVariables(explorationText, explorationAllowed).valid);
  const bad = validateTemplateVariables("配一张图展示{notARealVar}的数据", insightAllowed);
  check("A6 越界变量会被拦截(护栏有效)", bad.valid === false && bad.invalid.includes("notARealVar"));
}

// 复刻 route.ts 的 isHtmlOutput 判定（已去掉 includes('chart') 嗅探）
const sniffHtml = (p: string | null): boolean =>
  p ? (
    p.includes("图表协议") ||
    p.includes("<!DOCTYPE") ||
    p.includes("<html") ||
    p.includes("<div") ||
    p.includes("echarts") ||
    p.includes("ECharts") ||
    p.toLowerCase().includes("html")
  ) : false;

// ─────────────────────────────────────────────
// B. 运行时嗅探判定（复刻两路由 isHtmlOutput，逐字相同）
// ─────────────────────────────────────────────
console.log("== B. 运行时嗅探判定 ==");
{
  check("B1 学情文本带图模板→判text(正确,不再因chart误判)", sniffHtml(insightTextWithChart) === false);
  check("B2 学情文本无图模板→判text(禁令含chart也不再误判)", sniffHtml(insightTextNoChart) === false);
  check("B3 作业文本模板→判text(正确)", sniffHtml(quizText) === false);
  check("B4 作业网页模板→判html(正确)", sniffHtml(quizHtml) === true);
  check("B5 探究文本模板→判text(正确)", sniffHtml(explorationText) === false);
}

// ─────────────────────────────────────────────
// C. 学情线提示词拼装（真实函数 renderTaskClassTemplate / renderTaskStudentTemplate）
// ─────────────────────────────────────────────
console.log("== C. 学情线提示词拼装 ==");
{
  const taskVars: TaskTemplateVars = {
    taskTitle: "分数与图形",
    taskObjectives: "掌握分数基本概念与图形分类",
    taskRequirements: "完成随堂练习与探究活动",
    pcClassInsights: [],
    pcStudentInsights: [],
    useSubInsights: false,
    classQuizStats: "## 作业完成情况\n\n### 随堂练习 - 第一单元\n- 班级平均分：85分\n- 完成率：42人\n- 各题正确率：基90%、进62%",
    classExplorationStats: "## 全班探究数据\n- 完成率：80%\n- 平均探索时长：6分\n- 操作特征：只看不写占比偏高",
    personalDialogContents: "（对话记录略）",
  };
  // HTML 输出模式场景（isHtmlOutput=true）：验证该分支的行为口径
  const promptHtml = renderTaskClassTemplate(insightTextWithChart, taskVars, getDefaultConstraints({ isHtmlOutput: true, classWordLimit: 2000 }));
  check("C1 模板正文进入提示词", promptHtml.includes("插入 chart 块（type=bar）"));
  check("C2 HTML 分支仍注入图表协议", promptHtml.includes("图表输出协议"));
  check("C3 HTML 分支跳过字数限制", !promptHtml.includes("字数限制"));
  check("C4 HTML 分支不强制输出整份HTML(只由输出格式决定)", !promptHtml.includes("直接输出完整的HTML内容"));
  check("C5 变量已替换为真实数据", !promptHtml.includes("{classQuizStats}") && promptHtml.includes("班级平均分：85分"));

  // 文本输出模式场景（isHtmlOutput=false）：当前 route.ts 对文本型带图模板的正确判定
  const promptText = renderTaskClassTemplate(insightTextWithChart, taskVars, getDefaultConstraints({ isHtmlOutput: false, classWordLimit: 2000 }));
  check("C6 正确文本分支含字数限制", promptText.includes("字数限制"));
  check("C7 正确文本分支仍注入图表协议", promptText.includes("图表输出协议"));
  check("C8 正确文本分支含输出格式规则", promptText.includes("输出格式规则"));

  // 用 route.ts 判定验证：文本型带图模板现在被判 text，既保留字数限制又保留图表协议
  const isHtmlForChartTemplate = sniffHtml(insightTextWithChart);
  const promptBySniff = renderTaskClassTemplate(insightTextWithChart, taskVars, getDefaultConstraints({ isHtmlOutput: isHtmlForChartTemplate, classWordLimit: 2000 }));
  check("C9 按当前嗅探判定:文本型带图模板保留字数限制", !isHtmlForChartTemplate && promptBySniff.includes("字数限制"));
  check("C10 按当前嗅探判定:文本型带图模板仍注入图表协议", !isHtmlForChartTemplate && promptBySniff.includes("图表输出协议"));

  // 学生级 HTML 分支：星星要求挂在 </body> 前
  const studentPrompt = renderTaskStudentTemplate(insightTextWithChart, { ...taskVars, studentName: "张三" }, getDefaultConstraints({ isHtmlOutput: true, studentWordLimit: 500 }));
  check("C11 学生HTML分支星星要求挂在 </body> 前", studentPrompt.includes("</body> 标签之前"));
}

// ─────────────────────────────────────────────
// D. 作业/探究线提示词拼装（逐字复制 route.ts 局部逻辑 + 真实 buildChartPolicySection）
// ─────────────────────────────────────────────
console.log("== D. 作业/探究线提示词拼装 ==");
{
  // ⚠️ replaceQuizAnalysisVars / 嗅探 / outputFormat 拼装是 quiz route.ts POST 函数内的局部逻辑，
  //    未导出、无法 import（导入会触发 NextRequest 运行时依赖）。以下实现逐字复制自
  //    route.ts:9-16（变量替换）、:126-137（嗅探，已去掉 includes('chart')）、:198-209（拼装），
  //    并已逐行与源核对一致。图表策略 buildChartPolicySection 是 import 的真实生产函数，与学情线共用。
  function replaceQuizAnalysisVars(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\{${escapedKey}}`, "g"), value || "无");
    }
    return result;
  }
  const quizVars = {
    quizTitle: "第一单元随堂练习", quizCount: "10", className: "三年级1班",
    totalStudents: "42", classSize: "45", classAvgScore: "85分", passScore: "60分",
    questionStats: "[基础] 3/5 的分数... 正确率90%\n[进阶] 图形分类... 正确率62%",
    weakQuestions: "图形分类...（62%）", lowScoreStudents: "李四（55分）",
    highScoreStudents: "张三（95分）", scoreDistribution: "90-100分：8人\n70-89分：25人",
    reportTime: "2026年10月14日 10:00",
  };
  const explorationVars = {
    explorationTitle: "图形规律探究", explorationDescription: "发现图形排列规律", className: "三年级1班",
    submittedCount: "38", totalStudents: "45", classAvgScore: "本探究无评分环节", scoreDistribution: "本探究无评分环节",
    submissionDetails: "张三：完成并给出结论...\n李四：未提交", actionTypeStats: "观看示范：60%\n动手尝试：35%\n只看不写：5%",
    avgTimeSpent: "6分", avgInteractions: "12次", qfAnswers: "张三：规律是每4个图形一循环", reportTime: "2026年10月14日 10:00",
  };
  // 复刻路由 outputFormat 分支
  function outputFormat(effectivePrompt: string | null, isHtml: boolean): string {
    if (isHtml) return "\n\n## 输出格式\n直接输出完整的HTML内容，所有图表用纯 SVG 内联绘制，禁止引入任何外部 JS 图表库或 CDN 资源，保存为 .html 后离线可完整打开。";
    return "\n\n## 字数限制\n整篇报告总字数控制在2000字以内。\n\n" + buildChartPolicySection(effectivePrompt ?? undefined) + "\n\n## 输出格式\n直接输出分析内容（Markdown格式），末尾另起一行输出综合评分：\n评分：★★★★★★";
  }

  const quizPromptText = replaceQuizAnalysisVars(quizText, quizVars) + outputFormat(quizText, false);
  check("D1 作业文本输出格式注入图表协议", outputFormat(quizText, false).includes("图表输出协议"));
  check("D2 作业文本不要求输出整份HTML", !quizPromptText.includes("直接输出完整的HTML内容"));
  check("D3 作业模板变量已替换", !quizPromptText.includes("{questionStats}") && quizPromptText.includes("图形分类... 正确率62%"));

  const quizPromptHtml = replaceQuizAnalysisVars(quizHtml, quizVars) + outputFormat(quizHtml, true);
  check("D4 作业网页输出格式要求整份HTML", quizPromptHtml.includes("直接输出完整的HTML内容"));

  const expPrompt = replaceQuizAnalysisVars(explorationText, explorationVars) + outputFormat(explorationText, false);
  check("D5 探究文本注入图表协议", outputFormat(explorationText, false).includes("图表输出协议"));
  check("D6 探究模板变量已替换", !expPrompt.includes("{actionTypeStats}") && expPrompt.includes("动手尝试：35%"));

  // 完整 prompt 拼装结构（route.ts:209: prompt = `${systemFrame}\n\n${dataSection}${templateSection}${outputFormat}`）
  const systemFrame = "你是一位资深学科教师，请根据以下班级的课堂作业答题数据，生成一份专业的班级学情分析报告。";
  const dataSection = ["## 检测信息", "作业名称：第一单元随堂练习", "班级：三年级1班", "## 各题正确率", "[基础] 3/5 的分数... 正确率90%\n[进阶] 图形分类... 正确率62%"].join("\n");
  const templateSection = `\n\n## 教师自定义分析要求\n${replaceQuizAnalysisVars(quizText, quizVars)}`;
  const fullPrompt = `${systemFrame}\n\n${dataSection}${templateSection}${outputFormat(quizText, false)}`;
  const idxFrame = fullPrompt.indexOf(systemFrame);
  const idxData = fullPrompt.indexOf("## 检测信息");
  const idxTemplate = fullPrompt.indexOf("## 教师自定义分析要求");
  const idxFormat = fullPrompt.indexOf("## 字数限制");
  check("D7 拼装顺序=系统框架→数据→模板→输出格式(route.ts:209)", idxFrame > -1 && idxFrame < idxData && idxData < idxTemplate && idxTemplate < idxFormat);
}

// ─────────────────────────────────────────────
// E. 报告写库前渲染（cleanInsightContent / processChartBlocks 真实函数）
// ─────────────────────────────────────────────
console.log("== E. 报告写库前渲染 ==");
{
  const aiReportMd = `## 整体情况
班级平均分 85 分，参与 42 人。

\`\`\`chart
{"type":"radar","title":"综合能力画像","data":[{"name":"参与度","value":80},{"name":"知识掌握","value":70},{"name":"探究表现","value":65},{"name":"学习态度","value":90}]}
\`\`\`

## 共性问题
图形分类掌握度偏低。

\`\`\`chart
{"type":"progress","title":"知识点正确率","data":[{"name":"分数概念","value":90},{"name":"图形分类","value":62}]}
\`\`\``;
  const cleanedMd = cleanInsightContent(aiReportMd);
  check("E1 chart 块全部渲染", !cleanedMd.includes("```chart"));
  check("E2 雷达图渲染出 SVG", cleanedMd.includes("<svg"));
  check("E3 Markdown 正文保留", cleanedMd.includes("## 整体情况"));

  const aiReportHtml = `这是三年级的HTML学情报告。

<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<h1>三年级学情报告</h1>
<p>班级平均分85分</p>
\`\`\`chart
{"type":"pie","title":"掌握程度构成","data":[{"name":"优秀","value":8},{"name":"良好","value":25},{"name":"待提升","value":9}]}
\`\`\`
</body></html>

报告结束。`;
  const cleanedHtml = cleanInsightContent(aiReportHtml);
  check("E4 HTML 报告截取到文档主体", cleanedHtml.startsWith("<!DOCTYPE html>") && cleanedHtml.endsWith("</html>"));
  check("E5 HTML 开场白已剔除", !cleanedHtml.includes("这是三年级的HTML学情报告"));
  check("E6 HTML 内图表已渲染", cleanedHtml.includes("<svg"));
}

// ─────────────────────────────────────────────
// F. 图表意图分流（buildChartPolicySection 真实函数）
// ─────────────────────────────────────────────
console.log("== F. 图表意图分流 ==");
{
  check("F1 含'雷达图'意图→注入协议", buildChartPolicySection("配一张雷达图展示{questionStats}中各考查维度的掌握度").includes("图表输出协议"));
  check("F2 无图纯文本→注入禁令", buildChartPolicySection("数据一律以 Markdown 表格呈现。").includes("图表输出禁令"));
  const ban = buildChartPolicySection("数据一律以 Markdown 表格呈现，禁止输出图表代码块。");
  check("F3 含'图表'字样的禁令→注入协议(容忍设计)", ban.includes("图表输出协议"));
  check("F4 协议首句守卫约束不画图", ban.includes("仅当教师模板"));
}

// ─────────────────────────────────────────────
// G. 指数模式短路（buildConstraintsSection 真实函数）
// ─────────────────────────────────────────────
console.log("== G. 指数模式短路 ==");
{
  const star = buildConstraintsSection("student", getDefaultConstraints({ requireStarRating: true, isHtmlOutput: true }), insightTextWithChart);
  check("G1 指数模式优先于 HTML 分支短路", star.includes("只做指数评分") && !star.includes("图表输出协议"));
}

// ─────────────────────────────────────────────
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) { console.log("失败项:\n" + fails.join("\n")); process.exit(1); }
