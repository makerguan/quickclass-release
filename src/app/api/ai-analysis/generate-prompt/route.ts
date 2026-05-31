import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { createDashScopeClient } from "@/lib/ai";
import { generateText } from "ai";
import { aiQueue } from "@/lib/ai-queue";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await req.json();
    const { type, title, objectives, requirements, parentTitle } = body;

    let context = "";
    let levelName = "";
    
    if (type === "task") {
      levelName = "课堂";
      context = `任务「${title}」\n目标：${objectives}\n要求：${requirements}`;
    } else if (type === "sp") {
      levelName = "学习活动";
      context = `学习活动「${title}」\n目标：${objectives}\n要求：${requirements}`;
    } else if (type === "pc") {
      levelName = "对话活动";
      context = `对话活动「${title}」\n所属学习活动：${parentTitle}`;
    }

    const promptTemplate = `你是一位资深教育分析师。请为以下${levelName}生成一份专业的学情分析提示词模板。

${context}

请生成一份详细的中文提示词，要求：
1. 包含数据说明部分（学生会人数、对话情况、学生提问等）
2. 包含分析框架（至少4个分析维度，如参与度、知识点掌握、共性问题、教学建议）
3. 要求输出格式规范（使用### 标题）
4. 总字数控制在 400-600 字之间

直接输出提示词内容，不要额外解释。`;

    const { chatModel } = await createDashScopeClient();
    
    const result = await aiQueue.enqueue(async () => {
      return generateText({
        model: chatModel,
        system: "你是一位专业的教育分析师。",
        messages: [{ role: "user", content: promptTemplate }],
      });
    });

    return NextResponse.json({ prompt: result.text });
  } catch (error) {
    console.error("生成提示词失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 服务错误，请检查配置" },
      { status: 500 }
    );
  }
}
