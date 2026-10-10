/**
 * 模板「效果预览」用的示例数据。
 *
 * ⚠️ 红线：这里所有内容都是**编造的演示数据**（王小明/三年级1班…），
 * 绝不使用真实学生数据——预览可能被投屏、被截图分享，不能带任何真实信息。
 *
 * ⚠️ 变量名必须与**真库模板正文里实际引用的**一致。
 *    2026-09-20 用真库全量模板扫出各类型实际引用的变量后逐一对齐
 *    （此前是按语义猜的名字，导致预览频繁弹「模板引用了这些变量：{xxx}」）。
 *    改动后仍保留缺值提示作为安全网：真库新增变量时只提示、不报错。
 */

/** 示例数据集版本：内容有调整时 +1，所有已生成的预览会统一视为过期 */
export const PREVIEW_SAMPLE_VER = 2;

export type SampleVars = Record<string, string>;

export type PreviewTemplateType =
  | "student"
  | "class"
  | "conversation"
  | "QUIZ_DESIGN"
  | "QUIZ_ANALYSIS"
  | "EXPLORATION_ANALYSIS";

/** 各类模板通用的示例变量 */
const COMMON: SampleVars = {
  // 时间 / 学校 / 班级
  reportTime: "2026年9月20日 10:30",
  schoolName: "示例小学",
  className: "三年级1班",
  grade: "三年级",
  subject: "信息科技",
  teacherName: "李老师",
  // 学生
  studentName: "王小明",
  studentNo: "2026031",
  // 课堂任务
  taskTitle: "认识超声波传感器",
  taskDescription: "通过对话与动手实验，认识超声波传感器的工作原理",
  taskObjectives: "了解超声波测距原理，能说出它在生活中的应用",
  taskGrade: "三年级",
  taskSubject: "信息科技",
  // 预设对话活动
  pcTitle: "找等量关系",
  pcDescription: "围绕“鸟儿为什么只有两只脚”展开的追问式对话",
  // 班级规模
  totalStudents: "32",
  submitCount: "32",
};

/** 一段拟真的单人对话记录（学生端「对话内容」变量） */
const DIALOG_ONE = `1. 学生：为什么鸟只有两只脚？
   AI：你觉得如果它有四只脚，会有什么变化？
2. 学生：可能站不稳吧？
   AI：那鸡和鸭为什么能站稳呢？
3. 学生：因为它们的身体结构不一样？
   AI：说得很好，那你能举一个"结构决定功能"的例子吗？
4. 学生：我想不出来了。
   AI：那我们看看鱼尾巴的作用好不好？
5. 学生：鱼尾巴用来游泳！
6. 学生：老师，超声波也是这个道理吗？
7. 学生：那传感器是靠什么判断远近的？
8. 学生：是不是先发出声音，再等它弹回来？`;

/** 一份拟真的个人作业数据（学生端「作业数据」变量） */
const QUIZ_ONE = `作业名称：超声波传感器随堂小测（5 题）
提交情况：已完成 5/5，用时 6 分 40 秒，首次提交
得分：75 分（满分 100）
逐题情况：
- 第1题 传感器的作用（辨识）：正确
- 第2题 测距原理排序（排序）：正确
- 第3题 生活中的超声波应用（多选）：正确
- 第4题 结构决定功能（举例）：错误——只写了"不一样"，未举例
- 第5题 测距计算（填空）：错误——填了"3 米"，正确答案 4 米
未完成：追问任务 1 次（"为什么回声能测出距离"）`;

/** 各类型模板的补充示例变量（变量名对齐真库模板正文） */
const TYPE_EXTRA: Record<PreviewTemplateType, SampleVars> = {
  student: {
    personalDialogContents: DIALOG_ONE,
    personalQuizStats: QUIZ_ONE,
  },
  class: {
    personalDialogContents: DIALOG_ONE,
    personalQuizStats: QUIZ_ONE,
    personalDialogAnalysisReport: "该生在本环节主动提问 3 次，能沿着 AI 的追问继续思考，末段出现一次放弃（第 4 轮）。",
    classDialogAnalysisReport:
      "全班 32 人共产生 186 条对话消息，26 人参与发言、6 人未发言；提问集中在「原理类」（占 46%），「应用类」偏少。",
    classQuizStats: `班级 32 人全部提交，平均分 82.5，最高 100，最低 45。
分段：90-100 分 14 人；80-89 分 9 人；60-79 分 6 人；60 分以下 3 人。
逐题正确率：第1题 94%、第2题 88%、第3题 59%、第4题 81%、第5题 72%。`,
    activeStudents: "26",
    activeCount: "186",
  },
  conversation: {},
  QUIZ_DESIGN: {
    convDescription: "围绕「找等量关系」展开的追问式对话，学生先猜、AI 再追问，逐步逼近概念。",
    kbContent:
      "等量关系：两个数量之间相等的关系，可以用等号表示。例如「鸟有 2 只脚 = 2」「鱼有 1 条尾巴 = 1」。用符号表示等量关系是从算术走向代数的第一步。",
    kbList: "1. 等量关系的含义\n2. 用符号表示等量关系\n3. 从生活情境中找等量关系",
    // quizCount 已从变量清单移除（题量恒为 5，模板直接写死）；如存量模板仍引用，预览走缺值提示安全网
  },
  QUIZ_ANALYSIS: {
    quizTitle: "超声波传感器随堂小测",
    quizCount: "5",
    classAvgScore: "82.5",
    classSize: "32",
    highScoreStudents: "王小明 100、李思思 95、张一鸣 95、刘欣然 90（共 14 人在 90 分以上）",
    lowScoreStudents: "陈子墨 45、赵小满 52、孙一诺 58（共 3 人在 60 分以下）",
    questionStats:
      "第1题 正确率 94%；第2题 88%；第3题 59%（测距计算，主要错误：把单程距离当往返距离）；第4题 81%；第5题 72%（应用判断）。",
    scoreDistribution: "90-100 分 14 人；80-89 分 9 人；60-79 分 6 人；60 分以下 3 人。",
  },
  EXPLORATION_ANALYSIS: {
    explorationTitle: "身边的超声波小调查",
    explorationDescription: "让学生在日常生活中找出使用超声波的设备，拍照或写下来并说明用途。",
    submittedCount: "32",
    submissionDetails: `王小明：家里的微波炉、汽车倒车雷达都用到了超声波。
李思思：蝙蝠是用超声波找路的，人做的传感器是跟它学的。
张一鸣：医院做 B 超也是超声波，妈妈说能看到小宝宝。
刘欣然：只写了一个"倒车雷达"，未说明用途。
（共 32 人提交，其中 28 人作答完整）`,
    actionTypeStats:
      "填写文字说明 28 人；仅勾选选项未写说明 4 人；补充了课外例子的 12 人；误把红外/激光当成超声波的 5 人。",
    avgInteractions: "3.4",
    avgTimeSpent: "4 分 12 秒",
    classAvgScore: "78.6",
    scoreDistribution: "优秀（≥90）9 人；良好（80-89）11 人；合格（60-79）8 人；待提升（<60）4 人。",
  },
};

/** 各类模板附带的示例数据（一段人读得懂的材料，供 AI 当素材用） */
const TYPE_DATASET: Record<string, string> = {
  student: `## 示例学生（王小明）本次对话记录
${DIALOG_ONE}

## 该生统计
对话轮次 8；主动提问 3 次；回答正确率 75%；最活跃时段 10:15；未完成追问 1 次。

## 该生作业数据
${QUIZ_ONE}`,
  class: `## 示例班级（三年级1班）本次课对话情况
王小明：12 次对话，24 条消息
李思思：9 次对话，18 条消息
张一鸣：7 次对话，14 条消息
刘欣然：6 次对话，11 条消息
陈子墨：5 次对话，9 条消息
（其余 6 人未发言，共 32 名学生；全班合计 186 条消息）

## 学生近期提问
"传感器为什么能看见东西？"、"回声是怎么回事？"、"蝙蝠也是这样吗？"

## 学习活动进展
已完成：认识传感器 → 对话讨论"等量关系"
未完成：动手测距实验、小组互评`,
  conversation: `## 示例主题
主题：找等量关系
学段：三年级
知识点：用生活中的例子理解等量关系
目标：学生能自己说出"两边一样多"的例子，并解释理由。`,
  QUIZ_DESIGN: `## 示例知识点
超声波测距原理与应用（三年级信息科技）

## 要求
5 道题：3 道基础（概念 + 判断）、2 道提升（简单计算 + 生活应用）；
每题给出选项与参考答案，难度贴合三年级。`,
  QUIZ_ANALYSIS: `## 示例成绩数据
班级人数：32；提交：32；平均分 82.5；最高 100；最低 45。
分段：90-100 共 14 人；80-89 共 9 人；60-79 共 6 人；60 以下 3 人。
题目正确率：第1题 94%、第2题 88%、第3题 59%、第4题 81%、第5题 72%。`,
  EXPLORATION_ANALYSIS: `## 示例探究提交
探究主题：身边的超声波小调查
提交人数：32（28 人作答完整）
典型作答：
- 家里微波炉、倒车雷达都用到了超声波
- 蝙蝠用超声波找路
- 医院做 B 超也是超声波
选项统计：知道 3 个以上例子的 12 人；1-2 个 14 人；没写 6 人。`,
  default: `## 示例材料
班级：三年级1班（32 人）；课堂主题：认识超声波传感器。`,
};

/** 取某类模板的示例变量（通用 + 类型补充） */
export function getSampleVars(type: string): SampleVars {
  const extra = TYPE_EXTRA[type as PreviewTemplateType] || {};
  return { ...COMMON, ...extra };
}

/** 取某类模板的示例材料文本 */
export function getSampleDataset(type: string): string {
  return TYPE_DATASET[type] || TYPE_DATASET.default;
}

/**
 * 用示例变量填充模板正文。
 * 同时报告"模板里引用了、但我们没有示例值的变量"（优雅降级，不报错）。
 */
export function replaceSampleVars(content: string, vars: SampleVars): { filled: string; missingVars: string[] } {
  const missing = new Set<string>();
  const filled = content.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    missing.add(key);
    return whole; // 没有示例值就原样保留，由调用方在界面上提示
  });
  return { filled, missingVars: Array.from(missing) };
}
