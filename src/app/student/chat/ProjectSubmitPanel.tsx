"use client";

import { useState, useEffect, useRef } from "react";
import { Button, Input, Tag, MessagePlugin, Dialog } from "tdesign-react";
import { UploadIcon, HeartIcon, BrowseIcon } from "tdesign-icons-react";

interface AttachmentInfo {
  id: string;
  originalName: string;
  fileType: string;
  fileSize: number;
}

interface MyProject {
  id: string;
  title: string;
  description?: string;
  attachment: AttachmentInfo | null;
  likeCount: number;
}

interface ClassItem {
  id: string;
  studentId: string;
  studentName: string;
  title: string;
  description?: string;
  attachment: AttachmentInfo | null;
  likeCount: number;
  likedByMe: boolean;
  isMine: boolean;
}

interface SubmissionMeta {
  id: string;
  title: string;
  description?: string;
  category: "TEXT" | "IMAGE" | "VIDEO";
  visibleToClass: boolean;
  allowLike: boolean;
  fileSizeLimit: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  TEXT: "文本类",
  IMAGE: "图片类",
  VIDEO: "音视频类",
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const token = () => localStorage.getItem("token") || "";

const makeUrl = (path: string) => `${path}?token=${encodeURIComponent(token())}`;

export default function ProjectSubmitPanel({
  projectId,
  onBack,
  onChanged,
}: {
  projectId: string;
  tasks?: any;
  onBack: () => void;
  onChanged?: () => void;
}) {
  const [meta, setMeta] = useState<SubmissionMeta | null>(null);
  const [mine, setMine] = useState<MyProject | null>(null);
  const [classItems, setClassItems] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [upTitle, setUpTitle] = useState("");
  const [upDesc, setUpDesc] = useState("");
  const [upFile, setUpFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ url: string; isIframe?: boolean } | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [mineRes, classRes] = await Promise.all([
        fetch(`/api/project-submissions/${projectId}/mine`, {
          headers: { Authorization: `Bearer ${token()}` },
        }),
        // 即使未全班可见，该接口也会返回 403，前端忽略即可
        fetch(`/api/project-submissions/${projectId}/class-list`, {
          headers: { Authorization: `Bearer ${token()}` },
        }).catch(() => null),
      ]);

      if (mineRes.ok) {
        const d = await mineRes.json();
        setMeta(d.submission);
        setMine(d.mine);
      }
      if (classRes && classRes.ok) {
        const d = await classRes.json();
        setMeta((prev) => prev || d.submission);
        setClassItems(d.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openUpload = () => {
    setUpTitle(mine?.title || "");
    setUpDesc(mine?.description || "");
    setUpFile(null);
    setUploadOpen(true);
  };

  const handleSubmit = async () => {
    if (!upTitle.trim()) {
      MessagePlugin.warning("请填写项目标题");
      return;
    }
    if (!upFile && !mine) {
      MessagePlugin.warning("请上传文件");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("title", upTitle.trim());
      form.append("description", upDesc || "");
      if (upFile) form.append("file", upFile);

      // 已有则编辑，否则新建
      const url = mine
        ? `/api/student-projects/${mine.id}`
        : `/api/project-submissions/${projectId}/mine`;
      const method = mine ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token()}` },
        body: form,
      });
      if (res.ok) {
        MessagePlugin.success(mine ? "已更新提交" : "提交成功");
        setUploadOpen(false);
        await loadAll();
        onChanged?.();
      } else {
        const t = await res.text();
        MessagePlugin.error(t || "操作失败");
      }
    } catch (e) {
      MessagePlugin.error("操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMine = async () => {
    if (!mine) return;
    const ok = await new Promise<boolean>((resolve) => {
      Dialog.confirm({
        header: "删除提交",
        body: "确定删除自己的项目提交吗？删除后不可恢复。",
        onConfirm: () => resolve(true),
        onClose: () => resolve(false),
      });
    });
    if (!ok) return;
    const res = await fetch(`/api/student-projects/${mine.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (res.ok) {
      MessagePlugin.success("已删除");
      await loadAll();
      onChanged?.();
    } else {
      MessagePlugin.error("删除失败");
    }
  };

  const toggleLike = async (item: ClassItem) => {
    const method = item.likedByMe ? "DELETE" : "POST";
    const res = await fetch(`/api/student-projects/${item.id}/like`, {
      method,
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (res.ok) {
      setClassItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? {
                ...it,
                likedByMe: !it.likedByMe,
                likeCount: it.likeCount + (it.likedByMe ? -1 : 1),
              }
            : it
        )
      );
    } else {
      const t = await res.text();
      MessagePlugin.error(t || "操作失败");
    }
  };

  if (loading && !meta) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
        加载中…
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
        <p>未找到该项目任务</p>
        <Button variant="text" onClick={onBack}>返回</Button>
      </div>
    );
  }

  const attachmentUrl = (projectRecordId: string, aid: string) =>
    `/api/student-projects/${projectRecordId}/attachments/${aid}`;

  function getFileIcon(ft: string) {
    if (ft === "pdf") return { icon: "\uD83D\uDCD5", label: "PDF" };
    if (ft === "doc" || ft === "docx") return { icon: "\uD83D\uDCD8", label: "Word" };
    if (ft === "ppt" || ft === "pptx") return { icon: "\uD83D\uDCCA", label: "PPT" };
    if (ft === "xls" || ft === "xlsx") return { icon: "\uD83D\uDCC8", label: "Excel" };
    if (ft === "txt" || ft === "text" || ft === "csv") return { icon: "\uD83D\uDCDD", label: "\u6587\u672C" };
    return { icon: "\uD83D\uDCCE", label: "\u6587\u4EF6" };
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-gray-200 bg-[#FAFBFC] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrowseIcon className="text-[#FF7D00]" size="18px" />
          <div>
            <h3 className="text-sm font-medium text-[#1A1A1A]">{meta.title}</h3>
            <p className="text-xs text-[#63666F]">
              {CATEGORY_LABEL[meta.category]} · 单文件 · 上限 {meta.fileSizeLimit}MB
              {meta.visibleToClass ? " · 全班可见" : " · 仅教师可见"}
              {meta.allowLike ? " · 可点赞" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {mine ? (
            <>
              <Button theme="default" variant="outline" size="small" onClick={openUpload}>
                编辑/重提
              </Button>
              <Button theme="danger" variant="outline" size="small" onClick={handleDeleteMine}>
                删除
              </Button>
            </>
          ) : (
            <Button theme="primary" size="small" icon={<UploadIcon />} onClick={openUpload}>
              上传
            </Button>
          )}
        </div>
      </div>

      {/* 我的提交状态 */}
      {mine && (
        <div className="px-4 py-2 bg-orange-50/50 border-b border-orange-100 text-xs text-[#B25E00] flex items-center justify-between">
          <span>你已提交：{mine.title}{mine.attachment ? `（${mine.attachment.originalName}）` : ""}</span>
          <span>获赞 {mine.likeCount}</span>
        </div>
      )}

      {/* 全班列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {classItems.length === 0 ? (
          <div className="text-center text-gray-400 mt-10">
            <p>暂无其他同学提交</p>
            {!meta.visibleToClass && <p className="text-xs mt-2">该任务未对全班可见</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {classItems.map((item) => {
              const ft = (item.attachment?.fileType || "").toLowerCase();
              const isImage = ft === "png" || ft === "jpg" || ft === "jpeg" || ft === "gif" || ft === "webp" || ft === "svg" || ft.startsWith("image/");
              const isPdf = ft === "pdf";
              const isVideo = ft === "mp4" || ft === "webm" || ft === "mov" || ft === "avi" || ft.startsWith("video/");
              const isAudio = ft === "mp3" || ft === "wav" || ft === "ogg" || ft === "aac" || ft.startsWith("audio/");
              const isTxt = ft === "txt" || ft === "text" || ft === "csv";
              const url = item.attachment ? attachmentUrl(item.id, item.attachment.id) : null;
              const fullUrl = url ? makeUrl(url) : null;
              const fileInfo = getFileIcon(ft);

              return (
              <div
                key={item.id}
                className={`border rounded-lg overflow-hidden bg-white flex flex-col ${
                  item.isMine ? "border-[#FF7D00]" : "border-gray-200"
                }`}
              >
                <div className="p-3 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[#1A1A1A] truncate">{item.studentName}</span>
                    {item.isMine && <Tag theme="warning" size="small">我</Tag>}
                  </div>
                  <p className="text-sm text-[#333] mt-1 truncate">{item.title}</p>
                </div>

                {/* 预览区 */}
                <div className="flex-1 min-h-[140px] bg-gray-50 flex items-center justify-center">
                  {item.attachment ?
                    isImage && fullUrl ? (
                      <div
                        className="block cursor-pointer w-full h-full flex items-center justify-center"
                        onClick={() => setLightbox({ url: fullUrl })}
                        title="点击放大查看"
                      >
                        <img
                          src={fullUrl}
                          alt={item.attachment.originalName}
                          className="max-h-48 object-contain"
                        />
                      </div>
                    ) : isPdf && fullUrl ? (
                      <div
                        className="w-full min-h-[140px] bg-[#F0F5FF] flex flex-col items-center justify-center gap-2 p-3 cursor-pointer"
                        onClick={() => setLightbox({ url: fullUrl + "&inline=1", isIframe: true })}
                        title="点击预览 PDF"
                      >
                        <span className="text-3xl">{fileInfo.icon}</span>
                        <span className="text-xs text-gray-500">{fileInfo.label}</span>
                        <span className="text-[#0052D9] text-sm hover:underline">点击预览</span>
                        <span className="text-xs text-gray-400 truncate max-w-full">{item.attachment.originalName}</span>
                      </div>
                    ) : isVideo && fullUrl ? (
                      <video src={fullUrl} controls className="max-h-48 max-w-full" preload="metadata">
                        您的浏览器不支持视频播放
                      </video>
                    ) : isAudio && fullUrl ? (
                      <div className="flex flex-col items-center justify-center gap-2 p-3">
                        <span className="text-3xl">{fileInfo.icon}</span>
                        <span className="text-xs text-gray-500">{fileInfo.label}</span>
                        <audio src={fullUrl} controls className="max-w-[200px]" />
                        <a
                          href={fullUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#0052D9] text-xs hover:underline"
                        >
                          下载
                        </a>
                      </div>
                    ) : isTxt && fullUrl ? (
                      <div
                        className="w-full min-h-[140px] bg-[#F0F5FF] flex flex-col items-center justify-center gap-2 p-3 cursor-pointer"
                        onClick={() => setLightbox({ url: fullUrl + "&inline=1", isIframe: true })}
                        title="点击预览文本"
                      >
                        <span className="text-3xl">{fileInfo.icon}</span>
                        <span className="text-xs text-gray-500">{fileInfo.label}</span>
                        <span className="text-[#0052D9] text-sm hover:underline">点击预览</span>
                        <span className="text-xs text-gray-400 truncate max-w-full">{item.attachment.originalName}</span>
                      </div>
                    ) : fullUrl ? (
                      <div className="flex flex-col items-center justify-center gap-2 p-3">
                        <span className="text-3xl">{fileInfo.icon}</span>
                        <span className="text-xs text-gray-500">{fileInfo.label}</span>
                        <a
                          href={fullUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#0052D9] text-sm hover:underline"
                        >
                          下载
                        </a>
                        <span className="text-xs text-gray-400 truncate max-w-full">{item.attachment.originalName}</span>
                      </div>
                    ) : (
                      <span className="text-gray-300 text-xs">无附件</span>
                    )
                  : (
                    <span className="text-gray-300 text-xs">无附件</span>
                  )}
                </div>

                {/* 底部：点赞 */}
                <div className="px-3 py-2 flex items-center justify-between border-t border-gray-100">
                  <span className="text-xs text-[#63666F]">
                    {item.attachment ? formatSize(item.attachment.fileSize) : ""}
                  </span>
                  {meta.allowLike && !item.isMine ? (
                    <Button
                      size="small"
                      variant="text"
                      theme={item.likedByMe ? "danger" : "default"}
                      icon={<HeartIcon />}
                      onClick={() => toggleLike(item)}
                    >
                      {item.likeCount}
                    </Button>
                  ) : (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <HeartIcon size="14px" /> {item.likeCount}
                    </span>
                  )}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {/* 上传/编辑弹窗 */}
      <Dialog
        visible={uploadOpen}
        header={mine ? "编辑我的项目" : "上传我的项目"}
        onClose={() => setUploadOpen(false)}
        onConfirm={handleSubmit}
        confirmBtn={{ content: submitting ? "提交中…" : mine ? "保存" : "提交", loading: submitting }}
        cancelBtn="取消"
        width={480}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm text-[#333]">项目标题 *</label>
            <Input value={upTitle} onChange={(v) => setUpTitle(v as string)} placeholder="请输入项目标题" />
          </div>
          <div>
            <label className="text-sm text-[#333]">说明（可选）</label>
            <Input
              value={upDesc}
              onChange={(v) => setUpDesc(v as string)}
              placeholder="简单描述你的项目"
              textarea
            />
          </div>
          <div>
            <label className="text-sm text-[#333]">
              文件（{CATEGORY_LABEL[meta.category]}）* {meta.fileSizeLimit}MB 以内
            </label>
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => setUpFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm"
            />
            {mine?.attachment && !upFile && (
              <p className="text-xs text-gray-400 mt-1">
                当前文件：{mine.attachment.originalName}（不选择则保留原文件）
              </p>
            )}
            {upFile && <p className="text-xs text-[#0052D9] mt-1">已选择：{upFile.name}</p>}
          </div>
        </div>
      </Dialog>

      {/* 灯箱 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          {lightbox.isIframe ? (
            <iframe
              src={lightbox.url}
              className="w-[90vw] h-[90vh] rounded-lg shadow-2xl bg-white"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox.url}
              className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white text-xl flex items-center justify-center transition-colors"
            onClick={() => setLightbox(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
