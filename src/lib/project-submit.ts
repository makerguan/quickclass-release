import fs from "fs";
import path from "path";

// 项目提交附件存储目录
export const UPLOAD_DIR = path.join(process.cwd(), "uploads", "student-projects");

// 类别 -> 允许的 MIME / 扩展名
export const CATEGORY_ALLOWED: Record<string, { ext: string[]; mime: string[] }> = {
  TEXT: {
    ext: ["doc", "docx", "pdf", "txt"],
    mime: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
      "text/plain",
    ],
  },
  IMAGE: {
    ext: ["jpg", "jpeg", "png", "gif", "webp"],
    mime: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
  VIDEO: {
    ext: ["mp4", "webm", "mov", "avi", "mkv"],
    mime: ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska"],
  },
};

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export function getExt(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : "";
}

// 校验文件是否符合类别与大小限制；返回错误信息或 null
export function validateFile(
  file: File,
  category: string,
  sizeLimitMB: number
): string | null {
  const rule = CATEGORY_ALLOWED[category];
  if (!rule) return "未知的项目类别";

  const ext = getExt(file.name);
  const mime = file.type || "";

  const extOk = rule.ext.includes(ext);
  const mimeOk = rule.mime.includes(mime) || (category === "VIDEO" && mime.startsWith("video/"));
  if (!extOk && !mimeOk) {
    return `文件类型不符合要求（类别：${category}，允许：${rule.ext.join("/")}）`;
  }

  const maxBytes = sizeLimitMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `文件大小超过限制（${file.size / 1024 / 1024 >= 1 ? (file.size / 1024 / 1024).toFixed(1) + "MB" : Math.round(file.size / 1024) + "KB"} / 上限 ${sizeLimitMB}MB）`;
  }
  if (file.size === 0) {
    return "文件内容为空";
  }
  return null;
}

// 写入文件，返回 { storedName, originalName, fileType, fileSize }
export async function saveUploadedFile(
  file: File
): Promise<{ storedName: string; originalName: string; fileType: string; fileSize: number }> {
  ensureUploadDir();
  const ext = getExt(file.name);
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
  return {
    storedName,
    originalName: file.name,
    fileType: ext,
    fileSize: file.size,
  };
}

// 物理删除附件文件（忽略不存在）
export function deleteAttachmentFile(storedName: string) {
  if (!storedName) return;
  const p = path.join(UPLOAD_DIR, storedName);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error("删除附件文件失败:", storedName, e);
  }
}
