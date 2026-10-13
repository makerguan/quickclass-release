"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, Button } from "tdesign-react";
import * as Icon from "tdesign-icons-react";
import {
  TeacherThemeKey,
  TEACHER_THEMES,
  getSavedTeacherTheme,
  getTeacherTheme,
  getTeacherThemeVars,
  saveTeacherTheme,
} from "@/lib/teacher-theme";

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
  const [themeKey, setThemeKey] = useState<TeacherThemeKey>("default");

  useEffect(() => {
    setThemeKey(getSavedTeacherTheme());
  }, []);

  const theme = getTeacherTheme(themeKey);
  const cssVars = getTeacherThemeVars(themeKey) as React.CSSProperties;

  // 把主题变量同步到 <html>，并打上 data-teacher-theme 标记（2026-10-13）
  // ⚠️ GOTCHA：TDesign 弹窗/浮层 portal 到 body，不在 layout 树内，只靠根节点内联变量
  //    覆盖不到 → 弹窗里的按钮会退回 TDesign 默认蓝。
  // 离开教师端（组件卸载）时清理变量与标记，避免污染学生端/登录页。
  // 🔗 RELATED: globals.css 中以 html[data-teacher-theme] 为前缀的组件着色规则
  useEffect(() => {
    const root = document.documentElement;
    const vars = getTeacherThemeVars(themeKey);
    root.setAttribute("data-teacher-theme", themeKey);
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    return () => {
      root.removeAttribute("data-teacher-theme");
      Object.keys(vars).forEach((k) => root.style.removeProperty(k));
    };
  }, [themeKey]);

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
      key: "/teacher/images",
      icon: <Icon.ImageIcon />,
      label: "图片仓库",
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
    <div className="h-screen overflow-hidden flex flex-row" style={cssVars}>
      <div className={`bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] relative overflow-hidden transition-all duration-200 flex flex-col shadow-[2px_0_8px_rgba(0,0,0,0.02)] ${sidebarCollapsed ? 'w-10 min-w-10' : 'w-52 min-w-52'}`}>
        <div
          className="p-4 border-b border-[var(--sidebar-border)] flex flex-col gap-1"
          style={{ background: theme.colors.sidebarHeaderBg }}
        >
          {!sidebarCollapsed && (
            <>
              <h2 className="text-lg font-bold text-[var(--primary)] tracking-tight">QuickClass Agent</h2>
              <p className="text-xs font-medium text-[var(--muted)]">宁创教学智能体</p>
            </>
          )}
          <button
            className="text-[var(--muted-light)] hover:text-[var(--foreground)] text-xs px-1 ml-auto transition-colors"
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
        {/* 底栏（2026-10-13 苹果式）：去色底，仅发丝分隔线；⛔ DO NOT ADD 图标底色 */}
        <div className="mt-auto p-4 border-t border-[var(--sidebar-border)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon.UsergroupIcon className="text-[var(--primary)]" size="20px" />
              {!sidebarCollapsed && <span className="text-sm font-medium text-[var(--foreground)]">{user?.name}</span>}
            </div>
            <Button
              theme="default"
              variant="text"
              size="small"
              icon={<Icon.LogoutIcon className="text-[var(--muted)]" />}
              onClick={handleLogout}
              className="hover:text-[var(--danger)] hover:bg-[var(--danger-light)]"
            >
              {!sidebarCollapsed && <span className="text-[var(--muted)]">退出</span>}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        {/* 顶栏（2026-10-13 苹果式）：纯色 + 发丝边框，不用渐变和投影 */}
        <div className="bg-[var(--sidebar-bg)] border-b border-[var(--sidebar-border)] px-6 py-3.5 flex items-center gap-3">
          {showExternal && (
            <Button
              theme="default"
              size="small"
              onClick={() => setShowExternal(false)}
            >
              ← 返回
            </Button>
          )}
          {/* 页级大标题跟随主题色系（2026-10-13 用户反馈）：用 --title 而非近乎恒定的 --foreground */}
          <h1 className="text-xl font-semibold text-[var(--title)] whitespace-nowrap">{showExternal ? '资源广场' : user?.name + '的工作台'}</h1>
          {!showExternal && user && (user as any).motto && (
            <div className="flex-1 min-w-0 overflow-hidden [mask-image:linear-gradient(90deg,transparent_12px,black_32px,black_calc(100%-32px),transparent_calc(100%-12px))]">
              <div className="inline-block whitespace-nowrap animate-marquee text-sm text-[var(--muted)]">
                <span>{(user as any).motto}</span>
                <span className="ml-16">{(user as any).motto}</span>
              </div>
            </div>
          )}
          {/* 主题切换（2026-10-13）：6 套预设配色的「色点」快速切换，保存在 localStorage。
              🔗 RELATED: src/lib/teacher-theme.ts（新增主题只需改那里，此处自动列出） */}
          {!sidebarCollapsed && !showExternal && (
            <div className="ml-auto flex items-center gap-1.5 pl-3 border-l border-[var(--sidebar-border)]">
              <span className="text-xs text-[var(--muted-light)] hidden xl:inline mr-0.5">主题</span>
              {TEACHER_THEMES.map((t) => (
                <button
                  key={t.key}
                  title={t.label}
                  aria-label={t.label}
                  onClick={() => {
                    setThemeKey(t.key);
                    saveTeacherTheme(t.key);
                  }}
                  className={`w-2.5 h-2.5 rounded-full transition-all hover:scale-125 ${themeKey === t.key ? 'ring-2 ring-offset-1 ring-[var(--primary)]' : 'ring-1 ring-[rgba(0,0,0,0.12)] hover:ring-[var(--muted-light)]'}`}
                  style={{ backgroundColor: t.colors.primary }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="teacher-scope p-6 bg-[var(--background)] flex-1 min-h-0 overflow-y-auto">
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
