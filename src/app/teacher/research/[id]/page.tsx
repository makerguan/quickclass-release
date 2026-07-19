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

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [project, setProject] = useState<ResearchProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [streamedText, setStreamedText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
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
        a.download = `${project.projectName}-${project.projectType === "PAPER" ? "论文" : "课题"}.docx`;
        a.click();
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
    </TeacherLayout>
  );
}
