"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Tag,
  Loading,
  MessagePlugin,
  Dialog,
  Textarea,
} from "tdesign-react";
import {
  DownloadIcon,
  CopyIcon,
  RefreshIcon,
  ChevronLeftIcon,
  FileWordIcon,
  CheckCircleIcon,
  ErrorCircleIcon,
} from "tdesign-icons-react";
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

interface ReferenceAuditItem {
  index: number;
  raw: string;
  status: "VERIFIED" | "OFFICIAL" | "REMOVED_DUPLICATE" | "REMOVED";
  reason?: string;
  matchedDoi?: string;
  matchedTitle?: string;
  source?: string;
  confidence?: number;
  citationStatus?: "VERIFIED" | "SUSPICIOUS" | "UNVERIFIED";
  citationReason?: string;
  citationContext?: string;
}

interface ReferencesAuditReport {
  total: number;
  verified: number;
  official: number;
  duplicates: number;
  removed: number;
  items: ReferenceAuditItem[];
  checkedAt: string;
  citationValidation?: {
    total: number;
    verified: number;
    suspicious: number;
    unverified: number;
    checkedAt: string;
  };
}

interface ResearchProject {
  id: string;
  projectName: string;
  projectType: "PAPER" | "PROPOSAL";
  status: "DRAFT" | "TITLES_READY" | "COMPLETED";
  keywords: string | null;
  selectedTitle: string | null;
  selectedIndex: number | null;
  generatedTitles: any[];
  content: string | null;
  contentText: string | null;
  dataSnapshot: any;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [project, setProject] = useState<ResearchProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [streamedText, setStreamedText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [auditReport, setAuditReport] = useState<ReferencesAuditReport | null>(null);
  const [showAuditDialog, setShowAuditDialog] = useState(false);
  const [reverifying, setReverifying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadProject = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/research/projects/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        if (data.selectedIndex !== null) setSelectedIndex(data.selectedIndex);
        if (data.contentText) setStreamedText(data.contentText);
        // 解析核查审计报告
        if (data.content) {
          try {
            const c = JSON.parse(data.content);
            if (c.referencesAudit) setAuditReport(c.referencesAudit);
          } catch {}
        }
      } else {
        MessagePlugin.error("项目不存在");
        router.push("/teacher/research");
      }
    } catch (e) {
      MessagePlugin.error("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProject();
  }, [params.id]);

  const handleGenerate = async () => {
    if (selectedIndex === null || !project) return;
    setGenerating(true);
    setProgress(0);
    setStreamedText("");
    abortRef.current = new AbortController();

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `/api/research/projects/${project.id}/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ selectedIndex }),
          signal: abortRef.current.signal,
        }
      );

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          text += chunk;
          setStreamedText(text);
          const target = project.projectType === "PAPER" ? 8000 : 14000; // 方案按 8500 中文字 × 1.65（标点英文）粗算
          setProgress(Math.min(95, Math.round((text.length / target) * 100)));
        }
      }
      setProgress(100);
      MessagePlugin.success("生成完成");
      await loadProject();
    } catch (e: any) {
      if (e.name !== "AbortError") MessagePlugin.error("生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!project) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `/api/research/projects/${project.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        // 优先从 content JSON 中取论文标题/课题名称
        let docTitle = project.projectName;
        if (project.content) {
          try {
            const c = JSON.parse(project.content);
            if (c.title) docTitle = c.title;
          } catch {}
        }
        if (!docTitle) docTitle = project.selectedTitle || project.projectName;
        a.download = `${docTitle}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        MessagePlugin.error("下载失败");
      }
    } catch (e) {
      MessagePlugin.error("下载失败");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(streamedText || project?.contentText || "");
    MessagePlugin.success("已复制到剪贴板");
  };

  const handleReverify = async () => {
    if (!project) return;
    setReverifying(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `/api/research/projects/${project.id}/reverify-references`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json();
      if (res.ok) {
        MessagePlugin.success(
          `核查完成：保留 ${data.report.verified + data.report.official} 篇，删除 ${data.report.removed} 篇（重复 ${data.report.duplicates}）`
        );
        await loadProject();
      } else {
        MessagePlugin.error(data.error || "核查失败");
      }
    } catch (e) {
      MessagePlugin.error("核查失败");
    } finally {
      setReverifying(false);
    }
  };

  const typeLabel = (type: string) => (type === "PAPER" ? "论文" : "课题");

  if (loading || !project) {
    return (
      <TeacherLayout>
        <div className="p-6">
          <Loading />
        </div>
      </TeacherLayout>
    );
  }

  const isCompleted = project.status === "COMPLETED";
  const generatedTitles = project.generatedTitles || [];
  const selectedTitle = project.selectedIndex !== null ? generatedTitles[project.selectedIndex] : null;

  return (
    <TeacherLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href="/teacher/research"
            className="text-sm text-gray-500 hover:text-[#0052D9]"
          >
            ← 返回项目列表
          </Link>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <h1 className="text-2xl font-bold">{project.projectName}</h1>
            <Tag theme={project.projectType === "PAPER" ? "primary" : "success"}>
              {typeLabel(project.projectType)}
            </Tag>
            {selectedTitle && (
              <>
                {selectedTitle.paperStyle && (
                  <Tag
                    size="medium"
                    style={{
                      backgroundColor: getPaperStyleBg(selectedTitle.paperStyle),
                      color: getPaperStyleColor(selectedTitle.paperStyle),
                      border: 'none',
                    }}
                  >
                    {PAPER_STYLES.find(p => p.value === selectedTitle.paperStyle)?.icon} {getPaperStyleLabel(selectedTitle.paperStyle)}
                  </Tag>
                )}
                {selectedTitle.researchMethod && (
                  <Tag
                    size="medium"
                    style={{
                      backgroundColor: getResearchMethodBg(selectedTitle.researchMethod),
                      color: getResearchMethodColor(selectedTitle.researchMethod),
                      border: 'none',
                    }}
                  >
                    {RESEARCH_METHODS.find(m => m.value === selectedTitle.researchMethod)?.icon} {getResearchMethodLabel(selectedTitle.researchMethod)}
                  </Tag>
                )}
              </>
            )}
            {project.keywords && (
              <span className="text-sm text-gray-500">
                关键字：{project.keywords}
              </span>
            )}
          </div>
        </div>

        {/* 第一步：选择题目 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#0052D9] text-white text-sm flex items-center justify-center">
              1
            </span>
            选择研究题目
          </h2>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
            {generatedTitles.map((t, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedIndex === i
                    ? "border-[#0052D9] bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="radio"
                  name="title"
                  checked={selectedIndex === i}
                  onChange={() => setSelectedIndex(i)}
                  className="mt-1"
                  disabled={generating}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{t.title}</span>
                    <Tag theme="primary" variant="light" size="small">
                      ⭐ {t.score}
                    </Tag>
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

          {!isCompleted && (
            <div className="mt-4 flex justify-end">
              <Button
                theme="primary"
                loading={generating}
                onClick={handleGenerate}
                disabled={selectedIndex === null}
              >
                {generating ? `生成中 ${progress}%` : `生成${typeLabel(project.projectType)}初稿`}
              </Button>
            </div>
          )}
        </div>

        {/* 第二步：生成结果 */}
        {(generating || isCompleted) && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#00A870] text-white text-sm flex items-center justify-center">
                2
              </span>
              初稿预览
              {generating && <Loading size="small" />}
            </h2>

            {generating && (
              <div className="mb-4">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#0052D9] transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1 text-right">
                  {progress}%
                </div>
              </div>
            )}

            <div className="bg-gray-50 rounded p-4 max-h-[600px] overflow-y-auto border border-gray-100">
              <pre className="whitespace-pre-wrap text-sm font-sans text-gray-800 leading-relaxed">
                {streamedText || project.contentText || "生成中..."}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
              {isCompleted && !generating && (
                <Button theme="primary" icon={<FileWordIcon />} onClick={handleDownload}>
                  下载 Word
                </Button>
              )}
              <Button variant="outline" icon={<CopyIcon />} onClick={handleCopy}>
                复制 Markdown
              </Button>
              {isCompleted && !generating && (
                <Button
                  variant="outline"
                  icon={<CheckCircleIcon />}
                  loading={reverifying}
                  onClick={handleReverify}
                >
                  重新核查参考文献
                </Button>
              )}
              {isCompleted && !generating && (
                <Button variant="text" icon={<RefreshIcon />} onClick={handleGenerate}>
                  重新生成
                </Button>
              )}
              <Button
                variant="text"
                onClick={() => setShowRaw(true)}
                disabled={!project.contentText && !streamedText}
              >
                查看原始 Markdown
              </Button>
            </div>
          </div>
        )}

        {/* 参考文献核查报告 */}
        {isCompleted && auditReport && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mt-4">
            <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#E37318] text-white text-sm flex items-center justify-center">
                3
              </span>
              参考文献核查
              <span className="text-xs text-gray-400 font-normal">
                （核查时间：{new Date(auditReport.checkedAt).toLocaleString("zh-CN")}）
              </span>
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <div className="text-xs text-gray-500">原始文献</div>
                <div className="text-2xl font-semibold text-gray-700">{auditReport.total}</div>
              </div>
              <div className="rounded-lg border border-green-200 p-3 bg-green-50">
                <div className="text-xs text-green-700">DOI 核实</div>
                <div className="text-2xl font-semibold text-green-700">{auditReport.verified}</div>
              </div>
              <div className="rounded-lg border border-blue-200 p-3 bg-blue-50">
                <div className="text-xs text-blue-700">官方文献</div>
                <div className="text-2xl font-semibold text-blue-700">{auditReport.official}</div>
              </div>
              <div className="rounded-lg border border-orange-200 p-3 bg-orange-50">
                <div className="text-xs text-orange-700">重复合并</div>
                <div className="text-2xl font-semibold text-orange-700">{auditReport.duplicates}</div>
              </div>
              <div className="rounded-lg border border-red-200 p-3 bg-red-50">
                <div className="text-xs text-red-700">查不到已删除</div>
                <div className="text-2xl font-semibold text-red-700">{auditReport.removed}</div>
              </div>
            </div>

            {auditReport.removed > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-3 text-sm text-red-700 flex items-start gap-2">
                <ErrorCircleIcon style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  已按规则删除 {auditReport.removed} 条查不到的参考文献（疑似虚构），
                  并已同步重写正文 [N] 引用编号。如需恢复，请重新生成论文/课题。
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="small"
              onClick={() => setShowAuditDialog(true)}
            >
              查看核查明细
            </Button>
          </div>
        )}
      </div>

      <Dialog
        header="原始 Markdown"
        visible={showRaw}
        onClose={() => setShowRaw(false)}
        width={800}
        footer={
          <Button onClick={() => setShowRaw(false)}>关闭</Button>
        }
      >
        <Textarea
          value={project.contentText || streamedText || ""}
          rows={20}
          readonly
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
      </Dialog>

      <Dialog
        header="参考文献核查明细"
        visible={showAuditDialog}
        onClose={() => setShowAuditDialog(false)}
        width={900}
        footer={
          <Button onClick={() => setShowAuditDialog(false)}>关闭</Button>
        }
      >
        {auditReport && (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {/* 引用合理性审核摘要 */}
            {auditReport.citationValidation && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">引用合理性审核</span>
                  <Tag size="small" theme="primary" variant="light">
                    共 {auditReport.citationValidation.total} 条引用
                  </Tag>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-green-600">合理 {auditReport.citationValidation.verified}</span>
                  <span className="text-orange-600">可疑 {auditReport.citationValidation.suspicious}</span>
                  {auditReport.citationValidation.unverified > 0 && (
                    <span className="text-red-600">不合理 {auditReport.citationValidation.unverified}</span>
                  )}
                </div>
              </div>
            )}

            {auditReport.items.map((item) => {
              const statusMeta = {
                VERIFIED: { label: "已核实", color: "green", icon: <CheckCircleIcon /> },
                OFFICIAL: { label: "官方文件", color: "blue", icon: <CheckCircleIcon /> },
                REMOVED_DUPLICATE: { label: "重复已合并", color: "orange", icon: <ErrorCircleIcon /> },
                REMOVED: { label: "查不到已删除", color: "red", icon: <ErrorCircleIcon /> },
              }[item.status];

              // 引用合理性标签
              let citationMeta: { label: string; color: string } | null = null;
              if (item.citationStatus === "VERIFIED") {
                citationMeta = { label: "引用合理", color: "green" };
              } else if (item.citationStatus === "SUSPICIOUS") {
                citationMeta = { label: "引用可疑", color: "orange" };
              } else if (item.citationStatus === "UNVERIFIED") {
                citationMeta = { label: "引用不合理", color: "red" };
              }

              return (
                <div
                  key={item.index}
                  className={`rounded-lg border p-3 ${
                    item.status === "VERIFIED" || item.status === "OFFICIAL"
                      ? "border-green-200 bg-green-50"
                      : item.status === "REMOVED_DUPLICATE"
                      ? "border-orange-200 bg-orange-50"
                      : "border-red-200 bg-red-50"
                  }`}
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <Tag
                      size="small"
                      theme={statusMeta.color as any}
                      variant="light"
                    >
                      [{item.index}] {statusMeta.label}
                    </Tag>
                    {citationMeta && (
                      <Tag
                        size="small"
                        theme={citationMeta.color as any}
                        variant="outline"
                      >
                        {citationMeta.label}
                      </Tag>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 mt-1.5 break-all">
                    {item.raw}
                  </div>
                  {item.reason && (
                    <div className="text-xs text-gray-500 mt-1">
                      原因：{item.reason}
                    </div>
                  )}
                  {item.matchedDoi && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      命中 DOI：<span className="font-mono">{item.matchedDoi}</span>
                    </div>
                  )}
                  {item.matchedTitle && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      命中标题：{item.matchedTitle}
                    </div>
                  )}
                  {item.citationReason && (
                    <div className="text-xs mt-1 p-2 rounded bg-white bg-opacity-60 border border-dashed border-gray-300">
                      <div className="text-gray-400 mb-0.5">引用上下文：</div>
                      <div className="text-gray-600 mb-1">{item.citationContext}</div>
                      <div className={`${
                        item.citationStatus === "VERIFIED" ? "text-green-600" :
                        item.citationStatus === "SUSPICIOUS" ? "text-orange-600" : "text-red-600"
                      }`}>
                        {item.citationReason}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Dialog>
    </TeacherLayout>
  );
}
