"use client";

import { useEffect, useState } from "react";
import { Button, Input, MessagePlugin, Switch, Radio } from "tdesign-react";
import TeacherLayout from "@/components/layout/TeacherLayout";

// SystemConfig 类型定义
interface SystemConfig {
  id?: string;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiMaxConcurrent?: number;
  reasoningEnabled?: boolean;
  updatedAt?: string;

  studentWordLimit?: number | null;
  classWordLimit?: number | null;
  requireStarRating?: boolean;
  conversationWarningThreshold?: number;
  conversationCount?: number;
}

// 用户信息类型
interface UserProfile {
  id: string;
  email: string;
  name: string;
  gender?: string | null;
  phone?: string | null;
  school?: string | null;
}

export default function TeacherSettingsPage() {
  const [config, setConfig] = useState<SystemConfig>({
    aiBaseUrl: "",
    aiApiKey: "",
    aiModel: "qwen-turbo",
    reasoningEnabled: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [backupFileName, setBackupFileName] = useState("");
  const [versionInfo, setVersionInfo] = useState<{ version: string; buildTime?: string } | null>(null);

  // 学情分析约束配置
  const [requireStarRating, setRequireStarRating] = useState(false);
  const [studentWordLimit, setStudentWordLimit] = useState<number | null>(null);
  const [classWordLimit, setClassWordLimit] = useState<number | null>(null);
  const [insightDataSource, setInsightDataSource] = useState("CONVERSATIONS");
  const [aiMaxConcurrent, setAiMaxConcurrent] = useState(20);
  const [savingWordLimit, setSavingWordLimit] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [conversationCount, setConversationCount] = useState(0);
  const [conversationWarningThreshold, setConversationWarningThreshold] = useState(20000);

  // 卡片展开状态
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({
    aiConfig: false,
    userProfile: false,
    insightConfig: false,
    systemInfo: false,
  });

  // 切换卡片展开/折叠
  const toggleCard = (key: string) => {
    setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 用户信息状态
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    gender: "",
    phone: "",
    school: "",
    email: "",
    password: "",
    oldPassword: "",
    motto: "",
    studentMotto: "",
  });

  useEffect(() => {
    fetchConfig();
    fetchUserProfile();
    fetchVersion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchVersion = async () => {
    try {
      const res = await fetch("/api/version");
      if (res.ok) {
        const data = await res.json();
        setVersionInfo(data);
      }
    } catch {
      // 忽略版本获取失败
    }
  };

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/system-config", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        // 获取分析约束配置
        setRequireStarRating(data.requireStarRating ?? false);
        setStudentWordLimit(data.studentWordLimit ?? null);
        setClassWordLimit(data.classWordLimit ?? null);
        setInsightDataSource(data.insightDataSource ?? "CONVERSATIONS");
        setAiMaxConcurrent(data.aiMaxConcurrent || 20);
        setConversationCount(data.conversationCount ?? 0);
        setConversationWarningThreshold(data.conversationWarningThreshold ?? 20000);
        // 从系统配置加载学生座右铭
        if (data.studentMotto) {
          setProfileForm((prev) => ({ ...prev, studentMotto: data.studentMotto }));
        }
        setConfigLoaded(true);
      } else {
        setConfigLoaded(true);
      }
    } catch {
      console.error("获取配置失败");
      setConfigLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  // 获取用户信息
  const fetchUserProfile = async () => {
    setProfileLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/auth/teacher/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUserProfile(data);
        setProfileForm({
          name: data.name || "",
          gender: data.gender || "",
          phone: data.phone || "",
          school: data.school || "",
          email: data.email || "",
          password: "",
          oldPassword: "",
          motto: data.motto || "",
          studentMotto: data.studentMotto || "",
        });
      }
    } catch {
      console.error("获取用户信息失败");
    } finally {
      setProfileLoading(false);
    }
  };

  // 保存用户信息
  const handleSaveProfile = async () => {
    if (!profileForm.name) {
      MessagePlugin.warning("请输入姓名");
      return;
    }
    if (!profileForm.phone) {
      MessagePlugin.warning("请输入手机号");
      return;
    }

    // 如果要修改密码，必须同时填写当前密码和新密码
    if (profileForm.password || profileForm.oldPassword) {
      if (!profileForm.oldPassword) {
        MessagePlugin.warning("请输入当前密码");
        return;
      }
      if (!profileForm.password) {
        MessagePlugin.warning("请输入新密码");
        return;
      }
    }

    setProfileSaving(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/auth/teacher/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: profileForm.name,
          gender: profileForm.gender || null,
          school: profileForm.school || null,
          motto: profileForm.motto || null,
          studentMotto: profileForm.studentMotto || null,
          ...(profileForm.password ? { password: profileForm.password, oldPassword: profileForm.oldPassword } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setUserProfile(data);
        setProfileForm((prev) => ({ 
          ...prev, 
          password: "", 
          oldPassword: "",
          name: data.name || "",
          gender: data.gender || "",
          motto: data.motto || "",
          studentMotto: data.studentMotto || ""
        }));

        // 更新本地存储的用户信息
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
          const user = JSON.parse(storedUser);
          user.name = data.name;
          user.gender = data.gender;
          user.motto = data.motto;
          user.studentMotto = data.studentMotto;
          localStorage.setItem("user", JSON.stringify(user));
        }

        // 同步保存学生座右铭到系统配置
        try {
          const token = localStorage.getItem("token");
          const syncRes = await fetch("/api/system-config", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ studentMotto: data.studentMotto || null }),
          });
          if (!syncRes.ok) {
            console.error("同步学生座右铭失败:", await syncRes.json());
          }
        } catch (syncError) {
          console.error("同步学生座右铭异常:", syncError);
        }

        MessagePlugin.success("用户信息已保存");
      } else {
        const data = await res.json().catch(() => ({}));
        MessagePlugin.error(data.error || "保存失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setProfileSaving(false);
    }
  };

  // 检查用户信息是否完整
  const isProfileIncomplete = () => {
    if (!userProfile) return false;
    return !userProfile.name || !userProfile.phone || !userProfile.gender || !userProfile.school;
  };

  // 更新全局 AI 配置
  const handleSaveConfig = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/system-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          aiBaseUrl: config.aiBaseUrl,
          aiApiKey: config.aiApiKey,
          aiModel: config.aiModel,
          aiMaxConcurrent,
          studentWordLimit,
          classWordLimit,
          requireStarRating,
        }),
      });
      if (res.ok) {
        MessagePlugin.success("配置已更新");
      } else {
        const data = await res.json().catch(() => ({}));
        MessagePlugin.error(data.error || data.details || "更新失败");
      }
    } catch (e) {
      console.error("保存全局配置失败:", e);
      MessagePlugin.error("网络错误");
    }
  };

  // 统一的保存约束配置函数
  const handleSaveLimits = async () => {
    setSavingWordLimit(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/system-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          aiBaseUrl: config.aiBaseUrl,
          aiApiKey: config.aiApiKey,
          aiModel: config.aiModel,
          aiMaxConcurrent,
          studentWordLimit,
          classWordLimit,
          requireStarRating,
          insightDataSource,
        }),
      });

      if (res.ok) {
        MessagePlugin.success("限制配置已保存");
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || err.details || "保存失败");
      }
    } catch (e) {
      console.error("保存约束配置失败:", e);
      MessagePlugin.error("网络错误：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingWordLimit(false);
    }
  };

  const handleSave = async () => {
    if (!config.aiBaseUrl || !config.aiApiKey) {
      MessagePlugin.warning("请填写 API URL 和 API Key");
      return;
    }
    if (!config.aiModel) {
      MessagePlugin.warning("请输入模型名称");
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/system-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          aiBaseUrl: config.aiBaseUrl,
          aiApiKey: config.aiApiKey,
          aiModel: config.aiModel,
          aiMaxConcurrent,
          reasoningEnabled: config.reasoningEnabled,
          studentWordLimit,
          classWordLimit,
          requireStarRating,
          insightDataSource,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        // 同步更新 aiMaxConcurrent 状态
        if (data.aiMaxConcurrent !== undefined) {
          setAiMaxConcurrent(data.aiMaxConcurrent);
        }
        MessagePlugin.success("配置已保存");
        
        // 重载 AI 队列配置
        await fetch("/api/system-config/reload-queue", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        const data = await res.json().catch(() => ({}));
        MessagePlugin.error(data.error || "保存失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config.aiBaseUrl || !config.aiApiKey) {
      MessagePlugin.warning("请先填写 API URL 和 API Key");
      return;
    }
    if (!config.aiModel) {
      MessagePlugin.warning("请输入模型名称");
      return;
    }

    setTesting(true);
    try {
      const res = await fetch("/api/system-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiBaseUrl: config.aiBaseUrl,
          aiApiKey: config.aiApiKey,
          aiModel: config.aiModel,
          reasoningEnabled: config.reasoningEnabled,
        }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.thinkingEnabled) {
          MessagePlugin.success("思考模式，连接成功！");
        } else {
          MessagePlugin.success("非思考模式，连接成功");
        }
      } else {
        MessagePlugin.error("连接不成功");
      }
    } catch {
      MessagePlugin.error("连接测试失败");
    } finally {
      setTesting(false);
    }
  };

  // 备份配置
  const handleBackup = () => {
    const modelName = config.aiModel || "ai-config";
    const date = new Date().toISOString().slice(0, 10);
    const defaultName = `${modelName}-${date}`;
    setBackupFileName(defaultName);
    setShowBackupDialog(true);
  };

  const confirmBackup = () => {
    if (!backupFileName.trim()) {
      MessagePlugin.warning("请输入文件名");
      return;
    }
    const data = {
      aiBaseUrl: config.aiBaseUrl,
      aiApiKey: config.aiApiKey,
      aiModel: config.aiModel,
      aiMaxConcurrent,
      reasoningEnabled: config.reasoningEnabled,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${backupFileName.trim()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowBackupDialog(false);
    MessagePlugin.success("配置已备份");
  };

  // 导入配置
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        console.log("[导入配置] 文件内容:", text);
        
        const data = JSON.parse(text);
        console.log("[导入配置] 解析后数据:", data);
        
        // 验证至少有一个核心字段存在
        if (data.aiBaseUrl === undefined && data.aiApiKey === undefined && data.aiModel === undefined) {
          MessagePlugin.error("无效的配置文件，缺少 AI 服务配置字段");
          return;
        }
        const token = localStorage.getItem("token");
        
        // 构建更新数据，只包含配置文件中存在的字段
        const updatePayload: Record<string, unknown> = {};
        if (data.aiBaseUrl !== undefined) updatePayload.aiBaseUrl = data.aiBaseUrl;
        if (data.aiApiKey !== undefined) updatePayload.aiApiKey = data.aiApiKey;
        if (data.aiModel !== undefined) updatePayload.aiModel = data.aiModel;
        if (data.aiMaxConcurrent !== undefined) updatePayload.aiMaxConcurrent = data.aiMaxConcurrent;
        if (data.reasoningEnabled !== undefined) updatePayload.reasoningEnabled = data.reasoningEnabled;
        if (data.insightDataSource !== undefined) updatePayload.insightDataSource = data.insightDataSource;
        // 保留当前的学情配置
        updatePayload.studentWordLimit = studentWordLimit;
        updatePayload.classWordLimit = classWordLimit;
        updatePayload.requireStarRating = requireStarRating;

        console.log("[导入配置] 发送的数据:", updatePayload);
        
        const res = await fetch("/api/system-config", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updatePayload),
        });
        
        console.log("[导入配置] 响应状态:", res.status, res.statusText);
        
        if (res.ok) {
          const result = await res.json();
          setConfig(result);
          // 同步所有本地状态
          if (result.aiMaxConcurrent !== undefined) {
            setAiMaxConcurrent(result.aiMaxConcurrent);
          }
          if (result.studentWordLimit !== undefined) {
            setStudentWordLimit(result.studentWordLimit);
          }
          if (result.classWordLimit !== undefined) {
            setClassWordLimit(result.classWordLimit);
          }
          if (result.requireStarRating !== undefined) {
            setRequireStarRating(result.requireStarRating);
          }
          
          MessagePlugin.success("配置已导入并保存");
          
          // 重载 AI 队列配置
          await fetch("/api/system-config/reload-queue", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
        } else {
          const err = await res.json().catch(() => ({}));
          console.error("[导入配置] 失败响应:", err);
          console.error("[导入配置] 响应状态:", res.status);
          MessagePlugin.error(`导入失败: ${err.error || err.details || "未知错误"}`);
        }
      } catch (error) {
        console.error("[导入配置] 异常:", error);
        MessagePlugin.error(`文件解析失败: ${error instanceof Error ? error.message : "未知错误"}`);
      }
    };
    input.click();
  };

  return (
    <TeacherLayout>
      <div className="max-w-3xl space-y-4 pb-8">
        {/* Page header */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1A1A]">系统设置</h1>
              <p className="text-[#63666F] mt-1">配置 AI 服务和管理系统参数</p>
            </div>
            {versionInfo && (
              <div className="text-right">
                <div className="text-sm font-medium text-[#0052D9]">{versionInfo.version}</div>
                <div className="text-xs text-[#63666F]">
                  {versionInfo.buildTime ? new Date(versionInfo.buildTime).toLocaleDateString("zh-CN") : ""}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 对话记录预警提示 */}
        {configLoaded && conversationCount > 0 && (
          <div className={`p-4 rounded-xl border ${
            conversationCount >= conversationWarningThreshold
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200"
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                conversationCount >= conversationWarningThreshold
                  ? "bg-red-500"
                  : "bg-amber-500"
              }`}>
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${
                  conversationCount >= conversationWarningThreshold
                    ? "text-red-700"
                    : "text-amber-700"
                }`}>
                  当前对话记录: {conversationCount.toLocaleString()} 条
                  {conversationCount >= conversationWarningThreshold
                    ? "，已超过预警阈值，建议清理归档"
                    : `（预警阈值: ${conversationWarningThreshold.toLocaleString()} 条）`
                  }
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  对话记录过多会影响系统性能，建议定期归档历史对话
                </p>
              </div>
            </div>
          </div>
        )}

        {/* AI 服务配置 - 可折叠卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleCard("aiConfig")}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-[#0052D9] to-[#00A870] rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              </div>
              <span className="font-medium text-[#1A1A1A]">AI 服务配置</span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${expandedCards.aiConfig ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {expandedCards.aiConfig && (
            <div className="px-6 pb-6 border-t border-gray-100">
              {loading ? (
                <div className="py-8 text-center text-gray-400">加载中...</div>
              ) : (
                <div className="space-y-5 pt-4">
                  <div>
                    <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                      API Base URL
                    </label>
                    <Input
                      value={config.aiBaseUrl}
                      onChange={(val) => setConfig({ ...config, aiBaseUrl: val })}
                      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                      size="large"
                    />
                    <p className="text-xs text-[#63666F] mt-1.5">
                      支持 OpenAI 兼容接口的 AI 服务地址（如通义千问 DashScope、DeepSeek、智谱等）
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                      API Key
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={config.aiApiKey}
                        onChange={(val) => setConfig({ ...config, aiApiKey: val })}
                        type={showApiKey ? "text" : "password"}
                        placeholder="sk-xxxxxxxxxxxxxxxx"
                        size="large"
                        className="flex-1"
                      />
                      <Switch
                        value={showApiKey}
                        onChange={(val) => setShowApiKey(val)}
                        label={["显示", "隐藏"]}
                      />
                    </div>
                    <p className="text-xs text-[#63666F] mt-1.5">
                      API Key 仅存储在本地数据库中，不会上传到任何第三方服务
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                      AI 模型
                    </label>
                    <Input
                      value={config.aiModel}
                      onChange={(val) => setConfig({ ...config, aiModel: val })}
                      placeholder="输入模型名称，如 qwen-turbo、gpt-4o"
                      size="large"
                    />
                    <p className="text-xs text-[#63666F] mt-1.5">
                      支持 OpenAI 兼容接口的模型名称，如 qwen-turbo、gpt-4o、deepseek-chat 等
                    </p>
                  </div>

                  {/* 思考模式开关 */}
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-[#F0F7FF] border border-[#D0E4FF]">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-[#0052D9] flex items-center justify-center flex-shrink-0 mt-0.5">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#1A1A1A]">推理思考模式</p>
                          <p className="text-xs text-[#63666F] mt-0.5">
                            启用后，DeepSeek 模型会返回 <code className="bg-white px-1 py-0.5 rounded">reasoning_content</code>（内部思考过程），消耗更多 token，但回答质量更高
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-[#0052D9] mt-2 ml-7">
                        注意：仅 DeepSeek V4 系列模型（如 deepseek-v4-flash、deepseek-v4-pro）支持此功能，开启后对话响应可能变慢
                      </p>
                    </div>
                    <Switch
                      value={config.reasoningEnabled ?? true}
                      onChange={(val) => setConfig({ ...config, reasoningEnabled: val })}
                    />
                  </div>

                  {/* AI 并发限制 */}
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#1A1A1A]">AI 并发限制</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        同时处理的 AI 请求数量。数值越大响应越快，但可能触发 API 限流
                      </p>
                      <p className="text-xs text-[#0052D9] mt-1">
                        建议：小班课(≤30人)设 10-20，中班课(30-60人)设 20-40，大班课(60+人)设 40-100
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={String(aiMaxConcurrent)}
                        onChange={(val) => setAiMaxConcurrent(Number(val) || 20)}
                        style={{ width: "120px" }}
                      />
                      <span className="text-xs text-gray-400">个</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                    <Button
                      theme="primary"
                      onClick={handleSave}
                      loading={saving}
                      className="bg-gradient-to-r from-[#0052D9] to-[#0066e0]"
                    >
                      保存配置
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleTestConnection}
                      loading={testing}
                    >
                      测试连接
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleBackup}
                    >
                      备份配置
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleImport}
                    >
                      导入配置
                    </Button>
                  </div>

                  {/* Status info */}
                  <div className={`p-4 rounded-xl ${config.aiBaseUrl && config.aiApiKey && config.aiModel ? "bg-[#ECFDF5]" : "bg-[#FFF7ED]"}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${config.aiBaseUrl && config.aiApiKey && config.aiModel ? "bg-[#00A870]" : "bg-[#ED7B2F]"}`}>
                        {config.aiBaseUrl && config.aiApiKey && config.aiModel ? (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${config.aiBaseUrl && config.aiApiKey && config.aiModel ? "text-[#00A870]" : "text-[#ED7B2F]"}`}>
                          {config.aiBaseUrl && config.aiApiKey && config.aiModel
                            ? `AI 服务已配置（${config.aiModel}）`
                            : "AI 服务未配置"}
                        </p>
                        <p className="text-xs text-[#63666F] mt-0.5">
                          {config.aiBaseUrl && config.aiApiKey && config.aiModel
                            ? "学生可以正常与 AI 智能体对话"
                            : "请填写完整的 AI 服务配置，否则学生无法使用对话功能"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 用户信息设置 - 可折叠卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleCard("userProfile")}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-[#ED7B2F] to-[#0052D9] rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <span className="font-medium text-[#1A1A1A]">用户信息设置</span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${expandedCards.userProfile ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {expandedCards.userProfile && (
            <div className="px-6 pb-6 border-t border-gray-100">
          {isProfileIncomplete() && (
            <div className="mb-4 p-3 rounded-lg bg-[#FFF7ED] border border-[#ED7B2F]/20">
              <p className="text-sm text-[#ED7B2F]">
                您的用户信息不完整，请完善以下信息
              </p>
            </div>
          )}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                  姓名 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={profileForm.name}
                  disabled
                  placeholder="请输入姓名"
                  size="large"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                  性别
                </label>
                <div className="flex gap-4">
                  {["男", "女"].map((g) => (
                    <label key={g} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="gender"
                        value={g}
                        checked={profileForm.gender === g}
                        onChange={() => setProfileForm({ ...profileForm, gender: g })}
                        className="w-4 h-4 text-[#0052D9]"
                      />
                      <span className="text-sm text-[#1A1A1A]">{g}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                  手机号 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={profileForm.phone}
                  disabled
                  placeholder="请输入手机号（用于登录）"
                  size="large"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                  单位（学校）名称
                </label>
                <Input
                  value={profileForm.school}
                  onChange={(val) => setProfileForm({ ...profileForm, school: val })}
                  placeholder="请输入学校名称"
                  size="large"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-[#63666F] mb-2">
                邮箱（已绑定，不可修改）
              </label>
              <Input
                value={profileForm.email}
                disabled
                placeholder="请输入邮箱（可选）"
                size="large"
              />
            </div>

            <div className="pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                老师座右铭
              </label>
              <Input
                value={profileForm.motto}
                onChange={(val) => setProfileForm({ ...profileForm, motto: val })}
                placeholder="输入您的座右铭，将显示在工作台顶部"
                size="large"
              />
            </div>

            <div className="pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                学生座右铭
              </label>
              <Input
                value={profileForm.studentMotto}
                onChange={(val) => setProfileForm({ ...profileForm, studentMotto: val })}
                placeholder="输入统一的学生座右铭，将显示在所有学生端顶部"
                size="large"
              />
            </div>

            <div className="pt-4 border-t border-gray-200">
              <h4 className="text-sm font-medium text-[#1A1A1A] mb-3">修改密码（选填）</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                    当前密码
                  </label>
                  <Input
                    value={profileForm.oldPassword}
                    onChange={(val) => setProfileForm({ ...profileForm, oldPassword: val })}
                    type="password"
                    placeholder="请输入当前密码"
                    size="large"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                    新密码
                  </label>
                  <Input
                    value={profileForm.password}
                    onChange={(val) => setProfileForm({ ...profileForm, password: val })}
                    type="password"
                    placeholder="请输入新密码"
                    size="large"
                  />
                </div>
              </div>
              <p className="text-xs text-[#63666F] mt-2">
                如需修改密码，请同时填写当前密码和新密码
              </p>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <Button
                theme="primary"
                onClick={handleSaveProfile}
                loading={profileSaving}
              >
                保存用户信息
              </Button>
            </div>
          </div>
          </div>
          )}
        </div>

        {/* 学情洞察配置 - 可折叠卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleCard("insightConfig")}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-[#00A870] to-[#0052D9] rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <span className="font-medium text-[#1A1A1A]">学情洞察配置</span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${expandedCards.insightConfig ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {expandedCards.insightConfig && (
            <div className="px-6 pb-6 border-t border-gray-100">
              <div className="space-y-4 pt-4">

                {/* 输出约束配置 */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">学情分析约束</h3>

                  <div className="space-y-4">
                    {/* 星星评分开关 */}
                    <div className="flex items-center gap-3">
                    <Switch
                      value={requireStarRating}
                      onChange={(val) => setRequireStarRating(val)}
                    />
                      <div>
                        <span className="text-sm font-medium text-[#1A1A1A]">启动指数评价（限对学生的对话活动）</span>
                        <p className="text-xs text-[#63666F]">开启后，学生分析只输出 6-10 个★评分，不显示任何文字</p>
                      </div>
                    </div>

                    {/* 字数限制 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-[#63666F] mb-2">
                          个人分析字数上限
                          <span className="text-xs text-[#0052D9] ml-1">
                            （当前: {studentWordLimit ?? "不限"} 字）
                          </span>
                        </label>
                        <Input
                          value={studentWordLimit !== null ? String(studentWordLimit) : ""}
                          onChange={(val) => {
                            const str = String(val).trim();
                            if (str === "") {
                              setStudentWordLimit(null);
                            } else {
                              const num = parseInt(str);
                              if (!isNaN(num) && num > 0) {
                                setStudentWordLimit(num);
                              }
                            }
                          }}
                          placeholder="留空则不限"
                          size="large"
                        />
                        <p className="text-xs text-[#63666F] mt-1">建议范围: 100-5000 字，留空则不限制</p>
                      </div>
                      <div>
                        <label className="block text-sm text-[#63666F] mb-2">
                          班级分析字数上限
                          <span className="text-xs text-[#0052D9] ml-1">
                            （当前: {classWordLimit ?? "不限"} 字）
                          </span>
                        </label>
                        <Input
                          value={classWordLimit !== null ? String(classWordLimit) : ""}
                          onChange={(val) => {
                            const str = String(val).trim();
                            if (str === "") {
                              setClassWordLimit(null);
                            } else {
                              const num = parseInt(str);
                              if (!isNaN(num) && num > 0) {
                                setClassWordLimit(num);
                              }
                            }
                          }}
                          placeholder="留空则不限"
                          size="large"
                        />
                        <p className="text-xs text-[#63666F] mt-1">建议范围: 200-10000 字，留空则不限制</p>
                      </div>
                    </div>
                  </div>

                  {/* 统一的保存按钮 */}
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <Button
                      theme="primary"
                      size="small"
                      loading={savingWordLimit}
                      onClick={handleSaveLimits}
                    >
                      保存约束配置
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 系统信息 - 可折叠卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleCard("systemInfo")}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#EDF1F7] rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-[#63666F]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </div>
              <span className="font-medium text-[#1A1A1A]">系统信息</span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${expandedCards.systemInfo ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {expandedCards.systemInfo && (
            <div className="px-6 pb-6 border-t border-gray-100">
              <div className="space-y-3 pt-4">
                {[
                  { label: "版本", value: "QuickClass v1.0.0" },
                  { label: "部署模式", value: "本地运行" },
                  { label: "开发", value: "常州管老师和他的AI助手" },
                  { label: "数据库", value: "SQLite (本地文件)" },
                  { label: "访问地址", value: typeof window !== "undefined" ? `${window.location.host}` : "localhost:3000" },
                ].map((item, index) => (
                  <div key={index} className="flex items-center justify-between py-2">
                    <span className="text-sm text-[#63666F]">{item.label}</span>
                    <span className="text-sm font-medium text-[#1A1A1A] font-mono">{item.value}</span>
                  </div>
                ))}

                {/* 对话预警阈值设置 */}
                <div className="pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-[#63666F]">对话预警阈值</span>
                      <p className="text-xs text-amber-600 mt-0.5">超过此数量时显示预警提示</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={String(conversationWarningThreshold)}
                        onChange={(val) => {
                          const num = parseInt(val);
                          if (!isNaN(num) && num > 0) {
                            setConversationWarningThreshold(num);
                          }
                        }}
                        style={{ width: "120px" }}
                        size="small"
                      />
                      <span className="text-xs text-gray-400">条</span>
                      <Button
                        size="small"
                        variant="outline"
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem("token");
                            const res = await fetch("/api/system-config", {
                              method: "PUT",
                              headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({
                                conversationWarningThreshold,
                              }),
                            });
                            if (res.ok) {
                              MessagePlugin.success("阈值已保存");
                            } else {
                              MessagePlugin.error("保存失败");
                            }
                          } catch {
                            MessagePlugin.error("网络错误");
                          }
                        }}
                      >
                        保存
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 备份文件名输入对话框 */}
      {showBackupDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96">
            <h3 className="text-lg font-semibold text-[#1A1A1A] mb-4">备份 AI 配置</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-[#1A1A1A] mb-2">文件名</label>
              <div className="flex items-center gap-0">
                <Input
                  value={backupFileName}
                  onChange={(val) => setBackupFileName(val)}
                  placeholder="输入文件名"
                  size="large"
                  className="flex-1"
                  onKeydown={(_, { e }) => { if (e.key === "Enter") confirmBackup(); }}
                />
                <span className="ml-2 text-sm text-[#63666F] font-mono">.json</span>
              </div>
              <p className="text-xs text-[#63666F] mt-1.5">扩展名固定为 .json，不可更改</p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowBackupDialog(false)}>取消</Button>
              <Button theme="primary" onClick={confirmBackup}>确认备份</Button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
