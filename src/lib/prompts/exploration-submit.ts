/**
 * 互动探究 - 提交功能注入提示词配置
 * 当启用提交时，系统会用这些提示词改造 HTML，注入提交功能
 */

// 为 window 全局变量声明类型
declare global {
  interface Window {
    __explorationData__?: Record<string, any>;
    __TASK_TITLE__?: string;
    __STUDENT_NAME__?: string;
    __CLASS_NAME__?: string;
  }
}

/**
 * 提交按钮 CSS 样式
 */
export const submitButtonCSS = `
#quickclass-submit-root #submitBtn {
  position: fixed;
  bottom: 30px;
  left: 30px;
  padding: 15px 30px;
  background: #E34D59;
  color: white;
  border: none;
  border-radius: 25px;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(227,77,89,0.4);
  z-index: 10000;
  font-weight: bold;
}
#quickclass-submit-root #submitBtn:hover { background: #C44050; }
#quickclass-submit-root #submitBtn:disabled { background: #ccc; cursor: not-allowed; }
`.trim();

export const submitMessageScript = `
function submitResults() {
  var data = window.__explorationData__ || {};
  // QuickForm 采集块存在时，把学生填写的内容一起带上；
  // 采集块缺失 / 采集异常都不影响原有行为数据的提交。
  var answers = {};
  try {
    if (typeof qfCollectAnswers === "function") answers = qfCollectAnswers() || {};
  } catch (e) { answers = {}; }
  window.parent.postMessage({
    type: "EXPLORATION_SUBMIT",
    payload: {
      timeSpent: data.timeSpent || 0,
      interactions: data.interactions || 0,
      scrollDepth: data.scrollDepth || 0,
      attempts: data.attempts || 1,
      score: data.score || 0,
      maxScore: data.maxScore || 100,
      completedSections: data.completedSections || [],
      gameLevel: data.gameLevel || 1,
      actionLog: data.actionLog || [],
      answers: answers
    }
  }, "*");
}
`;

/**
 * 基础追踪脚本（无结构要求的兜底方案）
 * 用于 HTML 结构简单，没有预期元素的情况
 */
export const basicTrackingScript = `
// ===== 基础追踪脚本 - 记录学生行为 =====
window.__explorationData__ = {
  // 基本信息（将由系统注入）
  explorationId: "",
  taskTitle: "",
  studentName: "",
  className: "",

  // 行为数据
  timeSpent: 0,           // 停留时间（秒）
  startTime: Date.now(),     // 开始时间
  interactions: 0,          // 互动次数（记录所有点击）
  scrollDepth: 0,           // 滚动深度（最大百分比）
  attempts: 1,              // 尝试次数

  // 得分（需要手动调用 updateScore()）
  score: 0,
  maxScore: 100,

  // 环节完成（手动调用 completeSection()）
  completedSections: [],

  // 游戏级别
  gameLevel: 1,

  // 交互操作明细日志 [{ type, target, value, timestamp }]
  actionLog: []
};

// 启动时记录
var startTime = Date.now();

// 定时更新停留时间
setInterval(function() {
  if (window.__explorationData__) {
    window.__explorationData__.timeSpent = Math.floor((Date.now() - startTime) / 1000);
  }
}, 1000);

// 记录滚动深度
window.addEventListener("scroll", function() {
  var scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
  var scrollPercent = scrollHeight > 0 ? Math.round((window.scrollY / scrollHeight) * 100) : 100;
  if (window.__explorationData__ && scrollPercent > (window.__explorationData__.scrollDepth || 0)) {
    window.__explorationData__.scrollDepth = scrollPercent;
  }
});

// 记录所有点击作为互动
document.addEventListener("click", function() {
  if (window.__explorationData__) {
    window.__explorationData__.interactions++;
  }
});

// ===== 供外部调用的函数 =====

// 更新得分
function updateScore(score) {
  if (window.__explorationData__) {
    window.__explorationData__.score = Math.max(0, Math.min(score, window.__explorationData__.maxScore));
  }
}

// 完成环节
function completeSection(name) {
  if (window.__explorationData__ && name) {
    var sections = window.__explorationData__.completedSections;
    if (sections.indexOf(name) === -1) {
      sections.push(name);
    }
  }
}

// 设置游戏级别
function setGameLevel(level) {
  if (window.__explorationData__ && level) {
    window.__explorationData__.gameLevel = Math.max(1, level);
  }
}

// 增加尝试次数
function addAttempt() {
  if (window.__explorationData__) {
    window.__explorationData__.attempts++;
  }
}

/**
 * 记录交互操作明细
 * @param {string} type  - 交互类型：select(选择) | fill(填写) | drag(拖动) | click(点击) | input(输入) | match(配对) | sort(排序)
 * @param {string} target - 操作的元素描述，如"第1题选项B"、"填空框2"
 * @param {string} value  - 用户操作的值内容，如"B"、"3.14"、"正确"
 */
function recordAction(type, target, value) {
  if (window.__explorationData__ && type && target) {
    window.__explorationData__.actionLog.push({
      type: type,
      target: target,
      value: value || "",
      timestamp: Date.now()
    });
    window.__explorationData__.interactions++;
  }
}
`.trim();

/**
 * 提交按钮 HTML
 */
export const submitButtonHTML = `<div id="quickclass-submit-root"><button id="submitBtn" onclick="submitResults()">提交</button></div>`;
// ===== 提交 =====
async function submitResults() {
  if (!confirm("确认提交？提交后将无法修改。")) return;

  var btn = document.getElementById("submitBtn");
  if (btn) { btn.innerHTML = "提交中..."; (btn as HTMLButtonElement).disabled = true; }

  // 准备提交数据
  var submitData = {
    // 行为数据
    timeSpent: window.__explorationData__ ? window.__explorationData__.timeSpent : 0,
    interactions: window.__explorationData__ ? window.__explorationData__.interactions : 0,
    scrollDepth: window.__explorationData__ ? window.__explorationData__.scrollDepth : 0,
    attempts: window.__explorationData__ ? window.__explorationData__.attempts : 1,

    // 得分
    score: window.__explorationData__ ? window.__explorationData__.score : 0,
    maxScore: window.__explorationData__ ? window.__explorationData__.maxScore : 100,

    // 环节完成
    completedSections: window.__explorationData__ ? window.__explorationData__.completedSections : [],

    // 级别
    gameLevel: window.__explorationData__ ? window.__explorationData__.gameLevel : 1,

    // 操作明细日志
    actionLog: window.__explorationData__ ? window.__explorationData__.actionLog : [],

    // 上下文
    taskTitle: window.__TASK_TITLE__ || "",
    studentName: window.__STUDENT_NAME__ || "",
    className: window.__CLASS_NAME__ || ""
  };

  try {
    var token = localStorage.getItem("token") || "";
    var submitBtn = document.getElementById("submitBtn");
    var eid = submitBtn ? (submitBtn.getAttribute('data-eid') || "") : "";
    var response = await fetch("/api/exploration-activities/" + eid + "/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify(submitData)
    });

    if (response.ok) {
      var result = await response.json();
      var info = [
        "提交成功！",
        "得分：" + result.score + " / " + result.maxScore,
        "停留时间：" + (window.__explorationData__ ? window.__explorationData__.timeSpent : 0) + "秒",
        "互动次数：" + (window.__explorationData__ ? window.__explorationData__.interactions : 0) + "次"
      ].join("\n");
      alert(info);
      if (btn) { btn.innerHTML = "已提交 ✓"; btn.style.background = "#4CAF50"; }
    } else {
      alert("提交失败，请重试。");
      if (btn) { btn.innerHTML = "重新提交"; (btn as HTMLButtonElement).disabled = false; }
    }
} catch (e) {
      alert("提交失败：" + (e instanceof Error ? e.message : String(e)));
      if (btn) { btn.innerHTML = "重新提交"; (btn as HTMLButtonElement).disabled = false; }
  }
}

/* ==========================================================================
 * QuickForm 采集块（Part 1）
 * ==========================================================================
 * 目标：不管 AI 生成的是「概念可视化 / 模拟实验」还是「练习题」型页面，
 * 都能采到**结构化答案**（现有追踪脚本只采行为：停留/点击/滚动）。
 *
 * 做法两层：
 *   (a) 自动扫描页面里已有的 input / select / textarea，按可读标签取名后取值；
 *   (b) 兜底追加一个通用「探究记录」面板（姓名 + 我的发现），
 *       页面里没有任何可填控件时也至少有东西可采。
 *
 * 采集结果随原有 postMessage 一起提交（payload.answers），
 * 归属哪个 QuickForm 任务由服务端按 ExplorationActivity.qfTaskId 决定 —— 
 * 因此**页面里不出现任何 taskId / 提交链接**，AI 重生成网页也不会冲掉绑定。
 */

/** 采集块的起止标记：整块可替换、可移除，重复注入幂等 */
export const QF_BLOCK_BEGIN = "<!--QUICKCLASS-QF-BEGIN-->";
export const QF_BLOCK_END = "<!--QUICKCLASS-QF-END-->";

export const qfCollectCSS = `
#quickclass-qf-panel {
  max-width: 720px;
  margin: 32px auto 120px;
  padding: 20px 22px;
  border: 1px solid #E3E6EB;
  border-radius: 12px;
  background: #FAFBFC;
  color: #1A1A1A;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
#quickclass-qf-panel .qf-title { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
#quickclass-qf-panel .qf-hint { font-size: 12px; color: #8A9099; line-height: 1.7; margin-bottom: 14px; }
#quickclass-qf-panel .qf-field { display: block; margin-bottom: 12px; }
#quickclass-qf-panel .qf-label { display: block; font-size: 13px; color: #4A5058; margin-bottom: 6px; }
#quickclass-qf-panel .qf-label em { font-style: normal; font-size: 12px; color: #A0A6AE; }
#quickclass-qf-panel input[type="text"],
#quickclass-qf-panel textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid #DDE1E6;
  border-radius: 8px;
  background: #FFFFFF;
  color: #1A1A1A;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}
#quickclass-qf-panel input[type="text"]:focus,
#quickclass-qf-panel textarea:focus {
  outline: none;
  border-color: #4C8DFF;
  box-shadow: 0 0 0 3px rgba(76,141,255,0.12);
}
#quickclass-qf-panel .qf-auto { margin-top: 4px; padding-top: 10px; border-top: 1px dashed #E3E6EB; }
#quickclass-qf-panel .qf-auto summary { font-size: 12px; color: #8A9099; cursor: pointer; }
#quickclass-qf-panel .qf-auto ul { margin: 8px 0 0; padding-left: 18px; }
#quickclass-qf-panel .qf-auto li { font-size: 12px; color: #4A5058; line-height: 1.9; }
#quickclass-qf-panel .qf-auto li b { color: #1A1A1A; font-weight: 600; }
#quickclass-qf-panel .qf-auto li.qf-empty { list-style: none; margin-left: -18px; color: #A0A6AE; }
`.trim();

/** 通用「探究记录」面板：任何页面都追加，兜底保证有东西可采 */
export const qfCollectPanelHTML = `
<div id="quickclass-qf-panel" data-qf-panel>
  <div class="qf-title">探究记录</div>
  <div class="qf-hint">这里填写的内容，会随页面左下角的「提交」一起发送给老师；页面上已有的选择、填空、滑块等也会一并自动记录。</div>
  <label class="qf-field">
    <span class="qf-label">姓名 <em>（可不填，默认使用你的账号姓名）</em></span>
    <input id="qf-student-name" type="text" placeholder="请输入姓名" autocomplete="off" />
  </label>
  <label class="qf-field">
    <span class="qf-label">我的发现 / 结论</span>
    <textarea id="qf-findings" rows="3" placeholder="写下你在这次探究中的发现、结论或疑问"></textarea>
  </label>
  <details class="qf-auto">
    <summary>本次会一并记录的观察数据：<span id="qf-auto-count">0</span> 项</summary>
    <ul id="qf-auto-list"></ul>
  </details>
</div>
`.trim();

export const qfCollectScript = `
// ===== QuickForm 探究记录采集（自动扫描 + 通用面板）=====
// 全部用 ES5 写法：这段脚本直接注入 HTML 运行，不经过任何编译
function qfNorm(s) {
  return String(s == null ? "" : s).replace(/\\s+/g, " ").trim();
}

function qfEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 跳过：隐藏/按钮类控件、禁用控件、显式标记、以及我们自己的面板与提交按钮 */
function qfSkip(el) {
  var tag = el.tagName.toLowerCase();
  var type = (el.getAttribute("type") || "text").toLowerCase();
  if (tag === "input") {
    if (type === "hidden" || type === "submit" || type === "button" ||
        type === "reset" || type === "image" || type === "file" || type === "password") return true;
  }
  if (el.disabled) return true;
  if (el.getAttribute("data-qf-skip") !== null) return true;
  if (el.closest && (el.closest("#quickclass-qf-panel") || el.closest("#quickclass-submit-root"))) return true;
  return false;
}

/** label[for=id] 的文本表，避免为拼选择器做转义 */
function qfLabelMap() {
  var map = {}, ls = document.getElementsByTagName("label"), i, f, tx;
  for (i = 0; i < ls.length; i++) {
    f = ls[i].htmlFor || ls[i].getAttribute("for");
    if (f && !map[f]) {
      tx = qfNorm(ls[i].textContent);
      if (tx) map[f] = tx;
    }
  }
  return map;
}

/** 取控件自己的文本内容（剔除里面的 input/select/textarea/button，避免把值也当成标签） */
function qfOwnText(node) {
  var clone = node.cloneNode(true);
  var junk = clone.querySelectorAll("input, select, textarea, button");
  for (var j = junk.length - 1; j >= 0; j--) {
    if (junk[j].parentNode) junk[j].parentNode.removeChild(junk[j]);
  }
  return qfNorm(clone.textContent);
}

function qfLabelOf(el, idx, map) {
  var t = "";
  if (el.getAttribute) {
    t = el.getAttribute("aria-label") || el.getAttribute("data-label") || el.getAttribute("title") || "";
  }
  if (!t && el.id && map && map[el.id]) t = map[el.id];
  if (!t && el.closest) {
    var p = el.closest("label");
    if (p) t = qfOwnText(p);
  }
  if (!t) {
    // 往上找 ≤3 层，取前面那个短文本兄弟（常见的 "题目：<input>" 结构）
    var node = el, depth = 0, prev, tg, tx;
    while (node && depth < 3 && !t) {
      prev = node.previousElementSibling;
      while (prev) {
        tg = prev.tagName;
        if (tg !== "SCRIPT" && tg !== "STYLE") {
          tx = qfNorm(prev.textContent);
          if (tx && tx.length <= 40) { t = tx; break; }
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
      depth++;
    }
  }
  if (!t) t = el.getAttribute("name") || el.getAttribute("placeholder") || "";
  t = qfNorm(t).slice(0, 40);
  return t || ("字段" + (idx + 1));
}

/** 选项控件的取值：优先它自己的 label 文本，其次 value */
function qfChoiceText(el, map) {
  var t = "";
  if (el.closest) {
    var lb = el.closest("label");
    if (lb) t = qfOwnText(lb);
  }
  if (!t && el.id && map && map[el.id]) t = map[el.id];
  if (!t) t = el.getAttribute("aria-label") || "";
  if (!t) t = el.value || "";
  return qfNorm(t).slice(0, 40);
}

/**
 * 单选 / 多选「整组」的标签：要的是**题目**，不是选项自己的文字。
 * 所以必须跳过选项自己的 label，从它的外层往上找前置短文本。
 */
function qfGroupLabelOf(el, idx, map) {
  var t = "";
  if (el.getAttribute) {
    t = el.getAttribute("aria-label") || el.getAttribute("data-label") || el.getAttribute("title") || "";
  }
  if (!t && el.id && map && map[el.id]) t = map[el.id];
  if (!t) {
    var node = (el.closest && el.closest("label")) || el;
    var depth = 0, prev, tg, tx;
    while (node && depth < 3 && !t) {
      prev = node.previousElementSibling;
      while (prev) {
        tg = prev.tagName;
        if (tg !== "SCRIPT" && tg !== "STYLE") {
          tx = qfNorm(prev.textContent);
          if (tx && tx.length <= 60) { t = tx; break; }
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
      depth++;
    }
  }
  if (!t) t = el.getAttribute("name") || "";
  t = qfNorm(t).slice(0, 40);
  return t || ("选项" + (idx + 1));
}

/** 采集当前页面所有可采内容，返回扁平对象（键为可读标签） */
function qfCollectAnswers() {
  var out = {}, seen = {}, map = qfLabelMap();

  function put(k, v) {
    k = qfNorm(k).slice(0, 40) || "未命名字段";
    if (seen[k]) {
      var n = 2;
      while (seen[k + "_" + n]) n++;
      k = k + "_" + n;
    }
    seen[k] = 1;
    out[k] = v;
  }

  // 通用面板（固定键名，老师改文案也不影响）
  var nameEl = document.getElementById("qf-student-name");
  if (nameEl && qfNorm(nameEl.value)) put("学生姓名", qfNorm(nameEl.value));
  var findEl = document.getElementById("qf-findings");
  if (findEl && qfNorm(findEl.value)) put("我的发现", qfNorm(findEl.value));

  var nodes = document.querySelectorAll("input, select, textarea");
  var groupKeys = [], groups = {};

  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (qfSkip(el)) continue;
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "text").toLowerCase();

    // 单选 / 多选：按 name 聚合，取选中的项
    if (type === "radio" || type === "checkbox") {
      if (!el.checked) continue;
      var gk = el.getAttribute("name") || ("__g" + i);
      if (!groups[gk]) {
        groups[gk] = { label: qfGroupLabelOf(el, i, map), picked: [] };
        groupKeys.push(gk);
      }
      var cv = qfChoiceText(el, map);
      if (cv && groups[gk].picked.indexOf(cv) === -1) groups[gk].picked.push(cv);
      continue;
    }

    var val = "";
    if (tag === "select") {
      var opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      val = opt ? (qfNorm(opt.textContent) || qfNorm(opt.value)) : "";
    } else {
      val = qfNorm(el.value);
    }
    if (!val) continue;
    put(qfLabelOf(el, i, map), val);
  }

  for (var m = 0; m < groupKeys.length; m++) {
    var g = groups[groupKeys[m]];
    if (g.picked.length) put(g.label, g.picked.join(" / "));
  }
  return out;
}

/** 刷新面板里的「观察数据」预览，让学生看得见会被记录什么 */
function qfRefreshAutoSummary() {
  try {
    var a = qfCollectAnswers(), keys = [], k;
    for (k in a) {
      if (Object.prototype.hasOwnProperty.call(a, k)) keys.push(k);
    }
    var cnt = document.getElementById("qf-auto-count");
    if (cnt) cnt.textContent = String(keys.length);
    var list = document.getElementById("qf-auto-list");
    if (list) {
      var html = "";
      for (var i = 0; i < keys.length; i++) {
        var v = String(a[keys[i]]);
        if (v.length > 60) v = v.slice(0, 60) + "…";
        html += "<li><b>" + qfEsc(keys[i]) + "</b>：" + qfEsc(v) + "</li>";
      }
      list.innerHTML = html || "<li class=\\"qf-empty\\">还没有可记录的内容，填写或调整页面上的选项后会自动出现。</li>";
    }
  } catch (e) { /* 采集异常不影响页面本身 */ }
}

if (!window.__QF_COLLECT_BOUND__) {
  window.__QF_COLLECT_BOUND__ = 1;
  (function () {
    function refresh() { qfRefreshAutoSummary(); }
    document.addEventListener("input", refresh, true);
    document.addEventListener("change", refresh, true);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { setTimeout(refresh, 50); });
    } else {
      setTimeout(refresh, 50);
    }
    // 页面可能延迟渲染控件（图表 / 滑块初始化），再补一次
    setTimeout(refresh, 1200);
  })();
}
`.trim();

/**
 * 移除采集块（按标记整块剥离）。重复调用安全。
 * 注入前先移除，保证「同一个页面多次注入」结果稳定。
 */
export function removeQfCollectBlock(html: string): string {
  let out = html;
  for (;;) {
    const begin = out.indexOf(QF_BLOCK_BEGIN);
    if (begin === -1) break;
    const end = out.indexOf(QF_BLOCK_END, begin);
    if (end === -1) {
      out = out.substring(0, begin);
      break;
    }
    out = out.substring(0, begin) + out.substring(end + QF_BLOCK_END.length);
  }
  return out;
}

/** 组装完整采集块（CSS + 面板 + 脚本，包在一对标记里） */
export function buildQfCollectBlock(): string {
  return (
    QF_BLOCK_BEGIN +
    "<style>" + qfCollectCSS + "</style>" +
    qfCollectPanelHTML +
    "<script>" + qfCollectScript + "</script>" +
    QF_BLOCK_END
  );
}

export interface SubmitContext {
  explorationId: string;
  taskTitle: string;
  studentName?: string;
  className?: string;
}

export interface InjectResult {
  success: boolean;
  warnings: string[];
  html: string;
}

/**
 * 注入提交功能到 HTML
 *
 * @param html 原始 HTML
 * @param context 上下文信息
 * @returns 改造后的 HTML 和警告信息
 */
export function injectSubmitFunctionality(html: string, context: SubmitContext): InjectResult {
  const warnings: string[] = [];
  let modified = html;

  // 检查 HTML 基本结构
  if (!modified.includes("<body") && !modified.includes("<BODY")) {
    warnings.push("HTML 缺少 <body> 标签，提交功能可能无法正常工作");
  }

  if (!modified.includes("<script") && !modified.includes("<SCRIPT")) {
    warnings.push("HTML 缺少 <script> 标签，追踪脚本将添加到页面底部");
  }

  // 1. 替换 HTML 中的唯一占位符（兼容旧 HTML 中使用这些占位符的情况）
  modified = modified.replace(/EXPLORATION_ID_PLACEHOLDER/g, (context.explorationId || ""));

  // 2. 检测冲突：原始 HTML 中的函数名与注入脚本的全局函数是否冲突
  // 如果已有追踪脚本（window.__explorationData__），说明是重复注入，不加后缀
  const injectedGlobalFn = ["submitResults", "updateScore", "completeSection", "setGameLevel", "addAttempt", "recordAction"];
  let suffix = "";
  if (!modified.includes("window.__explorationData__")) {
    for (const fn of injectedGlobalFn) {
      if (modified.includes("function " + fn)) {
        suffix = "_INJ";
        break;
      }
    }
  }

  // 3. 注入 CSS（如果未注入过提交功能）
  if (!modified.includes("quickclass-submit-root")) {
    if (modified.includes("</head>")) {
      modified = modified.replace("</head>", "<style>" + submitButtonCSS + "</style></head>");
    } else if (modified.includes("<body")) {
      modified = modified.replace(/<body[^>]*>/i, "<head><style>" + submitButtonCSS + "</style></head>$&");
    } else {
      modified = "<head><style>" + submitButtonCSS + "</style></head>" + modified;
      warnings.push("HTML 缺少 </head>，CSS 已添加到最前面");
    }
  }

  // 4. 检查是否已有追踪脚本（必须是赋值初始化，不能只看字符串匹配，
  //    否则 AI 伴学里的 `if (window.__explorationData__)` 读取会被误判为已初始化）
  const hasTracking = /window\.__explorationData__\s*=/.test(modified);
  if (!hasTracking) {
    var trackScript = basicTrackingScript;
      if (modified.includes("</body>")) {
        modified = modified.replace("</body>", "<script>" + trackScript + "</script></body>");
      } else {
        modified = modified + "<script>" + trackScript + "</script>";
        warnings.push("HTML 缺少 </body>，追踪脚本已添加到页面末尾");
    }
  }

  // 5. 检查是否已有提交函数（使用 postMessage 通信）
  var finalSubmitFn = suffix ? submitMessageScript.replace(/submitResults/g, "submitResults" + suffix) : submitMessageScript;
  if (!modified.includes("submitResults")) {
    if (modified.includes("</body>")) {
      modified = modified.replace("</body>", "<script>" + finalSubmitFn + "</script></body>");
    } else {
      modified = modified + "<script>" + finalSubmitFn + "</script>";
    }
  }

  // 6. 检查是否已有提交按钮（通过 root 包裹层判断）
  var finalBtnHtml = suffix ? submitButtonHTML.replace(/submitResults/g, "submitResults" + suffix) : submitButtonHTML;
  if (!modified.includes('<div id="quickclass-submit-root"')) {
    if (modified.includes("</body>")) {
      modified = modified.replace("</body>", finalBtnHtml + "</body>");
    } else {
      modified = modified + "<br/>" + finalBtnHtml;
      warnings.push("HTML 缺少 </body>，提交按钮已添加到页面末尾");
    }
  }

  // 7. QuickForm 采集块：先剥离旧的（幂等），再按当前页面重新注入。
  //    AI 每次重生成网页后重新注入 → 采集逻辑自动跟上，不会留下两套。
  modified = removeQfCollectBlock(modified);
  const qfBlock = buildQfCollectBlock();
  if (modified.includes("</body>")) {
    modified = modified.replace("</body>", qfBlock + "</body>");
  } else {
    modified = modified + qfBlock;
    warnings.push("HTML 缺少 </body>，QuickForm 采集面板已添加到页面末尾");
  }

  // 静态提示：页面本身没有可填控件时，学生只能靠通用面板填写
  if (!/<input|<select|<textarea/i.test(removeQfCollectBlock(html))) {
    warnings.push("页面中没有可填写的控件，学生仅能通过底部「探究记录」面板填写姓名与发现");
  }

  return {
    success: warnings.length === 0 || modified.includes("window.__explorationData__"),
    warnings,
    html: modified
  };
}

/**
 * 移除提交功能（禁用提交时调用）
 */
export function removeSubmitFunctionality(html: string): string {
  // QuickForm 采集块按标记整块剥离（含它的 style / script / 面板）
  let modified = removeQfCollectBlock(html);

  // 移除提交按钮包裹层（新版）或独立按钮（旧版兼容）
  const rootIdx = modified.indexOf('id="quickclass-submit-root"');
  if (rootIdx > -1) {
    let divStart = rootIdx;
    while (divStart > 0 && modified.substring(divStart, divStart + 4) !== '<div') divStart--;
    let depth = 0, endIdx = -1;
    for (let i = divStart; i < modified.length; i++) {
      if (modified.substring(i, i + 4) === '<div') depth++;
      if (modified.substring(i, i + 6) === '</div>') { depth--; if (depth === 0) { endIdx = i + 6; break; } }
    }
    if (endIdx > -1) modified = modified.substring(0, divStart) + modified.substring(endIdx);
  }
  modified = modified.replace(/<button[^>]*id=["']submitBtn["'][^>]*>.*?<\/button>/gi, "");

  // 移除提交按钮CSS（新版style标签 + 旧版单规则兼容）
  modified = modified.replace(/<style>\s*#quickclass-submit-root[\s\S]*?<\/style>/gi, "");
  modified = modified.replace(/#submitBtn\{[^}]*\}/g, "");

  // 移除提交函数 submitResults
  modified = modified.replace(/<script>[\s\S]*?function submitResults[\s\S]*?<\/script>/gi, "");

  // 移除基础追踪脚本
  modified = modified.replace(/<script>\s*\/\/ ===== 基础追踪脚本[\s\S]*?<\/script>/gi, "");

  return modified;
}

/**
 * AI 分析 HTML：识别交互元素、题目和正确答案
 */
export function aiPreviewPrompt(html: string): string {
  var prompt = "";
  prompt += "分析以下HTML，返回JSON格式(不要额外文字)：\n";
  prompt += "1. sections: 环节列表，每个环节是独立的游戏关卡/步骤。\n";
  prompt += '  - name: 名称(如 关卡1 第一步等)。\n';
  prompt += "  - type: 环节类型 practice|quiz|game。\n";
  prompt += "2. questions: 题目列表。\n";
  prompt += "3. interactiveElements: 可交互元素数组，每个元素必须是对象，且必须含以下两个字段：\n";
  prompt += '  - element: 元素名称或文本(如 「开始」按钮、姓名输入框)。\n';
  prompt += "  - description: 该元素的作用(如 点击开始游戏)。\n";
  prompt += "4. totalScore: 总分。\n";
  prompt += "5. summary: 总结。\n\nHTML内容:\n" + html.substring(0, 6000) + "\n\n";
  prompt += '输出格式: {"sections":[{"name":"关卡1","type":"practice"}],"questions":[],"interactiveElements":[{"element":"开始按钮","description":"点击开始"}],"totalScore":0,"summary":"共X个环节"}';
  return prompt;
}

/**
 * 根据 AI 分析结果生成自动评分追踪脚本
 */
export function generateAutoScoringScript(questions: Array<{
  id: string;
  type: string;
  question?: string;
  options?: Array<{ label: string; value: string; text: string }>;
  answer: string;
  score: number;
  selector: string;
}>, totalScore: number): string {
  const questionMap: Record<string, { answer: string; score: number; type: string; selector: string }> = {};
  for (const q of questions) {
    questionMap[q.id] = { answer: q.answer, score: q.score, type: q.type, selector: q.selector };
  }

  return "";
}
