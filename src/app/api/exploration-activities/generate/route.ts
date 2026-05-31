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

    const systemPrompt = `你是一位专业的互动教育网页设计师。根据用户提供的提示词，生成一个完整的、可在浏览器中直接运行的 HTML5 互动学习网页。

输出要求：
1. 输出必须是完整、可运行的 HTML，包含内联 style 和 script 标签
2. 不依赖任何外部资源（无外部 CDN、无图片链接、无外部样式表）
3. 网页必须包含完整的 DOCTYPE html 和 html head body 结构
4. 设计要有趣味性，适合初中生
5. 互动元素（如选择题、填空、拖拽、游戏等）必须有完整的交互逻辑和即时反馈
6. 视觉风格要现代、清晰，配色协调
7. 页面要有适当的动画效果提升用户体验
8. 响应式设计，适配电脑和 Pad
9. 所有交互元素要有明确的视觉反馈（正确/错误的颜色提示、得分变化等）
10. 生成后学生可以直接在浏览器中完成学习探究任务
${submissionInstruction}

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
