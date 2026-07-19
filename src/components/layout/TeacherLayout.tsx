"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, Button } from "tdesign-react";
import * as Icon from "tdesign-icons-react";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showExternal, setShowExternal] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      setUser(JSON.parse(stored));
    } else {
      router.push("/login");
    }
  }, [router]);

  // 监听 pathname 变化，关闭外部显示
  useEffect(() => {
    if (pathname && !pathname.startsWith("http")) {
      setShowExternal(false);
    }
  }, [pathname]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/");
  };

  const menuItems = [
    {
      key: "/teacher/tasks",
      icon: <Icon.ViewListIcon />,
      label: "课堂管理",
    },
    {
      key: "/teacher/knowledge-base",
      icon: <Icon.BookmarkIcon />,
      label: "知识仓库",
    },
    {
      key: "/teacher/classes",
      icon: <Icon.RootListIcon />,
      label: "班级管理",
    },
    {
      key: "/teacher/conversations",
      icon: <Icon.ChatIcon />,
      label: "对话记录",
    },
    {
      key: "/teacher/research",
      icon: <Icon.ChartIcon />,
      label: "教学研究",
    },
    {
      key: "/teacher/templates",
      icon: <Icon.FileIcon />,
      label: "模板设置",
    },
    {
      key: "http://www.maoyouhui.org",
      icon: <Icon.LinkIcon />,
      label: "资源广场",
      external: true,
    },
    {
      key: "/teacher/settings",
      icon: <Icon.SettingIcon />,
      label: "系统设置",
    },
  ];

  const handleMenuChange = (key: string) => {
    const item = menuItems.find((i) => i.key === key);
    if (item?.external) {
      setExternalUrl(key);
      setShowExternal(true);
    } else {
      setShowExternal(false);
      router.push(key);
    }
  };

  return (
    <div className="min-h-screen flex flex-row">
      <div className={`bg-white border-r border-gray-200 relative overflow-hidden transition-all duration-200 flex flex-col ${sidebarCollapsed ? 'w-10 min-w-10' : 'w-52 min-w-52'}`}>
        <div className="p-4 border-b border-gray-200 flex flex-col gap-1">
          {!sidebarCollapsed && (
            <>
              <h2 className="text-lg font-bold text-[#0052D9]">QuickClass Agent</h2>
            </>
          )}
          <button
            className="text-gray-400 hover:text-gray-600 text-xs px-1 ml-auto"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {sidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>
        {!sidebarCollapsed && (
        <Menu
          theme="light"
          value={showExternal ? "http://www.maoyouhui.org" : pathname}
          onChange={(v) => handleMenuChange(v as string)}
          style={{ width: '100%', border: 'none' }}
          className="teacher-menu"
        >
          {menuItems.map((item) => (
            <Menu.MenuItem key={item.key} value={item.key} icon={item.icon}>
              {item.label}
            </Menu.MenuItem>
          ))}
        </Menu>
        )}
        <div className="mt-auto p-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon.UsergroupIcon />
              {!sidebarCollapsed && <span className="text-sm">{user?.name}</span>}
            </div>
            <Button
              theme="default"
              variant="text"
              size="small"
              icon={<Icon.LogoutIcon />}
              onClick={handleLogout}
            >
              {!sidebarCollapsed && "退出"}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
          {showExternal && (
            <Button
              theme="default"
              size="small"
              onClick={() => setShowExternal(false)}
            >
              ← 返回
            </Button>
          )}
          <h1 className="text-xl font-semibold text-[#1A1A1A] whitespace-nowrap">{showExternal ? '资源广场' : user?.name + '的工作台'}</h1>
          {!showExternal && user && (user as any).motto && (
            <div className="flex-1 min-w-0 overflow-hidden [mask-image:linear-gradient(90deg,transparent_12px,black_32px,black_calc(100%-32px),transparent_calc(100%-12px))]">
              <div className="inline-block whitespace-nowrap animate-marquee text-sm text-[#63666F]">
                <span>{(user as any).motto}</span>
                <span className="ml-16">{(user as any).motto}</span>
              </div>
            </div>
          )}
        </div>
        <div className="p-6 bg-[#F3F6F9] flex-1">
          {showExternal ? (
            <iframe
              src={externalUrl}
              className="w-full h-full border-0 rounded-lg"
              style={{ height: 'calc(100vh - 120px)' }}
              title="资源广场"
            />
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
