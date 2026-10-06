/* ================================================================
   fx.js —— 答题特效控制器（答对 / 答错）
   ------------------------------------------------------------
   形态：寄生在右上角判分弹窗（toast）里的一枚小徽章。
   弹窗出现 → 徽章跟着出现；弹窗淡出 → 徽章随它一起被移除。

   设计原则
   --------
   1. 动画本体全在 css/fx_effects.css 的关键帧里，本文件只负责
      克隆节点与增删类名 —— 逻辑极短，一眼能看懂在干什么。
   2. 特效节点是 toast 的子节点，**不需要任何清理**：
      toast 自己 remove 时会把徽章一起带走，页面上不留残影。
   3. 绝不改main.js。它判分时本来就会弹 toast，我们只是往里塞个徽章。
   4. 徽章始终 pointer-events: none，绝不拦截弹窗上的任何交互。

   ★ 为什么不自己再弹一个带特效的提示
   ------------------------------------
   main.js 判分时已经会 toast('答对啦！', ...) / toast('答错了', ...)，
   自己再弹一个就会看到两个弹窗。所以改为「搭车」：
   用 MutationObserver盯住 #toastWrap，新 toast 出现时按 kind 匹配，
   把徽章塞进它左侧。

   ★ 为什么不用 fixed 定位 + 坐标计算
   ----------------------------------
   试过挂在「答题反馈」条上，靠 getBoundingClientRect() 算坐标。
   问题是页面会长期存在一个特效图位，观感上像"网站里嵌了一张图"。
   寄生进 toast 后彻底没有这个问题：弹窗没了，特效就没了。

   ★ 必须记住的坑
   ---------------
   a) 同一元素不能挂两个 animation 简写。多个 CSS 动画作用于同一元素时，
      同一属性由「最后声明的动画」输出。红闪若用 animation 写，
      会把徽章的入场动画挤掉（表现为红闪正常但徽章不动，且无报错）。
      所以红闪靠 JS 切 .fx-redflash 类。
   b) 用margin 负值居中，不要用 transform: translate(-50%,-50%)：
      transform 通道要留给 scale/rotate 动画，占用后动画会整体不动。
   c) toast 由 main.js 用 innerHTML 生成，若把徽章节点提前塞进 toast，
      会被下一次 innerHTML 赋值直接抹掉。所以必须在 toast 创建
      之后（MutationObserver 里）再克隆进去。
   d) 素材挂在 display:none 的模板上，浏览器**不会**预取这些背景图，
      于是第一次答对时头像才现场加载，弹出来会有一下闪白。
      所以 init 里显式 new Image() 预热一遍。
   e) fx-ok / fx-bad 只挂在 .fx-badge 上，爆炸框/对勾/粒子都是它的
      **子节点**，所以 CSS 里必须写 `.fx-badge.fx-ok .fx-burst-ok.go`
      这种后代选择器；写成 `.fx-burst-ok.fx-ok.go`（同元素复合类）
      会永远匹配不上——那些元素身上没有 fx-ok。
      只有 .fx-badge 自身的入场/红闪才是同元素复合类。
   ================================================================ */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const SPARK_COUNT = 8;      // 徽章只有 44px，粒子多了会糊住弹窗文字

  const dom = {};
  let ready = false;

  function cacheDom() {
    dom.tpl= $('fxTemplate');
    dom.wrap   = $('toastWrap');

    ready = !!(dom.tpl && dom.wrap);
    if (!ready) {
      console.warn('[fx] 未找到特效模板或弹窗容器，答题特效已禁用（不影响网站功能）');
    }
  }

  /* ---------- 粒子随机化 ----------
     模板里预置的 8 个粒子只有样式，方向/距离/大小每次都不同，
     否则每次播放的粒子轨迹都一样，看起来像录好的动画。 */
  function prepSparks(badge, kind) {
    const sparks = badge.querySelectorAll('.fx-spark');
    sparks.forEach((s, i) => {
      const ang = (i / sparks.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      // 44px 徽章配的短距离：26~62px，刚好出徽章边缘就收住
      const dist = (kind === 'ok' ? 26 : 30) + Math.random() * 34;
      s.style.setProperty('--fxdx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.style.setProperty('--fxdy', (Math.sin(ang) * dist * (kind === 'ok' ? 0.82 : 1)).toFixed(1) + 'px');
      s.style.setProperty('--fxrot', ((Math.random() - 0.5) * 420).toFixed(0) + 'deg');
      s.style.animationDelay = (0.04 + Math.random() * 0.14).toFixed(3) + 's';
      const size = 4 + Math.random() * 4;
      s.style.width = s.style.height = size.toFixed(0) + 'px';
    });
  }

  /* ---------- 把徽章装进弹窗 ----------
     kind: 'ok' | 'bad'
     返回装好的徽章节点，失败返回 null。 */
  function mount(toast, kind) {
    const badge = dom.tpl.cloneNode(true);
    badge.className = 'fx-badge fx-' + kind;

    prepSparks(badge, kind);

    // 让位：给弹窗加左内边距，文字自动往右挪，徽章不压字
    toast.classList.add('fx-host');
    // 爆头元素排在标题之前，用 flex 竖排时正好在内容上方居中
    toast.insertBefore(badge, toast.firstChild);

    // 装好后等两帧再装 go 类 —— 见文件头坑 b) 的同类问题：
    // 节点刚插入 DOM 时动画时间轴可能还停在 0，直接加类会看不到过程。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      badge.querySelectorAll(
        '.fx-burst, .fx-mark, .fx-mark .fx-tick, .fx-mark-bad .fx-b1, .fx-mark-bad .fx-b2'
      ).forEach(el => el.classList.add('go'));
      badge.classList.add('go');
      if (kind === 'bad') pulseRed(badge);
    }));

    return badge;
  }

  /* ---------- 答错红闪 ----------
     用类切换而非 animation，因为 .fx-badge 已挂着入场动画，
     再加一条 animation 会把它挤掉（见文件头坑 a)。 */
  function pulseRed(badge) {
    let i = 0;
    badge.classList.add('fx-redflash');
    const iv = setInterval(() => {
      if (++i >= 4) { clearInterval(iv); badge.classList.remove('fx-redflash'); }
      else badge.classList.toggle('fx-redflash');
    }, 90);
  }

  /* ---------- 盯住弹窗容器 ----------
     main.js 每判一次分就 append 一个 .toast。这里监听新增节点，
     按 class 里的 ok / err 判定答对答错，再把徽章塞进去。
     ★ 用 MutationObserver 而不是包toast() 函数：
       main.js 里的 toast 是模块内私有函数，没挂到 window，包不到。 */
  function observeToasts() {
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const isToast = node.classList && node.classList.contains('toast');
          if (!isToast) continue;
          if (!QuizFX._on) continue;
          const kind = node.classList.contains('ok') ? 'ok'
                     : node.classList.contains('err') ? 'bad'
                     : null;
          if (!kind) continue;      // warn / lv 等其他弹窗不挂特效
          mount(node, kind);
        }
      }
    });
    mo.observe(dom.wrap, { childList: true });
    dom._mo = mo;
  }

  /* ---------- 对外接口 ---------- */
  const QuizFX = {
    /** 是否可用（模板与弹窗容器都在） */
    get enabled() { return ready; },

    /** 手动开关，供设置项 / 控制台使用 */
    _on: true,

    /** 手动往最新出现的弹窗上装特效（控制台调试用） */
    attachLatest(kind) {
      if (!ready) return false;
      const list = dom.wrap.querySelectorAll('.toast');
      const last = list[list.length - 1];
      if (!last) return false;
      // 已经装过就不重复装
      if (last.querySelector('.fx-badge')) return false;
      mount(last, kind === 'bad' ? 'bad' : 'ok');
      return true;
    },

    /** 清理：断开监听并移除所有残留徽章。
     *  正常播放路径根本不需要调（徽章随toast 一起被移除），
     *  仅供控制台手动收尾。 */
    stop() {
      if (dom._mo) dom._mo.disconnect();
      if (!ready) return;
      dom.wrap.querySelectorAll('.fx-badge').forEach(b => b.remove());
      dom.wrap.querySelectorAll('.fx-host').forEach(t => t.classList.remove('fx-host'));
    }
  };

  /* ---------- 素材预热 ----------
     模板 display:none，浏览器不会去拉里面的背景图。
     第一次答对时现加载会让头像晚半拍出现，所以这里先偷偷读一遍。 */
  function preloadAssets() {
    ['fx-face.png', 'fx-burst-ok.svg', 'fx-burst-bad.svg'].forEach(f => {
      const img = new Image();
      img.src = 'assets/' + f;
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    cacheDom();
    if (!ready) return;
    preloadAssets();
    observeToasts();
    window.QuizFX = QuizFX;
    console.log('%c fx %c 答题特效已启用（寄生在右上角判分弹窗 · 用完即走）',
      'background:#f5342b;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold',
      'color:#9d99b8');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();