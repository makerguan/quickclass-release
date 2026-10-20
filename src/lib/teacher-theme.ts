/**
 * 📐 教师端界面主题配置（2026-10-13 苹果色系版，6 套预设）
 * 借鉴 Apple 设计语言：中性灰底（#F5F5F7）+ 白卡 + 发丝边框（#D2D2D7），
 * 彩色仅作克制的点缀（菜单选中、按钮、图标、标题），状态色取 Apple 系统色暗变体以保证文字对比度。
 * 通过 CSS 变量注入 <html>（见 TeacherLayout 的 useEffect），实现全局切换并覆盖弹窗 portal。
 * 🔗 RELATED: src/components/layout/TeacherLayout.tsx、src/app/globals.css、src/app/teacher/settings/page.tsx
 * ⛔ DO NOT REVERT: 不要回退到硬编码色值——新增主题时需要同步改这里 + globals.css + layout。
 * ⛔ DO NOT ADD ICON BACKGROUNDS: 小图标一律不着底色（苹果式纯色图标），底色会让图标变糊。
 */

export type TeacherThemeKey =
  | "default"
  | "green"
  | "orange"
  | "violet"
  | "mono"
  | "gray";

export interface TeacherTheme {
  key: TeacherThemeKey;
  label: string;
  colors: {
    // 品牌与层次
    primary: string;
    primaryDark: string;
    primaryLight: string;
    primaryLighter: string;
    secondary: string;
    accent: string;

    // 页面骨架
    background: string;
    backgroundGradientFrom: string;
    backgroundGradientTo: string;
    foreground: string;
    /** 页级大标题色：每套主题各自的深色调，保证「标题跟着主题走」（用户反馈 2026-10-13） */
    title: string;
    muted: string;
    mutedLight: string;

    // 卡片与容器
    cardBg: string;
    cardBorder: string;
    cardShadow: string;
    hoverBg: string;
    sidebarBg: string;
    sidebarBorder: string;
    sidebarHeaderBg: string;

    // 状态色
    success: string;
    successLight: string;
    warning: string;
    warningLight: string;
    danger: string;
    dangerLight: string;
  };
}

export const TEACHER_THEMES: TeacherTheme[] = [
  {
    key: "default",
    label: "默认蓝",
    colors: {
      primary: "#0071E3",
      primaryDark: "#0059B8",
      primaryLight: "#E6F0FB",
      primaryLighter: "#F2F7FC",
      secondary: "#34C759",
      accent: "#5856D6",
      background: "#F5F5F7",
      backgroundGradientFrom: "#F5F5F7",
      backgroundGradientTo: "#EDF2F8",
      foreground: "#1D1D1F",
      title: "#13294D",
      muted: "#86868B",
      mutedLight: "#A1A1A6",
      cardBg: "#FFFFFF",
      cardBorder: "#D2D2D7",
      cardShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      hoverBg: "#F5F5F7",
      sidebarBg: "#F5F5F7",
      sidebarBorder: "#D2D2D7",
      sidebarHeaderBg: "linear-gradient(180deg, #F5F5F7 0%, #FFFFFF 100%)",
      success: "#248A3D",
      successLight: "#E3F4E8",
      warning: "#C93400",
      warningLight: "#FBE9E0",
      danger: "#D70015",
      dangerLight: "#FFE5E8",
    },
  },
  {
    key: "green",
    label: "清新绿",
    colors: {
      primary: "#248A3D",
      primaryDark: "#1A6E2E",
      primaryLight: "#E4F3E8",
      primaryLighter: "#F2F9F4",
      secondary: "#0071E3",
      accent: "#30B0C7",
      background: "#F0F7F2",
      backgroundGradientFrom: "#F0F7F2",
      backgroundGradientTo: "#E5F1E9",
      foreground: "#1D1D1F",
      title: "#12331F",
      muted: "#5F6E64",
      mutedLight: "#93A299",
      cardBg: "#FFFFFF",
      cardBorder: "#CFE3D6",
      cardShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      hoverBg: "#F0F5F1",
      sidebarBg: "#F0F7F2",
      sidebarBorder: "#CFE3D6",
      sidebarHeaderBg: "linear-gradient(180deg, #F0F7F2 0%, #FFFFFF 100%)",
      success: "#248A3D",
      successLight: "#E3F4E8",
      warning: "#C93400",
      warningLight: "#FBE9E0",
      danger: "#D70015",
      dangerLight: "#FFE5E8",
    },
  },
  {
    key: "orange",
    label: "活力橙",
    colors: {
      primary: "#C93400",
      primaryDark: "#A62B00",
      primaryLight: "#FBE8DF",
      primaryLighter: "#FDF4EF",
      secondary: "#248A3D",
      accent: "#FF9500",
      background: "#FBF5EF",
      backgroundGradientFrom: "#FBF5EF",
      backgroundGradientTo: "#F7EADB",
      foreground: "#1D1D1F",
      title: "#3B1E0B",
      muted: "#7A6555",
      mutedLight: "#A89684",
      cardBg: "#FFFFFF",
      cardBorder: "#EBD9C8",
      cardShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      hoverBg: "#FAF3EC",
      sidebarBg: "#FBF5EF",
      sidebarBorder: "#EBD9C8",
      sidebarHeaderBg: "linear-gradient(180deg, #FBF5EF 0%, #FFFFFF 100%)",
      success: "#248A3D",
      successLight: "#E3F4E8",
      warning: "#C93400",
      warningLight: "#FBE9E0",
      danger: "#D70015",
      dangerLight: "#FFE5E8",
    },
  },
  {
    key: "violet",
    label: "深邃紫",
    colors: {
      primary: "#8944AB",
      primaryDark: "#733B8E",
      primaryLight: "#F0E7F9",
      primaryLighter: "#F8F4FC",
      secondary: "#0071E3",
      accent: "#5856D6",
      background: "#F5F2FA",
      backgroundGradientFrom: "#F5F2FA",
      backgroundGradientTo: "#EBE4F5",
      foreground: "#1D1D1F",
      title: "#2B1B40",
      muted: "#6E6478",
      mutedLight: "#9C93A8",
      cardBg: "#FFFFFF",
      cardBorder: "#E0D7EC",
      cardShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      hoverBg: "#F3EFF8",
      sidebarBg: "#F5F2FA",
      sidebarBorder: "#E0D7EC",
      sidebarHeaderBg: "linear-gradient(180deg, #F5F2FA 0%, #FFFFFF 100%)",
      success: "#248A3D",
      successLight: "#E3F4E8",
      warning: "#C93400",
      warningLight: "#FBE9E0",
      danger: "#D70015",
      dangerLight: "#FFE5E8",
    },
  },
  {
    // 纯黑白（2026-10-13 用户要求）：完全去色，层级感靠黑白灰 + 线宽 + 字重表达。
    // ⚠️ 副作用：状态色也转灰，删除按钮不再有红色语义——这是单色方案的固有代价，用户明确要求。
    key: "mono",
    label: "纯黑白",
    colors: {
      primary: "#000000",
      primaryDark: "#1F1F1F",
      primaryLight: "#EDEDED",
      primaryLighter: "#F6F6F6",
      secondary: "#3A3A3A",
      accent: "#0A0A0A",
      background: "#F7F7F7",
      backgroundGradientFrom: "#FFFFFF",
      backgroundGradientTo: "#F0F0F0",
      foreground: "#000000",
      title: "#000000",
      muted: "#5A5A5A",
      mutedLight: "#8F8F8F",
      cardBg: "#FFFFFF",
      cardBorder: "#D8D8D8",
      cardShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
      hoverBg: "#F0F0F0",
      sidebarBg: "#FAFAFA",
      sidebarBorder: "#DEDEDE",
      sidebarHeaderBg: "linear-gradient(180deg, #FAFAFA 0%, #FFFFFF 100%)",
      success: "#1A1A1A",
      successLight: "#E8E8E8",
      warning: "#5C5C5C",
      warningLight: "#E8E8E8",
      danger: "#000000",
      dangerLight: "#E4E4E4",
    },
  },
  {
    // 灰度（2026-10-13 用户要求）：比纯黑白柔和，全部走 Apple 灰阶。
    key: "gray",
    label: "灰度",
    colors: {
      primary: "#636366",
      primaryDark: "#4A4A4C",
      primaryLight: "#E9E9EC",
      primaryLighter: "#F4F4F5",
      secondary: "#8E8E93",
      accent: "#7C7C82",
      background: "#F2F2F4",
      backgroundGradientFrom: "#F5F5F7",
      backgroundGradientTo: "#E8E8EB",
      foreground: "#2C2C2E",
      title: "#1F1F22",
      muted: "#6E6E73",
      mutedLight: "#9E9EA4",
      cardBg: "#FFFFFF",
      cardBorder: "#DEDEE1",
      cardShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      hoverBg: "#EAEAED",
      sidebarBg: "#EDEDF0",
      sidebarBorder: "#DEDEE1",
      sidebarHeaderBg: "linear-gradient(180deg, #EDEDF0 0%, #FFFFFF 100%)",
      success: "#5A5A5F",
      successLight: "#E8E8EA",
      warning: "#7A7A80",
      warningLight: "#E8E8EA",
      danger: "#4C4C50",
      dangerLight: "#E8E8EA",
    },
  },
];

const STORAGE_KEY = "teacher-theme";

/** 从 localStorage 读取已保存主题；无记录或无效应返回默认主题 */
export function getSavedTeacherTheme(): TeacherThemeKey {
  if (typeof window === "undefined") return "default";
  const raw = localStorage.getItem(STORAGE_KEY);
  const valid = TEACHER_THEMES.some((t) => t.key === raw);
  return valid ? (raw as TeacherThemeKey) : "default";
}

/** 保存主题选择到 localStorage */
export function saveTeacherTheme(key: TeacherThemeKey) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, key);
}

/** 根据 key 查找主题配置 */
export function getTeacherTheme(key: TeacherThemeKey): TeacherTheme {
  return TEACHER_THEMES.find((t) => t.key === key) || TEACHER_THEMES[0];
}

/**
 * 把主题色彩映射成 CSS 变量表（单一事实来源）。
 * 供两处共用：① TeacherLayout 内联到根节点；② 同步到 document.documentElement
 * ——因为 TDesign 弹窗/浮层 portal 到 body，不在 layout 树内，仅靠内联变量覆盖不到。
 * ⛔ DO NOT 在 CSS 里重复写一份调色板，变量必须由这里产出。
 */
export function getTeacherThemeVars(key: TeacherThemeKey): Record<string, string> {
  const c = getTeacherTheme(key).colors;
  return {
    "--primary": c.primary,
    "--primary-dark": c.primaryDark,
    "--primary-light": c.primaryLight,
    "--primary-lighter": c.primaryLighter,
    "--secondary": c.secondary,
    "--accent": c.accent,
    "--background": c.background,
    "--foreground": c.foreground,
    "--title": c.title,
    "--muted": c.muted,
    "--muted-light": c.mutedLight,
    "--card-bg": c.cardBg,
    "--card-border": c.cardBorder,
    "--card-shadow": c.cardShadow,
    "--hover-bg": c.hoverBg,
    "--sidebar-bg": c.sidebarBg,
    "--sidebar-border": c.sidebarBorder,
    "--success": c.success,
    "--success-light": c.successLight,
    "--warning": c.warning,
    "--warning-light": c.warningLight,
    "--danger": c.danger,
    "--danger-light": c.dangerLight,
  };
}
