"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, MessagePlugin } from "tdesign-react";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true); // 正在检查是否已有用户
  const [hasUsers, setHasUsers] = useState(false);

  useEffect(() => {
    fetch("/api/auth/check-users")
      .then(res => res.json())
      .then(data => {
        if (data.hasUsers) {
          // 有用户，跳转登录
          router.replace("/login");
        } else {
          setHasUsers(false);
          setChecking(false);
        }
      })
      .catch(() => {
        // 出错时也跳转登录页（比停留在设置页更安全）
        router.replace("/login");
      });
  }, [router]);

  const [showRecoveryKey, setShowRecoveryKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [phoneForKey, setPhoneForKey] = useState("");
  const [showImport, setShowImport] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    school: "",
    password: "",
    confirmPassword: "",
    recoveryQuestion: "",
    recoveryAnswer: "",
  });

  const validateSchool = (value: string): boolean => {
    const keywords = ["学", "园", "院", "中心", "学校", "幼", "培训"];
    return keywords.some(k => value.includes(k));
  };

  const validatePhone = (value: string): boolean => {
    return /^1[3-9]\d{9}$/.test(value);
  };

  const handleChange = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name) { MessagePlugin.error("请输入姓名"); return; }
    if (!validatePhone(form.phone)) { MessagePlugin.error("请输入正确的手机号"); return; }
    if (!form.email) { MessagePlugin.error("请输入邮箱"); return; }
    if (!form.school) { MessagePlugin.error("请输入学校/机构"); return; }
    if (!validateSchool(form.school)) {
      MessagePlugin.error("学校名称需包含'学'、'园'、'院'、'中心'等关键词");
      return;
    }
    if (!form.password || form.password.length < 6) { MessagePlugin.error("密码至少6位"); return; }
    if (form.password !== form.confirmPassword) { MessagePlugin.error("两次密码不一致"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: form.phone,
          email: form.email,
          password: form.password,
          name: form.name,
          school: form.school,
          recoveryQuestion: form.recoveryQuestion || null,
          recoveryAnswer: form.recoveryAnswer || null,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        MessagePlugin.success("用户设置完成");
        if (data.recoveryKey) {
          setRecoveryKey(data.recoveryKey);
          setPhoneForKey(form.phone);
          setShowRecoveryKey(true);
          setLoading(false);
          return;
        }
        router.push("/teacher/tasks");
      } else {
        MessagePlugin.error(data.error || "设置失败");
      }
    } catch { MessagePlugin.error("网络错误"); }
    finally { setLoading(false); }
  };

  const handleImportKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target?.result as string;
      try {
        setLoading(true);
        const res = await fetch("/api/auth/import-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyFile: content }),
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem("token", data.token);
          localStorage.setItem("user", JSON.stringify(data.user));
          MessagePlugin.success("账号导入成功");
          router.push("/teacher/tasks");
        } else { MessagePlugin.error(data.error || "导入失败"); }
      } catch { MessagePlugin.error("网络错误"); }
      finally { setLoading(false); }
    };
    reader.readAsText(file);
  };

  const handleDownloadKey = () => {
    const content = `QuickClass 密码恢复密钥\n手机号: ${phoneForKey}\n密钥: ${recoveryKey}\n\n请妥善保管此文件，用于忘记密码时恢复。`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quickclass-recovery-key-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKeyConfirmed = () => {
    setShowRecoveryKey(false);
    router.push("/teacher/tasks");
  };

  const inputCls = "w-full !rounded-lg border-gray-200 focus:border-[#0052D9] focus:ring-1 focus:ring-[#0052D9]";

  // 检查中：显示加载状态
  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0052D9] to-[#00A870] flex items-center justify-center">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-3"></div>
          <p className="text-sm">正在加载...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0052D9] to-[#00A870] flex items-center justify-center py-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <p className="text-center text-gray-400 text-xs mb-2">觉课智能体</p>
        <h1 className="text-xl font-bold text-center mb-1 text-[#1A1A1A]">
          {showImport ? "导入已有账号" : "觉课智能体用户配置"}
        </h1>
        <p className="text-center text-gray-400 text-xs mb-5">QuickClass Agent: Student-centric, Class-focused.</p>

        {!showImport ? (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <Input placeholder="* 手机号" size="medium" className={inputCls}
                onChange={(v) => handleChange("phone", v as string)} />
              <Input placeholder="* 邮箱" size="medium" className={inputCls}
                onChange={(v) => handleChange("email", v as string)} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Input placeholder="* 姓名" size="medium" className={inputCls}
                onChange={(v) => handleChange("name", v as string)} />
              <Input placeholder="* 学校/机构" size="medium" className={inputCls}
                onChange={(v) => handleChange("school", v as string)} />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Input placeholder="* 密码" type="password" size="medium" className={inputCls}
                onChange={(v) => handleChange("password", v as string)} />
              <Input placeholder="* 确认密码" type="password" size="medium" className={inputCls}
                onChange={(v) => handleChange("confirmPassword", v as string)} />
            </div>

            <details className="text-xs text-gray-400">
              <summary className="cursor-pointer select-none text-gray-500">设置密码恢复（可选）</summary>
              <div className="mt-2 space-y-2">
                <Input placeholder="恢复问题，如：我最喜欢的数字是？" size="medium" className={inputCls}
                  onChange={(v) => handleChange("recoveryQuestion", v as string)} />
                <Input placeholder="答案" size="medium" className={inputCls}
                  onChange={(v) => handleChange("recoveryAnswer", v as string)} />
              </div>
            </details>

            <Button theme="primary" size="medium" block loading={loading}
              onClick={handleSubmit}
              className="!mt-3">
              完成用户设置
            </Button>

            <div className="text-center mt-1">
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
              <input type="file" accept=".txt" onChange={handleImportKey} className="hidden" id="key-import" />
              <div
                className="cursor-pointer"
                onClick={() => document.getElementById('key-import')?.click()}
              >
                <p className="text-gray-500 text-xs mb-2">上传从资源广场下载的密钥文件</p>
                <Button theme="primary" variant="outline" size="small" loading={loading} type="button">选择文件</Button>
              </div>
            </div>
            <Button theme="default" variant="text" block size="small" onClick={() => setShowImport(false)}>
              ← 返回
            </Button>
          </div>
        )}
      </div>

      {/* 密钥文件弹窗 */}
      {showRecoveryKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 mx-4">
            <h3 className="text-base font-semibold text-[#1A1A1A] mb-3">保存密钥文件</h3>
            <div className="bg-yellow-50 p-2.5 rounded-lg mb-3">
              <p className="text-xs text-yellow-700">
                请保存以下密钥文件，用于忘记密码时恢复。只能下载一次，请妥善保管！
              </p>
            </div>
            <div className="bg-gray-100 p-2.5 rounded-lg mb-3 break-all">
              <p className="text-xs text-gray-600 mb-1">密钥:</p>
              <p className="text-xs font-mono text-gray-800">{recoveryKey}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="small" onClick={handleKeyConfirmed}>已保存</Button>
              <Button theme="primary" size="small" onClick={handleDownloadKey}>下载密钥文件</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
