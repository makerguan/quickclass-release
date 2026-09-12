"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Form, Input, MessagePlugin } from "tdesign-react";

interface CandidateClass {
  classId: string;
  className: string;
}

export default function StudentLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // 同名学生跨班多账号时：暂存登录凭证与候选班级，供二次选择课堂
  const [pendingPayload, setPendingPayload] = useState<Record<string, string> | null>(null);
  const [pendingClasses, setPendingClasses] = useState<CandidateClass[]>([]);
  const [classSelectVisible, setClassSelectVisible] = useState(false);

  const doLogin = async (payload: Record<string, string>) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/student-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        // 姓名在多个班级都有账号且密码均匹配：先选择课堂再完成登录
        if (data.needClassSelection) {
          setPendingPayload(payload);
          setPendingClasses(data.classes || []);
          setClassSelectVisible(true);
          return;
        }
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

  const handleSubmit = async (context: { fields?: Record<string, string> }) => {
    const values = context.fields || {};
    const payload: Record<string, string> = {};
    if (values.name) payload.name = values.name;
    if (values.studentNo) payload.studentNo = values.studentNo;
    if (values.inviteCode) payload.inviteCode = values.inviteCode;
    if (values.password) payload.password = values.password;

    await doLogin(payload);
  };

  const handleSelectClass = async (classId: string) => {
    if (!pendingPayload) return;
    setClassSelectVisible(false);
    const payload = { ...pendingPayload, classId };
    setPendingPayload(null);
    await doLogin(payload);
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

      <Dialog
        header="请选择你的班级"
        visible={classSelectVisible}
        onClose={() => {
          setClassSelectVisible(false);
          setPendingPayload(null);
        }}
        footer={null}
        closeOnOverlayClick={false}
      >
        <div className="space-y-3">
          <p className="text-gray-700 text-sm">
            检测到该姓名在多个班级都有账号，请选择要进入的课堂：
          </p>
          <div className="space-y-2">
            {pendingClasses.map((c) => (
              <Button
                key={c.classId}
                theme="primary"
                variant="outline"
                block
                loading={loading}
                onClick={() => handleSelectClass(c.classId)}
              >
                {c.className}
              </Button>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
