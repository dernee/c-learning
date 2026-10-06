/* ============================================================
 * questionBank.js —— C 语言题库
 * ------------------------------------------------------------
 * 【如何新增题目】
 *   往 questions 数组里 push 一个对象即可，格式如下：
 *
 *   {
 *     id:      'q13',            // 唯一编号，不要重复
 *     type:    'choice',         // 'choice' = 选择题 | 'fill' = 代码填空题
 *     diff:    1,                // 难度 1入门 2进阶 3困难（只影响标签颜色）
 *     point:   10,               // 答对获得的积分（直接决定修仙进度）
 *     stem:    '题干文本，<code>x</code> 可高亮代码',
 *     code:    '可选，代码填空题用，展示在题干下方',
 *     blanks:  [                 // 仅有 fill 题需要
 *       { id:'b1', label:'第1空', answer:'i < n - 1' }  // answer 为标准答案
 *     ],
 *     options: ['A项','B项',...], // 仅有 choice 题需要
 *     answer:  1,                // choice 题：正确项的下标（从 0 开始）
 *     hint:    '提示文字',
 *     explain: '答案解析'
 *   }
 *
 *   ★ 注意：本题库是纯前端，答案明文存在 JS 里，属于「学习演示项目」
 *     的正常做法；正式商用请把判分放到服务端。
 * ============================================================ */

const QuestionBank = (function () {
  'use strict';

  /* ---------------- 题目数据 ---------------- */
  const questions = [
    /* ========== 一、基础语法 ========== */
    {
      id: 'q01',
      type: 'choice',
      diff: 1,
      point: 5,
      stem: 'C 语言中，<code>int</code> 类型在常见的 32 位编译环境下占用多少字节？',
      options: ['2 字节', '4 字节', '8 字节', '由编译器自由决定'],
      answer: 1,
      hint: 'int 的宽度由平台决定，现代桌面/服务器环境普遍是 4 字节。',
      explain: '在主流 32/64 位平台上 int 为 4 字节。但标准只保证至少 16 位，具体占用需查询 <code>sizeof(int)</code>。这是 C 的可移植性经典陷阱。'
    },
    {
      id: 'q02',
      type: 'choice',
      diff: 1,
      point: 5,
      stem: '以下哪一段 C 代码可以正确地向屏幕输出 "Hello"？',
      options: [
        'printf("Hello");',
        'print("Hello");',
        'console.log("Hello");',
        'puts("Hello");'
      ],
      answer: 0,
      hint: 'printf 需要 #include <stdio.h>，且用双引号。',
      explain: '<code>printf()</code> 是 C 标准 I/O 函数，字符串需用双引号包裹。选项 D 的 puts() 也能输出并自动换行，但它输出的是字符串字面量且不带格式控制——在 printf 语境的比较题中，A 是标准答案。'
    },
    {
      id: 'q03',
      type: 'choice',
      diff: 1,
      point: 5,
      stem: 'C 语言中，数组下标从几开始？',
      options: ['0', '1', '-1', '由编译器决定'],
      answer: 0,
      hint: 'C 的数组是 0-based 索引。',
      explain: 'C 数组下标从 0 开始。长度为 n 的数组，有效下标范围是 <code>0 ~ n-1</code>。访问 <code>a[n]</code> 是越界，会导致未定义行为，这是初学者最常见的崩溃原因。'
    },
    {
      id: 'q04',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: '执行 <code>int i = 0; while (i &lt; 3) { printf("%d ", i); i++; }</code> 后输出是什么？',
      options: ['0 1 2', '0 1 2 3', '1 2 3', '0 1'],
      answer: 0,
      hint: '先判断条件再执行循环体，条件为假时退出。',
      explain: '<code>while</code> 是「先判断后执行」。i=0 满足 <code>i&lt;3</code> → 输出 0，i=1；再输出 1，i=2；再输出 2，i=3；此时条件不成立，循环结束。所以输出 <code>0 1 2</code>。'
    },
    {
      id: 'q05',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: '下列关于 <code>for</code> 循环的描述，<b>错误</b>的是？',
      options: [
        'for 循环的三个表达式都可以省略',
        'for 循环可以不使用花括号，只控制一条语句',
        'for 循环的循环变量必须在循环体内改变，否则死循环',
        'for 循环等价于 while 循环'
      ],
      answer: 2,
      hint: '思考：如果循环变量永远不变，循环会怎样？',
      explain: '「循环变量必须在循环体内改变」是错误说法——改变可以发生在 for 的第三个表达式里，如 <code>for (i=0; i&lt;3; i++)</code>。但如果三个部分都不改变条件，循环确实是死循环。'
    },

    /* ========== 二、指针与内存 ========== */
    {
      id: 'q06',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: '若 <code>int a[5]</code>，则 <code>sizeof(a)</code> 的结果是？',
      options: ['5', '20', '4', '取决于数组名'],
      answer: 1,
      hint: '数组名在多数表达式中退化为指向首元素的指针，只有 sizeof 等少数场景例外。',
      explain: '在表达式中数组名通常退化为指针，但 <code>sizeof</code> 是例外：它对数组取整个数组的大小。5 个 int × 4 字节 = <code>20</code> 字节。这是数组传参时长度丢失的根源。'
    },
    {
      id: 'q07',
      type: 'choice',
      diff: 3,
      point: 15,
      stem: '执行 <code>int x = 5; int *p = &x; *p = 10;</code> 之后，<code>x</code> 的值是？',
      options: ['5', '10', '随机值', '编译错误'],
      answer: 1,
      hint: 'p 指向 x，*p 就是 x 本身。',
      explain: '<code>&x</code> 取 x 的地址赋给指针 p，<code>*p = 10</code> 是通过指针修改 x 的值。此时 <code>x == 10</code>，且 <code>*p == x == 10</code>。指针让变量可以被间接访问和修改。'
    },
    {
      id: 'q08',
      type: 'choice',
      diff: 3,
      point: 15,
      stem: '关于 <code>malloc</code> 与 <code>free</code>，下列说法正确的是？',
      options: [
        'free 之后内存指针仍可安全使用',
        '忘记 free 会导致内存泄漏',
        'malloc 返回的内存会自动清零',
        '可以对同一块内存连续 free 两次'
      ],
      answer: 1,
      hint: '想想操作系统的内存管理。',
      explain: '忘记 <code>free</code> 会造成内存泄漏（malloc 分配的堆内存需手动释放）。另外：free 后指针变成悬空指针，访问它是未定义行为；<code>malloc</code> 不清零内容，需要清零用 <code>calloc</code>；重复 free 同一地址会引发未定义行为。'
    },

    /* ========== 三、算法排序（可视化重点） ========== */
    {
      id: 'q09',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: '冒泡排序在最坏情况（数组完全逆序）下的时间复杂度是？',
      options: ['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'],
      answer: 2,
      hint: '最坏情况需要遍历 n 轮，每轮比较 n 次。',
      explain: '冒泡排序最坏需要 n-1 轮，每轮最多 n-1 次比较，总共约 n(n-1)/2 次，因此是 <code>O(n²)</code>。最好情况（已有序且带提前退出优化）是 <code>O(n)</code>。'
    },
    {
      id: 'q10',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: '下列排序算法中，平均时间复杂度为 <code>O(n log n)</code> 且最坏也是 <code>O(n log n)</code> 的是？',
      options: ['冒泡排序', '选择排序', '归并排序', '插入排序'],
      answer: 2,
      hint: '哪种排序在递归划分中始终保持平衡？',
      explain: '<strong>归并排序</strong>采用分治策略，每次对半划分，最坏情况仍是 <code>O(n log n)</code>，且稳定。冒泡、选择、插入排序最坏都是 <code>O(n²)</code>。快排平均 O(n log n) 但最坏会退化到 O(n²)。'
    },
    {
      id: 'q11',
      type: 'choice',
      diff: 3,
      point: 15,
      stem: '快速排序（Quick Sort）在平均情况下比归并排序更快的根本原因是？',
      options: [
        '快排使用的比较次数更少',
        '快排是原地排序，缓存局部性好且常数小',
        '快排不需要递归',
        '快排不需要交换元素'
      ],
      answer: 1,
      hint: '从内存访问和 cache 命中率角度想。',
      explain: '快排是<strong>原地排序</strong>（in-place），数据都在内存中，访问模式顺序化，缓存命中率高；归并排序虽然稳定且最坏复杂度更优，但需要 O(n) 的额外辅助数组，内存拷贝开销大。所以在实践中快排通常更快。'
    },
    {
      id: 'q12',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: '「稳定排序」指的是？',
      options: [
        '排序结果始终占用相同内存',
        '相等元素排序后保持原有相对顺序',
        '排序速度保持稳定',
        '不会发生交换操作'
      ],
      answer: 1,
      hint: '想象两个同学成绩相同且原本有明确排名。',
      explain: '稳定排序保证：若两个元素比较后相等，它们在排序结果中的<strong>相对次序</strong>与排序前相同。归并排序、冒泡排序、插入排序是稳定的；选择排序、快速排序、堆排序不稳定。'
    },

    /* ========== 四、代码填空题 ========== */
    {
      id: 'q13',
      type: 'fill',
      diff: 2,
      point: 10,
      stem: '补全冒泡排序的循环条件，使每轮比较范围逐轮缩小。',
      code: '#include <stdio.h>\n\nint main(void) {\n    int a[] = {5, 3, 8, 1, 9};\n    int n = 5, i, j, t;\n\n    for (i = 0; ____; i++) {\n        for (j = 0; ____; j++) {\n            if (a[j] > a[j + 1]) {\n                t = a[j]; a[j] = a[j + 1]; a[j + 1] = t;\n            }\n        }\n    }\n\n    for (i = 0; i < n; i++) printf("%d ", a[i]);\n    return 0;\n}',
      blanks: [
        { id: 'b1', label: '第 1 空（外层）', answer: 'i < n - 1' },
        { id: 'b2', label: '第 2 空（内层）', answer: 'j < n - 1 - i' }
      ],
      hint: '外层控制轮数共 n-1 轮；内层每轮结束后，末尾已有 i 个元素就位。',
      explain: '冒泡排序每轮把当前未排序区的最大值「冒」到末尾。第 i 轮结束后，末尾已有 i 个元素就位，所以内层只需比较到 <code>n-1-i</code>。外层共 <code>n-1</code> 轮。总比较次数为 (n-1)+(n-2)+…+1 = n(n-1)/2。'
    },
    {
      id: 'q14',
      type: 'fill',
      diff: 2,
      point: 10,
      stem: '补全选择排序的「选择最小值」部分。',
      code: 'int main(void) {\n    int a[] = {64, 25, 12, 22, 11};\n    int n = 5, i, j, min, t;\n\n    for (i = 0; i < n - 1; i++) {\n        min = i;\n        for (j = i + 1; j < n; j++) {\n            if (a[j] < a[min]) {\n                ____\n            }\n        }\n        if (min != i) { t = a[i]; a[i] = a[min]; a[min] = t; }\n    }\n\n    for (i = 0; i < n; i++) printf("%d ", a[i]);\n    return 0;\n}',
      blanks: [
        { id: 'b1', label: '第 1 空', answer: 'min = j;' }
      ],
      hint: '发现更小的元素时，把「最小值下标」更新为它。',
      explain: '选择排序每轮在未排序区 [i, n-1] 中线性扫描出最小值的位置，记录在 <code>min</code> 中，扫描结束后一次性交换到位置 i。选择排序的比较次数固定为 n(n-1)/2，与初始顺序无关，但交换次数最多只有 n-1 次。'
    },
    {
      id: 'q15',
      type: 'fill',
      diff: 3,
      point: 15,
      stem: '补全插入排序的「寻找插入位置并后移」部分。',
      code: 'int main(void) {\n    int a[] = {12, 25, 11, 3, 7};\n    int n = 5, i, j, key;\n\n    for (i = 1; i < n; i++) {\n        key = a[i];\n        j = i - 1;\n        while (j >= 0 && a[j] > key) {\n            ____\n        }\n        a[j + 1] = key;\n    }\n\n    for (i = 0; i < n; i++) printf("%d ", a[i]);\n    return 0;\n}',
      blanks: [
        { id: 'b1', label: '第 1 空', answer: 'a[j + 1] = a[j]; j--;' }
      ],
      hint: '先把 a[j] 挪到它右边一格，然后 j 向左移动一格。',
      explain: '插入排序把 key 保存到临时变量（这样 a[i] 可以被覆盖），然后把所有比 key 大的元素依次右移一格，空出位置后把 key 放入 <code>a[j+1]</code>。这正是人类整理扑克牌的方式，因此对「基本有序」的数组非常高效（接近 O(n)）。'
    },
    {
      id: 'q16',
      type: 'fill',
      diff: 3,
      point: 15,
      stem: '补全二分查找（针对升序数组），找到返回下标，找不到返回 -1。',
      code: 'int binarySearch(int a[], int n, int key) {\n    int left = 0, right = n - 1, mid;\n    while (left <= right) {\n        mid = left + (right - left) / 2;\n        if (a[mid] == key) {\n            ____\n        } else if (a[mid] < key) {\n            left = mid + 1;\n        } else {\n            right = mid - 1;\n        }\n    }\n    return -1;\n}',
      blanks: [
        { id: 'b1', label: '第 1 空', answer: 'return mid;' }
      ],
      hint: '找到了，返回中间下标。',
      explain: '二分查找每次将搜索区间缩小一半，时间复杂度 <code>O(log n)</code>。前提是数组<strong>必须有序</strong>。注意 <code>mid = left + (right - left) / 2</code> 而非 <code>(left+right)/2</code>，这样可以避免大数组时整型溢出（这是真实项目中的常见写法）。'
    },
    {
      id: 'q17',
      type: 'fill',
      diff: 2,
      point: 10,
      stem: '补全通过指针遍历并逆序输出数组的代码。',
      code: '#include <stdio.h>\n\nint main(void) {\n    int a[] = {1, 2, 3, 4, 5};\n    int n = 5;\n    int *p = a + n - 1;\n\n    while (p >= a) {\n        printf("%d ", *p);\n        ____\n    }\n    return 0;\n}',
      blanks: [
        { id: 'b1', label: '第 1 空', answer: 'p--;' }
      ],
      hint: '指针从后往前走，每次要退一格。',
      explain: '指针 p 初始指向最后一个元素，通过 <code>*p</code> 解引用取值，用 <code>p--</code> 让它向前移动一个元素。指针运算以「元素大小」为单位：<code>p+1</code> 实际移动 <code>sizeof(int)</code> 字节。'
    },

    /* ========== 五、进阶综合 ========== */
    {
      id: 'q18',
      type: 'choice',
      diff: 3,
      point: 15,
      stem: '下列关于「数组越界访问」的说法，正确的是？',
      options: [
        '越界一定会立即崩溃',
        '越界是未定义行为，可能崩溃也可能读到别的数据',
        '越界只读不写就没事',
        '编译器会自动检查并报错'
      ],
      answer: 1,
      hint: 'C 语言没有运行时的边界检查。',
      explain: 'C 不做数组边界检查，越界属于<strong>未定义行为</strong>：可能读到栈上/堆上的其他数据（数据泄漏），也可能触发段错误崩溃。C++、Java、Rust 等语言则有边界检查或安全机制。防御性写法是在访问前判断 <code>if (i &gt;= 0 &amp;&amp; i &lt; n)</code>。'
    },
    {
      id: 'q19',
      type: 'choice',
      diff: 3,
      point: 15,
      stem: '关于 <code>struct</code>（结构体）和数组的区别，正确的是？',
      options: [
        '结构体只能存放相同类型的数据',
        '结构体可以同时存放多种类型的数据',
        '结构体在内存中必须连续且大小固定为成员之和',
        '数组可以存放不同类型的数据'
      ],
      answer: 1,
      hint: '结构体用来描述「一个实体由什么组成」。',
      explain: '结构体把不同类型的数据组合成一个逻辑整体（如学生信息：姓名+成绩+学号）。数组则要求所有元素<strong>类型相同</strong>。另外，结构体可能因内存对齐而比成员大小之和更大（如 3 个 char 也会占 4 字节）。'
    },
    {
      id: 'q20',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: 'C 语言中 <code>break</code> 和 <code>continue</code> 的区别是？',
      options: [
        'break 结束整个程序，continue 结束当前循环',
        'break 跳出当前循环/switch，continue 跳过本次循环剩余语句',
        '两者完全等价',
        'continue 只能用于 for 循环'
      ],
      answer: 1,
      hint: '想象在多层循环里按下这两个键。',
      explain: '<code>break</code> 直接跳出它所在的最近一层循环或 switch；<code>continue</code> 只跳过本次迭代的剩余部分，进入下一次迭代（注意：会执行 for 的第三个表达式和条件判断）。<code>continue</code> 不能用于 switch。'
    },
    {
      id: 'q21',
      type: 'choice',
      diff: 2,
      point: 10,
      stem: '执行 <code>printf("%d %d", 7 / 2, 7 % 2);</code> 的输出是？',
      options: ['3.5 1', '3 1', '4 1', '3 0'],
      answer: 1,
      hint: '整数除法会截断小数部分。',
      explain: '两个 <code>int</code> 相除执行整数除法，<code>7/2 = 3</code>（小数部分被截断）；<code>7%2 = 1</code> 是取余。要得到 3.5 需写成 <code>7 / 2.0</code>。这是 C 语言中的<strong>整数除法陷阱</strong>。'
    },
    {
      id: 'q22',
      type: 'choice',
      diff: 1,
      point: 5,
      stem: '<code>#include &lt;stdio.h&gt;</code> 这行代码的作用是？',
      options: [
        '定义一个叫 stdio 的变量',
        '引入标准输入输出库的头文件',
        '声明一个函数并立即执行',
        '设置编译器输出路径'
      ],
      answer: 1,
      hint: 'include 是「包含」的意思。',
      explain: '<code>#include</code> 是预处理指令，把 <code>stdio.h</code> 头文件的内容在编译前插入到当前文件，这样 <code>printf</code>、<code>scanf</code> 等函数的声明才可见。C 语言采用「先声明后使用」的原则。'
    }
  ];

  /* ---------------- 对外接口 ---------------- */

  /**
   * 获取全部题目（副本，避免外部误改）
   * @param {string} [type] 可选，按类型过滤 'choice' / 'fill'
   * @returns {Array}
   */
  function getAll(type) {
    return type ? questions.filter(q => q.type === type) : questions.slice();
  }

  /** 按 id 查找题目 */
  function getById(id) {
    return questions.find(q => q.id === id) || null;
  }

  /** 题目总数 */
  function count() {
    return questions.length;
  }

  /**
   * 判分
   * @param {object} q   题目对象
   * @param {*} userAns  用户答案：选择题传下标，填空题传 {blankId: text}
   * @returns {{correct:boolean, detail:object}} detail 中每个空的对错与正确答案
   */
  function check(q, userAns) {
    if (!q) return { correct: false, detail: {} };

    if (q.type === 'choice') {
      const ok = Number(userAns) === Number(q.answer);
      return { correct: ok, detail: { picked: userAns, right: q.answer } };
    }

    // 代码填空题：逐空比对，忽略首尾空白与多余空格
    const norm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
    const detail = {};
    let all = true;
    (q.blanks || []).forEach(b => {
      const got = norm(userAns ? userAns[b.id] : '');
      const want = norm(b.answer);
      const ok = got === want;
      detail[b.id] = { ok, got, want };
      if (!ok) all = false;
    });
    return { correct: all, detail };
  }

  /** 把 stem 里的 <code> 标签转义成安全文本之外的可信 HTML（题库为内部可信数据） */
  function renderStem(q) {
    return q.stem;
  }

  return { getAll, getById, count, check, renderStem, questions };
})();

/* 兼容非模块脚本环境 */
if (typeof window !== 'undefined') window.QuestionBank = QuestionBank;
