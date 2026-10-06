/* ============================================================
 * main.js —— 主调度逻辑
 * ------------------------------------------------------------
 * 【职责】把各模块串起来，是唯一「知道 DOM」的文件
 *   QuestionBank（题库）  → 渲染题目、判分
 *   CCompiler（编译器）   → 跑代码、产出事件流
 *   ScoreCalc（等级系统） → 计分、境界计算
 *   可视化动画            → 消费事件流，驱动柱状图
 *
 * 【模块解耦约定】
 *   · 改 UI 布局        → 只改 ui.html
 *   · 改样式            → 只改 css/style.css
 *   · 改题目            → 只改 js/questionBank.js
 *   · 改等级规则/题分   → 只改 js/scoreCalc.js
 *   · 改示例代码        → 只改本文件底部的 SAMPLE_CODES
 * ============================================================ */

(function () {
  'use strict';

  /* ============================================================
   * 0. 工具函数 & DOM 引用
   * ============================================================ */
  const $ = id => document.getElementById(id);

  const el = {
    // 模式
    modeSwitch: $('modeSwitch'),
    // 顶栏等级
    topbarBadge: $('topbarBadge'), topbarScore: $('topbarScore'),
    topbarBarFill: $('topbarBarFill'), topbarNext: $('topbarNext'),
    // 编辑器
    editor: $('editor'), gutter: $('editorGutter'), scroll: $('editorScroll'),
    highlight: $('editorHighlight'), input: $('editorInput'),
    statLine: $('statLine'), statTotal: $('statTotal'), statCol: $('statCol'),
    statIndent: $('statIndent'),
    sampleSelect: $('sampleSelect'), btnFormat: $('btnFormat'), btnReset: $('btnReset'),
    btnClear: $('btnClear'),
    btnVisualize: $('btnVisualize'), btnRunConsole: $('btnRunConsole'),
    // 通用确认弹窗
    confirmModal: $('confirmModal'), confirmTitle: $('confirmTitle'),
    confirmDesc: $('confirmDesc'), confirmDetail: $('confirmDetail'),
    confirmStat: $('confirmStat'), confirmOk: $('confirmOk'), confirmCancel: $('confirmCancel'),
    // 刷题
    quizIndex: $('quizIndex'), btnPrevQ: $('btnPrevQ'), btnNextQ: $('btnNextQ'),
    qType: $('qType'), qDiff: $('qDiff'), qPoint: $('qPoint'), qStem: $('qStem'),
    qChapter: $('qChapter'),
    selChapter: $('selChapter'), selType: $('selType'),
    btnShuffle: $('btnShuffle'), btnResetFilter: $('btnResetFilter'),
    quizOptions: $('quizOptions'), quizFill: $('quizFill'), quizCode: $('quizCode'),
    quizFeedback: $('quizFeedback'),
    btnHint: $('btnHint'), btnSubmitAnswer: $('btnSubmitAnswer'), btnExplain: $('btnExplain'),
    // 可视化
    vizStage: $('vizStage'), vizEmpty: $('vizEmpty'), vizBars: $('vizBars'),
    statCompare: $('statCompare'), statSwap: $('statSwap'), statRound: $('statRound'),
    varList: $('varList'), vizLog: $('vizLog'),
    vizSpeedSel: $('vizSpeedSel'), btnVizPause: $('btnVizPause'),
    btnVizStep: $('btnVizStep'), btnVizReset: $('btnVizReset'),
    // 实时执行代码浮层
    vizCodeline: $('vizCodeline'), vizCodelineText: $('vizCodelineText'),
    // 交互式控制台
    vizConsole: $('vizConsole'), consoleBody: $('consoleBody'),
    consoleOutput: $('consoleOutput'), btnClearConsole: $('btnClearConsole'),
    vcLed: $('vcLed'), vcMode: $('vcMode'),
    vcWait: $('vcWait'), vcWaitText: $('vcWaitText'), vcSend: $('vcSend'),
    vcInputLine: $('vcInputLine'), vcPrompt: $('vcPrompt'), vcInput: $('vcInput'),
    // 等级
    levelRing: $('levelRing'), levelName: $('levelName'), levelEn: $('levelEn'),
    panelScore: $('panelScore'), levelBarFill: $('levelBarFill'), levelBarText: $('levelBarText'),
    levelNext: $('levelNext'), levelLadder: $('levelLadder'),
    statAnswered: $('statAnswered'), statCorrect: $('statCorrect'),
    statAccuracy: $('statAccuracy'), statStreak: $('statStreak'),
    recordList: $('recordList'),
    btnLevelRule: $('btnLevelRule'), btnResetLevel: $('btnResetLevel'),
    // 弹窗 & Toast
    ruleModal: $('ruleModal'), ruleModalBody: $('ruleModalBody'),
    toastWrap: $('toastWrap')
  };

  /** 转义 HTML，防止题干中的尖括号破坏结构 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 时间戳 → 「刚刚 / 5分钟前 / 昨天 / MM-DD」 */
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d === 1) return '昨天';
    if (d < 30) return d + ' 天前';
    const dt = new Date(ts);
    return (dt.getMonth() + 1) + '-' + dt.getDate();
  }

  /** 轻量提示 */
  function toast(title, msg, kind, ms) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = `<div class="toast-title">${esc(title)}</div>` +
      (msg ? `<div class="toast-msg">${msg}</div>` : '');
    el.toastWrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, ms || 2600);
  }

  /* ============================================================
   * 0.5 通用确认弹窗（危险操作防误触）
   *
   * 设计要点：
   *  - 返回 Promise，调用方用 .then 决定后续动作
   *  - 默认焦点落在「取消」上，直接回车不会误删
   *  - Esc / 点遮罩 / 点 ✕ 都算取消
   *  - Tab 键锁在弹窗内循环，键盘用户不会 Tab 到背后的按钮再按回车
   * ============================================================ */
  const Confirm = {
    _resolver: null,
    _lastFocus: null,

    /**
     * @param {object} opt
     * @param {string} opt.title    标题
     * @param {string} opt.message  正文说明
     * @param {string} [opt.okText] 确认按钮文字
     * @param {string} [opt.detail] 附加信息（显示在红框里，如「将清空 42 行代码」）
     * @param {boolean} [opt.danger] false 时确认按钮用主色而非危险红
     * @returns {Promise<boolean>} 确认 resolve(true)，取消 resolve(false)
     */
    ask(opt) {
      // 已有弹窗在开：先结算掉，避免旧 Promise 永远悬空
      if (Confirm._resolver) Confirm._resolver(false);

      el.confirmTitle.innerHTML = (opt.danger === false ? '' : '<span class="warn-ico">⚠</span>') + esc(opt.title);
      el.confirmDesc.textContent = opt.message || '确定要执行此操作吗？';
      el.confirmOk.textContent = opt.okText || '确认';

      if (opt.detail) {
        el.confirmStat.textContent = opt.detail;
        el.confirmDetail.hidden = false;
      } else {
        el.confirmDetail.hidden = true;
      }

      el.confirmOk.classList.toggle('btn-danger', opt.danger !== false);
      el.confirmOk.classList.toggle('btn-primary', opt.danger === false);
      el.confirmModal.hidden = false;
      Confirm._lastFocus = document.activeElement;

      // 焦点给「取消」：回车不会直接触发清空。
      // 先同步 focus 一次（保证立即生效），再用 rAF 兜底
      // —— 元素刚从 hidden 转成可见时部分浏览器需要等一帧才接受 focus。
      if (el.confirmCancel) {
        el.confirmCancel.focus();
        requestAnimationFrame(() => {
          if (Confirm.isOpen() && el.confirmCancel) el.confirmCancel.focus();
        });
      }

      return new Promise(resolve => { Confirm._resolver = resolve; });
    },

    /** 关闭并把结果交回调用方 */
    _close(result) {
      if (!Confirm._resolver) { el.confirmModal.hidden = true; return; }
      const fn = Confirm._resolver;
      Confirm._resolver = null;
      el.confirmModal.hidden = true;
      if (Confirm._lastFocus && Confirm._lastFocus.focus) Confirm._lastFocus.focus();
      fn(!!result);
    },

    /** 是否正开着（键盘事件里用来提前拦截） */
    isOpen() { return !el.confirmModal.hidden; }
  };

  /* ============================================================
   * 1. 语法高亮（编辑器与代码展示共用）
   * ============================================================ */

  const C_KEYWORDS = /\b(int|char|double|float|long|short|unsigned|signed|void|const|static|struct|enum|typedef|union|if|else|for|while|do|switch|case|default|break|continue|return|goto|sizeof)\b/g;
  const C_LITERALS = /\b(sizeof|NULL|true|false)\b/g;

  /** 供 Viz.varsOnLine 使用的关键字判定（带 g 标志的不能直接 .test，故单独建） */
  const C_KEYWORDS_TEST = new RegExp('^(?:' + C_KEYWORDS.source.replace(/^\\b/, '').replace(/\\b$/, '') + ')$');

  /**
   * 把一段 C 代码渲染成带语法高亮的 HTML
   * 实现思路：先把注释/字符串挖成占位符，避免内部内容被误着色，
   *          再对剩余的普通代码套正则，最后把占位符还原。
   */
  function highlightC(code) {
    const store = [];
    const hold = html => `\uE000x${store.push(html) - 1}x\uE001`;

    let s = esc(code);

    // 0) 保护 esc() 产生的 HTML 实体。
    //    必须放在所有正则之前：#include <stdio.h> 会被转义成 &lt;stdio.h&gt;，
    //    若不隔离，运算符正则会把 & 当成按位与、把 ; 当成分号高亮，
    //    生成 <span class="tk-op">&</span>lt; 从而破坏 HTML 结构。

    // 1) 注释（块注释 → 行注释）
    s = s.replace(/\/\*[\s\S]*?\*\//g, m => hold(`<span class="tk-com">${m}</span>`));
    s = s.replace(/\/\/[^\n]*/g, m => hold(`<span class="tk-com">${m}</span>`));
    // 2) 预处理指令
    s = s.replace(/^[ \t]*#[^\n]*/gm, m => hold(`<span class="tk-pre">${m}</span>`));
    // 预处理指令内的 HTML 实体需隔离：#include <stdio.h> 的尖括号已被 esc 转义成
    // &lt;stdio.h&gt;，若不隔离，后面运算符正则会把 & 当成按位与，破坏 HTML 结构。
    s = s.replace(/&(amp|lt|gt|quot);/g, m => hold(m));
    // 3) 字符串与字符
    s = s.replace(/"(?:\\.|[^"\\])*"/g, m => hold(`<span class="tk-str">${m}</span>`));
    s = s.replace(/'(?:\\.|[^'\\])'/g, m => hold(`<span class="tk-str">${m}</span>`));
    // 4) 数字
    s = s.replace(/\b(0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*)\b/g,
      m => hold(`<span class="tk-num">${m}</span>`));
    // 5) 关键字 / 类型 / 库函数
    s = s.replace(C_KEYWORDS, m => {
      const isType = /^(int|char|double|float|long|short|unsigned|signed|void|const|static|struct|enum|union|typedef)$/.test(m);
      return hold(`<span class="${isType ? 'tk-typ' : 'tk-kw'}">${m}</span>`);
    });
    s = s.replace(C_LITERALS, m => hold(`<span class="tk-kw">${m}</span>`));
    s = s.replace(/\b(printf|scanf|puts|putchar|main|sizeof|malloc|free|strlen|strcpy)\b/g,
      m => hold(`<span class="tk-fn">${m}</span>`));
    // 6) 运算符（此时 HTML 实体已被隔离，不会误伤标签）
    s = s.replace(/([+\-*/%=<>!&|^~?:]+)/g, m => hold(`<span class="tk-op">${m}</span>`));

    // 还原占位符
    s = s.replace(/\uE000x(\d+)x\uE001/g, (_, i) => store[+i]);
    return s;
  }

  /* ============================================================
   * 2. 代码编辑器
   * ============================================================ */

  const Editor = {
    _lineCount: -1,
    _m: null,              // 行高/padding 缓存，见 _metrics()

    getValue() { return el.input.value; },

    setValue(text) {
      el.input.value = text;
      Editor.render();
      Editor.updateStatus();
      // 换了整份代码，回到顶部
      el.scroll.scrollTop = 0;
      el.scroll.scrollLeft = 0;
      Editor.syncGutter();
    },

    /** 清空编辑器：复位所有衍生状态（高亮行、滚动位置、状态栏） */
    clear() {
      Editor.setValue('');
      // 残留的执行高亮一并清掉，否则行号槽会留一条蓝线
      const act = el.gutter.querySelector('.gl.active');
      if (act) act.classList.remove('active');
      el.input.focus();
    },

    /** 编辑器是否有内容（判断"清空"按钮是否值得点） */
    isEmpty() { return el.input.value.trim() === ''; },

    /** 当前代码的规模描述，用于确认弹窗里告诉用户会丢什么 */
    stats() {
      const raw = el.input.value;
      const lines = raw.split('\n').length;
      const chars = raw.length;
      const bytes = (() => { try { return new Blob([raw]).size; } catch (e) { return chars; } })();
      return { lines, chars, bytes };
    },

    /** 重新渲染高亮层 + 行号 */
    render() {
      const code = el.input.value;
      el.highlight.innerHTML = highlightC(code) + '\n';

      const count = Math.max(1, code.split('\n').length);
      if (count !== Editor._lineCount) {
        Editor._lineCount = count;
        let html = '';
        for (let i = 1; i <= count; i++) html += `<div class="gl" data-line="${i}">${i}</div>`;
        el.gutter.innerHTML = html;
        el.statTotal.textContent = count;
      }
      Editor.syncHeight();
    },

    /** 让 textarea / 高亮层 / 行号槽三者严格等高。
     *  CSS 的 grid 已让前两层共享同一单元，但 textarea 的 height:100% 在部分浏览器
     *  仍会退回「容器可视高」，导致长代码滚下去后 textarea 覆盖不到那几行、
     *  点击失焦。这里按行数算出精确高度并写死，彻底消除歧义。
     *  高度 = padding上下 + (行数 + 1) × 行高；那个 +1 是 render() 给高亮层
     *  末尾补的 '\n'，行号槽补一个空 div 才能三者总高一致、滚到底时完全同步。*/
    syncHeight() {
      const { lh } = Editor._metrics();
      const cs = getComputedStyle(el.highlight);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const count = Math.max(1, el.input.value.split('\n').length);
      const h = Math.round(padY + (count + 1) * lh);
      el.highlight.style.height = h + 'px';
      el.input.style.height = h + 'px';
      // 行号槽末位补一个不可见占位行，使可滚上限与代码区一致
      const pad = el.gutter.lastElementChild;
      if (pad && pad.dataset.pad !== '1') {
        const ph = document.createElement('div');
        ph.className = 'gl gl-pad';
        ph.dataset.pad = '1';
        ph.setAttribute('aria-hidden', 'true');
        el.gutter.appendChild(ph);
      }
    },

    /** 高亮指定行（可视化执行时定位） */
    highlightLine(n, autoScroll) {
      const prev = el.gutter.querySelector('.gl.active');
      if (prev) prev.classList.remove('active');
      const cur = el.gutter.querySelector(`.gl[data-line="${n}"]`);
      if (cur) cur.classList.add('active');
      // 自动执行时把当前行滚进视野，否则长代码跑到下面就看不见了
      if (autoScroll !== false) Editor.scrollLineIntoView(n);
    },

    /* ---------- 滚动控制 ---------- */

    /** 让行高/padding 缓存与写死的高度失效：
     *  切换模式、窗口缩放、字体加载后需重测（Editor.render 会重算高度）。 */
    invalidateMetrics() {
      Editor._m = null;
      Editor._lineCount = -1;
      el.highlight.style.height = '';
      el.input.style.height = '';
    },

    /** 单行高度 / 内容 padding：读一次缓存，
     *  与 CSS 的 line-height:21px、padding:12px 保持一致即可。 */
    _metrics() {
      if (!Editor._m) {
        const cs = getComputedStyle(el.highlight);
        const lh = parseFloat(cs.lineHeight);
        Editor._m = {
          lh: Number.isFinite(lh) && lh > 0 ? lh : 21,
          pad: parseFloat(cs.paddingTop) || 0
        };
      }
      return Editor._m;
    },

    /** 让指定行滚入可视区。
     * near='strict'：仅在越界时滚动到底，浏览器原生行为（如按 End 跳文件尾）
     * near='soft'：留上下文余量，可视化逐行执行时用，不会显得跳。
     */
    scrollLineIntoView(n, near) {
      const sc = el.scroll;
      const { lh, pad } = Editor._metrics();
      // 行 n 的顶部在滚动内容里的偏移 = padding-top + (n-1) * 行高。
      // 行号槽与高亮层 padding 相同（均12px），因此两者天然对齐。
      const top = pad + (n - 1) * lh;
      const view = sc.clientHeight;
      const max = Math.max(0, sc.scrollHeight - view);   // 容器能滚到的最大值
      const set = v => { sc.scrollTop = Math.max(0, Math.min(max, v)); };

      if (near === 'strict') {
        if (top < sc.scrollTop) set(top);
        else if (top + lh > sc.scrollTop + view) set(top + lh - view);
      } else {
        // 上方留 1 行、底部留 2 行上下文
        if (top < sc.scrollTop + lh) set(top - lh);
        else if (top + lh > sc.scrollTop + view - lh * 2) set(top + lh * 2 - view);
      }
      Editor.syncGutter();
    },

    /** 按光标位置滚动（键盘输入 / 方向键 / Ctrl+End 时跟随） */
    scrollCaretIntoView() {
      const code = el.input.value;
      const pos = el.input.selectionStart || 0;
      const lineNo = code.slice(0, pos).split('\n').length;
      Editor.scrollLineIntoView(lineNo, 'strict');
    },

    /** 同步行号槽：纵向跟随代码区滚动 */
    syncGutter() {
      el.gutter.scrollTop = el.scroll.scrollTop;
    },

    /** 状态栏：行 / 列 / 缩进 */
    updateStatus() {
      const pos = el.input.selectionStart || 0;
      const before = el.input.value.slice(0, pos);
      const lines = before.split('\n');
      el.statLine.textContent = lines.length;
      el.statCol.textContent = lines[lines.length - 1].length + 1;

      const cur = lines[lines.length - 1];
      const m = cur.match(/^[ \t]*/);
      const ind = m ? m[0] : '';
      el.statIndent.textContent = !ind ? '无' : (ind.includes('\t') ? 'Tab' : ind.length + ' 空格');
    },

    /** 简易格式化：统一 4 空格缩进、大括号换行 */
    format() {
      const lines = el.input.value.split('\n');
      let depth = 0;
      const out = lines.map(raw => {
        let line = raw.replace(/\t/g, '    ').trim();
        if (!line) return '';
        // 右括号先减深度
        if (/^[}\])]/.test(line)) depth = Math.max(0, depth - 1);
        const res = '    '.repeat(depth) + line;
        // 统计行尾未闭合的左括号
        const opens = (line.match(/[{[(]/g) || []).length;
        const closes = (line.match(/[}\])]/g) || []).length;
        depth = Math.max(0, depth + opens - closes);
        return res;
      });
      Editor.setValue(out.join('\n'));
      toast('格式化完成', '已统一缩进为 4 空格', 'ok', 1800);
    }
  };

  /* ============================================================
   * 2.5 交互式控制台（像 Visual Studio 的控制台窗口）
   * ------------------------------------------------------------
   * 编译器遇到 scanf / input / getchar 时会 yield 一个 input 事件并挂起，
   * 这里负责：显示提示 → 聚焦输入框 → 用户回车 → 把值喂回生成器。
   *
   * 关键设计：
   *  · 等待输入时自动暂停动画调度，避免程序在等键盘时还在跑
   *  · 输入框始终可聚焦，但不抢焦点——用户正在编辑器里写代码时不打断
   *  · Esc 取消本次输入（喂空串），Ctrl+Enter 快速送入
   * ============================================================ */
  const Console = {
    text: '',
    waiting: false,       // 程序是否正卡在 input 事件上
    prompt: '',

    /** 追加程序输出 */
    write(s) {
      if (!Console.text) el.consoleOutput.textContent = '';
      Console.text += s;
      el.consoleOutput.textContent = Console.text;
      Console.scroll();
    },

    /** 只滚动到底部，不改内容（用于外部更新后） */
    scroll() {
      if (el.consoleBody) el.consoleBody.scrollTop = el.consoleBody.scrollHeight;
    },

    clear() {
      Console.text = '';
      el.consoleOutput.innerHTML = '<span class="vc-dim">（等待运行…）</span>';
    },

    /** 切换运行状态指示灯 */
    setState(state) {
      if (!el.vcLed) return;
      el.vcLed.className = 'vc-led' + (state ? ' ' + state : '');
      if (el.vcMode) {
        el.vcMode.textContent = state === 'wait' ? '等待输入' : (state === 'run' ? '运行中' : '空闲');
        el.vcMode.classList.toggle('live', state === 'wait');
      }
    },

    /**
     * 进入「等待输入」状态
     * @param {string} prompt 提示语（来自 scanf 格式串 / input 实参）
     * @param {string} kind   'scanf' | 'line' | 'char'
     */
    ask(prompt, kind) {
      Console.prompt = prompt || '';
      Console.waiting = true;
      Console.setState('wait');

      // 提示条
      el.vcWaitText.textContent = Console.prompt
        ? Console.prompt + ' —— 请输入后按回车'
        : '程序需要输入，请在此输入后按回车';
      el.vcWait.hidden = false;

      // 输入行
      el.vcPrompt.textContent = kind === 'scanf' ? '»' : '>';
      el.vcInput.placeholder = kind === 'char'
        ? '输入一个字符后按回车…'
        : '输入数据后按回车（多个值用空格隔开）';
      el.vcInput.value = '';
      el.vcInputLine.hidden = false;
      el.vcInputLine.classList.add('idle-caret');

      // 聚焦但不强行抢：如果用户正在编辑器里写代码，就不打扰
      const inEditor = document.activeElement === el.input;
      if (!inEditor) {
        el.vcInput.focus();
        requestAnimationFrame(() => { if (Console.waiting) el.vcInput.focus(); });
      }
      return true;
    },

    /** 用户送入一行：回显 + 存进 Viz._feed + 唤醒执行 */
    submit(text) {
      if (!Console.waiting) return false;
      const v = text != null ? text : el.vcInput.value;

      Console.waiting = false;
      el.vcInputLine.classList.remove('idle-caret');
      // 回显用户输入的内容，让终端历史完整（像真实命令行）
      Console.write(v + '\n');

      el.vcWait.hidden = true;
      el.vcInputLine.hidden = true;
      el.vcInput.value = '';
      Console.setState(Viz.running ? 'run' : '');

      Viz._feed = v;             // 由下一次 Viz.step() 喂回生成器
      Viz.pendingInput = false;
      if (Viz.timer) { clearTimeout(Viz.timer); Viz.timer = null; }
      Viz.step();
      return true;
    },

    /** 取消等待（喂空串，让程序继续） */
    cancel() {
      return Console.submit('');
    }
  };

  /* ============================================================
   * 3. 示例代码
   * ============================================================ */
  const SAMPLE_CODES = {
    bubble: {
      title: '冒泡排序',
      code: `#include <stdio.h>

int main(void) {
    int a[8] = {29, 10, 14, 37, 13, 5, 7, 22};
    int n = 8;
    int i, j, temp;

    printf("原始数组: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n\\n开始冒泡排序...\\n");

    for (i = 0; i < n - 1; i++) {
        for (j = 0; j < n - 1 - i; j++) {
            if (a[j] > a[j + 1]) {
                temp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = temp;
            }
        }
        printf("第 %d 轮结束: ", i + 1);
        for (j = 0; j < n; j++) {
            printf("%d ", a[j]);
        }
        printf("\\n");
    }

    printf("\\n排序结果: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n");
    return 0;
}`
    },
    select: {
      title: '选择排序',
      code: `#include <stdio.h>

int main(void) {
    int a[8] = {29, 10, 14, 37, 13, 5, 7, 22};
    int n = 8;
    int i, j, min, temp;

    printf("原始数组: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n\\n开始选择排序...\\n");

    for (i = 0; i < n - 1; i++) {
        min = i;
        for (j = i + 1; j < n; j++) {
            if (a[j] < a[min]) {
                min = j;
            }
        }
        if (min != i) {
            temp = a[i];
            a[i] = a[min];
            a[min] = temp;
        }
        printf("第 %d 轮: 最小值 %d 已就位 -> ", i + 1, a[i]);
        for (j = 0; j < n; j++) {
            printf("%d ", a[j]);
        }
        printf("\\n");
    }

    printf("\\n排序结果: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n");
    return 0;
}`
    },
    insert: {
      title: '插入排序',
      code: `#include <stdio.h>

int main(void) {
    int a[8] = {29, 10, 14, 37, 13, 5, 7, 22};
    int n = 8;
    int i, j, key;

    printf("原始数组: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n\\n开始插入排序...\\n");

    for (i = 1; i < n; i++) {
        key = a[i];
        j = i - 1;
        while (j >= 0 && a[j] > key) {
            a[j + 1] = a[j];
            j--;
        }
        a[j + 1] = key;
        printf("插入 %d 后: ", key);
        for (j = 0; j < n; j++) {
            printf("%d ", a[j]);
        }
        printf("\\n");
    }

    printf("\\n排序结果: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n");
    return 0;
}`
    },
    bubbleRev: {
      title: '降序冒泡',
      code: `#include <stdio.h>

int main(void) {
    int a[8] = {29, 10, 14, 37, 13, 5, 7, 22};
    int n = 8;
    int i, j, temp;

    printf("原始数组: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n\\n开始降序排序 (大数往前冒)...\\n");

    for (i = 0; i < n - 1; i++) {
        for (j = 0; j < n - 1 - i; j++) {
            if (a[j] < a[j + 1]) {
                temp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = temp;
            }
        }
    }

    printf("\\n排序结果: ");
    for (i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n");
    return 0;
}`
    },

    /* ---------- 交互程序示例 ---------- */

    guess: {
      title: '猜数字游戏',
      interactive: true,
      code: `#include <stdio.h>

/* 交互示例：while 循环 + scanf
 * 运行后到右侧控制台输入你的猜测，回车继续。 */
int main(void) {
    int secret = 42;      /* 我心里想的数 */
    int guess = 0;
    int cnt = 0;

    printf("我想好了一个 1~100 的数字，来猜猜看！\\n");
    printf("（提示：是个两位数）\\n\\n");

    while (1) {
        printf("第 %d 次猜测，请输入 1~100 的整数：", cnt + 1);
        scanf("%d", &guess);
        cnt++;

        if (guess < secret) {
            printf("  太小了，再往大一点猜\\n\\n");
        } else if (guess > secret) {
            printf("  太大了，往小一点试试\\n\\n");
        } else {
            printf("\\n  恭喜你猜中了！答案就是 %d\\n", secret);
            printf("  你一共猜了 %d 次\\n", cnt);
            break;
        }
    }

    return 0;
}`
    },

    calc: {
      title: '简易计算器',
      interactive: true,
      code: `#include <stdio.h>

/* 交互示例：do-while 循环 + if-else 运算分支 */
int main(void) {
    double x = 0, y = 0;
    double ans = 0;
    int op = 0;
    int running = 1;

    printf("===== 简易计算器 =====\\n");
    printf("运算码： 1=加 2=减 3=乘 4=除  0=退出\\n\\n");

    while (running) {
        printf("请输入两个数（用空格隔开）：");
        scanf("%lf %lf", &x, &y);

        printf("请输入运算码：");
        scanf("%d", &op);

        if (op == 1) {
            ans = x + y;
            printf("  %g + %g = %g\\n\\n", x, y, ans);
        } else if (op == 2) {
            ans = x - y;
            printf("  %g - %g = %g\\n\\n", x, y, ans);
        } else if (op == 3) {
            ans = x * y;
            printf("  %g * %g = %g\\n\\n", x, y, ans);
        } else if (op == 4) {
            if (y == 0) {
                printf("  除数不能为 0！\\n\\n");
            } else {
                ans = x / y;
                printf("  %g / %g = %g\\n\\n", x, y, ans);
            }
        } else if (op == 0) {
            printf("  退出计算器，再见！\\n");
            running = 0;
        } else {
            printf("  未知运算码 %d，请输入 0~4\\n\\n", op);
        }
    }

    return 0;
}`
    },

    grade: {
      title: '成绩等级判断',
      interactive: true,
      code: `#include <stdio.h>

/* 交互示例：循环 + 多分支 if-else
 * 逐个输入学生成绩，输入 -1 时结束统计。 */
int main(void) {
    int score = 0;
    int total = 0;
    int count = 0;
    int a = 0, b = 0, c = 0, d = 0, e = 0;

    printf("===== 成绩等级统计 =====\\n");
    printf("逐个输入成绩（0~100），输入 -1 结束\\n\\n");

    while (1) {
        printf("第 %d 个成绩：", count + 1);
        scanf("%d", &score);

        if (score == -1) {
            break;
        }
        if (score < 0 || score > 100) {
            printf("  成绩无效，请输入 0~100\\n\\n");
            continue;
        }

        total = total + score;
        count++;

        if (score >= 90) {
            printf("  优秀\\n\\n");
            a++;
        } else if (score >= 80) {
            printf("  良好\\n\\n");
            b++;
        } else if (score >= 70) {
            printf("  中等\\n\\n");
            c++;
        } else if (score >= 60) {
            printf("  及格\\n\\n");
            d++;
        } else {
            printf("  不及格\\n\\n");
            e++;
        }
    }

    printf("\\n===== 统计结果 =====\\n");
    printf("有效成绩：%d 个\\n", count);
    if (count > 0) {
        printf("平均分  ：%.1f\\n", (double)total / count);
    } else {
        printf("平均分  ：无数据\\n");
    }
    printf("优秀 %d / 良好 %d / 中等 %d / 及格 %d / 不及格 %d\\n", a, b, c, d, e);

    return 0;
}`
    }
  };

  /* ============================================================
   * 3.5 交换示意动画
   * ------------------------------------------------------------
   * 原来这里是一整条机械臂（导轨 + 小车 + 缆绳 + 抓爪），
   * 靠 CSS 变量 --rig-x / --rig-drop / --grip 分阶段驱动。
   * 抓爪已按需求移除，这里只保留「抬起 → 换位 → 放下」的
   * 视觉叙事：把待交换的两根柱子抬起来、点亮、再落下，
   * 让用户看清这一次 swap 事件到底交换了哪两根。
   *
   * 仍然是「写状态 + 等一小段时间」的多阶段结构，
   * 好处是任何时刻都能被「暂停 / 单步 / 重置」打断，不留残留状态。
   * ============================================================ */
  const SwapFx = {
    busy: false,
    canceled: false,
    seq: 0,                // 用于丢弃过期的定时器

    /** 复位到初始状态 */
    reset() {
      SwapFx.seq++;
      SwapFx.busy = false;
      SwapFx.canceled = false;
      SwapFx.clear();
    },

    /** 清掉所有临时高亮，保证不留残留姿态 */
    clear() {
      Viz.bars.forEach(b => {
        b.el.classList.remove('lifted', 'candidate');
      });
    },

    /** 睡 ms 毫秒（可被 cancel 打断），返回 false 表示被打断 */
    sleep(ms) {
      return new Promise(resolve => {
        const my = ++SwapFx.seq;
        setTimeout(() => {
          resolve(my === SwapFx.seq && !SwapFx.canceled);
        }, ms);
      });
    },

    /**
     * 「抬起 → 落下」的交换示意动画
     * @param {number} i左柱下标
     * @param {number} j       右柱下标
     * @param {number} speedMs 单阶段时长基准
     */
    async swap(i, j, speedMs) {
      if (SwapFx.busy) return;
      SwapFx.busy = true;
      SwapFx.canceled = false;
      const T = Math.max(90, Math.min(340, speedMs * 0.8));
      try {
        // 1) 抬起 + 点亮：告诉用户「就是这两根要换」
        Viz.bars[i] && Viz.bars[i].el.classList.add('lifted');
        Viz.bars[j] && Viz.bars[j].el.classList.add('lifted');
        if (!(await SwapFx.sleep(T))) return;

        // 2) 落下，真正的数值交换由紧随其后的 swap 事件改柱子高度
        SwapFx.clear();
        Viz.bars[i] && Viz.bars[i].el.classList.add('candidate');
        Viz.bars[j] && Viz.bars[j].el.classList.add('candidate');
        if (!(await SwapFx.sleep(T * 0.45))) return;
      } finally {
        SwapFx.busy = false;
        SwapFx.clear();
      }
    },

    /**
     * 立即中止并复位。
     * 中途点重置 / 暂停 / 换示例时，必须同步把视觉状态清干净，
     * 不能只置标志 —— 还在飞的定时器被丢弃后没人再负责收尾。
     */
    cancel() {
      SwapFx.canceled = true;
      SwapFx.seq++;
      SwapFx.busy = false;
      SwapFx.clear();
    }
  };

  /* ============================================================
   * 4. 可视化引擎
   * ============================================================ */

  const Viz = {
    bars: [],          // [{el, fill, val, idx}]
    arrayName: null,
    values: [],
    running: false,
    paused: false,
    stepPending: false,   // 本轮是否由「单步」触发（方法名是 stepOnce，标志必须另起名）
    iterator: null,
    runner: null,          // createRunner 返回的运行器（取 stats /喂输入）
    animating: false,      // 交换示意动画播放中
    timer: null,
    logSeq: 0,
    sortedCount: 0,
    consoleText: '',
    pendingInput: false,   // 正卡在 input 事件上等用户敲键盘
    _feed: null,// 待喂给生成器的输入值

    /** 速度（毫秒/步） */
    get speed() { return parseInt(el.vizSpeedSel.value, 10) || 300; },

    /** 创建/重建柱状图 */
    buildBars(values) {
      el.vizBars.innerHTML = '';
      Viz.bars = [];
      Viz.values = values.slice();

      const max = Math.max(...values.map(v => Math.abs(v)), 1);
      values.forEach((v, i) => {
        const bar = document.createElement('div');
        bar.className = 'viz-bar bar-enter';
        // 每根柱子错开 45ms 入场，形成「依次长出来」的波浪感
        bar.style.setProperty('--enter-delay', (i * 45) + 'ms');
        bar.dataset.idx = i;

        const fill = document.createElement('div');
        fill.className = 'viz-bar-fill';
        fill.style.height = Math.max(4, (Math.abs(v) / max) * 100) + '%';

        const val = document.createElement('span');
        val.className = 'viz-bar-val';
        val.textContent = v;

        const idx = document.createElement('span');
        idx.className = 'viz-bar-idx';
        idx.textContent = i;

        bar.appendChild(val);
        bar.appendChild(fill);
        bar.appendChild(idx);
        el.vizBars.appendChild(bar);

        Viz.bars.push({ el: bar, fill, val, idx, base: Math.abs(v) });
      });
      el.vizEmpty.style.display = 'none';
      SwapFx.reset();

      // 入场动画（长高）放完后摘掉标记类，
      // 否则 bar-enter 的 animation 会一直占着 transform，和 compare/swap 的位移打架。
      const last = Viz.bars.length ? Viz.bars[Viz.bars.length - 1].el : null;
      if (last) {
        setTimeout(() => {
          Viz.bars.forEach(b => b.el.classList.remove('bar-enter'));
        }, values.length * 45 + 750);
      }
    },

    /** 更新某根柱子的高度与数值 */
    setBar(i, value, max) {
      const b = Viz.bars[i];
      if (!b) return;
      b.val.textContent = value;
      b.fill.style.height = Math.max(4, (Math.abs(value) / max) * 100) + '%';
    },

    /**
     * 重放某根柱子上的 CSS 动画。
     *
     * CSS animation 一旦播完就停在终态；之后如果只是把class 摘掉再原样加回，
     * 浏览器会认为是「同一个动画还在」，直接沿用终态，不会重新播放。
     * 所以必须先强制回流（读 offsetWidth）让动画状态归零，再加类。
     * 冒泡排序里同一对柱子会反复交换，没有这一步就只剩第一次有弹跳。
     */
    replay(node, cls) {
      if (!node) return;
      node.classList.remove(cls);
      void node.offsetWidth;   // 强制重排
      node.classList.add(cls);
    },

    /**
     * 清除高亮状态。
     * @param {boolean} [keepSorted=true] 保留 .sorted（已排定）标记。
     *   比较/交换时只需要清掉临时的compare / swap / lifted 高亮，
     *   不该把已经确认排好的绿色柱子打回青色 —— 否则选择排序里
     *   每比较一次，之前定好的位置就重新变青，视觉上「白干」。
     *   reset() 和 end 事件传false，做全量清除。
     */
    clearMarks(keepSorted) {
      Viz.bars.forEach(b => {
        const kill = keepSorted === false
          ? ['compare', 'swap', 'sorted', 'lifted', 'candidate']
          : ['compare', 'swap', 'lifted', 'candidate'];
        b.el.classList.remove.apply(b.el.classList, kill);
      });
    },

    /** 重置整个可视化面板 */
    reset() {
      Viz.stop();
      SwapFx.reset();
      Viz.clearMarks(false);
      Viz.logSeq = 0;
      el.vizLog.innerHTML = '';
      el.statCompare.textContent = '0';
      el.statSwap.textContent = '0';
      el.statRound.textContent = '0';
      el.varList.innerHTML = '<div class="vv-item vv-idle">等待运行…</div>';
      el.btnVizPause.disabled = true;
      el.btnVizStep.disabled = true;
      el.btnVizPause.textContent = '⏸ 暂停';
      el.vizEmpty.style.display = Viz.bars.length ? 'none' : 'flex';
      Viz.setCodeline(null);
    },

    /**
     * 彻底清空柱状图。
     * reset() 只复位状态机，不动柱子 DOM —— 因为可视化中途重置时
     * 保留柱子更连贯。但「换一个没有数组的程序」时必须调这个，
     * 否则上一段代码的柱子会留在屏幕上，误导用户。
     */
    clearBars() {
      el.vizBars.innerHTML = '';
      Viz.bars = [];
      Viz.values = [];
      Viz.arrayName = null;
      el.vizEmpty.style.display = 'flex';
    },

    /**
     * 更新「当前执行代码」浮层
     * 这是把动画和代码绑定的关键：每一行代码执行时，
     * 下方浮层立刻显示这一行的原文 + 行号，编辑器里也同步高亮。
     */
    setCodeline(line, vars) {
      if (!line) {
        el.vizCodelineText.textContent = '点击「运行可视化」后，这里会实时显示正在执行的那一行代码';
        el.vizCodeline.classList.remove('flash');
        return;
      }
      const src = (Editor.getValue() || '').split('\n');
      let text = src[line - 1] != null ? src[line - 1] : '';
      if (!text.trim()) {
        // 空行（多为 { 或 } ）：向上找一行有内容的，标注出来更易懂
        for (let k = line - 2; k >= 0 && k > line - 6; k--) {
          if (src[k] && src[k].trim()) { text = src[k]; break; }
        }
      }
      const ln = document.createElement('span');
      ln.className = 'vcl-ln';
      ln.textContent = line;
      el.vizCodelineText.textContent = '';
      el.vizCodelineText.appendChild(ln);
      // 该行涉及的变量值直接跟在后面 —— Visual Studio 调试器的内联变量效果
      const names = Viz.varsOnLine(line);
      if (vars && names.length) {
        const chips = names
          .filter(n => vars[n] !== undefined)
          .map(n => {
            const v = vars[n];
            const show = typeof v === 'number'
              ? (Number.isInteger(v) ? v : Number(v).toFixed(2))
              : v;
            return n + '=' + show;
          });
        if (chips.length) el.vizCodelineText.appendChild(document.createTextNode('   ' + chips.join('  ')));
      }
      el.vizCodelineText.appendChild(document.createTextNode(text));
      el.vizCodeline.classList.add('flash');
      // 长代码横向滚动到末尾，保证正文可见
      el.vizCodelineText.scrollLeft = el.vizCodelineText.scrollWidth;
    },

    /** 取出某一行里出现的变量名（用于内联显示值） */
    varsOnLine(line) {
      const src = (Editor.getValue() || '').split('\n');
      const text = src[line - 1];
      if (!text) return [];
      // 去掉字符串字面量与注释，避免把 printf 里的字当成变量
      const clean = text
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/\/\/.*$/, '')
        .replace(/\/\*.*?\*\//g, '');
      const found = [];
      clean.replace(/\b([A-Za-z_]\w*)\b/g, (m, id) => {
        if (C_KEYWORDS_TEST.test(m)) return m;
        if (['printf', 'scanf', 'puts', 'putchar', 'input', 'getchar', 'main', 'sizeof'].indexOf(id) !== -1) return m;
        if (found.indexOf(id) === -1) found.push(id);
        return m;
      });
      return found;
    },

    /** 追加一行日志 */
    log(text, cls) {
      const row = document.createElement('div');
      row.className = 'lg-row';
      row.innerHTML = `<span class="lg-no">${++Viz.logSeq}</span><span class="lg-txt ${cls || ''}">${text}</span>`;
      el.vizLog.appendChild(row);
      // 限制日志条数，防止长时间运行撑爆 DOM
      while (el.vizLog.children.length > 120) el.vizLog.firstChild.remove();
      el.vizLog.scrollTop = el.vizLog.scrollHeight;
    },

    /** 更新变量面板 */
    updateVars(vars) {
      if (!vars) return;
      const keys = Object.keys(vars);
      if (!keys.length) {
        el.varList.innerHTML = '<div class="vv-item vv-idle">暂无变量</div>';
        return;
      }
      // i、j、n、t 优先展示，其余按字母序
      const PRI = ['i', 'j', 'k', 'n', 't', 'm', 'min', 'max', 'p', 'q', 'key', 'left', 'right', 'mid'];
      keys.sort((a, b) => {
        const ia = PRI.indexOf(a), ib = PRI.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });

      el.varList.innerHTML = keys.slice(0, 12).map(k => {
        const cls = PRI.indexOf(k) !== -1 ? ' k-' + k : '';
        const v = vars[k];
        const show = typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v;
        return `<div class="vv-item${cls}">${esc(k)} = <b>${esc(show)}</b></div>`;
      }).join('');

      // 当前循环变量 i / j 在柱状图底部高亮
      Viz.bars.forEach((b, i) => {
        b.idx.classList.toggle('pivot', vars.i === i || vars.j === i);
      });
    },

    /** 数字滚动动画（让统计变化更醒目） */
    bump(node) {
      node.classList.add('flash');
      setTimeout(() => node.classList.remove('flash'), 220);
    },

    /* ---------------- 事件消费 ---------------- */

    /**
     * @param {object} ev  解释器事件
     * @param {object} state 运行时快照（含 stats）
     * @returns {Promise<void>|void} 需要等待动画时返回 Promise
     */
    handleEvent(ev, state) {
      const max = Math.max(...Viz.values.map(v => Math.abs(v)), 1);

      switch (ev.type) {

        case 'array': {
          Viz.arrayName = ev.name;
          // 「仅运行」模式不画柱状图：交互程序通常没有数组，
          // 有的话也不需要动画，快速跑完即可。
          if (Viz.plain) break;
          Viz.buildBars(ev.values);
          Viz.values = ev.values.slice();
          Viz.log(`声明数组 <em>${esc(ev.name)}[${ev.size}]</em> = { ${ev.values.join(', ')} }`);
          break;
        }

        case 'line':
          if (ev.line) {
            Editor.highlightLine(ev.line);
            Viz.setCodeline(ev.line, ev.vars);
          }
          break;

        case 'setVar': {
          Viz.updateVars(ev.vars);
          if (ev.line) Viz.setCodeline(ev.line, ev.vars);
          if (ev.vars && Object.keys(ev.vars).length <= 3) {
            Viz.log(`赋值 <em>${esc(ev.name)}</em> = ${ev.value}`);
          }
          break;
        }

        case 'loop':
          Viz.updateVars(ev.vars);
          el.statRound.textContent = ev.round;
          if (ev.line) { Editor.highlightLine(ev.line); Viz.setCodeline(ev.line, ev.vars); }
          if (ev.round <= 60) Viz.log(`<em>第 ${ev.round} 轮</em> 循环开始`);
          break;

        case 'compare': {
          Viz.updateVars(ev.vars);
          Viz.clearMarks();
          if (ev.line) { Editor.highlightLine(ev.line); Viz.setCodeline(ev.line, ev.vars); }

          const l = ev.lhs, r = ev.rhs;
          const li = (l && l.kind === 'array') ? l.index : -1;
          const ri = (r && r.kind === 'array') ? r.index : -1;

          // 只有涉及数组元素的比较才对柱子高亮、对统计计数。
          // 循环条件的比较（i < n-1、j < n-1-i）跟柱状图无关，
          // 既不该点亮柱子，也不该刷屏日志 —— 否则真正的比较被淹没在几十行
          // 「比较 7 < 8 → 需交换」里（那其实是循环条件，不是数组比较）。
          if (li >= 0 && Viz.bars[li]) Viz.bars[li].el.classList.add('compare');
          if (ri >= 0 && Viz.bars[ri]) Viz.bars[ri].el.classList.add('compare');

          const isArrCmp = li >= 0 || ri >= 0;
          if (isArrCmp) {
            el.statCompare.textContent = ev.compare;
            Viz.bump(el.statCompare);

            const lv = li >= 0 ? `${ev.lhs.name}[${l.index}]=${l.value}` : (l ? l.value : '?');
            const rv = ri >= 0 ? `${ev.rhs.name}[${r.index}]=${r.value}` : (r ? r.value : '?');
            const mark = ev.result ? '需交换' : '顺序正确';
            Viz.log(`比较 <span class="cmp">${lv}</span> ${ev.op} <span class="cmp">${rv}</span> → ${mark}`);
          }

          // 交换示意：只在真的要交换时抬柱，两根柱子在可视范围内才动
          if (ev.result && li >= 0 && ri >= 0 && li !== ri && !SwapFx.busy && !Viz.plain && Viz.bars.length) {
            return SwapFx.swap(li, ri, Viz.speed);
          }
          break;
        }

        case 'swap': {
          Viz.values[ev.i] = ev.to;
          Viz.values[ev.j] = ev.from;
          Viz.setBar(ev.i, ev.to, max);
          Viz.setBar(ev.j, ev.from, max);
          Viz.updateVars(ev.vars);
          if (ev.line) { Editor.highlightLine(ev.line); Viz.setCodeline(ev.line, ev.vars); }

          Viz.clearMarks();
          // 用 replay 而不是 add：同一对柱子会反复交换，
          // 不重启动画的话只有第一次弹跳，后面全部静默变高度。
          Viz.replay(Viz.bars[ev.i] && Viz.bars[ev.i].el, 'swap');
          Viz.replay(Viz.bars[ev.j] && Viz.bars[ev.j].el, 'swap');

          el.statSwap.textContent = ev.swap;
          Viz.bump(el.statSwap);
          Viz.log(`<span class="swp">交换</span> ${ev.name}[${ev.i}] ↔ ${ev.name}[${ev.j}] : ${ev.from} ↔ ${ev.to}`);
          break;
        }

        case 'set': {
          Viz.values[ev.index] = ev.to;
          Viz.setBar(ev.index, ev.to, max);
          Viz.updateVars(ev.vars);
          if (ev.line) { Editor.highlightLine(ev.line); Viz.setCodeline(ev.line, ev.vars); }
          Viz.replay(Viz.bars[ev.index] && Viz.bars[ev.index].el, 'swap');
          el.statSwap.textContent = state.stats.swap;
          Viz.log(`写入 ${ev.name}[${ev.index}] : ${ev.from} → ${ev.to}`);
          break;
        }

        case 'print':
          Console.write(ev.text);
          break;

        case 'input':
          // 编译器在这里挂起（生成器停在 yield 上），等用户从控制台输入。
          // ★ 这里绝不能 await —— 一 await 整个动画循环就卡死了。
          //   正确做法：把值存进 Viz._feed，由 Console.submit() 唤醒 step()，
          //   step() 里用 iterator.next(值) 把输入喂回程序。
          Viz.pendingInput = true;
          Viz.log('<span class="fin">⌨</span> 等待输入…', '');
          Console.ask(ev.prompt, ev.kind);
          break;

        case 'error':
          Console.write('\n❌ ' + ev.message);
          Viz.log(`<span class="swp">错误</span> ${esc(ev.message)}`, '');
          toast('运行出错', esc(ev.message), 'err', 4200);
          break;

        case 'end': {
          Viz.clearMarks(false);
          // 逐根错开点亮，形成一道从左到右的绿色波浪（配合 CSS 的 sortedPop）
          Viz.bars.forEach((b, i) => {
            b.el.style.setProperty('--sorted-delay', (i * 70) + 'ms');
            Viz.replay(b.el, 'sorted');
          });
          Console.write(`\n✅ 运行结束 · 比较 ${ev.stats.compare} 次 · 交换 ${ev.stats.swap} 次 · 共 ${ev.stats.round} 轮\n`);
          Viz.log(`<span class="fin">✔ 执行完毕</span>：比较 ${ev.stats.compare} 次，交换 ${ev.stats.swap} 次，循环 ${ev.stats.round} 轮`, '');
          break;
        }
      }
    },

    /* ---------------- 播放控制 ---------------- */

    /**
     * 启动可视化
     * @param {object} [opt]
     * @param {boolean} [opt.plain] true = 「仅运行」模式：
     *   没有任何数组时不画柱状图，但仍保留行高亮与交互输入；
     *   有数组时照样画，只是速度快得多（8ms/步），让交互程序感觉像在实时跑。
     */
    start(opt) {
      const source = Editor.getValue();
      const runner = CCompiler.createRunner(source);
      const plain = !!(opt && opt.plain);

      if (!runner.ok) {
        toast('编译失败', esc(runner.error) + (runner.line ? `（第 ${runner.line} 行）` : ''), 'err', 5000);
        Viz.log(`<span class="swp">编译错误</span> ${esc(runner.error)}`);
        return;
      }

      Viz.reset();
      // 静态分析：没有数组声明就别留上一段代码的柱子
      const info = CCompiler.analyze(source);
      if (!info.arrayName) Viz.clearBars();
      // 交互输入检测
      if (info.hasInput) {
        Viz.log(`检测到交互输入（${info.inputFuncs.join(' / ')}），程序运行到那里会等你输入`, '');
        toast('交互式程序', '运行后请在右侧控制台输入数据并回车', 'warn', 3200);
      }

      Viz.iterator = runner.start();
      Viz.runner = runner;
      Viz.running = true;
      Viz.paused = false;
      Viz.pendingInput = false;
      Viz.plain = plain;
      el.btnVizPause.disabled = false;
      el.btnVizStep.disabled = false;
      el.btnVizPause.textContent = '⏸ 暂停';
      Console.setState('run');
      Viz.log(plain
        ? '<em>编译通过</em>，开始执行（快速模式）…'
        : '<em>编译通过</em>，开始执行…', '');

      Viz.step();
    },

    /** 速度（毫秒/步）—— 只对「有视觉变化」的步骤生效 */
    get stepDelay() {
      if (Viz.plain) return 8;
      return Viz.paused ? 200 : Viz.speed;
    },

    /**
     * 空转步骤的等待（毫秒）。
     *
     * ★ 为什么需要它：解释器每个「执行一步」都会 yield 一个事件，可冒泡排序
     *   699 步里只有 47 步真正改变了柱状图（array / 数组间compare / swap / set），
     *   其余 652 步是line / setVar / loop / 循环变量比较 / print —— 画面完全不变。
     *   早期版本对所有步骤一律按用户选的 300ms 等待，等于 93% 的时间在干等：
     *   用户盯着不动的柱子等十几秒才有一次交换，于是以为「动画没了」。
     *
     *   现在把「无视觉变化」的步骤压缩到skipDelay 快速掠过，
     *   只有真正该看的步骤才慢放，节奏立刻紧凑起来。
     */
    get skipDelay() {
      if (Viz.plain) return 8;
      // 上限 45ms：再快也留一帧让浏览器绘制高亮变化，
      // 否则连续空转时页面看起来像卡死，而且会掉帧。
      return Math.max(6, Math.min(45, Math.round(Viz.speed / 6)));
    },

    /** 调度下一帧 */
    schedule(delay) {
      if (!Viz.running || !Viz.iterator) return;
      // 程序正等输入时不再推进：等Console.submit() 唤醒
      if (Viz.pendingInput) return;
      if (Viz.timer) clearTimeout(Viz.timer);
      Viz.timer = setTimeout(() => Viz.step(), delay == null ? Viz.stepDelay : delay);
    },

    /**
     * 推进一步
     * 交换示意动画是异步的（要等定时器走完），所以 step 也是 async：
     * 动画播放期间不推进解释器，播完再继续。这样"抬起→交换→放下"
     * 才看得出是这一次 swap 事件造成的，而不是瞬间跳变。
     */
    async step() {
      if (!Viz.running || !Viz.iterator) return;
      if (Viz.timer) { clearTimeout(Viz.timer); Viz.timer = null; }

      // 暂停时只响应「单步」指令
      if (Viz.paused && !Viz.stepPending) { Viz.schedule(); return; }
      Viz.stepPending = false;

      let r;
      try {
        // ★ 顺序至关重要：先判断有没有待喂的输入。
        //   生成器正停在 `yield inputEvent` 上，若先调 next() 无参会把它
        //   推进到下一个 yield（用户输入的值被丢弃），再喂就晚了 —— 表现为
        //   「scanf 收到 0 / 变量一直是初值」。
        if (Viz._feed !== null) {
          const v = Viz._feed;
          Viz._feed = null;
          r = Viz.iterator.next(v);
        } else {
          r = Viz.iterator.next();
        }
      } catch (e) {
        Viz.stop();
        toast('运行异常', esc(e.message || String(e)), 'err', 4000);
        return;
      }

      if (r.done) { Viz.stop(); return; }

      let visual = true;
      try {
        const st = { stats: (Viz.runner && Viz.runner.stats) || { swap: 0 } };
        visual = Viz.isVisualEvent(r.value);
        const p = Viz.handleEvent(r.value, st);
        if (p && typeof p.then === 'function') {
          Viz.animating = true;          // 动画期间不接受新的推进
          await p;
          Viz.animating = false;
        }
      } catch (e) {
        // 单个事件绘制失败不应中断整个动画
        console.warn('[viz] 事件处理异常：', e);
      }

      // 动画/输入期间不要抢跑，等它们主动唤醒
      if (!Viz.animating && !Viz.pendingInput) {
        Viz.schedule(visual ? Viz.stepDelay : Viz.skipDelay);
      }
    },

    /**
     * 判断一个事件是否会改变柱状图 / 统计面板的可见状态。
     *
     * 只有这几类值得让用户停下来看：
     *   - array    ：声明数组，画出柱子
     *   - compare  ：**两侧有数组元素**时（a[j] > a[j+1]）才高亮柱子；
     *               循环条件的比较（i < n-1）画面不变，算空转
     *   - swap / set：真的写了数组元素
     *   - end      ：全部标绿
     *   - print    ：控制台有输出，停顿一下更跟得上（但不受 4x 影响）
     * 其余 line / setVar / loop / 循环变量比较一律快速掠过。
     */
    isVisualEvent(ev) {
      if (!ev) return false;
      switch (ev.type) {
        case 'array':
        case 'swap':
        case 'set':
        case 'end':
          return true;
        case 'compare':
          return !!((ev.lhs && ev.lhs.kind === 'array') || (ev.rhs && ev.rhs.kind === 'array'));
        case 'print':
          return !Viz.plain;
        default:
          return false;
      }
    },

    /** 暂停 / 继续 */
    togglePause() {
      if (!Viz.running) return;
      Viz.paused = !Viz.paused;
      el.btnVizPause.textContent = Viz.paused ? '▶ 继续' : '⏸ 暂停';
      if (!Viz.paused) Viz.schedule();
    },

    /**
     * 单步执行。
     *
     * ★ 方法名不能叫 stepOnce：对象里已经有一个 `stepOnce: false` 的
     *   布尔标志（表示「本轮是否是被单步触发的」），同名方法会把标志覆盖掉，
     *   于是 `Viz.stepOnce()` 直接报TypeError —— 「单步」按钮彻底失效。
     *   标志改叫 stepPending，方法保留 stepOnce。
     */
    stepOnce() {
      if (!Viz.running) return;
      Viz.paused = true;
      el.btnVizPause.textContent = '▶ 继续';
      Viz.stepPending = true;
      if (Viz.timer) clearTimeout(Viz.timer);
      Viz.step();
    },

    stop() {
      Viz.running = false;
      Viz.paused = false;
      Viz.animating = false;
      Viz.iterator = null;
      SwapFx.cancel();
      if (Viz.timer) { clearTimeout(Viz.timer); Viz.timer = null; }
      el.btnVizPause.disabled = true;
      el.btnVizStep.disabled = true;
      el.btnVizPause.textContent = '⏸ 暂停';
      Console.setState('');
    }
  };

  /* ============================================================
   * 5. 刷题模块
   * ============================================================ */
  const Quiz = {
    list: [],
    pool: [],          // 全部题目（未筛选）
    index: 0,
    answered: false,       // 本题是否已提交过
    selected: null,        // 选择题：选中的下标
    fillVals: {},          // 填空题：各空的值
    filterChapter: '',
    filterType: '',

    init() {
      // 合并两个题库：questionBank.js 的 22 道基础题 + questionBank1000.js 的 1000 道
      const base = QuestionBank.getAll();
      const big = (typeof QuestionBank1000 !== 'undefined') ? QuestionBank1000.getAll() : [];
      Quiz.pool = base.concat(big);
      Quiz.buildChapterOptions();
      Quiz.applyFilter();
      Quiz.index = 0;
      Quiz.render();
    },

    /** 用章节列表填充下拉框 */
    buildChapterOptions() {
      if (!el.selChapter) return;
      const seen = new Map();
      Quiz.pool.forEach(q => {
        if (q.chapter && !seen.has(q.chapter)) seen.set(q.chapter, 0);
        if (q.chapter) seen.set(q.chapter, seen.get(q.chapter) + 1);
      });
      const opts = ['<option value="">全部章节</option>'];
      seen.forEach((n, name) => {
        opts.push(`<option value="${esc(name)}">${esc(name)}（${n}）</option>`);
      });
      el.selChapter.innerHTML = opts.join('');
    },

    /** 按当前筛选条件重建 list */
    applyFilter() {
      Quiz.list = Quiz.pool.filter(q => {
        if (Quiz.filterChapter && q.chapter !== Quiz.filterChapter) return false;
        if (Quiz.filterType && q.type !== Quiz.filterType) return false;
        return true;
      });
      if (Quiz.index >= Quiz.list.length) Quiz.index = 0;
    },

    current() { return Quiz.list[Quiz.index]; },

    /** 题型对应的中文名与展示形态 */
    typeMeta(q) {
      switch (q.type) {
        case 'choice': return { label: '选择题', hasOptions: true };
        case 'fill': return { label: '代码填空题', hasOptions: false };
        case 'read': return { label: '程序阅读题', hasOptions: false };
        case 'code': return { label: '编程题', hasOptions: false };
        default: return { label: '题目', hasOptions: true };
      }
    },

    render() {
      const q = Quiz.current();
      if (!q) {
        el.quizIndex.textContent = '0 / 0';
        el.qStem.innerHTML = '<span style="color:var(--txt-dim)">当前筛选条件下没有题目，换个筛选试试。</span>';
        el.quizOptions.hidden = true;
        el.quizFill.hidden = true;
        el.quizCode.hidden = true;
        el.quizFeedback.hidden = true;
        return;
      }

      Quiz.answered = false;
      Quiz.selected = null;
      Quiz.fillVals = {};

      const meta = Quiz.typeMeta(q);
      el.quizIndex.textContent = `${Quiz.index + 1} / ${Quiz.list.length}`;
      el.qType.textContent = meta.label;
      el.qDiff.textContent = ['', '入门', '进阶', '困难'][q.diff] || '入门';
      el.qDiff.dataset.lv = q.diff;
      el.qPoint.textContent = `+${q.point} 分`;

      // 章节标签（仅大题库有）
      if (q.chapter) {
        el.qChapter.hidden = false;
        el.qChapter.textContent = q.chapter;
      } else if (el.qChapter) {
        el.qChapter.hidden = true;
      }

      el.qStem.innerHTML = q.stem;
      el.quizFeedback.hidden = true;
      el.quizFeedback.className = 'quiz-feedback';

      if (meta.hasOptions) {
        el.quizCode.hidden = true;
        el.quizFill.hidden = true;
        el.quizOptions.hidden = false;
        el.quizOptions.innerHTML = q.options.map((opt, i) => `
          <div class="qo-item" data-opt="${i}">
            <div class="qo-key">${'ABCD'[i] || i + 1}</div>
            <div class="qo-text">${opt}</div>
            <div class="qo-mark"></div>
          </div>`).join('');
      } else if (q.type === 'fill') {
        el.quizOptions.hidden = true;
        el.quizOptions.innerHTML = '';
        if (q.code) {
          el.quizCode.hidden = false;
          el.quizCode.innerHTML = highlightC(q.code);
        } else {
          el.quizCode.hidden = true;
        }
        el.quizFill.hidden = false;
        el.quizFill.innerHTML = q.blanks.map(b => `
          <div class="qf-row">
            <div class="qf-label">${esc(b.label)}</div>
            <input class="qf-input" data-blank="${esc(b.id)}" placeholder="在此输入答案" spellcheck="false">
          </div>`).join('');
      } else {
        // read / code：展示代码区
        el.quizOptions.hidden = true;
        el.quizOptions.innerHTML = '';
        if (q.type === 'read') {
          // 程序阅读题需要一个作答输入框
          el.quizCode.hidden = false;
          el.quizCode.innerHTML = highlightC(q.code || '');
          el.quizFill.hidden = false;
          el.quizFill.innerHTML = `
            <div class="qf-row">
              <div class="qf-label">运行结果</div>
              <input class="qf-input" data-blank="__read"
                     placeholder="写出程序的输出结果，例如：1 2 3" spellcheck="false">
            </div>
            <div class="qf-hint">按输出顺序写，中间用空格分隔；多个 printf 之间不需要额外空格。</div>`;
        } else if (q.type === 'code') {
          const ref = q.refcode || '（本题没有给出参考程序）';
          el.quizFill.hidden = true;
          el.quizFill.innerHTML = '';
          el.quizCode.hidden = false;
          el.quizCode.innerHTML =
            `<div class="qc-note">💡 编程实践题 —— 切到「可视化演示」模式，在左侧编辑器里自己写一遍再点运行。</div>`
            + `<div class="qc-note-sub">参考程序：</div>`
            + highlightC(ref);
        } else {
          el.quizCode.hidden = true;
        }
      }

      // 编程题：提交按钮改为「我已完成，看解析」
      el.btnSubmitAnswer.disabled = (q.type === 'code');
      el.btnSubmitAnswer.textContent = (q.type === 'code') ? '本题自评式' : '提交答案';

      el.btnPrevQ.disabled = Quiz.index === 0;
      el.btnNextQ.disabled = Quiz.index === Quiz.list.length - 1;
    },

    /** 提交答案 → 判分 → 计分 → 升级 */
    submit() {
      const q = Quiz.current();
      if (!q) return;

      if (q.type === 'code') {
        this.explain();
        toast('编程题', '这是实践题，写完代码用「仅运行」验证后点「查看解析」对照参考程序', 'info', 3200);
        return;
      }

      if (Quiz.answered) {
        toast('已提交', '本题已经判过分了，换下一题吧', 'warn', 2000);
        return;
      }

      let userAns;
      if (q.type === 'choice') {
        if (Quiz.selected === null) {
          toast('未选择', '请先选择一个选项', 'warn', 2000);
          return;
        }
        userAns = Quiz.selected;
      } else if (q.type === 'read') {
        const v = (el.quizFill.querySelector('[data-blank="__read"]') || {}).value;
        if (!v || !v.trim()) {
          toast('未作答', '请先写出程序的运行结果', 'warn', 2000);
          return;
        }
        userAns = { __read: v };
      } else {
        const filled = q.blanks.every(b => (Quiz.fillVals[b.id] || '').trim() !== '');
        if (!filled) {
          toast('未填完整', '请把所有空都填写上', 'warn', 2000);
          return;
        }
        userAns = Quiz.fillVals;
      }

      const result = Quiz.checkAnswer(q, userAns);
      const isRepeat = ScoreCalc.isCleared(q.id);
      const scoreRes = ScoreCalc.submit({
        qid: q.id,
        title: Quiz.plainText(q.stem).slice(0, 40),
        point: q.point,
        correct: result.correct,
        isRepeat
      });

      Quiz.answered = true;
      Quiz.showResult(q, result, scoreRes, isRepeat);
      LevelUI.renderAll();

      if (scoreRes.levelUp) {
        LevelUI.celebrate(scoreRes.from, scoreRes.to);
      }
    },

    /** 统一判分入口：fill 走 QuestionBank.check，其余本地判定 */
    checkAnswer(q, userAns) {
      if (q.type === 'fill') return QuestionBank.check(q, userAns);

      if (q.type === 'choice') {
        const ok = Number(userAns) === Number(q.answer);
        return { correct: ok, detail: { picked: userAns, right: q.answer } };
      }

      // read：程序阅读题，按「标准化后完全匹配」判分
      const norm = s => String(s == null ? '' : s)
        .trim()
        .replace(/\s+/g, ' ')       // 任意空白 → 单空格
        .replace(/[，,]/g, ',')
        .toLowerCase();
      const got = norm(userAns.__read);
      const want = norm(q.answer);
      const ok = got === want;
      return { correct: ok, detail: { got: userAns.__read, want: q.answer, ok } };
    },

    /** 去掉 HTML 标签，得到纯文本（用于答题记录标题） */
    plainText(html) {
      return String(html == null ? '' : html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    },

    /** 展示判分结果 */
    showResult(q, result, scoreRes, isRepeat) {
      if (q.type === 'choice') {
        const items = el.quizOptions.querySelectorAll('.qo-item');
        items.forEach((it, i) => {
          if (i === q.answer) {
            it.classList.add('correct');
            it.querySelector('.qo-mark').textContent = '✓';
          }
          if (i === Quiz.selected && !result.correct) {
            it.classList.add('wrong');
            it.querySelector('.qo-mark').textContent = '✕';
          }
        });
      } else if (q.type === 'fill') {
        q.blanks.forEach(b => {
          const input = el.quizFill.querySelector(`[data-blank="${b.id}"]`);
          const d = result.detail[b.id];
          if (!input) return;
          input.classList.add(d.ok ? 'correct' : 'wrong');
          input.value = d.ok ? input.value : `${input.value}  →  ${d.want}`;
        });
      } else if (q.type === 'read') {
        const input = el.quizFill.querySelector('[data-blank="__read"]');
        const d = result.detail;
        if (input) {
          input.classList.add(d.ok ? 'correct' : 'wrong');
          if (!d.ok) input.value = `${input.value}  →  ${d.want}`;
        }
      }

      const fb = el.quizFeedback;
      fb.hidden = false;
      if (result.correct) {
        fb.className = 'quiz-feedback ok';
        const bonusNote = scoreRes.gain > q.point
          ? `（含连对奖励 <span class="qf-gain">+${scoreRes.gain - q.point}</span>）`
          : '';
        const repeatNote = isRepeat ? '<br><span style="opacity:.75">↻ 该题此前已答对，重复练习仅 +1 分</span>' : '';
        fb.innerHTML = `<div class="qf-title">✅ 答对了！获得 <span class="qf-gain">+${scoreRes.gain} 分</span>${bonusNote}</div>
                        <div class="qf-body">${repeatNote}</div>`;
        toast('答对啦！', `+${scoreRes.gain} 积分${scoreRes.streak > 1 ? ` · 已连对 ${scoreRes.streak} 题` : ''}`, 'ok');
      } else {
        fb.className = 'quiz-feedback no';
        let right;
        if (q.type === 'choice') {
          right = `正确答案：<code>${'ABCD'[q.answer] || q.answer + 1}</code>`;
        } else if (q.type === 'fill') {
          right = q.blanks.map(b => `<code>${esc(b.answer)}</code>`).join('、');
        } else {
          right = `正确运行结果：<code>${esc(q.answer)}</code>`;
        }
        fb.innerHTML = `<div class="qf-title">❌ 答错了</div>
                        <div class="qf-body">${right}<br>连对已中断，继续加油！</div>`;
        toast('答错了', '看看解析找找原因', 'err');
      }
    },

    /** 查看解析 */
    explain() {
      const q = Quiz.current();
      if (!q) return;
      const fb = el.quizFeedback;
      fb.hidden = false;
      fb.className = 'quiz-feedback info';

      if (q.type === 'code') {
        fb.innerHTML = `<div class="qf-title">📖 参考程序</div>
                        <div class="qf-body">已在题目上方展示参考程序。请在左侧编辑器里自己写一遍，
                        用「仅运行」验证输出，再和参考程序对照 —— 这样收获最大。</div>`;
        return;
      }

      let extra = '';
      if (q.type === 'read') {
        extra = `<br><br><b>正确运行结果：</b><code>${esc(q.answer)}</code>`;
      }
      fb.innerHTML = `<div class="qf-title">📖 题目解析</div>
                      <div class="qf-body">${q.explain}${extra}</div>`;
    },

    /** 提示 */
    hint() {
      const q = Quiz.current();
      if (!q) return;
      const fb = el.quizFeedback;
      fb.hidden = false;
      fb.className = 'quiz-feedback info';
      if (q.type === 'read') {
        fb.innerHTML = `<div class="qf-title">💡 提示</div>
          <div class="qf-body">程序阅读题要<b>逐行执行</b>：先算出循环次数，再跟踪每轮变量的变化，
          最后按 <code>printf</code> 的调用顺序把输出拼起来（注意 <code>\\n</code> 会换行、
          <code>\\t</code> 会跳到下一个制表位）。</div>`;
        return;
      }
      if (q.type === 'code') {
        fb.innerHTML = `<div class="qf-title">💡 提示</div>
          <div class="qf-body">先想清楚<b>输入 → 处理 → 输出</b>三步：需要几个变量？用哪个循环？
          有没有现成的算法模板可以套（比如排序、二分查找）？</div>`;
        return;
      }
      fb.innerHTML = `<div class="qf-title">💡 提示</div>
        <div class="qf-body">${q.hint || '暂无提示，直接看解析吧。'}</div>`;
    },

    go(delta) {
      const next = Quiz.index + delta;
      if (next < 0 || next >= Quiz.list.length) return;
      Quiz.index = next;
      Quiz.render();
    },

    /** 跳到指定题号（1 起） */
    jump(n) {
      if (!n || n < 1 || n > Quiz.list.length) return;
      Quiz.index = n - 1;
      Quiz.render();
    },

    /** 随机打乱当前题库顺序 */
    shuffle() {
      for (let i = Quiz.list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [Quiz.list[i], Quiz.list[j]] = [Quiz.list[j], Quiz.list[i]];
      }
      Quiz.index = 0;
      Quiz.render();
      toast('已随机打乱', `当前 ${Quiz.list.length} 道题已重新排序`, 'ok', 2000);
    }
  };

  /* ============================================================
   * 6. 修仙等级 UI
   * ============================================================ */
  const LevelUI = {
    renderAll() {
      const score = ScoreCalc.getScore();
      const info = ScoreCalc.calcLevel(score);
      const stats = ScoreCalc.getStats();

      /* --- 顶栏迷你面板 --- */
      el.topbarBadge.textContent = info.levelName;
      el.topbarBadge.style.background = `linear-gradient(135deg, ${info.level.color}22, ${info.level.color}0d)`;
      el.topbarBadge.style.borderColor = info.level.color + '66';
      el.topbarBadge.style.color = info.level.color;
      el.topbarScore.textContent = score;
      el.topbarBarFill.style.width = info.progress + '%';
      el.topbarNext.textContent = info.next
        ? `距${info.nextName}还差 ${info.need} 分`
        : '已达最高境界 · 道途圆满';

      /* --- 主面板 --- */
      el.levelName.textContent = info.levelName;
      el.levelEn.textContent = info.level.en;
      el.panelScore.textContent = score;
      el.levelRing.style.setProperty('--p', info.progress + '%');
      el.levelRing.style.background =
        `conic-gradient(${info.level.color} ${info.progress}%, #1b2537 0)`;
      el.levelName.style.color = info.level.color;

      const curMin = info.level.min;
      const curMax = info.next ? info.next.min - 1 : score;
      el.levelBarFill.style.width = info.progress + '%';
      el.levelBarFill.style.background = `linear-gradient(90deg, ${info.level.color}99, ${info.level.color})`;
      el.levelBarText.textContent = info.next
        ? `${score} / ${info.next.min}`
        : `${score} / ${score}`;
      el.levelNext.innerHTML = info.next
        ? `距离 <b>${info.nextName}</b> 还差 <b>${info.need}</b> 分`
        : `🎉 已达 <b>道祖</b> 境界，道途圆满！`;

      /* --- 统计 --- */
      el.statAnswered.textContent = stats.answered;
      el.statCorrect.textContent = stats.correct;
      el.statAccuracy.textContent = stats.accuracy + '%';
      el.statStreak.textContent = stats.streak;
      el.statStreak.style.color = stats.streak >= 3 ? 'var(--gold)' : 'var(--cyan)';

      /* --- 境界阶梯 --- */
      el.levelLadder.innerHTML = ScoreCalc.allLevels().map((lv, i) => {
        const cls = i === info.levelIndex ? 'current' : (score >= lv.min ? 'reached' : '');
        return `<div class="ld-item ${cls}" style="${i === info.levelIndex
          ? `border-color:${lv.color};color:${lv.color}` : ''}">${lv.name}<span class="ld-p">${lv.min}</span></div>`;
      }).join('');

      /* --- 答题记录 --- */
      el.recordList.innerHTML = stats.records.length
        ? stats.records.slice(0, 12).map(r => `
          <div class="lr-item ${r.correct ? 'ok' : 'no'}">
            <span class="lr-ico">${r.correct ? '✓' : '✕'}</span>
            <span class="lr-text">${esc(r.title)}</span>
            <span class="lr-points">${r.correct ? '+' + r.gain : '0'}</span>
            <span class="lr-time">${timeAgo(r.at)}</span>
          </div>`).join('')
        : '<div class="lr-empty">暂无记录，去答几道题吧</div>';
    },

    /** 升级庆祝动画 */
    celebrate(from, to) {
      const info = ScoreCalc.currentLevel();
      el.levelRing.classList.add('level-up-glow');
      setTimeout(() => el.levelRing.classList.remove('level-up-glow'), 1200);

      toast('🎊 境界突破！', `恭喜，你已从 <b>${esc(from)}</b> 晋升 <b style="color:${info.level.color}">${esc(to)}</b>！`, 'lv', 5000);

      // 全屏金色闪烁
      const flash = document.createElement('div');
      flash.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:150;' +
        `background:radial-gradient(circle at 50% 40%, ${info.level.glow}, transparent 60%);` +
        'animation:lvFlash 1.1s ease-out forwards;';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 1150);
    },

    /** 渲染等级规则表 */
    showRules() {
      const score = ScoreCalc.getScore();
      const info = ScoreCalc.calcLevel(score);
      el.ruleModalBody.innerHTML = `
        <table class="rule-table">
          <thead><tr><th>境界</th><th>积分区间</th><th>说明</th></tr></thead>
          <tbody>
            ${ScoreCalc.allLevels().map((lv, i) => {
              const next = ScoreCalc.LEVELS[i + 1];
              const range = next ? `${lv.min} ~ ${next.min - 1}` : `${lv.min} 分以上`;
              return `<tr class="${i === info.levelIndex ? 'current' : ''}">
                <td>${lv.name}</td>
                <td>${range}</td>
                <td>${lv.en}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <p style="margin-top:14px;font-size:12px;color:var(--txt-dim);line-height:1.8">
          · 答对一题获得该题标注的分值，连续答对有额外奖励<br>
          · 重复刷已答对的题仅 +1 分，防止反复提交刷分<br>
          · 全部数据保存在浏览器 localStorage，刷新不丢失
        </p>`;
      el.ruleModal.hidden = false;
    }
  };

  /* ============================================================
   * 7. 模式切换
   * ============================================================ */
  function switchMode(mode) {
    document.body.dataset.mode = mode;
    el.modeSwitch.dataset.active = mode;
    el.modeSwitch.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    // 离开可视化模式时停掉动画，避免后台空转
    if (mode === 'quiz') {
      Viz.stop();
      Console.cancel();          // 别让程序卡在等输入上
    }
    // 切换后重新计算编辑器尺寸（编辑器在刷题模式下是 display:none，
    // 必须等它重新可见后测量，行高/padding 缓存也要失效）
    setTimeout(() => {
      Editor.invalidateMetrics();
      Editor.render();
    }, 60);
  }

  /* ============================================================
   * 8. 事件绑定 & 初始化
   * ============================================================ */
  function bindEvents() {

    /* --- 模式切换 --- */
    el.modeSwitch.addEventListener('click', e => {
      const btn = e.target.closest('.mode-btn');
      if (btn) switchMode(btn.dataset.mode);
    });

    /* --- 编辑器 --- */
    el.input.addEventListener('input', () => { Editor.render(); Editor.updateStatus(); });
    el.input.addEventListener('scroll', () => {
      el.highlight.scrollTop = el.input.scrollTop;
      el.highlight.scrollLeft = el.input.scrollLeft;
    });
    el.input.addEventListener('keyup', () => { Editor.updateStatus(); Editor.scrollCaretIntoView(); });
    el.input.addEventListener('click', () => { Editor.updateStatus(); Editor.scrollCaretIntoView(); });
    // Tab 键插入 4 个空格而不是切换焦点
    el.input.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = el.input.selectionStart, t = el.input.selectionEnd;
        el.input.value = el.input.value.slice(0, s) + '    ' + el.input.value.slice(t);
        el.input.selectionStart = el.input.selectionEnd = s + 4;
        Editor.render();
        Editor.updateStatus();
        Editor.scrollCaretIntoView();
        return;
      }
      // Ctrl+Home / Ctrl+End 跳到文件首尾
      if (e.ctrlKey && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        const total = el.input.value.split('\n').length;
        Editor.scrollLineIntoView(e.key === 'Home' ? 1 : total, 'strict');
        Editor.updateStatus();
        return;
      }
      // 上下方向键 / 回车 / 退格 会移动光标，主动让容器跟随
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Backspace'].includes(e.key)) {
        requestAnimationFrame(() => Editor.scrollCaretIntoView());
      }
    });

    /* --- 滚动同步：容器是唯一滚动源，行号槽跟随 ---
     * 高亮层与 textarea 都已铺满内容，滚轮在 textarea 上会冒泡到
     * .editor-scroll，无需额外转发；这里只需同步行号槽。*/
    el.scroll.addEventListener('scroll', () => {
      Editor.syncGutter();
    }, { passive: true });

    /* 鼠标悬停在编辑器上时用滚轮翻页，即使指针落在 gutter 上也生效 */
    el.editor.addEventListener('wheel', e => {
      // 指针在行号槽或容器留白处时，浏览器默认不会滚动 textarea，手动转发
      if (e.target === el.editor || e.target === el.gutter) {
        el.scroll.scrollTop += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });

    el.sampleSelect.addEventListener('change', e => {
      const key = e.target.value;
      if (!key) return;
      const s = SAMPLE_CODES[key];
      if (!s) return;
      Editor.setValue(s.code);
      Viz.reset();
      Viz.clearBars();          // 换示例后旧柱子必须清掉
      Console.clear();
      switchMode('viz');
      toast('已载入示例', s.title + (s.interactive ? '（交互程序，运行后往控制台输入）' : ''), 'ok', 2400);
      e.target.value = '';
    });

    el.btnFormat.addEventListener('click', () => Editor.format());

    /* --- 清空：需二次确认，防止误触丢代码 --- */
    if (el.btnClear) {
      el.btnClear.addEventListener('click', async () => {
        if (Editor.isEmpty()) {
          toast('编辑器已经是空的', '可以直接输入代码，或点「载入示例…」', 'warn', 2000);
          return;
        }
        // 正在跑可视化时先停掉，避免清空后动画还在跑空数组
        const wasRunning = Viz.running;

        const s = Editor.stats();
        const ok = await Confirm.ask({
          title: '确认清空编辑器？',
          message: Editor.getValue().trim()
            ? '当前代码将被全部删除，此操作无法撤销。'
            : '编辑器里只有空白字符，将被清空。',
          detail: `${s.lines} 行 · ${s.chars} 字符`,
          okText: '确认清空'
        });
        if (!ok) {
          toast('已取消', '代码没有改动', 'warn', 1600);
          return;
        }

        if (wasRunning) Viz.stop();
        Editor.clear();
        Viz.reset();
        Viz.clearBars();
        Console.clear();
        toast('已清空', `删除了 ${s.lines} 行代码，可点「重置」恢复默认示例`, 'ok', 2600);
      });
    }

    /* --- 重置：会覆盖用户写的代码，同样加确认 --- */
    el.btnReset.addEventListener('click', async () => {
      const sample = SAMPLE_CODES.bubble;
      if (Editor.isEmpty()) {           // 本来就是空的，直接恢复即可，不必打扰
        Editor.setValue(sample.code);
        Viz.reset();
        Console.clear();
        toast('已重置', '恢复为默认冒泡排序示例', 'ok', 1800);
        return;
      }
      const s = Editor.stats();
      const ok = await Confirm.ask({
        title: '确认重置为默认代码？',
        message: '编辑器中现有的代码会被默认的冒泡排序示例覆盖，此操作无法撤销。',
        detail: `当前 ${s.lines} 行将被替换`,
        okText: '确认重置'
      });
      if (!ok) {
        toast('已取消', '代码没有改动', 'warn', 1600);
        return;
      }
      const wasRunning = Viz.running;
      if (wasRunning) Viz.stop();
      Editor.setValue(sample.code);
      Viz.reset();
      Console.clear();
      toast('已重置', '恢复为默认冒泡排序示例', 'ok', 1800);
    });

    /* --- 运行 --- */
    el.btnVisualize.addEventListener('click', () => {
      switchMode('viz');
      Console.clear();
      Viz.start();
    });

    /* --- 仅运行：也走交互模式，让 scanf 能弹输入框 --- */
    el.btnRunConsole.addEventListener('click', () => {
      switchMode('viz');
      Console.clear();
      Viz.start({ plain: true });
    });

    /* --- 可视化控制 --- */
    el.btnVizPause.addEventListener('click', () => Viz.togglePause());
    el.btnVizStep.addEventListener('click', () => Viz.stepOnce());
    el.btnVizReset.addEventListener('click', () => { Viz.reset(); Console.clear(); });
    el.btnClearConsole.addEventListener('click', () => Console.clear());

    /* --- 交互式控制台：回车送入 / Esc 取消 / 上下键翻历史 --- */
    if (el.vcInput) {
      el.vcInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          Console.submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          Console.cancel();
          toast('已跳过本次输入', '程序收到一个空值继续运行', 'warn', 2000);
        }
        e.stopPropagation();   // 别让编辑器/切题的全局快捷键抢走
      });
      el.vcInput.addEventListener('focus', () => el.vcInputLine.classList.remove('idle-caret'));
    }
    if (el.vcSend) {
      el.vcSend.addEventListener('click', () => Console.submit());
    }

    /* --- 刷题 --- */
    el.quizOptions.addEventListener('click', e => {
      const item = e.target.closest('.qo-item');
      if (!item || Quiz.answered) return;
      Quiz.selected = parseInt(item.dataset.opt, 10);
      el.quizOptions.querySelectorAll('.qo-item').forEach(n => n.classList.remove('selected'));
      item.classList.add('selected');
    });

    el.quizFill.addEventListener('input', e => {
      const input = e.target.closest('.qf-input');
      if (!input) return;
      Quiz.fillVals[input.dataset.blank] = input.value;
    });

    // 填空题支持回车提交
    el.quizFill.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); Quiz.submit(); }
    });

    el.btnSubmitAnswer.addEventListener('click', () => Quiz.submit());
    el.btnExplain.addEventListener('click', () => Quiz.explain());
    el.btnHint.addEventListener('click', () => Quiz.hint());
    el.btnPrevQ.addEventListener('click', () => Quiz.go(-1));
    el.btnNextQ.addEventListener('click', () => Quiz.go(1));

    /* --- 题库筛选 / 洗牌（1000 题大题库功能） --- */
    if (el.selChapter) {
      el.selChapter.addEventListener('change', e => {
        Quiz.filterChapter = e.target.value;
        Quiz.index = 0;
        Quiz.applyFilter();
        Quiz.render();
        const n = Quiz.list.length;
        toast(n ? '筛选完成' : '没有匹配的题目',
          n ? `当前 ${n} 道题 · ${e.target.value || '全部章节'}` : '换个章节或题型试试',
          n ? 'ok' : 'warn', 2000);
      });
    }
    if (el.selType) {
      el.selType.addEventListener('change', e => {
        Quiz.filterType = e.target.value;
        Quiz.index = 0;
        Quiz.applyFilter();
        Quiz.render();
        const n = Quiz.list.length;
        toast(n ? '筛选完成' : '没有匹配的题目',
          n ? `当前 ${n} 道题` : '换个章节或题型试试',
          n ? 'ok' : 'warn', 2000);
      });
    }
    if (el.btnShuffle) el.btnShuffle.addEventListener('click', () => Quiz.shuffle());
    if (el.btnResetFilter) {
      el.btnResetFilter.addEventListener('click', () => {
        Quiz.filterChapter = '';
        Quiz.filterType = '';
        if (el.selChapter) el.selChapter.value = '';
        if (el.selType) el.selType.value = '';
        Quiz.index = 0;
        Quiz.applyFilter();
        Quiz.render();
        toast('已清空筛选', `恢复全部 ${Quiz.list.length} 道题`, 'ok', 1800);
      });
    }

    // 快捷键：Alt+← / Alt+→ 切题
    document.addEventListener('keydown', e => {
      if (!e.altKey) return;
      if (Confirm.isOpen()) return;          // 弹窗开着时不响应，避免误切题
      if (e.key === 'ArrowLeft') { e.preventDefault(); Quiz.go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); Quiz.go(1); }
    });

    /* --- 等级 --- */
    el.btnLevelRule.addEventListener('click', () => LevelUI.showRules());
    el.btnResetLevel.addEventListener('click', () => {
      if (!confirm('确定要重置修仙进度吗？\n积分、答题记录将全部清空，且无法恢复。')) return;
      ScoreCalc.reset();
      LevelUI.renderAll();
      Quiz.init();
      toast('已重置', '修仙进度已回到炼气期', 'ok');
    });

    /* --- 弹窗关闭 --- */
    el.ruleModal.addEventListener('click', e => {
      if (e.target.hasAttribute('data-close')) el.ruleModal.hidden = true;
    });

    /* --- 通用确认弹窗：确认 / 取消 / Esc / Tab 循环 --- */
    if (el.confirmModal) {
      el.confirmOk.addEventListener('click', () => Confirm._close(true));
      // 遮罩 / ✕ / 取消按钮都带 data-cancel
      el.confirmModal.addEventListener('click', e => {
        if (e.target.hasAttribute('data-cancel')) Confirm._close(false);
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        // 确认弹窗优先级更高：开着时 Esc 只关它，别把规则弹窗也关了
        if (Confirm.isOpen()) { Confirm._close(false); return; }
        el.ruleModal.hidden = true;
        return;
      }

      // 确认弹窗打开时：Tab 在「取消 / 确认」之间循环，
      // 防止键盘用户 Tab 到背后的按钮上再按回车造成误操作
      if (Confirm.isOpen() && e.key === 'Tab') {
        const f = [el.confirmCancel, el.confirmOk].filter(x => x && !x.disabled);
        if (!f.length) return;
        e.preventDefault();
        const i = f.indexOf(document.activeElement);
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    });

    /* --- 窗口尺寸变化：重测编辑器度量并保持行号同步 --- */
    window.addEventListener('resize', () => {
      Editor.invalidateMetrics();
      Editor.syncHeight();
      Editor.syncGutter();
    });
  }

  /* ============================================================
   * 9. 启动
   * ============================================================ */
  function init() {
    Editor.setValue(SAMPLE_CODES.bubble.code);
    bindEvents();
    Quiz.init();
    LevelUI.renderAll();
    switchMode('quiz');

    // 暴露到全局，方便在控制台调试（不影响功能）
    window.__cPractice = { Editor, Viz, Console, SwapFx, Quiz, LevelUI, SAMPLE_CODES };

    console.log('%c C语言修仙 %c 纯前端 · 无后端 · 可视化',
      'background:#0891b2;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold',
      'color:#22d3ee');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
