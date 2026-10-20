/**
* 互动探究 - AI伴学功能注入配置
* 当教师启用AI伴学时，系统会：
* 1. 注入浮动对话框到HTML
* 2. 调用AI分析HTML生成伴学语义提示词
* 3. 学生提问时使用预生成提示词+实时上下文
*/

import * as fs from "fs";
import * as path from "path";
import { MATH_OUTPUT_RULES } from "@/lib/math-format";
import { DEFAULT_TTS_VOICE } from "@/lib/tts-voices";

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

// AI伴学机器人图标（内联 SVG，注入到 iframe 使用）
// 与 ExplorationPanel.tsx 保持一致：圆头、大眼睛、微笑的可爱风格，更适合学生认知。
const AI_COMPANION_ROBOT_SVG = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M12 2C12.55 2 13 2.45 13 3V4.07C16.39 4.55 19.04 7.06 19.82 10.36C20.21 10.49 20.5 10.85 20.5 11.29V13.71C20.5 14.26 20.05 14.71 19.5 14.71H18.97C18.46 18.11 15.53 20.71 12 20.71C8.47 20.71 5.54 18.11 5.03 14.71H4.5C3.95 14.71 3.5 14.26 3.5 13.71V11.29C3.5 10.85 3.79 10.49 4.18 10.36C4.96 7.06 7.61 4.55 11 4.07V3C11 2.45 11.45 2 12 2Z"/><circle cx="8.8" cy="11" r="1.6" fill="white"/><circle cx="15.2" cy="11" r="1.6" fill="white"/><circle cx="8.8" cy="11" r="0.7" fill="currentColor"/><circle cx="15.2" cy="11" r="0.7" fill="currentColor"/><path d="M9.2 14.3C9.2 14.3 10.4 15.6 12 15.6C13.6 15.6 14.8 14.3 14.8 14.3" stroke="white" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>`;

// （历史机制退役 2026-09）曾用 AI_COMPANION_VERSION 版本号识别库里 HTML 的伴学注入新旧，
// 读取时「版本一致直接放行、不一致剥旧注新」。现读取路径（renderExplorationHtml）入口
// 无条件 purify 后永远注入当前版，不存在「放行库里旧注入」的路径，版本号随之退役。
// ⛔ DO NOT RE-ADD 版本号 / 升级判断：那会让代码侧的伴学修复（CSS/脚本）对存量数据失效。

/**
* AI伴学浮动对话框CSS样式
* 所有样式限定在 #ai-companion-root 内，避免与页面CSS冲突
*/
export const aiCompanionCSS = `
#ai-companion-root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

/* 浮动按钮（收起状态） */
#ai-companion-root #ai-companion-trigger {
  position: fixed; bottom: 30px; right: 80px;
  width: 52px; height: 52px;
  background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
  color: white; border: none; border-radius: 50%;
  cursor: pointer; z-index: 10001;
  box-shadow: 0 4px 15px rgba(249,115,22,0.4);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; transition: transform 0.2s, box-shadow 0.2s;
}
#ai-companion-root #ai-companion-trigger:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(249,115,22,0.6); }
#ai-companion-root #ai-companion-trigger .pulse {
  position: absolute; width: 100%; height: 100%; border-radius: 50%;
  background: rgba(249,115,22,0.3); animation: aiPulse 2s infinite;
}
@keyframes aiPulse { 0%{transform:scale(1);opacity:1} 100%{transform:scale(1.8);opacity:0} }

/* 对话框（展开状态） */
#ai-companion-root #ai-companion-panel {
  position: fixed; bottom: 30px; right: 80px;
  width: 380px; height: 500px;
  background: white; border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
  z-index: 10001; display: none; flex-direction: column;
  overflow: hidden; border: 1px solid #e5e7eb;
}
#ai-companion-root #ai-companion-panel.open { display: flex; }

/* 头部 */
#ai-companion-root #ac-header {
  padding: 14px 16px; background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
  color: white; display: flex; align-items: center; justify-content: space-between;
}
#ai-companion-root #ac-header .title { font-size: 14px; font-weight: 600; }
#ai-companion-root #ac-header .actions { display: flex; gap: 4px; align-items: center; }
#ai-companion-root #ac-clear, #ai-companion-root #ac-close { background: none; border: none; color: white; cursor: pointer; font-size: 14px; padding: 4px 8px; line-height: 1; opacity: 0.85; }
#ai-companion-root #ac-clear:hover, #ai-companion-root #ac-close:hover { opacity: 1; background: rgba(255,255,255,0.15); border-radius: 4px; }

/* 消息区 */
#ai-companion-root #ac-messages {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 10px;
  background: #fafafa;
}
#ai-companion-root #ac-messages::-webkit-scrollbar { width: 4px; }
#ai-companion-root #ac-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

#ai-companion-root .ac-msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
#ai-companion-root .ac-msg.user { align-self: flex-end; background: #f97316; color: white; border-bottom-right-radius: 4px; }
#ai-companion-root .ac-msg.assistant { align-self: flex-start; background: white; color: #1f2937; border-bottom-left-radius: 4px; border: 1px solid #e5e7eb; }
#ai-companion-root .ac-msg.assistant code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
#ai-companion-root .ac-msg.error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

/* 输入区 */
#ai-companion-root #ac-input-area {
  padding: 12px 16px; border-top: 1px solid #e5e7eb;
  display: flex; gap: 8px; align-items: flex-end;
  background: white;
}
#ai-companion-root #ac-input {
  flex: 1; border: 1px solid #d1d5db; border-radius: 20px;
  padding: 8px 14px; font-size: 13px; outline: none;
  resize: none; min-height: 36px; max-height: 80px;
  font-family: inherit; line-height: 1.4;
}
#ai-companion-root #ac-input:focus { border-color: #f97316; }
#ai-companion-root #ac-send {
  width: 36px; height: 36px; min-width: 36px; min-height: 36px;
  max-width: 36px; max-height: 36px;
  padding: 0; border: none; border-radius: 50%;
  box-sizing: border-box; aspect-ratio: 1;
  overflow: hidden; clip-path: circle(50%);
  background: #f97316; color: white;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.2s;
}
#ai-companion-root #ac-send:hover:not(:disabled) { background: #ea580c; }
#ai-companion-root #ac-send:disabled { background: #d1d5db; cursor: not-allowed; }

/* 欢迎提示 */
#ai-companion-root #ac-welcome { text-align: center; padding: 30px 20px; color: #9ca3af; }
#ai-companion-root #ac-welcome .icon { font-size: 32px; margin-bottom: 8px; color: #f97316; }
#ai-companion-root #ac-welcome .text { font-size: 13px; line-height: 1.8; }

/* 打字指示器 */
#ai-companion-root .ac-typing { display: inline-flex; gap: 3px; padding: 4px 0; }
#ai-companion-root .ac-typing span { width: 6px; height: 6px; background: #9ca3af; border-radius: 50%; animation: acTyping 1.2s infinite; }
#ai-companion-root .ac-typing span:nth-child(2) { animation-delay: 0.2s; }
#ai-companion-root .ac-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes acTyping { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }

/* Markdown 渲染样式（AI 回复） */
#ai-companion-root .ac-msg p { margin: 0 0 6px 0; }
#ai-companion-root .ac-msg p:last-child { margin-bottom: 0; }
#ai-companion-root .ac-msg strong { font-weight: 600; }
#ai-companion-root .ac-msg em { font-style: italic; }
#ai-companion-root .ac-msg code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
#ai-companion-root .ac-msg pre { background: #1f2937; color: #f9fafb; padding: 8px 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.5; margin: 4px 0; }
#ai-companion-root .ac-msg pre code { background: transparent; padding: 0; color: inherit; font-size: inherit; }
#ai-companion-root .ac-msg ul, #ai-companion-root .ac-msg ol { margin: 4px 0 4px 18px; padding: 0; }
#ai-companion-root .ac-msg li { margin: 2px 0; }
#ai-companion-root .ac-msg a { color: #f97316; text-decoration: underline; }
#ai-companion-root .ac-msg.assistant img { display: block; max-width: 100%; max-height: 260px; border-radius: 8px; margin: 6px 0; border: 1px solid #e5e7eb; cursor: zoom-in; }

/* 公式容器样式 */
#ai-companion-root .ac-math-inline { display: inline-block; vertical-align: middle; }
#ai-companion-root .ac-math-block { display: block; text-align: center; margin: 6px 0; }

/* 每条 AI 回答底部的朗读按钮 */
#ai-companion-root .ac-msg-foot { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 4px; }
#ai-companion-root .ac-play {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: none; border-radius: 50%;
  background: #f3f4f6; color: #6b7280;
  cursor: pointer; flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
#ai-companion-root .ac-play:hover { background: #e8ecf3; color: #f97316; }
#ai-companion-root .ac-play.playing { background: rgba(249,115,22,0.15); color: #f97316; }
#ai-companion-root .ac-play.loading { animation: acBlink 0.8s ease-in-out infinite; cursor: default; }
@keyframes acBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
#ai-companion-root .ac-speak-err { display: none; font-size: 11px; color: #9ca3af; }
#ai-companion-root .ac-speak-err.show { display: inline; }

/* ===== 防御声明（2026-09 修复 1）=====
   ⚠️ GOTCHA：探究页自身的 CSS 可能用宽泛选择器（button/div/* 的 reset、带 !important 的覆盖）
   冲掉伴学面板的存在性样式 —— 典型症状：浮动按钮消失、面板被探究内容盖住、消息区塌陷。
   以下 !important 只锁「面板能否出现 / 定位 / 滚动」的骨架属性，不锁美观属性。
   panel 的 display 两条都带 !important：靠 .open 的更高特异性实现收起/展开切换。
   ⛔ DO NOT REVERT：别只删其中一条 —— 删 none 那条会让收起状态被探究页的 div 规则强制显示；
   删 .open 那条会让面板永远打不开。 */
#ai-companion-root { display: block !important; }
#ai-companion-root #ai-companion-trigger { position: fixed !important; display: flex !important; z-index: 10001 !important; }
#ai-companion-root #ai-companion-panel { position: fixed !important; display: none !important; z-index: 10001 !important; }
#ai-companion-root #ai-companion-panel.open { display: flex !important; }
#ai-companion-root #ac-messages { display: flex !important; flex-direction: column !important; flex: 1 !important; overflow-y: auto !important; }
#ai-companion-root #ac-input-area { display: flex !important; }
#ai-companion-root #ac-send {
  width: 36px !important; height: 36px !important;
  min-width: 36px !important; min-height: 36px !important;
  max-width: 36px !important; max-height: 36px !important;
  padding: 0 !important; border-radius: 50% !important;
  aspect-ratio: 1 !important; flex-shrink: 0 !important;
  overflow: hidden !important; clip-path: circle(50%) !important;
}
`.trim();

/**
 * AI伴学浮动对话框HTML
 */
export const aiCompanionHTML = `
<div id="ai-companion-root">
<!-- AI伴学浮动按钮 -->
<button id="ai-companion-trigger" title="AI伴学助手" style="display:flex">
  <span class="pulse"></span>
  ${AI_COMPANION_ROBOT_SVG}
</button>

<!-- AI伴学对话框 -->
<div id="ai-companion-panel" role="dialog" aria-label="AI伴学助手">
  <div id="ac-header">
    <span class="title">${AI_COMPANION_ROBOT_SVG} AI伴学助手</span>
    <div class="actions">
      <button id="ac-clear" title="清空对话" aria-label="清空对话">🗑</button>
      <button id="ac-close" title="关闭" aria-label="关闭">✕</button>
    </div>
  </div>
  <div id="ac-messages">
    <div id="ac-welcome">
      <div class="icon">${AI_COMPANION_ROBOT_SVG}</div>
      <div class="text">你好！我是你的AI学习伙伴<br/>遇到问题随时问我哦</div>
    </div>
  </div>
  <div id="ac-input-area">
    <textarea id="ac-input" rows="1" placeholder="输入你的问题..." maxlength="500"></textarea>
    <button id="ac-send" aria-label="发送" style="width:36px;height:36px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 12l18-9v18L3 12z"/></svg>
    </button>
  </div>
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

  // ========================= 单条回答朗读（服务端合成） =========================
  // 每条 AI 回答右下角一个播放按钮，历史消息也能单独点播。
  // 朗读设置与宿主页共用同一份（localStorage: qc-speech-settings），
  // 所以学生在页面右上角改的开关 / 音色 / 语速，这里立刻生效；
  // 文本清洗由服务端统一做（/api/tts），这里只负责把原文送过去并播放。
  //
  // **离线保底**：老师可能把 QuickClass 部署在没有外网的教室里，此时服务端合成
  // 一定失败（返回 502）。这时回退到**浏览器内置朗读**（本机音色），保证"至少有声音"；
  // 回退用的文本是服务端清洗后回传的 cleanText，不会把 Markdown 符号念出来。
  // 服务端迟迟不出声（网络黑洞 / 排队卡住）由 15 秒看门狗兜底。

  var SPEECH_SETTINGS_KEY = 'qc-speech-settings';
  var DEFAULT_VOICE_ID = '${DEFAULT_TTS_VOICE}';
  var DEFAULT_SPEECH_RATE = 1.2;
  var ICON_PLAY = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"></path></svg>';
  var ICON_STOP = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"></rect></svg>';

  var audioEl = null;    // 当前播放中的音频
  var playingBtn = null; // 当前正在朗读的那条消息上的按钮
  var speechSeq = 0;     // 朗读请求序号：停止或新一段朗读会自增，用于丢弃在途的旧请求

  function readSpeechSettings() {
    try {
      var raw = window.localStorage.getItem(SPEECH_SETTINGS_KEY);
      if (raw) {
        var o = JSON.parse(raw) || {};
        var rate = Number(o.rate);
        return {
          enabled: o.enabled === true,
          voice: (typeof o.voice === 'string' && o.voice) ? o.voice : DEFAULT_VOICE_ID,
          rate: (isFinite(rate) && rate > 0) ? Math.min(2, Math.max(0.5, rate)) : DEFAULT_SPEECH_RATE
        };
      }
    } catch (e) { /* 读不到就用默认值 */ }
    return { enabled: false, voice: DEFAULT_VOICE_ID, rate: DEFAULT_SPEECH_RATE };
  }

  function setBtnState(btn, state) {
    if (!btn) return;
    btn.className = 'ac-play' + (state === 'idle' ? '' : ' ' + state);
    btn.innerHTML = state === 'playing' ? ICON_STOP : ICON_PLAY;
    btn.title = state === 'playing' ? '停止朗读' : '朗读这条回答';
    btn.setAttribute('aria-label', btn.title);
  }

  function releaseAudio() {
    if (!audioEl) return;
    var a = audioEl;
    audioEl = null;
    try {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute('src');
      a.load(); // 中止仍在进行的流式下载
    } catch (e) { /* ignore */ }
  }

  function stopSpeech() {
    speechSeq++; // 让在途的朗读请求失效，避免停止后又被回退路径重新读起来
    releaseAudio();
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
    if (playingBtn) {
      setBtnState(playingBtn, 'idle');
      playingBtn = null;
    }
  }

  function showSpeakError(btn, text) {
    if (!btn || !btn.parentNode) return;
    var tip = btn.parentNode.querySelector('.ac-speak-err');
    if (!tip) return;
    tip.textContent = text;
    tip.className = 'ac-speak-err show';
    if (tip.__acTimer) clearTimeout(tip.__acTimer);
    tip.__acTimer = setTimeout(function() { tip.className = 'ac-speak-err'; }, 4000);
  }

  // 浏览器内置朗读（**离线保底路径**）：老师把 QuickClass 部署在没有外网的教室里时，
  // 服务端合不出来，这里保证"至少读得出来"。
  // 挑音色只认**本机自带**的（localService === true）：名字含 Online/Natural 的微软音色
  // 其实是云端音色，没网时反而不出声，不能优先它们。
  function pickLocalChineseVoice() {
    try {
      if (!window.speechSynthesis) return null;
      var all = window.speechSynthesis.getVoices() || [];
      if (!all.length) return null;
      var zh = [];
      for (var i = 0; i < all.length; i++) {
        var v = all[i];
        if (/^zh([-_].*)?$/i.test(v.lang || '') || /chinese|中文|普通话|国语|國語/i.test(v.name || '')) zh.push(v);
      }
      var pool = zh.length ? zh : all;
      var local = [];
      for (var j = 0; j < pool.length; j++) {
        if (pool[j].localService === true) local.push(pool[j]);
      }
      var usable = local.length ? local : pool;
      for (var k = 0; k < usable.length; k++) {
        if (!/natural|online/i.test(usable[k].name || '')) return usable[k];
      }
      return usable[0] || null;
    } catch (e) { return null; }
  }

  function playSpeech(btn, content, auto) {
    if (!content) return;
    // 再点一次同一按钮 = 停止
    if (playingBtn === btn && !auto) { stopSpeech(); return; }
    stopSpeech();
    var settings = readSpeechSettings();
    var token = ++speechSeq;
    var finished = false; // 本次朗读是否已有结论，避免"失败"被重复处理
    function claim() { if (finished) return false; finished = true; return true; }
    playingBtn = btn;
    setBtnState(btn, 'loading');

    // ---------- 保底：浏览器内置朗读 ----------
    function finishLocal() {
      if (token !== speechSeq) return;
      if (playingBtn === btn) { playingBtn = null; setBtnState(btn, 'idle'); }
    }
    function speakLocally(text) {
      if (!window.speechSynthesis || !text) return false;
      try {
        window.speechSynthesis.cancel();
        var voice = pickLocalChineseVoice();
        var parts = String(text).match(/[^。！？!?；;]+[。！？!?；;]?/g) || [String(text)];
        var chunks = [];
        for (var i = 0; i < parts.length; i++) {
          var t = parts[i].trim();
          if (t) chunks.push(t);
        }
        if (!chunks.length) return false;
        for (var j = 0; j < chunks.length; j++) {
          var u = new SpeechSynthesisUtterance(chunks[j]);
          if (voice) { u.voice = voice; u.lang = voice.lang || 'zh-CN'; } else { u.lang = 'zh-CN'; }
          u.rate = settings.rate;
          if (j === chunks.length - 1) { u.onend = finishLocal; u.onerror = finishLocal; }
          window.speechSynthesis.speak(u);
        }
        return true;
      } catch (e) { return false; }
    }
    // 安卓平板常见坑：speechSynthesis 存在但系统没有 TTS 引擎（无 GMS / Google 语音服务不可达），
    // getVoices() 永远为空 —— speak() 不报错也不出声，按钮会一直停在"播放中"。
    // 先等音色列表就绪（Chrome 桌面首帧为空、稍后 voiceschanged 才有），仍为空才算"没有语音"。
    function hasAnyVoice(cb) {
      if (!window.speechSynthesis) { cb(false); return; }
      var list = [];
      try { list = window.speechSynthesis.getVoices() || []; } catch (e) {}
      if (list.length) { cb(true); return; }
      var settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { window.speechSynthesis.removeEventListener('voiceschanged', onChange); } catch (e) {}
        cb(ok);
      }
      function onChange() {
        var v = [];
        try { v = window.speechSynthesis.getVoices() || []; } catch (e) {}
        if (v.length) finish(true);
      }
      var timer = setTimeout(function() { finish(false); }, 1500);
      try { window.speechSynthesis.addEventListener('voiceschanged', onChange); } catch (e) { finish(false); }
    }
    // 服务端不可用（没外网 / 合成失败 / 自动播放被拦截）→ 回退本机朗读；本机也没有语音引擎才算"没声音"
    function fallbackToLocal(cleanText) {
      if (token !== speechSeq) return;
      releaseAudio();
      playingBtn = btn;
      hasAnyVoice(function(ok) {
        if (token !== speechSeq) return;
        if (ok && speakLocally(cleanText || content)) {
          setBtnState(btn, 'playing');
        } else {
          playingBtn = null;
          setBtnState(btn, 'idle');
          showSpeakError(btn, '当前设备没有可用的语音，请检查媒体音量');
        }
      });
    }

    // ---------- 首选：服务端合成的神经音色 ----------
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content, voice: settings.voice })
    })
      .then(function(r) { if (!r.ok) throw new Error('register failed'); return r.json(); })
      .then(function(d) {
        if (!d || !d.ok || !d.id) throw new Error('register failed');
        if (token !== speechSeq) throw new Error('superseded'); // 已被新的朗读取代
        // 服务端回传的是**清洗后**的文本（剥离 Markdown、公式转口语）；
        // 回退朗读要用它，否则会把 "**"、"$x^2$" 这类符号念出来。
        var cleanText = (typeof d.text === 'string' && d.text) ? d.text : content;
        var audio = new Audio('/api/tts/audio/' + d.id);
        // 语速交给播放器变速（变速不变调），不必每个语速各自合成一份
        audio.playbackRate = settings.rate;
        audioEl = audio;
        // 服务端迟迟不出声（网络黑洞 / 排队卡住）的兜底：15 秒后按失败处理，改本机朗读
        var watchdog = setTimeout(function() {
          if (!claim()) return;
          fallbackToLocal(cleanText);
        }, 15000);
        audio.onended = function() {
          clearTimeout(watchdog);
          if (audioEl === audio) audioEl = null;
          if (token === speechSeq && playingBtn === btn) { playingBtn = null; setBtnState(btn, 'idle'); }
        };
        audio.onerror = function() {
          clearTimeout(watchdog);
          // 服务端返回 502/503（最常见：教室没有外网）→ 回退本机朗读
          if (!claim()) return;
          fallbackToLocal(cleanText);
        };
        return audio.play().then(function() {
          clearTimeout(watchdog);
          if (token === speechSeq && playingBtn === btn) setBtnState(btn, 'playing');
        }, function() {
          clearTimeout(watchdog);
          // 音频加载失败：服务端不可用，或自动播放被浏览器拦截
          if (!claim()) return;
          fallbackToLocal(cleanText);
        });
      })
      .catch(function() {
        if (token !== speechSeq) return;
        if (!claim()) return;
        // 登记都失败了（服务端异常）→ 本机朗读兜底
        fallbackToLocal(content);
      });
  }

  /** 给一条 AI 回答挂上朗读按钮（重复调用只更新文本，不会重复插入） */
  function ensurePlayButton(msgDiv, content) {
    if (!msgDiv || !content) return null;
    msgDiv.__acText = content;
    var foot = msgDiv.querySelector('.ac-msg-foot');
    if (foot) return foot.querySelector('.ac-play');
    foot = document.createElement('div');
    foot.className = 'ac-msg-foot';
    var tip = document.createElement('span');
    tip.className = 'ac-speak-err';
    var btn = document.createElement('button');
    btn.type = 'button';
    setBtnState(btn, 'idle');
    btn.addEventListener('click', function() { playSpeech(btn, msgDiv.__acText, false); });
    foot.appendChild(tip);
    foot.appendChild(btn);
    msgDiv.appendChild(foot);
    return btn;
  }

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

      // 图片 ![alt](url)：课堂图片组素材（AI 回复中的教学图片）
      if (ch === '!' && nx === '[') {
        var endAltImg = s.indexOf(']', i + 2);
        if (endAltImg > 0 && s.charAt(endAltImg + 1) === '(') {
          var endUrlImg = s.indexOf(')', endAltImg + 2);
          if (endUrlImg > endAltImg + 1) {
            var altImg = s.substring(i + 2, endAltImg);
            var urlImg = s.substring(endAltImg + 2, endUrlImg).trim();
            flushText();
            var imgEl = document.createElement('img');
            imgEl.alt = altImg;
            imgEl.loading = 'lazy';
            // 本地教学图片追加登录 token（<img> 无法带 header；同源 iframe 可读 localStorage）
            if (urlImg.indexOf('/api/images/') === 0 && urlImg.indexOf('token=') === -1) {
              try {
                var acTk = localStorage.getItem('token');
                if (acTk) urlImg += (urlImg.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(acTk);
              } catch (e) { /* 忽略 */ }
            }
            imgEl.src = urlImg;
            parent.appendChild(imgEl);
            i = endUrlImg + 1;
            continue;
          }
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

  // 统一 LaTeX 定界符：模型可能输出 \(...\) / \[...\]，统一转换为 $...$ / $$...$$
  // 跳过围栏代码块与行内代码，避免破坏字面代码
  function normalizeMathDelimiters(text) {
    var s = String(text == null ? '' : text);
    if (s.indexOf('\\(') === -1 && s.indexOf('\\)') === -1 && s.indexOf('\\[') === -1 && s.indexOf('\\]') === -1) {
      return s;
    }
    var lines = s.split('\n');
    var inFence = false;
    var out = [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (/^\s*(\`\`\`|~~~)/.test(line)) { inFence = !inFence; out.push(line); continue; }
      if (inFence) { out.push(line); continue; }
      var parts = line.split(/(\`[^\`]*\`)/g);
      for (var pi = 0; pi < parts.length; pi++) {
        if (pi % 2 === 1) continue;
        // 函数式替换：replace 字符串参数里的 $$ 会被解释为一个字面 $
        parts[pi] = parts[pi]
          .replace(/\\\[/g, function() { return '$$'; })
          .replace(/\\\]/g, function() { return '$$'; })
          .replace(/\\\(/g, function() { return '$'; })
          .replace(/\\\)/g, function() { return '$'; });
      }
      out.push(parts.join(''));
    }
    return out.join('\n');
  }

  // 完整渲染：把 Markdown 文本渲染到 root 元素（覆盖原内容）
  // 支持：段落（双换行）、单换行（<br>）、行内 token
  function renderMarkdownToElement(root, text) {
    // 清空 root
    while (root.firstChild) root.removeChild(root.firstChild);
    if (!text) return;

    var lines = normalizeMathDelimiters(text).split('\n');
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
    stopSpeech();
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
    stopSpeech(); // 收起对话框时停止朗读
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

    stopSpeech(); // 新提问先停掉上一段朗读

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

    // 45s 超时兜底：流式响应意外挂死时自动解锁，避免输入框永久锁定
    if (window.__acStreamTimeout) clearTimeout(window.__acStreamTimeout);
    window.__acStreamTimeout = setTimeout(function() {
      if (!isStreaming) return;
      isStreaming = false;
      sendBtn.disabled = false;
      var timeoutTyping = document.getElementById('ac-typing-indicator');
      if (timeoutTyping) timeoutTyping.remove();
      var timeoutErr = document.createElement('div');
      timeoutErr.className = 'ac-msg error';
      timeoutErr.textContent = '回复超时，请重试';
      messagesDiv.appendChild(timeoutErr);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, 45000);
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
      // AI 回答（含历史消息）都带一个朗读按钮
      if (role === 'assistant' && content) ensurePlayButton(div, content);
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
      if (window.__acStreamTimeout) { clearTimeout(window.__acStreamTimeout); window.__acStreamTimeout = null; }
      var typingEl2 = document.getElementById('ac-typing-indicator');
      if (typingEl2) typingEl2.remove();
      var doneMsg = document.getElementById('ac-streaming-msg');
      if (doneMsg) {
        var finalContent = doneMsg.textContent;
        doneMsg.removeAttribute('id');
        // 流结束后一次性渲染 Markdown + Math
        renderMarkdownToElement(doneMsg, finalContent);
        chatHistory.push({ role: 'assistant', content: finalContent });
        // 挂上朗读按钮；学生开着"自动朗读"时这一条直接播报
        var doneBtn = ensurePlayButton(doneMsg, finalContent);
        if (doneBtn && readSpeechSettings().enabled) playSpeech(doneBtn, finalContent, true);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
      isStreaming = false;
      sendBtn.disabled = false;
    }

    if (e.data.type === 'AI_COMPANION_ERROR') {
      if (window.__acStreamTimeout) { clearTimeout(window.__acStreamTimeout); window.__acStreamTimeout = null; }
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

  // 宿主页（学生端）把"自动朗读"关掉时，停掉正在播的那条
  // 同源 iframe 会收到父文档写入 localStorage 触发的 storage 事件
  window.addEventListener('storage', function(e) {
    if (!e || e.key !== SPEECH_SETTINGS_KEY) return;
    try {
      var s = JSON.parse(e.newValue || '{}') || {};
      if (s.enabled !== true) stopSpeech();
    } catch (err) { /* ignore */ }
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

// （历史函数已删 2026-09）isAiCompanionUpToDate / upgradeAiCompanionIfNeeded 是版本号机制的
// 配套函数，随 AI_COMPANION_VERSION 一并退役（见文件头部退役说明）。
// 现在需要「确保 HTML 带当前版伴学」的唯一正确姿势：
//   import { injectAiCompanion, removeAiCompanion } from "@/lib/prompts/ai-companion";
//   injectAiCompanion(removeAiCompanion(html), context)  // 剥旧 + 注当前版，对纯净稿幂等
// 或直接走 renderExplorationHtml（内部已做同样的事）。

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
  if (modified.includes("__AI_COMPANION_INJECTED__") || modified.includes("ai-companion-root")) {
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

  // 2. 一次性删除从最早 root/panel 开始到 body 结束前的所有 AI 伴学相关 DOM
  // 这样可以彻底处理重复注入的情况
  const firstRootIdx = modified.indexOf('<div id="ai-companion-root"');
  const firstPanelIdx = modified.indexOf('<div id="ai-companion-panel"');
  const firstTriggerIdx = modified.indexOf('<button id="ai-companion-trigger"');

  if (firstRootIdx > -1 || firstPanelIdx > -1 || firstTriggerIdx > -1) {
    // 取最早的起始位置
    let startIdx = modified.length;
    if (firstRootIdx > -1 && firstRootIdx < startIdx) startIdx = firstRootIdx;
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

  // 统一数学公式输出格式：本渲染器只识别 $...$ / $$...$$，
  // 避免模型输出 \(...\) / \[...\] 时把公式源码直接显示给学生
  prompt += `\n\n${MATH_OUTPUT_RULES}`;

  return prompt;
}
