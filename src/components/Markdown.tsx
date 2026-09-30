"use client";

import {
  memo,
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
    // code 变化时重置失败标记：流式输出期间 mermaid 语法尚不完整导致的渲染失败
    // 不应永久化（否则流结束后语法完整了仍显示源码而非图表）
    setFailed(false);
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
          fontFamily: "inherit",
        });
        // ⚠️ GOTCHA（mermaid 12.0.0 实测，2026-09）：
        // 1) parse 成功返回的是对象（{diagramType,...}）而非 true，与官方文档不符 ——
        //    所以只能用 === false 判定失败；若写 === true / if (!ok)，图表会永远静默回退成源码。
        // 2) parse 失败（suppressErrors:true）零 DOM 副作用；而 render 失败会在 document.body
        //    末尾挂一张「Syntax error in text / mermaid version」错误图残留（约 4KB）。
        //    流式输出期间 code 是半成品，直接 render 必然反复失败、反复挂错误图 ——
        //    这就是学生看到 "Syntax error in text" 的根因。parse 预检把 99% 的失败挡在
        //    render 之前（半成品语法不完整 → parse 返回 false → 走源码回退，零副作用）。
        if ((await mermaid.parse(code, { suppressErrors: true })) === false) {
          if (!cancelled) setFailed(true);
          return;
        }
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        // ⛔ DO NOT REVERT：无论成败、无论是否 cancelled 都要执行 ——
        // mermaid render 失败时挂在 document.body 末尾的错误图残留（<div id="d{renderId}">）
        // 是全局 DOM 污染，不随组件卸载消失；cancelled 场景（流式期间 code 变化触发重渲染，
        // 旧 effect 的迟到失败 render）若不清理会永久残留。成功渲染时 mermaid 自身会清掉
        // 残留，此处 remove 是幂等 no-op。parse 预检挡不住的低频失败（布局/SVG 阶段报错）
        // 也由这里兜底。
        document.getElementById(`d${idRef.current}`)?.remove();
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

/**
 * ⚠️ GOTCHA —— 本函数 MUST STAY AT MODULE TOP LEVEL，禁止改回内联箭头函数或挪进 Markdown 组件体内：
 * react-markdown 10.x（经 hast-util-to-jsx-runtime）把 components[tag] 直接作为 React 元素的 type，
 * React 按 type 引用相等判断是否复用组件实例。内联箭头函数每次渲染都是新引用 → React 判定
 * "组件类型变了" → 卸载重挂整个 pre 子树 → MermaidBlock 的 svg state 丢失 → 先显示
 * "图表生成中..."占位再异步 mermaid.render 重画 —— 这就是"学生在输入框打一个字，流程图闪一下"
 * 的根因（2026-09-30 playwright 实测复现：按键后 250ms 原 DOM 节点 document.contains=false，
 * svg id 从 mmd-gohv70sv 变为 mmd-ugjcuzrv，mermaid.render 整个重跑了一遍）。
 * 同型坑先例：src/app/student/chat/page.tsx 的 ExplorationPanelRender 护栏注释（内联组件定义
 * 导致 iframe 整页重载）。
 *
 * 🔗 RELATED：改这里要同步看 —— MermaidBlock（本文件，useEffect 依赖 [code]，code 不变则不重渲染）；
 * src/app/student/chat/page.tsx:951（学生聊天页调用点）。
 * ⛔ DO NOT REVERT：不要为了"就近取用组件体变量"把它挪回函数体内 —— 那正是闪烁 bug 的根源。
 */
function MarkdownPre({ children }: { children?: ReactNode }) {
  // mermaid 代码块：整块交给 MermaidBlock 渲染（pre 内不能嵌 div，故在此拦截）
  const child = Array.isArray(children) ? children[0] : children;
  if (
    isValidElement<{ className?: string; children?: ReactNode }>(child) &&
    /^language-mermaid/.test(String(child.props.className || ""))
  ) {
    return <MermaidBlock code={extractText(child.props.children)} />;
  }
  return <pre>{children}</pre>;
}

/** 行内模式的 <p> 渲染：剥掉块级 <p> 只留内容（题目选项/评语等单行片段用）。同样必须留在模块顶层 */
function InlineParagraph({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/**
 * 插件数组与 components 对象必须是模块级常量（引用恒定）：
 * react-markdown 10.x 的同步 Markdown 组件每次渲染都完整重跑 parse + runSync（无内部 memo），
 * 组件体内新建的字面量除了引发子树 remount，还会让父组件每敲一个字都重新解析全部 markdown。
 */
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

/** 块级模式：mermaid 拦截（pre）+ 图片增强（img） */
const BLOCK_COMPONENTS = { img: MarkdownImg, pre: MarkdownPre };

/**
 * 行内模式：p 剥块级包装。
 * ⚠️ GOTCHA：不能写 `pre: undefined` —— hast-util-to-jsx-runtime 用 hasOwnProperty 判断
 * components 里是否注册了某 tag，显式的 undefined 值会被当作"已注册"然后把 undefined 传给
 * jsx() 导致渲染崩溃；直接不写这个键则安全回退为原生 <pre>。
 */
const INLINE_COMPONENTS = { p: InlineParagraph, img: MarkdownImg };

/**
 * 📐 CONTRACT —— 本组件被 React.memo 包装，调用方约定：
 * props 只有 children(string) 与 inline(boolean)，全是原始类型，浅比较即可精确判断内容是否变化。
 * 学生聊天页（src/app/student/chat/page.tsx）输入框每敲一个字符 setInput → 整页重渲染，
 * 若无 memo，页面上每条历史消息的 markdown 都会被完整重新解析（react-markdown 无内部缓存），
 * 且 mermaid 图表因 components.pre 引用变化被卸载重挂（闪烁）。
 * ⛔ DO NOT REVERT：不要移除 memo；也不要给本组件新增对象/函数类型的 props（会破坏浅比较
 * 语义，确需新增时必须同时提供自定义 arePropsEqual 并回归本注释场景）。
 */
const Markdown = memo(function Markdown({
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
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={inline ? INLINE_COMPONENTS : BLOCK_COMPONENTS}
    >
      {normalizeMathDelimiters(children)}
    </ReactMarkdown>
  );
});

export default Markdown;
