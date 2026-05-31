import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { aiBaseUrl, aiApiKey, aiModel, reasoningEnabled } = await req.json();

    if (!aiBaseUrl || !aiApiKey || !aiModel) {
      return NextResponse.json(
        { success: false, error: "请填写完整的配置信息（URL、API Key、模型）" },
        { status: 400 }
      );
    }

    // 确保 baseURL 不以 / 结尾
    const baseURL = aiBaseUrl.replace(/\/+$/, "");
    const url = `${baseURL}/chat/completions`;

    // 直接用 fetch 调用 OpenAI 兼容接口
    // 先用 max_tokens=5 测试基础连接（不触发思考模式）
      const basicResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aiApiKey}`,
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [{ role: "user", content: "你好，请用一句话回复确认连接成功。" }],
          max_tokens: 5,
        }),
      });

      // 思考模式测试（仅针对 DeepSeek）
      let reasoningContent: string | undefined;
      let thinkingEnabled = false;
      let thinkingTestDone = false;
      if (baseURL.includes("deepseek.com")) {
        thinkingTestDone = true;

        // 根据用户配置决定是否启用思考模式
        // 参考官方文档: https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
        // 注意: DeepSeek V4 默认开启思考模式，所以关闭时必须传 reasoning_effort="none"
        const thinkingRequestBody: Record<string, unknown> = {
          model: aiModel,
          messages: [{ role: "user", content: "请解释为什么天空是蓝色的？" }],
          max_tokens: 500,
        };
        if (reasoningEnabled) {
          // 启用思考模式
          thinkingRequestBody.reasoning_effort = "high";
          thinkingRequestBody.extra_body = { thinking: { type: "enabled" } };
        } else {
          // 明确禁用思考模式（否则 DeepSeek V4 默认会开启）
          thinkingRequestBody.reasoning_effort = "none";
        }

        const thinkingResponse = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aiApiKey}`,
          },
          body: JSON.stringify(thinkingRequestBody),
        });

        if (thinkingResponse.ok) {
          const thinkingData = await thinkingResponse.json();
          reasoningContent = thinkingData.choices?.[0]?.message?.reasoning_content;
          thinkingEnabled = !!reasoningContent;
        }
      }

      if (!basicResponse.ok) {
        let errorDetail = `HTTP ${basicResponse.status}`;
        try {
          const errorBody = await basicResponse.json();
          errorDetail = errorBody.error?.message || errorBody.message || errorDetail;
        } catch {
          // 忽略 JSON 解析失败
        }
        return NextResponse.json(
          { success: false, error: `API 返回错误：${errorDetail}`, thinkingEnabled, thinkingTestDone },
          { status: 500 }
        );
      }

      const basicData = await basicResponse.json();
      const basicReply = basicData.choices?.[0]?.message?.content || "（无回复内容）";

      return NextResponse.json({
        success: true,
        message: "连接成功",
        response: basicReply,
        model: aiModel,
        thinkingEnabled,
        thinkingTestDone,
        reasoningContent: reasoningContent ? reasoningContent.slice(0, 200) + "..." : undefined,
      });
  } catch (error) {
    console.error("AI connection test error:", error);
    const message = error instanceof Error ? error.message : "连接失败";
    return NextResponse.json({ success: false, error: `连接失败：${message}` }, { status: 500 });
  }
}
