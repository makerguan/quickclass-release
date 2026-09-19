import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { getSubProjectContext } from "@/lib/exploration/context";

// POST: 多轮对话流式生成/修改互动探究 HTML 网页
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const { subProjectId, initialPrompt, currentHtml, instruction } = await req.json();
    if (!subProjectId) {
      return new Response("缺少 subProjectId", { status: 400 });
    }

    // 课堂背景（作为首轮设计意图的上下文）
    const ctx = await getSubProjectContext(subProjectId);
    if (!ctx) {
      return new Response("未找到课堂", { status: 404 });
    }
    const background = `【课堂背景信息】\n课堂主题：${ctx.taskTitle}\n课堂目标：${ctx.taskDesc}\n知识库内容：${ctx.knowledgeContent}`;

    // 首轮 vs 多轮：currentHtml 是否为空
    const isFirstRound = !currentHtml?.trim();
    if (isFirstRound && !initialPrompt?.trim()) {
      return new Response("提示词不能为空", { status: 400 });
    }

    // 多轮 baseline：initialPrompt 可能为空（纯导入 HTML 场景），兜底为增量修改语义
    const baseline = initialPrompt?.trim()
      ? `${background}\n\n${initialPrompt.trim()}`
      : "以下是教师导入的现有 HTML 页面，请严格基于它按后续指令增量修改，不要重新设计或套用探究模板。";

    const messages = isFirstRound
      ? [{ role: "user", content: `${background}\n\n${initialPrompt.trim()}` }]
      : [
          { role: "user", content: baseline },
          { role: "assistant", content: currentHtml },
          { role: "user", content: instruction?.trim() || "请优化这个页面" },
        ];

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

【多轮修改规则】（当对话历史中已有一版 HTML 时适用）
1. 你在"修改"上一版 HTML，而非重新设计：只改用户明确要求的部分，其余结构、配色、交互、文案保持原样
2. 每次必须输出完整、可运行的 HTML（不是片段、不是 diff、不要 markdown 包裹）
3. 除非用户明确要求重做，否则保留上一版整体布局与视觉风格

【页面结构建议】
- 顶部：探究主题 + 1-2句引导语（这是什么 / 要探索什么）
- 中部：核心交互区（可视化、模拟器、可调节参数、可观察对象）
- 关键位置：观察提示（"试试改变X，观察Y的变化"）
- 底部（可选）：发现小结区（学生可记录自己发现的规律）

重要：只输出 HTML 代码本身，不要有额外的解释文字，不要用 markdown 代码块包裹。`;

    const { textStream } = await streamText({
      model: chatModel,
      system: systemPrompt,
      messages,
      // 统一输出上限 64K：探究 HTML 整页输出远超默认 4096，不传必截断
      maxOutputTokens: 65536,
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
