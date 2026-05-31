"use client";

import { useEffect, useState, useRef } from "react";
import { Button, Card, Dialog, Input, MessagePlugin, Tag, Progress } from "tdesign-react";
import { AddIcon, DeleteIcon, FileIcon, BrowseIcon, CheckCircleIcon, StopCircleIcon } from "tdesign-icons-react";
import TeacherLayout from "@/components/layout/TeacherLayout";

// 知识库字符数上限
const MAX_CONTENT_LENGTH = 50000;

interface KnowledgeBase {
  id: string;
  name: string;
  content: string;
  filename: string | null;
  fileSize: number | null;
  status: string;
  enabled: boolean;
  createdAt: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getContentPercent(content: string): number {
  return Math.min(100, Math.round((content.length / MAX_CONTENT_LENGTH) * 100));
}

export default function KnowledgeBasePage() {
  const [list, setList] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [formName, setFormName] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formContentLength, setFormContentLength] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewKb, setPreviewKb] = useState<KnowledgeBase | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchList();
  }, []);

  const fetchList = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/knowledge-base", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setList(await res.json());
      }
    } catch {
      console.error("获取知识库失败");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormFile(null);
    setFormContentLength(0);
    setEditing(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openCreate = () => {
    resetForm();
    setFormVisible(true);
  };

  const openEdit = (kb: KnowledgeBase) => {
    setEditing(kb);
    setFormName(kb.name);
    setFormFile(null);
    setFormContentLength(kb.content.length);
    setFormVisible(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormFile(file);
    if (file) {
      try {
        const text = await file.text();
        setFormContentLength(text.length);
      } catch {
        setFormContentLength(0);
      }
    } else {
      setFormContentLength(editing?.content.length || 0);
    }
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      MessagePlugin.error("请填写知识库名称");
      return;
    }

    // 新建时必须上传文件
    if (!editing && !formFile) {
      MessagePlugin.error("请选择文件");
      return;
    }

    // 检查字符数
    if (formContentLength > MAX_CONTENT_LENGTH) {
      MessagePlugin.error(`内容超出限制（${formContentLength.toLocaleString()} / 50,000 字符），请精简后重新上传`);
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      const formData = new FormData();
      formData.append("name", formName);
      if (editing) formData.append("id", editing.id);
      if (formFile) formData.append("file", formFile);

      const url = "/api/knowledge-base";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        MessagePlugin.success(editing ? "知识库已更新" : "知识库已创建");
        setFormVisible(false);
        resetForm();
        fetchList();
      } else {
        let errorMsg = "保存失败";
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch {
          errorMsg = `服务器错误 (${res.status})`;
        }
        MessagePlugin.error(errorMsg);
      }
    } catch {
      MessagePlugin.error("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (kb: KnowledgeBase) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/knowledge-base", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: kb.id, enabled: !kb.enabled }),
      });
      if (res.ok) {
        MessagePlugin.success(kb.enabled ? "已禁用" : "已启用");
        fetchList();
      } else {
        MessagePlugin.error("操作失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/knowledge-base?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        MessagePlugin.success("已删除");
        fetchList();
      } else {
        MessagePlugin.error("删除失败");
      }
    } catch {
      MessagePlugin.error("网络错误");
    }
  };

  return (
    <TeacherLayout>
      <div className="max-w-5xl space-y-6 pb-8">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">📚 知识库管理</h2>
            <p className="text-[#63666F] text-sm mt-1">
              上传文档作为知识库，上传即可被课堂引用。对话时知识库全文注入 AI，确保零信息丢失
            </p>
            <div className="mt-2 p-3 bg-[#F0F7FF] rounded-lg text-xs text-[#63666F] space-y-1">
              <p><span className="font-medium text-[#0052D9]">📖 使用说明：</span>点击「新建知识库」上传 .md/.txt 文档（单个课堂引用不超过 50,000 字符），在课堂管理中引用已启用的知识库</p>
              <p><span className="font-medium text-[#0052D9]">💡 特点：</span>全量注入 AI 上下文，无需向量检索，零信息丢失</p>
            </div>
          </div>
          <Button theme="primary" icon={<AddIcon />} onClick={openCreate}>
            新建知识库
          </Button>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : list.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg mb-2">📚</p>
              <p>暂无知识库</p>
              <p className="text-sm mt-2">点击「新建知识库」上传您的第一个文档</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {list.map((kb) => {
              const percent = getContentPercent(kb.content);
              const isOverLimit = kb.content.length > MAX_CONTENT_LENGTH;
              return (
                <Card key={kb.id} className={!kb.enabled ? "opacity-60" : ""}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-[#1A1A1A] truncate">{kb.name}</h3>
                        <Tag
                          theme={kb.enabled ? "success" : "default"}
                          variant="light"
                          size="small"
                        >
                          {kb.enabled ? "已启用" : "已禁用"}
                        </Tag>
                        {kb.enabled && (
                          <Tag
                            theme={isOverLimit ? "danger" : "success"}
                            variant="light"
                            size="small"
                          >
                            {isOverLimit ? "⚠ 超出限制" : "✓ 可用"}
                          </Tag>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[#63666F] mt-1">
                        {kb.filename && (
                          <span className="flex items-center gap-1">
                            <FileIcon /> {kb.filename}
                            {kb.fileSize != null && ` (${formatFileSize(kb.fileSize)})`}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Progress
                          status={isOverLimit ? "warning" : "success"}
                          percentage={percent}
                          size="small"
                          style={{ width: 120 }}
                          label={false}
                        />
                        <span className={`text-xs ${isOverLimit ? "text-red-500 font-medium" : "text-[#63666F]"}`}>
                          {kb.content.length.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} 字符
                          {isOverLimit && " ⚠ 超出限制"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        创建于 {new Date(kb.createdAt).toLocaleDateString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-4 shrink-0">
                      <Button
                        theme={kb.enabled ? "warning" : "success"}
                        variant="text"
                        size="small"
                        icon={kb.enabled ? <StopCircleIcon /> : <CheckCircleIcon />}
                        onClick={() => handleToggleEnabled(kb)}
                      >
                        {kb.enabled ? "禁用" : "启用"}
                      </Button>
                      <Button
                        theme="default"
                        variant="text"
                        size="small"
                        icon={<BrowseIcon />}
                        onClick={() => setPreviewKb(kb)}
                      >
                        预览
                      </Button>
                      <Button
                        theme="default"
                        variant="text"
                        size="small"
                        icon={<AddIcon />}
                        onClick={() => openEdit(kb)}
                      >
                        编辑
                      </Button>
                      <Button
                        theme="danger"
                        variant="text"
                        size="small"
                        icon={<DeleteIcon />}
                        onClick={() => handleDelete(kb.id)}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* 新建/编辑知识库对话框 */}
        <Dialog
          header={editing ? "编辑知识库" : "新建知识库"}
          visible={formVisible}
          onClose={() => { setFormVisible(false); resetForm(); }}
          footer={null}
          width={550}
          destroyOnClose
        >
          <div className="space-y-4">
            <Input
              value={formName}
              onChange={(v) => setFormName(v)}
              placeholder="知识库名称 *"
            />
            <div>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-[#0052D9] transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {formFile ? (
                  <div>
                    <FileIcon className="text-[#0052D9] text-2xl" />
                    <p className="text-sm text-[#0052D9] mt-1">{formFile.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatFileSize(formFile.size)}</p>
                  </div>
                ) : editing ? (
                  <div>
                    <FileIcon className="text-gray-400 text-2xl" />
                    <p className="text-sm text-gray-500 mt-1">
                      当前文件：{editing.filename || "未知"}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      点击上传新文件替换（可选）
                    </p>
                  </div>
                ) : (
                  <div>
                    <FileIcon className="text-gray-400 text-2xl" />
                    <p className="text-sm text-gray-500 mt-1">
                      点击选择文件
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      支持 .md、.markdown、.txt 格式
                    </p>
                  </div>
                )}
              </div>
            </div>
            {/* 字符数进度条 */}
            {formContentLength > 0 && (
              <div className="flex items-center gap-2">
                <Progress
                  status={formContentLength > MAX_CONTENT_LENGTH ? "warning" : "success"}
                  percentage={Math.min(100, Math.round((formContentLength / MAX_CONTENT_LENGTH) * 100))}
                  size="small"
                  style={{ width: 120 }}
                  label={false}
                />
                <span className={`text-xs ${formContentLength > MAX_CONTENT_LENGTH ? "text-red-500 font-medium" : "text-[#63666F]"}`}>
                  {formContentLength.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} 字符
                  {formContentLength > MAX_CONTENT_LENGTH && " ⚠ 超出限制"}
                </span>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
              <Button onClick={() => { setFormVisible(false); resetForm(); }}>取消</Button>
              <Button
                theme="primary"
                loading={saving}
                disabled={formContentLength > MAX_CONTENT_LENGTH}
                onClick={handleSave}
              >
                {editing ? "保存修改" : "创建"}
              </Button>
            </div>
          </div>
        </Dialog>

        {/* 知识库预览对话框 */}
        <Dialog
          header={previewKb ? `预览：${previewKb.name}` : "预览"}
          visible={!!previewKb}
          onClose={() => setPreviewKb(null)}
          footer={<Button onClick={() => setPreviewKb(null)}>关闭</Button>}
          width={700}
          destroyOnClose
        >
          {previewKb && (
            <div>
              <div className="flex items-center gap-3 text-xs text-[#63666F] mb-3 pb-3 border-b border-gray-100">
                {previewKb.filename && (
                  <span className="flex items-center gap-1">
                    <FileIcon /> {previewKb.filename}
                  </span>
                )}
                <span>{previewKb.content.length.toLocaleString()} 字符</span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                <pre className="whitespace-pre-wrap break-words text-sm text-[#1A1A1A] leading-relaxed font-sans">
                  {previewKb.content}
                </pre>
              </div>
            </div>
          )}
        </Dialog>
      </div>
    </TeacherLayout>
  );
}
