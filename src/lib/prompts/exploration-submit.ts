/**
 * 互动探究 - 提交功能注入提示词配置
 * 当启用提交时，系统会用这些提示词改造 HTML，注入提交功能
 */

/**
 * 提交按钮 CSS 样式
 */
export const submitButtonCSS = `
#submitBtn {
  position: fixed;
  bottom: 30px;
  right: 30px;
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
#submitBtn:hover { background: #C44050; }
#submitBtn:disabled { background: #ccc; cursor: not-allowed; }
`.trim();

export const submitMessageScript = `
function submitResults() {
  var data = window.__explorationData__ || {};
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
      actionLog: data.actionLog || []
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
export const submitButtonHTML = `<button id="submitBtn" onclick="submitResults()">提交</button>`;
// ===== 提交 =====
async function submitResults() {
  if (!confirm("确认提交？提交后将无法修改。")) return;

  var btn = document.getElementById("submitBtn");
  if (btn) { btn.innerHTML = "提交中..."; btn.disabled = true; }

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
      if (btn) { btn.innerHTML = "重新提交"; btn.disabled = false; }
    }
  } catch (e) {
    alert("提交失败：" + e.message);
    if (btn) { btn.innerHTML = "重新提交"; btn.disabled = false; }
  }
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

  // 3. 注入 CSS（如果没有 submitBtn 相关样式）
  if (!modified.includes("#submitBtn") && !modified.includes("submitBtn")) {
    if (modified.includes("</head>")) {
      modified = modified.replace("</head>", "<style>" + submitButtonCSS + "</style></head>");
    } else if (modified.includes("<body")) {
      modified = modified.replace(/<body[^>]*>/i, "<head><style>" + submitButtonCSS + "</style></head>$&");
    } else {
      modified = "<head><style>" + submitButtonCSS + "</style></head>" + modified;
      warnings.push("HTML 缺少 </head>，CSS 已添加到最前面");
    }
  }

  // 4. 检查是否已有追踪脚本
  const hasTracking = modified.includes("window.__explorationData__");
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

  // 6. 检查是否已有提交按钮
  var finalBtnHtml = suffix ? submitButtonHTML.replace(/submitResults/g, "submitResults" + suffix) : submitButtonHTML;
  if (!modified.includes('id="submitBtn"') && !modified.includes("id='submitBtn'")) {
    if (modified.includes("</body>")) {
      modified = modified.replace("</body>", finalBtnHtml + "</body>");
    } else {
      modified = modified + "<br/>" + finalBtnHtml;
      warnings.push("HTML 缺少 </body>，提交按钮已添加到页面末尾");
    }
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
  let modified = html;

  // 移除提交按钮
  modified = modified.replace(/<button[^>]*id=["']submitBtn["'][^>]*>.*?<\/button>/gi, "");

  // 移除 CSS（只移除 submitBtn 相关的）
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
  prompt += "3. interactiveElements: 可交互元素。\n";
  prompt += "4. totalScore: 总分。\n";
  prompt += "5. summary: 总结。\n\nHTML内容:\n" + html.substring(0, 6000) + "\n\n";
  prompt += '输出格式: {"sections":[{"name":"关卡1","type":"practice"}],"questions":[],"totalScore":0,"summary":"共X个环节"}';
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
