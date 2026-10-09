import { prisma } from "@/lib/prisma";
import { parseCollectProfile, detectCollectProfile } from "@/lib/exploration/collect-profile";
import { removeSubmitFunctionality } from "@/lib/prompts/exploration-submit";

/**
 * 探究学情与教研数据聚合引擎（单一出口）。
 *
 * 为什么（🧪 MEASURED）：
 *   - 探究操作日志（ExplorationActionLog）高频细粒度，单班可达数万条，裸传会击穿大模型 Token 限制或超时；
 *   - 探究形态分为评分闯关型、纯探索仿真型、表单记录型（CollectProfile），必须防范无分探究被 AI 虚构分数；
 *   - 论文与学情分析有严格的隐私和学科要求（quality-check.ts 学生姓名零容忍），表单结论（QfRecord）必须服务端脱敏；
 *   - 禁用探究（enabled: false）严禁计入完成率分母。
 *
 * 📐 CONTRACT:
 *   - 严禁向返回文本中拼接未脱敏的真实姓名（一律转换为 X同学 或 学生A/B）；
 *   - 探究操作日志只输出聚合统计分布与典型动作路径，不输出微观时间戳和裸 JSON；
 *   - 所有提取解析 QfRecord 均采用全包裹容错（Safe JSON）。
 *
 * 🔗 RELATED:
 *   - src/app/api/tasks/[taskId]/insights/route.ts（课堂级学情分析）
 *   - src/lib/prompts/insight.ts（学情提示词变量）
 *   - src/lib/research/data-collector.ts（教研论文/课题数据快照）
 */

// 姓名识别键（与 QF 采集标准保持对齐）
const NAME_KEYS = ["学生姓名", "姓名", "名字", "studentName", "name", "nickname", "昵称"];

/** 安全脱敏姓名：张三 -> 张同学，李四五 -> 李同学，李 -> 李同学 */
export function maskStudentName(name: string): string {
  if (!name || typeof name !== "string") return "某同学";
  const trimmed = name.trim();
  if (!trimmed) return "某同学";
  return `${trimmed[0]}同学`;
}

/**
 * 从表单数据中提取原始姓名（未脱敏）。
 *
 * ⚠️ GOTCHA：只返回原始值，是否脱敏由调用方按场景决定——
 *   老师端课堂学情（maskPrivacy=false）保留真名，与作业/对话数据口径一致；
 *   教研论文/课题（maskPrivacy=true）必须脱敏，否则触发 quality-check.ts 姓名泄漏零容忍告警。
 */
function extractRawName(data: Record<string, unknown>): string {
  for (const k of NAME_KEYS) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  for (const [k, v] of Object.entries(data)) {
    if (k.includes("姓名") && v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

/**
 * 动作类型中文可读映射。
 *
 * ⚠️ GOTCHA: 系统注入脚本（src/lib/prompts/exploration-submit.ts 的 autoLog）吐出的 type
 *   一律带 `auto:` 前缀（auto:click / auto:fill / auto:change / auto:drag），
 *   这里的键必须与之一一对应，否则报告里会出现 `auto:fill(9次)` 这种原始枚举，老师读不懂。
 *   🔗 RELATED: exploration-submit.ts 的 autoLog 调用点（新增动作类型须同步补此表）。
 */
const ACTION_TYPE_MAP: Record<string, string> = {
  click: "点击交互",
  drag: "拖拽/滑动",
  slider_change: "滑块调参",
  reset: "重置实验",
  input: "输入数据",
  change: "选项切换",
  submit: "提交结果",
  step: "切换环节",
  start: "开始探究",
  // 系统自动采集轨（带 auto: 前缀）
  "auto:click": "点击交互",
  "auto:fill": "填写/作答",
  "auto:change": "参数调整",
  "auto:drag": "拖拽操作",
};

export interface ClassExplorationSummary {
  hasExploration: boolean;
  totalActivities: number;
  totalSubmissions: number;
  summaryText: string;
}

export interface PersonalExplorationSummary {
  hasExploration: boolean;
  summaryText: string;
}

/**
 * 聚合全班/全课堂交互探究学情数据
 * @param taskId 课堂 ID
 * @param classId 可选班级 ID（传则只聚合该班；不传则聚合该课堂分配的所有班级）
 * @param maskPrivacy 是否强制对姓名完全脱敏（教研论文模式为 true，课堂级学情可为 false）
 */
export async function buildClassExplorationStats(
  taskId: string,
  classId?: string,
  maskPrivacy: boolean = false
): Promise<string> {
  // 1. 查找该课堂所有启用的探究活动
  const explorations = await prisma.explorationActivity.findMany({
    where: {
      SubProject: { taskId },
      enabled: true,
    },
    include: {
      SubProject: { select: { id: true, title: true } },
      ExplorationSubmission: {
        include: {
          ExplorationActionLog: true,
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  if (explorations.length === 0) return "";

  // 2. 确定学生总池子
  let targetStudentIds: Set<string> | null = null;
  let totalClassStudents = 0;
  if (classId) {
    const classStudents = await prisma.user.findMany({
      where: { classId, role: "STUDENT" },
      select: { id: true, name: true },
    });
    totalClassStudents = classStudents.length;
    targetStudentIds = new Set(classStudents.map((s) => s.id));
  } else {
    // 跨班级汇总（课题/论文模式）：统计课堂所有已分配班级的学生
    const taskWithAssignments = await prisma.learningTask.findUnique({
      where: { id: taskId },
      include: {
        assignments: {
          include: {
            class: {
              include: {
                User_User_classIdToClass: {
                  where: { role: "STUDENT" },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });
    const allStuIds = new Set<string>();
    for (const a of taskWithAssignments?.assignments || []) {
      for (const u of a.class?.User_User_classIdToClass || []) {
        allStuIds.add(u.id);
      }
    }
    totalClassStudents = allStuIds.size;
    if (allStuIds.size > 0) targetStudentIds = allStuIds;
  }

  const sections: string[] = [];

  for (const exp of explorations) {
    // 过滤目标学生提交
    const validSubmissions = exp.ExplorationSubmission.filter((s) =>
      targetStudentIds ? targetStudentIds.has(s.studentId) : true
    );

    const submissionCount = validSubmissions.length;
    const completionRate = totalClassStudents > 0
      ? Math.round((submissionCount / totalClassStudents) * 100)
      : (submissionCount > 0 ? 100 : 0);

    // 探究形态判定（是否有评分环节）
    const profile = parseCollectProfile(exp.collectProfile) ??
      detectCollectProfile(removeSubmitFunctionality(exp.htmlContent || ""));
    const hasScoring = profile.hasScoring !== false;

    // 统计用时与互动
    let totalTime = 0;
    let totalInteractions = 0;
    const actionCounts: Record<string, number> = {};

    for (const sub of validSubmissions) {
      try {
        const answers = JSON.parse(sub.answers || "{}");
        totalTime += answers.timeSpent || 0;
        totalInteractions += answers.interactions || 0;
      } catch {
        // safe ignore
      }
      for (const log of sub.ExplorationActionLog) {
        actionCounts[log.type] = (actionCounts[log.type] || 0) + 1;
      }
    }

    const avgTime = submissionCount > 0 ? Math.round(totalTime / submissionCount) : 0;
    const avgInteractions = submissionCount > 0 ? Math.round(totalInteractions / submissionCount) : 0;

    // 高频动作统计 TOP 3
    const sortedActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${ACTION_TYPE_MAP[type] || type}(${count}次)`);

    // 探究标题带上子项目语义
    const displayTitle = exp.title.includes(exp.SubProject.title)
      ? exp.title
      : `${exp.SubProject.title} · ${exp.title}`;

    const expLines: string[] = [
      `### 探究活动：${displayTitle}`,
      `- 参与度：${submissionCount}/${totalClassStudents || submissionCount} 人提交（完成率约 ${completionRate}%）`,
      `- 探究投入：平均探索用时 ${avgTime} 秒，人均交互调参 ${avgInteractions} 次`,
    ];

    if (hasScoring && submissionCount > 0) {
      const avgScore = Math.round(
        validSubmissions.reduce((sum, s) => sum + (s.score || 0), 0) / submissionCount
      );
      expLines.push(`- 达成评分：平均得分 ${avgScore} 分（含计分/闯关机制）`);
    }

    if (sortedActions.length > 0) {
      expLines.push(`- 典型操作特征：高频操作主要集中于 ${sortedActions.join("、")}`);
    }

    // 提取 QuickForm 探究表单结论（最多采 4 条代表样本）
    if (exp.qfTaskId) {
      const qfRecords = await prisma.qfRecord.findMany({
        where: { taskId: exp.qfTaskId },
        take: 15,
      });

      const sampleConclusions: string[] = [];
      for (const r of qfRecords) {
        try {
          const parsed = JSON.parse(r.dataJson || "{}");
          const rawName = extractRawName(parsed);
          // 📐 CONTRACT: maskPrivacy=true（教研链路）一律脱敏为「姓+同学」；
          //   false（老师端课堂学情）保留真名，与作业 quizData.attempts 的 studentName 口径一致。
          const studentLabel = maskPrivacy
            ? (rawName ? maskStudentName(rawName) : "某同学")
            : (rawName || "同学");

          // 提取非私有且非姓名的有效结论字段
          const conclusions = Object.entries(parsed)
            .filter(([k, v]) => !k.startsWith("_") && !NAME_KEYS.includes(k) && v !== null && v !== undefined && String(v).trim() !== "")
            .map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`)
            .join("；");

          if (conclusions) {
            sampleConclusions.push(`[${studentLabel}] ${conclusions}`);
          }
          if (sampleConclusions.length >= 4) break;
        } catch {
          // ignore corrupted json
        }
      }

      if (sampleConclusions.length > 0) {
        expLines.push(`- 学生实验记录与探究结论采样：\n  ${sampleConclusions.join("\n  ")}`);
      }
    }

    sections.push(expLines.join("\n"));
  }

  return sections.join("\n\n");
}

/**
 * 聚合指定学生在某课堂的个人交互探究数据
 */
export async function buildPersonalExplorationStats(
  taskId: string,
  classId: string,
  studentId: string
): Promise<string> {
  const explorations = await prisma.explorationActivity.findMany({
    where: {
      SubProject: { taskId },
      enabled: true,
    },
    include: {
      SubProject: { select: { id: true, title: true } },
      ExplorationSubmission: {
        where: { studentId },
        include: {
          ExplorationActionLog: {
            orderBy: { timestamp: "asc" },
            take: 15, // 仅取前15条关键操作，防止溢出
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  if (explorations.length === 0) return "";

  const sections: string[] = [];

  for (const exp of explorations) {
    const sub = exp.ExplorationSubmission[0];
    const displayTitle = exp.title.includes(exp.SubProject.title)
      ? exp.title
      : `${exp.SubProject.title} · ${exp.title}`;

    if (!sub) {
      sections.push(`### 探究活动：${displayTitle}\n- 参与状态：未提交/未参与`);
      continue;
    }

    let answers: Record<string, any> = {};
    try {
      answers = JSON.parse(sub.answers || "{}");
    } catch {
      // safe ignore
    }

    const lines: string[] = [
      `### 探究活动：${displayTitle}`,
      `- 参与状态：已完成并提交`,
      `- 探索时长：${answers.timeSpent ? `${answers.timeSpent}秒` : "已记录"}`,
      `- 互动频次：${answers.interactions ? `${answers.interactions}次交互` : `${sub.ExplorationActionLog.length}次操作`}`,
    ];

    if (answers.completedSections) {
      const secs = Array.isArray(answers.completedSections)
        ? answers.completedSections.join("、")
        : answers.completedSections;
      lines.push(`- 探索进度/环节：已完成 ${secs}`);
    }

    if (sub.score !== null && sub.score !== undefined) {
      lines.push(`- 探究得分：${sub.score}/${sub.totalScore || 100}分`);
    }

    // 关键轨迹提取
    if (sub.ExplorationActionLog.length > 0) {
      const trace = sub.ExplorationActionLog.slice(0, 8)
        .map((l) => `${ACTION_TYPE_MAP[l.type] || l.type}${l.target ? `(${l.target})` : ""}`)
        .join(" → ");
      lines.push(`- 操作路径特征：${trace}`);
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
