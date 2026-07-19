"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * 统一 Markdown 渲染组件
 *
 * 功能：
 * - GitHub 风格 Markdown（表格、任务列表、删除线等）：remark-gfm
 * - 数学公式行内 `$...$` 与块级 `$$...$$`：remark-math + rehype-katex
 *
 * 所有需要渲染 AI 生成的 Markdown 内容的页面都应使用此组件，
 * 避免每个页面重复配置插件导致行为不一致（如学生端有数学公式但教师端没有）。
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
    >
      {children}
    </ReactMarkdown>
  );
}