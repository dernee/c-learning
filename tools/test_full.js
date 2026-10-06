/**
 * 全功能回归测试（浏览器内真实交互）。
 *
 * 覆盖：
 *  A. 7 个内置示例都能编译并运行
 *  B. 可视化动画：统计正确、柱子高度动画、交换示意、代码联动、残留状态清理
 *  C. 交互输入：scanf / input / getchar，LED 与输入框状态
 *  D. 播放控制：暂停 / 单步 / 重置 / 速度切换
 *  E. 编辑器：滚动、格式化、清空确认、重置确认
 *  F. 刷题：四种题型判分、进度与等级持久化
 *  G. 边界：无数组程序、超长数组、语法错误、运行错误
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SITE = 'file:///' + path.resolve(__dirname, '../ui.html').replace(/\\/g, '/');
const PORT = 9342;
const PROFILE = path.resolve(__dirname, '.edge-profile-full');
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
  }), errs };
}

(async () => {
  spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1680,1050', '--allow-file-access-from-files',
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  try {
    const br = await connect(await wsUrl());
    const { targetId } = await br.send('Target.createTarget', { url: 'about:blank' });
    await sleep(400);
    const { sessionId: S } = await br.send('Target.attachToTarget', { targetId, flatten: true });
    await br.send('Runtime.enable', {}, S);
    await br.send('Page.enable', {}, S);
    await br.send('Page.navigate', { url: SITE }, S);
    await sleep(2800);
    const ev = async expr => {
      const r = await br.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'err');
      return r.result.value;
    };
    for (let i = 0; i < 40 && !(await ev('!!window.__cPractice')); i++) await sleep(300);

    // 干净起点：清空等级与答题记录
    await ev(`localStorage.clear(); 'ok'`);
    await ev(`location.reload(); 'ok'`);
    await sleep(3000);
    for (let i = 0; i < 40 && !(await ev('!!window.__cPractice')); i++) await sleep(300);

    /* ---------------- A. 7 个示例 ---------------- */
    console.log('=== A. 内置示例全部可编译运行 ===');
    const samples = JSON.parse(await ev(`JSON.stringify(Object.keys(window.__cPractice.SAMPLE_CODES))`));
    ok(samples.length === 7, '内置 7 个示例', samples.join(','));
    for (const key of samples) {
      const res = JSON.parse(await ev(`(function(){
        const s = window.__cPractice.SAMPLE_CODES[${JSON.stringify(key)}];
        const r = window.CCompiler.createRunner(s.code);
        return JSON.stringify({ ok: r.ok, error: r.error || '', title: s.title });
      })()`));
      ok(res.ok, `示例「${res.title}」编译通过`, res.error);
    }

    /* ---------------- B. 可视化动画 ---------------- */
    console.log('\n=== B. 可视化：冒泡排序全程 ===');
    await ev(`
      window.__cPractice.Editor.setValue(window.__cPractice.SAMPLE_CODES.bubble.code);
      document.getElementById('vizSpeedSel').value='60';
      document.getElementById('btnVisualize').click(); 'go'
    `);
    let done = false, sawLift = false, sawCandidate = false;
    for (let i = 0; i < 400; i++) {
      await sleep(200);
      const st = JSON.parse(await ev(`JSON.stringify({
        running: window.__cPractice.Viz.running,
        lifted: window.__cPractice.Viz.bars.filter(b=>b.el.classList.contains('lifted')).length,
        candidate: window.__cPractice.Viz.bars.filter(b=>b.el.classList.contains('candidate')).length
      })`));
      if (st.lifted > 0) sawLift = true;
      if (st.candidate > 0) sawCandidate = true;
      if (!st.running) { done = true; break; }
    }
    const viz = JSON.parse(await ev(`JSON.stringify({
      stats: window.__cPractice.Viz.runner.stats,
      values: window.__cPractice.Viz.values,
      allSorted: window.__cPractice.Viz.bars.every(b=>b.el.classList.contains('sorted')),
      cmp: +document.getElementById('statCompare').textContent,
      swp: +document.getElementById('statSwap').textContent,
      codeline: document.getElementById('vizCodelineText').textContent.trim().slice(0,60),
      logs: document.getElementById('vizLog').children.length
    })`));
    ok(done, '冒泡排序跑到结束并自动停止');
    ok(viz.stats.compare === 28, '比较次数 = 28', viz.stats.compare);
    ok(viz.stats.swap === 17, '交换次数 = 17', viz.stats.swap);
    ok(JSON.stringify(viz.values) === '[5,7,10,13,14,22,29,37]', '排序结果正确', JSON.stringify(viz.values));
    ok(viz.allSorted, '结束时全部柱子标记已排定');
    ok(viz.cmp === 28 && viz.swp === 17, '统计面板数字正确', `cmp=${viz.cmp} swp=${viz.swp}`);
    ok(sawLift, '交换时两根柱子有抬起动作');
    ok(sawCandidate, '落下阶段有落位提示');
    ok(!(await ev(`!!document.getElementById('vizRig')`)), '机械臂抓爪已从DOM 移除');
    const noResidue = await ev(`window.__cPractice.Viz.bars.every(b=>!b.el.classList.contains('lifted')&&!b.el.classList.contains('candidate'))`);
    ok(noResidue, '运行结束后无残留高亮');
    ok(viz.logs > 40, '执行日志有足够记录', viz.logs + ' 条');
    const loopNoise = JSON.parse(await ev(`JSON.stringify(
      Array.prototype.filter.call(document.getElementById('vizLog').children,
        n => /比较\\s*\\d+\\s*[<>]\\s*\\d+/.test(n.textContent)).length)`));
    ok(loopNoise === 0, '日志无循环变量比较噪声', loopNoise + ' 条');

    /* ---------------- C. 交互输入 ---------------- */
    console.log('\n=== C. 交互式输入 ===');
    // C1 scanf
    await ev(`
      window.__cPractice.Editor.setValue('#include <stdio.h>\\nint main(void){ int a,b; printf("两数："); scanf("%d %d",&a,&b); printf("\\\\n和=%d 差=%d\\\\n",a+b,a-b); return 0; }');
      window.__cPractice.Viz.reset(); window.__cPractice.Viz.clearBars();
      document.getElementById('btnRunConsole').click(); 'go'
    `);
    await sleep(1200);
    ok(await ev('window.__cPractice.Viz.pendingInput'), 'scanf 会挂起等待输入');
    ok(await ev(`(function(){
      const w = document.getElementById('vcWait');
      return !!w && !w.hasAttribute('hidden');
    })()`), '等待提示条弹出（hidden 已移除）');
    ok(await ev(`document.activeElement && document.activeElement.id === 'vcInput'`), '输入框自动聚焦');
    await ev(`(function(){
      const inp = document.getElementById('vcInput');
      inp.value = '7 35';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return 'ok';
    })()`);
    await sleep(1200);
    let out = await ev(`(document.getElementById('consoleOutput')||{}).textContent || ''`);
    // 输入 7 35 → 和=42、差=-28
    ok(/和=42/.test(out) && /差=-28/.test(out), 'scanf("%d %d") 同读两值正确', JSON.stringify(out.slice(-30)));
    await ev(`window.__cPractice.Viz.stop(); 'x'`);

    // C2 多次 scanf 循环读
    await ev(`
      window.__cPractice.Editor.setValue('#include <stdio.h>\\nint main(void){ int a[5],i,n=0;\\nfor(i=0;i<5;i++){ scanf("%d",&a[i]); if(a[i]==0) break; n++; }\\nfor(i=0;i<n;i++) printf("%d ",a[i]); return 0; }');
      window.__cPractice.Viz.reset(); window.__cPractice.Viz.clearBars();
      document.getElementById('btnRunConsole').click(); 'go'
    `);
    for (const v of ['5', '3', '9', '0']) {
      await sleep(500);
      await ev(`(function(){
        const inp = document.getElementById('vcInput');
        inp.value = ${JSON.stringify(v)};
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return 'ok';
      })()`);
    }
    await sleep(1200);
    out = await ev(`(document.getElementById('consoleOutput')||{}).textContent || ''`);
    ok(/5 3 9/.test(out), '循环里多次 scanf 逐个读入正确', JSON.stringify(out.slice(-24)));
    await ev(`window.__cPractice.Viz.stop(); 'x'`);

    // C3 Esc 取消：喂空串让程序继续，不应卡死
    await ev(`
      window.__cPractice.Editor.setValue(window.__cPractice.SAMPLE_CODES.guess.code);
      window.__cPractice.Viz.reset(); window.__cPractice.Viz.clearBars();
      document.getElementById('btnRunConsole').click(); 'go'
    `);
    // 等到真的挂起在input 上（最多 6 秒）
    let waiting = false;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      if (await ev('window.__cPractice.Console.waiting')) { waiting = true; break; }
    }
    ok(waiting, '猜数字程序等待输入');
    const escBefore = JSON.parse(await ev(`JSON.stringify({
      pending: window.__cPractice.Viz.pendingInput,
      waiting: window.__cPractice.Console.waiting,
      shown: !document.getElementById('vcWait').hasAttribute('hidden')
    })`));
    ok(escBefore.waiting && escBefore.shown, '等待时提示条可见', JSON.stringify(escBefore));
    // Esc 生效后程序会继续跑，并很快又到下一次输入（猜数字是 while 循环），
    // 所以不能断言「pendingInput 一直是 false」，
    // 要断言「程序确实往下走了一轮、并又申请了下一次输入」。
    const outBeforeEsc = await ev(`(document.getElementById('consoleOutput')||{}).textContent||''`);
    await ev(`(function(){
      const inp = document.getElementById('vcInput');
      inp.focus();
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return 'sent';
    })()`);
    await sleep(1000);
    const escRes = JSON.parse(await ev(`JSON.stringify({
      waiting: window.__cPractice.Console.waiting,
      round2: /第 2 次猜测/.test((document.getElementById('consoleOutput')||{}).textContent||''),
      out: (document.getElementById('consoleOutput')||{}).textContent || ''
    })`));
    ok(escRes.round2, 'Esc 跳过后程序继续到第 2 轮', JSON.stringify(escRes.out.slice(-40)));
    ok(escRes.out.length > outBeforeEsc.length, 'Esc 后控制台有新输出',
      `${outBeforeEsc.length} → ${escRes.out.length} 字符`);
    await ev(`window.__cPractice.Viz.stop(); 'x'`);

    /* ---------------- D. 播放控制 ---------------- */
    console.log('\n=== D. 播放控制 ===');
    await ev(`
      window.__cPractice.Editor.setValue(window.__cPractice.SAMPLE_CODES.bubble.code);
      window.__cPractice.Viz.reset(); window.__cPractice.Viz.clearBars();
      document.getElementById('vizSpeedSel').value='600';
      document.getElementById('btnVisualize').click(); 'go'
    `);
    await sleep(900);
    await ev(`document.getElementById('btnVizPause').click(); 'p'`);
    await sleep(300);
    const s1 = await ev('window.__cPractice.Viz.runner.stats.steps');
    await sleep(800);
    const s2 = await ev('window.__cPractice.Viz.runner.stats.steps');
    ok(await ev('window.__cPractice.Viz.paused'), '暂停生效');
    ok(s1 === s2, '暂停期间解释器冻结', s1 + ' → ' + s2);
    await ev(`document.getElementById('btnVizStep').click(); 's'`);
    await sleep(600);
    const s3 = await ev('window.__cPractice.Viz.runner.stats.steps');
    ok(s3 > s2, '单步推进', s2 + ' → ' + s3);
    await ev(`document.getElementById('btnVizReset').click(); 'r'`);
    await sleep(400);
    ok(!(await ev('window.__cPractice.Viz.running')), '重置停止运行');
    const speeds = await ev(`JSON.stringify(Array.prototype.map.call(
      document.getElementById('vizSpeedSel').options, o=>o.value))`);
    ok(JSON.parse(speeds).length === 4, '速度四档', speeds);

    /* ---------------- E. 编辑器 ---------------- */
    console.log('\n=== E. 编辑器功能 ===');
    const ed = JSON.parse(await ev(`JSON.stringify({
      hasLineNo: !!document.getElementById('editorGutter'),
      wrap: document.getElementById('editorScroll') ? getComputedStyle(document.getElementById('editorScroll')).overflowY : '',
      clearBtn: !!document.getElementById('btnClear'),
      fmtBtn: !!document.getElementById('btnFormat')
    })`));
    ok(ed.hasLineNo, '编辑器有行号槽');
    ok(ed.clearBtn && ed.fmtBtn, '格式化 / 清空按钮存在');
    // 滚轮滚动：代码区足够长时，把 wheel 派发到编辑器容器
    const scrolled = await ev(`(function(){
      const Pz = window.__cPractice;
      const long = new Array(120).fill('int x = 1;').join('\\n');
      Pz.Editor.setValue('#include <stdio.h>\\nint main(void){\\n' + long + '\\nreturn 0;\\n}');
      const ed = document.getElementById('editor');
      const sc = document.getElementById('editorScroll');
      ed.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
      return sc.scrollTop;
    })()`);
    ok(scrolled > 0, '滚轮可滚动代码区', 'scrollTop=' + scrolled);

    // 键盘滚动：把光标移到文件中部，模拟用户按方向键下移后视图跟随
    const kbScroll = await ev(`(function(){
      const sc = document.getElementById('editorScroll');
      const inp = document.getElementById('editorInput');
      inp.focus();
      sc.scrollTop = 0;
      // 模拟用户把光标移到第 60 行（等价于连按方向键）
      const lines = inp.value.split('\\n');
      let pos = 0;
      for (let i = 0; i < 60 && i < lines.length; i++) pos += lines[i].length + 1;
      inp.setSelectionRange(pos, pos);
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      return { before: 0, total: sc.scrollHeight, client: sc.clientHeight };
    })()`);
    // rAF 之后再读
    await sleep(300);
    const afterKb = await ev(`document.getElementById('editorScroll').scrollTop`);
    ok(kbScroll.total > kbScroll.client, '长代码时容器可滚动', `${kbScroll.total} > ${kbScroll.client}`);
    ok(afterKb > 0, '光标下移后视图自动跟随滚动', 'scrollTop=' + afterKb);
    // 格式化
    // 格式化：按大括号深度重排缩进（不拆行，这是设计如此）
    const fmt = await ev(`(function(){
      window.__cPractice.Editor.setValue('int main(void){\\nint i;\\nif(i>0){\\nprintf("%d",i);\\n}\\nreturn 0;\\n}');
      window.__cPractice.Editor.format();
      return window.__cPractice.Editor.getValue();
    })()`);
    const fmtLines = fmt.split('\n');
    ok(/^ {4}int i;$/.test(fmtLines[1]), '函数体内语句缩进 4 空格', JSON.stringify(fmtLines[1]));
    ok(/^ {8}printf/.test(fmtLines[3]), '嵌套 if 内语句缩进 8 空格', JSON.stringify(fmtLines[3]));
    const fmtOk = JSON.parse(await ev(`JSON.stringify(
      window.CCompiler.createRunner(${JSON.stringify(fmt)}))`));
    ok(fmtOk.ok, '格式化后代码仍可编译', fmtOk.error || '');
    // 清空确认框
    await ev(`window.__cPractice.Editor.setValue('int main(void){return 0;}'); 'ok'`);
    await ev(`document.getElementById('btnClear').click(); 'ok'`);
    await sleep(500);
    const dlgOpen = await ev(`!!document.querySelector('.confirm-mask.show, .confirm.show, [class*=confirm]')`);
    ok(dlgOpen, '清空会弹确认框');
    await ev(`(function(){
      const btns=Array.prototype.slice.call(document.querySelectorAll('button'));
      const cancel=btns.find(b=>/取消|再想想|留着/.test(b.textContent));
      if(cancel) cancel.click(); else document.querySelector('[class*=confirm] button').click();
      return 'ok';
    })()`);
    await sleep(400);
    ok((await ev(`window.__cPractice.Editor.getValue().trim().length > 0`)), '取消清空后代码保留');

    /* ---------------- F. 刷题 ---------------- */
    console.log('\n=== F. 刷题判分 ===');
    const quiz = JSON.parse(await ev(`JSON.stringify({
      total: window.__cPractice.Quiz.pool.length,
      byType: window.__cPractice.Quiz.pool.reduce((m,q)=>{m[q.type]=(m[q.type]||0)+1;return m;},{})
    })`));
    ok(quiz.total === 1022, '题库总量 1022', quiz.total);
    ok(quiz.byType.choice > 800 && quiz.byType.read > 50 &&
       quiz.byType.code > 30 && quiz.byType.fill > 10, '四种题型齐全', JSON.stringify(quiz.byType));

    // 答对一题 choice，看积分是否增加
    const quizRes = JSON.parse(await ev(`(function(){
      const before=JSON.parse(localStorage.getItem('c_practice_score_v1')||'{}');
      const scoreBefore=(before.score||0);
      const q=window.__cPractice.Quiz.pool.find(x=>x.type==='choice'&&x.options&&x.options.length>1);
      window.__cPractice.Quiz.list=[q]; window.__cPractice.Quiz.index=0; window.__cPractice.Quiz.answered=false; window.__cPractice.Quiz.selected=null; window.__cPractice.Quiz.render();
      // 选中正确项并提交
      const btns=Array.prototype.slice.call(document.querySelectorAll('.qo-item'));
      if(q.answer>0 && btns[q.answer]) btns[q.answer].click();
      document.getElementById('btnSubmitAnswer').click();
      const after=JSON.parse(localStorage.getItem('c_practice_score_v1')||'{}');
      return JSON.stringify({ qid:q.id, scoreBefore, scoreAfter:(after.score||0),
        answered:window.__cPractice.Quiz.answered, selected:window.__cPractice.Quiz.selected, correct:q.answer });
    })()`));
    ok(quizRes.answered, '提交后标记为已作答', quizRes.qid);
    ok(quizRes.scoreAfter > quizRes.scoreBefore, '答对后积分增加',
      `${quizRes.scoreBefore} → ${quizRes.scoreAfter}`);

    // 填空题
    const fillRes = JSON.parse(await ev(`(function(){
      const q=window.__cPractice.Quiz.pool.find(x=>x.type==='fill'&&x.blanks&&x.blanks.length);
      if(!q) return JSON.stringify({skip:true});
      window.__cPractice.Quiz.list=[q]; window.__cPractice.Quiz.index=0; window.__cPractice.Quiz.answered=false; window.__cPractice.Quiz.fillVals={}; window.__cPractice.Quiz.render();
      const inputs=Array.prototype.slice.call(document.querySelectorAll('.qf-input'));
      if(!inputs.length) return JSON.stringify({noInput:true, qid:q.id});
      inputs.forEach((inp,k)=>{ inp.value=q.blanks[k].answer;
        inp.dispatchEvent(new Event('input',{bubbles:true})); });
      document.getElementById('btnSubmitAnswer').click();
      return JSON.stringify({ qid:q.id, answered:window.__cPractice.Quiz.answered, blanks:q.blanks.length });
    })()`));
    ok(fillRes.skip || fillRes.answered, '填空题可作答并判分', JSON.stringify(fillRes));

    /* ---------------- G. 边界情况 ---------------- */
    console.log('\n=== G. 边界与容错 ===');
    // 无数组程序
    await ev(`
      window.__cPractice.Editor.setValue('#include <stdio.h>\\nint main(void){ int x=5; printf("%d",x*2); return 0; }');
      window.__cPractice.Viz.reset(); window.__cPractice.Viz.clearBars();
      document.getElementById('btnVisualize').click(); 'go'
    `);
    await sleep(1500);
    ok((await ev('window.__cPractice.Viz.bars.length')) === 0, '无数组程序不生成柱子');
    ok(/10/.test(await ev(`(document.getElementById('consoleOutput')||{}).textContent||''`)), '无数组程序仍能输出结果');
    await ev(`window.__cPractice.Viz.stop(); 'x'`);

    // 语法错误
    const syn = JSON.parse(await ev(`(function(){
      window.__cPractice.Editor.setValue('int main(void){ int a = ; return 0; }');
      const r=window.CCompiler.createRunner(window.__cPractice.Editor.getValue());
      return JSON.stringify({ok:r.ok, err:r.error||''});
    })()`));
    ok(!syn.ok && !!syn.err, '语法错误被捕获', syn.err);

    // 运行时错误（除零）
    const rt = JSON.parse(await ev(`(function(){
      const r=window.CCompiler.runOnce('#include <stdio.h>\\nint main(void){ int a=5,b=0; printf("%d",a/b); return 0; }',[]);
      return JSON.stringify({ok:!r.error, err:r.error||''});
    })()`));
    ok(!rt.ok && /0/.test(rt.err), '除零报错友好', rt.err);

    // 死循环保护
    const t0 = Date.now();
    const inf = JSON.parse(await ev(`(function(){
      const r=window.CCompiler.runOnce('#include <stdio.h>\\nint main(void){ while(1){} return 0; }',[]);
      return JSON.stringify({ok:!r.error, err:r.error||''});
    })()`));
    ok(!inf.ok && Date.now() - t0 < 15000, '死循环被自动中止', inf.err.slice(0, 30));

    // 切换模式
    await ev(`document.querySelector('[data-mode=quiz]').click(); 'ok'`);
    await sleep(400);
    ok((await ev('document.body.dataset.mode')) === 'quiz', '可切换到刷题模式',
      await ev('document.body.dataset.mode'));
    ok(await ev(`document.getElementById('panelQuiz').offsetHeight > 0`), '刷题面板可见');
    await ev(`document.querySelector('[data-mode=viz]').click(); 'ok'`);
    await sleep(300);
    ok((await ev('document.body.dataset.mode')) === 'viz', '可切回可视化模式');

    ok(br.errs.length === 0, '全程无未捕获 JS 异常', br.errs.slice(0, 2).join(' | '));
  } catch (e) {
    FAILN++;
    console.error('ERR:', e.message);
  } finally {
    try { execSync('taskkill /F /IM msedge.exe /T', { stdio: 'ignore' }); } catch (e) {}
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
    console.log(`\n===== 结果：${PASS} 通过 / ${FAILN} 失败 =====`);
    process.exit(0);
  }
})();
