import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getAIConfig } from "@/lib/ai";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("未登录", { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return new Response("登录已过期", { status: 401 });

    const exploration = await prisma.explorationActivity.findFirst({
      where: { id },
      include: {
        SubProject: {
          include: {
            task: { include: { User: { select: { name: true } } } },
          },
        },
      },
    });
    if (!exploration) return new Response("探究不存在", { status: 404 });
    if (exploration.SubProject.task.teacherId !== String(payload.userId)) {
      return new Response("无权限", { status: 403 });
    }

    // 检查是否已有提交
    const existingSubs = await prisma.explorationSubmission.count({ where: { explorationId: id } });
    if (existingSubs > 0) {
      return new Response("已有学生提交，无法重新生成题目", { status: 400 });
    }

    const task = exploration.SubProject.task;
    const aiConfig = await getAIConfig();

    const prompt = `你是一位资深学科教师，请根据以下互动探究活动内容，设计配套的答题题目。

## 活动信息
课堂名称：${task.title}
年级：${task.grade || ""}
学科：${task.subject || ""}
活动目标：${task.objectives || ""}
探究内容：${exploration.htmlContent.substring(0, 1000)}

## 出题要求
1. 共设计4道题目，总分100分
2. 题型搭配：1道单选题（25分）+ 1道多选题（25分）+ 1道填空题（25分）+ 1道简答题（25分）
3. 题目应与探究HTML内容紧密相关，考察学生对活动内容的理解
4. 填空题：标准答案应简洁准确
5. 简答题：参考答案应包含2-3个得分要点

## 输出格式
严格按以下JSON格式输出，不要包含任何其他内容：
{
  "questions": [
    {
      "id": "q1",
      "type": "SINGLE_CHOICE",
      "content": "题目内容",
      "options": {"A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D"},
      "answer": "A",
      "score": 25
    },
    {
      "id": "q2",
      "type": "MULTIPLE_CHOICE",
      "content": "题目内容",
      "options": {"A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D"},
      "answer": ["A", "C"],
      "score": 25
    },
    {
      "id": "q3",
      "type": "FILL_BLANK",
      "content": "题目内容，_____是生态系统的核心。",
      "answer": "生物多样性",
      "score": 25
    },
    {
      "id": "q4",
      "type": "SHORT_ANSWER",
      "content": "简述题内容",
      "answer": "参考答案，包含以下要点：1. ... 2. ... 3. ...",
      "score": 25
    }
  ]
}`;

    const response = await fetch(`${aiConfig.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ message: "AI 生成题目失败" }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ message: "AI 返回格式错误" }, { status: 500 });

    const parsed = JSON.parse(jsonMatch[0]);

    // 更新 exploration
    await prisma.explorationActivity.update({
      where: { id },
      data: {
        enableSubmission: true,
        questionsJson: JSON.stringify(parsed.questions),
      },
    });

    return NextResponse.json({ questions: parsed.questions, count: parsed.questions.length });
  } catch (error: any) {
    console.error("生成题目失败:", error);
    return NextResponse.json({ message: error?.message || "生成失败" }, { status: 500 });
  }
}