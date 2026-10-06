/**
 * 编译器字符串与赋值语义的回归测试。
 *
 * 这两条都是真实修过的 bug，锁住它们以免将来改代码时复发：
 *  1. char s[10] = "ab";  字符串字面量初始化以前被忽略，s 全是 0
 *  2. s[j++] = s[i];赋值左值下标被求值两次，j 多加一次，写到错下标
 */
const path = require('path');
global.window = global;
require(path.resolve(__dirname, '../js/cCompiler.js'));
const C = global.CCompiler;

let P = 0, F = 0;
function ok(c, m, x) { if (c) { P++; console.log('  PASS ' + m + (x !== undefined ? '  => ' + x : '')); } else { F++; console.log('  FAIL ' + m + (x !== undefined ? '  => ' + x : '')); } }
function run(code, inputs) {
  const r = C.runOnce(code, inputs || []);
  return { out: (r.output || '').trim(), err: r.error };
}

console.log('=== A. 字符数组用字符串字面量初始化 ===');
let r = run('#include <stdio.h>\nint main(void){ char s[10]="ab"; printf("%s", s); return 0; }');
ok(r.out === 'ab' && !r.err, 'char s[10]="ab" 正确存成 "ab"', JSON.stringify(r.out) + r.err);

r = run('#include <stdio.h>\nint main(void){ char s[6]="hello"; printf("%s", s); return 0; }');
ok(r.out === 'hello' && !r.err, 'char s[6]="hello"（自动补\\0）', JSON.stringify(r.out) + r.err);

r = run('#include <stdio.h>\nint main(void){ char s[10]="ab"; printf("%d %d %d", s[0], s[1], s[2]); return 0; }');
ok(r.out === '97 98 0' && !r.err, '逐字符取 ASCII 且第3位是 \\0', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ char s[10]="abc"; int n=0,i; for(i=0;s[i]!=0;i++) n++; printf("%d", n); return 0; }');
ok(r.out === '3' && !r.err, 'strlen 语义正确（遇\\0停）', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ char s[2]="ab"; printf("%d", s[0]+s[1]); return 0; }');
ok(r.out === '195' && !r.err, 'char s[2]="ab" 放不下\\0时不越界', r.out + r.err);

console.log('\n=== B. 赋值左值下标只求值一次 ===');
r = run('#include <stdio.h>\nint main(void){ char s[50]; int i,j=0; scanf("%s", s);\nfor(i=0;s[i]!=0;i++) if(s[i]<\'0\'||s[i]>\'9\') s[j++]=s[i];\ns[j]=0; printf("%s", s); return 0; }', ['ab12c3d']);
ok(r.out === 'abcd' && !r.err, 's[j++]=s[i] 原地过滤数字', JSON.stringify(r.out) + r.err);

r = run('#include <stdio.h>\nint main(void){ int a[10]; int i,j=0; for(i=0;i<5;i++) a[i]=i+1;\nint n=0; for(i=0;i<5;i++) if(a[i]%2==1) a[j++]=a[i];\nprintf("%d %d %d", a[0],a[1],a[2]); return 0; }');
ok(r.out === '1 3 5' && !r.err, 'a[j++]=a[i] 原地保留奇数', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ int a[5]={0}; int i=0; a[i++]=10; a[i++]=20; printf("%d %d %d", a[0],a[1],i); return 0; }');
ok(r.out === '10 20 2' && !r.err, '连续 a[i++]=v 下标依次递增', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ int a[3]={1,2,3}; int i=0; int v=a[i++]; printf("%d %d", v, i); return 0; }');
ok(r.out === '1 1' && !r.err, '后置自增在表达式中返回旧值', r.out + r.err);

console.log('\n=== C. 赋值表达式本身的值 ===');
r = run('#include <stdio.h>\nint main(void){ int a; int b; b=(a=5)+1; printf("%d %d", a, b); return 0; }');
ok(r.out === '5 6' && !r.err, '(a=5)+1 → a=5, b=6', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ int i=0; int x = (i=3) + (i=4); printf("%d %d", i, x); return 0; }');
ok(r.out === '4 7' && !r.err, '嵌套赋值顺序正确', r.out + r.err);

console.log('\n=== D. 回归：既有能力没被破坏 ===');
r = run('#include <stdio.h>\nint main(void){ int a[5]={5,3,8,1,9}; int n=5,i,j,t;\nfor(i=0;i<n-1;i++) for(j=0;j<n-1-i;j++) if(a[j]>a[j+1]){t=a[j];a[j]=a[j+1];a[j+1]=t;}\nfor(i=0;i<n;i++) printf("%d ", a[i]); return 0; }');
ok(r.out === '1 3 5 8 9' && !r.err, '冒泡排序仍正确', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ int a=5,b=3,t; t=a; a=b; b=t; printf("%d %d", a, b); return 0; }');
ok(r.out === '3 5' && !r.err, '标量三变量交换仍正确', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ int x; scanf("%d", &x); printf("%d", x*2); return 0; }', ['21']);
ok(r.out === '42' && !r.err, 'scanf 取地址仍正常', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ char s[50]; char c; scanf("%s", s); printf("%d", s[0]); return 0; }', ['abc']);
ok(r.out === '97' && !r.err, 'scanf 读字符串后取下标仍正常', r.out + r.err);

r = run('#include <stdio.h>\nint main(void){ int i; for(i=0;i<3;i++){ if(i==1) continue; printf("%d", i);} return 0; }');
ok(r.out === '02' && !r.err, 'continue 仍正常', r.out + r.err);

console.log(`\n===== ${P} 通过 / ${F} 失败 =====`);
process.exit(F ? 1 : 0);
