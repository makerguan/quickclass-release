/**
 * 复制文本到剪贴板（兼容非安全上下文：HTTP 下 navigator.clipboard 不可用，降级 execCommand）
 */
export async function copyText(text: string): Promise<boolean> {
  // 优先使用 Clipboard API（仅 HTTPS 或 localhost 可用）
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 忽略，走降级
  }
  // 降级方案：textarea + execCommand("copy")
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
