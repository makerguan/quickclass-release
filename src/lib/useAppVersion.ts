"use client";
import { useEffect, useState } from "react";

/**
 * 获取软件版本号（来自 /api/version，读取 VERSION.md）。
 * 用于学情分析报告头部展示，确保与软件实际版本一致。
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/version")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.version) setVersion(d.version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
