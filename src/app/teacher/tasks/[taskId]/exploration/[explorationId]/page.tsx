"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Tag, Select, MessagePlugin, Dialog, Switch, InputNumber } from "tdesign-react";
import { ArrowLeftIcon, ChartBarIcon, RefreshIcon } from "tdesign-icons-react";
import Markdown from "@/components/Markdown";
import ExportPdfButton from "@/components/ExportPdfButton";
import TeacherLayout from "@/components/layout/TeacherLayout";
import QuickFormDashboard, { type QfRecordItem, analyzeFields } from "@/components/exploration/QuickFormDashboard";
import QuickFormRecordList from "@/components/exploration/QuickFormRecordList";
import QuickFormAiDashboard from "@/components/exploration/QuickFormAiDashboard";
import DashboardEditor from "@/components/exploration/DashboardEditor";
import { SUBMITTED_AT_FIELD, applyQuickEdits, type AiDashboardConfig, type AiDashboardChart, type AiDashboardKpi } from "@/lib/prompts/dashboard-config";
import TemplatePreviewButton from "@/components/template/TemplatePreviewButton";

interface StudentRecord {
  studentId: string;
  studentName: string;
  score: number;
  maxScore: number;
  timeSpent: number;
  interactions: number;
  completedSections: string[];
  submittedAt: string;
  actionCount: number;
}

interface AnalysisData {
  explorationId: string;
  explorationTitle: string;
  submittedCount: number;
  totalStudents: number | null;
  classIds: string[];
  // 各班级提交数（2026-10-13 起由 analysis GET 返回，供默认班级选择）
  classSubmittedCounts?: Record<string, number>;
  averageScore: number;
  scoreDistribution: Record<string, number>;
  avgTimeSpent: number;
  avgInteractions: number;
  actionTypeStats: Record<string, number>;
  studentRecords: StudentRecord[];
  teachingAdvice: string | null;
}

interface UserSubmission {
  id: string;
  studentId: string;
  studentName: string;
  answers: string;
  score: number | null;
  totalScore: number;
  submittedAt: string;
  actionLogs: { type: string; timestamp: string }[];
}

interface AnalysisTemplate {
  id: string;
  type: string;
  name: string;
  content: string;
  isDefault: boolean;
}

interface InsightVersion {
  id?: string;
  content: string;
  version: number;
  createdAt: string;
}

// 辅助函数：判断内容是否为 HTML
function isHtmlContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    (trimmed.includes('<html') && trimmed.includes('</html>'));
}

// 辅助函数：渲染洞察内容 - 支持 HTML 和 Markdown，带全屏按钮
function InsightContent({ content, className = "" }: { content: string; className?: string }) {
  if (isHtmlContent(content)) {
    return (
      <div className="relative group">
        <button
          className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-[var(--card-bg)]/80 hover:bg-[var(--card-bg)] text-[var(--muted)] rounded border border-[var(--card-border)] opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => {
            const w = window.open('', '_blank');
            if (w) {
              w.document.write(content);
              w.document.close();
              w.document.title = '探究 AI 分析报告';
            }
          }}
        >
          全屏查看
        </button>
        <iframe
          srcDoc={content}
          className={`w-full border-none ${className}`}
          style={{ minHeight: "400px" }}
          sandbox="allow-scripts"
          title="探究 AI 分析报告"
        />
      </div>
    );
  }
  // 文本型分支：data-insight-body 是 ExportPdfButton 的定位锚点（closest 向上查找），
  // 丢了该属性导出按钮静默失效。🔗 RELATED：src/components/ExportPdfButton.tsx
  return (
    <div data-insight-body className={`prose prose-sm prose-gray max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-all ${className}`}>
      <Markdown>{content}</Markdown>
      <ExportPdfButton title="探究 AI 分析报告" />
    </div>
  );
}

type TabKey = "statistics" | "submissions" | "ai";

/** 解析落库的 AI 大屏配置；非法或为空 → null（回退默认大屏，不白屏） */
function parseDashboardConfig(raw: unknown): AiDashboardConfig | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as AiDashboardConfig) : null;
  } catch {
    return null;
  }
}

/** 把「默认大屏」的自动分析结果转成可编辑的 AI 配置。
 *  ⚠️ GOTCHA：默认大屏（QuickFormDashboard）是纯前端自动分析、没有落库 config；
 *  老师点「编辑」时用本函数把分析结果「转正」成 AiDashboardConfig，
 *  保存后即走 QuickFormAiDashboard 渲染（从此不再是默认大屏）。
 *  ⛔ DO NOT REVERT：默认大屏也要能编辑，是本需求（2026-10-05）的核心诉求。 */
function buildDefaultConfig(records: QfRecordItem[]): AiDashboardConfig {
  const fields = analyzeFields(records);
  const charts: AiDashboardChart[] = [];
  const kpis: AiDashboardKpi[] = [{ label: "已提交", field: null, agg: "count" }];

  for (const f of fields) {
    if (f.kind === "identifier") {
      charts.push({ title: f.key, field: f.key, type: "roster" });
    } else if (f.kind === "numeric") {
      charts.push({ title: f.key, field: f.key, type: "bar", limit: 8 });
      kpis.push({ label: `${f.key}平均`, field: f.key, agg: "avg" });
    } else if (f.kind === "low-cardinality") {
      charts.push({
        title: f.key,
        field: f.key,
        type: f.uniqueCount <= 4 ? "pie" : "hbar",
        limit: 8,
      });
    } else if (f.kind === "array") {
      charts.push({ title: f.key, field: f.key, type: "hbar", limit: 8 });
    } else {
      charts.push({ title: f.key, field: f.key, type: "wordcloud", limit: 12 });
    }
  }

  return {
    title: "数据大屏",
    subtitle: "",
    theme: "blue",
    gridCols: 2,
    kpis,
    charts,
  };
}

export default function ExplorationAnalysisPage() {
  const router = useRouter();
  const params = useParams();
  const explorationId = params.explorationId as string;

  const [loading, setLoading] = useState(true);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [submissions, setSubmissions] = useState<UserSubmission[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("statistics");
  const [error, setError] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedClassId, setSelectedClassId] = useState("");
  const [allClasses, setAllClasses] = useState<{ id: string; name: string }[]>([]);

  // QuickForm 数据大屏状态
  const [qfTaskId, setQfTaskId] = useState<string | null>(null);
  const [qfRecords, setQfRecords] = useState<QfRecordItem[]>([]);
  const [qfTotal, setQfTotal] = useState(0);
  const [qfLoading, setQfLoading] = useState(false);

  // 「AI 重排」数据大屏状态（配置落库在 exploration.dashboardConfig）
  const [aiDashConfig, setAiDashConfig] = useState<AiDashboardConfig | null>(null);
  const [aiDashLoading, setAiDashLoading] = useState(false);
  const [aiDashError, setAiDashError] = useState("");
  const [aiDashInstruction, setAiDashInstruction] = useState("");

  // 手动微调编辑器（AI 初稿 + 手动微调）
  const [editing, setEditing] = useState(false);
  // 记录「进入编辑前是否原本是默认大屏」，用于「放弃」时正确回退到默认大屏
  const editingFromDefaultRef = useRef(false);

  // 自动刷新轮询：默认开、间隔秒数页面可控
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSeconds, setRefreshSeconds] = useState(15);
  const refreshLiveDataRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // 实时刷新（页签切换 / 手动刷新）
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  // AI 分析报告状态
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [aiReport, setAiReport] = useState<InsightVersion | null>(null);
  const [aiReportVersions, setAiReportVersions] = useState<InsightVersion[]>([]);
  const [aiVersionIndex, setAiVersionIndex] = useState(0);
  const [generatingReport, setGeneratingReport] = useState(false);

  // 提交详情缓存：展开有 canvas 快照的学生时按 studentId 拉取完整数据
  // （列表接口已剥离 canvasSnapshots / textSnapshot 等大字段，只留 canvasCount）
  const [detailCache, setDetailCache] = useState<Record<string, Record<string, any>>>({});

  // 提交详情页签的双视图切换：绑定 QF 任务时「收集数据」与「行为数据」并列，
  // 默认「收集数据」保持既有习惯，老师可切到「行为数据」看作品快照 / 操作日志
  const [submissionView, setSubmissionView] = useState<"qf" | "behavior">("qf");

  // 删除版本
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState<{ id: string; version: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (explorationId) {
      fetchData();
      fetchTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorationId]);

  const fetchTemplates = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/analysis-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const expTemplates = data.explorationAnalysisTemplates || [];
        setTemplates(expTemplates);
        const defaultTpl = expTemplates.find((t: any) => t.isDefault);
        if (defaultTpl) setSelectedTemplateId(defaultTpl.id);
      }
    } catch { /* ignore */ }
  };

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("token");

      // ⚠️ GOTCHA / PERF：原先 7 个请求串行 await，链路被 RTT 累加放大，
      // 导致「分析」页打开明显慢于课堂整体分析（后者仅 3 个请求）。
      // 改为「3 波并行」：第 1 波互相独立（分析/班级列表/当前班级），
      // 第 2 波依赖班级选择（提交列表/探究详情），第 3 波依赖详情里的 qfTaskId。
      const [res, clsRes, curRes] = await Promise.all([
        fetch(`/api/exploration-activities/${explorationId}/analysis`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/classes", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/classes/current", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!res.ok) {
        const errText = await res.text().catch(() => "请求失败");
        setError(errText);
        setLoading(false);
        return;
      }
      const data: AnalysisData = await res.json();
      setAnalysisData(data);

      if (clsRes.ok) {
        const clsData = await clsRes.json();
        setAllClasses(Array.isArray(clsData) ? clsData : []);
      }

      let currentClassId = "";
      if (curRes.ok) {
        const curData = await curRes.json();
        currentClassId = curData.class?.id || "";
      }
      // 默认班级：优先「当前班级且有提交」；否则选第一个有提交的班级；
      // 都没有提交才退回原行为（当前班级在列用它，否则 classIds[0]）。
      // ⚠️ GOTCHA（2026-10-13）：教师多班时，当前班级可能无提交，原先直接用它导致
      //   点「分析」看不到任何提交数据（课堂列表却显示 N 份提交，来自全量 _count）。
      // ⛔ DO NOT REVERT: 退回旧逻辑会复现「后台显示有人提交，分析页却为空」。
      // 🔗 RELATED: analysis GET 返回 classSubmittedCounts；tasks/page.tsx openAnalysisModal 同款逻辑
      const firstClassWithSub = (data.classIds || []).find(
        (c: string) => (data.classSubmittedCounts?.[c] ?? 0) > 0
      );
      let targetClassId = "";
      if (currentClassId && (data.classSubmittedCounts?.[currentClassId] ?? 0) > 0) {
        targetClassId = currentClassId;
      } else if (firstClassWithSub) {
        targetClassId = firstClassWithSub;
      } else {
        targetClassId = data.classIds?.includes(currentClassId)
          ? currentClassId
          : (data.classIds?.[0] || "");
      }
      setSelectedClassId(targetClassId);

      // 第 2 波：提交列表与探究详情都只依赖 targetClassId，可并行
      const [subRes, detailRes] = await Promise.all([
        fetch(`/api/exploration-activities/${explorationId}/submissions${targetClassId ? `?classId=${targetClassId}` : ""}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/exploration-activities/${explorationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (subRes.ok) {
        const subData = await subRes.json();
        setSubmissions(Array.isArray(subData) ? subData : subData.submissions || []);
      }

      let qfTaskId: string | null = null;
      if (detailRes.ok) {
        const detail = await detailRes.json();
        qfTaskId = detail.qfTaskId || null;
        setQfTaskId(qfTaskId);
        setAiDashConfig(parseDashboardConfig(detail.dashboardConfig));
      }

      // 第 3 波：QF 收集数据（依赖 qfTaskId）与 AI 报告版本（依赖 targetClassId）并行
      const wave3: Promise<void>[] = [];
      if (qfTaskId) {
        wave3.push((async () => {
          setQfLoading(true);
          try {
            const qfRes = await fetch(`/api/qf/records/${qfTaskId}?page=1&pageSize=500${targetClassId ? `&classId=${targetClassId}` : ""}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (qfRes.ok) {
              const qfData = await qfRes.json();
              setQfRecords(Array.isArray(qfData.items) ? qfData.items : []);
              setQfTotal(typeof qfData.total === "number" ? qfData.total : 0);
            }
          } catch {
            // QF 数据拉取失败不影响其它标签展示
          } finally {
            setQfLoading(false);
          }
        })());
      } else {
        setQfRecords([]);
        setQfTotal(0);
      }
      if (targetClassId) {
        wave3.push(fetchAiVersions(targetClassId));
      }
      await Promise.all(wave3);
    } catch (e: any) {
      console.error("获取分析数据失败", e);
      setError(e.message || "获取数据失败");
    } finally {
      setLoading(false);
      setLastUpdated(new Date().toLocaleTimeString());
    }
  };

  /**
   * 轻量刷新：只重拉会变动的数据（提交列表 + QuickForm 收集记录），
   * 不触发整页 loading，用于「切换页签」与「手动刷新」。
   */
  const refreshLiveData = async (classOverride?: string) => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const token = localStorage.getItem("token");
      // 班级：优先用调用方显式传入（切换班级时 state 还没更新，闭包里是旧值）
      const cls = classOverride !== undefined ? classOverride : selectedClassId;

      const subRes = await fetch(`/api/exploration-activities/${explorationId}/submissions${cls ? `?classId=${cls}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (subRes.ok) {
        const subData = await subRes.json();
        setSubmissions(Array.isArray(subData) ? subData : subData.submissions || []);
      }

      let tid = qfTaskId;
      if (!tid) {
        const detailRes = await fetch(`/api/exploration-activities/${explorationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (detailRes.ok) {
          const detail = await detailRes.json();
          tid = detail.qfTaskId || null;
          setQfTaskId(tid);
        }
      }
      if (tid) {
        const qfRes = await fetch(`/api/qf/records/${tid}?page=1&pageSize=500${cls ? `&classId=${cls}` : ""}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (qfRes.ok) {
          const qfData = await qfRes.json();
          setQfRecords(Array.isArray(qfData.items) ? qfData.items : []);
          setQfTotal(typeof qfData.total === "number" ? qfData.total : 0);
        }
      }

      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      /* 静默失败：刷新出错不影响已有展示 */
    } finally {
      setRefreshing(false);
    }
  };

  // 始终指向最新的 refreshLiveData，避免定时器闭包捕获旧班级/任务
  refreshLiveDataRef.current = refreshLiveData;

  // 自动刷新轮询：默认开，间隔 refreshSeconds 秒（5~300 clamp）
  useEffect(() => {
    if (!autoRefresh) return;
    const secs = Math.max(5, Math.min(300, refreshSeconds));
    const timer = setInterval(() => refreshLiveDataRef.current(), secs * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshSeconds]);

  /**
   * 「编辑」入口：AI 大屏直接编辑；默认大屏先把自动分析结果「转正」成可编辑配置再进入。
   * ⛔ DO NOT REVERT：默认大屏也要能直接编辑，是本需求（2026-10-05）的核心诉求。
   */
  const handleEditDashboard = () => {
    if (!aiDashConfig) {
      editingFromDefaultRef.current = true;
      setAiDashConfig(buildDefaultConfig(qfRecords));
    } else {
      editingFromDefaultRef.current = false;
    }
    setEditing(true);
  };

  /** 放弃编辑：若原本是默认大屏，则回退到默认大屏（不保留临时「转正」配置） */
  const handleCancelEdit = () => {
    if (editingFromDefaultRef.current) {
      editingFromDefaultRef.current = false;
      setAiDashConfig(null);
    }
    setEditing(false);
  };

  /**
   * 「AI 重排大屏」：把字段摘要交给 AI，产出**图表配置 JSON** 并落库缓存；
   * 前端只按配置渲染图表（AI 不产出 HTML，避免 XSS）。老师手动触发、低频。
   * 自然语言编辑三档分发（2026-10-13）：
   *   1. 换色 / 移位 / 删除等简单指令 → applyQuickEdits 本地直接改配置（PUT 落库，不耗 AI）；
   *   2. 已有大屏 + 复杂指令 → POST 带 baseConfig 走「AI 修订」（只改提到的部分）；
   *   3. 无当前大屏 → 从零重排（原行为）。
   */
  const handleGenerateAiDashboard = async () => {
    if (aiDashLoading) return;
    const instruction = aiDashInstruction.trim();
    setAiDashLoading(true);
    setAiDashError("");
    const token = localStorage.getItem("token");
    const apiUrl = `/api/exploration-activities/${explorationId}/dashboard-config`;
    try {
      // 快速指令：本地确定性修改，不耗 AI；解析器不认识任何片段时返回 null 交给 AI
      if (instruction && aiDashConfig) {
        const quick = applyQuickEdits(aiDashConfig, instruction);
        if (quick) {
          const res = await fetch(apiUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ config: quick.config }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data?.config) {
            setAiDashError(data?.message || "保存失败，请重试。");
            return;
          }
          setAiDashConfig(data.config as AiDashboardConfig);
          MessagePlugin.success(`已直接应用：${quick.applied.join("、")}`);
          return;
        }
      }
      const revise = Boolean(instruction && aiDashConfig);
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ instruction, baseConfig: revise ? aiDashConfig : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.config) {
        setAiDashError(data?.message || "生成失败，请重试。");
        return;
      }
      setAiDashConfig(data.config as AiDashboardConfig);
      MessagePlugin.success(revise ? "已按 AI 修订大屏" : "已按 AI 配置重排大屏");
    } catch {
      setAiDashError("网络异常，生成失败。");
    } finally {
      setAiDashLoading(false);
    }
  };

  /** 恢复默认大屏：清空落库配置 */
  const handleResetAiDashboard = async () => {
    if (aiDashLoading) return;
    setAiDashLoading(true);
    try {
      const token = localStorage.getItem("token");
      await fetch(`/api/exploration-activities/${explorationId}/dashboard-config`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* 静默：失败也先回退本地显示 */
    } finally {
      setAiDashConfig(null);
      setAiDashError("");
      setAiDashLoading(false);
      // ⚠️ GOTCHA：若在「编辑态」点恢复默认，必须退出编辑态并清掉「转正」标记，
      // 否则 editing 卡在 true → 工具栏「编辑」按钮被 `!editing` 条件隐藏、再也点不回来（历史 bug）。
      setEditing(false);
      editingFromDefaultRef.current = false;
    }
  };

  /** 保存老师手动微调后的配置（PUT 落库，返回 sanitize 后的合法配置） */
  const handleSaveDashboard = async (config: AiDashboardConfig) => {
    setAiDashLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/exploration-activities/${explorationId}/dashboard-config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ config }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.config) {
        MessagePlugin.error(data?.message || "保存失败，请重试。");
        return;
      }
      setAiDashConfig(data.config as AiDashboardConfig);
      editingFromDefaultRef.current = false; // 已保存落库 = 转正成功，不再是默认大屏
      setEditing(false);
      MessagePlugin.success("大屏已更新");
    } catch {
      MessagePlugin.error("网络异常，保存失败。");
    } finally {
      setAiDashLoading(false);
    }
  };

  const fetchAiVersions = async (classId: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/exploration-activities/${explorationId}/analysis/generate?classId=${classId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const versions = data.versions || [];
        setAiReportVersions(versions);
        if (versions.length > 0) {
          setAiReport(versions[0]);
          setAiVersionIndex(0);
        } else {
          setAiReport(null);
          setAiVersionIndex(0);
        }
      } else {
        // ⚠️ GOTCHA：if(res.ok) 必须带 else——无 else 会静默吞掉 500，老师生成成功后
        // 版本列表拉取失败会停在旧列表，误以为生成没生效（2026-10-11 修复版本号不对应时补上）。
        MessagePlugin.error("获取分析报告版本失败");
      }
    } catch { /* ignore */ }
  };

  const handleGenerateAiReport = useCallback(async () => {
    if (!selectedClassId) {
      MessagePlugin.warning("未选择班级，请先选择班级");
      return;
    }
    setGeneratingReport(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/exploration-activities/${explorationId}/analysis/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          templateId: selectedTemplateId || undefined,
          classId: selectedClassId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // ⛔ DO NOT REVERT to local version-list rebuild ([previousContent, newInsight], version = new-1).
        // Why removed (2026-10-11): (1) in-place rebuild silently drops all historical versions
        // from the UI — DB still has them; symptom was "version buttons wrong until page refresh"
        // (e.g. DB has v1+v2, after generating v3 only v2/v3 shown, v1 gone).
        // (2) previous version's content came raw from DB without cleanInsightContent and with
        // an empty createdAt, diverging from what GET returns after refresh.
        // (3) `version = data.version - 1` is a guess, not the stored value.
        // Server data is the single source of truth: refetch the full version list — it also
        // selects the newest version (fetchAiVersions sets versions[0] + index 0).
        // 🔗 RELATED: fetchAiVersions (refetch + select newest); same fix done the same day in
        // src/app/teacher/tasks/[taskId]/insights/page.tsx (generateTaskClassInsight);
        // src/app/api/exploration-activities/[id]/analysis/generate/route.ts POST returns only
        // previousContent, NOT the full version list — insufficient for a local rebuild.
        await fetchAiVersions(selectedClassId);
        MessagePlugin.success(`AI 分析报告已生成（v${data.version}）`);
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || "生成失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setGeneratingReport(false);
    }
  }, [selectedClassId, explorationId, selectedTemplateId]);



  const TabButton = ({ tabKey, label }: { tabKey: TabKey; label: string }) => (
    <button
      className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tabKey
        ? "border-[var(--primary)] text-[var(--primary)]"
        : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--card-border)]"
        }`}
      onClick={() => { setActiveTab(tabKey); refreshLiveData(); }}
    >
      {label}
    </button>
  );

  const renderStatistics = () => {
    // 优先渲染 QuickForm 数据大屏（有绑定任务时）
    if (qfTaskId) {
      if (qfLoading) {
        return (
          <div className="space-y-4 animate-pulse" aria-label="数据大屏加载中">
            <div className="h-20 rounded-2xl bg-[var(--primary-light)]" />
            <div className="h-32 rounded-2xl bg-[var(--primary-lighter)]" />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="h-48 rounded-2xl bg-[var(--primary-lighter)]" />
              <div className="h-48 rounded-2xl bg-[var(--primary-lighter)]" />
            </div>
          </div>
        );
      }

      // 手动微调编辑器的字段下拉来源：从当前收集记录提取字段名（去重）。
      // ⚠️ GOTCHA：剔除 `_` 保留字段（_record_id/_submitted_at 等内部字段，选了也会被保存端 sanitize 丢弃），
      // 并显式加入「提交时间」这个元数据字段（其值在 record.submittedAt，不在 data 里）。
      const dashboardFields = [
        ...Array.from(
          new Set(qfRecords.flatMap((r) => Object.keys(r.data || {})))
        ).filter((k) => !k.startsWith("_")),
        SUBMITTED_AT_FIELD,
      ].sort();

      // 工具栏：AI 重排 / 自定义要求 / 编辑 / 恢复默认
      const toolbar = (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Button
            size="small"
            theme="primary"
            loading={aiDashLoading}
            onClick={handleGenerateAiDashboard}
          >
            {aiDashConfig ? "AI 重新排布" : "AI 重排大屏"}
          </Button>
          <input
            value={aiDashInstruction}
            onChange={(e) => setAiDashInstruction(e.target.value)}
            placeholder="可选：自然语言修改，如「排行榜放最前」「换成青色」「删掉词云」「突出年龄分布」"
            className="flex-1 min-w-[220px] h-8 px-3 text-xs border border-[var(--card-border)] rounded-md focus:outline-none focus:border-[var(--primary)]"
          />
          {!editing && (
            <Button
              size="small"
              variant="outline"
              disabled={aiDashLoading}
              onClick={handleEditDashboard}
            >
              编辑
            </Button>
          )}
          {aiDashConfig && (
            <Button
              size="small"
              variant="outline"
              disabled={aiDashLoading}
              onClick={handleResetAiDashboard}
            >
              恢复默认
            </Button>
          )}
          {/* 提交统计自动刷新（2026-10-11 从顶部导航移入本 tab）：
              轮询只刷新提交统计数据（refreshLiveData），放顶部会让人以为它也作用于 AI 报告等其他 tab。 */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-[var(--muted)]">自动刷新</span>
            <Switch size="small" value={autoRefresh} onChange={(v) => setAutoRefresh(!!v)} />
            {/* ⚠️ GOTCHA：默认 theme 是左右加减号（row），width 64 时两个按钮各占约 30px，
                数字「15」被挤到只剩几像素、根本看不清；改用上下加减号（column）+ 加宽到 72 才能正常显示秒数。 */}
            <InputNumber
              size="small"
              theme="column"
              value={refreshSeconds}
              min={5}
              max={300}
              step={5}
              disabled={!autoRefresh}
              onChange={(v) => setRefreshSeconds(Number(v) || 15)}
              style={{ width: 72 }}
            />
            <span className="text-xs text-[var(--muted-light)]">秒</span>
          </div>
        </div>
      );

      return (
        <div>
          {toolbar}
          {aiDashError && (
            <div className="mb-3 text-xs text-[var(--danger)] bg-[var(--danger-light)] border border-[var(--danger-light)] rounded-md px-3 py-2">
              {aiDashError}
            </div>
          )}
          {editing && aiDashConfig ? (
            <DashboardEditor
              config={aiDashConfig}
              fields={dashboardFields}
              onSave={handleSaveDashboard}
              onCancel={handleCancelEdit}
            />
          ) : aiDashConfig ? (
            <QuickFormAiDashboard records={qfRecords} total={qfTotal} config={aiDashConfig} />
          ) : (
            <QuickFormDashboard records={qfRecords} total={qfTotal} />
          )}
        </div>
      );
    }

    if (submissions.length === 0) return <div className="text-center py-8 text-sm text-[var(--muted-light)]">暂无提交数据</div>;

    const allAnswers: Record<string, any>[] = submissions.map((sub) => {
      try { return JSON.parse(sub.answers || "{}"); } catch { return {}; }
    });

    const allFields = new Set<string>();
    for (const ans of allAnswers) {
      for (const key of Object.keys(ans)) {
        const val = ans[key];
        if (val !== "" && val !== null && val !== undefined) {
          allFields.add(key);
        }
      }
    }

    const fieldLabels: Record<string, string> = {
      timeSpent: "停留时间（秒）",
      interactions: "互动次数",
      scrollDepth: "滚动深度（%）",
      attempts: "尝试次数",
      gameLevel: "游戏关卡",
      completedSections: "完成环节",
      taskTitle: "任务标题",
      studentName: "学生姓名",
      className: "班级名称",
    };

    const numericFields = ["timeSpent", "interactions", "scrollDepth", "attempts", "gameLevel"];
    const sortedFields = [...allFields].sort((a, b) => {
      const aIdx = numericFields.indexOf(a);
      const bIdx = numericFields.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[var(--primary-light)] rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-[var(--primary)]">{submissions.length}</div>
            <div className="text-xs text-[var(--primary)] mt-1">已提交</div>
          </div>
          <div className="bg-[var(--success-light)] rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-[var(--success)]">
              {submissions.filter((s) => s.score !== null && s.score !== undefined).length}
            </div>
            <div className="text-xs text-[var(--success)] mt-1">已评分</div>
          </div>
        </div>

        {sortedFields.map((field) => {
          const values = allAnswers
            .map((a) => a[field])
            .filter((v) => v !== "" && v !== null && v !== undefined && v !== false);

          if (values.length === 0) return null;

          const isNumeric = typeof values[0] === "number" || (typeof values[0] === "string" && !isNaN(Number(values[0])));
          const isArray = Array.isArray(values[0]);

          if (isNumeric && !isArray) {
            const nums = values.map((v) => Number(v));
            const avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
            const min = Math.min(...nums);
            const max = Math.max(...nums);

            return (
              <div key={field}>
                <h3 className="text-sm font-medium text-[var(--muted)] mb-3">{fieldLabels[field] || field}</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[var(--primary-lighter)] rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-[var(--accent)]">{avg}</div>
                    <div className="text-xs text-[var(--accent)]">平均值</div>
                  </div>
                  <div className="bg-[var(--primary-light)] rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-[var(--primary)]">{min}</div>
                    <div className="text-xs text-[var(--primary)]">最小值</div>
                  </div>
                  <div className="bg-[var(--success-light)] rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-[var(--success)]">{max}</div>
                    <div className="text-xs text-[var(--success)]">最大值</div>
                  </div>
                </div>
              </div>
            );
          }

          if (isArray) {
            const counter: Record<string, number> = {};
            for (const arr of values) {
              for (const item of arr) {
                counter[String(item)] = (counter[String(item)] || 0) + 1;
              }
            }
            const entries = Object.entries(counter).sort((a, b) => b[1] - a[1]);

            return (
              <div key={field}>
                <h3 className="text-sm font-medium text-[var(--muted)] mb-3">{fieldLabels[field] || field}</h3>
                <div className="flex flex-wrap gap-2">
                  {entries.map(([item, count]) => (
                    <div key={item} className="bg-[var(--hover-bg)] rounded-full px-3 py-1 text-xs">
                      <span className="text-[var(--muted)]">{item}</span>
                      <span className="ml-1 font-medium text-[var(--foreground)]">{count}人</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          const uniqueValues = [...new Set(values.map((v) => String(v)))];
          const counter: Record<string, number> = {};
          for (const v of values) {
            const key = String(v);
            counter[key] = (counter[key] || 0) + 1;
          }
          const sorted = Object.entries(counter).sort((a, b) => b[1] - a[1]);

          return (
            <div key={field}>
              <h3 className="text-sm font-medium text-[var(--muted)] mb-3">{fieldLabels[field] || field}</h3>
              {uniqueValues.length <= 3 ? (
                <div className="space-y-2">
                  {sorted.map(([val, count]) => (
                    <div key={val} className="flex items-center gap-3 text-xs">
                      <span className="w-20 text-[var(--muted)] truncate">{val}</span>
                      <div className="flex-1 bg-[var(--primary-lighter)] rounded-full h-3">
                        <div
                          className="bg-[var(--primary)] rounded-full h-3 transition-all"
                          style={{ width: `${(count / values.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-[var(--muted)] w-6">{count}人</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sorted.map(([val, count]) => (
                    <div key={val} className="bg-[var(--hover-bg)] rounded-full px-3 py-1 text-xs">
                      <span className="text-[var(--foreground)]">{val}</span>
                      <span className="ml-1 text-[var(--muted-light)]">({count}人)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 行为数据视图：原有 ExplorationSubmission 展示（作品快照 / 操作日志 / 页面状态等）。
  // ⚠️ GOTCHA：双轨探究里这些数据与 QF 收集答案并存，早先「提交详情」在有 qfTaskId 时
  //   只显示 QF 名单表，canvas 作品快照 / 操作日志完全无入口，老师看不到学生作品。
  //   这里抽成独立函数，供下方「收集数据 / 行为数据」切换复用，避免行为轨丢失。
  // ⛔ DO NOT REVERT：不要把行为数据视图从双轨探究里摘掉——那会退回「作品快照无入口」。
  const renderBehaviorSubmissions = () => {
    if (submissions.length === 0) return <div className="text-center py-8 text-sm text-[var(--muted-light)]">暂无提交记录</div>;

    const toggleExpand = (id: string, studentId: string, canvasCount: number) => {
      const willExpand = !expandedIds.has(id);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // 展开且有 canvas 快照时，按 studentId 拉取该学生的完整数据（含大字段）
      if (willExpand && canvasCount > 0 && !detailCache[id]) {
        fetch(`/api/exploration-activities/${explorationId}/submissions?studentId=${studentId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((arr) => {
            if (Array.isArray(arr) && arr[0]?.answers) {
              try {
                const full = JSON.parse(arr[0].answers);
                setDetailCache((prev) => ({ ...prev, [id]: full }));
              } catch { /* 解析失败保持基础展示 */ }
            }
          })
          .catch(() => { /* 拉取失败不影响基础展示 */ });
      }
    };

    const renderAnswersDetail = (answers: Record<string, any>, canvasShots: string[]) => {
      const fieldLabels: Record<string, string> = {
        timeSpent: "停留时间（秒）",
        interactions: "互动次数",
        scrollDepth: "滚动深度（%）",
        attempts: "尝试次数",
        gameLevel: "游戏关卡",
        completedSections: "完成环节",
        canvasCount: "作品快照数",
      };
      // 大字段 / 对象字段单独渲染，不进通用网格
      const { gameState, storageSnapshot, textSnapshot, canvasCount, scoreInferred, ...rest } = answers;
      const items = Object.entries(rest).filter(
        ([, v]) => v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
      );

      return (
        <div className="space-y-3">
          {items.length === 0 && canvasShots.length === 0 ? (
            <div className="text-xs text-[var(--muted-light)]">无数据</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {items.map(([key, val]) => (
                <div key={key} className="bg-[var(--hover-bg)] rounded px-3 py-2">
                  <div className="text-xs text-[var(--muted-light)]">{fieldLabels[key] || key}</div>
                  <div className="text-sm font-medium text-[var(--foreground)] mt-0.5">
                    {key === "completedSections"
                      ? (Array.isArray(val) && val.length > 0 ? val.join("、") : "无")
                      : Array.isArray(val) ? val.join("、") : String(val)}
                  </div>
                </div>
              ))}
              {scoreInferred === true && (
                <div className="bg-[var(--warning-light)] rounded px-3 py-2">
                  <div className="text-xs text-[var(--muted-light)]">分数来源</div>
                  <div className="text-sm font-medium text-[var(--warning)] mt-0.5">页面文本推测（页面未主动上报）</div>
                </div>
              )}
            </div>
          )}

          {/* AI 上报的页面状态（契约轨明细） */}
          {gameState && typeof gameState === "object" && Object.keys(gameState).length > 0 && (
            <div>
              <div className="text-xs text-[var(--muted-light)] mb-1">🤖 页面状态（AI 上报）</div>
              <div className="bg-[var(--primary-light)] rounded p-2 text-xs font-mono break-all">
                {JSON.stringify(gameState)}
              </div>
            </div>
          )}

          {/* canvas 作品快照（详情拉取后展示） */}
          {canvasShots.length > 0 && (
            <div>
              <div className="text-xs text-[var(--muted-light)] mb-1">🖼️ 作品快照</div>
              <div className="flex flex-wrap gap-2">
                {canvasShots.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`作品快照 ${i + 1}`}
                    className="max-w-[220px] rounded border border-[var(--card-border)]"
                  />
                ))}
              </div>
            </div>
          )}

          {/* 页面文本快照（折叠） */}
          {typeof textSnapshot === "string" && textSnapshot.trim() && (
            <details>
              <summary className="text-xs text-[var(--muted-light)] cursor-pointer">📄 页面文本快照</summary>
              <pre className="mt-1 max-h-40 overflow-y-auto text-xs bg-[var(--hover-bg)] rounded p-2 whitespace-pre-wrap">{textSnapshot}</pre>
            </details>
          )}

          {/* 页面存档数据（折叠） */}
          {storageSnapshot && typeof storageSnapshot === "object" && Object.keys(storageSnapshot).length > 0 && (
            <details>
              <summary className="text-xs text-[var(--muted-light)] cursor-pointer">💾 页面存档数据</summary>
              <pre className="mt-1 max-h-40 overflow-y-auto text-xs bg-[var(--hover-bg)] rounded p-2 whitespace-pre-wrap">{JSON.stringify(storageSnapshot, null, 2)}</pre>
            </details>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-3">
        <div className="text-sm text-[var(--muted)] mb-2">
          共 {submissions.length} 人提交
        </div>

        {submissions.map((sub) => {
          let answers: any = {};
          try { answers = JSON.parse(sub.answers || "{}"); } catch { }
          const isExpanded = expandedIds.has(sub.id);
          // 详情缓存命中时用完整版 answers（含 canvasSnapshots / textSnapshot）
          const displayAnswers = detailCache[sub.id] || answers;
          const canvasShots: string[] = Array.isArray(displayAnswers.canvasSnapshots)
            ? displayAnswers.canvasSnapshots
            : [];

          return (
            <div key={sub.id} className="border border-[var(--card-border)] rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 bg-[var(--hover-bg)] cursor-pointer hover:bg-[var(--primary-lighter)] transition-colors"
                onClick={() => toggleExpand(sub.id, sub.studentId, displayAnswers.canvasCount || 0)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-[var(--foreground)]">{sub.studentName}</span>
                  <span className="text-xs text-[var(--muted-light)]">
                    {new Date(sub.submittedAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-[var(--muted-light)] transition-transform" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                  ▼
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 py-3 space-y-4 border-t border-[var(--card-border)]">
                  <div>
                    <h5 className="text-xs font-medium text-[var(--muted)] mb-2">📊 提交数据</h5>
                    {renderAnswersDetail(displayAnswers, canvasShots)}
                  </div>
                  <div>
                    <h5 className="text-xs font-medium text-[var(--muted)] mb-2">📋 操作记录</h5>
                    {sub.actionLogs && sub.actionLogs.length > 0 ? (
                      <div className="max-h-48 overflow-y-auto space-y-1 bg-[var(--hover-bg)] rounded p-3">
                        {sub.actionLogs.map((log, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" />
                            <span className="text-[var(--primary)] font-medium">{log.type}</span>
                            <span className="text-[var(--muted-light)]">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--muted-light)]">无操作记录</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSubmissions = () => {
    if (loading) return <div className="text-center py-8 text-sm text-[var(--muted-light)]">加载中...</div>;

    // 双轨：探究绑定了 QuickForm 收集任务 → 「收集数据 / 行为数据」两个视图切换；
    // 否则只有行为数据（ExplorationSubmission），不影响既有探究。
    if (qfTaskId) {
      if (qfLoading) return <div className="text-center py-8 text-sm text-[var(--muted-light)]">加载中...</div>;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSubmissionView("qf")}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${submissionView === "qf" ? "bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary-light)]" : "bg-[var(--card-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--hover-bg)]"}`}
            >
              收集数据（{qfTotal || qfRecords.length}）
            </button>
            <button
              onClick={() => setSubmissionView("behavior")}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${submissionView === "behavior" ? "bg-[var(--primary-light)] text-[var(--primary)] border-[var(--primary-light)]" : "bg-[var(--card-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--hover-bg)]"}`}
            >
              行为数据（{submissions.length}）
            </button>
          </div>
          {submissionView === "qf" ? (
            <QuickFormRecordList records={qfRecords} total={qfTotal} />
          ) : (
            renderBehaviorSubmissions()
          )}
        </div>
      );
    }

    return renderBehaviorSubmissions();
  };

  const renderAiReport = () => (
    <div className="bg-[var(--card-bg)] rounded-xl shadow-sm border border-[var(--card-border)]">
      {/* 头部：标题 + 版本切换 + 操作按钮 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-2">
          <ChartBarIcon className="text-[#FF6B35]" />
          <span className="font-medium text-[var(--foreground)] text-sm">AI 分析报告</span>
          {aiReportVersions.length > 1 && (
            <div className="flex items-center ml-3 gap-2">
              <span className="text-xs text-[var(--muted-light)]">版本：</span>
              {aiReportVersions.map((v, i) => (
                <div key={i} className="flex items-center gap-3">
                  <button
                    className={`px-2 py-0.5 text-xs rounded ${i === aiVersionIndex ? 'bg-[var(--primary)] text-white' : 'bg-[var(--primary-lighter)] text-[var(--muted)] hover:bg-[var(--hover-bg)]'}`}
                    onClick={() => {
                      setAiVersionIndex(i);
                      setAiReport(v);
                    }}
                  >
                    v{v.version}
                  </button>
                  {v.id && (
                    <button
                      className="text-xs text-[var(--danger)] hover:text-[var(--danger)] px-0.5"
                      onClick={() => {
                        setDeleteVersion({ id: v.id!, version: v.version });
                        setDeleteVisible(true);
                      }}
                      title="删除此版本"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="px-2 py-1 border border-[var(--card-border)] rounded text-xs focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            >
              <option value="">默认模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isDefault ? " (默认)" : ""}
                </option>
              ))}
            </select>
          )}
          {selectedTemplateId && (() => {
            const tpl: any = templates.find((t: any) => t.id === selectedTemplateId);
            if (!tpl) return null;
            return (
              <TemplatePreviewButton
                templateId={tpl.id}
                templateName={tpl.name}
                templateType={tpl.type}
                hasPreview={!!tpl.hasPreview}
                previewStale={!!tpl.previewStale}
              />
            );
          })()}
          <Button
            theme="primary"
            size="small"
            loading={generatingReport}
            onClick={handleGenerateAiReport}
          >
            {aiReport ? "重新生成" : "生成报告"}
          </Button>
        </div>
      </div>

      {/* 内容 */}
      <div className="p-4">
        {aiReport ? (
          <InsightContent content={aiReport.content} />
        ) : generatingReport ? (
          <div className="text-center py-12 text-[var(--muted-light)]">AI 正在生成报告...</div>
        ) : (
          <div className="text-center py-12 text-[var(--muted-light)]">
            点击「生成报告」按钮，AI 将基于所有提交数据生成分析报告
          </div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <TeacherLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-sm text-[var(--muted-light)]">加载中...</div>
        </div>
      </TeacherLayout>
    );
  }

  if (error) {
    return (
      <TeacherLayout>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <Button theme="primary" variant="text" size="small" icon={<ArrowLeftIcon />} onClick={() => router.back()} />
            <h2 className="text-xl font-semibold">探究分析</h2>
          </div>
          <div className="text-center py-12">
            <div className="text-[var(--danger)] text-sm mb-4">{error}</div>
            <Button onClick={fetchData}>重试</Button>
          </div>
        </div>
      </TeacherLayout>
    );
  }

  return (
    <TeacherLayout>
      <div className="p-6">
        {/* 顶部导航 */}
        <div className="flex items-center gap-3 mb-6">
          <Button theme="primary" variant="text" size="small" icon={<ArrowLeftIcon />} onClick={() => router.back()} />
          <div>
            <h2 className="text-xl font-semibold">探究分析报告</h2>
            <p className="text-sm text-[var(--muted)] mt-0.5">{analysisData?.explorationTitle}</p>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {lastUpdated && (
              <span className="text-xs text-[var(--muted-light)]">最后更新 {lastUpdated}</span>
            )}
            {/* 2026-10-11：「自动刷新」开关+秒数已移入「统计信息」tab 的 QF 大屏工具栏 ——
                轮询只刷提交统计数据，与 AI 报告等其他 tab 无关，控件应与被刷新内容同处一 tab。 */}
            <Button
              theme="default"
              variant="outline"
              size="small"
              icon={<RefreshIcon />}
              loading={refreshing}
              onClick={() => refreshLiveData()}
            >
              刷新
            </Button>
            {analysisData?.classIds && analysisData.classIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--muted)]">班级：</span>
                <select
                  value={selectedClassId}
                  onChange={(e) => {
                    const cid = e.target.value;
                    setSelectedClassId(cid);
                    setAiReport(null);
                    setAiReportVersions([]);
                    setAiVersionIndex(0);
                    fetchAiVersions(cid);
                    // 提交列表 / QF 数据大屏 / 提交详情也按班级重新拉取（显式传新班级，避免闭包旧值）
                    refreshLiveData(cid);
                  }}
                  className="px-3 py-1.5 border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  {analysisData.classIds.map((cid: string) => {
                    const cls = allClasses.find((c) => c.id === cid);
                    return (
                      <option key={cid} value={cid}>
                        {cls ? cls.name : cid.substring(0, 8)}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="border-b border-[var(--card-border)] mb-6">
          <TabButton tabKey="statistics" label="统计信息" />
          <TabButton tabKey="submissions" label="提交详情" />
          <TabButton tabKey="ai" label="AI 分析报告" />
        </div>

        {/* Tab 内容 */}
        {activeTab === "statistics" && renderStatistics()}
        {activeTab === "submissions" && renderSubmissions()}
        {activeTab === "ai" && renderAiReport()}
      </div>

      {/* 删除版本确认 */}
      <Dialog
        header="删除分析版本"
        visible={deleteVisible}
        onClose={() => { setDeleteVisible(false); setDeleteVersion(null); }}
        footer={null}
      >
        <div className="space-y-4">
          <p className="text-[var(--foreground)]">
            确定要删除 <strong>v{deleteVersion?.version}</strong> 版分析吗？
          </p>
          <p className="text-sm text-[var(--danger)]">此操作不可撤销！</p>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => { setDeleteVisible(false); setDeleteVersion(null); }}>取消</Button>
            <Button theme="danger" loading={deleting} onClick={async () => {
              if (!deleteVersion) return;
              setDeleting(true);
              try {
                const token = localStorage.getItem("token");
                const res = await fetch(`/api/insights/${deleteVersion.id}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  MessagePlugin.success("版本已删除");
                  const updated = aiReportVersions.filter((v) => v.id !== deleteVersion.id);
                  setAiReportVersions(updated);
                  if (updated.length > 0) {
                    const newIdx = Math.min(aiVersionIndex, updated.length - 1);
                    setAiVersionIndex(newIdx);
                    setAiReport(updated[newIdx]);
                  } else {
                    setAiReport(null);
                    setAiVersionIndex(0);
                  }
                } else {
                  MessagePlugin.error("删除失败");
                }
              } catch { MessagePlugin.error("网络错误"); }
              finally {
                setDeleting(false);
                setDeleteVisible(false);
                setDeleteVersion(null);
              }
            }}>
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>
    </TeacherLayout>
  );
}