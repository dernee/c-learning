/* ============================================================
 * cCompiler.js —— C 语言模拟编译运行模块
 * ------------------------------------------------------------
 * 【它做了什么】
 *   纯前端实现的「迷你 C 解释器」，三步走：
 *     1) 预处理：去注释、去 #include 预处理指令
 *     2) 编译：词法分析 → 递归下降语法分析 → AST 抽象语法树
 *     3) 运行：解释执行 AST，以「生成器(generator)」逐个产出事件
 *
 * 【为什么用生成器】
 *   可视化动画需要「一步一步」执行，生成器天然支持：
 *   每产出一个事件就暂停，等 UI 画完再继续。既能全速跑（仅打印），
 *   也能单步调试，还能中途暂停。
 *
 * 【支持的 C 子集】
 *   ✓ 变量声明：int / double / char，含数组与初始化列表
 *   ✓ 赋值与复合赋值：= += -= *= /= %=
 *   ✓ 运算符：+ - * / % < > <= >= == != && || ! ++ -- sizeof ?:
 *   ✓ 控制流：if / else / for / while / do-while / break / continue / return
 *   ✓ 数组下标访问 a[i]，数组作为函数参数按引用传递
 *   ✓ 函数定义与调用（含递归），printf / puts 内置
 *   ✗ 不支持：指针运算、malloc、结构体、联合体、typedef、文件操作
 *
 * 【产出的事件类型】
 *   array   声明数组         line    定位到某一行
 *   setVar  标量变量赋值     loop    进入一轮循环
 *   compare 数组元素比较     swap    两个元素交换
 *   set     数组元素写入     print   printf 输出
 *   end     程序结束         error   运行/编译错误
 * ============================================================ */

const CCompiler = (function () {
  'use strict';

  /* ============================================================
   * 第 1 步：预处理 —— 去注释 + 去 # 指令
   * ============================================================ */
  function preprocess(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';   // code | str | chr | line | block
    let atLineStart = true;

    while (i < n) {
      const c = src[i];
      const c2 = src[i + 1];

      if (state === 'code') {
        // 预处理指令：整行丢弃，但保留换行以维持行号
        if (c === '#' && atLineStart) {
          while (i < n && src[i] !== '\n') i++;
          continue;
        }
        if (c === '"') { state = 'str'; out += c; i++; atLineStart = false; continue; }
        if (c === "'") { state = 'chr'; out += c; i++; atLineStart = false; continue; }
        if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
        if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
        out += c;
        atLineStart = (c === '\n');
        i++;
        continue;
      }

      if (state === 'str') {
        if (c === '\\') { out += c + (c2 || ''); i += 2; continue; }
        out += c;
        if (c === '"') state = 'code';
        i++;
        continue;
      }

      if (state === 'chr') {
        if (c === '\\') { out += c + (c2 || ''); i += 2; continue; }
        out += c;
        if (c === "'") state = 'code';
        i++;
        continue;
      }

      if (state === 'line') {
        if (c === '\n') { out += '\n'; state = 'code'; atLineStart = true; }
        i++;
        continue;
      }

      if (state === 'block') {
        if (c === '\n') { out += '\n'; atLineStart = true; }
        if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; }
        i++;
        continue;
      }
    }
    return out;
  }

  /* ============================================================
   * 第 2 步之一：词法分析 —— 把源码切成 token 流
   * ============================================================ */
  const KEYWORDS = new Set([
    'int', 'char', 'double', 'float', 'long', 'short', 'unsigned', 'signed',
    'void', 'const', 'static', 'struct', 'enum', 'typedef',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'break', 'continue', 'return', 'goto', 'sizeof'
  ]);

  const TYPE_KEYWORDS = new Set(['int', 'char', 'double', 'float', 'long', 'short', 'unsigned', 'signed']);

  // 多字符运算符必须排在前面，否则 '==' 会被切成两个 '='
  const OPERATORS = [
    '<<=', '>>=',
    '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^',
    '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}'
  ];

  function CError(message, line) {
    const e = new Error(message);
    e.name = 'CError';
    e.line = line || 0;
    e.isCError = true;
    return e;
  }

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;
    const n = src.length;

    while (i < n) {
      const c = src[i];

      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

      // 字符串字面量
      if (c === '"') {
        let j = i + 1, val = '';
        while (j < n && src[j] !== '"') {
          if (src[j] === '\\') { val += unescape(src[j + 1]); j += 2; }
          else { if (src[j] === '\n') line++; val += src[j]; j++; }
        }
        if (j >= n) throw CError('字符串未闭合（缺少右引号 "）', line);
        tokens.push({ type: 'string', value: val, line });
        i = j + 1;
        continue;
      }

      // 字符字面量
      if (c === "'") {
        let j = i + 1, val = '';
        while (j < n && src[j] !== "'") {
          if (src[j] === '\\') { val = unescape(src[j + 1]); j += 2; }
          else { val = src[j]; j++; }
        }
        if (j >= n) throw CError('字符常量未闭合（缺少右单引号 \'）', line);
        tokens.push({ type: 'char', value: val.charCodeAt(0), line });
        i = j + 1;
        continue;
      }

      // 数字（整数 / 浮点 / 十六进制）
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i;
        if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
          j = i + 2;
          while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
          tokens.push({ type: 'number', value: parseInt(src.slice(i, j), 16), isFloat: false, line });
        } else {
          let isFloat = false;
          while (j < n && /[0-9]/.test(src[j])) j++;
          if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) {
            isFloat = true; j++;
            while (j < n && /[0-9]/.test(src[j])) j++;
          }
          if (src[j] === 'e' || src[j] === 'E') {
            isFloat = true; j++;
            if (src[j] === '+' || src[j] === '-') j++;
            while (j < n && /[0-9]/.test(src[j])) j++;
          }
          if (src[j] === 'f' || src[j] === 'F' || src[j] === 'L' || src[j] === 'l') j++;
          tokens.push({ type: 'number', value: parseFloat(src.slice(i, j)), isFloat, line });
        }
        i = j;
        continue;
      }

      // 标识符 / 关键字
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j);
        tokens.push({ type: KEYWORDS.has(word) ? 'keyword' : 'ident', value: word, line });
        i = j;
        continue;
      }

      // 运算符
      const op = OPERATORS.find(o => src.startsWith(o, i));
      if (op) {
        tokens.push({ type: 'op', value: op, line });
        i += op.length;
        continue;
      }

      throw CError(`无法识别的字符 "${c}"`, line);
    }

    tokens.push({ type: 'eof', value: '<eof>', line });
    return tokens;
  }

  function unescape(ch) {
    switch (ch) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '0': return '\0';
      case '\\': return '\\';
      case '"': return '"';
      case "'": return "'";
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      default: return ch;
    }
  }

  /* ============================================================
   * 第 2 步之二：语法分析 —— 递归下降，产出 AST
   * ============================================================ */

  // 运算符优先级（数字越大结合越紧）
  const BINARY_PRECEDENCE = {
    '||': 1,
    '&&': 2,
    '|': 3,
    '^': 4,
    '&': 5,
    '==': 6, '!=': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7,
    '<<': 8, '>>': 8,
    '+': 9, '-': 9,
    '*': 10, '/': 10, '%': 10
  };
  const RIGHT_ASSOC = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

  function parse(tokens) {
    let pos = 0;

    const peek = (k = 0) => tokens[pos + k] || tokens[tokens.length - 1];
    const at = (type, value) => {
      const t = peek();
      return t.type === type && (value === undefined || t.value === value);
    };
    const next = () => tokens[pos++] || tokens[tokens.length - 1];
    const eat = (type, value) => {
      if (at(type, value)) { return next(); }
      return null;
    };
    const expect = (type, value) => {
      if (at(type, value)) return next();
      const t = peek();
      const got = t.type === 'eof' ? '文件结束' : `"${t.value}"`;
      throw CError(`语法错误：期望 ${value || type}，实际是 ${got}`, t.line);
    };
    const line = () => peek().line;

    /* ---------- 顶层：解析 main 函数体 ---------- */
    function parseProgram() {
      const body = [];
      let mainBody = null;
      const funcs = {};

      while (!at('eof')) {
        // 跳过花括号外的类型声明残留（如 int a[]; 全局声明）
        if (at('op', ';')) { next(); continue; }

        const startLine = line();
        let retType = null;
        if (at('keyword') && TYPE_KEYWORDS.has(peek().value)) {
          retType = next().value;
          while (at('keyword') && TYPE_KEYWORDS.has(peek().value)) next();  // unsigned int
        }

        if (!at('ident')) {
          // 无法识别，跳过这个 token 防止死循环
          next();
          continue;
        }

        const name = next().value;

        if (at('op', '(')) {
          // 函数定义
          next(); // (
          const params = parseParams();
          expect('op', ')');
          if (at('op', '{')) {
            const fbody = parseBlock();
            funcs[name] = { name, params, body: fbody.body, returnType: retType, line: startLine };
            if (name === 'main') mainBody = fbody;
          }
          continue;
        }

        // 全局变量声明（只做记录，不参与逐步动画）
        parseDeclTail(name, retType, startLine);
        if (at('op', ';')) next();
      }

      return { body: mainBody ? mainBody.body : body, funcs };
    }

    function parseParams() {
      const params = [];

      // 兼容三种空参写法：f()、f(void)、f(VOID)
      if (at('op', ')')) return params;
      if (at('keyword', 'void') && (tokens[pos + 1] || {}).value === ')') {
        next();
        return params;
      }

      do {
        let ptype = 'int';
        if (at('keyword') && TYPE_KEYWORDS.has(peek().value)) {
          ptype = next().value;
          while (at('keyword') && TYPE_KEYWORDS.has(peek().value)) next();
        }
        if (at('ident')) {
          const pname = next().value;
          let isArray = false;
          if (at('op', '[')) {
            next();
            isArray = true;
            if (!at('op', ']')) parseExpression();
            expect('op', ']');
          }
          params.push({ name: pname, type: ptype, isArray });
        }
      } while (eat('op', ','));
      return params;
    }

    /**
     * 解析声明的「尾部」：a[10] = {...}, b = 3, *p = a, c
     * 指针支持范围有限：仅支持「指向数组首元素」的指针，
     * 即 int *p = a; *p 读 a[0]、p[i] 读 a[i]、p-- / p++ 移动下标。
     * 这已足够跑通指针入门题，不追求完整指针语义。
     */
    function parseDeclTail(firstName, baseType, startLine) {
      const decls = [];
      // 形如 *p / **pp 的星号前缀
      let stars = 0;
      while (at('op', '*')) { next(); stars++; }
      // 星号前缀后必须跟标识符；若调用方未提供名字（如 `int *p`），在此补读
      if (stars > 0 && !firstName && at('ident')) firstName = next().value;
      let name = firstName;

      do {
        const d = {
          name, type: baseType || 'int',
          isArray: false, size: null, init: null,
          isPtr: stars > 0, ptrDepth: stars
        };
        // 逗号之后可能又出现 *q
        stars = 0;
        if (at('op', '[')) {
          next();
          d.isArray = true;
          if (!at('op', ']')) {
            const sz = parseExpression();
            // parseExpression 返回的是 AST 节点（Num / Binary …），不是 token。
            // ★ 早前这里写成 sz.type === 'number' 永远为假，导致
            //   `char s[10];` 的 size 恒为 null、数组实际长度 0，
            //   任何 s[i] 访问都报「数组越界（有效范围 0 ~ -1）」。
            d.size = (sz.type === 'Num' && Number.isFinite(sz.value)) ? sz.value : null;
          }
          expect('op', ']');
        }
        if (eat('op', '=')) {
          d.init = at('op', '{') ? parseInitializer() : parseAssignment();
        }
        decls.push(d);
        if (!eat('op', ',')) break;
        // 下一项：可能带 * 前缀
        stars = 0;
        while (at('op', '*')) { next(); stars++; }
        if (at('ident')) name = next().value;
        else break;
      } while (true);

      return { type: 'VarDecl', decls, line: startLine };
    }

    function parseInitializer() {
      expect('op', '{');
      const items = [];
      if (!at('op', '}')) {
        do {
          if (at('op', '}')) break;   // 允许 {1, 2, ,}
          items.push(at('op', '{') ? parseInitializer() : parseAssignment());
        } while (eat('op', ','));
      }
      expect('op', '}');
      return { type: 'InitList', items, line: line() };
    }

    /* ---------- 语句 ---------- */
    function parseBlock() {
      const startLine = line();
      expect('op', '{');
      const body = [];
      while (!at('op', '}') && !at('eof')) {
        body.push(parseStatement());
      }
      expect('op', '}');
      return { type: 'Block', body, line: startLine };
    }

    function parseStatement() {
      const startLine = line();

      if (at('op', '{')) return parseBlock();
      if (eat('op', ';')) return { type: 'Empty', line: startLine };

      if (at('keyword', 'if')) {
        next();
        expect('op', '(');
        const test = parseExpression();
        expect('op', ')');
        const cons = parseStatement();
        let alt = null;
        if (at('keyword', 'else')) { next(); alt = parseStatement(); }
        return { type: 'If', test, cons, alt, line: startLine };
      }

      if (at('keyword', 'while')) {
        next();
        expect('op', '(');
        const test = parseExpression();
        expect('op', ')');
        const body = parseStatement();
        return { type: 'While', test, body, line: startLine };
      }

      if (at('keyword', 'do')) {
        next();
        const body = parseStatement();
        expect('keyword', 'while');
        expect('op', '(');
        const test = parseExpression();
        expect('op', ')');
        expect('op', ';');
        return { type: 'DoWhile', test, body, line: startLine };
      }

      if (at('keyword', 'for')) {
        next();
        expect('op', '(');
        let init = null;
        if (!at('op', ';')) {
          if (at('keyword') && TYPE_KEYWORDS.has(peek().value)) {
            let t = next().value;
            while (at('keyword') && TYPE_KEYWORDS.has(peek().value)) t = peek().value, next();
            init = parseDeclTail(next().value, t, startLine);
          } else {
            const e = parseExpression();
            init = { type: 'ExprStmt', expr: e, line: e.line };
          }
        }
        expect('op', ';');
        const test = at('op', ';') ? null : parseExpression();
        expect('op', ';');
        const update = at('op', ')') ? null : parseExpression();
        expect('op', ')');
        const body = parseStatement();
        return { type: 'For', init, test, update, body, line: startLine };
      }

      if (at('keyword', 'return')) {
        next();
        const arg = at('op', ';') ? null : parseExpression();
        expect('op', ';');
        return { type: 'Return', arg, line: startLine };
      }

      if (at('keyword', 'break')) { next(); expect('op', ';'); return { type: 'Break', line: startLine }; }
      if (at('keyword', 'continue')) { next(); expect('op', ';'); return { type: 'Continue', line: startLine }; }

      // 声明语句
      if (at('keyword') && TYPE_KEYWORDS.has(peek().value)) {
        let t = next().value;
        while (at('keyword') && TYPE_KEYWORDS.has(peek().value)) { t = next().value; }
        // 指针声明：类型后可能先出现 *，如 int *p = a;
        if (at('op', '*') || at('ident')) {
          const first = at('op', '*') ? '' : next().value;
          const node = parseDeclTail(first, t, startLine);
          expect('op', ';');
          return node;
        }
        // 类型名后面不是标识符 → 强制类型转换 (int)x 走表达式分支
        const save = pos;
        pos = 0;
        while (tokens[pos] && tokens[pos].line < startLine) pos++;
        pos = save;
        throw CError(`第 ${startLine} 行：类型 "${t}" 后缺少变量名`, startLine);
      }

      const expr = parseExpression();
      expect('op', ';');
      return { type: 'ExprStmt', expr, line: startLine };
    }

    /* ---------- 表达式 ---------- */
    function parseExpression() {
      let left = parseAssignment();
      while (at('op', ',')) {
        const ln = line();
        next();
        const right = parseAssignment();
        left = { type: 'Binary', op: ',', left, right, line: ln };
      }
      return left;
    }

    function parseAssignment() {
      const left = parseConditional();
      const t = peek();
      if (t.type === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='].includes(t.value)) {
        const ln = line();
        const op = next().value;
        const right = parseAssignment();
        return { type: 'Assign', op, left, right, line: ln };
      }
      return left;
    }

    function parseConditional() {
      const cond = parseBinary(1);
      if (at('op', '?')) {
        const ln = line();
        next();
        const cons = parseAssignment();
        expect('op', ':');
        const alt = parseAssignment();
        return { type: 'Conditional', test: cond, cons, alt, line: ln };
      }
      return cond;
    }

    function parseBinary(minPrec) {
      let left = parseUnary();
      for (;;) {
        const t = peek();
        if (t.type !== 'op') break;
        const prec = BINARY_PRECEDENCE[t.value];
        if (!prec || prec < minPrec) break;
        const ln = line();
        const op = next().value;
        const right = parseBinary(RIGHT_ASSOC.has(op) ? prec : prec + 1);
        left = { type: 'Binary', op, left, right, line: ln };
      }
      return left;
    }

    function parseUnary() {
      const t = peek();

      // 强制类型转换： (double)x / (int)y / (long)n / (char)c
      // ★ 以前完全没实现，导致成绩统计这类常见教学代码
      //   printf("%.1f", (double)total / count) 直接报「意外的 double」。
      //   判定方式：当前是 '('，紧接着是类型关键字，然后是 ')'。
      //   注意不能和「函数调用 foo(x)」混淆 —— 那种 '(' 后面是标识符。
      if (t.type === 'op' && t.value === '(') {
        const save = pos;
        const ln = line();
        next();                       // 吃掉 '('
        if (at('keyword') && TYPE_KEYWORDS.has(peek().value)) {
          let ty = next().value;
          while (at('keyword') && TYPE_KEYWORDS.has(peek().value)) ty = next().value;
          if (at('op', ')')) {
            next();                   // 吃掉 ')'
            // 转换后面必须是一个可运算的一元表达式
            if (!at('op', ')') && !at('op', ',') && !at('op', ';')) {
              const arg = parseUnary();
              return { type: 'Cast', cType: ty, arg, line: ln };
            }
          }
        }
        pos = save;                   // 不是类型转换，退回
      }

      if (t.type === 'op' && ['!', '~', '-', '+', '++', '--', '*', '&'].includes(t.value)) {
        const ln = line();
        const op = next().value;
        const arg = parseUnary();
        return { type: 'Unary', op, arg, prefix: true, line: ln };
      }
      if (t.type === 'keyword' && t.value === 'sizeof') {
        const ln = line();
        next();
        if (at('op', '(')) {
          const save = pos;
          next();
          if (at('keyword') && TYPE_KEYWORDS.has(peek().value)) {
            let ty = next().value;
            while (at('keyword') && TYPE_KEYWORDS.has(peek().value)) ty = next().value;
            expect('op', ')');
            return { type: 'SizeofType', cType: ty, line: ln };
          }
          pos = save;
        }
        const arg = parseUnary();
        return { type: 'Sizeof', arg, line: ln };
      }
      return parsePostfix();
    }

    function parsePostfix() {
      let node = parsePrimary();
      for (;;) {
        const t = peek();
        if (t.type === 'op' && t.value === '[') {
          const ln = line();
          next();
          const index = parseExpression();
          expect('op', ']');
          node = { type: 'ArrayAccess', name: node.name, index, line: ln };
          continue;
        }
        if (t.type === 'op' && t.value === '(') {
          const ln = line();
          next();
          const args = [];
          if (!at('op', ')')) {
            do { args.push(parseAssignment()); } while (eat('op', ','));
          }
          expect('op', ')');
          node = { type: 'Call', callee: node, args, line: ln };
          continue;
        }
        if (t.type === 'op' && (t.value === '++' || t.value === '--')) {
          const ln = line();
          const op = next().value;
          node = { type: 'Unary', op, arg: node, prefix: false, line: ln };
          continue;
        }
        break;
      }
      return node;
    }

    function parsePrimary() {
      const t = peek();
      const ln = t.line;

      if (t.type === 'number') { next(); return { type: 'Num', value: t.value, isFloat: t.isFloat, line: ln }; }
      if (t.type === 'char') { next(); return { type: 'Num', value: t.value, isFloat: false, line: ln }; }
      if (t.type === 'string') { next(); return { type: 'Str', value: t.value, line: ln }; }
      if (t.type === 'ident') { next(); return { type: 'Ident', name: t.value, line: ln }; }

      if (t.type === 'op' && t.value === '(') {
        next();
        const e = parseExpression();
        expect('op', ')');
        return e;
      }
      if (t.type === 'op' && t.value === '{') {
        return parseInitializer();
      }

      throw CError(`语法错误：意外的 "${t.value}"`, ln);
    }

    return parseProgram();
  }

  /* ============================================================
   * 第 3 步：解释执行 —— 生成器逐个产出事件
   * ============================================================ */

  const CMP_OPS = new Set(['<', '>', '<=', '>=', '==', '!=']);
  const MAX_STEPS = 400000;   // 死循环保护上限

  function createScope(parent) {
    return {
      vars: Object.create(null),
      arrays: Object.create(null),
      arrTags: Object.create(null),   // 数组名 → 元素类型标记
      parent: parent || null,
      funcName: ''
    };
  }

  function lookup(scope, name) {
    let s = scope;
    while (s) {
      if (name in s.vars) return { scope: s, value: s.vars[name] };
      if (name in s.arrays) return { scope: s, value: s.arrays[name] };
      s = s.parent;
    }
    return null;
  }

  /* ============================================================
   * ★ 类型系统（关键设计）
   * ------------------------------------------------------------
   * C 是强类型语言：int / int 是整数除法（1/2 == 0），double 参与才是小数。
   * JS 的 number 不区分整浮，若直接存 0.5，`mid=lo+(hi-lo)/2` 这类经典
   * 二分写法就会算出 1.5 这种非整数下标，导致算法静默出错。
   *
   * 因此本解释器把每个标量存成 { v: 值, t: 类型标记 }：
   *   t = 'i' → 整型（int/char/short/long…），除法向下取整，赋值截断为整数
   *   t = 'f' → 浮点型（double/float），除法保留小数
   * 数组元素统一按 double 存（图表需要），仅参与除法时按浮点处理。
   * ============================================================ */

  /** 浮点类型关键字集合 */
  const FLOAT_TYPES = new Set(['double', 'float']);

  /** 根据 C 类型名得到内部类型标记 */
  function typeTag(cType) {
    return FLOAT_TYPES.has(cType) ? 'f' : 'i';
  }

  /** 构造一个带类型的值 */
  function mkVal(v, tag) {
    return { v: tag === 'i' ? Math.trunc(Number(v) || 0) : (Number(v) || 0), t: tag || 'i' };
  }

  /** 取出裸数值（兼容旧的裸 number 存储，便于渐进迁移） */
  function bare(v) {
    if (v && typeof v === 'object' && 'v' in v && 't' in v) return v.v;
    return v;
  }

  /** 取变量的类型标记；未声明返回 undefined */
  function tagOf(scope, name) {
    const found = lookup(scope, name);
    if (!found) return undefined;
    const v = found.value;
    return (v && typeof v === 'object' && 't' in v) ? v.t : 'i';
  }

  /**
   * 按目标类型收敛一个数值。
   * 这是 C 语义的关键：int 变量接收 1.5 会被截断为 1。
   */
  function coerce(num, tag) {
    const n = Number(num) || 0;
    if (tag === 'i') return Math.trunc(n);
    return n;
  }

  /**
   * 带类型的二元运算。int op int 走整数语义。
   */
  function applyBinaryTyped(op, a, b) {
    const x = bare(a), y = bare(b);
    const ta = (a && typeof a === 'object' && 't' in a) ? a.t : 'i';
    const tb = (b && typeof b === 'object' && 't' in b) ? b.t : 'i';

    // 只有两边都是整型时，除法/取模才走整数语义
    const bothInt = (ta === 'i') && (tb === 'i');

    if ((op === '/' || op === '%') && bothInt) {
      if (y === 0) return op === '/' ? 0 : 0;      // 除零保护
      return op === '/' ? Math.trunc(x / y) : (Math.trunc(x) % Math.trunc(y));
    }
    return applyBinary(op, x, y);
  }

  /** 取标量值（用于快照展示） */
  function readScalar(scope, name) {
    const found = lookup(scope, name);
    if (!found) return undefined;
    if (found.scope.arrays[name]) return undefined;      // 数组不在这里展示
    return bare(found.value);
  }

  /** 收集作用域链上所有标量变量（供变量面板展示） */
  function collectVars(scope) {
    const out = {};
    const chain = [];
    let s = scope;
    while (s) { chain.unshift(s); s = s.parent; }
    for (const sc of chain) {
      for (const k in sc.vars) {
        const v = sc.vars[k];
        // 指针在变量面板里展示为「当前下标偏移」，不暴露内部字段
        if (v && typeof v === 'object' && '__ptr' in v) { out[k] = v.offset || 0; continue; }
        out[k] = bare(v);
      }
    }
    return out;
  }

  /** 展示优先级排序：i j n 优先，其余字母序 */
  const VAR_PRIORITY = ['i', 'j', 'k', 'n', 't', 'm', 'min', 'max', 'p', 'q', 'key', 'left', 'right', 'mid'];

  function makeRuntime(ast, opts) {
    const globalScope = createScope(null);
    const state = {
      globals: globalScope,
      funcs: ast.funcs || {},
      output: [],
      stats: { compare: 0, swap: 0, write: 0, round: 0, steps: 0 },
      writes: [],
      errors: [],
      // 交互输入相关
      autoInput: !!(opts && opts.autoInput),   // true = 不向宿主请求，直接返回空串
      waitingInput: false,// true = 此刻正卡在 yield input 上等宿主喂值
      inputs: (opts && opts.inputs) || []     // 预置输入（测试用）
    };
    return state;
  }

  /* ---------- 事件辅助 ---------- */
  function evt(state, scope, e) {
    e.vars = collectVars(scope);
    e.steps = ++state.stats.steps;
    if (e.steps > MAX_STEPS) throw CError('程序执行步数过多，疑似死循环（已自动中止）', e.line || 0);
    return e;
  }

  /** 描述一个表达式引用：数组元素 → {kind:'array',name,index,value}；标量 → {kind:'var',...} */
  function describeRef(node, scope, value) {
    if (node && node.type === 'ArrayAccess') {
      const idx = (value && value.__index !== undefined) ? value.__index : undefined;
      return { kind: 'array', name: node.name, index: idx, value: (value && value.__value !== undefined) ? value.__value : bare(value) };
    }
    if (node && node.type === 'Ident') return { kind: 'var', name: node.name, value: bare(value) };
    return { kind: 'expr', value: bare(value) };
  }

  /* ---------- 表达式求值 ---------- */

  function* evalExpr(node, scope, state) {
    switch (node.type) {

      case 'Num':
        // 保留字面量的整/浮点属性：7/2 是整数除法，7/2.0 是浮点除法
        return mkVal(node.value, node.isFloat ? 'f' : 'i');

      case 'Str':
        return node.value;

      case 'Ident': {
        const found = lookup(scope, node.name);
        if (!found) throw CError(`未声明的变量 "${node.name}"`, node.line);
        const arrOf = found.scope.arrays[node.name];
        if (arrOf) {
          const pv = found.value;
          const isPtrVar = !!(pv && typeof pv === 'object' && '__ptr' in pv);
          if (isPtrVar) {
            const idx = (pv.base || 0) + (pv.offset || 0);
            const tag = (found.scope.arrTags && found.scope.arrTags[node.name]) || 'i';
            // 指针取值：越界时不立刻抛错，而是标记出来。
            // 因为指针可能只是参与地址运算（p - a、p >= a）而不解引用，
            // 此时 idx 为 -1 或 n 都是合法的。真正解引用时（*p）才检查。
            const oob = (idx < 0 || idx >= arrOf.length);
            const val = oob ? 0 : arrOf[idx];
            return { __value: val, __index: idx, __array: arrOf, __name: node.name, t: tag, v: val, __ptrIdx: idx, __oob: oob };
          }
          // 纯数组名在表达式中退化为「指向首元素的指针」，值为偏移 0，
          // 这样 p >= a、p == a 这类指针比较才能正确工作。
          return { __array: arrOf, __name: node.name, __value: null, __ptrIdx: 0, t: 'i', v: 0, __oob: false };
        }
        // 返回带类型的值，保留整型/浮点信息
        const v = found.value;
        if (v && typeof v === 'object' && '__ptr' in v) {
          // 指针但没有绑定数组：退化为偏移量
          return mkVal(v.offset || 0, 'i');
        }
        return (v && typeof v === 'object' && 't' in v) ? v : mkVal(v, 'i');
      }

      case 'ArrayAccess': {
        const base = lookup(scope, node.name);
        if (!base) throw CError(`未声明的数组 "${node.name}"`, node.line);
        const arr = base.scope.arrays[node.name];
        if (!arr) throw CError(`"${node.name}" 不是数组，不能使用下标访问`, node.line);
        // 指针带偏移时，p[i] 实际访问 base+offset+i
        const pv = base.value;
        const ptrOff = (pv && typeof pv === 'object' && '__ptr' in pv) ? (pv.offset || 0) : 0;
        const idx = ptrOff + Math.trunc(bare(yield* evalExpr(node.index, scope, state)));
        if (idx < 0 || idx >= arr.length) {
          throw CError(`数组越界：${node.name}[${idx}]（有效范围 0 ~ ${arr.length - 1}）`, node.line);
        }
        // 数组元素同样携带类型标记（默认浮点，图表需要精确值；
        // 若数组声明为 int 则在声明时已做截断，这里读取按 int 处理）
        const elemTag = (base.scope.arrTags && base.scope.arrTags[node.name]) || 'f';
        return { __value: arr[idx], __index: idx, __array: arr, __name: node.name, t: elemTag, v: arr[idx] };
      }

      case 'Sizeof': {
        const t = node.arg;
        if (t.type === 'Ident') {
          const found = lookup(scope, t.name);
          if (found && found.scope.arrays[t.name]) return found.scope.arrays[t.name].length * 4;
          return 4;
        }
        if (t.type === 'ArrayAccess') return 4;
        return 4;
      }

      case 'SizeofType':
        return 4;

      case 'Unary': {
        // 取地址 &x / &a[i]：产出一个「地址对象」。
        // 唯一用途是喂给 scanf(&x) —— C 里 scanf 要的是地址，不是值。
        // 这里不记录真实内存地址（本模拟器没有内存模型），只把
        // 「写回哪个目标」这个信息挂在对象上，scanf 收到后据此写值。
        if (node.op === '&' && node.arg) {
          const t = node.arg;
          if (t.type === 'Ident') {
            const f = lookup(scope, t.name);
            if (!f) throw CError(`未声明的变量 "${t.name}"`, node.line);
            if (f.scope.arrays[t.name]) {
              // &数组名 → 指向首元素的地址
              return { __addr: true, __target: { kind: 'var', name: t.name }, t: 'i', v: 0 };
            }
            return { __addr: true, __target: { kind: 'var', name: t.name }, t: 'i', v: 0 };
          }
          if (t.type === 'ArrayAccess') {
            const idx = Math.trunc(bare(yield* evalExpr(t.index, scope, state)));
            const f = lookup(scope, t.name);
            const arr = f && f.scope.arrays[t.name];
            if (!arr) throw CError(`"${t.name}" 不是数组，不能取元素地址`, node.line);
            if (idx < 0 || idx >= arr.length) throw CError(`越界：&${t.name}[${idx}]`, node.line);
            return { __addr: true, __target: { kind: 'elem', name: t.name, index: idx }, t: 'i', v: 0 };
          }
          throw CError('只能对变量或数组元素取地址（不支持 &表达式）', node.line);
        }

        // 解引用 *p：读取指针当前指向的元素。
        // 注意 *p++ 的含义是 *(p++)，C 的后缀++ 优先级高于一元 *，
        // 所以这里先让内层 Unary(++) 求值（它会移动指针并返回旧偏移），
        // 再按内层给出的下标取元素。
        if (node.op === '*' && node.prefix && node.arg) {
          const inner = node.arg;
          // 内层若是 ++/--，先执行它，取得移动前后的偏移
          if ((inner.type === 'Unary') && (inner.op === '++' || inner.op === '--')) {
            const oldOff = yield* evalExpr(inner, scope, state);
            const off = Math.trunc(bare(oldOff));
            const foundP = (inner.arg && inner.arg.type === 'Ident') ? lookup(scope, inner.arg.name) : null;
            const arr2 = foundP && foundP.scope.arrays[inner.arg.name];
            if (arr2) {
              const idx2 = (foundP.value.base || 0) + off;
              const tag2 = (foundP.scope.arrTags && foundP.scope.arrTags[inner.arg.name]) || 'i';
              return { __value: arr2[idx2], __index: idx2, __array: arr2, __name: inner.arg.name, t: tag2, v: arr2[idx2] };
            }
          }
          if (inner.type === 'Ident') {
            const v = yield* evalExpr(inner, scope, state);
            if (v && v.__array && v.__ptrIdx !== undefined) {
              const idx = v.__ptrIdx;
              // C 语义：&a[-1] 与 &a[n] 都是合法地址，但不能解引用它们
              const arr = v.__array;
              if (idx < 0 || idx >= arr.length) {
                throw CError(`解引用越界：*"${inner.name}" 指向偏移 ${idx}（有效范围 0 ~ ${arr.length - 1}）`, node.line);
              }
              const val = arr[idx];
              return { __value: val, __index: idx, __array: arr, __name: v.__name, t: v.t || 'i', v: val, __ptrIdx: idx };
            }
            if (v && v.__array) {
              const idx = v.__index;
              const val = v.__array[idx];
              return { __value: val, __index: idx, __array: v.__array, __name: v.__name, t: v.t || 'i', v: val };
            }
            throw CError(`"${inner.name}" 不能被解引用（不是指针或数组）`, node.line);
          }

          // 通用形态：*(p+i)、*(a+i-1)、*(q++) 等「星号 + 任意表达式」。
          // 只要表达式求值结果是带 __array/__ptrIdx 的指针上下文，就按下标取元素。
          const anyV = yield* evalExpr(inner, scope, state);
          if (anyV && typeof anyV === 'object' && anyV.__array && anyV.__ptrIdx !== undefined) {
            const idx2 = Math.trunc(anyV.__ptrIdx);
            const arr3 = anyV.__array;
            if (idx2 < 0 || idx2 >= arr3.length) {
              throw CError(`解引用越界：偏移 ${idx2}（有效范围 0 ~ ${arr3.length - 1}）`, node.line);
            }
            const val3 = arr3[idx2];
            return { __value: val3, __index: idx2, __array: arr3, __name: anyV.__name, t: anyV.t || 'i', v: val3, __ptrIdx: idx2 };
          }
          throw CError('该表达式不能被解引用（不是指针或数组）', node.line);
        }

        // 指针自增自减：移动偏移量
        if ((node.op === '++' || node.op === '--') && node.arg && node.arg.type === 'Ident') {
          const found = lookup(scope, node.arg.name);
          const pv = found && found.value;
          if (pv && typeof pv === 'object' && '__ptr' in pv) {
            const oldOff = pv.offset || 0;
            const newOff = node.op === '++' ? oldOff + 1 : oldOff - 1;
            const arr = found.scope.arrays[node.arg.name];
            // C 语义：允许指针移动到数组开头之前或末尾之后一格
            //（如 p-- 当 p==a 时得到 &a[-1] 是合法的，只要不解引用）。
            // 只有当这个"一步之外"的位置越界太远时才报错。
            if (arr && (newOff < -1 || newOff > arr.length)) {
              throw CError(`指针 "${node.arg.name}" 越界：偏移 ${newOff}（有效范围 -1 ~ ${arr.length}）`, node.line);
            }
            pv.offset = newOff;
            pv.v = newOff;
            yield evt(state, scope, {
              type: 'setVar',
              name: node.arg.name,
              value: newOff,
              line: node.line
            });
            return node.prefix ? mkVal(newOff, 'i') : mkVal(oldOff, 'i');
          }
        }

        // 标量的前置 / 后置 ++ --
        if (node.op === '++' || node.op === '--') {
          const old = yield* readWrite(node.arg, scope, state);
          const nv = node.op === '++' ? old + 1 : old - 1;
          yield* writeTo(node.arg, nv, scope, state, node.line);
          // 后置++ 返回自增前的值；类型沿用目标变量
          return node.prefix ? coerce(nv, tagOf(scope, node.arg.name) || 'i') : coerce(old, tagOf(scope, node.arg.name) || 'i');
        }
        const v = yield* evalExpr(node.arg, scope, state);
        const raw = bare(v);
        if (node.op === '!') return raw ? 0 : 1;
        if (node.op === '-') return (v && v.t === 'f') ? -raw : Math.trunc(-raw);
        if (node.op === '+') return raw;
        if (node.op === '~') return ~raw;
        return raw;
      }

      case 'Binary': {
        if (node.op === ',') {
          yield* evalExpr(node.left, scope, state);
          return yield* evalExpr(node.right, scope, state);
        }
        const lv = yield* evalExpr(node.left, scope, state);
        // 短路求值
        if (node.op === '&&' && !bare(lv)) return 0;
        if (node.op === '||' && bare(lv)) return 1;

        const rv = yield* evalExpr(node.right, scope, state);

        // 指针算术：a + n、p - 1、a + n - 1 这类，结果是新的偏移量。
        // 返回的对象必须保留 __array/__ptrIdx，否则后续 *(a+n-1) 无法解引用。
        const lPtr = isPointerContext(node.left, scope);
        const rPtr = isPointerContext(node.right, scope);
        if ((node.op === '+' || node.op === '-') && (lPtr || rPtr)) {
          const basePtr = lPtr ? lv : rv;
          const other = lPtr ? rv : lv;
          const baseIdx = ptrIndexOf(basePtr);
          // 两个都是指针时（p - a），结果是偏移差，必须返回标量而非指针
          if (lPtr && rPtr) {
            return mkVal(Math.trunc(baseIdx - ptrIndexOf(other)), 'i');
          }
          // 标量 + 指针：等价于 指针 + 标量
          // 指针 - 标量：偏移相减
          const otherVal = Number(bare(other) || 0);
          const off = node.op === '+'
            ? baseIdx + otherVal
            : baseIdx - otherVal;
          const arr = basePtr.__array;
          if (arr && (off < -1 || off > arr.length)) {
            throw CError(`指针运算越界：偏移 ${off}（有效范围 -1 ~ ${arr.length}）`, node.line);
          }
          return {
            __array: arr, __name: basePtr.__name, __value: null,
            __ptrIdx: Math.trunc(off), t: 'i', v: 0
          };
        }

        if (CMP_OPS.has(node.op)) {
          // 指针比较：两侧都是指针/数组名时，比较的是下标而非元素值。
          // 判定依据是「该表达式是否是指针语境」：Ident 指向指针变量，
          // 或 Ident 直接是数组名（数组名退化为指针）。
          const lIsPtrRef = isPointerContext(node.left, scope);
          const rIsPtrRef = isPointerContext(node.right, scope);
          let res;
          if (lIsPtrRef && rIsPtrRef) {
            res = applyBinary(node.op, ptrIndexOf(lv), ptrIndexOf(rv));
          } else {
            res = applyBinaryTyped(node.op, lv, rv);
          }
          // 只有涉及数组元素的比较才计入「比较次数」统计
          const involvesArray = isArrayRef(node.left) || isArrayRef(node.right);
          if (involvesArray) state.stats.compare++;
          yield evt(state, scope, {
            type: 'compare',
            op: node.op,
            result: !!res,
            lhs: describeRef(node.left, scope, lv),
            rhs: describeRef(node.right, scope, rv),
            compare: state.stats.compare,
            line: node.line
          });
          return res ? 1 : 0;
        }

        // 算术运算：按类型决定整除还是浮点除，结果类型跟随操作数
        // 除零在 C 里是未定义行为，但教学场景下静默返回 0 会让学生困惑，
        // 所以这里显式报错并指出位置（applyBinary 内部仍保留 b===0 兜底防 NaN）。
        if (node.op === '/' || node.op === '%') {
          const den = bare(rv);
          if (Number(den) === 0 && den === 0) {
            throw CError(`除数为 0（${node.op === '/' ? '除法' : '取模'}运算遇到零）`, node.line);
          }
        }
        const r = applyBinaryTyped(node.op, lv, rv);
        const lTag = (lv && typeof lv === 'object' && 't' in lv) ? lv.t : 'i';
        const rTag = (rv && typeof rv === 'object' && 't' in rv) ? rv.t : 'i';
        const resTag = (lTag === 'f' || rTag === 'f') ? 'f' : 'i';
        return mkVal(resTag === 'f' ? Number(r) : Math.trunc(Number(r) || 0), resTag);
      }

      case 'Cast': {
        // 强制类型转换：按目标类型的规则收敛数值。
        // 转成浮点类型（double/float）保留小数；
        // 转成整数类型则截断 —— 这与 C 的隐式转换规则一致。
        const v = bare(yield* evalExpr(node.arg, scope, state));
        if (FLOAT_TYPES.has(node.cType)) return mkVal(Number(v) || 0, 'f');
        return mkVal(Math.trunc(Number(v) || 0), 'i');
      }

      case 'Conditional': {
        const c = bare(yield* evalExpr(node.test, scope, state));
        return c ? yield* evalExpr(node.cons, scope, state) : yield* evalExpr(node.alt, scope, state);
      }

      case 'Assign': {
        const rv = yield* evalExpr(node.right, scope, state);
        const value = bare(rv);
        // ★ 左值只解析一次：s[j++] = v 里 j++ 只能加一次。
        //   早先这里 readWrite 读一次、writeTo 又解析一次，j 被加两次，
        //   赋值落到错下标上（字符串自我搬移、原地去重全错）。
        const tgt = yield* resolveTarget(node.left, scope, state);
        const old = tgt.kind === 'var'
          ? bare((lookup(scope, tgt.name) || {}).value)
          : tgt.arr[tgt.index];
        let finalVal = value;
        if (node.op !== '=') {
          const o = node.op[0];
          if ((o === '/' || o === '%') && Number(value) === 0 && value === 0) {
            throw CError(`除数为 0（复合赋值 ${node.op} 遇到零）`, node.line);
          }
          finalVal = applyBinaryTyped(o, old, value);
        }
        yield* writeToTarget(tgt, finalVal, scope, state, node.line);
        // C 里赋值表达式的值就是左值的新值
        return finalVal;
      }

      case 'InitList':
        return 0;

      case 'Call':
        return yield* evalCall(node, scope, state);

      default:
        throw CError(`暂不支持的表达式类型：${node.type}`, node.line);
    }
  }

  function isArrayRef(node) {
    return node && (node.type === 'ArrayAccess');
  }

  /**
   * 判断一个表达式是否处于「指针语境」。
   *  · Ident 且该名字是数组 → 数组名退化为指针
   *  · Ident 且该名字是指针变量 → 本身即指针
   *  · 一元解引用 *p → 得到的是元素值，不是指针
   *  · 指针算术 a+n、p-1 → 结果仍是指针
   */
  function isPointerContext(node, scope) {
    if (!node) return false;
    if (node.type === 'Ident') {
      const found = lookup(scope, node.name);
      if (!found) return false;
      // 数组名（含指针变量，指向的数组也存在 scope.arrays 里）都算指针语境
      if (found.scope.arrays[node.name]) return true;
      return false;
    }
    if (node.type === 'Binary' && (node.op === '+' || node.op === '-')) {
      // 指针算术：至少一侧是指针语境即可（标量 + 标量 不是）
      return isPointerContext(node.left, scope) || isPointerContext(node.right, scope);
    }
    return false;
  }

  /** 取表达式的指针下标值 */
  function ptrIndexOf(v) {
    if (v && typeof v === 'object') {
      if ('__ptrIdx' in v) return v.__ptrIdx;
      if ('__index' in v) return v.__index;
    }
    return bare(v) || 0;
  }

  function toNumber(v) {
    return bare(v);
  }

  function applyBinary(op, a, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? 0 : a / b;          // 除零保护
      case '%': return b === 0 ? 0 : a % b;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '&&': return (a && b) ? 1 : 0;
      case '||': return (a || b) ? 1 : 0;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '<<': return a << b;
      case '>>': return a >> b;
      default: return 0;
    }
  }

  /**
   * 解析赋值目标，返回一个「定位器」。
   *
   * ★ 为什么要单独解析：s[j++] = v 这类写法里，下标表达式 j++ 只能求值一次。
   *   如果先readWrite 读一次、writeTo 写一次，j 会被加两次，
   *   赋值落到错误的下标上（字符串自我搬移、原地去重等算法全错）。
   *   所以这里先把位置（变量名 / 数组名 + 下标）算出来并缓存，
   *   之后读和写都用同一个位置。
   */
  function* resolveTarget(node, scope, state) {
    if (node.type === 'Ident') {
      const found = lookup(scope, node.name);
      if (!found) throw CError(`未声明的变量 "${node.name}"`, node.line);
      return { kind: 'var', name: node.name, scope: found.scope };
    }
    if (node.type === 'ArrayAccess') {
      const base = lookup(scope, node.name);
      if (!base) throw CError(`未声明的数组 "${node.name}"`, node.line);
      const arr = base.scope.arrays[node.name];
      if (!arr) throw CError(`"${node.name}" 不是数组`, node.line);
      // 下标只在这里求值一次
      const idx = Math.trunc(bare(yield* evalExpr(node.index, scope, state)));
      if (idx < 0 || idx >= arr.length) {
        throw CError(`数组越界：${node.name}[${idx}]`, node.line);
      }
      return { kind: 'elem', name: node.name, arr, index: idx, scope: base.scope };
    }
    if (node.type === 'Unary') return yield* resolveTarget(node.arg, scope, state);
    throw CError('赋值目标非法（左边不是变量或数组元素）', node.line);
  }

  /** 读取可赋值目标当前的值 */
  function* readWrite(node, scope, state) {
    if (node.type === 'Ident') {
      const found = lookup(scope, node.name);
      if (!found) throw CError(`未声明的变量 "${node.name}"`, node.line);
      if (found.scope.arrays[node.name]) return 0;
      const v = bare(found.value);
      return v;
    }
    if (node.type === 'ArrayAccess') {
      const v = yield* evalExpr(node, scope, state);
      return bare(v);
    }
    if (node.type === 'Unary') return yield* readWrite(node.arg, scope, state);
    throw CError('赋值目标非法（左边不是变量或数组元素）', node.line);
  }

  /** 写入目标：标量立即发事件，数组写入延迟到块结束再判断是否为「交换」 */
  function* writeTo(node, value, scope, state, line) {
    if (node.type === 'Ident') {
      const found = lookup(scope, node.name);
      const target = found ? found.scope : scope;
      const prev = target.vars[node.name];
      // 对指针变量赋值 = 让指针重新指向（支持 p = a / p = a + k）
      if (prev && typeof prev === 'object' && '__ptr' in prev) {
        const node2 = node;
        const initVal = yield* evalExpr(node2, scope, state);   // 仅为类型判断，忽略
        void initVal;
        prev.offset = 0;
        prev.v = 0;
        yield evt(state, scope, { type: 'setVar', name: node.name, value: 0, line: line || node.line });
        return;
      }
      // 关键：按目标变量的类型收敛数值。int 变量接收 1.5 会被截断为 1（符合 C 语义）
      const prevTag = (prev && typeof prev === 'object' && 't' in prev) ? prev.t : 'i';
      const finalV = coerce(bare(value), prevTag);
      target.vars[node.name] = mkVal(finalV, prevTag);
      yield evt(state, scope, {
        type: 'setVar',
        name: node.name,
        value: finalV,
        line: line || node.line
      });
      return;
    }
    if (node.type === 'ArrayAccess') {
      const base = lookup(scope, node.name);
      const arr = base.scope.arrays[node.name];
      const idx = Math.trunc(bare(yield* evalExpr(node.index, scope, state)));
      if (idx < 0 || idx >= arr.length) {
        throw CError(`数组越界：${node.name}[${idx}]`, line || node.line);
      }
      const before = arr[idx];
      const value2 = bare(value);
      arr[idx] = value2;
      state.writes.push({ name: node.name, index: idx, before, value: value2, line: line || node.line });
      return;
    }
    throw CError('赋值目标非法', line || node.line);
  }

  /**
   * 按「已解析好的定位器」写入。
   * 与 writeTo 的区别：下标不再求值，因此 s[j++] = v 里 j++ 只生效一次。
   */
  function* writeToTarget(tgt, value, scope, state, line) {
    if (tgt.kind === 'var') {
      const target = tgt.scope;
      const prev = target.vars[tgt.name];
      if (prev && typeof prev === 'object' && '__ptr' in prev) {
        prev.offset = 0;
        prev.v = 0;
        yield evt(state, scope, { type: 'setVar', name: tgt.name, value: 0, line: line });
        return;
      }
      const prevTag = (prev && typeof prev === 'object' && 't' in prev) ? prev.t : 'i';
      const finalV = coerce(bare(value), prevTag);
      target.vars[tgt.name] = mkVal(finalV, prevTag);
      yield evt(state, scope, { type: 'setVar', name: tgt.name, value: finalV, line: line });
      return;
    }
    // 数组元素
    const before = tgt.arr[tgt.index];
    const v2 = bare(value);
    tgt.arr[tgt.index] = v2;
    state.writes.push({ name: tgt.name, index: tgt.index, before, value: v2, line: line });
  }

  /* ---------- 交互输入（scanf / input / getchar） ---------- */

  /** 解析 scanf 的格式串，抽出「转换符 + 其间的空白」序列。
   *  只覆盖教学需要的子集：%d %i %u %f %e %g %c %s，以及 %% 字面量与 %*d 丢弃符。
   *  ★ 必须保留格式串里的空白：scanf("%d %c", ...) 中 %c 前的空格在 C 里
   *  表示「先跳过任意空白」，这与 %c 默认「不跳空白」是两套规则。
   *  丢掉这个信息会让 scanf("%d %c%s", &x, &c, s) 把 %c 读成空格。 */
  function parseScanfFormat(fmt) {
    const items = [];
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (/\s/.test(ch)) {
        if (items.length && items[items.length - 1].type === 'blank') continue;
        items.push({ type: 'blank' });
        continue;
      }
      if (ch !== '%') continue;                    // 其他字面字符：忽略
      if (fmt[i + 1] === '%') { i++; continue; }   // %% 字面百分号
      const m = /^%(\*)?(\d+)?(l{0,2})([diufFeEgGcso])/.exec(fmt.slice(i));
      if (!m) continue;
      i += m[0].length - 1;
      items.push({
        type: 'spec',
        suppress: m[1] === '*',
        width: m[2] ? +m[2] : 0,
        conv: m[4].toLowerCase()
      });
    }
    return items;
  }

  /** 把输入的一行按空白切成 token 队列（%c 要读原始字符，不能参与切分） */
  function tokenizeInput(line) {
    const out = [];
    const s = String(line == null ? '' : line);
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      out.push(s.slice(i, j));
      i = j;
    }
    return out;
  }

  /**
   * 向宿主请求一行输入。
   * ★ 这里是「生成器双向通信」的关键：
   *   `yield inputEvent` 把控制权交回宿主，宿主展示输入框，
   *   用户敲回车后调用 it.next(用户输入的字符串)，该字符串就是本yield 表达式的值。
   *   一口气跑完的场景（runOnce）设 state.autoInput = true，直接返回空串不挂起。
   */
  function* requestInput(state, scope, prompt, kind, line) {
    if (state.autoInput) return '';
    state.waitingInput = true;
    const answer = yield evt(state, scope, {
      type: 'input',
      prompt: prompt || '',
      kind: kind || 'line',
      line: line || 0
    });
    state.waitingInput = false;
    return answer == null ? '' : answer;
  }

  /** 同步写数组元素（不经过生成器；scanf 直接赋值走这里） */
  function writeElemSync(name, index, value, scope, state, line) {
    const base = lookup(scope, name);
    const arr = base && base.scope.arrays[name];
    if (!arr) throw CError(`"${name}" 不是数组`, line);
    const idx = Math.trunc(index);
    if (idx < 0 || idx >= arr.length) throw CError(`数组越界：${name}[${idx}]`, line);
    const before = arr[idx];
    arr[idx] = value;
    // 仍要压进 writes 队列，块结束时才能被判定为 swap / set 事件
    state.writes.push({ name, index: idx, before, value, line });
  }

  /** 把一个输入 token 按转换符转成值，并写进目标地址 */
  function applyScanfValue(spec, raw, target, scope, state, line) {
    const text = String(raw == null ? '' : raw);
    let value;
    switch (spec.conv) {
      case 'd': case 'i': case 'u':
        value = Math.trunc(Number(text.trim()) || 0); break;
      case 'f': case 'e': case 'g':
        value = Number(text.trim()) || 0; break;
      case 'c':
        value = text.length ? text.charCodeAt(0) : 0; break;
      case 's':
        value = text; break;
      default:
        value = 0;
    }
    if (!target) return value;

    if (target.kind === 'elem') {
      writeElemSync(target.name, target.index, value, scope, state, line);
      return value;
    }
    const f = lookup(scope, target.name);
    if (!f) throw CError(`未声明的变量 "${target.name}"`, line);

    // scanf("%s", name) 写字符数组：按 C 字符串语义逐字符写入并补 '\0'
    if (f.scope.arrays[target.name]) {
      const arr = f.scope.arrays[target.name];
      const tag = f.scope.arrTags[target.name] || 'i';
      const s = String(value);
      for (let k = 0; k < arr.length; k++) {
        const before = arr[k];
        const ch = k < s.length ? s.charCodeAt(k) : 0;
        arr[k] = coerce(ch, tag);
        if (arr[k] !== before) {
          state.writes.push({ name: target.name, index: k, before, value: arr[k], line });
        }
      }
      return value;
    }

    // 普通标量：按目标变量声明类型收敛（int 收1.9 → 1），与普通赋值保持一致
    const prevTag = (f.value && typeof f.value === 'object' && 't' in f.value) ? f.value.t : 'i';
    f.scope.vars[target.name] = mkVal(coerce(bare(value), prevTag), prevTag);
    return value;
  }

  /* ---------- 函数调用 ---------- */
  function* evalCall(node, scope, state) {
    const callee = node.callee.type === 'Ident' ? node.callee.name : null;
    if (!callee) throw CError('暂不支持的函数调用形式', node.line);

    // 内置输出函数
    if (callee === 'printf' || callee === 'puts' || callee === 'putchar') {
      const args = [];
      for (const a of node.args) args.push(yield* evalExpr(a, scope, state));
      const text = callee === 'printf' ? formatPrintf(args) : (callee === 'puts' ? String(toNumber(args[0] ?? '')) + '\n' : String.fromCharCode(toNumber(args[0] ?? 0)));
      state.output.push(text);
      yield evt(state, scope, { type: 'print', text, line: node.line });
      return 0;
    }

    /* --- 交互输入：input() / getchar() / scanf() ---
     * 这三个会把控制权交回宿主等用户敲键盘，是「交互式运行」的核心。 */
    if (callee === 'input' || callee === 'getchar') {
      // input() 的实参有两种含义（教学上两种都常见）：
      //   input("请输入姓名：")  → 实参是字符串字面量，当提示语，返回读到的字符串
      //   input(name)            → 实参是已声明的字符数组名，把字符串逐字符写进去
      //   input()→ 无提示，返回读到的字符串
      let prompt = '';
      let sink = null;
      if (node.args.length) {
        const a0 = node.args[0];
        if (a0.type === 'Ident') {
          const f = lookup(scope, a0.name);
          if (f && f.scope.arrays[a0.name]) {
            sink = { name: a0.name, scope: f.scope };
          } else {
            const pv = bare(yield* evalExpr(a0, scope, state));
            if (typeof pv === 'string') prompt = pv;
          }
        } else {
          const pv = bare(yield* evalExpr(a0, scope, state));
          if (typeof pv === 'string') prompt = pv;
        }
      }
      if (prompt) {
        state.output.push(prompt);
        yield evt(state, scope, { type: 'print', text: prompt, line: node.line });
      }
      const answer = yield* requestInput(state, scope, prompt, callee === 'getchar' ? 'char' : 'line', node.line);
      if (callee === 'getchar') {
        const s = String(answer);
        return s.length ? s.charCodeAt(0) : 0;
      }
      const str = String(answer).replace(/\r?\n$/, '');

      if (sink) {
        // 写入字符数组：逐字符赋值，超长截断，末尾补 '\0'（C 字符串惯例）
        const arr = sink.scope.arrays[sink.name];
        const tag = sink.scope.arrTags[sink.name] || 'i';
        for (let k = 0; k < arr.length; k++) {
          const before = arr[k];
          const ch = k < str.length ? str.charCodeAt(k) : 0;
          arr[k] = coerce(ch, tag);
          if (arr[k] !== before) {
            state.writes.push({ name: sink.name, index: k, before, value: arr[k], line: node.line });
          }
        }
        return str.length;
      }
      return str;
    }

    if (callee === 'scanf') {
      const args = [];
      for (const a of node.args) args.push(yield* evalExpr(a, scope, state));
      const fmt = String(bare(args[0]) ?? '');
      const items = parseScanfFormat(fmt);
      const specs = items.filter(x => x.type === 'spec');
      if (!specs.length) return 0;

      // 提示语 = 格式串里所有转换符之前的文字
      //（教学代码常写成 scanf("请输入两个整数：%d %d", &a, &b)）
      const prompt = fmt.replace(/%(\*)?(\d+)?(l{0,2})[diufFeEgGcso%]/g, '').trim();
      if (prompt) {
        state.output.push(prompt);
        yield evt(state, scope, { type: 'print', text: prompt, line: node.line });
      }
      const answer = yield* requestInput(state, scope, prompt, 'scanf', node.line);
      const line = String(answer == null ? '' : answer);
      // ★ 用游标而非预切token：%c 必须从「上一个转换符停下的位置」继续读。
      //   格式串里的空白标记为「跳空白」，而 %c / %d 等数字转换自身也会跳空白，
      //   只有裸 %c（前面没空格）才读原始字符 —— 这正是 C 的真实规则。
      let cur = 0;
      const skipBlank = () => { while (cur < line.length && /\s/.test(line[cur])) cur++; };
      const readWord = () => {
        skipBlank();
        const st = cur;
        while (cur < line.length && !/\s/.test(line[cur])) cur++;
        return line.slice(st, cur);
      };

      let assigned = 0, specNo = 0;
      for (let k = 0; k < items.length; k++) {
        const item = items[k];
        if (item.type === 'blank') { skipBlank(); continue; }   // 格式串空白：跳输入空白

        const spec = item;
        // 第 n 个转换符对应第 n+1 个实参
        const argNode = node.args[++specNo];
        let target = null;
        if (argNode) {
          if (argNode.type === 'Unary' && argNode.op === '&') {
            // scanf("%d", &x) —— 正确写法
            const v = yield* evalExpr(argNode, scope, state);
            target = (v && v.__target) ? v.__target : null;
          } else if (argNode.type === 'Ident' && (spec.conv === 's' || spec.conv === 'c')) {
            // scanf("%s", name) —— 数组名本身即首元素地址，& 可写可不写（C 标准允许）
            const f = lookup(scope, argNode.name);
            if (f && f.scope.arrays[argNode.name]) target = { kind: 'var', name: argNode.name };
          }
          if (!target) {
            throw CError(
              'scanf 的参数必须是取地址形式 &变量（正确写法：scanf("%d", &x)）',
              node.line
            );
          }
        }
        if (spec.suppress) continue;               // %*d：读进来但丢弃

        // %c 读原始字符（不跳空白）；数值 / %s 转换符按各自规则取，
        // 而不是一律「切一个词」。
        // ★ 早先所有非 %c 都用 readWord()（按空白切词），
        //   这不符合 C：scanf("%d%d", &a, &b) 传 "735" 时
        //   C 会取 7 和 35（按数字串长度），而按词切只能拿到 735 和空。
        let raw;
        if (spec.conv === 'c') {
          raw = cur < line.length ? line[cur] : '';
          cur += raw.length;                        // 游标只前进 1 个字符
          if (spec.width > 1) {
            raw = line.slice(cur - 1, cur - 1 + spec.width);
            cur += raw.length - 1;
          }
        } else if (spec.conv === 's') {
          // %s 取一段不含空白的字符
          raw = readWord();
          if (spec.width) raw = raw.slice(0, spec.width);
        } else {
          // 数值转换（d i u f e g）：先跳空白，再按该类型的合法字符集取最长匹配。
          // C 的转换符本身不吃掉后面的字符，所以 "12ab" 里的 %d 只读 12。
          skipBlank();
          const st = cur;
          const isNum = /[0-9+\-.]/.test(line[cur] || '');
          if (isNum) {
            if (/[+\-]/.test(line[cur])) cur++;
            while (cur < line.length && /[0-9]/.test(line[cur])) cur++;
            if (line[cur] === '.') {
              cur++;
              while (cur < line.length && /[0-9]/.test(line[cur])) cur++;
            }
            // 指数部分 e/E+123
            if (/[eE]/.test(line[cur] || '') && /[0-9+\-]/.test(line[cur + 1] || '')) {
              cur++;
              if (/[+\-]/.test(line[cur])) cur++;
              while (cur < line.length && /[0-9]/.test(line[cur])) cur++;
            }
          } else if (spec.conv !== 'c') {
            // 遇到非数字（如 "  x"）：C 会读失败并停止赋值，
            // 这里保持原游标位置，返回空串让上层得到 0。
          }
          raw = line.slice(st, cur);
          if (spec.width) raw = raw.slice(0, spec.width);
        }

        applyScanfValue(spec, raw, target, scope, state, node.line);
        if (target) assigned++;
      }
      return assigned;
    }

    const fn = state.funcs[callee];
    if (!fn) {
      throw CError(
        `未定义的函数 "${callee}"（本模拟器内置 printf / puts / putchar / scanf / input / getchar）`,
        node.line
      );
    }

    // 参数求值
    const argVals = [];
    for (const a of node.args) argVals.push(yield* evalExpr(a, scope, state));

    // 新作用域：父为全局作用域（C 语义：函数内看不到调用者的局部变量）
    const fnScope = createScope(state.globals);
    fnScope.funcName = callee;

    for (let k = 0; k < fn.params.length; k++) {
      const p = fn.params[k];
      const v = argVals[k];
      const ptag = typeTag(p.type);
      if (p.isArray) {
        const arr = (v && v.__array) ? v.__array : (Array.isArray(v) ? v : null);
        if (!arr) throw CError(`函数 "${callee}" 的第 ${k + 1} 个参数需要数组，实际传入的不是数组`, node.line);
        fnScope.arrays[p.name] = arr;     // 数组按引用传递
        // 沿用实参数组的元素类型，保证函数体内除法语义一致
        fnScope.arrTags[p.name] = (v && v.t) ? v.t : typeTag(p.type);
      } else {
        // 形参按声明类型收敛（int 形参接收 1.5 → 1）
        fnScope.vars[p.name] = mkVal(coerce(bare(v), ptag), ptag);
      }
    }

    // 递归深度保护
    if (fnScope.__depth === undefined) fnScope.__depth = 0;
    if ((state.__depth || 0) > 200) throw CError('函数递归层数过深（超过 200 层）', node.line);

    state.__depth = (state.__depth || 0) + 1;
    let ret = 0;
    try {
      const sig = yield* execStatements(fn.body, fnScope, state);
      // 函数返回值统一从 fnScope.__ret 取（execStatements 只返回信号）
      if (sig === 'return' && fnScope.__ret !== undefined) ret = fnScope.__ret;
      fnScope.__ret = undefined;
    } finally {
      state.__depth--;
    }
    return ret;
  }

  /* ---------- 语句执行 ---------- */

  /**
   * 执行语句序列。
   * 返回值统一是信号字符串：null | 'break' | 'continue' | 'return'。
   * ★ 必须返回字符串本身（而非 {signal} 对象），因为 for/while 用
   *   `if (r === 'return')` 做严格比较，对象会导致 return 无法跳出循环。
   *   函数返回值单独放在 scope.__ret 上。
   */
  function* execStatements(stmts, scope, state) {
    const mark = state.writes.length;
    let signal = null;

    for (const st of stmts) {
      const r = yield* execStatement(st, scope, state);
      if (r === 'break' || r === 'continue' || r === 'return') { signal = r; break; }
    }

    yield* flushWrites(state, scope, mark);
    return signal;
  }

  /** 分析本块内的数组写入，产出 swap / set 事件 */
  function* flushWrites(state, scope, mark) {
    const ws = state.writes.splice(mark);
    if (!ws.length) return;

    // 交换判定：恰好两次写入、同一个数组、不同下标、且值恰好互换
    if (ws.length === 2) {
      const [a, b] = ws;
      if (a.name === b.name && a.index !== b.index &&
          Object.is(a.before, b.value) && Object.is(b.before, a.value)) {
        state.stats.swap++;
        yield evt(state, scope, {
          type: 'swap',
          name: a.name,
          i: a.index,
          j: b.index,
          from: a.before,
          to: a.value,
          swap: state.stats.swap,
          // 行号取两次写入里较小的那个：动画要在这行之前高亮，不能晚
          line: Math.min(a.line || 0, b.line || 0)
        });
        return;
      }
    }

    for (const w of ws) {
      state.stats.write++;
      yield evt(state, scope, {
        type: 'set',
        name: w.name,
        index: w.index,
        from: w.before,
        to: w.value,
        write: state.stats.write,
        line: w.line || 0
      });
    }
  }

  function* execStatement(node, scope, state) {
    switch (node.type) {

      case 'Empty':
        return null;

      case 'VarDecl': {
        for (const d of node.decls) {
          if (d.isArray) {
            const values = [];
            const tag = typeTag(d.type);
            if (d.init && d.init.type === 'InitList') {
              for (const it of d.init.items) {
                values.push(coerce(bare(yield* evalExpr(it, scope, state)), tag));
              }
            } else if (d.init && d.init.type === 'Str' && d.type === 'char') {
              // 字符数组用字符串字面量初始化： char s[10] = "ab";
              // ★ 这里以前完全没处理，导致 s 全是 0 ——
              //   printf("%s", s) 输出空串，scanf 读到的内容也立刻被清掉，
              //   凡是「字符数组初始化后再逐字符处理」的题（回文、删除数字、
              //   字符串复制等）全部跑不出正确结果。
              // 正确语义：逐字符填入 ASCII 码，并留出结尾的 '\0'。
              // 用 d.type === 'char' 判断而不是 typeTag()，
              // 因为 typeTag 只有 f / i 两种数值标签，不区分字符。
              const str = d.init.value == null ? '' : String(d.init.value);
              for (let k = 0; k < str.length; k++) values.push(str.charCodeAt(k) & 0xff);
              // C 标准：数组至少要容纳「字符串 + 结尾符」；若声明尺寸恰好等于
              // 字符串长度（如 char s[2]="ab"），结尾符放不下，标准规定此时
              // 合法但会丢掉 '\0'，这里照此处理。
              if (values.length < (d.size != null ? d.size : values.length + 1)) {
                values.push(0);
              }
            }
            const size = (d.size != null && Number.isFinite(d.size)) ? d.size : values.length;
            if (values.length < size) {
              // 未显式初始化的元素补 0
              while (values.length < size) values.push(0);
            }
            scope.arrays[d.name] = values;
            scope.arrTags[d.name] = tag;
            yield evt(state, scope, {
              type: 'array',
              name: d.name,
              size: values.length,
              values: values.slice(),
              line: node.line
            });
          } else {
            const tag = typeTag(d.type);
            const initNode = d.init;

            // 指针声明：先单独处理（不能提前把 init 求值成裸数字，
            // 否则 a + n 这类表达式会丢失「它是个指针」的信息）
            if (d.isPtr) {
              if (initNode && (initNode.type === 'Ident' || initNode.type === 'Binary')) {
                const pv = yield* evalExpr(initNode, scope, state);
                if (pv && pv.__array) {
                  const off = Math.trunc(pv.__ptrIdx || 0);
                  scope.arrays[d.name] = pv.__array;
                  scope.arrTags[d.name] = (scope.arrTags[pv.__name] || tag);
                  scope.vars[d.name] = { __ptr: true, base: 0, offset: off, v: off, t: 'i' };
                  yield evt(state, scope, { type: 'setVar', name: d.name, value: off, line: node.line });
                  continue;
                }
              }
              // 未初始化或无法解析为指针：退化为偏移 0 的空指针
              scope.vars[d.name] = { __ptr: true, base: 0, offset: 0, v: 0, t: 'i' };
              yield evt(state, scope, { type: 'setVar', name: d.name, value: 0, line: node.line });
              continue;
            }

            let v = 0;
            if (initNode) v = bare(yield* evalExpr(initNode, scope, state));
            scope.vars[d.name] = mkVal(coerce(v, tag), tag);
            yield evt(state, scope, {
              type: 'setVar',
              name: d.name,
              value: scope.vars[d.name].v,
              line: node.line
            });
          }
        }
        return null;
      }

      case 'ExprStmt': {
        yield evt(state, scope, { type: 'line', line: node.line });
        yield* evalExpr(node.expr, scope, state);
        return null;
      }

      case 'If': {
        yield evt(state, scope, { type: 'line', line: node.line });
        const c = toNumber(yield* evalExpr(node.test, scope, state));
        if (c) return yield* execStatement(node.cons, scope, state);
        else if (node.alt) return yield* execStatement(node.alt, scope, state);
        return null;
      }

      case 'For': {
        if (node.init) {
          if (node.init.type === 'VarDecl') yield* execStatement(node.init, scope, state);
          else yield* evalExpr(node.init.expr, scope, state);
        }
        for (;;) {
          state.stats.round++;
          yield evt(state, scope, { type: 'loop', line: node.line, round: state.stats.round });
          if (node.test) {
            const c = toNumber(yield* evalExpr(node.test, scope, state));
            if (!c) break;
          }
          const r = yield* execStatement(node.body, scope, state);
          if (r === 'break') break;
          if (r === 'return') return 'return';
          if (node.update) yield* evalExpr(node.update, scope, state);
        }
        return null;
      }

      case 'While': {
        for (;;) {
          state.stats.round++;
          yield evt(state, scope, { type: 'loop', line: node.line, round: state.stats.round });
          const c = toNumber(yield* evalExpr(node.test, scope, state));
          if (!c) break;
          const r = yield* execStatement(node.body, scope, state);
          if (r === 'break') break;
          if (r === 'return') return 'return';
        }
        return null;
      }

      case 'DoWhile': {
        do {
          state.stats.round++;
          yield evt(state, scope, { type: 'loop', line: node.line, round: state.stats.round });
          const r = yield* execStatement(node.body, scope, state);
          if (r === 'break') break;
          if (r === 'return') return 'return';
        } while (toNumber(yield* evalExpr(node.test, scope, state)));
        return null;
      }

      case 'Block':
        return yield* execStatements(node.body, scope, state);

      case 'Break':
        return 'break';

      case 'Continue':
        return 'continue';

      case 'Return': {
        const v = node.arg ? toNumber(yield* evalExpr(node.arg, scope, state)) : 0;
        scope.__ret = v;
        return 'return';
      }

      default:
        throw CError(`暂不支持的语句类型：${node.type}`, node.line);
    }
  }

  /* ---------- printf 格式化 ---------- */
  function formatPrintf(args) {
    if (!args.length) return '';
    const fmt = String(args[0] ?? '');
    let out = '';
    let ai = 1;

    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') { out += fmt[i]; continue; }
      if (fmt[i + 1] === '%') { out += '%'; i++; continue; }

      // 解析 %[标志][宽度][.精度]转换符
      const m = /^%([-+ 0#]*)(\d+|\*)?(?:\.(\d+|\*))?([diufFeEgGxXosc])/.exec(fmt.slice(i));
      if (!m) { out += fmt[i]; continue; }
      i += m[0].length - 1;

      const flags = m[1] || '';
      const width = m[2] ? (m[2] === '*' ? bare(args[ai++]) : parseInt(m[2], 10)) : 0;
      const prec = m[3] ? (m[3] === '*' ? bare(args[ai++]) : parseInt(m[3], 10)) : (m[4] === 'f' || m[4] === 'e' || m[4] === 'g' ? 6 : undefined);
      const conv = m[4];

      // 参数可能是裸字符串，也可能是 {v,t} 带类型值，统一用 bare 取裸值。
      // 但 %s 拿到的可能是数组上下文（{__array,...}）——printf("hi", s) 里
      // s 是 char 数组名，此时必须按 C 字符串语义从首元素读到 '\0' 为止。
      const arg = args[ai - 1] !== undefined && ai - 1 < args.length ? args[ai - 1] : undefined;
      const rawArg = (ai - 1 < args.length) ? args[ai++] : 0;
      const val = bare(rawArg);
      let piece = '';

      // 字符数组 → C 字符串
      let cstr = null;
      if (rawArg && typeof rawArg === 'object' && Array.isArray(rawArg.__array)) {
        let s = '';
        for (const ch of rawArg.__array) {
          const n = Math.trunc(Number(ch) || 0);
          if (n === 0) break;            // '\0' 结束符
          s += String.fromCharCode(n);
        }
        cstr = s;
      }

      switch (conv) {
        case 'd': case 'i': case 'u':
          piece = String(Math.trunc(Number(val) || 0));
          if (flags.includes('+') && Number(val) >= 0) piece = '+' + piece;
          break;
        case 'f': case 'F':
          piece = (Number(val) || 0).toFixed(prec);
          if (flags.includes('+') && Number(val) >= 0) piece = '+' + piece;
          break;
        case 'e': case 'E': {
          piece = (Number(val) || 0).toExponential(prec);
          if (conv === 'E') piece = piece.toUpperCase();
          break;
        }
        case 'g': case 'G': {
          const p = prec === 0 ? 1 : prec;
          piece = String(Number((Number(val) || 0).toPrecision(p)));
          if (conv === 'G') piece = piece.toUpperCase();
          break;
        }
        case 'x': piece = (Math.trunc(Number(val) || 0) >>> 0).toString(16); break;
        case 'X': piece = (Math.trunc(Number(val) || 0) >>> 0).toString(16).toUpperCase(); break;
        case 'o': piece = (Math.trunc(Number(val) || 0) >>> 0).toString(8); break;
        case 'c': piece = String.fromCharCode(Math.trunc(Number(val) || 0)); break;
        case 's': piece = cstr !== null ? cstr : String(val ?? ''); if (prec !== undefined) piece = piece.slice(0, prec); break;
        default: piece = String(val ?? '');
      }

      if (width > piece.length) {
        const padChar = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
        if (flags.includes('-')) piece = piece + ' '.repeat(width - piece.length);
        else if (padChar === '0' && /[0-9+-]/.test(piece[0])) piece = piece[0] + '0'.repeat(width - piece.length) + piece.slice(1);
        else piece = ' '.repeat(width - piece.length) + piece;
      }
      out += piece;
    }
    return out;
  }

  /* ============================================================
   * 对外 API
   * ============================================================ */

  /**
   * 编译源码（只编译不运行），用于「仅运行」与预检查
   * @param {string} source
   * @returns {{ok:boolean, ast?:object, error?:string, line?:number}}
   */
  function compile(source) {
    try {
      const clean = preprocess(String(source || ''));
      const tokens = tokenize(clean);
      const ast = parse(tokens);
      if (!ast.body || !ast.body.length) {
        return { ok: false, error: '没有找到可执行代码，请在 main() 函数内编写代码', line: 0 };
      }
      return { ok: true, ast };
    } catch (e) {
      if (e && e.isCError) return { ok: false, error: e.message, line: e.line };
      return { ok: false, error: '编译失败：' + (e && e.message ? e.message : String(e)), line: 0 };
    }
  }

  /**
   * 创建可「单步驱动」的运行器
   * @param {string} source C 源码
   * @param {object} [opts]
   * @param {boolean} [opts.autoInput] true = 遇到 scanf/input 直接返回空值，不挂起等输入
   * @returns {{
   *   ok:boolean, error?:string, line?:number,
   *   start:function():Generator, output:string[], stats:object, scope:object,
   *   waitingInput:boolean
   * }}
   *
   * 用法：
   *   const run = CCompiler.createRunner(src);
   *   if (!run.ok) { 显示 run.error; }
   *   const it = run.start();
   *   let r = it.next();
   *   while (!r.done) {
   *     if (r.value.type === 'input') {
   *       // 展示输入框，用户回车后：
   *       r = it.next(用户输入的内容);
   *       continue;
   *     }
   *     绘制(r.value);
   *     r = it.next();
   *   }
   */
  function createRunner(source, opts) {
    const compiled = compile(source);
    if (!compiled.ok) {
      return { ok: false, error: compiled.error, line: compiled.line };
    }

    const state = makeRuntime(compiled.ast, opts);

    return {
      ok: true,
      get output() { return state.output.join(''); },
      get stats() { return state.stats; },
      get scope() { return state.globals; },
      /** 此刻是否卡在「等用户输入」的yield 上（宿主据此高亮输入框） */
      get waitingInput() { return !!state.waitingInput; },
      start: function* () {
        const fnScope = createScope(state.globals);
        try {
          yield* execStatements(compiled.ast.body, fnScope, state);
        } catch (e) {
          yield {
            type: 'error',
            message: e && e.message ? e.message : String(e),
            line: (e && e.line) || 0
          };
          return;
        }
        yield {
          type: 'end',
          stats: { ...state.stats },
          vars: collectVars(fnScope),
          output: state.output.join('')
        };
      }
    };
  }

  /**
   * 一次性跑完（不产生动画），用于「仅运行」按钮和控制台输出
   * @param {string} source
   * @param {string[]} [inputs] 预置输入（依次喂给 scanf / input）
   * @returns {{ok:boolean, output:string, stats:object, error?:string, line?:number}}
   */
  function runOnce(source, inputs) {
    // 给了 inputs 就按脚本喂；没给且代码里有输入函数，就用空串顶掉（保证不挂起）
    const hasInputs = !!(inputs && inputs.length);
    const runner = createRunner(source, { autoInput: !hasInputs });
    if (!runner.ok) return { ok: false, error: runner.error, line: runner.line, output: '', stats: null };

    // ★ 输入池：一次 input 事件 = 用户敲的一整行。
    //   scanf 内部用游标自己切分这一行（%d %d 会从同一行里各取一个数），
    //   所以池子的元素必须是「行」，不能按空白拆散 ——
    //   否则 scanf("%d %d",&a,&b) 只拿到 "7"，第二个数就丢了。
    //
    //   真实交互里用户是一行一行敲的，所以：
    //   · 传入 ["7 35", "abc"]→ 两次 input 事件，分别拿到整行
    //   · 传入 ["7 35"]        → 第一次拿到 "7 35"，后续 input 拿到空串
    //     （若代码有多次 scanf 而只给了一行，后面的读到的就是空值，
    //      这与真实交互中「用户没继续敲」的行为一致）
    const pool = (inputs || []).map(s => String(s == null ? '' : s));
    let pi = 0;

    const it = runner.start();
    let r = it.next();
    let err = null;
    while (!r.done) {
      if (r.value && r.value.type === 'error') { err = r.value; break; }
      if (r.value && r.value.type === 'input') {
        const tok = pi < pool.length ? pool[pi++] : '';
        r = it.next(tok);
        continue;
      }
      r = it.next();
    }
    if (err) return { ok: false, error: err.message, line: err.line, output: runner.output, stats: runner.stats };
    return { ok: true, output: runner.output, stats: runner.stats };
  }

  /**
   * 静态分析源码：找出数组名、n 的值、是否含排序特征
   * 用于自动生成柱状图规模
   */
  function analyze(source) {
    const info = {
      arrayName: null, n: null, hasLoop: false, hasCompare: false, isSort: false,
      hasInput: false,          // 是否含 scanf / input / getchar
      inputFuncs: []
    };
    try {
      const clean = preprocess(String(source || ''));
      const tokens = tokenize(clean);
      // 简单扫一遍 token：找类型关键字后跟 ident 后跟 '['
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'keyword' && TYPE_KEYWORDS.has(t.value) &&
            tokens[i + 1] && tokens[i + 1].type === 'ident' &&
            tokens[i + 2] && tokens[i + 2].value === '[') {
          info.arrayName = tokens[i + 1].value;
          break;
        }
      }
      const IN = new Set(['scanf', 'input', 'getchar']);
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type === 'keyword' && tokens[i].value === 'for') info.hasLoop = true;
        if (tokens[i].type === 'op' && CMP_OPS.has(tokens[i].value)) info.hasCompare = true;
        if (tokens[i].type === 'ident' && IN.has(tokens[i].value)) {
          // 后面紧跟 '(' 才算调用（排除同名变量）
          if (tokens[i + 1] && tokens[i + 1].value === '(') {
            info.hasInput = true;
            if (info.inputFuncs.indexOf(tokens[i].value) === -1) info.inputFuncs.push(tokens[i].value);
          }
        }
      }
      info.isSort = info.hasLoop && info.hasCompare && !!info.arrayName;
    } catch (e) { /* 分析失败不阻塞主流程 */ }
    return info;
  }

  return { compile, createRunner, runOnce, analyze, CError };
})();

if (typeof window !== 'undefined') window.CCompiler = CCompiler;
