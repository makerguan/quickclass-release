import { NextResponse } from "next/server";
import { aiQueue } from "@/lib/ai-queue";

export async function POST() {
  try {
    await aiQueue.reloadConfig();
    return NextResponse.json({ success: true, message: "AI 队列配置已重载" });
  } catch (error) {
    console.error("重载 AI 队列配置失败:", error);
    return NextResponse.json(
      { error: "重载失败" }, 
      { status: 500 }
    );
  }
}
