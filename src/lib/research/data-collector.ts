import { prisma } from "@/lib/prisma";
import { buildClassExplorationStats } from "@/lib/exploration/stats-aggregator";
import { extractMessageText } from "@/lib/message-content";

/**
 * 6 类数据类型
 * - quiz: 作业数据（所有学生的 QuizAttempt + QuestionAttempt）
 * - conversation: 对话数据（所有学生的 Conversation + Message）
 * - quizReport: 作业报告（班级 AIInsight，type=quiz_class）
 * - conversationReport: 对话报告（班级 AIInsight，type=pc_class）
 * - exploration: 交互探究数据（所有学生的 ExplorationSubmission + 表单结论脱敏摘要）
 * - explorationReport: 探究报告（各探究活动的 AI 班级学情诊断报告）
 */
export type ResearchDataType = "quiz" | "conversation" | "quizReport" | "conversationReport" | "exploration" | "explorationReport";

export interface ResearchDataTypeOption {
  value: ResearchDataType;
  label: string;
  description: string;
  icon: string;
}

/**
 * 教研探究摘要总量闸门（字符数）。
 *
 * 🧪 MEASURED: 单个探究活动摘要约 300 字符（实测「口算」= 279 字符，22 条操作日志聚合而来）。
 * 📐 CONTRACT: 老师创建课题时可多选课堂（前端默认全选），摘要按课堂线性累加；
 *   本闸门给累加设硬顶，超出部分按课堂整块跳过并写入 dataQuality.warnings 告知老师。
 *   取值依据（2026-09-28 校准）：模型上下文 deepseek-flash 为 64K tokens，Prompt 由
 *   「对话+作业+探究+模板」共享，且论文输出还需 8500-10000 字（约 10000 tokens）。
 *   12000 字符 ≈ 12000 tokens，占 64K 窗口约 19%，可容纳约 40 个探究活动
 *   （真实场景：课题通常选 3-5 个课堂 × 3-5 个探究 = 15-25 个活动，约 4500-7500 字符），
 *   既不会误触发"未纳入"警告，又为对话/作业数据留足预算。
 * ⛔ DO NOT REVERT: 去掉此闸门会让长尾课堂撑爆 Prompt，导致整篇论文生成失败；
 *   也不要无节制上调——超过 20000 后，叠加对话全量数据会有超窗风险。
 * 🔗 RELATED: scripts/test-exploration-stats.ts 直接 import 本常量做断言（勿在测试里另写死值）。
 */
export const MAX_EXPLORATION_SUMMARY_CHARS = 12000;

export const RESEARCH_DATA_TYPE_OPTIONS: ResearchDataTypeOption[] = [
  {
    value: "quiz",
    label: "作业数据",
    description: "所有学生的作业答题记录（QuizAttempt + QuestionAttempt）",
    icon: "📝",
  },
  {
    value: "conversation",
    label: "对话数据",
    description: "所有学生与 AI 的对话内容（Conversation + Message）",
    icon: "💬",
  },
  {
    value: "exploration",
    label: "交互探究数据",
    description: "学生在虚拟仿真、交互实验中的操作频次、探索时长与探究结论（已安全脱敏）",
    icon: "🔬",
  },
  {
    value: "quizReport",
    label: "作业报告",
    description: "所有选中课堂中所有作业的 AI 班级分析报告（统计信息已包含在报告内）",
    icon: "📊",
  },
  {
    value: "conversationReport",
    label: "对话报告",
    description: "所有选中课堂中所有对话活动的 AI 班级分析报告",
    icon: "📑",
  },
  {
    value: "explorationReport",
    label: "探究报告",
    description: "所有选中课堂中交互探究活动的 AI 班级学情诊断报告",
    icon: "📈",
  },
];

export interface ResearchDataSnapshot {
  // 范围信息（总是返回，无论勾选哪些数据）
  scope: {
    taskIds: string[];
    taskTitles: string[];
    classNames: string[];
    studentCount: number;
    selectedDataTypes: ResearchDataType[];
    /** 学科 hint（从任务标题+教师关键字中提取的学科列表） */
    subjectHints: string[];
  };
  /** 作业数据：所有学生的 QuizAttempt + QuestionAttempt 详情 */
  quizData?: {
    totalAttempts: number;
    completedAttempts: number;
    incompleteAttempts: number;
    perQuizStats: Array<{
      quizId: string;
      quizTitle: string;
      subProjectTitle: string;
      taskTitle: string;
      questionCount: number;
      totalSubmissions: number;
      completionRate: number;     // 0-100
      avgScorePercent: number;     // 0-100
      passScore: number;
      passRate: number;           // 0-100
      scoreDistribution: { excellent: number; good: number; average: number; poor: number };
      questionStats: Array<{
        type: string;
        content: string;
        correctRate: number;
      }>;
    }>;
    attempts: Array<{
      studentName: string;
      quizTitle: string;
      scorePercent: number;
      correctCount: number;
      totalQuestions: number;
      submittedAt: string;
    }>;
  };
  /** 对话数据：所有学生的 Conversation + Message 详情 */
  conversationData?: {
    totalConversations: number;
    totalMessages: number;
    perPreset: Array<{
      presetTitle: string;
      conversationCount: number;
      messageCount: number;
      topicSamples: Array<{
        studentName: string;
        title: string;
        messageCount: number;
      }>;
    }>;
    conversations: Array<{
      studentName: string;
      title: string;
      presetTitle?: string;
      messageCount: number;
      messages: Array<{ role: string; content: string }>;
    }>;
  };
  /** 作业报告：班级 AIInsight (type=quiz_class)，可作为研究素材 */
  quizReports?: Array<{
    quizId: string;
    quizTitle: string;
    subProjectTitle: string;
    taskTitle: string;
    version: number;
    content: string;
    createdAt: string;
    /** 报告对应的统计快照（防止报告生成后数据被修改） */
    stats: {
      participantCount: number;
      completionRate: number;
      passRate: number;
      avgScorePercent: number;
    };
  }>;
  /** 对话报告：班级 AIInsight (type=pc_class) */
  conversationReports?: Array<{
    presetId: string;
    presetTitle: string;
    subProjectTitle: string;
    taskTitle: string;
    version: number;
    content: string;
    createdAt: string;
    conversationCount: number;
  }>;
  /** 交互探究数据：所有学生的探究参与度、探索时长、动作特征与脱敏结论摘要 */
  explorationData?: {
    totalActivities: number;
    summaryText: string;
  };
  /** 探究报告：各探究活动已生成的 AI 分析报告 */
  explorationReports?: Array<{
    explorationId: string;
    explorationTitle: string;
    subProjectTitle: string;
    taskTitle: string;
    content: string;
    createdAt: string;
  }>;
  /** 数据质量/警告 */
  dataQuality: {
    warnings: string[];
    missingReports?: {
      quizzesWithoutReport: string[];     // 没有 AIInsight 报告的作业标题
      conversationsWithoutReport: string[]; // 没有 AIInsight 报告的对话活动标题
      explorationsWithoutReport?: string[]; // 没有 AI 分析报告的探究活动标题
    };
  };
}

/**
 * 收集研究数据
 * @param teacherId 教师 ID
 * @param selectedTaskIds 选中的课堂 ID 列表（空数组表示无）
 * @param dataTypes 选中的数据类型（至少一项）
 */
export async function collectResearchData(
  teacherId: string,
  selectedTaskIds: string[],
  dataTypes: ResearchDataType[]
): Promise<ResearchDataSnapshot> {
  const warnings: string[] = [];

  // 1. 基础：选中课堂 + 子项目 + 班级
  const tasks = await prisma.learningTask.findMany({
    where: {
      teacherId,
      id: selectedTaskIds.length > 0 ? { in: selectedTaskIds } : undefined,
      status: "ENABLED",
    },
    include: {
      subProjects: { include: { PresetConversation: true } },
      assignments: { include: { class: { include: { User_User_classIdToClass: true } } } },
    },
  });

  if (tasks.length === 0) {
    return {
      scope: { taskIds: [], taskTitles: [], classNames: [], studentCount: 0, selectedDataTypes: dataTypes, subjectHints: [] },
      dataQuality: { warnings: ["未选择课堂或所选课堂无启用数据"] },
    };
  }

  const taskIds = tasks.map((t) => t.id);
  const subProjectIds = tasks.flatMap((t) => t.subProjects.map((sp) => sp.id));
  const classIds = [...new Set(tasks.flatMap((t) => t.assignments?.map((a) => a.classId).filter(Boolean) || []))];
  const allStudents = new Map<string, { name: string; classId: string }>();
  for (const t of tasks) {
    for (const a of t.assignments || []) {
      for (const u of a.class?.User_User_classIdToClass || []) {
        if (!allStudents.has(u.id)) allStudents.set(u.id, { name: u.name, classId: a.classId });
      }
    }
  }
  const studentIds = [...allStudents.keys()];

  // 提取学科 hints（从任务标题和教师关键字）
  // ⚠️ GOTCHA: "信息技术"与"信息科技"都收录——2022 版课标改名后新旧课名并存于历史任务标题，
  // 只收一个会漏提取；提取后统一归并为规范名"信息科技"（见下方 ALIAS 归并）。
  // 🔗 RELATED: 归并后的规范名被 reference-fetcher.ts SUBJECT_QUERY_TERMS/SUBJECT_TITLE_RE、
  // quality-check.ts DISCIPLINE_WORDS 按 key 消费，三处词表必须与本列表同步。
  const subjectKeywords = [
    "数学", "语文", "英语", "物理", "化学", "生物",
    "历史", "地理", "政治", "科学", "信息技术", "信息科技", "美术", "音乐",
    "体育", "心理", "道德", "法治",
  ];
  // 旧课名 → 规范名（2022 版义务教育课程方案：信息技术 → 信息科技）
  const SUBJECT_ALIAS: Record<string, string> = { 信息技术: "信息科技" };
  const subjectHints = new Set<string>();
  for (const t of tasks) {
    for (const subj of subjectKeywords) {
      if (t.title && t.title.includes(subj)) subjectHints.add(SUBJECT_ALIAS[subj] || subj);
    }
  }

  const scope: ResearchDataSnapshot["scope"] = {
    taskIds,
    taskTitles: tasks.map((t) => t.title),
    classNames: [...new Set(tasks.flatMap((t) => t.assignments?.map((a) => String(a.class?.name || "")).filter(Boolean) || []))] as string[],
    studentCount: studentIds.length,
    selectedDataTypes: dataTypes,
    subjectHints: Array.from(subjectHints),
  };

  // 2. 条件性收集：作业数据
  let quizData: ResearchDataSnapshot["quizData"];
  if (dataTypes.includes("quiz")) {
    const quizzes = await prisma.quizActivity.findMany({
      where: { subProjectId: { in: subProjectIds } },
      include: {
        SubProject: { include: { task: { select: { id: true, title: true } } } },
        Question: true,
        QuizAttempt: { include: { User: true, QuestionAttempt: true } },
      },
    });

    const perQuizStats = quizzes.map((q) => {
      const completedAttempts = q.QuizAttempt.filter((a) => (a.score ?? 0) >= 0);
      const totalSubmissions = q.QuizAttempt.length;
      const completedFull = q.QuizAttempt.filter(
        (a) => a.QuestionAttempt.length === q.Question.length
      ).length;
      const completionRate = totalSubmissions > 0 ? Math.round((completedFull / totalSubmissions) * 100) : 0;
      const passScore = q.passScore ?? 60;
      const passCount = completedFull > 0 ? q.QuizAttempt.filter((a) => (a.score ?? 0) >= passScore).length : 0;
      const passRate = completedFull > 0 ? Math.round((passCount / completedFull) * 100) : 0;
      const avgScorePercent =
        completedFull > 0
          ? Math.round(q.QuizAttempt.reduce((s, a) => s + (a.score ?? 0), 0) / completedFull)
          : 0;

      const dist = { excellent: 0, good: 0, average: 0, poor: 0 };
      for (const a of q.QuizAttempt) {
        const pct = a.score ?? 0;
        if (pct >= 90) dist.excellent++;
        else if (pct >= 75) dist.good++;
        else if (pct >= 60) dist.average++;
        else dist.poor++;
      }

      const questionStats = q.Question.map((qq) => {
        const answered = q.QuizAttempt.flatMap((a) => a.QuestionAttempt.filter((ans) => ans.questionId === qq.id));
        const correct = answered.filter((a) => a.isCorrect).length;
        return {
          type: qq.type,
          content: qq.content,
          correctRate: answered.length > 0 ? Math.round((correct / answered.length) * 100) : 0,
        };
      });

      return {
        quizId: q.id,
        quizTitle: q.title,
        subProjectTitle: q.SubProject?.title || "",
        taskTitle: q.SubProject?.task?.title || "",
        questionCount: q.Question.length,
        totalSubmissions,
        completionRate,
        avgScorePercent,
        passScore,
        passRate,
        scoreDistribution: dist,
        questionStats,
      };
    });

    // 取最近 50 条 attempt 作为代表样本
    const allAttempts = quizzes.flatMap((q) =>
      q.QuizAttempt.map((a) => ({
        studentName: a.User?.name || "未知",
        quizTitle: q.title,
        scorePercent: a.score ?? 0,
        correctCount: a.correctCount ?? 0,
        totalQuestions: a.totalQuestions ?? q.Question.length,
        submittedAt: a.submittedAt?.toISOString() || "",
      }))
    ).slice(0, 50);

    quizData = {
      totalAttempts: allAttempts.length,
      completedAttempts: allAttempts.filter((a) => a.totalQuestions > 0).length,
      incompleteAttempts: 0,
      perQuizStats,
      attempts: allAttempts,
    };

    if (perQuizStats.length === 0) warnings.push("所选课堂中暂无可统计的作业");
  }

  // 3. 条件性收集：对话数据
  let conversationData: ResearchDataSnapshot["conversationData"];
  if (dataTypes.includes("conversation")) {
    const conversations = await prisma.conversation.findMany({
      where: {
        classId: { in: classIds },
        // 如果选了 preset，则按 preset 过滤
      },
      include: {
        Message: { orderBy: { createdAt: "asc" } },
        User: { select: { id: true, name: true } },
        PresetConversation: { select: { id: true, title: true, subProjectId: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // 按 preset 分组
    const presetMap = new Map<string, {
      presetTitle: string;
      conversationCount: number;
      messageCount: number;
      topicSamples: Array<{ studentName: string; title: string; messageCount: number }>;
    }>();
    const allConvData: NonNullable<ResearchDataSnapshot["conversationData"]>["conversations"] = [];

    for (const c of conversations) {
      const presetTitle = c.PresetConversation?.title || "(无预设)";

      // 收集对话内容（不收集全部消息，只取前 30 条做摘要）
      // 2026-10-15：语音消息只取转写文字（剥离音频/图片 base64），分析忽略声音文件
      const messages = c.Message.map((m) => ({ role: m.role, content: extractMessageText(m.content) }));
      const messageSnippets = messages.slice(0, 6).map((m) => ({
        role: m.role,
        contentSnippet: m.content.slice(0, 120),
      }));

      const group = presetMap.get(presetTitle) || {
        presetTitle,
        conversationCount: 0,
        messageCount: 0,
        topicSamples: [],
      };
      group.conversationCount++;
      group.messageCount += c.Message.length;
      if (group.topicSamples.length < 5) {
        group.topicSamples.push({
          studentName: c.User?.name || "未知",
          title: c.title,
          messageCount: c.Message.length,
        });
      }
      presetMap.set(presetTitle, group);

      // 全量收集对话原文（不再限制前 20 个；超限时由 document-generator 抽样降级保护）
      allConvData.push({
        studentName: c.User?.name || "未知",
        title: c.title,
        presetTitle,
        messageCount: c.Message.length,
        messages,
      });
    }

    conversationData = {
      totalConversations: conversations.length,
      totalMessages: conversations.reduce((s, c) => s + c.Message.length, 0),
      perPreset: [...presetMap.values()],
      conversations: allConvData,
    };

    if (conversations.length === 0) warnings.push("所选课堂中暂无学生对话数据");
  }

  // 4. 条件性收集：作业报告（AIInsight type=quiz_class）
  let quizReports: ResearchDataSnapshot["quizReports"];
  let missingReports: string[] = [];
  if (dataTypes.includes("quizReport")) {
    const quizIdsForReport = await prisma.quizActivity.findMany({
      where: { subProjectId: { in: subProjectIds } },
      select: { id: true, title: true, SubProject: { include: { task: { select: { title: true } } } } },
    });
    const reports = await prisma.aIInsight.findMany({
      where: {
        type: "quiz_class",
        scopeId: { in: quizIdsForReport.map((q) => q.id) },
      },
      orderBy: { version: "desc" },
    });

    // 取每个 quiz 的最新版本
    const latestMap = new Map<string, typeof reports[0]>();
    for (const r of reports) {
      if (r.scopeId && !latestMap.has(r.scopeId)) latestMap.set(r.scopeId, r);
    }

    const quizList = quizIdsForReport.filter((q) => latestMap.has(q.id));

    quizReports = quizList.map((q) => {
      const r = latestMap.get(q.id)!;
      const stats = quizData?.perQuizStats.find((s) => s.quizId === q.id);
      return {
        quizId: q.id,
        quizTitle: q.title,
        subProjectTitle: q.SubProject?.title || "",
        taskTitle: q.SubProject?.task?.title || "",
        version: r.version,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        stats: {
          participantCount: stats?.totalSubmissions ?? 0,
          completionRate: stats?.completionRate ?? 0,
          passRate: stats?.passRate ?? 0,
          avgScorePercent: stats?.avgScorePercent ?? 0,
        },
      };
    });

    // 缺失报告的作业
    const quizIdsWithReports = new Set(quizReports.map((r) => r.quizId));
    for (const q of quizIdsForReport) {
      if (!quizIdsWithReports.has(q.id)) {
        missingReports.push(`${q.SubProject?.task?.title || ""} - ${q.title}`);
      }
    }
    if (missingReports.length > 0) {
      warnings.push(`共 ${missingReports.length} 个作业尚未生成 AI 报告，建议先到课堂→作业→报告页生成`);
    }
  }

  // 5. 条件性收集：对话报告（AIInsight type=pc_class）
  let conversationReports: ResearchDataSnapshot["conversationReports"];
  let conversationsWithoutReport: string[] = [];
  if (dataTypes.includes("conversationReport")) {
    // 找出所有 preset conversations 的 id
    const presetIds = tasks.flatMap((t) =>
      t.subProjects.flatMap((sp) => (sp.PresetConversation || []).map((p) => p.id))
    );
    if (presetIds.length > 0) {
      const reports = await prisma.aIInsight.findMany({
        where: {
          type: "pc_class",
          scopeId: { in: presetIds },
        },
        orderBy: { version: "desc" },
      });

      const latestMap = new Map<string, typeof reports[0]>();
      for (const r of reports) {
        if (r.scopeId && !latestMap.has(r.scopeId)) latestMap.set(r.scopeId, r);
      }

      const presets = await prisma.presetConversation.findMany({
        where: { id: { in: [...latestMap.keys()] } },
        include: {
          SubProject: {
            include: { task: { select: { title: true } } },
          },
          _count: { select: { Conversation: true } },
        },
      });

      conversationReports = presets.map((p) => {
        const r = latestMap.get(p.id)!;
        return {
          presetId: p.id,
          presetTitle: p.title,
          subProjectTitle: p.SubProject?.title || "",
          taskTitle: p.SubProject?.task?.title || "",
          version: r.version,
          content: r.content,
          createdAt: r.createdAt.toISOString(),
          conversationCount: p._count.Conversation,
        };
      });

      const reportedPresetIds = new Set(conversationReports.map((r) => r.presetId));
      for (const t of tasks) {
        for (const sp of t.subProjects) {
          for (const pc of sp.PresetConversation || []) {
            if (!reportedPresetIds.has(pc.id)) {
              conversationsWithoutReport.push(`${t.title} - ${pc.title}`);
            }
          }
        }
      }
      if (conversationsWithoutReport.length > 0) {
        warnings.push(`共 ${conversationsWithoutReport.length} 个对话活动尚未生成 AI 报告，建议先到课堂→对话活动生成`);
      }
    }
  }

  // 6. 条件性收集：交互探究数据（汇总各课堂启用的探究活动，全量平行班）
  let explorationData: ResearchDataSnapshot["explorationData"];
  if (dataTypes.includes("exploration")) {
    const explorationSummaries: string[] = [];
    let totalExpActivities = 0;
    for (const t of tasks) {
      const expStatText = await buildClassExplorationStats(t.id, undefined, true);
      if (expStatText) {
        explorationSummaries.push(`## 课堂【${t.title}】探究表现\n${expStatText}`);
      }
      const count = await prisma.explorationActivity.count({
        where: { SubProject: { taskId: t.id }, enabled: true },
      });
      totalExpActivities += count;
    }

    if (totalExpActivities === 0) {
      warnings.push("所选课堂未包含启用的交互探究活动");
    }

    // 总量闸门：按课堂逐个累加，触顶即停并标注省略。
    // 🧪 MEASURED: 单个探究活动摘要约 300 字符（实测「口算」= 279）。
    // ⚠️ GOTCHA: 老师创建课题时可多选课堂（前端默认全选），摘要按课堂线性累加且原本无上限——
    //   选 10 个课堂 × 5 个探究 ≈ 15000 字符，会挤占对话/作业数据在同一 Prompt 里的预算
    //   （模型上下文 deepseek-flash 64K，非探究独享）。
    // ⛔ DO NOT REVERT: 不要为了"数据全"去掉这道闸门——宁可少而精并显式告知老师，
    //   也不要让长尾课堂把 Prompt 撑爆导致整篇论文生成失败。
    const kept: string[] = [];
    let used = 0;
    let omittedClassCount = 0;
    for (const s of explorationSummaries) {
      if (used + s.length > MAX_EXPLORATION_SUMMARY_CHARS) {
        omittedClassCount++;
        continue;
      }
      kept.push(s);
      used += s.length;
    }
    if (omittedClassCount > 0) {
      warnings.push(
        `探究数据已达摘要上限（${MAX_EXPLORATION_SUMMARY_CHARS} 字符），` +
        `另有 ${omittedClassCount} 个课堂的探究表现未纳入，如需完整分析请减少所选课堂数`
      );
    }

    const summaryText = kept.length > 0
      ? kept.join("\n\n")
      : "所选课堂暂无探究活动或提交数据";

    explorationData = {
      totalActivities: totalExpActivities,
      summaryText,
    };
  }

  // 7. 条件性收集：探究报告（AIInsight type=exploration_class）
  let explorationReports: ResearchDataSnapshot["explorationReports"];
  let explorationsWithoutReport: string[] = [];
  if (dataTypes.includes("explorationReport")) {
    const allExplorations = await prisma.explorationActivity.findMany({
      where: {
        SubProject: { taskId: { in: taskIds } },
        enabled: true,
      },
      include: {
        SubProject: {
          include: { task: { select: { title: true } } },
        },
      },
    });

    if (allExplorations.length > 0) {
      const expIds = allExplorations.map((e) => e.id);
      const reports = await prisma.aIInsight.findMany({
        where: {
          type: "exploration_class",
          scopeId: { in: expIds },
        },
        orderBy: { version: "desc" },
      });

      const latestMap = new Map<string, typeof reports[0]>();
      for (const r of reports) {
        if (r.scopeId && !latestMap.has(r.scopeId)) latestMap.set(r.scopeId, r);
      }

      explorationReports = allExplorations
        .filter((e) => latestMap.has(e.id))
        .map((e) => {
          const r = latestMap.get(e.id)!;
          return {
            explorationId: e.id,
            explorationTitle: e.title,
            subProjectTitle: e.SubProject?.title || "",
            taskTitle: e.SubProject?.task?.title || "",
            content: r.content,
            createdAt: r.createdAt.toISOString(),
          };
        });

      const reportedExpIds = new Set(explorationReports.map((r) => r.explorationId));
      for (const e of allExplorations) {
        if (!reportedExpIds.has(e.id)) {
          explorationsWithoutReport.push(`${e.SubProject?.task?.title || ""} - ${e.title}`);
        }
      }

      if (explorationsWithoutReport.length > 0) {
        warnings.push(`共 ${explorationsWithoutReport.length} 个交互探究尚未生成 AI 报告，建议先到对应探究页生成`);
      }
    }
  }

  return {
    scope,
    quizData,
    conversationData,
    quizReports,
    conversationReports,
    explorationData,
    explorationReports,
    dataQuality: {
      warnings,
      ...(dataTypes.includes("quizReport") || dataTypes.includes("conversationReport") || dataTypes.includes("explorationReport")
        ? {
            missingReports: {
              quizzesWithoutReport: dataTypes.includes("quizReport") ? missingReports : [],
              conversationsWithoutReport: dataTypes.includes("conversationReport") ? conversationsWithoutReport : [],
              explorationsWithoutReport: dataTypes.includes("explorationReport") ? explorationsWithoutReport : [],
            },
          }
        : {}),
    },
  };
}