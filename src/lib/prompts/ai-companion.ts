/**
* 互动探究 - AI伴学功能注入配置
* 当教师启用AI伴学时，系统会：
* 1. 注入浮动对话框到HTML
* 2. 调用AI分析HTML生成伴学语义提示词
* 3. 学生提问时使用预生成提示词+实时上下文
*/

import * as fs from "fs";
import * as path from "path";

/**
 * 读取 katex UMD bundle 与 CSS（SSR 端，从 node_modules 读取）
 * AI 伴学对话框在 iframe 内运行，需要把 katex 库注入到 iframe 中
 * 才能渲染 AI 回复中的数学公式（$..$ 和 $$..$$）
 *
 * 如果读取失败（例如打包后的环境无 node_modules），降级为纯文本，
 * AI 回复中的 $ 符号会保留为原文（虽然不渲染但不会报错）
 */
function loadKatexAssets(): { js: string; css: string; available: boolean } {
  try {
    const katexDir = path.join(process.cwd(), "node_modules", "katex", "dist");
    const js = fs.readFileSync(path.join(katexDir, "katex.min.js"), "utf-8");
    const cssSource = fs.readFileSync(path.join(katexDir, "katex.min.css"), "utf-8");
    // srcDoc 中的相对 fonts/ 路径会解析为 /student/fonts/ 并产生 404，改为同源字体接口
    const css = cssSource.replace(
      /url\(fonts\/([^)]+)\)/g,
      (_match, fontFile: string) => `url("/api/katex-fonts/${fontFile}")`
    );
    return { js, css, available: true };
  } catch (e) {
    // 静默失败：不影响主流程，仅 math 渲染降级
    return { js: "", css: "", available: false };
  }
}

// 模块加载时执行一次（Next.js 路由在 Node.js 环境中运行）
const katexAssets = loadKatexAssets();

export const AI_COMPANION_VERSION = "math-renderer-v4";

/**
* AI伴学浮动对话框CSS样式
* 所有样式限定在 #ai-companion-root 内，避免与页面CSS冲突
*/
export const aiCompanionCSS = `
#ai-companion-root * { box-sizing: border-box; margin: 0; padding: 0; }
#ai-companion-root {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

/* 浮动按钮（收起状态） */
#ai-companion-trigger {
  position: fixed; bottom: 30px; right: 80px;
  width: 52px; height: 52px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white; border: none; border-radius: 50%;
  cursor: pointer; z-index: 10001;
  box-shadow: 0 4px 15px rgba(102,126,234,0.4);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; transition: transform 0.2s, box-shadow 0.2s;
}
#ai-companion-trigger:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(102,126,234,0.6); }
#ai-companion-trigger .pulse {
  position: absolute; width: 100%; height: 100%; border-radius: 50%;
  background: rgba(102,126,234,0.3); animation: aiPulse 2s infinite;
}
@keyframes aiPulse { 0%{transform:scale(1);opacity:1} 100%{transform:scale(1.8);opacity:0} }

/* 对话框（展开状态） */
#ai-companion-panel {
  position: fixed; bottom: 30px; right: 80px;
  width: 380px; height: 500px;
  background: white; border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
  z-index: 10001; display: none; flex-direction: column;
  overflow: hidden; border: 1px solid #e5e7eb;
}
#ai-companion-panel.open { display: flex; }

/* 头部 */
#ac-header {
  padding: 14px 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white; display: flex; align-items: center; justify-content: space-between;
}
#ac-header .title { font-size: 14px; font-weight: 600; }
#ac-header .actions { display: flex; gap: 4px; align-items: center; }
#ac-clear, #ac-close { background: none; border: none; color: white; cursor: pointer; font-size: 14px; padding: 4px 8px; line-height: 1; opacity: 0.85; }
#ac-clear:hover, #ac-close:hover { opacity: 1; background: rgba(255,255,255,0.15); border-radius: 4px; }

/* 消息区 */
#ac-messages {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 10px;
  background: #fafafa;
}
#ac-messages::-webkit-scrollbar { width: 4px; }
#ac-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

.ac-msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.ac-msg.user { align-self: flex-end; background: #667eea; color: white; border-bottom-right-radius: 4px; }
.ac-msg.assistant { align-self: flex-start; background: white; color: #1f2937; border-bottom-left-radius: 4px; border: 1px solid #e5e7eb; }
.ac-msg.assistant code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.ac-msg.error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

/* 输入区 */
#ac-input-area {
  padding: 12px 16px; border-top: 1px solid #e5e7eb;
  display: flex; gap: 8px; align-items: flex-end;
  background: white;
}
#ac-input {
  flex: 1; border: 1px solid #d1d5db; border-radius: 20px;
  padding: 8px 14px; font-size: 13px; outline: none;
  resize: none; min-height: 36px; max-height: 80px;
  font-family: inherit; line-height: 1.4;
}
#ac-input:focus { border-color: #667eea; }
#ac-send {
  width: 36px; height: 36px; border-radius: 50%;
  background: #667eea; color: white; border: none;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0; transition: background 0.2s;
}
#ac-send:hover:not(:disabled) { background: #5568d3; }
#ac-send:disabled { background: #d1d5db; cursor: not-allowed; }

/* 欢迎提示 */
#ac-welcome { text-align: center; padding: 30px 20px; color: #9ca3af; }
#ac-welcome .icon { font-size: 32px; margin-bottom: 8px; }
#ac-welcome .text { font-size: 13px; line-height: 1.8; }

/* 打字指示器 */
.ac-typing { display: inline-flex; gap: 3px; padding: 4px 0; }
.ac-typing span { width: 6px; height: 6px; background: #9ca3af; border-radius: 50%; animation: acTyping 1.2s infinite; }
.ac-typing span:nth-child(2) { animation-delay: 0.2s; }
.ac-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes acTyping { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }

/* Markdown 渲染样式（AI 回复） */
.ac-msg p { margin: 0 0 6px 0; }
.ac-msg p:last-child { margin-bottom: 0; }
.ac-msg strong { font-weight: 600; }
.ac-msg em { font-style: italic; }
.ac-msg code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.ac-msg pre { background: #1f2937; color: #f9fafb; padding: 8px 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.5; margin: 4px 0; }
.ac-msg pre code { background: transparent; padding: 0; color: inherit; font-size: inherit; }
.ac-msg ul, .ac-msg ol { margin: 4px 0 4px 18px; padding: 0; }
.ac-msg li { margin: 2px 0; }
.ac-msg a { color: #667eea; text-decoration: underline; }

/* 公式容器样式 */
.ac-math-inline { display: inline-block; vertical-align: middle; }
.ac-math-block { display: block; text-align: center; margin: 6px 0; }
`.trim();

/**
 * AI伴学浮动对话框HTML
 */
export const aiCompanionHTML = `
<!-- AI伴学浮动按钮 -->
<button id="ai-companion-trigger" title="AI伴学助手" style="display:flex">
  <span class="pulse"></span>
  🤖
</button>

<!-- AI伴学对话框 -->
<div id="ai-companion-panel" role="dialog" aria-label="AI伴学助手">
  <div id="ac-header">
    <span class="title">🤖 AI伴学助手</span>
    <div class="actions">
      <button id="ac-clear" title="清空对话" aria-label="清空对话">🗑</button>
      <button id="ac-close" title="关闭" aria-label="关闭">✕</button>
    </div>
  </div>
  <div id="ac-messages">
    <div id="ac-welcome">
      <div class="icon">🤖</div>
      <div class="text">你好！我是你的AI学习伙伴<br/>遇到问题随时问我哦</div>
    </div>
  </div>
  <div id="ac-input-area">
    <textarea id="ac-input" rows="1" placeholder="输入你的问题..." maxlength="500"></textarea>
    <button id="ac-send" aria-label="发送">➤</button>
  </div>
</div>
`.trim();

/**
 * AI伴学交互脚本
 * - 流式期间用纯 textContent 累加（保留打字效果）
 * - 流结束 / 历史加载时调用 renderMarkdownToElement 渲染 Markdown + KaTeX 数学公式
 * - 所有非数学内容用 DOM API 创建节点（textContent 安全），杜绝 XSS
 */
export const aiCompanionScript = String.raw`
(function() {
  if (window.__AI_COMPANION_INJECTED__) return;
  window.__AI_COMPANION_INJECTED__ = true;
  window.__AI_COMPANION_VERSION__ = '${AI_COMPANION_VERSION}';

  var trigger = document.getElementById('ai-companion-trigger');
  var panel = document.getElementById('ai-companion-panel');
  var closeBtn = document.getElementById('ac-close');
  var clearBtn = document.getElementById('ac-clear');
  var messagesDiv = document.getElementById('ac-messages');
  var inputArea = document.getElementById('ac-input');
  var sendBtn = document.getElementById('ac-send');
  var welcomeDiv = document.getElementById('ac-welcome');

  var chatHistory = [];
  var isStreaming = false;
  var historyLoaded = false;

  // ========================= Markdown + Math 渲染器 =========================
  // XSS 防护：所有用户/AI 文本通过 textContent / createElement 注入；
  // 只有 katex.renderToString 的输出（已由 katex 内部转义）才用 innerHTML。

  function renderKatex(mathStr, displayMode) {
    var wrapper = document.createElement(displayMode ? 'div' : 'span');
    wrapper.className = displayMode ? 'ac-math-block' : 'ac-math-inline';
    try {
      if (window.katex && typeof window.katex.renderToString === 'function') {
        // katex 内部已经做了 HTML 转义，输出是安全的
        wrapper.innerHTML = window.katex.renderToString(mathStr, {
          displayMode: !!displayMode,
          throwOnError: false,
          strict: false,
          output: 'html'
        });
      } else {
        // 降级：katex 未加载时保留原文本（直接显示 $..$ 或 $$..$$）
        wrapper.textContent = (displayMode ? '$$' : '$') + mathStr + (displayMode ? '$$' : '$');
      }
    } catch (e) {
      wrapper.textContent = (displayMode ? '$$' : '$') + mathStr + (displayMode ? '$$' : '$');
    }
    return wrapper;
  }

  // 行内解析：$..$、$$..$$、\u0060code\u0060、**bold**、*italic*
  // 递归处理嵌套（如 **bold with $math$ inside**）
  function renderInline(parent, text) {
    var s = String(text == null ? '' : text);
    var i = 0;
    var buf = '';

    function flushText() {
      if (buf.length > 0) {
        parent.appendChild(document.createTextNode(buf));
        buf = '';
      }
    }

    while (i < s.length) {
      var ch = s.charAt(i);
      var nx = s.charAt(i + 1);

      // 块公式 $$...$$ （同一行内允许）
      if (ch === '$' && nx === '$') {
        var endB = s.indexOf('$$', i + 2);
        if (endB > i + 1) {
          flushText();
          parent.appendChild(renderKatex(s.substring(i + 2, endB), true));
          i = endB + 2;
          continue;
        }
      }

      // 行内公式 $...$
      if (ch === '$') {
        var endI = s.indexOf('$', i + 1);
        if (endI > i) {
          var inner = s.substring(i + 1, endI);
          // 公式内容不允许跨换行（katex 渲染失败时降级）
          if (inner.indexOf('\n') === -1 && inner.trim().length > 0) {
            flushText();
            parent.appendChild(renderKatex(inner, false));
            i = endI + 1;
            continue;
          }
        }
      }

      // 行内代码 \u0060...\u0060
      if (ch === '\u0060') {
        var endC = s.indexOf('\u0060', i + 1);
        if (endC > i) {
          flushText();
          var codeEl = document.createElement('code');
          codeEl.textContent = s.substring(i + 1, endC);
          parent.appendChild(codeEl);
          i = endC + 1;
          continue;
        }
      }

      // 粗体 **...**
      if (ch === '*' && nx === '*') {
        var endBd = s.indexOf('**', i + 2);
        if (endBd > i + 1) {
          flushText();
          var boldEl = document.createElement('strong');
          renderInline(boldEl, s.substring(i + 2, endBd));
          parent.appendChild(boldEl);
          i = endBd + 2;
          continue;
        }
      }

      // 斜体 *...*（避免误匹配 **，上面已优先匹配粗体）
      if (ch === '*' && nx !== '*') {
        var endIt = s.indexOf('*', i + 1);
        if (endIt > i && s.charAt(endIt + 1) !== '*') {
          flushText();
          var emEl = document.createElement('em');
          renderInline(emEl, s.substring(i + 1, endIt));
          parent.appendChild(emEl);
          i = endIt + 1;
          continue;
        }
      }

      // 普通字符累积
      buf += ch;
      i++;
    }
    flushText();
  }

  // 完整渲染：把 Markdown 文本渲染到 root 元素（覆盖原内容）
  // 支持：段落（双换行）、单换行（<br>）、行内 token
  function renderMarkdownToElement(root, text) {
    // 清空 root
    while (root.firstChild) root.removeChild(root.firstChild);
    if (!text) return;

    var lines = String(text).split('\n');
    var paraBuf = [];
    var listMode = null; // 'ul' | 'ol' | null
    var listEl = null;
    var listIndex = 0;

    function flushParagraph() {
      if (paraBuf.length === 0) return;
      var p = document.createElement('p');
      renderInline(p, paraBuf.join('\n'));
      // 如果段落是空字符串（连续换行），跳过
      if (p.textContent.replace(/\s/g, '').length === 0 && p.querySelector('.ac-math-inline, .ac-math-block') === null) {
        return;
      }
      if (listMode && listEl) {
        // 段落嵌入列表：把段落作为列表项内容
        var li = document.createElement('li');
        // 移动 p 的子节点到 li
        while (p.firstChild) li.appendChild(p.firstChild);
        listEl.appendChild(li);
      } else {
        root.appendChild(p);
      }
      paraBuf = [];
    }

    function flushList() {
      if (listEl) {
        root.appendChild(listEl);
        listEl = null;
        listMode = null;
        listIndex = 0;
      }
    }

    for (var li2 = 0; li2 < lines.length; li2++) {
      var line = lines[li2];
      var ulm = /^\s*[-*+]\s+(.*)$/.exec(line);
      var olm = /^\s*(\d+)\.\s+(.*)$/.exec(line);

      if (ulm) {
        if (listMode !== 'ul') {
          flushParagraph();
          flushList();
          listMode = 'ul';
          listEl = document.createElement('ul');
          listIndex = 0;
        }
        var liU = document.createElement('li');
        renderInline(liU, ulm[1]);
        listEl.appendChild(liU);
        continue;
      }
      if (olm) {
        if (listMode !== 'ol') {
          flushParagraph();
          flushList();
          listMode = 'ol';
          listEl = document.createElement('ol');
          listIndex = parseInt(olm[1], 10) || 1;
        }
        var liO = document.createElement('li');
        renderInline(liO, olm[2]);
        listEl.appendChild(liO);
        continue;
      }

      // 非列表行：结束列表模式
      if (listMode) {
        flushParagraph();
        flushList();
      }

      // 空行：段落分隔
      if (line.trim() === '') {
        flushParagraph();
        continue;
      }
      paraBuf.push(line);
    }
    flushParagraph();
    flushList();
  }

  // 通知父窗口：iframe已就绪，请求加载历史
  function requestHistory() {
    window.parent.postMessage({
      type: 'AI_COMPANION_READY',
      explorationId: window.__EXPLORATION_ID__ || ''
    }, '*');
  }

  // 渲染历史消息
  function renderHistory(messages) {
    if (!messages || messages.length === 0) return;
    if (welcomeDiv) welcomeDiv.style.display = 'none';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m && m.role && m.content) {
        appendMessage(m.role, m.content, false);
        chatHistory.push({ role: m.role, content: m.content });
      }
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // 清空当前显示（保留chatHistory不变，由父窗口决定是否真清空数据库）
  function clearLocalDisplay() {
    while (messagesDiv.firstChild) {
      messagesDiv.removeChild(messagesDiv.firstChild);
    }
    if (welcomeDiv) {
      welcomeDiv.style.display = 'block';
      messagesDiv.appendChild(welcomeDiv);
    }
  }

  trigger.addEventListener('click', function() {
    panel.classList.add('open');
    trigger.style.display = 'none';
    inputArea.focus();
  });

  closeBtn.addEventListener('click', function() {
    panel.classList.remove('open');
    trigger.style.display = 'flex';
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      if (isStreaming) {
        if (!confirm('AI正在回复中，确定要清空对话吗？')) return;
      } else {
        if (!confirm('确定要清空所有对话历史吗？此操作不可恢复。')) return;
      }
      window.parent.postMessage({
        type: 'AI_COMPANION_CLEAR',
        explorationId: window.__EXPLORATION_ID__ || ''
      }, '*');
    });
  }

  inputArea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

  function sendMessage() {
    var text = inputArea.value.trim();
    if (!text || isStreaming) return;

    if (welcomeDiv) welcomeDiv.style.display = 'none';

    appendMessage('user', text, true);
    chatHistory.push({ role: 'user', content: text });

    var ctx = collectContext();

    window.parent.postMessage({
      type: 'AI_COMPANION_ASK',
      explorationId: window.__EXPLORATION_ID__ || '',
      message: text,
      chatHistory: chatHistory,
      context: ctx
    }, '*');

    inputArea.value = '';
    inputArea.style.height = 'auto';
    isStreaming = true;
    sendBtn.disabled = true;

    // 添加打字指示器
    var typingDiv = document.createElement('div');
    typingDiv.className = 'ac-msg assistant';
    typingDiv.id = 'ac-typing-indicator';
    typingDiv.innerHTML = '<div class="ac-typing"><span></span><span></span><span></span></div>';
    messagesDiv.appendChild(typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function collectContext() {
    var ctx = {};
    try {
      var scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      ctx.scrollPercent = scrollHeight > 0 ? Math.round((window.scrollY / scrollHeight) * 100) : 0;

      var headings = document.querySelectorAll('h1, h2, h3');
      var visibleHeadings = [];
      headings.forEach(function(h) {
        var rect = h.getBoundingClientRect();
        if (rect.top >= 0 && rect.top <= window.innerHeight && h.textContent.trim()) {
          visibleHeadings.push(h.textContent.trim());
        }
      });
      if (visibleHeadings.length > 0) ctx.visibleHeadings = visibleHeadings;

      if (window.__explorationData__) {
        ctx.score = window.__explorationData__.score;
        ctx.completedSections = window.__explorationData__.completedSections;
        ctx.gameLevel = window.__explorationData__.gameLevel;
        ctx.interactions = window.__explorationData__.interactions;
      }

      var activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        ctx.focusedElement = activeEl.getAttribute('placeholder') || activeEl.getAttribute('name') || activeEl.tagName.toLowerCase();
      }
    } catch (e) {}
    return ctx;
  }

  // 创建一条消息 div 并渲染 Markdown + Math
  function appendMessage(role, content, animateScroll) {
    var div = document.createElement('div');
    div.className = 'ac-msg ' + role;
    // 流式占位消息（空内容）不需要渲染
    if (role === 'assistant' && !content && animateScroll !== false) {
      div.id = 'ac-streaming-msg';
      // 初始化为空文本节点，后续 chunk 用 textContent 累加
      div.appendChild(document.createTextNode(''));
    } else {
      renderMarkdownToElement(div, content || '');
    }
    messagesDiv.appendChild(div);
    if (animateScroll !== false) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    return div;
  }

  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'AI_COMPANION_HISTORY') {
      historyLoaded = true;
      if (e.data.messages && e.data.messages.length > 0) {
        renderHistory(e.data.messages);
      }
      return;
    }

    if (e.data.type === 'AI_COMPANION_CLEARED') {
      chatHistory = [];
      clearLocalDisplay();
      return;
    }

    if (e.data.type === 'AI_COMPANION_CHUNK') {
      var typingEl = document.getElementById('ac-typing-indicator');
      if (typingEl) typingEl.remove();
      var streamMsg = document.getElementById('ac-streaming-msg');
      if (!streamMsg) {
        streamMsg = appendMessage('assistant', '', true);
      }
      // 流式期间用纯 textContent 累加（保留打字效果）
      streamMsg.textContent += e.data.chunk;
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    if (e.data.type === 'AI_COMPANION_DONE') {
      var typingEl2 = document.getElementById('ac-typing-indicator');
      if (typingEl2) typingEl2.remove();
      var doneMsg = document.getElementById('ac-streaming-msg');
      if (doneMsg) {
        var finalContent = doneMsg.textContent;
        doneMsg.removeAttribute('id');
        // 流结束后一次性渲染 Markdown + Math
        renderMarkdownToElement(doneMsg, finalContent);
        chatHistory.push({ role: 'assistant', content: finalContent });
      }
      isStreaming = false;
      sendBtn.disabled = false;
    }

    if (e.data.type === 'AI_COMPANION_ERROR') {
      var typingEl3 = document.getElementById('ac-typing-indicator');
      if (typingEl3) typingEl3.remove();
      var errMsg = document.getElementById('ac-streaming-msg');
      if (errMsg) {
        errMsg.removeAttribute('id');
        errMsg.className = 'ac-msg error';
        errMsg.textContent = '抱歉，出了点问题：' + (e.data.error || '未知错误');
      } else {
        var errDiv = document.createElement('div');
        errDiv.className = 'ac-msg error';
        errDiv.textContent = '抱歉，出了点问题：' + (e.data.error || '未知错误');
        messagesDiv.appendChild(errDiv);
      }
      isStreaming = false;
      sendBtn.disabled = false;
    }
  });

  sendBtn.addEventListener('click', sendMessage);
  inputArea.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  if (document.readyState === 'complete') {
    requestHistory();
  } else {
    window.addEventListener('load', requestHistory);
  }
})();
`.trim();

export interface AiCompanionContext {
  explorationId: string;
}

export interface AiCompanionInjectResult {
  success: boolean;
  warnings: string[];
  html: string;
}

/**
 * 检测 HTML 中 AI 伴学注入是否包含当前版本（无版本 → 缺注入；有注入但版本号不一致 → 需升级）
 */
export function isAiCompanionUpToDate(html: string | null | undefined): boolean {
  if (!html) return true; // 没有 HTML 视为最新，避免空内容触发升级循环
  // 缺少 AI 伴学注入标记则视为不需要升级（教师尚未启用）
  if (!html.includes("__AI_COMPANION_INJECTED__") && !html.includes("ai-companion-trigger")) {
    return true;
  }
  return html.includes(AI_COMPANION_VERSION);
}

/**
 * 惰性升级：把数据库里旧的 AI 伴学 HTML（任意旧版本）替换为当前版本
 * - 若 HTML 中无 AI 伴学标记，原样返回 { changed: false }
 * - 若 HTML 中已包含当前版本标记，原样返回 { changed: false }
 * - 否则先 removeAiCompanion 清干净，再 injectAiCompanion 重新注入
 * 供学生读路径等"无法触发教师保存"的接口使用，保证学生总能看到当前版本的伴学脚本
 */
export function upgradeAiCompanionIfNeeded(
  html: string | null | undefined,
  context: AiCompanionContext
): { html: string; changed: boolean; warnings: string[] } {
  if (!html) return { html: "", changed: false, warnings: [] };
  if (isAiCompanionUpToDate(html)) {
    return { html, changed: false, warnings: [] };
  }
  const warnings: string[] = [`检测到旧版 AI 伴学注入，已自动升级到 ${AI_COMPANION_VERSION}`];
  const cleaned = removeAiCompanion(html);
  const result = injectAiCompanion(cleaned, context);
  return { html: result.html, changed: true, warnings: [...warnings, ...result.warnings] };
}

/**
 * 注入AI伴学功能到HTML
 */
export function injectAiCompanion(html: string, context: AiCompanionContext): AiCompanionInjectResult {
  const warnings: string[] = [];
  let modified = html;

  // 清理可能被markdown代码块包裹的HTML（```html ... ```）
  const mdBlockMatch = modified.match(/^\s*```(?:html|HTML)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  if (mdBlockMatch) {
    modified = mdBlockMatch[1].trim();
    warnings.push("检测到HTML被markdown代码块包裹，已自动清理");
  }

  // 避免重复注入
  if (modified.includes("__AI_COMPANION_INJECTED__") || modified.includes("ai-companion-trigger")) {
    warnings.push("HTML已包含AI伴学功能，跳过注入");
    return { success: true, warnings, html: modified };
  }

  // 1. 替换占位符（函数式替换可避免 ID 中的 $ 被当成替换标记）
  modified = modified.replace(/EXPLORATION_ID_PLACEHOLDER/g, () => context.explorationId || "");

  // 2. 注入CSS（AI伴学样式 + katex 数学公式样式）
  const combinedCSS = aiCompanionCSS + (katexAssets.available ? "\n" + katexAssets.css : "");
  if (modified.includes("</head>")) {
    modified = modified.replace("</head>", () => "<style>" + combinedCSS + "</style></head>");
  } else if (modified.includes("<body")) {
    modified = modified.replace(
      /<body[^>]*>/i,
      (bodyTag) => "<head><style>" + combinedCSS + "</style></head>" + bodyTag
    );
  } else {
    modified = "<head><style>" + combinedCSS + "</style></head>" + modified;
    warnings.push("HTML缺少<head>，AI伴学CSS已添加到最前面");
  }
  if (!katexAssets.available) {
    warnings.push("katex 库未找到（可能未安装），AI 回复中的数学公式将保留为原始文本");
  }

  // 3. 注入HTML结构（在</body>前）
  if (modified.includes("</body>")) {
    modified = modified.replace("</body>", () => aiCompanionHTML + "</body>");
  } else {
    modified = modified + aiCompanionHTML;
    warnings.push("HTML缺少</body>，AI伴学HTML已添加到末尾");
  }

  // 4. 注入JS脚本（先 katex，再 AI伴学脚本）
  //    必须使用函数式 replace，避免脚本内的 $$、$' 被 String.replace 解释为替换模式
  //    katex 暴露 window.katex 全局，AI伴学脚本渲染数学公式时依赖它
  let injectedScript = "";
  if (katexAssets.available) {
    injectedScript += "<script>" + katexAssets.js + "</script>";
  }
  injectedScript += "<script>" + aiCompanionScript + "</script>";

  if (modified.includes("</body>")) {
    modified = modified.replace("</body>", () => injectedScript + "</body>");
  } else {
    modified = modified + injectedScript;
    warnings.push("HTML缺少</body>，AI伴学脚本已添加到末尾");
  }

  return { success: true, warnings, html: modified };
}

/**
 * 移除AI伴学功能
 * 通过多个独立标记依次清理，确保彻底移除所有AI伴学相关代码
 * 包括处理重复注入的情况
 */
export function removeAiCompanion(html: string): string {
  let modified = html;

  // 1. 移除所有AI伴学相关的 JS 脚本（带 __AI_COMPANION_INJECTED__ 标记的）
  modified = modified.replace(
    /<script>\s*\(function\s*\(\)\s*\{[\s\S]*?__AI_COMPANION_INJECTED__[\s\S]*?\}\)\(\);?\s*<\/script>/gi,
    ""
  );

  // 2. 一次性删除从最早 panel 开始到 body 结束前的所有 AI 伴学相关 DOM
  // 这样可以彻底处理重复注入的情况
  const firstPanelIdx = modified.indexOf('<div id="ai-companion-panel"');
  const firstTriggerIdx = modified.indexOf('<button id="ai-companion-trigger"');

  if (firstPanelIdx > -1 || firstTriggerIdx > -1) {
    // 取最早的起始位置
    let startIdx = modified.length;
    if (firstPanelIdx > -1 && firstPanelIdx < startIdx) startIdx = firstPanelIdx;
    if (firstTriggerIdx > -1 && firstTriggerIdx < startIdx) startIdx = firstTriggerIdx;

    // 同时把 startIdx 之前最近的注释（<!-- AI伴学... -->）一起清理掉
    // 从 startIdx 向前找最近的 -->
    const before = modified.substring(0, startIdx);
    const lastCommentEnd = before.lastIndexOf('-->');
    if (lastCommentEnd > -1 && lastCommentEnd > startIdx - 200) {
      // 检查这个注释是否包含 AI伴学
      const commentStart = before.lastIndexOf('<!--', lastCommentEnd);
      if (commentStart > -1) {
        const commentText = before.substring(commentStart, lastCommentEnd + 3);
        if (commentText.includes('AI伴学') || commentText.includes('AI 伴学')) {
          startIdx = commentStart;
        }
      }
    }

    // 找到 </body> 位置
    const bodyCloseIdx = modified.lastIndexOf('</body>');
    if (bodyCloseIdx > startIdx) {
      modified = modified.substring(0, startIdx) + modified.substring(bodyCloseIdx);
    }
  }

  // 3. 单独处理可能的残留（防御性）：删除任何剩下的 ai-companion-trigger button
  modified = modified.replace(
    /<button id="ai-companion-trigger"[^>]*>[\s\S]*?<\/button>/gi,
    ""
  );

  // 4. 删除任何剩下的 panel div（防御性）
  modified = modified.replace(
    /<div id="ai-companion-panel"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );

  // 5. 删除所有 ac- 内部标记的孤立 div（防御性，处理嵌套残留）
  const internalMarkers = [
    'id="ac-messages"',
    'id="ac-welcome"',
    'id="ac-input-area"',
    'id="ac-input"',
    'id="ac-send"',
    'id="ac-clear"',
    'id="ac-header"',
    'id="ac-close"',
  ];
  for (const marker of internalMarkers) {
    if (modified.includes(marker)) {
      // 找到最早出现，向前找最近 <div，向后平衡 </div>
      const idx = modified.indexOf(marker);
      let pos = idx;
      while (pos > 0) {
        if (modified.substring(pos, pos + 5) === '<div ' || modified.substring(pos, pos + 5) === '<div>') {
          break;
        }
        pos--;
      }
      if (pos > 0) {
        // 平衡 div
        let depth = 0;
        let endIdx = -1;
        let scanPos = pos;
        while (scanPos > -1 && scanPos < modified.length) {
          const nextOpen = modified.indexOf("<div", scanPos);
          const nextClose = modified.indexOf("</div>", scanPos);
          if (nextClose === -1) break;
          if (nextOpen > -1 && nextOpen < nextClose) {
            depth++;
            const closeTag = modified.indexOf(">", nextOpen);
            scanPos = closeTag + 1;
          } else {
            depth--;
            if (depth === 0) {
              endIdx = nextClose + 6;
              break;
            }
            scanPos = nextClose + 6;
          }
        }
        if (endIdx > -1) {
          modified = modified.substring(0, pos) + modified.substring(endIdx);
        }
      }
    }
  }

  // 6. 移除CSS：包含 ai-companion-root 标识的 style 标签
  modified = modified.replace(
    /<style>\s*#ai-companion-root[\s\S]*?@keyframes acTyping[^<]*\}\s*<\/style>/gi,
    ""
  );
  modified = modified.replace(
    /<style>\s*#ai-companion-root[\s\S]*?(<\/style>)/gi,
    ""
  );

  return modified;
}

/**
 * 让AI完整阅读HTML后，生成AI伴学语义提示词
 * 这份提示词将被持久化保存，作为学生提问时的system prompt
 */
export function buildHtmlAnalysisPrompt(html: string): string {
  return `你是一位资深教育专家。请仔细阅读以下互动学习网页的完整HTML代码，理解其所有交互逻辑和教学内容，然后生成一份"AI伴学指导手册"。

这份手册将被用作AI伴学助手的系统提示词，帮助AI理解这个互动探究并指导学生。

【核心理念】这是一个"互动探究"，学生通过操作、观察、对比来发现规律。你要帮助学生"看到"而非"猜到"答案。

请按以下结构输出（纯文本输出，不要用markdown代码块包裹）：

【活动概述】
用2-3句话概括这个互动探究的核心内容和教学目标。

【交互环节】
列出所有交互元素/可操作对象（最多5个），每个说明：
- 名称：（如"半径调节滑块"、"参数对比面板"等）
- 操作方式：（拖动滑块、点击切换、输入数值等）
- 学习要点：（这个操作帮助学生理解什么）
- 常见困惑：（学生容易忽略什么、误解什么）

【指导策略】
针对不同情况给出指导原则：
- 学生不知道该做什么时：引导他们注意页面上的引导语或观察提示
- 学生操作没看到变化时：引导他们关注哪些视觉元素在变化
- 学生想直接要答案时：引导他们通过调整参数、对比观察自己发现规律
- 学生观察有发现时：鼓励并引导他们用语言表达"我发现了..."
- 学生提问超出范围时：礼貌引导回当前探究主题

【关键知识点】
列出这个互动涉及的核心知识点（3-5个），每个用一句话说明。

【难度提示】
指出哪些环节对学生可能较难观察或理解，以及如何引导他们逐步深入。

【回答风格】
- 语气：亲切友好，像一个耐心的大哥哥/大姐姐
- 长度：每次回答控制在150字以内
- 形式：必要时可用简单的步骤分点说明
- 引导为主：多用"试试..."、"观察一下..."、"你觉得为什么..."、"比较一下X和Y有什么不同"
- 不要直接给最终答案或结论，而是引导学生通过操作自己发现
- 鼓励学生表达发现：多用"你观察到了什么？""能描述一下变化吗？"

以下是完整HTML代码：
${html}`;
}

/**
 * 构建AI伴学最终system prompt（结合预生成提示词+实时上下文）
 */
export function buildAiCompanionSystemPrompt(args: {
  aiCompanionPrompt?: string | null;
  title: string;
  description?: string;
  taskTitle?: string;
  taskObjectives?: string;
  context?: Record<string, any>;
}): string {
  let prompt = "";

  if (args.aiCompanionPrompt && args.aiCompanionPrompt.trim().length > 50) {
    // 使用预生成的语义提示词（高质量）
    prompt = args.aiCompanionPrompt;
  } else {
    // 降级：使用基础提示词
    prompt = `你是学生的AI学习伙伴，正在陪伴他们进行互动探究活动。

## 当前探究
- 标题：${args.title}
- 描述：${args.description || "（无描述）"}
- 所属课堂：${args.taskTitle || ""}

## 你的角色
1. 帮助学生理解当前互动探究内容
2. 引导思考而非直接给答案
3. 遇到困难时给予适当提示和鼓励
4. 保持耐心和友好
5. 回答简洁明了（150字以内），适合中小学生理解
6. 不要脱离当前探究主题闲聊`;
  }

  // 追加实时页面上下文
  if (args.context && Object.keys(args.context).length > 0) {
    prompt += "\n\n## 学生当前状态";
    if (args.context.score !== undefined) {
      prompt += `\n- 当前得分：${args.context.score}`;
    }
    if (args.context.completedSections && args.context.completedSections.length) {
      prompt += `\n- 已完成环节：${args.context.completedSections.join("、")}`;
    }
    if (args.context.gameLevel) {
      prompt += `\n- 当前关卡：第${args.context.gameLevel}关`;
    }
    if (args.context.interactions !== undefined) {
      prompt += `\n- 已互动次数：${args.context.interactions}`;
    }
    if (args.context.visibleHeadings && args.context.visibleHeadings.length) {
      prompt += `\n- 当前正在浏览：${args.context.visibleHeadings.join("、")}`;
    }
    if (args.context.focusedElement) {
      prompt += `\n- 正在操作：${args.context.focusedElement}`;
    }
    if (args.context.scrollPercent !== undefined) {
      prompt += `\n- 滚动进度：${args.context.scrollPercent}%`;
    }
    prompt += "\n\n请结合学生的当前状态给出有针对性的指导。";
  }

  return prompt;
}
