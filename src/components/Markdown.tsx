"use client";

import {
  useEffect,
  useRef,
  useState,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type ReactElement,
} from "react";
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
 * - 图片：`/api/images/` 开头的本地教学图片 URL 自动追加登录 token
 *   （<img> 标签无法携带 Authorization header，读图 API 支持 ?token= 鉴权）
 * - Mermaid：```mermaid 代码块动态加载 mermaid.js 渲染成图表
 *   （流程图/思维导图/时间轴等，AI 无需外部图片即可"现画"示意图）
 *
 * 所有需要渲染 AI 生成的 Markdown 内容的页面都应使用此组件，
 * 避免每个页面重复配置插件导致行为不一致（如学生端有数学公式但教师端没有）。
 */

/** 本地图片 URL 追加 token（SSR 阶段无 localStorage，原样返回） */
function withAuthToken(src: string): string {
  if (typeof window === "undefined" || !src.startsWith("/api/images/")) return src;
  if (src.includes("token=")) return src;
  const token = localStorage.getItem("token");
  if (!token) return src;
  return `${src}${src.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

/** Mermaid 代码块渲染器：懒加载 mermaid.js，渲染失败回退为普通代码块 */
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    // 渲染失败（语法错误等）：显示源码，学生至少能看出内容
    return (
      <pre className="bg-gray-50 rounded-lg p-3 overflow-x-auto text-xs text-gray-600">
        <code>{code}</code>
      </pre>
    );
  }
  if (!svg) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-gray-400">
        图表生成中...
      </div>
    );
  }
  return (
    <div
      className="my-2 overflow-x-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** 统一的 <img> 渲染：本地图片带 token；限制最大宽度，点击可放大 */
function MarkdownImg({ src, alt, ...rest }: ComponentPropsWithoutRef<"img">) {
  const s = typeof src === "string" ? src : "";
  const [enlarged, setEnlarged] = useState(false);
  const finalSrc = withAuthToken(s);
  return (
    <span className="block relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...rest}
        src={finalSrc}
        alt={alt || ""}
        className="max-w-full max-h-96 rounded-lg cursor-zoom-in my-1"
        loading="lazy"
        onClick={() => setEnlarged(true)}
      />
      {enlarged && (
        <span
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center cursor-zoom-out p-6"
          onClick={() => setEnlarged(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={finalSrc}
            alt={alt || ""}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </span>
      )}
    </span>
  );
}

/** 递归提取 React 子节点中的纯文本（mermaid 源码提取用） */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

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
      components={{
        ...(inline ? { p: ({ children }) => <>{children}</> } : {}),
        img: MarkdownImg,
        pre: inline
          ? undefined
          : ({ children }) => {
              // mermaid 代码块：整块交给 MermaidBlock 渲染（pre 内不能嵌 div，故在此拦截）
              const child = Array.isArray(children) ? children[0] : children;
              if (
                isValidElement<{ className?: string; children?: ReactNode }>(child) &&
                /^language-mermaid/.test(String(child.props.className || ""))
              ) {
                return <MermaidBlock code={extractText(child.props.children)} />;
              }
              return <pre>{children}</pre>;
            },
      }}
    >
      {normalizeMathDelimiters(children)}
    </ReactMarkdown>
  );
}
