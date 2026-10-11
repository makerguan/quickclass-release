"use client";

/**
 * 文本型分析报告的「导出 PDF」按钮。
 *
 * 为什么只挂在文本型分支：网页型报告已有「全屏查看」按钮（新窗口写 HTML → 浏览器打印），
 * 能力重叠；文本型此前无任何导出路径（2026-10-11 教师需求：报告底部直接导出 PDF）。
 *
 * ⚠️ GOTCHA / 为什么这样做：
 * - 不给 Markdown.tsx 加 props：它被 memo 包装且契约禁止新增对象/函数 props（见其 L272-280）。
 * - 不用 @media print 整页打印：报告嵌在带导航/侧栏的页面里，过滤成本高；
 *   新窗口方案与既有「全屏查看」按钮同模式（window.open + document.write），零新依赖。
 * - 克隆的是【已渲染 DOM】：Markdown 组件输出的 qc-chart 图表是内联 SVG/表格
 *   （report-charts.ts wrap()），innerHTML 序列化不丢图；若未来图表改成 canvas 绘制，
 *   此处需先 canvas.toDataURL() 换成 img，否则导出会丢图。
 * - 按钮自身也会被克隆进 HTML，用 .qc-export-btn 包裹定位并在克隆后移除。
 *
 * 📐 CONTRACT：调用点的报告正文容器必须带 data-insight-body 属性（closest 向上查找），
 * 丢了该属性按钮会静默失效（host 为 null 直接 return）。
 *
 * 🔗 RELATED（5 处调用点，均为 InsightContent 的 markdown 分支）：
 * - src/app/teacher/tasks/[taskId]/exploration/[explorationId]/page.tsx
 * - src/app/teacher/tasks/[taskId]/insights/page.tsx
 * - src/app/teacher/insights/page.tsx
 * - src/app/student/insights/page.tsx
 * - src/app/teacher/activities/[subProjectId]/quiz/[quizId]/report/page.tsx
 */
export default function ExportPdfButton({ title }: { title: string }) {
  const handleExport = (e: React.MouseEvent<HTMLButtonElement>) => {
    const host = e.currentTarget.closest<HTMLElement>("[data-insight-body]");
    if (!host) return;
    // 克隆已渲染正文并摘掉按钮本身（qc-chart 为内联 SVG/表格，序列化不丢）
    const clone = host.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".qc-export-btn").forEach((el) => el.remove());
    const safeTitle = title.replace(/[<>&]/g, "");
    const w = window.open("", "_blank");
    if (!w) return; // 弹窗被浏览器拦截：与「全屏查看」按钮同一降级行为
    w.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  body { max-width: 800px; margin: 24px auto; padding: 0 16px; color: #1F2937; line-height: 1.75; font-size: 14px; font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
  h1, h2, h3, h4 { line-height: 1.4; margin: 1.2em 0 0.5em; }
  h1 { font-size: 22px; border-bottom: 1px solid #E5E7EB; padding-bottom: 0.3em; }
  h2 { font-size: 19px; border-bottom: 1px solid #F3F4F6; padding-bottom: 0.25em; }
  h3 { font-size: 16px; }
  p, ul, ol { margin: 0.6em 0; }
  ul, ol { padding-left: 1.5em; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #D1D5DB; padding: 6px 12px; text-align: left; }
  th { background: #F9FAFB; }
  code { background: #F3F4F6; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  pre { background: #F9FAFB; border: 1px solid #E5E7EB; padding: 12px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #D1D5DB; margin: 0.8em 0; padding: 0.2em 1em; color: #6B7280; }
  img, svg { max-width: 100%; height: auto; }
  .qc-chart { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    @page { margin: 18mm 15mm; }
    body { max-width: none; margin: 0; padding: 0; }
  }
</style>
</head>
<body>${clone.innerHTML}</body>
</html>`);
    w.document.close();
    w.focus();
    // 等文档就绪再唤起打印（选「另存为 PDF」即得 PDF），避免样式未就绪
    const doPrint = () => {
      try {
        w.print();
      } catch {
        /* 用户环境禁打印时静默 */
      }
    };
    if (w.document.readyState === "complete") doPrint();
    else w.addEventListener("load", doPrint, { once: true });
  };

  return (
    <div className="qc-export-btn mt-6 flex justify-end">
      <button
        onClick={handleExport}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 bg-white transition-colors"
        title="在新窗口打开报告并唤起打印，选择「另存为 PDF」即可导出"
      >
        📄 导出 PDF
      </button>
    </div>
  );
}
