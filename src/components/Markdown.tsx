"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "@/lib/math-format";

/**
 * 统一 Markdown 渲染组件
 *
 * 功能：
 * - GitHub 风格 Markdown（表格、任务列表、删除线等）：remark-gfm
 * - 数学公式行内 `$...$` 与块级 `$$...$$`：remark-math + rehype-katex
 * - 定界符兜底：模型输出的 `\(...\)`、`\[...\]` 先转换为 `$...$`、`$$...$$`
 *   （remark-math 不识别 \( \) 形式，否则学生会看到 LaTeX 源码）
 *
 * 所有需要渲染 AI 生成的 Markdown 内容的页面都应使用此组件，
 * 避免每个页面重复配置插件导致行为不一致（如学生端有数学公式但教师端没有）。
 */
export default function Markdown({
  children,
  inline,
}: {
  children: string;
  /**
   * 行内模式：只输出行内内容，不产生 <p> 等块级元素。
   * 用于题目选项、评语、标签等单行片段，避免块级边距破坏行内布局。
   */
  inline?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={inline ? { p: ({ children }) => <>{children}</> } : undefined}
    >
      {normalizeMathDelimiters(children)}
    </ReactMarkdown>
  );
}