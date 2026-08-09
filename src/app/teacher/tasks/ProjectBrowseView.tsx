"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Button, Input, Tag, MessagePlugin } from "tdesign-react";

interface BrowseItem {
  id: string;
  studentName: string;
  studentPhone?: string;
  title: string;
  textContent?: string;
  pinned?: boolean;
  hidden?: boolean;
  likeCount: number;
  likedByMe?: boolean;
  attachment?: {
    id: string;
    originalName: string;
    fileType: string;
    fileSize: number;
  } | null;
}

interface BrowseData {
  submission?: {
    id: string;
    title: string;
    category: string;
    visibleToClass: boolean;
    allowLike: boolean;
  };
  items: BrowseItem[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  totalSize: number;
}

function formatSize(bytes: number) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const COL_OPTIONS = [2, 3, 4, 6] as const;

export default function ProjectBrowseView({
  submissionId,
  onBack,
}: {
  submissionId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<BrowseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [cols, setCols] = useState<number>(4);
  const [lightbox, setLightbox] = useState<{ url: string; isIframe?: boolean } | null>(null);
  const pageSize = 10;

  const token = useMemo(() => {
    if (typeof window !== "undefined") return localStorage.getItem("token") || "";
    return "";
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async (p: number, s: string) => {
      setLoading(true);
      try {
        const token = localStorage.getItem("token") || "";
        const qs = new URLSearchParams({ page: String(p), pageSize: String(pageSize), search: s });
        const res = await fetch(`/api/project-submissions/${submissionId}?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          setData(await res.json());
        } else if (!cancelled) {
          setData(null);
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load(1, "");
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  const reload = useCallback(
    (p: number, s: string) => {
      setLoading(true);
      const token = localStorage.getItem("token") || "";
      const qs = new URLSearchParams({ page: String(p), pageSize: String(pageSize), search: s });
      fetch(`/api/project-submissions/${submissionId}?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setData(d);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    },
    [submissionId]
  );

  const makeUrl = (path: string) => `${path}?token=${encodeURIComponent(token)}`;

  const togglePin = async (projectId: string, current: boolean) => {
    try {
      const res = await fetch(`/api/student-projects/${projectId}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pinned: !current }),
      });
      if (res.ok) {
        MessagePlugin.success(!current ? "已置顶" : "已取消置顶");
        reload(page, search);
      } else {
        const msg = await res.text();
        MessagePlugin.error(msg || "操作失败");
      }
    } catch {
      MessagePlugin.error("操作失败");
    }
  };

  const toggleHide = async (projectId: string, current: boolean) => {
    try {
      const res = await fetch(`/api/student-projects/${projectId}/hide`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hidden: !current }),
      });
      if (res.ok) {
        MessagePlugin.success(!current ? "已下架" : "已恢复显示");
        reload(page, search);
      } else {
        const msg = await res.text();
        MessagePlugin.error(msg || "操作失败");
      }
    } catch {
      MessagePlugin.error("操作失败");
    }
  };

  const toggleLike = async (projectId: string, liked: boolean) => {
    // 先乐观更新本地状态，避免闪烁
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.id === projectId
            ? { ...it, likedByMe: !liked, likeCount: it.likeCount + (liked ? -1 : 1) }
            : it
        ),
      };
    });
    try {
      const res = await fetch(`/api/student-projects/${projectId}/like`, {
        method: liked ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // 失败时回滚
        const msg = await res.text();
        MessagePlugin.error(msg || "操作失败");
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((it) =>
              it.id === projectId
                ? { ...it, likedByMe: liked, likeCount: it.likeCount + (liked ? 1 : -1) }
                : it
            ),
          };
        });
      }
    } catch {
      MessagePlugin.error("操作失败");
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button theme="default" variant="outline" icon={<span>←</span>} onClick={onBack}>
            返回
          </Button>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-[#1A1A1A]">
              {data?.submission?.title || "项目浏览"}
            </h2>
            {data?.submission && (
              <span className="text-xs text-[#63666F]">
                {data.submission.category === "TEXT"
                  ? "文本类"
                  : data.submission.category === "IMAGE"
                  ? "图片类"
                  : "音视频类"}
                · {data.submission.visibleToClass ? "全班可见" : "仅教师可见"}
                {data.submission.allowLike ? " · 可点赞" : ""}
              </span>
            )}
          </div>
        </div>
        <span className="text-sm text-[#63666F]">
          已提交 <b className="text-[#1A1A1A]">{data?.total ?? 0}</b> 项 · 占用{" "}
          {data ? formatSize(data.totalSize) : "—"}
        </span>
      </div>

      {/* 工具栏：搜索 + 列数切换 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={search}
          onChange={(v) => setSearch(v as string)}
          placeholder="搜索学生或题目"
          onEnter={() => {
            setPage(1);
            reload(1, search);
          }}
          className="flex-1 min-w-[160px]"
        />
        <Button
          onClick={() => {
            setPage(1);
            reload(1, search);
          }}
        >
          搜索
        </Button>
        <span className="w-px h-6 bg-gray-200 mx-1" />
        {COL_OPTIONS.map((n) => (
          <Button
            key={n}
            size="small"
            variant={cols === n ? "base" : "outline"}
            theme={cols === n ? "primary" : "default"}
            onClick={() => setCols(n)}
          >
            {n}列
          </Button>
        ))}
      </div>

      {/* 内容区 */}
      {loading ? (
        <p className="text-center text-gray-400 py-10">加载中…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-center text-gray-400 py-10">暂无提交</p>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {data.items.map((it) => {
            const ft = (it.attachment?.fileType || "").toLowerCase();
            const isImage = ft === "png" || ft === "jpg" || ft === "jpeg" || ft === "gif" || ft === "webp" || ft === "svg" || ft.startsWith("image/");
            const isPdf = ft === "pdf";
            const isVideo = ft === "mp4" || ft === "webm" || ft === "mov" || ft === "avi" || ft.startsWith("video/");
            const isAudio = ft === "mp3" || ft === "wav" || ft === "ogg" || ft === "aac" || ft.startsWith("audio/");
            const isTxt = ft === "txt" || ft === "text" || ft === "csv";
            const attachmentUrl = it.attachment
              ? `/api/student-projects/${it.id}/attachments/${it.attachment.id}`
              : null;
            const fullUrl = attachmentUrl ? makeUrl(attachmentUrl) : null;

            // 根据文件类型获取图标
            const getFileIcon = () => {
              if (!it.attachment) return { icon: "📄", label: "无附件" };
              if (isPdf) return { icon: "📕", label: "PDF" };
              if (ft === "doc" || ft === "docx") return { icon: "📘", label: "Word" };
              if (ft === "ppt" || ft === "pptx") return { icon: "📊", label: "PPT" };
              if (ft === "xls" || ft === "xlsx") return { icon: "📈", label: "Excel" };
              if (isTxt) return { icon: "📝", label: "文本" };
              if (isVideo) return { icon: "🎬", label: "视频" };
              if (isAudio) return { icon: "🎵", label: "音频" };
              return { icon: "📎", label: "文件" };
            };
            const fileInfo = getFileIcon();

            return (
              <div
                key={it.id}
                className="bg-white rounded-xl border overflow-hidden hover:shadow-md"
              >
                {/* 图片：缩略图 + 灯箱 */}
                {isImage && fullUrl ? (
                  <div
                    className="block cursor-pointer"
                    onClick={() => setLightbox({ url: fullUrl })}
                    title="点击放大查看"
                  >
                    <img
                      src={fullUrl}
                      alt={it.title}
                      className="w-full aspect-square object-cover"
                    />
                  </div>
                ) : isPdf && fullUrl ? (
                  /* PDF：点击图标弹出灯箱预览 */
                  <div
                    className="w-full aspect-square bg-[#F0F5FF] flex flex-col items-center justify-center gap-2 p-3 cursor-pointer"
                    onClick={() => setLightbox({ url: fullUrl + "&inline=1", isIframe: true })}
                    title="点击预览 PDF"
                  >
                    <span className="text-3xl">{fileInfo.icon}</span>
                    <span className="text-xs text-gray-500">{fileInfo.label}</span>
                    <span className="text-[#0052D9] text-sm hover:underline">点击预览</span>
                    <span className="text-xs text-gray-400 truncate max-w-full">{it.attachment?.originalName}</span>
                  </div>
                ) : isVideo && fullUrl ? (
                  /* 视频：原生 video 播放器 */
                  <div className="w-full aspect-square bg-black flex items-center justify-center">
                    <video
                      src={fullUrl}
                      controls
                      className="max-w-full max-h-full"
                      preload="metadata"
                    >
                      您的浏览器不支持视频播放
                    </video>
                  </div>
                ) : isAudio && fullUrl ? (
                  /* 音频：原生 audio 播放器 */
                  <div className="w-full aspect-square bg-[#F0F5FF] flex flex-col items-center justify-center gap-2 p-3">
                    <span className="text-3xl">{fileInfo.icon}</span>
                    <span className="text-xs text-gray-500">{fileInfo.label}</span>
                    <audio src={fullUrl} controls className="w-full max-w-[200px]" />
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
                  /* 文本：点击图标弹出灯箱预览 */
                  <div
                    className="w-full aspect-square bg-[#F0F5FF] flex flex-col items-center justify-center gap-2 p-3 cursor-pointer"
                    onClick={() => setLightbox({ url: fullUrl + "&inline=1", isIframe: true })}
                    title="点击预览文本"
                  >
                    <span className="text-3xl">{fileInfo.icon}</span>
                    <span className="text-xs text-gray-500">{fileInfo.label}</span>
                    <span className="text-[#0052D9] text-sm hover:underline">点击预览</span>
                    <span className="text-xs text-gray-400 truncate max-w-full">{it.attachment?.originalName}</span>
                  </div>
                ) : (
                  /* 其他类型：图标 + 下载 */
                  <div className="w-full aspect-square bg-[#F0F5FF] flex flex-col items-center justify-center gap-2 p-3">
                    {fullUrl ? (
                      <>
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
                        <span className="text-xs text-gray-400 truncate max-w-full">{it.attachment?.originalName}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl">{fileInfo.icon}</span>
                        <span className="text-gray-400 text-sm">无附件</span>
                      </>
                    )}
                  </div>
                )}
                <div className="p-2.5">
                  <p className="text-sm font-medium text-[#1A1A1A] truncate">{it.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-xs text-[#63666F] truncate">{it.studentName}</span>
                      <button
                        className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs leading-none transition-colors ${
                          it.pinned
                            ? "text-red-500 bg-red-50"
                            : "text-gray-300 hover:text-red-400 hover:bg-red-50/50"
                        }`}
                        title={it.pinned ? "已置顶（点击取消置顶）" : "置顶（排到最前）"}
                        onClick={(e) => { e.stopPropagation(); togglePin(it.id, !!it.pinned); }}
                      >
                        <svg viewBox="0 0 12 12" className="w-3 h-3 fill-current"><path d="M6 2L2 8h3v3h2V8h3z"/></svg>
                      </button>
                      <button
                        className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs leading-none transition-colors ${
                          it.hidden
                            ? "text-red-500 bg-red-50"
                            : "text-gray-300 hover:text-red-400 hover:bg-red-50/50"
                        }`}
                        title={it.hidden ? "已下架（点击恢复显示）" : "下架（仅学生本人可见）"}
                        onClick={(e) => { e.stopPropagation(); toggleHide(it.id, !!it.hidden); }}
                      >
                        <svg viewBox="0 0 12 12" className="w-3 h-3 fill-current"><path d="M6 10L10 4H8V1H4v3H2z"/></svg>
                      </button>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        className={`text-xs shrink-0 transition-colors ${
                          it.likedByMe ? "text-red-500" : "text-gray-300 hover:text-red-400"
                        }`}
                        title={it.likedByMe ? "取消点赞" : "点赞"}
                        onClick={(e) => { e.stopPropagation(); toggleLike(it.id, !!it.likedByMe); }}
                      >
                        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5 fill-current">
                          <path d="M6 10.5l-1.05-.95C2.5 7.5 1 6.1 1 4.5 1 3.1 2.1 2 3.5 2c.8 0 1.55.35 2.05.9L6 3.4l.45-.5C6.95 2.35 7.7 2 8.5 2 9.9 2 11 3.1 11 4.5c0 1.6-1.5 3-3.95 5.05L6 10.5z"/>
                        </svg>
                      </button>
                      <span className="text-xs text-[#999]">{it.likeCount}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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

      {/* 分页 */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="small"
            variant="outline"
            disabled={data.page <= 1}
            onClick={() => {
              const p = data.page - 1;
              setPage(p);
              reload(p, search);
            }}
          >
            上一页
          </Button>
          <span className="text-sm text-[#63666F]">
            {data.page} / {data.totalPages}
          </span>
          <Button
            size="small"
            variant="outline"
            disabled={data.page >= data.totalPages}
            onClick={() => {
              const p = data.page + 1;
              setPage(p);
              reload(p, search);
            }}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
