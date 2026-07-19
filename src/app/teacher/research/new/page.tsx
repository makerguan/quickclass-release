"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Input,
  Checkbox,
  Textarea,
  Loading,
  MessagePlugin,
  Steps,
  Tag,
} from "tdesign-react";
import TeacherLayout from "@/components/layout/TeacherLayout";
import Link from "next/link";
import {
  PAPER_STYLES,
  RESEARCH_METHODS,
  getPaperStyleLabel,
  getPaperStyleColor,
  getPaperStyleBg,
  getResearchMethodLabel,
  getResearchMethodColor,
  getResearchMethodBg,
} from "@/lib/research/constants";

interface ResearchProject {
  id: string;
  projectName: string;
  projectType: "PAPER" | "PROPOSAL";
  status: "DRAFT" | "TITLES_READY" | "COMPLETED";
}

interface LearningTask {
  id: string;
  title: string;
  status: string;
}

const DATA_TYPES = [
  {
    value: "quiz",
    label: "作业数据",
    description: "所有学生的作业答题原始数据",
    icon: "📝",
  },
  {
    value: "conversation",
    label: "对话数据",
    description: "所有学生与 AI 的对话原始内容",
    icon: "💬",
  },
  {
    value: "quizReport",
    label: "作业报告",
    description: "班级作业 AI 分析报告（含统计信息）",
    icon: "📊",
    requiresGeneration: true, // 需先到课堂→作业→报告生成
    linkHint: "在「课堂管理」点击具体课堂的「课堂作业 → 报告」可生成",
  },
  {
    value: "conversationReport",
    label: "对话报告",
    description: "班级对话活动 AI 分析报告",
    icon: "📑",
    requiresGeneration: true,
    linkHint: "在「课堂管理」点击具体对话活动的「生成分析」可生成",
  },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [projectType, setProjectType] = useState<"PAPER" | "PROPOSAL">("PAPER");
  const [keywords, setKeywords] = useState("");

  // 新增状态：课堂选择 + 数据类型选择
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedDataTypes, setSelectedDataTypes] = useState<string[]>(["quiz", "conversation"]);

  // 其他
  const [loading, setLoading] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [generatedTitles, setGeneratedTitles] = useState<any[]>([]);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [missingReports, setMissingReports] = useState<{
    quizzesWithoutReport?: string[];
    conversationsWithoutReport?: string[];
  }>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // 加载教师的所有课堂
  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoadingTasks(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/tasks", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // 只显示启用状态的课堂
        const enabled = data.filter((t: LearningTask) => t.status === "ENABLED");
        setTasks(enabled);
        // 默认全选
        setSelectedTaskIds(enabled.map((t: LearningTask) => t.id));
      }
    } catch (e) {
      MessagePlugin.error("加载课堂列表失败");
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleTaskToggle = (taskId: string, checked: boolean) => {
    if (checked) {
      setSelectedTaskIds((prev) => [...prev, taskId]);
    } else {
      setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
    }
  };

  const handleDataTypeToggle = (type: string, checked: boolean) => {
    if (checked) {
      setSelectedDataTypes((prev) => [...prev, type]);
    } else {
      setSelectedDataTypes((prev) => prev.filter((t) => t !== type));
    }
  };

  const handleCreate = async () => {
    if (!projectName.trim()) {
      MessagePlugin.warning("请填写项目名称");
      return;
    }
    if (selectedTaskIds.length === 0) {
      MessagePlugin.warning("请至少选择一个课堂");
      return;
    }
    if (selectedDataTypes.length === 0) {
      MessagePlugin.warning("请至少选择一类数据");
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/research/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectName: projectName.trim(),
          projectType,
          keywords: keywords.trim(),
          selectedTaskIds,
          dataTypes: selectedDataTypes,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreatedProjectId(data.id);
        setGeneratedTitles(data.generatedTitles || []);
        setDataWarnings(data.dataWarnings || []);
        setMissingReports(data.missingReports || {});
        setStep(1);
        MessagePlugin.success(`已生成 ${data.generatedTitles?.length || 0} 个研究题目`);
      } else {
        MessagePlugin.error(data.error || "创建失败");
      }
    } catch (e) {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (selectedIndex === null || !createdProjectId) {
      MessagePlugin.warning("请选择一个研究题目");
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/research/projects/${createdProjectId}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ selectedIndex }),
      });
      if (res.ok) {
        // 等待流式响应完全读取完毕，确保后端 saveDocument 已执行
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        }
        router.push(`/teacher/research/${createdProjectId}`);
      } else {
        MessagePlugin.error("生成失败");
      }
    } catch (e) {
      MessagePlugin.error("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const typeLabel = (type: string) => (type === "PAPER" ? "论文" : "课题");
  const typeDesc = (type: string) =>
    type === "PAPER"
      ? "学术规范，8000-10000字，含摘要、引言、方法、结果、讨论、结论、参考文献"
      : "实践导向，8000-9000中文字，按课题评审活页格式（8个章节）";

  return (
    <TeacherLayout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <Link href="/teacher/research" className="text-sm text-gray-500 hover:text-[#0052D9]">
            ← 返回项目列表
          </Link>
          <h1 className="text-2xl font-bold mt-2">新建研究项目</h1>
          <p className="text-sm text-gray-500 mt-1">
            从真实课堂数据中提取研究素材，AI 辅助生成课题方案和论文初稿
          </p>
        </div>

        <Steps
          current={step}
          options={[
            { title: "选择数据来源", content: "选课堂 + 数据类型" },
            { title: "选择研究题目", content: "从推荐题目中挑选" },
          ]}
        />

        {step === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mt-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                项目名称 <span className="text-red-500">*</span>
              </label>
              <Input
                value={projectName}
                onChange={(v) => setProjectName(v)}
                placeholder="例如：基于对话分析的深度学习研究"
                size="large"
              />
            </div>

            {/* ① 选择课堂 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ① 选择课堂（可多选）<span className="text-red-500">*</span>
              </label>
              {loadingTasks ? (
                <div className="text-center py-4"><Loading /></div>
              ) : tasks.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-700">
                  暂无可用的课堂。请先在「课堂管理」创建并启用课堂。
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
                  {tasks.map((task) => (
                    <label
                      key={task.id}
                      className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedTaskIds.includes(task.id)}
                        onChange={(v) => handleTaskToggle(task.id, !!v)}
                      />
                      <span className="text-sm flex-1">{task.title}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">
                已选 {selectedTaskIds.length} / {tasks.length} 个课堂
              </p>
            </div>

            {/* ② 选择数据类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ② 选择数据类型（可多选）<span className="text-red-500">*</span>
              </label>
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                {DATA_TYPES.map((dt) => {
                  const isChecked = selectedDataTypes.includes(dt.value);
                  return (
                    <div key={dt.value} className="space-y-1">
                      <label className="flex items-start gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <Checkbox
                          checked={isChecked}
                          onChange={(v) => handleDataTypeToggle(dt.value, !!v)}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span>{dt.icon}</span>
                            <span className="text-sm font-medium">{dt.label}</span>
                            {isChecked && dt.requiresGeneration && (
                              <Tag theme="warning" variant="light" size="small">
                                需先生成
                              </Tag>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-1 ml-6">
                            {dt.description}
                          </p>
                        </div>
                      </label>
                      {/* 报告类数据勾选时的提示 */}
                      {isChecked && dt.requiresGeneration && (
                        <div className="ml-8 bg-amber-50 border-l-4 border-amber-400 p-2 rounded text-xs">
                          <div className="text-amber-800">
                            ⚠️ {dt.label}需要先生成才能使用
                          </div>
                          <div className="text-amber-700 mt-0.5">
                            💡 {dt.linkHint}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                已选 {selectedDataTypes.length} / {DATA_TYPES.length} 类数据
              </p>
            </div>

            {/* 生成类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                生成类型 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(["PAPER", "PROPOSAL"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setProjectType(type)}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      projectType === type
                        ? "border-[#0052D9] bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-2xl mb-2">{type === "PAPER" ? "📄" : "📋"}</div>
                    <div className="font-medium text-lg">
                      {type === "PAPER" ? "论文" : "课题方案"}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{typeDesc(type)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 关键字 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                关键字 <span className="text-gray-400 text-xs">（可选）</span>
              </label>
              <Input
                value={keywords}
                onChange={(v) => setKeywords(v)}
                placeholder="例如：探究深度 学习效果 互动（用空格分隔）"
              />
              <p className="text-xs text-gray-400 mt-1">
                AI 会根据关键字生成更相关的题目，留空则自由发挥
              </p>
            </div>

            {/* 警告 */}
            {dataWarnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3">
                {dataWarnings.map((w, i) => (
                  <div key={i} className="text-sm text-amber-700">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}

            {/* 缺失报告的具体清单 */}
            {((missingReports.quizzesWithoutReport?.length ?? 0) > 0 ||
              (missingReports.conversationsWithoutReport?.length ?? 0) > 0) && (
              <div className="bg-orange-50 border border-orange-200 rounded p-3 space-y-2">
                <div className="text-sm font-medium text-orange-800">
                  📋 以下作业/对话活动尚未生成 AI 报告：
                </div>
                {missingReports.quizzesWithoutReport && missingReports.quizzesWithoutReport.length > 0 && (
                  <div className="text-xs text-orange-700">
                    <div className="font-medium mt-1">作业：</div>
                    <ul className="ml-4">
                      {missingReports.quizzesWithoutReport.map((t, i) => (
                        <li key={i}>• {t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {missingReports.conversationsWithoutReport &&
                  missingReports.conversationsWithoutReport.length > 0 && (
                    <div className="text-xs text-orange-700">
                      <div className="font-medium mt-1">对话活动：</div>
                      <ul className="ml-4">
                        {missingReports.conversationsWithoutReport.map((t, i) => (
                          <li key={i}>• {t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <Link href="/teacher/research">
                <Button>取消</Button>
              </Link>
              <Button
                theme="primary"
                loading={loading}
                onClick={handleCreate}
                disabled={
                  !projectName.trim() ||
                  selectedTaskIds.length === 0 ||
                  selectedDataTypes.length === 0
                }
              >
                生成研究题目
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mt-6">
            <h2 className="font-semibold text-lg mb-4">
              💡 已生成 {generatedTitles.length} 个研究题目，请选择 1 个
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              数据来源：{selectedTaskIds.length} 个课堂 · {selectedDataTypes.length} 类数据
              {projectType === "PAPER" && generatedTitles.some((t: any) => t.paperStyle) && (
                <span className="ml-2 text-[#0052D9]">
                  · 分布：🔬 实践研究 {generatedTitles.filter((t: any) => t.paperStyle === "PRACTICE_RESEARCH").length} 个 +
                  📖 案例分析 {generatedTitles.filter((t: any) => t.paperStyle === "CASE_ANALYSIS").length} 个
                </span>
              )}
              {projectType === "PROPOSAL" && generatedTitles.some((t: any) => t.researchMethod) && (
                <span className="ml-2 text-[#0052D9]">
                  · 方法覆盖：{[...new Set(generatedTitles.map((t: any) => t.researchMethod).filter(Boolean))].length} 种研究方法
                </span>
              )}
            </p>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {generatedTitles.map((t, i) => (
                <label
                  key={i}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedIndex === i ? "border-[#0052D9] bg-blue-50" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="title"
                    checked={selectedIndex === i}
                    onChange={() => setSelectedIndex(i)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[#1A1A1A]">{t.title}</span>
                      <Tag theme="primary" variant="light" size="small">⭐ {t.score}</Tag>
                      <Tag variant="light" size="small">{t.category}</Tag>
                      {/* 论文类型标签（仅 PAPER） */}
                      {t.paperStyle && (
                        <Tag
                          size="small"
                          style={{
                            backgroundColor: getPaperStyleBg(t.paperStyle),
                            color: getPaperStyleColor(t.paperStyle),
                            border: 'none',
                          }}
                        >
                          {PAPER_STYLES.find(p => p.value === t.paperStyle)?.icon} {getPaperStyleLabel(t.paperStyle)}
                        </Tag>
                      )}
                      {/* 研究方法标签（仅 PROPOSAL） */}
                      {t.researchMethod && (
                        <Tag
                          size="small"
                          style={{
                            backgroundColor: getResearchMethodBg(t.researchMethod),
                            color: getResearchMethodColor(t.researchMethod),
                            border: 'none',
                          }}
                        >
                          {RESEARCH_METHODS.find(m => m.value === t.researchMethod)?.icon} {getResearchMethodLabel(t.researchMethod)}
                        </Tag>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{t.description}</p>
                    {t.evidence?.length > 0 && (
                      <p className="text-xs text-gray-400 mt-2">
                        📊 {t.evidence.join("；")}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <Button theme="default" variant="outline" onClick={() => setStep(0)}>
                上一步
              </Button>
              <Button
                theme="primary"
                loading={loading}
                onClick={handleGenerate}
                disabled={selectedIndex === null}
              >
                生成{typeLabel(projectType)}初稿
              </Button>
            </div>
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}