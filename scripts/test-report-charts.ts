/**
 * 图表生成器单测：npx tsx scripts/test-report-charts.ts
 * 覆盖：几何正确性、XML 转义、边界兜底、降级、主题、截断
 */
import { renderChart, processChartBlocks, validateChartSpec } from "../src/lib/report-charts";

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (detail ? ` | ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " | " + detail : ""}`); }
}

console.log("== 雷达图几何 ==");
{
  const svg = renderChart({
    type: "radar",
    data: [
      { name: "课堂参与", value: 50 }, { name: "知识掌握", value: 100 },
      { name: "思维深度", value: 25 }, { name: "作业表现", value: 75 },
      { name: "学习态度", value: 60 },
    ],
  });
  // cx=230 cy=215 R=150；首顶点 value=50 → (230, 215-75) = (230.0,140.0)
  check("首顶点朝正上方", svg.includes("230.0,140.0"));
  // 第 2 顶点（72°，value=100）：x=230+150·sin72°=372.7, y=215-150·cos72°=168.6
  check("第二顶点坐标精确", svg.includes("372.7,168.6"));
  check("网格 4 层同心多边形", (svg.match(/<polygon points=/g) || []).length >= 5); // 4 网格 + 1 数据
  check("无 NaN/undefined", !svg.includes("NaN") && !svg.includes("undefined"));
}
{
  const svg = renderChart({ type: "radar", data: [{ name: "A", value: 1 }, { name: "B", value: 2 }] });
  check("维度<3 降级表格", svg.includes("降级") || svg.includes("渲染失败"));
}

console.log("== XML 转义 ==");
{
  const svg = renderChart({
    type: "radar",
    data: [
      { name: 'a<b>&"c', value: 50 }, { name: "d'e", value: 60 }, { name: "正常", value: 70 },
    ],
  });
  check("特殊字符已转义", svg.includes("a&lt;b&gt;&amp;&quot;c"));
  check("原始尖括号不外泄", !svg.includes(">a<b>") && !svg.includes('name="a<b>'));
}

console.log("== 饼图边界 ==");
{
  const svg = renderChart({ type: "pie", data: [{ name: "对", value: 0 }, { name: "错", value: 0 }] });
  check("全 0 显示暂无数据", svg.includes("暂无数据"));
  check("全 0 无 NaN", !svg.includes("NaN"));
}
{
  const svg = renderChart({ type: "pie", data: [{ name: "掌握", value: 100 }, { name: "未掌握", value: 0 }] });
  check("单块 100% 用圆环描边", svg.includes("<circle") && !svg.includes("NaN"));
  check("单块显示圆心数值", svg.includes("100%"));
}
{
  const svg = renderChart({ type: "pie", data: [{ name: "对", value: 70 }, { name: "错", value: 30, warn: true }] });
  check("warn 块用警示色", svg.includes("#E34D59"));
  check("两块自动环形图", svg.includes("font-size=\"28\""));
  check("图例存在", svg.includes("display:flex"));
}

console.log("== 折线边界 ==");
{
  const svg = renderChart({ type: "line", data: [{ name: "第1次", value: 82 }] });
  check("单点不画线只画点", !svg.includes("<polyline") && svg.includes("<circle"));
}
{
  const svg = renderChart({
    type: "line",
    data: [{ name: "一", value: 60 }, { name: "二", value: 90 }, { name: "三", value: 30 }],
  });
  check("最大值高亮主色", new RegExp(`fill="#0052D9" font-weight="bold"`).test(svg));
  check("面积填充存在", svg.includes("stop-opacity"));
}

console.log("== 柱状图 ==");
{
  const svg = renderChart({
    type: "bar",
    data: Array.from({ length: 15 }, (_, i) => ({ name: `学生${i + 1}`, value: 60 + i })),
  });
  check("15 项自动横向", svg.includes("text-anchor=\"end\"") && !svg.includes("rx=\"6\""));
}
{
  const svg = renderChart({
    type: "bar", style: { warnBelow: 60 },
    data: [{ name: "题1", value: 45 }, { name: "题2", value: 80 }],
  });
  check("低于阈值用警示渐变", svg.includes("FF8F9A"));
  check("类别标签换行 tspan 或两段 text", (svg.match(/font-size="12" fill="#4B5563"/g) || []).length >= 2);
}

console.log("== 进度条/散点 ==");
{
  const svg = renderChart({ type: "progress", style: { unit: "%" }, data: [{ name: "知识点A", value: 82 }] });
  check("纯 CSS 无 SVG", !svg.includes("<svg") && svg.includes("width:82%"));
}
{
  const svg = renderChart({ type: "scatter", data: [{ x: 5, y: 5 }, { x: 5, y: 7 }] });
  check("退化数据无 NaN", !svg.includes("NaN"));
  check("散点带标题提示", svg.includes("<circle"));
}

console.log("== 主题 ==");
{
  const svg = renderChart({ type: "radar", style: { theme: "green" }, data: [{ name: "A", value: 50 }, { name: "B", value: 60 }, { name: "C", value: 70 }] });
  check("green 主题用 #00A870", svg.includes("#00A870") && !svg.includes("#0052D9"));
}

console.log("== 长文本 ==");
{
  const svg = renderChart({
    type: "radar",
    data: [{ name: "数字化学习与创新素养", value: 50 }, { name: "B", value: 60 }, { name: "C", value: 70 }],
  });
  check("超 8 字截断带省略号", svg.includes("…"));
}

console.log("== 管线 processChartBlocks ==");
{
  const html = `<h3>分析</h3><p>文字</p>\n\`\`\`chart\n{"type":"radar","title":"综合","data":[{"name":"A","value":50},{"name":"B","value":60},{"name":"C","value":70}]}\n\`\`\`\n<p>结尾</p>`;
  const out = processChartBlocks(html);
  check("chart 块被替换", !out.includes("```chart"));
  check("渲染出 SVG", out.includes("<svg"));
  check("其余 HTML 原样保留", out.includes("<h3>分析</h3>") && out.includes("<p>结尾</p>"));
}
{
  const html = `<p>普通报告，无图表块</p>`;
  check("无块时原样返回", processChartBlocks(html) === html);
}
{
  const html = `\`\`\`chart\n{"type":"radar","data":[坏JSON}\n\`\`\``;
  const out = processChartBlocks(html);
  check("坏 JSON 降级不崩溃", out.includes("降级") || out.includes("失败"));
}
{
  const html = `\`\`\`chart\n{"type":"funnel","data":[{"name":"A","value":1}]}\n\`\`\``;
  const out = processChartBlocks(html);
  check("未知类型降级", out.includes("不支持") || out.includes("降级"));
}
{
  // 降级表格仍能提取原始数据
  const html = `\`\`\`chart\n{"type":"radar","title":"能力","data":[{"name":"A","value":50},{"name":"B","value":60}]}\n\`\`\``;
  const out = processChartBlocks(html);
  check("降级表格含原始数据", out.includes("<td") && out.includes("50"));
}
{
  const spec = validateChartSpec({ type: "bar", data: [] });
  check("空数组校验拒绝", spec.ok === false);
}
{
  const spec = validateChartSpec({ type: "bar", data: [{ name: "A", value: Number.NaN }] });
  check("NaN 值校验拒绝", spec.ok === false);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) { console.log("失败项:\n" + fails.join("\n")); process.exit(1); }
