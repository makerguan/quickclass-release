"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Button, Card, Select, Tag, Loading, MessagePlugin,
  Dialog, Textarea,
} from "tdesign-react";
import {
  ChevronLeftIcon,
  ChartBarIcon,
  InfoCircleIcon,
} from "tdesign-icons-react";
import Markdown from "@/components/Markdown";
import TeacherLayout from "@/components/layout/TeacherLayout";
import { usePromptPreview, PromptPreviewDialog } from "@/components/prompt-preview";

// ===== 辅助函数 =====

/** 剥离 markdown 代码块包裹（如 ```html ... ```） */
function stripMarkdownCodeBlock(content: string): string {
  const trimmed = content.trim();
  // 匹配 ```html 或 ``` 开头，``` 结尾
  const match = trimmed.match(/^```(?:html|HTML)?\s*\n([\s\S]*?)\n```$/);
  if (match) return match[1].trim();
  return content;
}

/** 判断内容是否为 HTML 格式 */
function isHtmlContent(content: string): boolean {
  const stripped = stripMarkdownCodeBlock(content);
  const trimmed = stripped.trim();
  return trimmed.startsWith('<!DOCTYPE') || 
         trimmed.startsWith('<html') ||
         (trimmed.includes('<html') && trimmed.includes('</html>'));
}

/** 渲染洞察内容 - 支持 HTML 和 Markdown，带全屏按钮 */
function InsightContent({ content, className = "" }: { content: string; className?: string }) {
  if (isHtmlContent(content)) {
    const htmlContent = stripMarkdownCodeBlock(content);
    return (
      <div className="relative group">
        <button
          className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-white/80 hover:bg-white text-gray-600 rounded border border-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => {
            const w = window.open('', '_blank');
            if (w) {
              w.document.write(htmlContent);
              w.document.close();
              w.document.title = '学情分析报告';
            }
          }}
        >
          全屏查看
        </button>
        <iframe
          srcDoc={htmlContent}
          className={`w-full border-none ${className}`}
          style={{ minHeight: "400px" }}
          sandbox="allow-scripts"
          title="学情分析报告"
        />
      </div>
    );
  }
  return (
    <div className={`prose prose-sm prose-gray max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-all ${className}`}>
      <Markdown>{content}</Markdown>
    </div>
  );
}

// ===== 类型定义 =====

interface PresetConversation {
  id: string; title: string; description?: string; analysisPrompt?: string;
  completedCount?: number; totalCount?: number;
}

interface SubProject {
  id: string; title: string; objectives: string; requirements: string;
  analysisPrompt?: string;
  presetConversations: PresetConversation[];
}

interface LearningTask {
  id: string; title: string; description?: string;
  objectives: string; requirements: string; knowledgeBase?: string;
  analysisPrompt?: string;
  subProjects: SubProject[];
  assignments?: Array<{ classId: string; class: { id: string; name: string } }>;
}

interface ClassData {
  classId: string; className: string;
  totalStudents: number; activeStudents: number;
  totalConversations: number; totalMessages: number;
  subProjects: SubProject[];
  students: Array<{ id: string; name: string; convCount: number; msgCount: number; completedPresets: string[]; lastActiveAt: string | null }>;
}

interface Insight {
  id: string; type: string; content: string; version: number; createdAt: string; classId: string; userId?: string;
  starCount?: number;
}

interface PCInsight { id: string; userId?: string; studentName?: string; content: string; version: number; createdAt: string; starCount?: number; }
// 模板类型
interface AnalysisTemplate {
  id: string;
  type: "student" | "class";
  name: string;
  content: string;
  isDefault: boolean;
}

export default function TaskInsightsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = params.taskId as string;

  const [task, setTask] = useState<LearningTask | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // 根据 URL 参数确定当前分析层级
  const viewLevel = useMemo(() => {
    const pcParam = searchParams.get("pc");
    if (pcParam) return "dialogue";
    return "task";
  }, [searchParams]);

  // 任务级数据
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [insightDataSource, setInsightDataSource] = useState<string>("CONVERSATIONS");
  const [requireStarRating, setRequireStarRating] = useState<boolean>(false);

  // 对话活动数据
  const [pcLoading, setPcLoading] = useState(false);
  const [pcClassInsight, setPcClassInsight] = useState<{ content: string; version: number; createdAt: string } | null>(null);
  const [pcClassInsightVersions, setPcClassInsightVersions] = useState<{ id?: string; content: string; version: number; createdAt: string }[]>([]);
  const [pcClassVersionIndex, setPcClassVersionIndex] = useState(0);
  const [pcDeleteVersion, setPcDeleteVersion] = useState<{ id: string; version: number } | null>(null);
  const [pcDeleteVisible, setPcDeleteVisible] = useState(false);
  const [pcDeleting, setPcDeleting] = useState(false);
  const [pcStudentInsights, setPcStudentInsights] = useState<PCInsight[]>([]);
  const [pcStudents, setPcStudents] = useState<Array<{ id: string; name: string; convCount: number; msgCount: number; completedPresets: string[]; lastActiveAt: string | null }>>([]);
  const [selectedPCId, setSelectedPCId] = useState<string>("");

  // 任务级数据
  const [taskClassInsight, setTaskClassInsight] = useState<{ id?: string; content: string; version: number; createdAt: string } | null>(null);
  const [taskClassInsightVersions, setTaskClassInsightVersions] = useState<{ id?: string; content: string; version: number; createdAt: string }[]>([]);
  const [taskClassVersionIndex, setTaskClassVersionIndex] = useState(0);
  const [taskDeleteVersion, setTaskDeleteVersion] = useState<{ id: string; version: number } | null>(null);
  const [taskDeleteVisible, setTaskDeleteVisible] = useState(false);
  const [taskDeleting, setTaskDeleting] = useState(false);
  const [taskStudentInsights, setTaskStudentInsights] = useState<Insight[]>([]);

  // 生成状态
  const [loadingClassInsight, setLoadingClassInsight] = useState(false);
  const [loadingStudentId, setLoadingStudentId] = useState<string | null>(null);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);

  // 班级分析收展
  const [expandedPcClass, setExpandedPcClass] = useState(true);  // 默认展开班级分析
  const [expandedTaskClass, setExpandedTaskClass] = useState(true);  // 默认展开课堂分析

  


  // 对比
  const [showComparison, setShowComparison] = useState<Record<string, boolean>>({});
  const [previousInsights, setPreviousInsights] = useState<Record<string, string>>({});

  // 下级报告缺失检查对话框
  const [missingDialogVisible, setMissingDialogVisible] = useState(false);
  const [missingItems, setMissingItems] = useState<{
    presetConversations?: Array<{ id: string; title: string; missingClass: boolean; missingStudents: string[] }>;
  }>({});
  const [pendingGenerate, setPendingGenerate] = useState<(() => Promise<void>) | null>(null);

  // 提示词编辑
  const [promptDialogVisible, setPromptDialogVisible] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [promptDialogType, setPromptDialogType] = useState<"pc" | "task">("task");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [promptDialogLevel, setPromptDialogLevel] = useState<string>("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [promptDialogTitle, setPromptDialogTitle] = useState<string>("");
  const [promptDialogValue, setPromptDialogValue] = useState<string>("");
  const [promptDialogSaving, setPromptDialogSaving] = useState(false);
  const [promptDialogGenerating, setPromptDialogGenerating] = useState(false);

  // 星星排序状态：null=默认排序，true=从高到低，false=从低到高
  const [starSortDesc, setStarSortDesc] = useState<boolean | null>(null);

  // 提示词预览
  const {
    promptPreviewLoading,
    promptPreviewContent,
    promptPreviewVisible,
    pendingPreviewAction,
    setPromptPreviewVisible,
    withPromptPreview,
  } = usePromptPreview();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);

  // ===== 数据获取 =====

  useEffect(() => {
    fetchTask();
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, searchParams]);

  const fetchTemplates = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/analysis-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch { /* ignore */ }
  };

  const fetchTask = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTask(data);
        
        // 根据 URL 参数设置选择器
        const spParam = searchParams.get("sp");
        const pcParam = searchParams.get("pc");
        
        if (pcParam) {
          setSelectedPCId(pcParam);
        }
        
        // 获取当前班级并设置
        await fetchCurrentClass(data);
      }
    } catch { MessagePlugin.error("获取课堂详情失败"); }
    finally { setLoading(false); }
  };

  const fetchCurrentClass = async (taskData: LearningTask) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/classes/current", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const currentClass = data.class;
        const assignedClassIds = taskData.assignments?.map((a) => a.classId) || [];
        
        if (assignedClassIds.length > 0) {
          // 有分配班级：先看当前班级是否在分配列表中
          if (currentClass && assignedClassIds.includes(currentClass.id)) {
            setSelectedClassId(currentClass.id);
          } else {
            // 当前班级不在分配中或没有当前班级，选第一个分配班级
            setSelectedClassId(assignedClassIds[0]);
          }
        } else if (currentClass) {
          // 没有分配班级，使用当前班级
          setSelectedClassId(currentClass.id);
        }
        
        // 如果没有设置对话活动，自动设置第一个
        const spParam = searchParams.get("sp");
        const pcParam = searchParams.get("pc");
        if (!spParam && !pcParam && taskData.subProjects?.length > 0) {
          if (taskData.subProjects[0].presetConversations?.length > 0) {
            setSelectedPCId(taskData.subProjects[0].presetConversations[0].id);
          }
        }
      }
    } catch { /* ignore */ }
  };

  // 加载班级基础数据（所有层级都需要学生列表等基础信息）
  useEffect(() => {
    if (!selectedClassId) return;
    fetchTaskInsights(selectedClassId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  // 根据当前层级加载对应的洞察数据
  useEffect(() => {
    if (!selectedClassId) return;
    if (viewLevel === "dialogue" && selectedPCId) {
      fetchPCInsights(selectedPCId, selectedClassId);
    }
    // 课堂层级的洞察数据在 fetchTaskInsights 中已获取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLevel, selectedPCId, selectedClassId]);

  const fetchTaskInsights = async (classId: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${taskId}/insights?classId=${classId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setClasses(data.classes || []);
      setInsightDataSource(data.insightDataSource || "CONVERSATIONS");
      setRequireStarRating(data.requireStarRating ?? false);

      // 任务级洞察
      const tc = (data.insights || []).filter((i: Insight) => i.type === "task_class");
      const tcVersions = tc.map((i: Insight) => ({ id: i.id, content: i.content, version: i.version, createdAt: i.createdAt ?? new Date().toISOString() }));
      setTaskClassInsightVersions(tcVersions);
      if (tcVersions.length > 0) {
        setTaskClassInsight(tcVersions[0]);
        setTaskClassVersionIndex(0);
      }
      const ts = (data.insights || []).filter((i: Insight) => i.type === "task_student");
      setTaskStudentInsights(ts);

      // 从 classes 中取第一个
      const cls = (data.classes || [])[0];
      if (!cls) return;

      // 初始化对话活动选择
      if (cls.subProjects?.length > 0) {
        const firstSP = cls.subProjects[0];
        const firstPC = firstSP?.presetConversations?.[0];
        
        // 只有在未选中时才设置
        if (firstPC && !selectedPCId) setSelectedPCId(firstPC.id);
      }
    } catch { /* ignore */ }
  };

  // 获取对话活动洞察
  const fetchPCInsights = async (pcId: string, classId: string) => {
    setPcLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/preset-conversations/${pcId}/insights?classId=${classId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const insights = data.classInsights || [];
        setPcClassInsightVersions(insights);
        setPcClassVersionIndex(insights.length > 0 ? 0 : 0);
        setPcClassInsight(insights.length > 0 ? insights[0] : null);
        setPcStudentInsights(data.studentInsights || []);
        setPcStudents((data.students || []).map((s: { id: string; name: string; convCount: number }) => ({
          ...s,
          msgCount: 0,
          completedPresets: [],
          lastActiveAt: null,
        })));
      }
    } catch { /* ignore */ }
    finally { setPcLoading(false); }
  };

  



  // ===== AI 生成 =====

  // 检查下级报告完整度，如果缺失则弹对话框
  const checkAndGenerateClassInsight = async () => {
    if (!selectedClassId) return;
    // 只有 TASK_INSIGHTS 模式才需要检查
    if (insightDataSource === "TASK_INSIGHTS") {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${taskId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId: selectedClassId, type: "class", checkOnly: true }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.hasMissing) {
          setMissingItems(result.missingItems);
          setPendingGenerate(() => generateClassInsight);
          setMissingDialogVisible(true);
          return;
        }
      }
    }
    // 无缺失或原始对话模式，直接生成
    await generateClassInsight();
  };

  const generateClassInsight = async () => {
    if (!selectedClassId) return;
    setLoadingClassInsight(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${taskId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId: selectedClassId, type: "class" }),
      });
      if (res.ok) {
        const data = await res.json();
        const newInsight = { id: data.id, content: data.content, version: data.version, createdAt: new Date().toISOString() };
        setTaskClassInsight(newInsight);
        setTaskClassInsightVersions((prev) => {
          const updated = data.previousContent
            ? [{ id: data.previousId, content: data.previousContent, version: data.version - 1, createdAt: "" }, newInsight]
            : [newInsight];
          return updated;
        });
        setTaskClassVersionIndex(0);
        setExpandedTaskClass(true);
        if (data.previousContent) setPreviousInsights((p) => ({ ...p, task_class: data.previousContent }));
        MessagePlugin.success("班级学情洞察已生成");
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || "生成洞察失败");
      }
    } catch { MessagePlugin.error("网络错误"); }
    finally { setLoadingClassInsight(false); }
  };

  const generateStudentInsight = async (studentId: string) => {
    if (!selectedClassId) return;
    setLoadingStudentId(studentId);
    setExpandedStudentId(studentId);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/tasks/${taskId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId: selectedClassId, type: "student", studentId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.previousContent) setPreviousInsights((p) => ({ ...p, [studentId]: data.previousContent }));
        await fetchTaskInsights(selectedClassId);
        MessagePlugin.success("学生分析已生成");
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || "生成分析失败");
      }
    } catch { MessagePlugin.error("网络错误"); }
    finally { setLoadingStudentId(null); }
  };

  const generatePCInsight = async (type: "class" | "student", studentId?: string) => {
    if (!selectedPCId || !selectedClassId) return;
    if (type === "student" && !studentId) return;
    if (type === "student") {
      setLoadingStudentId(studentId!);
    } else {
      setLoadingClassInsight(true);
    }
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/preset-conversations/${selectedPCId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId: selectedClassId, type, ...(studentId ? { studentId } : {}) }),
      });
      if (res.ok) {
        if (type === "class") {
          const data = await res.json();
          const newInsight = { id: data.id, content: data.content, version: data.version, createdAt: new Date().toISOString() };
          setPcClassInsight(newInsight);
          setPcClassInsightVersions((prev) => {
            const updated = data.previousContent
              ? [{ id: data.previousId, content: data.previousContent, version: data.version - 1, createdAt: "" }, newInsight]
              : [newInsight];
            return updated;
          });
          setPcClassVersionIndex(0);
        } else {
          await fetchPCInsights(selectedPCId, selectedClassId);
        }
        MessagePlugin.success("分析已生成");
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || "生成失败");
      }
    } catch { MessagePlugin.error("网络错误"); }
    finally { 
      if (type === "student") {
        setLoadingStudentId(null);
      } else {
        setLoadingClassInsight(false);
      }
    }
  };

  // ===== 批量分析所有学生 =====
  
  const batchAnalyzeAllStudents = async () => {
    if (!selectedClassId || !currentClass) return;
    
    const students = viewLevel === "dialogue"
      ? pcStudents.filter((s) => s.convCount > 0)
      : currentClass.students.filter((s) => s.convCount > 0);
    if (students.length === 0) {
      MessagePlugin.warning("没有可分析的学生（无对话记录）");
      return;
    }

    setBatchAnalyzing(true);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const student of students) {
      try {
        let res: Response;
        const token = localStorage.getItem("token");
        
        if (viewLevel === "dialogue" && selectedPCId) {
          res = await fetch(`/api/preset-conversations/${selectedPCId}/insights`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ classId: selectedClassId, type: "student", studentId: student.id }),
          });
        } else if (viewLevel === "task") {
          res = await fetch(`/api/tasks/${taskId}/insights`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ classId: selectedClassId, type: "student", studentId: student.id }),
          });
        } else {
          continue;
        }

        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }

        // 每分析完一个就更新列表
        if (viewLevel === "dialogue" && selectedPCId) {
          await fetchPCInsights(selectedPCId, selectedClassId);
        } else if (viewLevel === "task") {
          await fetchTaskInsights(selectedClassId);
        }
        
        // 短暂延迟避免请求过快
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        failCount++;
      }
    }
    
    setBatchAnalyzing(false);
    
    if (successCount > 0) {
      MessagePlugin.success(`已完成 ${successCount} 名学生的分析${failCount > 0 ? `，${failCount} 名失败` : ""}`);
    } else {
      MessagePlugin.error("批量分析失败");
    }
  };

  // ===== 提示词自动生成 =====

  // const openPromptDialog = (type: "pc" | "task", levelId: string, levelTitle: string, currentPrompt: string) => {
  //   setPromptDialogType(type);
  //   setPromptDialogLevel(levelId);
  //   setPromptDialogTitle(levelTitle);
  //   setPromptDialogValue(currentPrompt || "");
  //   setPromptDialogVisible(true);
  // };

  const generatePromptByAI = async () => {
    setPromptDialogGenerating(true);
    try {
      // 调用后端 API 来生成提示词，而不是直接在前端调用 AI
      const token = localStorage.getItem("token");
      
      let context = "";
      if (promptDialogType === "task" && task) {
        context = JSON.stringify({ type: "task", title: task.title, objectives: task.objectives, requirements: task.requirements });
      } else if (promptDialogType === "pc") {
        for (const sp of classes[0]?.subProjects || []) {
          const pc = sp.presetConversations.find((p) => p.id === promptDialogLevel);
          if (pc) { context = JSON.stringify({ type: "pc", title: pc.title, parentTitle: sp.title }); break; }
        }
      }

      const res = await fetch("/api/ai-analysis/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: context,
      });

      if (res.ok) {
        const data = await res.json();
        setPromptDialogValue(data.prompt);
        MessagePlugin.success("提示词已自动生成");
      } else {
        const err = await res.json().catch(() => ({}));
        MessagePlugin.error(err.error || "自动生成失败，请检查 AI 配置");
      }
    } catch (err) { 
      console.error("生成提示词失败:", err);
      MessagePlugin.error("网络错误，请检查 AI 配置是否正确"); 
    }
    finally { setPromptDialogGenerating(false); }
  };

  const savePromptTemplate = async () => {
    if (!promptDialogLevel) return;
    setPromptDialogSaving(true);
    try {
      const token = localStorage.getItem("token");

      if (promptDialogType === "task") {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ analysisPrompt: promptDialogValue }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "保存失败");
        }
      } else if (promptDialogType === "pc") {
        // 保存对话活动的提示词
        const res = await fetch(`/api/tasks/${taskId}/subprojects/${promptDialogLevel}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ analysisPrompt: promptDialogValue }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "保存失败");
        }
      }

      MessagePlugin.success("提示词模板已保存");
      setPromptDialogVisible(false);
      fetchTask();
      
      // 实时更新本地状态，无需等待 fetchTask
      if (promptDialogType === "pc" && selectedPCId) {
        setClasses((prev) => prev.map((cls) => ({
          ...cls,
          subProjects: cls.subProjects.map((sp) => ({
            ...sp,
            presetConversations: sp.presetConversations.map((pc) =>
              pc.id === selectedPCId ? { ...pc, analysisPrompt: promptDialogValue } : pc
            ),
          })),
        })));
      } else if (promptDialogType === "task") {
        setTask((prev) => prev ? { ...prev, analysisPrompt: promptDialogValue } : prev);
      }
    } catch (err) { 
      MessagePlugin.error(err instanceof Error ? err.message : "保存失败"); 
    }
    finally { setPromptDialogSaving(false); }
  };

  // ===== 工具函数 =====

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const formatLastActive = (dateStr: string | null) => {
    if (!dateStr) return "未活跃";
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} 分钟前`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} 天前`;
    return formatDate(dateStr);
  };

  const currentClass = classes[0];
  const pcOptions = currentClass?.subProjects.flatMap((sp) =>
    sp.presetConversations.map((pc) => ({ label: `${sp.title} / ${pc.title}`, value: pc.id }))
  ) || [];

  // ===== 星星显示 =====
  const TOTAL_STARS = 10;

  const StarRating = ({ count }: { count: number }) => {
    const displayCount = Math.max(0, Math.min(count, TOTAL_STARS));
    return (
      <span className="text-sm whitespace-nowrap" title={`${count}/${TOTAL_STARS}`}>
        <span className="text-[#BBBBBB]">指数：</span>
        <span className="text-[#F5A623]">
          {"★".repeat(displayCount)}
        </span>
        <span className="text-[#DDDDDD]">
          {"☆".repeat(TOTAL_STARS - displayCount)}
        </span>
      </span>
    );
  };

  // ===== 排序逻辑 =====
  const sortStudents = (students: Array<{ id: string; name: string; convCount: number; msgCount: number; completedPresets: string[]; lastActiveAt: string | null }>,
    insights: Array<{ userId?: string; starCount?: number }>,
    sortDesc: boolean | null) => {
    if (sortDesc === null) return students;
    return [...students].sort((a, b) => {
      const aIns = insights.find((i) => i.userId === a.id);
      const bIns = insights.find((i) => i.userId === b.id);
      const aStars = aIns?.starCount || 0;
      const bStars = bIns?.starCount || 0;
      const aHasInsight = !!aIns;
      const bHasInsight = !!bIns;
      // 无洞察的排在最后
      if (!aHasInsight && !bHasInsight) return 0;
      if (!aHasInsight) return 1;
      if (!bHasInsight) return -1;
      // 有洞察的按星星排序
      return sortDesc ? bStars - aStars : aStars - bStars;
    });
  };

  const StarSortButton = ({ sortDesc, onChange }: { sortDesc: boolean | null; onChange: (v: boolean | null) => void }) => (
    <Button
      theme={sortDesc !== null ? "primary" : "default"}
      variant={sortDesc !== null ? "base" : "outline"}
      size="small"
      onClick={() => {
        if (sortDesc === null) onChange(true);
        else if (sortDesc) onChange(false);
        else onChange(null);
      }}
    >
      {sortDesc === null ? "默认排序" : sortDesc ? "星星 ↓" : "星星 ↑"}
    </Button>
  );

  if (loading) {
    return (
      <TeacherLayout>
        <div className="flex items-center justify-center h-64"><Loading text="加载中..." /></div>
      </TeacherLayout>
    );
  }

  if (!task) {
    return (
      <TeacherLayout>
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg">课堂不存在</p>
          <Button theme="primary" variant="text" onClick={() => router.push("/teacher/tasks")} className="mt-4">
            返回课堂列表
          </Button>
        </div>
      </TeacherLayout>
    );
  }

  const classOptions = task.assignments?.map((a) => ({
    label: a.class.name, value: a.classId,
  })) || [];

  return (
    <TeacherLayout>
      <div className="max-w-6xl space-y-6 pb-8">
        {/* 顶部导航 */}
        <div className="flex items-center gap-3">
          <Button theme="default" variant="text" icon={<ChevronLeftIcon />} onClick={() => router.push("/teacher/tasks")}>
            返回课堂列表
          </Button>
        </div>

        {/* 课堂基本信息 */}
        <Card>
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#1A1A1A]">{task.title}</h2>
                {task.description && <p className="text-sm text-[#63666F] mt-1">{task.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[#63666F]">班级：</span>
                <Select value={selectedClassId} onChange={(val) => setSelectedClassId(String(val))}
                  options={classOptions} placeholder="选择班级" style={{ width: 180 }} size="medium" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tag theme="primary" variant="light" size="small">
                {task.subProjects.length} 个学习活动
              </Tag>
              <Tag theme="success" variant="light" size="small">
                {task.subProjects.reduce((s, sp) => s + sp.presetConversations.length, 0)} 个对话活动
              </Tag>
              <Tag theme={insightDataSource === "TASK_INSIGHTS" ? "warning" : "default"} variant="light" size="small">
                数据来源：{insightDataSource === "TASK_INSIGHTS" ? "存在报告" : "原始对话"}
              </Tag>
            </div>
          </div>
        </Card>

        <Card>
          <div className="mt-4">
            {/* ===== 对话活动层级 ===== */}
            {viewLevel === "dialogue" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Select
                    value={selectedPCId}
                    onChange={(val) => setSelectedPCId(String(val))}
                    options={pcOptions}
                    placeholder="选择对话活动"
                    style={{ width: 300 }}
                    size="medium"
                  />
                </div>

                {pcLoading ? (
                  <Loading text="加载中..." />
                ) : selectedPCId && currentClass ? (
                  <>
                    {/* 班级分析 */}
                    <div className="bg-[#F7F8FA] rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-[#EEF0F3] transition-colors"
                        onClick={() => setExpandedPcClass(!expandedPcClass)}>
                        <div className="flex items-center gap-2">
                          <span className={`text-[#63666F] text-xs transition-transform ${expandedPcClass ? 'rotate-90' : ''}`}>▶</span>
                          <h4 className="font-medium text-sm">{pcOptions.find(o => o.value === selectedPCId)?.label || (selectedPCId ? "班级分析" : "请选择对话活动")}</h4>
                          {pcClassInsight && (
                            <span className="text-xs text-[#63666F]">
                              · 第 {pcClassInsight.version} 版 · {formatDate(pcClassInsight.createdAt)}
                            </span>
                          )}
                          {pcClassInsightVersions.length > 1 && (
                            <div className="flex items-center ml-3 gap-2">
                              <span className="text-xs text-gray-400">版本：</span>
                              {pcClassInsightVersions.map((v, i) => (
                                <div key={i} className="flex items-center gap-3">
                                  <button
                                    className={`px-2 py-0.5 text-xs rounded ${i === pcClassVersionIndex ? 'bg-[#0052D9] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPcClassVersionIndex(i);
                                      setPcClassInsight(v);
                                    }}
                                  >
                                    v{v.version}
                                  </button>
                                  {v.id && (
                                    <button
                                      className="text-xs text-red-400 hover:text-red-600 px-0.5"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPcDeleteVersion({ id: v.id!, version: v.version });
                                        setPcDeleteVisible(true);
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
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button theme="primary" variant="text" size="small" loading={loadingClassInsight || promptPreviewLoading}
                            onClick={() => withPromptPreview(
                              () => selectedPCId && selectedClassId ? {
                                endpoint: `/api/preset-conversations/${selectedPCId}/insights`,
                                body: { classId: selectedClassId, type: "class" }
                              } : null,
                              () => generatePCInsight("class")
                            )}>
                            {pcClassInsight ? "重新分析" : "生成分析"}
                          </Button>
                        </div>
                      </div>
                      {expandedPcClass && pcClassInsight && (
<div className="px-4 pb-4">
                                          <InsightContent content={pcClassInsight.content} />
                                        </div>
                      )}
                      {expandedPcClass && !pcClassInsight && (
                        <p className="text-gray-400 text-sm px-4 pb-4">点击「生成分析」开始分析</p>
                      )}
                    </div>

                    {/* 学生分析列表 */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-sm">
                          学生分析（{pcStudentInsights.length}/{pcStudents.filter((s) => s.convCount > 0).length} 人已分析）
                        </h4>
                        <div className="flex items-center gap-2">
                          <StarSortButton sortDesc={starSortDesc} onChange={setStarSortDesc} />
                          <Button
                            theme="warning"
                            variant="outline"
                            size="small"
                            loading={batchAnalyzing || promptPreviewLoading}
                            onClick={() => {
                              const studentsWithConv = pcStudents.filter((s) => s.convCount > 0);
                              if (studentsWithConv.length === 0) {
                                MessagePlugin.warning("没有可分析的学生（无对话记录）");
                                return;
                              }
                              const firstStudent = studentsWithConv[0];
                              withPromptPreview(
                                () => selectedPCId && selectedClassId ? {
                                  endpoint: `/api/preset-conversations/${selectedPCId}/insights`,
                                  body: { classId: selectedClassId, type: "student", studentId: firstStudent.id }
                                } : null,
                                () => batchAnalyzeAllStudents()
                              );
                            }}
                            disabled={pcStudents.filter((s) => s.convCount > 0).length === 0}
                          >
                            {batchAnalyzing ? "分析中..." : "一键分析全部"}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {sortStudents(pcStudents, pcStudentInsights, starSortDesc).map((student) => {
                          const ins = pcStudentInsights.find((i) => i.userId === student.id);
                          const isExpanded = expandedStudentId === student.id;
                          const isAnalyzing = loadingStudentId === student.id;
                          const hasConv = student.convCount > 0;
                          return (
                            <div key={student.id} className={`border rounded-lg overflow-hidden ${!hasConv ? "opacity-50" : ""}`}>
                              <div className="flex items-center justify-between px-4 py-3 bg-[#F7F8FA] cursor-pointer"
                                onClick={() => hasConv && setExpandedStudentId(isExpanded ? null : student.id)}>
                                <div className="flex items-center gap-2">
                                  {ins && <StarRating count={ins.starCount || 0} />}
                                  <div className="w-7 h-7 rounded-full bg-[#0052D9]/10 flex items-center justify-center">
                                    <span className="text-[#0052D9] text-xs font-medium">{student.name.charAt(0)}</span>
                                  </div>
                                  <span className="text-sm font-medium">{student.name}</span>
                                  {ins && <Tag theme="success" variant="light" size="small">V{ins.version}</Tag>}
                                  {ins && <span className="text-xs text-[#63666F]">{formatDate(ins.createdAt)}</span>}
                                  {!hasConv && <Tag theme="default" variant="outline" size="small">无对话</Tag>}
                                  {hasConv && !ins && !requireStarRating && <span className="text-xs text-[#BBBBBB]">未评分</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  {hasConv && (
                                    <>
                                      <Button theme="primary" variant="text" size="small" loading={isAnalyzing}
                                        onClick={(e) => { e.stopPropagation(); withPromptPreview(
                                          () => selectedPCId && selectedClassId ? {
                                            endpoint: `/api/preset-conversations/${selectedPCId}/insights`,
                                            body: { classId: selectedClassId, type: "student", studentId: student.id }
                                          } : null,
                                          () => generatePCInsight("student", student.id)
                                        ); }}>
                                        {ins ? "重新分析" : "AI 分析"}
                                      </Button>
                                      {ins && <span className="text-[#63666F] text-xs cursor-pointer">{isExpanded ? "收起" : "展开"}</span>}
                                    </>
                                  )}
                                </div>
                              </div>
{isExpanded && ins && !requireStarRating && (
                                          <div className="px-4 py-3">
                                            <InsightContent content={ins.content} />
                                          </div>
                                        )}
                            </div>
                          );
                        })}
                        {pcStudents.length === 0 && (
                          <p className="text-gray-400 text-sm text-center py-4">班级暂无学生</p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-8">请选择一个对话活动</p>
                )}
              </div>
            )}

            {/* ===== 学习活动层级 ===== */}
            {/* ===== 课堂层级 ===== */}
            {viewLevel === "task" && selectedClassId && currentClass && (
              <div className="space-y-4">
                {/* 课堂级班级分析 */}
                <Card>
                  <div className="flex items-center justify-between cursor-pointer select-none hover:bg-[#F7F8FA] -mx-4 -mt-4 px-4 pt-4 pb-3 transition-colors rounded-t-lg"
                    onClick={() => setExpandedTaskClass(!expandedTaskClass)}>
                    <div className="flex items-center gap-2">
                      <span className={`text-[#63666F] text-xs transition-transform ${expandedTaskClass ? 'rotate-90' : ''}`}>▶</span>
                      <div>
                        <h3 className="font-medium text-[#1A1A1A] text-sm">{taskClassInsight ? task.title : "课堂级学情洞察"}</h3>
                        <p className="text-xs text-[#63666F] mt-0.5">
                          {taskClassInsight
                            ? `第 ${taskClassInsight.version} 版 · ${formatDate(taskClassInsight.createdAt)}`
                            : `数据来源：${insightDataSource === "TASK_INSIGHTS" ? "各学习活动分析结果" : "原始对话记录"}`}
                        </p>
                      </div>
                      {taskClassInsightVersions.length > 1 && (
                        <div className="flex items-center ml-3 gap-2">
                          <span className="text-xs text-gray-400">版本：</span>
                          {taskClassInsightVersions.map((v, i) => (
                            <div key={i} className="flex items-center gap-3">
                              <button
                                className={`px-2 py-0.5 text-xs rounded ${i === taskClassVersionIndex ? 'bg-[#0052D9] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTaskClassVersionIndex(i);
                                  setTaskClassInsight(v);
                                }}
                              >
                                v{v.version}
                              </button>
                              {v.id && (
                                <button
                                  className="text-xs text-red-400 hover:text-red-600 px-0.5"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTaskDeleteVersion({ id: v.id!, version: v.version });
                                    setTaskDeleteVisible(true);
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
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {showComparison.task && previousInsights.task_class && (
                        <Button theme="warning" variant="outline" size="small"
                          onClick={() => setShowComparison((p) => ({ ...p, task: false }))}>
                          隐藏对比
                        </Button>
                      )}
                      <Button theme="primary" size="small" loading={loadingClassInsight || promptPreviewLoading}
                        icon={!loadingClassInsight ? <ChartBarIcon /> : undefined}
                        onClick={() => withPromptPreview(
                          () => taskId && selectedClassId ? {
                            endpoint: `/api/tasks/${taskId}/insights`,
                            body: { classId: selectedClassId, type: "class" }
                          } : null,
                          () => checkAndGenerateClassInsight()
                        )}>
                        {taskClassInsight ? "重新分析" : "生成洞察"}
                      </Button>
                    </div>
                  </div>
                  {expandedTaskClass && (
                    <>
<div className="bg-[#F7F8FA] p-5 rounded-lg text-sm leading-relaxed min-h-[120px] prose prose-sm prose-gray max-w-none break-words [&_pre]:overflow-x-auto [&_code]:break-all">
                                          {taskClassInsight ? (
                                            <InsightContent content={taskClassInsight.content} />
                                          ) : (
                          <span className="text-gray-400">点击「生成洞察」按钮，AI 将基于{insightDataSource === "TASK_INSIGHTS" ? "各学习活动分析结果" : "原始对话记录"}生成学情报告...</span>
                        )}
                      </div>
                      {showComparison.task && previousInsights.task_class && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium text-[#ED7B2F] mb-2">上一次分析结果：</h4>
<div className="bg-[#FFF8F0] p-5 rounded-lg text-sm leading-relaxed max-h-[400px] overflow-y-auto border border-[#ED7B2F]/20">
                                              <InsightContent content={previousInsights.task_class} />
                                            </div>
                        </div>
                      )}
                    </>
                  )}
                </Card>

                {/* 课堂级学生分析 */}
                <Card>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-medium text-[#1A1A1A]">
                      学生分析（{taskStudentInsights.length}/{currentClass.students.filter((s) => s.convCount > 0).length} 人已分析）
                    </h3>
                    <div className="flex items-center gap-2">
                      <StarSortButton sortDesc={starSortDesc} onChange={setStarSortDesc} />
                      <Button
                        theme="warning"
                        variant="outline"
                        size="small"
                        loading={batchAnalyzing || promptPreviewLoading}
                        onClick={() => {
                          const studentsWithConv = currentClass.students.filter((s) => s.convCount > 0);
                          if (studentsWithConv.length === 0) {
                            MessagePlugin.warning("没有可分析的学生（无对话记录）");
                            return;
                          }
                          const firstStudent = studentsWithConv[0];
                          withPromptPreview(
                            () => taskId && selectedClassId ? {
                              endpoint: `/api/tasks/${taskId}/insights`,
                              body: { classId: selectedClassId, type: "student", studentId: firstStudent.id }
                            } : null,
                            () => batchAnalyzeAllStudents()
                          );
                        }}
                        disabled={currentClass.students.filter((s) => s.convCount > 0).length === 0}
                      >
                        {batchAnalyzing ? "分析中..." : "一键分析全部"}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {sortStudents(currentClass.students, taskStudentInsights, starSortDesc).map((student) => {
                      const ins = taskStudentInsights.find((i) => i.userId === student.id);
                      const isExpanded = expandedStudentId === student.id;
                      const isLoading = loadingStudentId === student.id;
                      const hasConv = student.convCount > 0;
                      return (
                        <div key={student.id} className={`border rounded-lg overflow-hidden ${!hasConv ? "opacity-50" : ""}`}>
                          <div className="flex items-center justify-between px-4 py-3 bg-[#F7F8FA] cursor-pointer"
                            onClick={() => hasConv && setExpandedStudentId(isExpanded ? null : student.id)}>
                            <div className="flex items-center gap-2">
                              {ins && <StarRating count={ins.starCount || 0} />}
                              <div className="w-7 h-7 rounded-full bg-[#0052D9]/10 flex items-center justify-center">
                                <span className="text-[#0052D9] text-xs font-medium">{student.name.charAt(0)}</span>
                              </div>
                              <span className="text-sm font-medium">{student.name}</span>
                              {ins && <Tag theme="success" variant="light" size="small">V{ins.version}</Tag>}
                              {!hasConv && <Tag theme="default" variant="outline" size="small">无对话</Tag>}
                              {hasConv && !ins && !requireStarRating && <span className="text-xs text-[#BBBBBB]">未评分</span>}
                              {hasConv && <span className="text-xs text-[#63666F]">{formatLastActive(student.lastActiveAt)}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {hasConv && (
                                <>
                                  <Button theme="primary" variant="text" size="small" loading={isLoading}
                                    onClick={(e) => { e.stopPropagation(); withPromptPreview(
                                      () => taskId && selectedClassId ? {
                                        endpoint: `/api/tasks/${taskId}/insights`,
                                        body: { classId: selectedClassId, type: "student", studentId: student.id }
                                      } : null,
                                      () => generateStudentInsight(student.id)
                                    ); }}>
                                    {ins ? "重新分析" : "AI 分析"}
                                  </Button>
                                  {ins && <span className="text-[#63666F] text-xs cursor-pointer">{isExpanded ? "收起" : "展开"}</span>}
                                </>
                              )}
                            </div>
                          </div>
{isExpanded && ins && !requireStarRating && (
                                          <div className="px-4 py-3">
                                            <InsightContent content={ins.content} />
                                          </div>
                                        )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* 提示词模板编辑对话框 */}
      <Dialog
        header={`${promptDialogType === "task" ? "课堂" : "对话活动"}提示词模板`}
        visible={promptDialogVisible}
        onClose={() => setPromptDialogVisible(false)}
        footer={null}
        width={700}
      >
        <div className="space-y-4">
          <p className="text-sm text-[#63666F]">
            当前编辑：<strong>{promptDialogTitle}</strong>
          </p>
          <p className="text-xs text-[#63666F] bg-[#F7F8FA] rounded-lg p-3">
            提示词模板将用于 AI 分析时的 Prompt 构建。可使用变量如 {"${学生人数}"}{"，"}{"${对话内容}"} 等。
          </p>
          <Textarea
            value={promptDialogValue}
            onChange={(v) => setPromptDialogValue(v)}
            placeholder="输入自定义提示词模板（可选），留空则使用默认模板"
            rows={10}
          />
          <div className="flex gap-2 justify-end">
            <Button onClick={() => setPromptDialogVisible(false)}>取消</Button>
            <Button theme="default" loading={promptDialogGenerating} onClick={generatePromptByAI}>
              AI 自动生成
            </Button>
            <Button theme="primary" loading={promptDialogSaving} onClick={savePromptTemplate}>
              保存模板
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 提示词预览确认对话框 */}
      <PromptPreviewDialog
        loading={promptPreviewLoading}
        content={promptPreviewContent}
        visible={promptPreviewVisible}
        onVisibleChange={setPromptPreviewVisible}
        onConfirm={async () => {
          setPromptPreviewVisible(false);
          await pendingPreviewAction?.();
        }}
        renderContent={(content) => (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 bg-[#F0F5FF] rounded-lg">
              <InfoCircleIcon className="text-[#0052D9] mt-0.5 shrink-0" />
              <p className="text-sm text-[#1A1A1A]">
                以下是将一次性发送给 AI 模型的完整消息。确认无误后点击「同意并发送」。
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-[#E8F0FE] text-[#0052D9] text-xs font-medium rounded">user</span>
                <span className="text-xs text-[#63666F]">
                  包含分析指令 + 嵌入的对话数据或下级分析结果
                </span>
              </div>
              <div className="bg-[#1E1E1E] text-[#D4D4D4] rounded-lg p-4 font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto whitespace-pre-wrap break-all">
                {content}
              </div>
            </div>
          </div>
        )}
      />

      {/* 下级报告缺失确认对话框 */}
      <Dialog
        header="下级分析报告不完整"
        visible={missingDialogVisible}
        onClose={() => setMissingDialogVisible(false)}
        footer={null}
        width={600}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 bg-[#FFF3E0] rounded-lg">
            <InfoCircleIcon className="text-[#ED7B2F] mt-0.5 shrink-0" />
            <p className="text-sm text-[#1A1A1A]">
              以下分析报告尚未生成，将只基于已有报告进行分析：
            </p>
          </div>

          {/* 对话活动缺失项 */}
          {missingItems.presetConversations && missingItems.presetConversations.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-[#1A1A1A] mb-2">对话活动分析缺失：</h4>
              <div className="space-y-2">
                {missingItems.presetConversations.map((pc) => (
                  <div key={pc.id} className="p-3 bg-[#F7F8FA] rounded-lg text-sm">
                    <p className="font-medium">{pc.title}</p>
                    {pc.missingClass && <p className="text-[#ED7B2F] text-xs mt-1">• 班级分析未生成</p>}
                    {pc.missingStudents.length > 0 && (
                      <p className="text-[#ED7B2F] text-xs mt-1">• 学生分析未生成：{pc.missingStudents.join("、")}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button onClick={() => setMissingDialogVisible(false)}>取消</Button>
            <Button
              theme="primary"
              onClick={() => {
                setMissingDialogVisible(false);
                pendingGenerate?.();
              }}
            >
              忽略缺失，继续分析
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 删除版本确认 */}
      <Dialog
        header="删除分析版本"
        visible={pcDeleteVisible}
        onClose={() => { setPcDeleteVisible(false); setPcDeleteVersion(null); }}
        footer={null}
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            确定要删除 <strong>v{pcDeleteVersion?.version}</strong> 版分析吗？
          </p>
          <p className="text-sm text-red-600">此操作不可撤销！</p>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => { setPcDeleteVisible(false); setPcDeleteVersion(null); }}>取消</Button>
            <Button theme="danger" loading={pcDeleting} onClick={async () => {
              if (!pcDeleteVersion) return;
              setPcDeleting(true);
              try {
                const token = localStorage.getItem("token");
                const res = await fetch(`/api/insights/${pcDeleteVersion.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) {
                  MessagePlugin.success("版本已删除");
                  setPcClassInsightVersions((prev) => prev.filter((v) => v.id !== pcDeleteVersion.id));
                  // 如果删的是当前显示的版本，切换到第一个
                  setPcClassInsightVersions((prev) => {
                    if (prev.length > 0) {
                      const newIdx = Math.min(pcClassVersionIndex, prev.length - 1);
                      setPcClassVersionIndex(newIdx);
                      setPcClassInsight(prev[newIdx]);
                    } else {
                      setPcClassInsight(null);
                      setPcClassVersionIndex(0);
                    }
                    return prev;
                  });
                } else {
                  MessagePlugin.error("删除失败");
                }
              } catch { MessagePlugin.error("网络错误"); }
              finally {
                setPcDeleting(false);
                setPcDeleteVisible(false);
                setPcDeleteVersion(null);
              }
            }}>
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 任务级删除版本确认 */}
      <Dialog
        header="删除分析版本"
        visible={taskDeleteVisible}
        onClose={() => { setTaskDeleteVisible(false); setTaskDeleteVersion(null); }}
        footer={null}
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            确定要删除 <strong>v{taskDeleteVersion?.version}</strong> 版分析吗？
          </p>
          <p className="text-sm text-red-600">此操作不可撤销！</p>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => { setTaskDeleteVisible(false); setTaskDeleteVersion(null); }}>取消</Button>
            <Button theme="danger" loading={taskDeleting} onClick={async () => {
              if (!taskDeleteVersion) return;
              setTaskDeleting(true);
              try {
                const token = localStorage.getItem("token");
                const res = await fetch(`/api/insights/${taskDeleteVersion.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) {
                  MessagePlugin.success("版本已删除");
                  setTaskClassInsightVersions((prev) => {
                    const updated = prev.filter((v) => v.id !== taskDeleteVersion.id);
                    if (updated.length > 0) {
                      const newIdx = Math.min(taskClassVersionIndex, updated.length - 1);
                      setTaskClassVersionIndex(newIdx);
                      setTaskClassInsight(updated[newIdx]);
                    } else {
                      setTaskClassInsight(null);
                      setTaskClassVersionIndex(0);
                    }
                    return updated;
                  });
                } else {
                  MessagePlugin.error("删除失败");
                }
              } catch { MessagePlugin.error("网络错误"); }
              finally {
                setTaskDeleting(false);
                setTaskDeleteVisible(false);
                setTaskDeleteVersion(null);
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
