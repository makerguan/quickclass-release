"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button, Layout as TLayout, Dialog, Form, Input, MessagePlugin } from "tdesign-react";
import {
  ChatIcon,
  ChartBarIcon,
  LogoutIcon,
  UserIcon,
  SettingIcon,
} from "tdesign-icons-react";

const { Header, Content } = TLayout;

interface StudentUser {
  name: string;
  className: string;
  hasPassword?: boolean;
  studentMotto?: string;
}

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<StudentUser | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [changeLoading, setChangeLoading] = useState(false);
  const [studentMotto, setStudentMotto] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      const parsedUser = JSON.parse(stored);
      setUser(parsedUser);
      setStudentMotto(parsedUser.studentMotto || "");
    } else {
      router.push("/student");
    }
  }, [router]);

  // 获取老师统一设置的学生座右铭
  useEffect(() => {
    fetch("/api/system-config/student-motto")
      .then((res) => res.json())
      .then((data) => {
        if (data.studentMotto) {
          setStudentMotto(data.studentMotto);
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/student");
  };

  const handleChangePassword = async (context: { fields?: Record<string, string> }) => {
    const values = context.fields || {};
    setChangeLoading(true);
    try {
      const token = localStorage.getItem("token");
      const body: Record<string, string> = {};
      if (values.oldPassword) body.oldPassword = values.oldPassword;
      if (values.newPassword) body.newPassword = values.newPassword;

      const res = await fetch("/api/auth/student/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        MessagePlugin.success("密码修改成功");
        setPasswordVisible(false);
      } else {
        const data = await res.json();
        MessagePlugin.error(data.error || "修改失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setChangeLoading(false);
    }
  };

  const navItems = [
    { key: "/student/chat", icon: <ChatIcon />, label: "我的学习" },
    { key: "/student/insights", icon: <ChartBarIcon />, label: "学习分析" },
  ];

  return (
    <TLayout className="min-h-screen bg-[#F3F6F9]">
      {/* 顶部导航栏 */}
      <Header className="bg-white border-b border-gray-200 px-6 flex items-center justify-between h-14" style={{ height: "56px" }}>
        <div className="flex items-center gap-6">
          <h2 className="text-lg font-bold text-[#00A870] whitespace-nowrap">QuickClass Agent</h2>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => router.push(item.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-[#0052D9]/10 text-[#0052D9]"
                      : "text-[#63666F] hover:bg-gray-100"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-[#63666F]">
            <UserIcon />
            <span>{user?.name}</span>
            <span className="text-gray-300">|</span>
            <span className="text-xs">{user?.className}</span>
          </div>
          {studentMotto && (
            <span className="text-xs text-[#63666F] max-w-[200px] truncate">{studentMotto}</span>
          )}
          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<SettingIcon />}
            onClick={() => setPasswordVisible(true)}
          >
            改密码
          </Button>
          <Button
            theme="default"
            variant="text"
            size="small"
            icon={<LogoutIcon />}
            onClick={handleLogout}
          >
            退出
          </Button>
        </div>
      </Header>
      {/* 内容区 */}
      <Content className="p-4">{children}</Content>

      {/* 修改密码对话框 */}
      <Dialog
        header="修改密码"
        visible={passwordVisible}
        onClose={() => setPasswordVisible(false)}
        footer={null}
      >
        <Form onSubmit={handleChangePassword}>
          {user?.hasPassword && (
            <Form.FormItem name="oldPassword" rules={[{ required: true, message: "请输入当前密码" }]}>
              <Input placeholder="请输入当前密码" type="password" />
            </Form.FormItem>
          )}
          <Form.FormItem name="newPassword" rules={[{ required: true, message: "请输入新密码" }]}>
            <Input placeholder="请输入新密码" type="password" />
          </Form.FormItem>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => setPasswordVisible(false)}>取消</Button>
            <Button theme="primary" type="submit" loading={changeLoading}>
              保存
            </Button>
          </div>
        </Form>
      </Dialog>
    </TLayout>
  );
}
