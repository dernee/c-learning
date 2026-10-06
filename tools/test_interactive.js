global.window = global;
require(require('path').join(__dirname, '..', 'js', 'cCompiler.js'));
const C = global.CCompiler;
let P=0,F=0;
function ok(c,m,x){ if(c){P++;console.log('  PASS '+m+(x!==undefined?'  => '+x:''));} else {F++;console.log('  FAIL '+m+(x!==undefined?'  => '+x:''));} }

console.log('=== A. scanf 同一行多变量 ===');
let r = C.runOnce(`#include <stdio.h>
int main(void){ int a,b; printf("两数："); scanf("%d %d",&a,&b); printf("\\n和=%d 差=%d\\n",a+b,a-b); return 0; }`, ['7 35']);
ok(r.output.includes('和=42'), '7+35=42', JSON.stringify(r.output.trim()));

console.log('=== B. scanf %f / %c / %s ===');
r = C.runOnce(`#include <stdio.h>
int main(void){ double x; char c; char s[20]; scanf("%f %c %s",&x,&c,s); printf("%.1f|%c|%s\\n",x,c,s); return 0; }`, ['3.5 A hello']);
ok(r.output.trim()==='3.5|A|hello', '混合格式串：%c 前有空格故跳过空白读 A，%s 接着读 hello（C 标准行为）', JSON.stringify(r.output.trim()));
r = C.runOnce(`#include <stdio.h>
int main(void){ double x; char c; char s[20]; scanf("%f %c%s",&x,&c,s); printf("%.1f|%c|%s\\n",x,c,s); return 0; }`, ['3.5 Ahello']);
ok(r.output.trim()==='3.5|A|hello', '格式串无空格：%s 接着读 hello', JSON.stringify(r.output.trim()));

console.log('=== C. 猜数字游戏（while + scanf 循环交互）===');
const guess = `#include <stdio.h>
int main(void){
  int secret = 42, guess, cnt = 0;
  printf("我想好了一个 1-100 的数，来猜！\\n");
  while (1) {
    printf("请输入你猜的数字：");
    scanf("%d", &guess);
    cnt++;
    if (guess < secret) printf("  太小了\\n");
    else if (guess > secret) printf("  太大了\\n");
    else { printf("  猜中了！用了 %d 次\\n", cnt); break; }
  }
  return 0;
}`;
r = C.runOnce(guess, ['50','20','60','42']);
ok(r.output.includes('猜中了！用了 4 次'), '4 次猜中', JSON.stringify(r.output.replace(/\n/g,'⏎')));

console.log('=== D. 交互事件可被宿主逐次喂值 ===');
const run = C.createRunner(guess);
const it = run.start();
const script = ['50','20','60','42'];
let s = it.next(); const types=[]; let guard=0;
while(!s.done && guard++ < 800){
  types.push(s.value.type);
  if(s.value.type==='input') s = it.next(script.shift());
  else s = it.next();
}
const nIn = types.filter(t=>t==='input').length;
ok(nIn===4, '产生 4 次 input 事件', nIn);
ok(types.filter(t=>t==='end').length===1, '有且仅有 1 次 end 事件');
ok(run.output.includes('猜中了'), '输出正确', JSON.stringify(run.output.slice(-20)));

console.log('=== E. 交互中变量面板可见（vars 快照）===');
const run2 = C.createRunner(`#include <stdio.h>
int main(void){ int a; printf("a?"); scanf("%d",&a); printf("\\n",a); return 0; }`);
const it2 = run2.start(); let s2 = it2.next(); let sawInput=false, lastVars=null;
while(!s2.done){ if(s2.value.type==='input'){ sawInput=true; s2=it2.next('5'); } else { if(s2.value.vars) lastVars=s2.value.vars; s2=it2.next(); } }
ok(sawInput, '出现 input 事件');
ok(lastVars && lastVars.a===5, 'input 后 a=5 反映在 vars', JSON.stringify(lastVars));

console.log('=== F. 边界 ===');
r = C.runOnce(`#include <stdio.h>
int main(void){ int a; scanf("%d",&a); printf("[%d]\\n",a); return 0; }`, ['abc']);
ok(r.output.includes('[0]'), '非法输入→0（C的 atoi 行为）', JSON.stringify(r.output.trim()));
r = C.runOnce(`#include <stdio.h>
int main(void){ int n=0; while(1){ printf("x?"); scanf("%d",&n); if(n>0) break; } printf("\\n[%d]\\n",n); return 0; }`, ['','-1','0','3']);
ok(r.output.includes('[3]'), '空行/负数/0 后继续等输入', JSON.stringify(r.output.replace(/\n/g,'⏎')));
const an = C.analyze(`#include <stdio.h>
int main(void){ int x; scanf("%d",&x); return 0; }`);
ok(an.hasInput===true && an.inputFuncs[0]==='scanf', 'analyze 检出 scanf', JSON.stringify(an.inputFuncs));
const an2 = C.analyze(`#include <stdio.h>
int main(void){ int a[5]={1,2,3,4,5}; int i,j,t; for(i=0;i<4;i++)for(j=0;j<4-i;j++)if(a[j]>a[j+1]){t=a[j];a[j]=a[j+1];a[j+1]=t;} return 0; }`);
ok(an2.isSort===true && an2.hasInput===false, 'analyze 排序识别不受影响');

console.log('=== G. swap 事件带行号（抓手动画需要）===');
const run3 = C.createRunner(`#include <stdio.h>
int main(void){
  int a[3] = {3,2,1};
  int t;
  if (a[0] > a[1]) { t = a[0]; a[0] = a[1]; a[1] = t; }
  return 0;
}`);
const it3 = run3.start(); let s3 = it3.next(); let swapEv=null;
while(!s3.done){ if(s3.value.type==='swap') swapEv=s3.value; s3=it3.next(); }
ok(swapEv && swapEv.line>0, 'swap 事件带正确行号', swapEv ? `line=${swapEv.line} i=${swapEv.i} j=${swapEv.j}` : 'null');

console.log('=== H. char 数组声明 size 修复回归 ===');
r = C.runOnce(`#include <stdio.h>
int main(void){ char s[6]="hi"; int i; for(i=0;i<5;i++) s[i]=s[i]; printf("%d\\n", s[2]); return 0; }`);
ok(r.ok, 'char s[6] 正常', r.error||JSON.stringify(r.output));
r = C.runOnce(`#include <stdio.h>
int main(void){ int a[100]; int i; for(i=0;i<100;i++) a[i]=i*i; printf("%d %d\\n", a[3], a[99]); return 0; }`);
ok(r.output.includes('9 9801'), 'int a[100] 大数组', JSON.stringify(r.output.trim()));

console.log('\n=====  '+P+' PASS / '+F+' FAIL  =====');
process.exit(F?1:0);
