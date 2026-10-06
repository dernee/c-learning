/**
 * 验证数值转换符的「最长匹配」语义是否符合 C。
 */
const path = require('path');
global.window = global;
require(path.resolve(__dirname, '../js/cCompiler.js'));
const C = global.CCompiler;

function t(label, body, inputs, expect) {
  const code = '#include <stdio.h>\nint main(void){ ' + body + ' return 0; }';
  const r = C.runOnce(code, inputs || []);
  const out = (r.output || '').trim();
  const good = expect === undefined ? true : out === expect;
  console.log((good ? 'PASS ' : 'FAIL ') + label.padEnd(34) + '输出=' + JSON.stringify(out) +
    (expect !== undefined ? '  期望=' + JSON.stringify(expect) : '') + (r.error ? '  错误=' + r.error : ''));
}

console.log('=== %d 最长匹配（C 语义）===');
t('"%d %d" + "7 35"', 'int a,b; scanf("%d %d",&a,&b); printf("%d %d",a,b);', ['7 35'], '7 35');
// 注意：%d 是贪婪匹配，scanf("%d%d",&a,&b) 读 "735" 时
// 第一个 %d 会吃掉全部 735，第二个读失败 —— 这是 C 的真实行为，不是 bug。
t('"%d%d" + "735" → 735 0（C 贪婪语义）', 'int a,b; scanf("%d%d",&a,&b); printf("%d %d",a,b);', ['735'], '735 0');
t('"%d%d" + "7 35" → 7 35', 'int a,b; scanf("%d%d",&a,&b); printf("%d %d",a,b);', ['7 35'], '7 35');
t('"%d %d" + "7 35" → 7 35', 'int a,b; scanf("%d %d",&a,&b); printf("%d %d",a,b);', ['7 35'], '7 35');
t('"%d%d%d" + "12345" → 12345 0 0（贪婪）', 'int a,b,c; scanf("%d%d%d",&a,&b,&c); printf("%d %d %d",a,b,c);', ['12345'], '12345 0 0');
t('"%d%d%d" + "1 2 3" → 1 2 3', 'int a,b,c; scanf("%d%d%d",&a,&b,&c); printf("%d %d %d",a,b,c);', ['1 2 3'], '1 2 3');
t('"%d" + "12ab" → 12', 'int a; scanf("%d",&a); printf("%d",a);', ['12ab'], '12');
t('"%5d" 宽度截断', 'int a; scanf("%5d",&a); printf("%d",a);', ['1234567'], '12345');
t('负数 "%d" + "-42"', 'int a; scanf("%d",&a); printf("%d",a);', ['-42'], '-42');
t('"%f" + "3.14"', 'double d; scanf("%f",&d); printf("%.2f",d);', ['3.14'], '3.14');
t('"%lf" + "3.14"', 'double d; scanf("%lf",&d); printf("%.2f",d);', ['3.14'], '3.14');
t('"%d %f" 混合', 'int a; double d; scanf("%d %f",&a,&d); printf("%d %.1f",a,d);', ['7 2.5'], '7 2.5');

console.log('\n=== %c 原始字符（不跳空白）===');
t('"%c" + "A"', 'char c; scanf("%c",&c); printf("[%c]",c);', ['A'], '[A]');
t('"%c" + " A" → 空格', 'char c; scanf("%c",&c); printf("[%c]",c);', [' A'], '[ ]');
t('" %c" + " A" → A', 'char c; scanf(" %c",&c); printf("[%c]",c);', [' A'], '[A]');
t('"%c%c" + "AB"', 'char c,d; scanf("%c%c",&c,&d); printf("%c%c",c,d);', ['AB'], 'AB');

console.log('\n=== %s 字符串 ===');
t('"%s" + "hello"', 'char s[50]; scanf("%s",s); printf("[%s]",s);', ['hello'], '[hello]');
t('"%s %s" 两个词', 'char s[20],t[20]; scanf("%s %s",s,t); printf("[%s|%s]",s,t);', ['ab cd'], '[ab|cd]');
t('"%10s" 宽度截断', 'char s[50]; scanf("%10s",s); printf("[%s]",s);', ['abcdefghijklmn'], '[abcdefghij]');
