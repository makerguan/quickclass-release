"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Form, Input, MessagePlugin, Radio } from "tdesign-react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [recoverType, setRecoverType] = useState<"question" | "key">("question");
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"input" | "verify" | "success">("input");
  const [hasQuestion, setHasQuestion] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  // 验证手机号
  const handleCheckPhone = async (p: string) => {
    setPhone(p);
    if (p.length < 11) return;

    try {
      const res = await fetch("/api/auth/check-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: p }),
      });
      const data = await res.json();
      if (res.ok) {
        setHasQuestion(data.hasQuestion);
        setHasKey(data.hasKey);
        setStep("verify");
      }
    } catch {
      // ignore
    }
  };

  // 通过问题答案恢复
  const handleQuestionSubmit = async (context: { fields?: Record<string, string> }) => {
    const values = context.fields || {};
    setLoading(true);
    try {
      const res = await fetch("/api/auth/recover-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          recoveryAnswer: values.recoveryAnswer,
          newPassword: "123456",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        MessagePlugin.success("密码已重置为: 123456");
        setStep("success");
      } else {
        MessagePlugin.error(data.error || "恢复失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  // 通过密钥文件恢复
  const handleKeySubmit = async (key: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/recover-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          recoveryKey: key,
          newPassword: "123456",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        MessagePlugin.success("密码已恢复为: 123456");
        setStep("success");
      } else {
        MessagePlugin.error(data.error || "密钥无效");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      // 从文件中提取密钥
      const match = content.match(/密钥[：:]\s*(.+)/);
      if (match) {
        handleKeySubmit(match[1].trim());
      } else {
        MessagePlugin.error("密钥文件格式不正确");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0052D9] to-[#00A870] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2 text-[#1A1A1A]">
          忘记密码
        </h1>
        <p className="text-center text-gray-500 mb-8">QuickClass Agent: Student-centric, Class-focused.</p>

        {step === "input" && (
          <>
            <Form>
              <Form.FormItem label="手机号">
                <Input
                  placeholder="请输入注册手机号"
                  size="large"
                  value={phone}
                  onChange={handleCheckPhone}
                />
              </Form.FormItem>
            </Form>
            <p className="text-sm text-gray-400 mt-4 text-center">
              输入手机号后点击回车，系统将检查可用的恢复方式
            </p>
          </>
        )}

        {step === "verify" && (
          <>
            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-600">手机号: {phone}</p>
            </div>

            {!hasQuestion && !hasKey && (
              <div className="text-center py-8">
                <p className="text-gray-500">该账号未设置密码恢复方式</p>
                <p className="text-sm text-gray-400 mt-2">请联系管理员或删除数据库重新注册</p>
              </div>
            )}

            {(hasQuestion || hasKey) && (
              <>
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">选择恢复方式:</p>
                  <Radio.Group value={recoverType} onChange={(v) => setRecoverType(v as any)}>
                    {hasQuestion && (
                      <Radio value="question">回答恢复问题</Radio>
                    )}
                    {hasKey && (
                      <Radio value="key">上传密钥文件</Radio>
                    )}
                  </Radio.Group>
                </div>

                {recoverType === "question" && hasQuestion && (
                  <Form onSubmit={handleQuestionSubmit}>
                    <Form.FormItem name="recoveryAnswer" rules={[{ required: true, message: "请输入答案" }]}>
                      <Input placeholder="请输入恢复问题的答案" size="large" />
                    </Form.FormItem>
                    <Button theme="primary" type="submit" size="large" block loading={loading}>
                      重置密码
                    </Button>
                  </Form>
                )}

                {recoverType === "key" && hasKey && (
                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
                      <input type="file" accept=".txt" onChange={handleFileUpload} className="hidden" id="key-upload" />
                      <div
                        className="cursor-pointer"
                        onClick={() => document.getElementById('key-upload')?.click()}
                      >
                        <p className="text-gray-500 mb-2">点击上传密钥文件</p>
                        <Button theme="primary" variant="outline" loading={loading} type="button">
                          选择文件
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 text-center">
                      密钥文件恢复后，密码将被重置为: 123456
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {step === "success" && (
          <div className="text-center py-8">
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <p className="text-lg font-medium text-[#1A1A1A] mb-2">密码已恢复</p>
            <p className="text-gray-500 mb-6">您的新密码是: <span className="font-mono font-bold">123456</span></p>
            <Button theme="primary" onClick={() => router.push("/login")}>
              返回登录
            </Button>
          </div>
        )}

        <div className="mt-6 text-center">
          <Button
            theme="default"
            variant="text"
            onClick={() => router.push("/login")}
          >
            返回登录
          </Button>
        </div>
      </div>
    </div>
  );
}