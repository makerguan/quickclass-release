"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Form, Input, MessagePlugin } from "tdesign-react";

export default function StudentLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (context: { fields?: Record<string, string> }) => {
    const values = context.fields || {};
    setLoading(true);
    try {
      const payload: Record<string, string> = {};
      if (values.name) payload.name = values.name;
      if (values.studentNo) payload.studentNo = values.studentNo;
      if (values.inviteCode) payload.inviteCode = values.inviteCode;
      if (values.password) payload.password = values.password;

      const res = await fetch("/api/auth/student-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        MessagePlugin.success("登录成功");
        router.push("/student/chat");
      } else {
        MessagePlugin.error(data.error || "登录失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#00A870] to-[#0052D9] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2 text-[#1A1A1A]">
          学生入口
        </h1>
        <p className="text-center text-gray-500 mb-8">
          QuickClass Agent
        </p>

        <Form onSubmit={handleSubmit}>
          <Form.FormItem name="name">
            <Input placeholder="姓名" size="large" />
          </Form.FormItem>

          <Form.FormItem name="studentNo">
            <Input placeholder="学号（可选）" size="large" />
          </Form.FormItem>

          <Form.FormItem name="password">
            <Input placeholder="密码（已设置密码的学生必填）" type="password" size="large" />
          </Form.FormItem>

          <Form.FormItem name="inviteCode">
            <Input placeholder="邀请码（无密码的学生必填）" size="large" />
          </Form.FormItem>

          <Button
            theme="primary"
            type="submit"
            size="large"
            block
            loading={loading}
          >
            进入学习
          </Button>
        </Form>

        <div className="mt-6 p-4 bg-blue-50 rounded-xl text-sm text-blue-700">
          <p className="font-medium mb-2">登录方式：</p>
          <ul className="list-disc list-inside space-y-1 text-blue-600">
            <li><strong>有密码：</strong>姓名或学号 + 密码</li>
            <li><strong>无密码：</strong>姓名或学号 + 邀请码</li>
          </ul>
        </div>

        <div className="mt-6 text-center">
          <Button
            theme="default"
            variant="text"
            size="small"
            onClick={() => router.push("/")}
          >
            返回首页
          </Button>
        </div>
      </div>
    </div>
  );
}
