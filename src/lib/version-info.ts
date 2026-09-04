import fs from "fs";
import path from "path";

export interface VersionInfo {
  version: string;
  changelog: string;
}

/**
 * 从指定目录读取版本信息。
 *
 * 版本号职责划分：
 * - public/latest.json 的 version 字段 = 当前版本号的唯一真源
 *   （设置页、版本检测、升级流程均以它为准）
 * - VERSION.md 只用于记录各版本更新历史，其顶部"当前版本"行
 *   仅作为 latest.json 缺失时的兜底（兼容旧包）
 */
export function readVersionInfoFromDir(rootDir: string): VersionInfo {
  // 1) 首选 public/latest.json
  try {
    const latestPath = path.join(rootDir, "public", "latest.json");
    if (fs.existsSync(latestPath)) {
      const latest = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
      const version =
        typeof latest.version === "string" ? latest.version.trim() : "";
      const changelog =
        typeof latest.changelog === "string" ? latest.changelog : "";
      if (version) return { version, changelog };
    }
  } catch {}

  // 2) 兜底 VERSION.md（latest.json 缺失的旧包）
  try {
    const mdPath = path.join(rootDir, "VERSION.md");
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, "utf-8");
      const m = content.match(/当前版本：\*\*(v[^*]+)\*\*/);
      if (m) {
        const version = m[1];
        const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const changelogMatch = content.match(
          new RegExp(`### ${escaped}[\\s\\S]*?(?=### |---|$)`)
        );
        return {
          version,
          changelog: changelogMatch ? changelogMatch[0].trim() : "",
        };
      }
    }
  } catch {}

  return { version: "unknown", changelog: "" };
}
