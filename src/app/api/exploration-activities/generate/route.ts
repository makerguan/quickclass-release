import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

// POST: 根据提示词流式生成互动 HTML 网页
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const { prompt, enableSubmission, submissionCount } = await req.json();
    if (!prompt?.trim()) {
      return new Response("提示词不能为空", { status: 400 });
    }

    // 构建提交项目提示
    let submissionInstruction = "";
    if (enableSubmission) {
      submissionInstruction = `

【重要】启用提交功能 - 网页必须有提交成绩按钮

## 网页要求：
1. 设计一个有趣的互动学习环节（可以是游戏、模拟、练习等）
2. 互动过程中要记录学生的得分、完成状态等数据
3. 在网页右下角必须有一个红色的"提交成绩"按钮

## 提交按钮（必须出现在右下角）：
<button id="submitBtn" onclick="submitResults()">提交成绩</button>
<style>
#submitBtn {position:fixed; bottom:30px; right:30px; padding:15px 30px; background:#E34D59; color:white; border:none; border-radius:25px; font-size:18px; cursor:pointer; box-shadow:0 4px 15px rgba(227,77,89,0.4); z-index:1000;}
</style>

## 提交逻辑（必须包含此 JavaScript）：
<script>
function submitResults() {
  if (!confirm("确认提交成绩？提交后无法修改。")) return;
  
  // 计算本次互动的得分和结果
  const score = window.gameScore || 0; // 从网页游戏中获取分数
  const maxScore = 100;
  const completed = window.gameCompleted || true;
  
  const submitData = {
    score: score,
    maxScore: maxScore,
    completed: completed,
    completedAt: new Date().toISOString(),
    // 可以包含更多互动数据，如：闯关数、用时、游戏级别等
    extraData: {
      level: window.gameLevel || 1,
      timeSpent: window.timeSpent || 0,
      attempts: window.attempts || 1
    }
  };
  
  document.getElementById("submitBtn").innerHTML = "提交中...";
  document.getElementById("submitBtn").disabled = true;
  
  fetch("/api/exploration-activities/" + window.__EXPLORATION_ID__ + "/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (localStorage.getItem("token") || "") },
    body: JSON.stringify(submitData)
  }).then(function(response) {
    if (response.ok) {
      response.json().then(function(result) {
        alert("提交成功！您的得分：" + result.score + " / " + result.maxScore);
        document.getElementById("submitBtn").innerHTML = "已提交";
      });
    } else {
      alert("提交失败，请重试");
      document.getElementById("submitBtn").innerHTML = "重新提交";
      document.getElementById("submitBtn").disabled = false;
    }
  }).catch(function(e) {
    alert("提交失败：" + e.message);
    document.getElementById("submitBtn").innerHTML = "重新提交";
    document.getElementById("submitBtn").disabled = false;
  });
}
</script>

重要提醒：
- 网页要有趣味性，设计学生喜欢的互动环节
- 必须有得分机制，存储到 window.gameScore 变量
- 提交按钮必须在右下角，红色醒目
- 点击提交按钮后，会将得分数据发送到服务器`;
    }

    const { chatModel } = await createDashScopeClient();
    const { streamText } = await import("ai");

    const systemPrompt = `你是一位专业的互动探究学习网页设计师。根据用户提供的提示词，生成一个让学生"通过动手操作来发现知识"的 HTML5 互动学习网页。

【核心理念】互动探究 = 让学生看到、摸到、试到、对比到。不是做题闯关，而是探索发现。

【探究形式偏好】（按优先级排序）
1. **概念可视化**：用图形、动画、动态变化展示抽象概念（如函数图像随参数变化、几何图形的动态变换、分子运动模拟）
2. **模拟实验**：模拟真实实验过程，学生可调参数观察结果（如下落物体模拟、化学反应模拟、生态系统模拟）
3. **对比探究**：并列展示多种情况让学生观察异同（如不同条件下的结果并排展示）
4. **原理探索**：分层揭示、动态构建推导过程（如几何证明的逐步展开、公式推导的可视化）
5. **规律发现**：提供可操作的数据让学生自己发现规律（如调整变量观察图表变化）

【真实计算原则】（非常重要，不可妥协）
1. **物理模拟必须基于真实物理公式**：抛物线运动用 v²=2gh、y=v₀t-½gt²；单摆用 T=2π√(L/g)；弹簧用 F=kx；电路用 V=IR、欧姆定律；化学反应速率用质量作用定律；光学用折射定律 n₁sinθ₁=n₂sinθ₂
2. **数学可视化必须基于真实数学函数**：函数图像必须根据参数真实计算坐标（如 y=ax²+bx+c 中 a/b/c 改变时抛物线真实变化）；几何变换必须用真实几何定理（勾股定理、三角函数、圆周率 π）
3. **化学/生物模拟必须符合真实规律**：pH值计算、平衡常数、酶动力学、生态系统食物链能量传递（10%法则）
4. **不能是"看起来像但实际是固定动画"的伪交互**：例如：
   - ❌ 错误：拖动滑块只是切换预设的3张图
   - ✅ 正确：拖动滑块实时计算并绘制真实的几何/物理结果
5. **计算结果要贴近真实**：使用真实的物理/数学常量（如 g=9.8, π=3.14159），单位换算要正确（如 m/s、km/h、N、J）
6. **数据要合理**：模拟产生的数值要在合理范围内（如温度-273~1000℃，速度不超过光速）
7. **可显示中间过程**：让学生看到计算过程或关键数据，增强"动手探索"感

【应避免】
- 不要做成"闯关游戏"（避免"侦探社"、"挑战赛"、"大冒险"等游戏化包装）
- 不要以"得分/排行榜/关卡"为主要机制
- 不要把探究等同于"做题"（避免大量选择题、填空题、判断题堆砌）
- 不要让学生"猜答案"，而是让学生"看到规律"

【输出要求】
1. 输出必须是完整、可运行的 HTML，包含内联 style 和 script 标签
2. 不依赖任何外部资源（无外部 CDN、无图片链接、无外部样式表）
3. 网页必须包含完整的 DOCTYPE html 和 html head body 结构
4. 视觉风格：现代简洁、配色清晰、信息层级分明，重点突出"可观察的变化"
5. 交互方式：滑块、按钮、可拖动元素、参数调节器、可点击的图表
6. 必须有"引导性问题"或"观察提示"，用文字告诉学生"该看什么、该思考什么"
7. 视觉反馈要服务于理解：参数变化时图形实时变化、关键信息高亮、对比要素并排
8. 响应式设计，适配电脑和 Pad
9. 可使用动画，但服务于"展示变化过程"而非装饰
${submissionInstruction}

【页面结构建议】
- 顶部：探究主题 + 1-2句引导语（这是什么 / 要探索什么）
- 中部：核心交互区（可视化、模拟器、可调节参数、可观察对象）
- 关键位置：观察提示（"试试改变X，观察Y的变化"）
- 底部（可选）：发现小结区（学生可记录自己发现的规律）

重要：只输出 HTML 代码本身，不要有额外的解释文字，不要用 markdown 代码块包裹。`;

    const { textStream } = await streamText({
      model: chatModel,
      system: systemPrompt,
      prompt: prompt.trim(),
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const delta of textStream) {
            controller.enqueue(encoder.encode(delta));
          }
        } catch (e) {
          console.error("Stream error:", e);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(e.message || "生成失败", { status: 500 });
  }
}

async function createDashScopeClient() {
  const config = await prisma.systemConfig.findFirst();
  if (!config?.aiApiKey) {
    throw new Error("AI 服务未配置，请先在系统设置中配置 API Key");
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  const client = createOpenAI({
    baseURL: config.aiBaseUrl,
    apiKey: config.aiApiKey,
  });
  return { chatModel: client.chat(config.aiModel || "qwen-turbo") };
}
