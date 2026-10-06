/**
 * 答题特效 · 网站部署验证（CDP over WebSocket）
 *
 * 与原型的自测不同，这里验证的是「真实答题流程」：
 *   载入 index.html -> 等 iframe 就绪 -> 找到题库 -> 真的去答一题
 *   -> 提交 -> 断言特效播了。
 *
 * 这样才能覆盖部署时最容易出错的地方：
 *   - fx.js 有没有正确挂钩到 Quiz.showResult
 *   - 特效层有没有盖在正确的 z-index（不被顶栏/弹窗压住）
 *   - pointer-events: none 是否生效（特效播放期间还能点按钮）
 *   - 素材路径在 iframe 语境下是否解析成功
 *   - 特效播放是否影响原有功能（判分、积分、连对、升级）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// ★ 网站根目录（fx.js 在 js/ 下，站点根是上一级）
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'fxshots');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 8975;
const CDP_PORT = 9340;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else {
    fail++; failures.push(label + (extra ? '  -> ' + extra : ''));
    console.log('  FAIL  ' + label + (extra ? '  -> ' + extra : ''));
  }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); rq.end('nf'); return;
      }
      const buf = fs.readFileSync(f);
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      rq.end(buf);
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const c = new CDP(ws);
    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.id && c.pend.has(msg.id)) {
        const { res, rej } = c.pend.get(msg.id);
        c.pend.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pend.has(id)) { this.pend.delete(id); rej(new Error('timeout ' + method)); }
      }, 30000);
    });
  }
  /** 在指定执行上下文里求值（0 = 外层 index.html，1 = iframe ui.html） */
  async eval(expr, ctxId) {
    const p = { expression: expr, returnByValue: true, awaitPromise: true };
    if (ctxId) p.contextId = ctxId;
    const r = await this.send('Runtime.evaluate', p);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' +
        JSON.stringify((r.exceptionDetails.exception || {}).description || ''));
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

function launchEdge() {
  const { spawn } = require('child_process');
  const ud = path.join(require('os').tmpdir(), 'wb-fxsite-prof');
  return spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + ud,
    '--window-size=1400,950',
    '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
}

// 必须从 /json/list 找 type==='page' 的 target：
// /json/version 返回的是浏览器级连接，上面没有 Page 域。
async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await new Promise((res, rej) => {
        http.get('http://127.0.0.1:' + CDP_PORT + '/json/list', rq => {
          let b = ''; rq.on('data', d => b += d); rq.on('end', () => res(b));
        }).on('error', rej);
      });
      const page = JSON.parse(r).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('未找到 page target');
}

async function shot(cdp, file) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.data, 'base64'));
  return fs.statSync(path.join(SHOTS, file)).size;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  console.log('静态服务 :' + PORT+ '  站点根 ' + ROOT);
  const edge = launchEdge();
  let cdp;
  try {
    cdp = await CDP.attach(await getWsUrl());
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    // 记录资源请求与执行上下文
    const seen = {};
    const contexts = [];
    const consoleErrs = [];
    cdp.ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.method === 'Network.responseReceived') {
        seen[msg.params.response.url] = msg.params.response.status;
      }
      if (msg.method === 'Runtime.executionContextCreated') {
        contexts.push({ id: msg.params.context.id, origin: msg.params.context.origin,
                        name: msg.params.context.name });
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        consoleErrs.push(msg.params.entry.text);
      }
    });
    await cdp.send('Log.enable');

    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
    await sleep(2800);

    // ---------- A. iframe 执行上下文 ----------
    // headless 下 iframe 的context.name 常常是空串，不能靠名字认。
    // 改为逐个上下文探测：谁挂了 window.__cPractice，谁就是 ui.html。
    section('A. iframe 执行上下文');
    console.log('    上下文列表: ' + JSON.stringify(contexts.map(c => ({ id: c.id, name: c.name }))));
    let CTX = 0;
    for (const c of contexts) {
      let hit = false;
      try {
        hit = await cdp.eval('!!(window.__cPractice && window.__cPractice.Quiz)', c.id);
      } catch (e) { /* 该上下文可能已销毁 */ }
      if (hit) { CTX = c.id; break; }
    }
    ok(!!CTX, '找到 ui.html 的执行上下文（有 __cPractice.Quiz 的那个）',
       'ctx=' + CTX);
    if (!CTX) throw new Error('拿不到 iframe 上下文，后续无法验证');

    // ---------- B. 资源加载 ----------
    section('B. 特效资源加载');
    for (const [name, frag] of [
      ['index.html', '/index.html'],
      ['ui.html', '/ui.html'],
      ['js/main.js', '/js/main.js'],
      ['js/fx.js', '/js/fx.js'],
      ['css/style.css', '/css/style.css'],
      ['css/fx_effects.css', '/css/fx_effects.css'],
      ['assets/fx-face.png', '/assets/fx-face.png'],
      ['assets/fx-burst-ok.svg', '/assets/fx-burst-ok.svg'],
      ['assets/fx-burst-bad.svg', '/assets/fx-burst-bad.svg'],
    ]) {
      const hit = Object.keys(seen).find(u => u.endsWith(frag));
      ok(!!hit && seen[hit] === 200, name + ' 加载 200', 'got=' + (hit ? seen[hit] : 'not-found'));
    }

    // ---------- C. fx.js 初始化：模板 + 弹窗监听 ----------
    section('C. fx.js 初始化（模板 + 弹窗监听）');
    const boot = await cdp.eval(`(() => {
      const T = document.getElementById('fxTemplate');
      const W = document.getElementById('toastWrap');
      const ts = getComputedStyle(T);
      return {
        hasQuizFX: typeof window.QuizFX === 'object',
        enabled: !!(window.QuizFX && window.QuizFX.enabled),
        hasCp: !!window.__cPractice,
        tpl: !!T,
        wrap: !!W,
        // ★ 模板必须 display:none：它只作克隆素材源，
        //   若参与布局就会在页面上留一个可见的空位/图标。
        tplDisplay: ts.display,
        tplRect: T.getBoundingClientRect().width + '×' + T.getBoundingClientRect().height,
        // ★ 模板内部必须齐备，否则克隆出来的徽章是空的
        tplBadge: !!T.querySelector('.fx-badge') || !!T.querySelector('.fx-shaker'),
        tplChar: !!T.querySelector('.fx-char'),
        tplMarkOk: !!T.querySelector('.fx-mark-ok svg'),
        tplMarkBad: !!T.querySelector('.fx-mark-bad svg'),
        tplSparks: T.querySelectorAll('.fx-spark').length,
        // 页面上此刻不该有任何特效节点
        straysNow: document.querySelectorAll('.fx-badge').length,
        toastZ: getComputedStyle(W).zIndex,
        modalZ: getComputedStyle(document.querySelector('.modal')).zIndex
      };
    })()`, CTX);
    ok(boot.hasQuizFX, 'window.QuizFX 已暴露');
    ok(boot.enabled, 'QuizFX.enabled = true（模板与弹窗容器都在）');
    ok(boot.hasCp, 'window.__cPractice 存在');
    ok(boot.tpl && boot.wrap, '特效模板与弹窗容器都存在');
    ok(boot.tplDisplay === 'none',
       '★ 模板 display:none（不在页面上留下可见元素）', boot.tplDisplay);
    ok(boot.tplBadge && boot.tplChar, '模板内含头像与徽章结构');
    ok(boot.tplMarkOk && boot.tplMarkBad, '模板内含对勾与叉号 SVG');
    ok(boot.tplSparks >= 6, '模板内含粒子节点', 'n=' + boot.tplSparks);
    ok(boot.straysNow === 0, '★ 初始状态页面上没有任何特效节点',
       'n=' + boot.straysNow);
    ok(+boot.toastZ > +boot.modalZ,
       '弹窗层高于 modal，特效随弹窗一起在最上层',
       'toast=' + boot.toastZ + ' modal=' + boot.modalZ);

    // ---------- D. 素材在 iframe 内解析成功 ----------
    section('D. 素材解析');
    const assets = await cdp.eval(`(() => {
      const g = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundImage : '(absent)'; };
      return {
        face: g('.fx-char'),
        burstOk: g('.fx-burst-ok'),
        burstBad: g('.fx-burst-bad')
      };
    })()`, CTX);
    ok(/fx-face\.png/.test(assets.face), '角色图片已加载', assets.face.slice(0, 70));
    ok(/fx-burst-ok\.svg/.test(assets.burstOk), '金色爆炸框已加载', assets.burstOk.slice(0, 70));
    ok(/fx-burst-bad\.svg/.test(assets.burstBad), '红色爆炸框已加载', assets.burstBad.slice(0, 70));

    // ---------- E. 真实答题：答对触发金色特效 ----------
    /* 真实 UI 流程。已核实的主页事实：
       - 模式：body.dataset.mode，切换靠 .mode-btn[data-mode="quiz"]
       - 题目：Quiz.list / Quiz.index / Quiz.current() / Quiz.render()
       - 选择题选项 #quizOptions .qo-item[data-opt]，点一下写 Quiz.selected
       - 填空题 #quizFill .qf-input[data-blank]，input 事件写 Quiz.fillVals[b.id]
       - 提交：#btnSubmitAnswer -> Quiz.submit() -> Quiz.showResult()
       - 反馈：#quizFeedback.className = 'quiz-feedback ok' | '... no'
                文案「✅ 答对了！」/「❌ 答错了」 */

    // 页面内通用小工具：切到刷题模式 + 定位到指定题型的题目
    // 注意：必须用显式函数参数，不能用 arguments —— 箭头函数里的
    // arguments 会向外层作用域泄漏，取到的不是本 IIFE 的实参。
    const PRELUDE = `
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const Q = window.__cPractice.Quiz;
      const modeBtn = document.querySelector('.mode-btn[data-mode="quiz"]');
      if (modeBtn) modeBtn.click();
      await sleep(150);
      const idx = Q.list.findIndex(q => q && q.type === want);
      if (idx < 0) return { err: 'no-' + want + '-question' };
      Q.index = idx;
      Q.render();
      await sleep(250);
    `;

    // ---------- E. 真实答题：答对触发金色特效（选择题） ----------
    section('E. 真实答题 → 答对特效（选择题）');
    const answerOk = await cdp.eval(`(async function (want) {
      ${PRELUDE}
      const q = Q.current();
      if (!q) return { err: 'current-null' };
      const items = document.querySelectorAll('#quizOptions .qo-item');
      if (!items[Number(q.answer)]) return { err: 'options-not-rendered', n: items.length };
      items[Number(q.answer)].click();
      await sleep(200);
      if (Q.selected !== Number(q.answer)) return { err: 'selected-not-recorded', sel: Q.selected };
      document.getElementById('btnSubmitAnswer').click();
      await sleep(700);

      const fb = document.getElementById('quizFeedback');
      // 取判分弹窗：main.js 自己 toast('答对啦！', ...)，class带 ok
      const ts = [...document.querySelectorAll('#toastWrap .toast')];
      const t = ts[ts.length - 1];
      const badge = t ? t.querySelector('.fx-badge') : null;
      const br = badge ? badge.getBoundingClientRect() : null;
      const tr = t ? t.getBoundingClientRect() : null;
      const title = t ? t.querySelector('.toast-title') : null;
      const titleR = title ? title.getBoundingClientRect() : null;
      const cs = badge ? getComputedStyle(badge) : null;
      const bs = badge ? badge.querySelector('.fx-char') : null;
      return {
        qid: q.id, type: q.type,
        toastCount: ts.length,
        toastCls: t ? t.className : '(无弹窗)',
        hasBadge: !!badge,
        badgeCls: badge ? badge.className : '',
        // 动画是否真的在跑：transform 不为 none 说明关键帧生效了
        badgeAnim: cs ? cs.transform : '',
        charBg: bs ? getComputedStyle(bs).backgroundImage : '',
        // ★ 头像必须有实际尺寸。曾踩过的坑：.fx-shaker 没写 height，
        //   而 .fx-char 用 height:100%，百分比在 auto 父级下退化成 0，
        //   头像被压成 1px 的一条线 —— 元素在、素材在、控制台无报错，
        //   肉眼却什么都看不到。所以必须量它的矩形。
        charW: bs ? bs.getBoundingClientRect().width : 0,
        charH: bs ? bs.getBoundingClientRect().height : 0,
        // ★ 对勾/叉号必须真的显示出来。同类坑：kind 类挂在 .fx-badge 上，
        //   CSS 若写成 .fx-mark-ok.go（同元素复合类）就永远匹配不到。
        markOpacity: badge
          ? +(getComputedStyle(badge.querySelector('.fx-mark-ok')).opacity) : -1,
        burstOpacity: badge
          ? +(getComputedStyle(badge.querySelector('.fx-burst-ok')).opacity) : -1,
        sparkAnimated: badge
          ? [...badge.querySelectorAll('.fx-spark')]
              .filter(s => getComputedStyle(s).backgroundColor !== 'rgba(0, 0, 0, 0)').length
          : 0,
        sparks: t ? t.querySelectorAll('.fx-spark').length : 0,
        sparksMoved: badge
          ? [...badge.querySelectorAll('.fx-spark')].filter(
              s => s.style.getPropertyValue('--fxdx')).length : 0,
        // 几何：徽章必须在弹窗内，且不压到标题文字
        insideToast: !!(br && tr && br.left >= tr.left - 1 && br.right <= tr.right + 1),
        overlapTitle: !!(br && titleR && br.right > titleR.left + 1),
        badgeSize: br ? Math.max(br.width, br.height) : 0,
        // 全局：页面上所有特效节点都必须寄生在某个 toast 内
        straysOutside: [...document.querySelectorAll('.fx-badge')]
          .filter(b => !b.closest('.toast')).length,
        feedbackCls: fb.className,
        feedbackTxt: (fb.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
      };
    })('choice')`, CTX);

    if (!answerOk || answerOk.err) {
      ok(false, '答对流程可执行', JSON.stringify(answerOk));
    } else {
      console.log('    题目 ' + answerOk.qid + ' (' + answerOk.type + ')');
      ok(answerOk.toastCount > 0, '★ 判分后右上角弹出提示',
         'n=' + answerOk.toastCount + ' cls=' + answerOk.toastCls);
      ok(answerOk.hasBadge, '★ 徽章已寄生进弹窗内部', 'badge=' + answerOk.badgeCls);
      ok(/fx-badge fx-ok/.test(answerOk.badgeCls || ''),
         '徽章带 fx-ok 标记', answerOk.badgeCls);
      ok(/fx-face\.png/.test(answerOk.charBg || ''), '头像素材已加载',
         (answerOk.charBg || '').slice(0, 60));
      ok(answerOk.charW >= 30 && answerOk.charH >= 30,
         '★ 头像真的有尺寸（不是被压成 1px 的线）',
         answerOk.charW.toFixed(0) + '×' + answerOk.charH.toFixed(0));
      ok(answerOk.markOpacity > 0.5, '★ 对勾真的显示出来',
         'opacity=' + answerOk.markOpacity);
      ok(answerOk.burstOpacity > 0.3, '★ 金色爆炸框真的显示出来',
         'opacity=' + answerOk.burstOpacity);
      ok(answerOk.sparkAnimated >= 6, '★ 粒子拿到了自己的颜色（金色）',
         'n=' + answerOk.sparkAnimated);
      ok((answerOk.sparks || 0) >= 6, '粒子节点已克隆进弹窗', 'n=' + answerOk.sparks);
      ok((answerOk.sparksMoved || 0) === (answerOk.sparks || 0),
         '每个粒子都拿到了随机方向', (answerOk.sparksMoved || 0) + '/' + answerOk.sparks);
      ok(answerOk.badgeAnim && answerOk.badgeAnim !== 'none',
         '★ 入场动画真的在跑（transform 非 none）', answerOk.badgeAnim);
      ok(answerOk.insideToast, '★ 徽章完整落在弹窗范围内',
         '徽章在 toast 内=' + answerOk.insideToast);
      ok(!answerOk.overlapTitle, '★ 徽章不压住弹窗标题文字',
         'overlap=' + answerOk.overlapTitle);
      ok(answerOk.badgeSize <= 60, '★ 徽章足够小（不喧宾夺主）',
         answerOk.badgeSize.toFixed(0) + 'px');
      ok(answerOk.straysOutside === 0,
         '★ 页面上没有游离在弹窗外的特效节点',
         'n=' + answerOk.straysOutside);
      ok(/ok/.test(answerOk.feedbackCls || ''), '反馈区标记为正确态（原有功能）',
         answerOk.feedbackCls);
      ok(/答对/.test(answerOk.feedbackTxt || ''), '判分文案正常（原有功能未破坏）',
         answerOk.feedbackTxt);
    }

    // ---------- F. 真实答题：答错触发红色特效 ----------
    section('F. 真实答题 → 答错特效（选择题）');
    const answerBad = await cdp.eval(`(async function (want) {
      ${PRELUDE}
      const q = Q.current();
      if (!q) return { err: 'current-null' };
      const wrong = (Number(q.answer) + 1) % q.options.length;
      const items = document.querySelectorAll('#quizOptions .qo-item');
      if (!items[wrong]) return { err: 'options-not-rendered' };
      items[wrong].click();
      await sleep(200);
      document.getElementById('btnSubmitAnswer').click();
      await sleep(700);

      const fb = document.getElementById('quizFeedback');
      const ts = [...document.querySelectorAll('#toastWrap .toast')];
      const t = ts[ts.length - 1];
      const badge = t ? t.querySelector('.fx-badge') : null;
      return {
        qid: q.id, type: q.type,
        toastCls: t ? t.className : '(无弹窗)',
        badgeCls: badge ? badge.className : '',
        hasBadBurst: !!(badge && badge.querySelector('.fx-burst-bad')),
        hasBadMark: !!(badge && badge.querySelector('.fx-mark-bad svg')),
        // 与答对段同理的"存在 ≠ 显示"断言
        badBurstOpacity: badge
          ? +(getComputedStyle(badge.querySelector('.fx-burst-bad')).opacity) : -1,
        badMarkOpacity: badge
          ? +(getComputedStyle(badge.querySelector('.fx-mark-bad')).opacity) : -1,
        badCharH: badge
          ? badge.querySelector('.fx-char').getBoundingClientRect().height : 0,
        badSparksPainted: badge
          ? [...badge.querySelectorAll('.fx-spark')]
              .filter(s => getComputedStyle(s).backgroundColor === 'rgb(245, 52, 43)').length
          : 0,
        wrongMark: document.querySelectorAll('#quizOptions .qo-item.wrong').length,
        feedbackCls: fb.className,
        feedbackTxt: (fb.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)
      };
    })('choice')`, CTX);

    if (!answerBad || answerBad.err) {
      ok(false, '答错流程可执行', JSON.stringify(answerBad));
    } else {
      console.log('    题目 ' + answerBad.qid + ' (' + answerBad.type + ')');
      ok(/err/.test(answerBad.toastCls || ''), '★ 答错弹窗出现', answerBad.toastCls);
      ok(/fx-badge fx-bad/.test(answerBad.badgeCls || ''),
         '★ 答错时徽章挂 fx-bad', answerBad.badgeCls);
      ok(answerBad.hasBadBurst, '答错徽章含红色爆炸框');
      ok(answerBad.hasBadMark, '答错徽章含叉号 SVG');
      ok(answerBad.badBurstOpacity > 0.3, '★ 红色爆炸框真的显示出来',
         'opacity=' + answerBad.badBurstOpacity);
      ok(answerBad.badMarkOpacity > 0.5, '★ 叉号真的显示出来',
         'opacity=' + answerBad.badMarkOpacity);
      ok(answerBad.badCharH >= 30, '★ 答错时头像也有尺寸',
         answerBad.badCharH.toFixed(0) + 'px');
      ok(answerBad.badSparksPainted >= 6, '★ 粒子拿到了自己的颜色（红色）',
         'n=' + answerBad.badSparksPainted);
      ok((answerBad.wrongMark || 0) === 1, '错误项被标红（原有功能未破坏）', 'n=' + answerBad.wrongMark);
      ok(/no/.test(answerBad.feedbackCls || ''), '反馈区标记为错误态（原有功能）',
         answerBad.feedbackCls);
      ok(/答错/.test(answerBad.feedbackTxt || ''), '错误文案正常', answerBad.feedbackTxt);
    }

    // ---------- F2. 另外两种题型也走同一个判题出口 ----------
    section('F2. 填空题 / 程序输出题同样触发特效');
    for (const t of ['fill', 'read']) {
      const r = await cdp.eval(`(async function (want) {
        ${PRELUDE}
        const q = Q.current();
        if (!q) return { err: 'current-null' };
        const sleep2 = ms => new Promise(r2 => setTimeout(r2, ms));
        if (q.type === 'fill') {
          const inputs = document.querySelectorAll('#quizFill .qf-input');
          if (inputs.length !== q.blanks.length) return { err: 'blank-count', n: inputs.length, want: q.blanks.length };
          q.blanks.forEach((b, i) => {
            inputs[i].value = b.answer;
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          });
        } else {
          const inp = document.querySelector('#quizFill [data-blank="__read"]');
          if (!inp) return { err: 'read-input-absent' };
          inp.value = String(q.answer);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep2(250);
        document.getElementById('btnSubmitAnswer').click();
        await sleep2(700);
        const fb = document.getElementById('quizFeedback');
        const ts = [...document.querySelectorAll('#toastWrap .toast')];
        const tt = ts[ts.length - 1];
        const b = tt ? tt.querySelector('.fx-badge') : null;
        return {
          qid: q.id, type: q.type,
          badgeCls: b ? b.className : '',
          feedbackCls: fb.className,
          feedbackTxt: (fb.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30)
        };
      })('${t}')`, CTX);
      if (!r || r.err) {
        ok(false, t + ' 题答对可执行', JSON.stringify(r));
      } else {
        console.log('    ' + t + ' 题目 ' + r.qid);
        ok(/fx-badge fx-ok/.test(r.badgeCls || ''),
           t + ' 题答对也挂上徽章（弹窗同一条路径）', r.badgeCls);
        ok(/ok/.test(r.feedbackCls || ''), t + ' 题判分正确', r.feedbackTxt);
      }
    }

    // ---------- G. 弹窗消失后页面无任何残留 ----------
    section('G. 弹窗消失 = 特效一起消失');
    const lifeCycle = await cdp.eval(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const wrap = document.getElementById('toastWrap');

      // 先等页面上现有的弹窗全部走完生命周期（main.js 默认 2600ms + 320ms）
      const waitAllGone = async () => {
        for (let i = 0; i < 40; i++) {
          if (!wrap.querySelector('.toast')) return true;
          await sleep(150);
        }
        return false;
      };
      const clearedBefore = await waitAllGone();

      // 手动弹一个带特效的弹窗，模拟判分
      const t = document.createElement('div');
      t.className = 'toast ok';
      t.innerHTML = '<div class="toast-title">答对啦！</div><div class="toast-msg">+1 积分</div>';
      wrap.appendChild(t);
      window.QuizFX.attachLatest('ok');
      await sleep(300);
      const during = {
        badge: !!t.querySelector('.fx-badge'),
        badgeVisible: t.querySelector('.fx-badge')
          ? parseFloat(getComputedStyle(t.querySelector('.fx-badge')).opacity) : 0,
        // ★ 徽章必须是 toast 的后代，不是页面上独立的 fixed 元素
        insideToast: !!t.querySelector('.toast .fx-badge')
      };

      // 模拟 main.js 的弹窗淡出：tOut 之后 remove
      t.classList.add('out');
      await sleep(400);
      t.remove();
      await sleep(200);

      return Object.assign(during, {
        clearedBefore,
        toastLeft: wrap.querySelectorAll('.toast').length,
        badgeLeftInDoc: document.querySelectorAll('.fx-badge').length,
        strayOutside: [...document.querySelectorAll('.fx-badge')]
          .filter(b => !b.closest('.toast')).length,
        hostClassLeft: document.querySelectorAll('.fx-host').length
      });
    })()`, CTX);

    ok(lifeCycle.clearedBefore, '前置：等待现有弹窗自然消失');
    ok(lifeCycle.badge, '★ 新弹窗上自动挂上了徽章');
    ok(lifeCycle.insideToast, '★ 徽章是弹窗的子节点（不是页面上的独立元素）');
    ok(lifeCycle.badgeVisible > 0.5, '弹窗存活期间徽章可见',
       'opacity=' + lifeCycle.badgeVisible);
    ok(lifeCycle.toastLeft === 0, '★ 弹窗已从页面移除', 'n=' + lifeCycle.toastLeft);
    ok(lifeCycle.badgeLeftInDoc === 0,
       '★ 弹窗消失后徽章随之消失（页面上不留残影）',
       '残留 ' + lifeCycle.badgeLeftInDoc + ' 个');
    ok(lifeCycle.strayOutside === 0,
       '★ 页面任何位置都没有游离的特效节点',
       'n=' + lifeCycle.strayOutside);
    ok(lifeCycle.hostClassLeft === 0,
       '让位用的 fx-host 类没有残留', 'n=' + lifeCycle.hostClassLeft);

    section('G2. 特效播放期间可继续操作');
    const noBlock = await cdp.eval(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const wrap = document.getElementById('toastWrap');
      // 弹一个带徽章的弹窗
      const t = document.createElement('div');
      t.className = 'toast ok';
      t.innerHTML = '<div class="toast-title">答对啦！</div>';
      wrap.appendChild(t);
      window.QuizFX.attachLatest('ok');
      await sleep(250);
      const badge = t.querySelector('.fx-badge');
      const sb = badge.getBoundingClientRect();
      // ★ 取点要打在徽章真实位置上
      const el = document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2);
      const hitIsBadge = el === badge || badge.contains(el);
      const badgePE = getComputedStyle(badge).pointerEvents;
      // 徽章旁边的弹窗标题应该还能正常点到（徽章没盖住它）
      const tr = t.getBoundingClientRect();
      const el2 = document.elementFromPoint(tr.right - 20, tr.top + tr.height / 2);
      const titleClickable = !!(el2 && t.contains(el2));

      const btn = document.querySelector('.mode-btn[data-mode="quiz"]');
      const before = document.body.dataset.mode;
      let clicked = false;
      if (btn) { btn.click(); clicked = true; }
      await sleep(200);
      t.remove();
      return { hitIsBadge, badgePE, titleClickable,
               tagAtPoint: el ? el.tagName + '.' + (el.className || '') : 'null',
               clicked, before, after: document.body.dataset.mode };
    })()`, CTX);
    ok(!noBlock.hitIsBadge, '★ 徽章不吃点击（elementFromPoint 穿透）',
       noBlock.tagAtPoint);
    ok(noBlock.badgePE === 'none', '★ 徽章 pointer-events:none', noBlock.badgePE);
    ok(noBlock.titleClickable, '弹窗本身仍可正常交互');
    ok(noBlock.clicked && noBlock.after === 'quiz', '特效播放期间仍可切换模式',
       noBlock.before + ' -> ' + noBlock.after);

    // ---------- H. 无报错 ----------
    section('H. 无报错 / 无 404');
    const notFound = Object.keys(seen).filter(u => seen[u] === 404);
    console.log('    404: ' + (notFound.length ? notFound.join(', ') : '(无)'));
    const real = notFound.filter(u => !/favicon/i.test(u));
    ok(real.length === 0, '页面资源无 404', real.join(' | '));
    const jsErr = consoleErrs.filter(e => !/favicon/i.test(e));
    ok(jsErr.length === 0, '无 JS 控制台错误', jsErr.slice(0, 3).join(' | '));

    // ---------- I. 回归：核心功能未被破坏 ----------
    section('I. 原有功能回归');
    const regress = await cdp.eval(`(() => {
      const CP = window.__cPractice;
      return {
        hasQuiz: !!(CP && CP.Quiz),
        hasEditor: !!(CP && CP.Editor),
        hasViz: !!(CP && CP.Viz),
        hasSwapFx: !!(CP && CP.SwapFx),
        hasLevelUI: !!(CP && CP.LevelUI),
        hasConsole: !!(CP && CP.Console),
        hasScoreCalc: typeof window.ScoreCalc === 'object',
        bankLen: (window.QuestionBank && QuestionBank.getAll)
                 ? QuestionBank.getAll().length : -1,
        bankCheck: typeof (window.QuestionBank || {}).check === 'function',
        // 判题/积分链路是否完好
        scoreAlive: !!(window.ScoreCalc && typeof ScoreCalc.submit === 'function'
                       && typeof ScoreCalc.isCleared === 'function'),
        // ★ 回归重点：fx.js 改成 MutationObserver 后**不应再挂钩 showResult**。
        //   钩子残留说明还在走老路径，会导致特效和弹窗各弹一次。
        stillHooked: !!(CP && CP.Quiz && CP.Quiz.showResult.__fxHooked),
        fxDisabled: !(window.QuizFX && window.QuizFX.enabled)
      };
    })()`, CTX);
    ok(regress.hasQuiz && regress.hasEditor && regress.hasViz, '核心模块完整（Quiz/Editor/Viz）');
    ok(regress.hasSwapFx && regress.hasLevelUI && regress.hasConsole,
       'SwapFx / LevelUI / Console 完整');
    ok(regress.hasScoreCalc && regress.scoreAlive, 'ScoreCalc 积分链路未被移除');
    ok(regress.bankLen > 0, '题库可用', 'n=' + regress.bankLen);
    ok(regress.bankCheck, 'QuestionBank.check 判分函数在位');
    ok(!regress.stillHooked,
       '★ showResult 未被挂钩（改用弹窗监听，不会重复弹特效）',
       'stillHooked=' + regress.stillHooked);
    ok(!regress.fxDisabled, '特效仍处于启用状态');

    // ---------- J. 抓帧 ----------
    section('J. 抓帧截图');
    /* ★ 徽章寄生在右上角判分弹窗里，所以必须真实答一题让弹窗出现，
       特效会由 MutationObserver 自动挂上去——不再手动调 playOk/playBad
       （那套接口已经删了，弹窗自己带徽章）。
       main.js 的 toast 默认存活约 2600ms，徽章动画 0.9s，
       所以提交后 ~300ms / ~620ms 各拍一张，正好覆盖弹入和爆炸框成型。
       答对/答错各来一次，保证两张图里弹窗文案和徽章对得上。 */
    async function answerAndShoot(type, wrong, shotA, shotB) {
      await cdp.eval(`(async function (want) {
        ${PRELUDE}
        // 先清掉可能残留的旧弹窗，避免拍到上一题的画面
        const wrap = document.getElementById('toastWrap');
        if (wrap) wrap.querySelectorAll('.toast').forEach(t => t.remove());
        const q = Q.current();
        const items = document.querySelectorAll('#quizOptions .qo-item');
        const pick = ${wrong}
          ? (Number(q.answer) + 1) % q.options.length
          : Number(q.answer);
        if (q && items[pick]) items[pick].click();
        await sleep(220);
        document.getElementById('btnSubmitAnswer').click();
        await sleep(300);        // 弹窗已出、徽章正在弹入
      })('${type}')`, CTX);
      const a = await shot(cdp, shotA);
      await sleep(320);
      const b = await shot(cdp, shotB);
      return [a, b];
    }

    const sOk = await answerAndShoot('choice', false, 'site-ok-1.png', 'site-ok-2.png');
    const sBad = await answerAndShoot('choice', true, 'site-bad-1.png', 'site-bad-2.png');
    const all = [...sOk, ...sBad];
    ok(all.every(v => v > 2000), '4 张站点截图已保存', JSON.stringify(all));

    console.log('\n' + '='.repeat(52));
    console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    if (failures.length) {
      console.log('\n  失败清单:');
      failures.forEach(f => console.log('   - ' + f));
    }
    console.log('='.repeat(52));
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('\n测试异常:', e.message);
    process.exitCode = 2;
  } finally {
    if (cdp) cdp.close();
    srv.close();
    try { require('child_process').execSync('taskkill /F /IM msedge.exe /T', { stdio: 'ignore' }); } catch (e) {}
    process.exit(process.exitCode || 0);
  }
})();
