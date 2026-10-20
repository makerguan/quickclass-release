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
// ===== 兜底采集函数（提交时调用，全部 ES5）=====

// canvas 作品快照：最多 3 张，缩放至 640px 宽，jpeg 0.7
function qfCollectCanvas() {
  var shots = [], cs = document.querySelectorAll("canvas");
  for (var i = 0; i < cs.length && shots.length < 3; i++) {
    try {
      var c = cs[i];
      if (!c.width || !c.height) continue;
      var s = Math.min(1, 640 / c.width);
      var t = document.createElement("canvas");
      t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
      t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
      shots.push(t.toDataURL("image/jpeg", 0.7));
    } catch (e) { /* 跨域污染的 canvas 跳过 */ }
  }
  return shots;
}

// localStorage 白名单快照：只读游戏相关前缀键，其余（含 token）一律不碰
function qfCollectStorage() {
  var out = {}, n = 0;
  try {
    for (var i = 0; i < localStorage.length && n < 20; i++) {
      var k = localStorage.key(i);
      if (k && /^(game|score|level|progress|state|quiz)/i.test(k)) {
        out[k] = String(localStorage.getItem(k) || "").slice(0, 200);
        n++;
      }
    }
  } catch (e) { /* 无 localStorage 权限时跳过 */ }
  return out;
}

// 文本快照：body.innerText 截断 10KB，万能回看兜底
function qfTextSnapshot() {
  try {
    return (document.body ? (document.body.innerText || "") : "").slice(0, 10000);
  } catch (e) { return ""; }
}

// ===== 行为流自动记录（capture 阶段，与 AI 主动的 recordAction 并存，上限 500 条）=====
if (!window.__ACTION_HOOK_BOUND__) {
  window.__ACTION_HOOK_BOUND__ = 1;
  (function () {
    function autoLog(type, target, value) {
      var d = window.__explorationData__;
      if (!d) return;
      if (!d.actionLog) d.actionLog = [];
      if (d.actionLog.length >= 500) return; // 上限截断
      d.actionLog.push({ type: type, target: target, value: value || "", timestamp: Date.now() });
    }
    function descOf(el) {
      var t = "";
      try {
        if (el && el.getAttribute) t = el.getAttribute("aria-label") || el.getAttribute("data-label") || "";
        if (!t && el && el.textContent) t = String(el.textContent).replace(/\\s+/g, " ").trim().slice(0, 30);
        if (!t && el && el.tagName) t = String(el.tagName).toLowerCase() + (el.id ? "#" + el.id : "");
      } catch (e) { t = "element"; }
      return t || "element";
    }
    document.addEventListener("click", function (e) {
      autoLog("auto:click", descOf(e.target), "");
    }, true);
    document.addEventListener("input", function (e) {
      var el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) {
        autoLog("auto:fill", descOf(el), String(el.value || "").slice(0, 50));
      }
    }, true);
    document.addEventListener("change", function (e) {
      autoLog("auto:change", descOf(e.target), "");
    }, true);
    document.addEventListener("dragstart", function (e) {
      autoLog("auto:drag", descOf(e.target), "开始拖动");
    }, true);
    document.addEventListener("drop", function (e) {
      autoLog("auto:drag", descOf(e.target), "放下");
    }, true);
  })();
}

// ===== 提交：双轨合并（__gameState__ 契约轨优先，__explorationData__ 函数调用轨兜底）=====
function submitResults() {
  var data = window.__explorationData__ || {};
  var gs = window.__gameState__ || {};
  // --- 采集配置：系统在注入时按「AI 分析 HTML 的采集类别」写入 ---
  //     hasScoring=false 不采分数（score 记 null）；hasFormControls=false 不扫描控件；hasCanvas=false 不采画布快照。
  //     默认值偏保守（hasScoring=true），兜底旧注入脚本无此配置时的行为。
  var profile = window.__COLLECT_PROFILE__ || { hasScoring: true, hasFormControls: true, hasCanvas: true };
  var answers = {};
  // 扫描页面原有控件（面板已移除）；无控件 / 配置关闭时跳过，不影响行为数据提交。
  if (profile.hasFormControls !== false) {
    try {
      if (typeof qfCollectAnswers === "function") answers = qfCollectAnswers() || {};
    } catch (e) { answers = {}; }
  }

  // --- score：hasScoring=false（纯探索/模拟页）时记 null，老师端按 collectProfile 隐藏分数维度 ---
  var finalScore = null;
  var inferred = false;
  if (profile.hasScoring !== false) {
    var gsScore = (typeof gs.score === "number" && gs.score > 0) ? gs.score : 0;
    var sysScore = (typeof data.score === "number" && data.score > 0) ? data.score : 0;
    finalScore = gsScore > 0 ? gsScore : sysScore;
  }

  // --- maxScore：AI 设计的真实满分优先（无评分页恒为 null）---
  var finalMaxScore = profile.hasScoring === false
    ? null
    : ((typeof gs.maxScore === "number" && gs.maxScore > 0) ? gs.maxScore : (data.maxScore || 100));

  // --- gameLevel：取较大值 ---
  var gsLevel = (typeof gs.gameLevel === "number" && gs.gameLevel >= 1) ? gs.gameLevel : 1;
  var sysLevel = (typeof data.gameLevel === "number" && data.gameLevel >= 1) ? data.gameLevel : 1;
  var finalLevel = Math.max(gsLevel, sysLevel);

  // --- completedSections：并集 ---
  var sections = [];
  var arr1 = Array.isArray(data.completedSections) ? data.completedSections : [];
  var arr2 = Array.isArray(gs.completedSections) ? gs.completedSections : [];
  for (var i = 0; i < arr1.length; i++) if (sections.indexOf(arr1[i]) === -1) sections.push(arr1[i]);
  for (var j = 0; j < arr2.length; j++) if (sections.indexOf(arr2[j]) === -1) sections.push(arr2[j]);

  // --- answers：QuickForm 扫描（标准控件）+ __gameState__.answers（自定义控件，同名覆盖）---
  if (gs.answers && typeof gs.answers === "object" && !Array.isArray(gs.answers)) {
    for (var k in gs.answers) {
      if (Object.prototype.hasOwnProperty.call(gs.answers, k)) answers[k] = gs.answers[k];
    }
  }

  // --- 兜底：分数正则（仅评分页且两轨都无分数时，从页面文本推测）---
  if (profile.hasScoring !== false && finalScore === 0) {
    try {
      var text = document.body ? (document.body.innerText || "") : "";
      var mScore = text.match(/(?:得分|分数|成绩|积分)\\s*[:：]?\\s*(\\d+)/g);
      if (mScore && mScore.length) {
        var lastS = mScore[mScore.length - 1].match(/(\\d+)/);
        if (lastS && parseInt(lastS[1], 10) > 0) { finalScore = parseInt(lastS[1], 10); inferred = true; }
      }
    } catch (e) { /* 文本推测失败不影响提交 */ }
  }
  // --- 兜底：关卡正则（通用，无评分页也可能有关卡）---
  try {
    var bodyText = document.body ? (document.body.innerText || "") : "";
    var mLevel = bodyText.match(/第\\s*(\\d+)\\s*关/g);
    if (mLevel && mLevel.length) {
      var lastL = mLevel[mLevel.length - 1].match(/(\\d+)/);
      if (lastL) finalLevel = Math.max(finalLevel, parseInt(lastL[1], 10) || 1);
    }
  } catch (e) { /* 文本推测失败不影响提交 */ }
  // 评分页但最终未采到分数（两轨+正则都无）→ 记 null，与「无评分页」一致，避免老师端误读为"0分"
  if (profile.hasScoring !== false && finalScore === 0) finalScore = null;

  // --- 兜底：canvas 快照 / localStorage 白名单 / 文本快照（canvas 按采集配置裁剪）---
  var canvasSnapshots = [];
  if (profile.hasCanvas !== false) {
    try { if (typeof qfCollectCanvas === "function") canvasSnapshots = qfCollectCanvas(); } catch (e) {}
  }
  var storageSnapshot = {};
  try { if (typeof qfCollectStorage === "function") storageSnapshot = qfCollectStorage(); } catch (e) {}
  var textSnapshot = "";
  try { if (typeof qfTextSnapshot === "function") textSnapshot = qfTextSnapshot(); } catch (e) {}

  window.parent.postMessage({
    type: "EXPLORATION_SUBMIT",
    payload: {
      timeSpent: data.timeSpent || 0,
      interactions: data.interactions || 0,
      scrollDepth: data.scrollDepth || 0,
      attempts: data.attempts || 1,
      score: finalScore,
      maxScore: finalMaxScore,
      completedSections: sections,
      gameLevel: finalLevel,
      actionLog: data.actionLog || [],
      answers: answers,
      // 契约轨明细（教师端展示用）
      gameState: gs,
      scoreInferred: inferred,
      // 兜底采集
      canvasSnapshots: canvasSnapshots,
      storageSnapshot: storageSnapshot,
      textSnapshot: textSnapshot
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
// 全部采用「防御式定义」：页面脚本若已定义同名全局函数则跳过，
// 避免注入覆盖页面自有逻辑（如旧系统的滑杆/游戏交互），破坏页面交互效果。

// 更新得分
if (typeof window.updateScore !== "function") {
  window.updateScore = function(score) {
    if (window.__explorationData__) {
      var d = window.__explorationData__;
      if (typeof score === "number" && score >= 0) {
        // 分数超过当前满分时自动提升满分（兼容非百分制游戏，如 300 分制）
        if (score > d.maxScore) d.maxScore = score;
        d.score = Math.max(0, Math.min(score, d.maxScore));
      }
    }
  };
}

// 完成环节
if (typeof window.completeSection !== "function") {
  window.completeSection = function(name) {
    if (window.__explorationData__ && name) {
      var sections = window.__explorationData__.completedSections;
      if (sections.indexOf(name) === -1) {
        sections.push(name);
      }
    }
  };
}

// 设置游戏级别
if (typeof window.setGameLevel !== "function") {
  window.setGameLevel = function(level) {
    if (window.__explorationData__ && level) {
      window.__explorationData__.gameLevel = Math.max(1, level);
    }
  };
}

// 增加尝试次数
if (typeof window.addAttempt !== "function") {
  window.addAttempt = function() {
    if (window.__explorationData__) {
      window.__explorationData__.attempts++;
    }
  };
}

/**
 * 记录交互操作明细
 * @param {string} type  - 交互类型：select(选择) | fill(填写) | drag(拖动) | click(点击) | input(输入) | match(配对) | sort(排序)
 * @param {string} target - 操作的元素描述，如"第1题选项B"、"填空框2"
 * @param {string} value  - 用户操作的值内容，如"B"、"3.14"、"正确"
 */
if (typeof window.recordAction !== "function") {
  window.recordAction = function(type, target, value) {
    if (window.__explorationData__ && type && target) {
      window.__explorationData__.actionLog.push({
        type: type,
        target: target,
        value: value || "",
        timestamp: Date.now()
      });
      window.__explorationData__.interactions++;
    }
  };
}
`.trim();

/**
 * 提交按钮 HTML
 */
export const submitButtonHTML = `<div id="quickclass-submit-root"><button id="submitBtn" onclick="submitResults()">提交</button></div>`;

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

export const qfCollectScript = `
// ===== QuickForm 探究记录采集（自动扫描 + 通用面板）=====
// 全部用 ES5 写法：这段脚本直接注入 HTML 运行，不经过任何编译
function qfNorm(s) {
  return String(s == null ? "" : s).replace(/\\s+/g, " ").trim();
}

/** 跳过：隐藏/按钮/滑块类控件、禁用控件、显式标记、以及我们自己的提交按钮。
 *  ⛔ range 必须跳过：滑块是实验/交互的中间状态，不是学生登记的答案；
 *  自定义控件的数值走 __gameState__.answers 契约轨，扫滑块只会采到"停在最后一格"的假答案。 */
function qfSkip(el) {
  var tag = el.tagName.toLowerCase();
  var type = (el.getAttribute("type") || "text").toLowerCase();
  if (tag === "input") {
    if (type === "hidden" || type === "submit" || type === "button" ||
        type === "reset" || type === "image" || type === "file" || type === "password" ||
        type === "range") return true;
  }
  if (el.disabled) return true;
  if (el.getAttribute("data-qf-skip") !== null) return true;
  if (el.closest && el.closest("#quickclass-submit-root")) return true;
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

  // 只扫描页面原有控件（「探究记录」面板已按产品要求移除，不再兜底注入固定姓名/发现字段）
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

/** 组装采集块（只注入「扫描原有控件」脚本，包在一对标记里）。
 *  ⛔ DO NOT REVERT：「探究记录」面板（姓名+我的发现）已按产品要求移除——它会把整块 UI
 *  硬塞进页面底部，改变原始 HTML 外观与滚动高度。答案只靠扫描页面原有控件 + AI 上报的
 *  __gameState__.answers，页面无控件时只采行为数据。 */
export function buildQfCollectBlock(): string {
  return (
    QF_BLOCK_BEGIN +
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
 * 桩检测：判断 HTML 是否已接入提交采集（契约轨）
 * 用于「AI 接入改造」按钮的显示逻辑——已有桩则无需改造
 */
export function detectInstrumentation(html: string): {
  hasGameState: boolean; // AI 契约桩：window.__gameState__ 初始化
  hasGuardedCalls: boolean; // 防御式调用：typeof updateScore 等
  hasTracking: boolean; // 系统桩：window.__explorationData__ 初始化
  needsAdaptation: boolean; // 是否建议 AI 接入改造
} {
  const hasGameState = /window\.__gameState__\s*=/.test(html);
  const hasGuardedCalls =
    /typeof\s+(updateScore|completeSection|setGameLevel|recordAction)\s*===?\s*["']function["']/.test(html);
  const hasTracking = /window\.__explorationData__\s*=/.test(html);
  return {
    hasGameState,
    hasGuardedCalls,
    hasTracking,
    // 只有系统桩（函数定义在但无人调用）不算已接入——正是"0 分/无关卡"的形态
    needsAdaptation: !hasGameState && !hasGuardedCalls,
  };
}

/**
 * 注入提交功能到 HTML
 *
 * @param html 原始 HTML（注入前的原始 / 契约桩改造后 HTML）
 * @param context 上下文信息
 * @param profile 采集类别清单（AI 分析 HTML 得出），决定注入哪些采集逻辑。
 *                缺省时按保守默认（hasScoring=true）注入，兼容旧调用方。
 * @returns 改造后的 HTML 和警告信息
 */
export function injectSubmitFunctionality(
  html: string,
  context: SubmitContext,
  profile?: { hasScoring?: boolean; hasFormControls?: boolean; hasCanvas?: boolean }
): InjectResult {
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

  // 2.5 裸调用检测：AI 生成的页面若未防御直接调用注入函数，
  //     页面脚本先于注入脚本执行时会 ReferenceError 中断整个页面。
  //     排除：typeof 防御处、函数定义处、方法调用（obj.updateScore）；
  //     调用点前 120 字符内出现同函数名的 typeof 检查视为防御式，跳过。
  const bareCallRe = /(?<!typeof\s)(?<!function\s)(?<!\.)\b(updateScore|setGameLevel|completeSection|addAttempt|recordAction)\s*\(/g;
  let bareMatch: RegExpExecArray | null;
  let hasBareCall = false;
  while ((bareMatch = bareCallRe.exec(modified)) !== null) {
    const fnName = bareMatch[1];
    // 页面自定义了同名函数 → 页面内调用的是自己的函数（注入侧已走 _INJ 后缀改名），不告警
    if (modified.includes("function " + fnName)) continue;
    const before = modified.slice(Math.max(0, bareMatch.index - 120), bareMatch.index);
    if (new RegExp(`typeof\\s+${fnName}\\b`).test(before)) continue; // 防御式调用
    hasBareCall = true;
    break;
  }
  if (hasBareCall) {
    warnings.push("检测到未防御的上报函数裸调用，页面脚本可能在注入前执行而报错，建议让 AI 修正为 typeof 防御式调用");
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

  // 4.5 注入采集类别配置（AI 分析 HTML 的结果）。submitResults 运行时读取
  //     window.__COLLECT_PROFILE__ 决定是否采分数 / 控件答案 / 画布快照。
  //     未传 profile 时注入保守默认，保证与旧逻辑一致（都采）。
  const hasScoring = profile?.hasScoring !== false;
  const hasFormControls = profile?.hasFormControls !== false;
  const hasCanvas = profile?.hasCanvas !== false;
  const profileScript = "window.__COLLECT_PROFILE__ = " + JSON.stringify({ hasScoring, hasFormControls, hasCanvas }) + ";";
  if (modified.includes("</body>")) {
    modified = modified.replace("</body>", "<script>" + profileScript + "</script></body>");
  } else {
    modified = modified + "<script>" + profileScript + "</script>";
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

  // 静态提示：页面没有标准控件时，结构化答案只能靠 AI 契约轨（__gameState__.answers）上报
  if (!/<input|<select|<textarea/i.test(removeQfCollectBlock(html))) {
    warnings.push("页面中没有可填写的控件，结构化答案将依赖 AI 自动上报（页面本身不上报则为空）");
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

  // 移除采集类别配置脚本（injectSubmitFunctionality 第 4.5 步注入），
  // 保证 removeSubmitFunctionality 能完整还原到「注入前」状态，供采集类别分析复用。
  modified = modified.replace(/<script>\s*window\.__COLLECT_PROFILE__\s*=[\s\S]*?<\/script>/gi, "");

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
