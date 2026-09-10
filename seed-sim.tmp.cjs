// 模拟 20 个学生 × 3 轮对话（可重跑，幂等：先清旧模拟数据）
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ROUNDS = [
  [ // 模板A：方程应用
    ["老师，我不太明白这道题为什么要用方程解，直接用算术方法算不行吗？", "算术方法也能算，不过方程的优势是把未知量当作已知量参与运算，思路更直接。比如\"一个数的3倍加5等于20\"，算术要倒推（20-5）÷3，方程直接写 3x+5=20，顺着题目条件列就行，题目越复杂这个优势越明显。"],
    ["那怎么设未知数比较合适？随便设一个字母就可以吗？", "设未知数的原则是：设要求的量，或者设一个能让其他量都好表达的量。比如\"甲是乙的3倍，甲乙之和是36\"，设乙为 x，则甲是 3x，方程 3x+x=36 一次就列出来了。如果设甲为 x，乙就是 x÷3，会出现分数，麻烦很多。所以选好\"基本量\"很关键。"],
    ["我列出了 3x+5=20，解得 x=5，但不知道怎么验算，直接写答案可以吗？", "验算是必须的步骤：把 x=5 代回原方程左边，3×5+5=20，右边也是20，等式成立，说明解对了。如果代回去不相等，说明解方程过程出了错。考试里验算能帮你挽回很多粗心分，建议养成习惯。"],
  ],
  [ // 模板B：几何
    ["老师，三角形内角和为什么是180度？是规定还是可以证明？", "可以证明。最经典的证法是过顶点作对边的平行线，利用平行线内错角相等，把三个角\"搬\"到一条直线上，拼成平角，所以内角和是180°。这是推理得到的结论，不是规定。"],
    ["那四边形的内角和也能这样证吗？", "可以，而且更简单：连接一条对角线，把四边形分成两个三角形，每个三角形内角和180°，所以四边形内角和就是360°。这个\"分割成三角形\"的思路还能推广：五边形分3个三角形是540°，n边形就是 (n-2)×180°。"],
    ["多边形对角线的条数有公式吗？我数五边形对角线数了半天是5条。", "有公式：从每个顶点出发可以引 (n-3) 条对角线（不能连自己和相邻两个顶点），n 个顶点共 n(n-3) 条，但每条被数了两次，所以要除以2，即 n(n-3)/2。代入五边形：5×2÷2=5 条，和你数的一致。"],
  ],
  [ // 模板C：统计与平均数
    ["老师，平均数、中位数、众数都是描述数据集中趋势的，到底什么时候用哪个？", "看数据和目的：平均数用上全部数据，但容易受极端值影响；中位数不受极端值影响，适合收入这类悬殊数据；众数适合\"哪个最常见\"的问题，比如鞋店进货看哪个尺码卖最多。三者结合看，才能全面了解数据。"],
    ["如果一组数据里有个特别大的数，平均数还会准吗？", "会失真。比如5个人工资是4千、4千、4千、4千、4万，平均数是1.12万，但4个人都\"被平均\"了。这时中位数4千更能代表一般水平。所以分析数据前要先看看有没有极端值，再决定用哪个统计量。"],
    ["那方差呢？方差大好还是小好？", "方差衡量数据的波动（离散）程度，没有绝对的好坏：射击比赛中方差小意味着稳定，是好事；但如果考察的是创新能力或投资回报的\"爆发力\"，波动大可能反而是机会。关键是理解方差描述的是什么，再结合场景判断。"],
  ],
  [ // 模板D：一次函数
    ["老师，一次函数 y=kx+b 的 k 和 b 分别决定什么？我总搞混。", "k（斜率）决定倾斜方向和程度：k>0 从左向右上升，k<0 下降，|k| 越大越陡。b 是截距，决定直线与 y 轴交点在 (0, b)。记法：k 管\"走势\"，b 管\"起点\"（与y轴的交点）。"],
    ["怎么快速画出一次函数的图象？每次都要列表描很多点吗？", "不用。两点定一条直线：最方便的是取与坐标轴的两个交点——令 x=0 得 y=b（交y轴），令 y=0 得 x=-b/k（交x轴），连这两点即可。比如 y=2x-4，过 (0,-4) 和 (2,0)。"],
    ["两条直线什么时候平行、什么时候垂直？有规律吗？", "有规律：k 相等则平行（b 不同）；k 互为负倒数（k₁k₂=-1）则垂直。比如 y=2x+1 与 y=2x-3 平行，与 y=-0.5x+1 垂直。判断位置关系不用画图，直接比较斜率就行。"],
  ],
];

const COUNT = Number(process.env.COUNT || 20);

async function main() {
  // 1. 找有 PresetConversation 的任务（与测试同一路径）
  const task = await prisma.learningTask.findFirst({
    where: { subProjects: { some: { PresetConversation: { some: {} } } } },
    include: { subProjects: { include: { PresetConversation: true } } },
  });
  if (!task) throw new Error("没有含对话活动的任务");
  const pc = task.subProjects.flatMap((sp) => sp.PresetConversation)[0];
  const assignment = await prisma.taskAssignment.findFirst({ where: { taskId: task.id } });
  if (!assignment) throw new Error("该任务没有班级分配");
  const classId = assignment.classId;

  // 2. 清旧模拟数据（重跑幂等）：先删洞察/对话，再删学生
  const oldStudents = await prisma.user.findMany({ where: { name: { startsWith: "模拟学生" } }, select: { id: true } });
  if (oldStudents.length > 0) {
    const ids = oldStudents.map((s) => s.id);
    await prisma.aIInsight.deleteMany({ where: { userId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`已清理旧模拟学生 ${ids.length} 个`);
  }

  // 3. 建 20 个学生 × 1 个对话 × 3 轮（4 套模板轮换，内容有差异）
  const now = Date.now();
  for (let i = 1; i <= 20; i++) {
    const student = await prisma.user.create({
      data: { name: `模拟学生${String(i).padStart(2, "0")}`, role: "STUDENT", classId, studentNo: `SIM${i}` },
    });
    const conv = await prisma.conversation.create({
      data: {
        userId: student.id, classId, presetConversationId: pc.id, title: pc.title,
        createdAt: new Date(now - (21 - i) * 3600_000),
        updatedAt: new Date(now - (21 - i) * 3600_000 + 300_000),
      },
    });
    const tpl = ROUNDS[i % 4];
    // 3 轮 = 6 条消息，时间递增
    let t = now - (21 - i) * 3600_000 + 60_000;
    for (const [q, a] of tpl) {
      await prisma.message.create({ data: { conversationId: conv.id, role: "user", content: q, createdAt: new Date(t) } });
      t += 30_000;
      await prisma.message.create({ data: { conversationId: conv.id, role: "assistant", content: a, createdAt: new Date(t) } });
      t += 30_000;
    }
  }
  console.log(`DONE task=${task.id} class=${classId} pc=${pc.title} 学生=20 对话=20 消息=120（每人3轮）`);
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
