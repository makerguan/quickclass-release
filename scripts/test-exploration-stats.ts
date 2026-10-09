/**
 * 交互探究数据接入（学情分析 + 教研科研）回归测试
 *
 * 运行：npx tsx scripts/test-exploration-stats.ts
 *
 * 覆盖：
 *   1. 脱敏纯函数（maskStudentName）—— 隐私零泄漏契约
 *   2. 全班探究聚合（buildClassExplorationStats）—— 有探究 / 无探究两种场景
 *   3. 个人探究聚合（buildPersonalExplorationStats）—— 已提交 / 未提交两种场景
 *   4. 输出体量上限 —— 防止高频 ActionLog 击穿大模型 Token 窗口
 *   5. 提示词变量替换（{classExplorationStats} / {personalExplorationStats}）+ 老模板兜底追加
 *   6. 教研采集器（collectResearchData）—— exploration / explorationReport 两类新数据源
 *
 * 📐 CONTRACT: 任何一处断言失败即视为回归，不要改断言迁就实现。
 */
import { prisma } from "@/lib/prisma";
import {
  maskStudentName,
  buildClassExplorationStats,
  buildPersonalExplorationStats,
} from "@/lib/exploration/stats-aggregator";
import { collectResearchData, MAX_EXPLORATION_SUMMARY_CHARS } from "@/lib/research/data-collector";
import { replaceTaskVars } from "@/lib/prompts/insight";
import { renderInsightTemplate } from "@/lib/prompts/insight";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/**
 * 单课堂聚合输出体量上限：6000 字符，超出即视为聚合器未降维（把原始日志塞进来了）。
 * 🧪 MEASURED: 单个探究活动约 300 字符，6000 可容纳约 20 个探究活动（单课堂的真实上限），
 *   同时比"误塞原始日志"的规模（数万字符）低一个数量级，哨兵依然敏感。
 */
const MAX_SUMMARY_CHARS = 6000;

/**
 * 多课堂教研汇总上限：直接引用生产常量，杜绝测试与实现各写一套导致漂移。
 * ⛔ DO NOT HARDCODE：这里写死数值会在调整闸门后静默失效。
 */
const MAX_MULTI_TASK_CHARS = MAX_EXPLORATION_SUMMARY_CHARS;

async function main() {
  // ─────────────────────────────────────────────
  section("1. 脱敏纯函数（隐私零泄漏契约）");
  // ─────────────────────────────────────────────
  check("张三 -> 张同学", maskStudentName("张三") === "张同学", maskStudentName("张三"));
  check("欧阳娜娜 -> 欧同学", maskStudentName("欧阳娜娜") === "欧同学", maskStudentName("欧阳娜娜"));
  check("李 -> 李同学", maskStudentName("李") === "李同学", maskStudentName("李"));
  check("空串 -> 某同学", maskStudentName("") === "某同学");
  check("含空格 -> 去空格脱敏", maskStudentName(" 王小明 ") === "王同学", maskStudentName(" 王小明 "));

  // ─────────────────────────────────────────────
  section("2. 定位真实测试数据");
  // ─────────────────────────────────────────────
  const expWithData = await prisma.explorationActivity.findFirst({
    where: { enabled: true, ExplorationSubmission: { some: {} } },
    include: { SubProject: true },
  });
  if (!expWithData) {
    console.log("  ⚠ 数据库中无「含提交的启用探究」，跳过集成测试");
    return;
  }
  const taskId = expWithData.SubProject.taskId;
  console.log(`  课堂 ID: ${taskId}`);
  console.log(`  探究: ${expWithData.title}（子项目：${expWithData.SubProject.title}）`);

  const submission = await prisma.explorationSubmission.findFirst({
    where: { explorationId: expWithData.id },
  });
  if (!submission) throw new Error("探究提交缺失");
  const studentId = submission.studentId;
  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { name: true, classId: true } });
  console.log(`  学生: ${student?.name} (${studentId}) 班级: ${student?.classId}`);
  const classId = student?.classId || "";

  // 找一个没有探究的课堂做对照组
  const cleanTask = await prisma.learningTask.findFirst({
    where: { NOT: { id: taskId } },
    select: { id: true, title: true },
  });

  // ─────────────────────────────────────────────
  section("3. 全班探究聚合（课堂级 / 班级级）");
  // ─────────────────────────────────────────────
  const classStats = await buildClassExplorationStats(taskId, classId);
  console.log("  ── 输出预览 ──");
  console.log(classStats.split("\n").map((l) => `  | ${l}`).join("\n"));

  check("输出非空（有探究的课堂）", classStats.length > 0);
  check(
    `体量受控（${classStats.length} ≤ ${MAX_SUMMARY_CHARS}）`,
    classStats.length <= MAX_SUMMARY_CHARS,
    `实际 ${classStats.length} 字符`
  );
  check("含参与度", classStats.includes("参与度"));
  check("含探究投入（用时/交互）", classStats.includes("探究投入"));
  check("含子项目语义标题", classStats.includes(expWithData.SubProject.title));
  check(
    "评分型探究输出得分（hasScoring=true）",
    !classStats.includes("达成评分") || classStats.includes("得分"),
    "collectProfile.hasScoring=true 时应有得分行"
  );

  // ─────────────────────────────────────────────
  section("4. 全班探究聚合（教研模式：脱敏 + 跨班全量）");
  // ─────────────────────────────────────────────
  const researchStats = await buildClassExplorationStats(taskId, undefined, true);
  console.log("  ── 输出预览（脱敏）──");
  console.log(researchStats.split("\n").map((l) => `  | ${l}`).join("\n"));

  check("教研模式输出非空", researchStats.length > 0);
  check(
    `教研模式体量受控（${researchStats.length} ≤ ${MAX_SUMMARY_CHARS}）`,
    researchStats.length <= MAX_SUMMARY_CHARS
  );
  // 隐私零泄漏：所有 ≥2 字真实姓名不得出现。
  // ⚠️ GOTCHA: 只取「含中文」的姓名——库里存在纯数字测试账号（如 "14"），
  //   数字名与作答内容里的数值（口算答案 44/33 等）会字符串误撞，造成假阳性。
  const allStudentNames = (await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { name: true },
  }))
    .map((u) => u.name)
    .filter((n) => n && n.length >= 2 && /[\u4e00-\u9fa5]/.test(n));
  const leaked = allStudentNames.filter((n) => researchStats.includes(n));
  check(
    "教研模式无真实姓名泄漏（零容忍）",
    leaked.length === 0,
    leaked.length > 0 ? `泄漏：${leaked.join("、")}` : undefined
  );
  check("脱敏格式为 X同学", /同学/.test(researchStats) || !researchStats.includes("学生实验记录"), researchStats.slice(0, 200));

  // ─────────────────────────────────────────────
  section("5. 无探究课堂（优雅降级，不得报错）");
  // ─────────────────────────────────────────────
  if (cleanTask) {
    const emptyStats = await buildClassExplorationStats(cleanTask.id, undefined, true);
    check(`无探究课堂返回空串（${cleanTask.title}）`, emptyStats === "", `实际长度 ${emptyStats.length}`);
  }
  const ghostStats = await buildClassExplorationStats("不存在的课堂ID", undefined, true);
  check("不存在的课堂返回空串", ghostStats === "");

  // ─────────────────────────────────────────────
  section("6. 个人探究聚合");
  // ─────────────────────────────────────────────
  const personalStats = await buildPersonalExplorationStats(taskId, classId, studentId);
  console.log("  ── 输出预览 ──");
  console.log(personalStats.split("\n").map((l) => `  | ${l}`).join("\n"));

  check("个人输出非空", personalStats.length > 0);
  check(
    `个人体量受控（${personalStats.length} ≤ ${MAX_SUMMARY_CHARS}）`,
    personalStats.length <= MAX_SUMMARY_CHARS
  );
  check("标注已完成并提交", personalStats.includes("已完成并提交"));
  check("含探索时长", personalStats.includes("探索时长"));
  check("含操作路径特征", personalStats.includes("操作路径特征"));

  const ghostPersonal = await buildPersonalExplorationStats(taskId, classId, "不存在的学生ID");
  check("未提交学生标注未参与", ghostPersonal.includes("未提交/未参与"), ghostPersonal.slice(0, 120));

  // 老师端课堂学情（maskPrivacy=false）应保留真实姓名，与作业/对话数据口径一致
  const chineseNames = allStudentNames.filter((n) => /[\u4e00-\u9fa5]/.test(n));
  if (chineseNames.length > 0 && student?.name) {
    const teacherViewStats = await buildClassExplorationStats(taskId, classId, false);
    const keepsRealName = chineseNames.some((n) => teacherViewStats.includes(n));
    check(
      "老师端课堂学情保留真实姓名（maskPrivacy=false）",
      keepsRealName,
      `期望出现真实姓名（如 ${student.name}），实际：${teacherViewStats.slice(0, 300)}`
    );
    // 教研模式必须脱敏：同一份数据在 maskPrivacy=true 下不得出现真名
    const researchViewStats = await buildClassExplorationStats(taskId, classId, true);
    const leaksInResearch = chineseNames.filter((n) => researchViewStats.includes(n));
    check(
      "教研模式同一数据已脱敏（maskPrivacy=true）",
      leaksInResearch.length === 0,
      `泄漏：${leaksInResearch.join("、")}`
    );
  }

  // ─────────────────────────────────────────────
  section("7. 提示词变量替换与老模板兜底");
  // ─────────────────────────────────────────────
  const tplWithVars = "班级探究：{classExplorationStats}\n个人探究：{personalExplorationStats}";
  const replaced = replaceTaskVars(tplWithVars, {
    taskTitle: "T",
    taskObjectives: "O",
    taskRequirements: "R",
    pcClassInsights: [],
    pcStudentInsights: [],
    useSubInsights: false,
    classExplorationStats: "<<CLASS_EXP>>",
    personalExplorationStats: "<<PERSONAL_EXP>>",
  });
  check("{classExplorationStats} 被替换", replaced.includes("<<CLASS_EXP>>") && !replaced.includes("{classExplorationStats}"));
  check("{personalExplorationStats} 被替换", replaced.includes("<<PERSONAL_EXP>>") && !replaced.includes("{personalExplorationStats}"));

  // 老模板（不含占位符）走 renderInsightTemplate 兜底追加
  const oldTpl = "## 教师自定义分析模板\n请分析全班学情";
  const classRendered = renderInsightTemplate({
    templateContent: oldTpl,
    vars: {
      taskTitle: "T", taskObjectives: "O", taskRequirements: "R",
      pcClassInsights: [], pcStudentInsights: [], useSubInsights: false,
      classExplorationStats: "<<CLASS_EXP_FALLBACK>>",
    },
    level: "task",
    isStudent: false,
    constraints: {},
  });
  check("班级老模板兜底追加探究数据", classRendered.includes("<<CLASS_EXP_FALLBACK>>") && classRendered.includes("全班交互探究数据"));

  const studentRendered = renderInsightTemplate({
    templateContent: oldTpl,
    vars: {
      taskTitle: "T", taskObjectives: "O", taskRequirements: "R",
      pcClassInsights: [], pcStudentInsights: [], useSubInsights: false,
      personalExplorationStats: "<<PERSONAL_EXP_FALLBACK>>",
    },
    level: "task",
    isStudent: true,
    constraints: {},
  });
  check("学生老模板兜底追加探究数据", studentRendered.includes("<<PERSONAL_EXP_FALLBACK>>") && studentRendered.includes("个人交互探究数据"));

  // 有占位符时不重复追加（避免数据重复喂给模型）
  const withVarRendered = renderInsightTemplate({
    templateContent: "分析：{classExplorationStats}",
    vars: {
      taskTitle: "T", taskObjectives: "O", taskRequirements: "R",
      pcClassInsights: [], pcStudentInsights: [], useSubInsights: false,
      classExplorationStats: "<<ONCE>>",
    },
    level: "task",
    isStudent: false,
    constraints: {},
  });
  const occurrences = (withVarRendered.match(/<<ONCE>>/g) || []).length;
  check("模板已含占位符时不重复追加", occurrences === 1, `出现 ${occurrences} 次`);

  // ─────────────────────────────────────────────
  section("8. 教研采集器（新增两类数据源）");
  // ─────────────────────────────────────────────
  const teacher = await prisma.user.findFirst({ where: { role: "TEACHER" }, select: { id: true } });
  if (teacher) {
    const snapshot = await collectResearchData(teacher.id, [taskId], ["exploration", "explorationReport"]);
    const expData = snapshot.explorationData;
    check("exploration 数据源返回数据块", !!expData, JSON.stringify(expData).slice(0, 120));
    if (expData) {
      console.log(`  探究活动总数: ${expData.totalActivities}`);
      console.log("  ── 输出预览 ──");
      console.log(expData.summaryText.split("\n").map((l) => `  | ${l}`).slice(0, 20).join("\n"));
      check("summaryText 非空", expData.summaryText.length > 0);
      const leaked2 = allStudentNames.filter((n) => expData.summaryText.includes(n));
      check("教研快照无真实姓名泄漏", leaked2.length === 0, leaked2.join("、"));
    }
    check("explorationReport 不报错", Array.isArray(snapshot.explorationReports) || snapshot.explorationReports === undefined);
    console.log(`  探究报告数: ${snapshot.explorationReports?.length ?? 0}`);
    console.log(`  警告: ${JSON.stringify(snapshot.dataQuality.warnings)}`);

    // ── 多课堂全选场景：验证总量闸门生效（这是老师默认的创建方式）──
    const allTasks = await prisma.learningTask.findMany({
      where: { teacherId: teacher.id, status: "ENABLED" },
      select: { id: true, title: true },
    });
    const allTaskIds = allTasks.map((t) => t.id);
    console.log(`  全选课堂数: ${allTaskIds.length}`);
    const multiSnapshot = await collectResearchData(teacher.id, allTaskIds, ["exploration"]);
    const multiText = multiSnapshot.explorationData?.summaryText || "";
    console.log(`  多课堂摘要长度: ${multiText.length} 字符`);
    check(
      `多课堂全选摘要受闸门保护（${multiText.length} ≤ ${MAX_MULTI_TASK_CHARS}）`,
      multiText.length <= MAX_MULTI_TASK_CHARS,
      `实际 ${multiText.length} 字符，闸门失效`
    );
    check(
      "多课堂场景仍无中文姓名泄漏",
      allStudentNames.filter((n) => multiText.includes(n)).length === 0
    );
    if (multiSnapshot.dataQuality.warnings.length > 0) {
      console.log(`  多课堂警告: ${JSON.stringify(multiSnapshot.dataQuality.warnings)}`);
    }
  } else {
    console.log("  ⚠ 无教师账号，跳过教研采集器测试");
  }

  // ─────────────────────────────────────────────
  console.log(`\n${"=".repeat(46)}`);
  console.log(`测试完成：通过 ${passed} 项，失败 ${failed} 项`);
  console.log("=".repeat(46));

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("测试异常:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
