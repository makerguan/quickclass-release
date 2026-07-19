"use client";

import { useEffect, useState } from "react";
import { Button, Tag, Loading, MessagePlugin } from "tdesign-react";
import {
  AddIcon,
  FileWordIcon,
  DeleteIcon,
  EditIcon,
  ChevronRightIcon,
} from "tdesign-icons-react";
import TeacherLayout from "@/components/layout/TeacherLayout";
import Link from "next/link";

interface ResearchProject {
  id: string;
  projectName: string;
  projectType: "PAPER" | "PROPOSAL";
  status: "DRAFT" | "TITLES_READY" | "COMPLETED";
  selectedTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ResearchListPage() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/research/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setProjects(await res.json());
      }
    } catch (e) {
      MessagePlugin.error("加载项目列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除该项目吗？")) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/research/projects/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success("已删除");
        loadProjects();
      }
    } catch (e) {
      MessagePlugin.error("删除失败");
    }
  };

  const typeLabel = (type: string) => (type === "PAPER" ? "论文" : "课题");
  const typeTagTheme = (type: string) =>
    type === "PAPER" ? "primary" : "success";
  const statusLabel = (status: string) =>
    status === "COMPLETED" ? "已完成" : status === "TITLES_READY" ? "题目已生成" : "草稿";
  const statusTagTheme = (status: string) =>
    status === "COMPLETED" ? "success" : status === "TITLES_READY" ? "warning" : "default";

  return (
    <TeacherLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">教学研究</h1>
            <p className="text-sm text-gray-500 mt-1">
              基于真实教学数据，AI 辅助生成课题方案和论文初稿
            </p>
          </div>
          <Link href="/teacher/research/new">
            <Button theme="primary" icon={<AddIcon />}>
              新建研究项目
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <Loading />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div className="text-5xl mb-4">📝</div>
            <h3 className="text-lg font-medium text-gray-700 mb-2">
              还没有研究项目
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              点击右上角按钮，创建第一个基于真实教学数据的研究项目
            </p>
            <Link href="/teacher/research/new">
              <Button theme="primary">新建研究项目</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-lg border border-gray-200 p-5 hover:border-[#0052D9] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">
                        {p.projectType === "PAPER" ? "📄" : "📋"}
                      </span>
                      <h3 className="font-semibold text-lg text-[#1A1A1A]">
                        {p.projectName}
                      </h3>
                      <Tag theme={typeTagTheme(p.projectType)} variant="light" size="small">
                        {typeLabel(p.projectType)}
                      </Tag>
                      <Tag theme={statusTagTheme(p.status)} variant="light" size="small">
                        {statusLabel(p.status)}
                      </Tag>
                    </div>
                    {p.selectedTitle ? (
                      <p className="text-sm text-gray-600 mb-1">
                        <span className="text-gray-400">研究题目：</span>
                        {p.selectedTitle}
                      </p>
                    ) : null}
                    <p className="text-xs text-gray-400">
                      更新于 {new Date(p.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {p.status === "COMPLETED" && (
                      <Button
                        theme="primary"
                        variant="outline"
                        size="small"
                        icon={<FileWordIcon />}
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem("token");
                            const res = await fetch(
                              `/api/research/projects/${p.id}/download`,
                              { headers: { Authorization: `Bearer ${token}` } }
                            );
                            if (res.ok) {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `${p.projectName}-${typeLabel(p.projectType)}.docx`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }
                          } catch (e) {
                            MessagePlugin.error("下载失败");
                          }
                        }}
                      >
                        下载 Word
                      </Button>
                    )}
                    <Link href={`/teacher/research/${p.id}`}>
                      <Button
                        theme="default"
                        variant="outline"
                        size="small"
                        icon={p.status === "COMPLETED" ? <EditIcon /> : <ChevronRightIcon />}
                      >
                        {p.status === "COMPLETED" ? "查看/编辑" : "继续"}
                      </Button>
                    </Link>
                    <Button
                      theme="danger"
                      variant="text"
                      size="small"
                      icon={<DeleteIcon />}
                      onClick={() => handleDelete(p.id)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}
