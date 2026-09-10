/**
 * 格式化学情分析生成时间为 "YYYY-MM-DD HH:mm"。
 * 空值/非法值返回空字符串（本地乐观更新的历史版本可能没有时间）。
 */
export function formatInsightTime(createdAt?: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
