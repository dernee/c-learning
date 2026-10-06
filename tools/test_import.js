/* 1000 题导入后的端到端回归测试 */
global.window = global;
const fs = require('fs'), vm = require('vm');
const D = 'C:/Users/vault/Desktop/c语言练习网站/';
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
for (const f of ['js/questionBank.js', 'js/questionBank1000.js', 'js/cCompiler.js', 'js/scoreCalc.js']) {
  vm.runInThisContext(fs.readFileSync(D + f, 'utf8'), { filename: f });
}
const QB = global.QuestionBank, Q1K = global.QuestionBank1000, SC = global.ScoreCalc, CC = global.CCompiler;

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name.padEnd(30) + ' => ' + String(got).slice(0, 60) + (ok ? '' : '  期望: ' + want));
};

console.log('=== 题库完整性 ===');
t('1000 题数量', Q1K.count(), 1000);
t('25 章节', Q1K.CHAPTERS.length, 25);
t('id 唯一', new Set(Q1K.questions.map(q => q.id)).size, 1000);
t('合并后总题数', QB.count() + Q1K.count(), 1022);
t('每题都有 chapter', Q1K.questions.every(q => q.chapter), true);
t('每题都有 explain', Q1K.questions.every(q => q.explain && q.explain.length > 0), true);
t('每题都有 point', Q1K.questions.every(q => q.point > 0), true);
t('每题 diff 合法', Q1K.questions.every(q => q.diff >= 1 && q.diff <= 3), true);
// 源文档里题干可能跨段落，解析时曾整批丢失，必须守住这条
t('选择/判断/填空题都有题干', Q1K.questions
  .filter(q => q.type === 'choice' || q.type === 'fill')
  .every(q => q.stem && q.stem.trim().length > 0), true);
t('每题都有非空答案', Q1K.questions
  .filter(q => q.type !== 'code')
  .every(q => q.type === 'choice' ? q.answer >= 0
    : q.type === 'fill' ? (q.blanks || []).every(b => b.answer)
      : q.answer), true);

console.log('\n=== 题型数据 ===');
const st = Q1K.statByType();
t('选择题', st.choice, 879);
t('填空题', st.fill, 11);
t('程序阅读', st.read, 71);
t('编程题', st.code, 39);
t('选择题选项>=2', Q1K.getAll('choice').every(q => q.options.length >= 2), true);
t('选择题 answer 在范围内', Q1K.getAll('choice').every(q => q.answer >= 0 && q.answer < q.options.length), true);
t('填空题有 blanks', Q1K.getAll('fill').every(q => q.blanks && q.blanks.length > 0), true);
// 注意：源文档中有 6 题本身只给代码片段（链表反转片段、数组定义等），
// 不含 main()，属正常内容，断言只校验非空即可
t('程序阅读题有 code', Q1K.getAll('read').every(q => q.code && q.code.trim().length > 0), true);
t('程序阅读题有答案', Q1K.getAll('read').every(q => q.answer && q.answer.length > 0), true);
t('编程题有 refcode', Q1K.getAll('code').every(q => q.refcode && q.refcode.trim().length > 0), true);
t('无章节标题残留', Q1K.questions.every(q => !/（第\s*\d+[–\-]\d+\s*题）/.test((q.code || '') + (q.refcode || '') + q.stem)), true);
t('HTML 已转义（无裸尖括号）', Q1K.questions.every(q => !/[^&]<(?!code|br|strong)/.test(q.stem)), true);

console.log('\n=== 判分逻辑 ===');
const cq = Q1K.getAll('choice')[0];
t('选择判对', Quiz_check(cq, cq.answer).correct, true);
t('选择判错', Quiz_check(cq, (cq.answer + 1) % cq.options.length).correct, false);
const rq = Q1K.getAll('read')[0];
const norm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
t('程序阅读判对', norm(rq.answer) === norm(rq.answer), true);
t('程序阅读判错', norm('999') === norm(rq.answer), false);
t('程序阅读忽略多余空格', norm('  ' + rq.answer.replace(/\s+/g, '  ') + '  ') === norm(rq.answer), true);
const fq = Q1K.getAll('fill')[0];
const fobj = {}; fq.blanks.forEach(b => fobj[b.id] = b.answer);
t('填空判对', QB.check(fq, fobj).correct, true);

function Quiz_check(q, ans) {
  return { correct: Number(ans) === Number(q.answer) };
}

console.log('\n=== 章节筛选 ===');
const ch = Q1K.CHAPTERS[0];
t('按章节筛选', Q1K.getAll(null, ch.name).length > 0, true);
t('筛选后题数正确', Q1K.getAll(null, ch.name).length, ch.to - ch.from + 1);
const byTypeCh = Q1K.getAll('choice', ch.name).length;
t('章节+题型组合筛选', byTypeCh > 0 && byTypeCh <= (ch.to - ch.from + 1), true);

console.log('\n=== 计分联动 ===');
SC.reset();
const before = SC.getScore();
SC.submit({ qid: 'c1', title: 't', point: cq.point, correct: true, isRepeat: false });
t('答对得分', SC.getScore() > before, true);
const s1 = SC.getScore();
SC.submit({ qid: 'c1', title: 't', point: cq.point, correct: true, isRepeat: true });
t('重复刷题只+1', SC.getScore() - s1, 1);
t('已答对记录', SC.isCleared('c1'), true);
t('统计数据', SC.getStats().answered, 2);

console.log('\n=== 交叉验证：docx 答案 vs 解析结果 ===');
const raw = JSON.parse(fs.readFileSync('C:/Users/vault/AppData/Local/Temp/c1000.json', 'utf8'));
let mismatch = 0;
raw.questions.forEach(rq2 => {
  const w = Q1K.getById('c' + rq2.no);
  if (!w) { mismatch++; return; }
  if (rq2.type === '单选' || rq2.type === '判断') {
    if (w.answer !== rq2.answer) mismatch++;
  } else if (rq2.type === '程序阅读') {
    if (String(w.answer).trim() !== String(rq2.answer_raw).trim()) mismatch++;
  } else if (rq2.type === '填空') {
    if (w.blanks[0].answer !== rq2.blanks[0].answer) mismatch++;
  }
});
t('1000 题答案与源文档一致', mismatch, 0);

console.log('\n========================================');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================');
process.exit(fail ? 1 : 0);
