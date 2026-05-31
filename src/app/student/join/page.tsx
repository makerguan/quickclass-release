"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Form, Input, MessagePlugin } from "tdesign-react";
import StudentLayout from "@/components/layout/StudentLayout";

export default function StudentJoinPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleJoin = async (context: { fields?: Record<string, string> }) => {
    const values = context.fields || {};
    if (!values.inviteCode) return;

    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const user = JSON.parse(localStorage.getItem("user") || "{}");

      const res = await fetch("/api/classes/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          inviteCode: values.inviteCode,
          userId: user.id,
          name: user.name,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        MessagePlugin.success(`成功加入「${data.className}」`);
        
        // Update user's classId
        localStorage.setItem("user", JSON.stringify({ ...user, classId: data.classId }));
        router.push("/student/chat");
      } else {
        MessagePlugin.error(data.error || "加入失败");
      }
    } catch {
      MessagePlugin.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <StudentLayout>
      <div className="max-w-lg mx-auto py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-[#0052D9] to-[#00A870] rounded-2xl flex items-center justify-center shadow-lg shadow-[#0052D9]/20">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.033.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A] mb-2">加入班级</h1>
          <p className="text-[#63666F]">
            输入教师提供的邀请码，加入班级开始学习
          </p>
        </div>

        {/* Join form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <Form onSubmit={handleJoin}>
            <Form.FormItem
              name="inviteCode"
              rules={[{ required: true, message: "请输入班级邀请码" }]}
              label="邀请码"
            >
              <Input
                placeholder="例如：ABC123"
                size="large"
                className="text-center text-xl tracking-widest font-mono uppercase"
              />
            </Form.FormItem>

            <div className="mt-4 p-4 bg-[#F3F6F9] rounded-xl mb-6">
              <p className="text-sm text-[#63666F] flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#0052D9" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>邀请码由教师在创建班级时生成，请向教师获取。输入后即可加入对应班级。</span>
              </p>
            </div>

            <Button
              theme="primary"
              type="submit"
              loading={loading}
              block
              size="large"
              className="bg-gradient-to-r from-[#0052D9] to-[#0066e0]"
            >
              加入班级
            </Button>
          </Form>
        </div>

        {/* Help section */}
        <div className="mt-8 bg-[#EEF2FF] rounded-xl p-5 border border-[#0052D9]/10">
          <h3 className="font-semibold text-[#0052D9] mb-2 text-sm">找不到邀请码？</h3>
          <p className="text-xs text-[#63666F] leading-relaxed">
            邀请码由您的教师在创建班级时设置。请联系教师获取正确的邀请码。
            如果您已经加入了其他班级，可以前往 AI 对话页面直接使用。
          </p>
          <button
            onClick={() => router.push("/student/chat")}
            className="mt-3 text-sm font-medium text-[#0052D9] hover:text-[#0041b8] transition-colors"
          >
            前往 AI 对话 →
          </button>
        </div>
      </div>
    </StudentLayout>
  );
}
