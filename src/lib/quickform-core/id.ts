/**
 * ID 生成 —— 沿用 QuickForm 2.5 真实算法，保持数据连续性。
 * task_id：11 位 = 9 位字母数字 + 2 位大写字母后缀（如 oU59mLzPJPU）
 */

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomChars(pool: string, len: number): string {
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += pool[arr[i] % pool.length];
  return out;
}

export function generateTaskId(): string {
  return randomChars(ALNUM, 9) + randomChars(UPPER, 2);
}

export function generateRecordId(): string {
  return crypto.randomUUID();
}
