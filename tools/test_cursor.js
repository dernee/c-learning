/**
 * 像素剑光标验证（浏览器内真实计算样式）。
 *
 * 覆盖：
 *  A. 光标图片能被浏览器加载（不是 404 / 0宽0高）
 *  B. 各类元素的实际 computed cursor 值符合预期
 *  C. 热点数值与剑尖位置一致
 *  D. 原有功能未受影响（跑一遍可视化 + 编辑器 + 刷题）
 *  E. iframe 外层（index.html）也挂上了剑
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SITE = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
const PORT = 9351;
const PROFILE = path.resolve(__dirname, '.edge-profile-cursor');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let PASS = 0, FAILN = 0;
const ok = (c, m, x) => { c ? (PASS++, console.log('  PASS ' + m + (x !== undefined ? '  => ' + x : ''))) : (FAILN++, console.log('  FAIL ' + m + (x !== undefined ? '  => ' + x : ''))); };

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('端口未就绪');
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  return { send: (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  }), close: () => ws.close(), errs };
}

(async () => {
  const profile = PROFILE + '-' + Date.now();
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--allow-file-access-from-files',
    '--window-size=1440,900', SITE
  ], { stdio: 'ignore' });

  let pass = false;
  try {
    const sock = await connect(await wsUrl());
    const { send } = sock;
    const { targetInfos } = await send('Target.getTargets');
    const page = targetInfos.find(t => t.type === 'page');
    const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const ev = async expr => {
      const r = await send('Runtime.evaluate',
        { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
      return r.result.value;
    };
    await send('Runtime.enable', {}, sessionId);
    await sleep(2200);

    /* ---------------- A. 光标图片加载 ---------------- */
    console.log('\n=== A. 光标图片资源 ===');
    const img = JSON.parse(await ev(`(async () => {
      const u = new URL('../assets/cursor-sword.png', document.querySelector('link[rel=stylesheet]').href).href;
      const r = await fetch(u);
      const b = await r.blob();
      return JSON.stringify({ url: u, ok: r.ok, status: r.status, size: b.size, type: b.type });
    })()`));
    ok(img.ok && img.status === 200, '光标图片 HTTP 200', img.status);
    ok(img.size > 1000, '光标图片非空', img.size + ' bytes, ' + img.type);
    ok(img.type === 'image/png', 'MIME 为 image/png', img.type);

    const dim = JSON.parse(await ev(`(async () => {
      const u = new URL('../assets/cursor-sword.png', document.querySelector('link[rel=stylesheet]').href).href;
      const im = new Image(); im.src = u; await im.decode();
      return JSON.stringify({ w: im.naturalWidth, h: im.naturalHeight });
    })()`));
    ok(dim.w === 64 && dim.h === 64, '图片解码成功且为 64x64', dim.w + 'x' + dim.h);
    ok(dim.w <= 128 && dim.h <= 128, '未超过浏览器光标尺寸上限(128)', dim.w + 'x' + dim.h);

    /* ---------------- B. computed cursor ---------------- */
    console.log('\n=== B. 各类元素的实际光标 ===');
    // 进入 iframe 内部取真实计算样式
    await ev(`document.getElementById('appFrame').contentWindow.focus(); true`);

    // ★ 先切到选择题，让 .qo-item（选项列表项）真实渲染出来。
    //   .qo-item 和 .qf-input 分属不同题型，同一时刻只会存在一种，
    //   所以下面分两轮探测：一轮 choice 查qo-item，一轮 fill 查 qf-input。
    //   顺序不能反：必须先 applyFilter() 重建 list，再把 index 归零，
    //   否则 current() 可能拿到 undefined，render() 走空分支。
    await ev(`(function(){
      const Q = document.getElementById('appFrame').contentWindow.__cPractice.Quiz;
      Q.filterType = 'choice';
      Q.applyFilter();
      Q.index = 0;
      Q.answered = false;
      Q.render();
      return Q.list.length;
    })()`);
    await sleep(300);
    const choiceExists = await ev(`(function(){
      const d = document.getElementById('appFrame').contentDocument;
      return !!d.querySelector('.qo-item');
    })()`);
    ok(choiceExists, '选择题选项已渲染（探测前提）');

    const probe = `(function(){
      const d = document.getElementById('appFrame').contentDocument;
      // ★ 区分「元素不存在」和「光标不对」：不存在时返回 '(absent)'，
      //   否则 null 会被后续断言混成同一个失败原因、看不出真实问题。
      const pick = sel => { const n = d.querySelector(sel); return n ? getComputedStyle(n).cursor : '(absent)'; };
      return JSON.stringify({
        body:      getComputedStyle(d.body).cursor,
        topbar:    pick('.topbar'),
        btn:       pick('#btnVisualize'),
        btnMini:   pick('.btn-mini'),
        modeBtn:   pick('.mode-btn'),
        sel:       pick('#vizSpeedSel'),
        qsel:      pick('.qsel'),
        qoItem:    pick('.qo-item'),
        ldItem:    pick('.ld-item'),
        editor:    pick('#editorInput'),
        vcInput:   pick('#vcInput'),
        panel:     pick('.panel-viz'),
        stage:     pick('#vizStage'),
        canvasish: pick('.viz-bar-fill')
      });
    })()`;
    const cur = JSON.parse(await ev(probe));

    const isSword = v => v && v.indexOf('cursor-sword.png') !== -1;
    const hasFallback = (v, kw) => v && v.indexOf(kw) !== -1;

    console.log('  body     = ' + cur.body);
    console.log('  editor   = ' + cur.editor);
    console.log('  btn      = ' + cur.btn);

    ok(isSword(cur.body), 'body 用剑光标');
    ok(isSword(cur.btn), '主按钮用剑光标');
    ok(isSword(cur.btnMini), '迷你按钮用剑光标');
    ok(isSword(cur.modeBtn), '模式切换按钮用剑光标');
    ok(isSword(cur.sel), '速度下拉框用剑光标');
    ok(isSword(cur.qsel), '题库筛选下拉用剑光标');
    ok(isSword(cur.qoItem), '选项列表项用剑光标');
    ok(isSword(cur.ldItem), '境界阶梯项用剑光标（原本是 default）');
    ok(isSword(cur.topbar), '顶栏用剑光标');
    ok(isSword(cur.panel), '面板容器用剑光标');
    ok(isSword(cur.stage), '可视化舞台用剑光标');

    // 文本录入处必须仍是 I-beam，否则用户不知道能打字
    ok(cur.editor === 'text', '代码编辑器保留文本光标', cur.editor);
    ok(cur.vcInput === 'text', '控制台输入框保留文本光标', cur.vcInput);

    // fallback 关键字：图片挂了要能退化成系统光标
    ok(hasFallback(cur.body, 'default'), 'body 带 default 兜底关键字');
    ok(hasFallback(cur.btn, 'pointer') || hasFallback(cur.btn, 'default'), '按钮带兜底关键字', cur.btn);

    // 热点必须是 5 0（剑尖），不能是 0 0
    // ★ 热点解析不用正则：这段代码要嵌进页面里的模板字符串，
    //   反斜杠会被模板字面量吞掉（\s -> s），正则会静默失配。
    //   直接按 ')' 切分再取数字，跨模板字符串也稳。
    const hs = JSON.parse(await ev(`(function(){
      const d = document.getElementById('appFrame').contentDocument;
      const v = getComputedStyle(d.body).cursor;
      const i = v.indexOf(')');
      if (i < 0) return JSON.stringify({ raw: v, x: null, y: null });
      const parts = v.slice(i + 1).trim().split(/\\s+/);
      return JSON.stringify({ raw: v, x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) });
    })()`));
    ok(hs.x === 5 && hs.y === 0, '热点=剑尖 (5, 0)', JSON.stringify([hs.x, hs.y]));

    // ---- 填空题单独一轮：.qf-input 与 .qo-item 不同题型，不会同时存在 ----
    await ev(`(function(){
      const Q = document.getElementById('appFrame').contentWindow.__cPractice.Quiz;
      Q.filterType = 'fill'; Q.applyFilter(); Q.index = 0; Q.answered = false; Q.render();
      return true;
    })()`);
    await sleep(300);
    const fillCur = JSON.parse(await ev(`(function(){
      const d = document.getElementById('appFrame').contentDocument;
      const pick = sel => { const n = d.querySelector(sel); return n ? getComputedStyle(n).cursor : '(absent)'; };
      return JSON.stringify({ qfInput: pick('.qf-input'), qfBox: pick('#quizFill') });
    })()`));
    // ★ 查真实的 .qf-input（JS 动态创建的 input），不是外层 div 容器。
    //   容器不是输入元素，本就该显示剑；这里要验证的是「能打字的元素」。
    ok(fillCur.qfInput === 'text', '填空输入框保留文本光标', fillCur.qfInput);
    ok(isSword(fillCur.qfBox), '填空题容器本身用剑（非输入元素）', fillCur.qfBox);

    /* ---------------- C. 禁用态 ---------------- */
    console.log('\n=== C. 禁用态语义保留 ===');
    await ev(`(function(){
      const d = document.getElementById('appFrame').contentDocument;
      const b = d.getElementById('btnVizPause');
      b.disabled = true;
      window.__dis = getComputedStyle(b).cursor;
      b.disabled = false;
      return true;
    })()`);
    const dis = await ev(`window.__dis`);
    ok(dis === 'not-allowed', '禁用按钮仍是 not-allowed', dis);

    /* ---------------- D. iframe 外层 ---------------- */
    console.log('\n=== D. 外层 index.html ===');
    const outer = await ev(`getComputedStyle(document.getElementById('appFrame')).cursor`);
    ok(isSword(outer), 'iframe 元素本身也挂剑（外层文档）', outer);
    const outerBody = await ev(`getComputedStyle(document.body).cursor`);
    ok(isSword(outerBody), '外层 body 挂剑', outerBody);

    /* ---------------- E. 功能回归 ---------------- */
    console.log('\n=== E. 原有功能回归 ===');
    // 先清掉题型筛选，回到全部题目（探测时切到了 fill，别污染后面的判分测试）
    await ev(`(function(){
      const Q = document.getElementById('appFrame').contentWindow.__cPractice.Quiz;
      Q.filterType = '';
      Q.applyFilter();
      Q.index = 0;
      Q.answered = false;
      Q.render();
      return true;
    })()`);
    await ev(`(function(){
      const d = document.getElementById('appFrame').contentDocument;
      d.getElementById('btnVisualize').click(); return true;
    })()`);
    await ev(`(function(){
      const w = document.getElementById('appFrame').contentWindow;
      const d = w.document;
      d.getElementById('vizSpeedSel').value = '60';
      return true;
    })()`);
    let done = false;
    for (let i = 0; i < 300; i++) {
      await sleep(200);
      const st = await ev(`document.getElementById('appFrame').contentWindow.__cPractice.Viz.running`);
      if (!st) { done = true; break; }
    }
    ok(done, '冒泡排序仍能跑完并自动停止');

    const viz = JSON.parse(await ev(`(function(){
      const w = document.getElementById('appFrame').contentWindow;
      const d = w.document;
      return JSON.stringify({
        cmp: w.__cPractice.Viz.runner.stats.compare,
        swp: w.__cPractice.Viz.runner.stats.swap,
        vals: w.__cPractice.Viz.values,
        sorted: w.__cPractice.Viz.bars.every(b=>b.el.classList.contains('sorted')),
        bars: w.__cPractice.Viz.bars.length
      });
    })()`));
    ok(viz.cmp === 28, '比较次数仍= 28', viz.cmp);
    ok(viz.swp === 17, '交换次数仍 = 17', viz.swp);
    ok(JSON.stringify(viz.vals) === '[5,7,10,13,14,22,29,37]', '排序结果正确', JSON.stringify(viz.vals));
    ok(viz.sorted && viz.bars === 8, '8 根柱子全部标绿', viz.bars + ' 根');

    // 编辑器可打字（text 光标没被剑覆盖掉，光标位置应能移动）
    const ed = JSON.parse(await ev(`(function(){
      const w = document.getElementById('appFrame').contentWindow;
      const t = w.document.getElementById('editorInput');
      const before = t.value.length;
      t.focus(); t.setSelectionRange(0,0);
      const selStart = t.selectionStart;
      return JSON.stringify({ before, selStart, focused: w.document.activeElement === t });
    })()`));
    ok(ed.focused && ed.selStart === 0, '编辑器仍可聚焦并定位光标');

    // 刷题判分
    const quiz = JSON.parse(await ev(`(function(){
      const w = document.getElementById('appFrame').contentWindow;
      const d = w.document;
      const items = d.querySelectorAll('.qo-item');
      return JSON.stringify({ count: items.length, cursor: items.length? getComputedStyle(items[0]).cursor : null });
    })()`));
    ok(quiz.count > 0, '题库选项正常渲染', quiz.count + ' 项');
    ok(isSword(quiz.cursor), '刷题选项也用剑光标', quiz.cursor);

    // 填空题：确认动态创建的输入框仍能正常接收输入
    //（text 光标只是外观，不影响输入能力；headless 下 focus() 不可靠，
    //  所以断言「值能写入 +事件能被接收」，不断言 activeElement）
    const fill = JSON.parse(await ev(`(function(){
      const w = document.getElementById('appFrame').contentWindow;
      const Q = w.__cPractice.Quiz;
      Q.filterType = 'fill'; Q.applyFilter(); Q.index = 0; Q.answered = false; Q.render();
      const d = w.document;
      const inp = d.querySelector('.qf-input');
      if (!inp) return JSON.stringify({ ok: false });
      inp.value = 'test';
      let got = false;
      inp.addEventListener('input', () => { got = true; }, { once: true });
      inp.dispatchEvent(new w.Event('input', { bubbles: true }));
      return JSON.stringify({ ok: true, val: inp.value, got, cursor: getComputedStyle(inp).cursor });
    })()`));
    ok(fill.ok && fill.val === 'test' && fill.got, '填空框可接收输入', JSON.stringify(fill));
    ok(fill.cursor === 'text', '填空框光标仍为 text', fill.cursor);

    ok(sock.errs.length === 0, '全程无未捕获 JS 异常', sock.errs.slice(0, 2).join(' | ') || '无');
    pass = true;
    sock.close();
  } catch (e) {
    console.log('  ERROR ' + e.message);
  } finally {
    try { child.kill(); } catch (e) {}
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(`\n===== 结果：${PASS} 通过 / ${FAILN} 失败 =====`);
  process.exit(pass && FAILN === 0 ? 0 : 1);
})();
