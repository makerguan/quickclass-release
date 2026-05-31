"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Form, Input, MessagePlugin } from "tdesign-react";


export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (context: { fields?: Record<string, string> }) => {
    const values = context.fields || {};
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        MessagePlugin.success("登录成功");

        // 检查是否已有课堂，决定跳转页面
        try {
          const tasksRes = await fetch("/api/tasks", {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          if (tasksRes.ok) {
            const tasksData = await tasksRes.json();
            router.push(tasksData.length > 0 ? "/teacher/tasks" : "/teacher/settings");
          } else {
            router.push("/teacher/settings");
          }
        } catch {
          router.push("/teacher/settings");
        }
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
    <div className="min-h-screen bg-gradient-to-br from-[#0052D9] to-[#00A870] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2 text-[#1A1A1A]">
          教师登录
        </h1>
        <p className="text-center text-gray-500 mb-8">QuickClass Agent: Student-centric, Class-focused.</p>

        <Form onSubmit={handleSubmit}>
          <Form.FormItem name="phone" rules={[{ required: true, message: "请输入手机号" }]}>
            <Input placeholder="手机号" size="large" />
          </Form.FormItem>

          <Form.FormItem name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input placeholder="密码" type="password" size="large" />
          </Form.FormItem>

          <Button
            theme="primary"
            type="submit"
            size="large"
            block
            loading={loading}
          >
            登录
          </Button>
        </Form>

        <div className="mt-4 text-center">
          <Button
            theme="default"
            variant="text"
            size="small"
            onClick={() => router.push("/forgot-password")}
          >
            忘记密码
          </Button>
        </div>
      </div>
    </div>
  );
}
