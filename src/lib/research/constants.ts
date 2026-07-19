/**
 * 论文风格（仅 PAPER 类型适用）
 * - PRACTICE_RESEARCH: 实践研究类（6 要素：引言→理论依据→实施路径→案例分析→效果评价→结语）
 * - CASE_ANALYSIS:    案例分析类（6 章节：引言→理论依据→教学设计原则→教学案例展示→教学反思→结语）
 */
export const PAPER_STYLES = [
  {
    value: "PRACTICE_RESEARCH",
    label: "实践研究",
    shortLabel: "实践研究类",
    structure: "6 要素：引言→理论依据→实施路径→案例分析→效果评价→结语",
    color: "#0052D9",
    bg: "#E6F1FF",
    icon: "🔬",
    scope: "整体性教学改革（学段/单元/课程）",
  },
  {
    value: "CASE_ANALYSIS",
    label: "案例分析",
    shortLabel: "案例分析类",
    structure: "6 章节：引言→理论依据→教学设计原则→教学案例展示→教学反思→结语",
    color: "#00A870",
    bg: "#E8F8F0",
    icon: "📖",
    scope: "单课时/单案例精读",
  },
] as const;

export type PaperStyle = (typeof PAPER_STYLES)[number]["value"];

/**
 * 教育研究方法库（仅 PROPOSAL 类型适用）
 */
export const RESEARCH_METHODS = [
  {
    value: "ACTION_RESEARCH",
    label: "行动研究法",
    color: "#0052D9",
    bg: "#E6F1FF",
    icon: "🔄",
  },
  {
    value: "CASE_STUDY",
    label: "案例分析法",
    color: "#00A870",
    bg: "#E8F8F0",
    icon: "🔍",
  },
  {
    value: "SURVEY",
    label: "调查研究法",
    color: "#E37318",
    bg: "#FFF3E8",
    icon: "📋",
  },
  {
    value: "EXPERIMENT",
    label: "实验研究法",
    color: "#D54941",
    bg: "#FFEBEB",
    icon: "⚗️",
  },
  {
    value: "QUASI_EXPERIMENT",
    label: "准实验研究法",
    color: "#8B5CF6",
    bg: "#F3EBFF",
    icon: "⚖️",
  },
  {
    value: "NARRATIVE",
    label: "叙事研究法",
    color: "#EC4899",
    bg: "#FFE8F3",
    icon: "📖",
  },
  {
    value: "CONTENT_ANALYSIS",
    label: "内容分析法",
    color: "#0891B2",
    bg: "#E0F7FA",
    icon: "🔢",
  },
  {
    value: "DESIGN_BASED",
    label: "设计本位研究法",
    color: "#CA8A04",
    bg: "#FFF8E1",
    icon: "🛠️",
  },
  {
    value: "MIXED_METHODS",
    label: "混合研究法",
    color: "#475569",
    bg: "#F1F5F9",
    icon: "🔀",
  },
] as const;

export type ResearchMethod = (typeof RESEARCH_METHODS)[number]["value"];

export function getPaperStyleLabel(value: string | undefined | null): string {
  if (!value) return "未分类";
  return PAPER_STYLES.find((p) => p.value === value)?.label || value;
}

export function getPaperStyleColor(value: string | undefined | null): string {
  return PAPER_STYLES.find((p) => p.value === value)?.color || "#666";
}

export function getPaperStyleBg(value: string | undefined | null): string {
  return PAPER_STYLES.find((p) => p.value === value)?.bg || "#F3F4F6";
}

export function getResearchMethodLabel(value: string | undefined | null): string {
  if (!value) return "未指定";
  return RESEARCH_METHODS.find((m) => m.value === value)?.label || value;
}

export function getResearchMethodColor(value: string | undefined | null): string {
  return RESEARCH_METHODS.find((m) => m.value === value)?.color || "#666";
}

export function getResearchMethodBg(value: string | undefined | null): string {
  return RESEARCH_METHODS.find((m) => m.value === value)?.bg || "#F3F4F6";
}