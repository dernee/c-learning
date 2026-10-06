#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把解析结果 c1000.json 转成网站可直接使用的 questionBank1000.js"""
import json, re, io

SRC = r'C:/Users/vault/AppData/Local/Temp/c1000.json'
OUT = r'C:/Users/vault/Desktop/c语言练习网站/js/questionBank1000.js'

data = json.load(open(SRC, encoding='utf-8'))
chapters = data['chapters']
qs = data['questions']


def esc(s):
    """转义为可安全嵌入 HTML 的文本（题干里常含 < > & 等字符）"""
    s = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    s = s.replace('"', '&quot;')
    return s


def js_str(s):
    """JS 字符串字面量：转义反斜杠、引号、换行"""
    s = s.replace('\\', '\\\\').replace('"', '\\"')
    s = s.replace('\n', '\\n').replace('\r', '').replace('\t', '\\t')
    return '"' + s + '"'


def type_map(t):
    return {'单选': 'choice', '判断': 'choice', '填空': 'fill',
            '程序阅读': 'read', '编程': 'code'}.get(t, 'choice')


def point_of(q):
    """按难度给分：越难分值越高，引导修仙节奏"""
    return {1: 5, 2: 10, 3: 20}.get(q['diff'], 10)


items = []
for q in qs:
    t = q['type']
    stem = q['stem']
    code = q.get('code', '')
    ans_raw = q['answer_raw']
    explain = q['explain']

    # 程序阅读题：题干在 code 第一行（如"下列程序的运行结果是"），拆出来
    if t == '程序阅读':
        lines = [l for l in code.split('\n') if l.strip()]
        if not stem and lines:
            stem = lines[0]
            code = '\n'.join(lines[1:])
        if not stem:
            stem = '阅读程序，写出运行结果'
        # 运行结果作为「答案」，解析作为解析
        item = {
            'id': f"c{q['no']}",
            'type': 'read',
            'diff': q['diff'],
            'point': point_of(q),
            'chapter': q['chapter'],
            'stem': esc(stem),
            'code': code,
            'answer': ans_raw,
            'explain': esc(explain) if explain else f'运行结果：{ans_raw}',
        }
        items.append(item)
        continue

    if t == '填空':
        blanks = q['blanks']
        # 源文档填空题的 body 里只有 "（　　）" 这种答题括号占位符，
        # 直接当代码显示会造成重复与噪音，这里丢弃
        item = {
            'id': f"c{q['no']}",
            'type': 'fill',
            'diff': q['diff'],
            'point': point_of(q),
            'chapter': q['chapter'],
            'stem': esc(stem),
            'blanks': [{'id': b['id'], 'label': b['label'],
                        'answer': b['answer']} for b in blanks],
            'hint': esc(explain[:60]) if explain else '',
            'explain': esc(explain) if explain else '参考答案见填空内容。',
        }
        items.append(item)
        continue

    if t == '编程':
        item = {
            'id': f"c{q['no']}",
            'type': 'code',
            'diff': q['diff'],
            'point': point_of(q),
            'chapter': q['chapter'],
            'stem': esc(stem),
            'refcode': ans_raw,          # 参考程序
            'explain': esc(explain) if explain else '这是编程实践题，可在左侧编辑器里写代码并运行验证。',
        }
        items.append(item)
        continue

    # 单选 / 判断 —— 都转成 choice
    opts = q['options']
    if len(opts) < 2:
        continue
    item = {
        'id': f"c{q['no']}",
        'type': 'choice',
        'diff': q['diff'],
        'point': point_of(q),
        'chapter': q['chapter'],
        'stem': esc(stem),
        'options': [esc(o) for o in opts],
        'answer': q['answer'],
        'hint': '',
        'explain': esc(explain) if explain else '正确答案见选项。',
    }
    items.append(item)

# ---------- 写文件 ----------
buf = io.StringIO()
buf.write("""/* ============================================================
 * questionBank1000.js —— 《C语言程序设计题库1000题》导入题库
 * ------------------------------------------------------------
 * 数据来源：桌面《C语言程序设计题库1000题.docx》，1000 题完整导入
 * 题型映射：单选/判断 → choice ；填空 → fill ；程序阅读 → read ；编程 → code
 *
 * 【与 questionBank.js 的关系】
 *   本文件是「1000 题大题库」，由 main.js 启动时与 questionBank.js 的 22 道
 *   基础题合并成 1022 题。修改题库请到对应文件，勿直接改本文件的生成结果。
 *
 * 【题目字段说明】
 *   id       唯一编号，c + 原题号，如 c1 / c1000
 *   type     choice 选择题 | fill 填空题 | read 程序阅读 | code 编程题
 *   diff     难度 1入门 / 2进阶 / 3困难
 *   point    分值（1星=5 / 2星=10 / 3星=20）
 *   chapter  所属章节，共 25 章
 *   stem     题干（已做 HTML 转义）
 *   options  选项数组（choice）
 *   answer   正确项下标（choice）
 *   blanks   填空定义（fill）
 *   code     程序代码（read）
 *   refcode  参考程序（code）
 * ============================================================ */

const QuestionBank1000 = (function () {
  'use strict';

  /* ---------------- 章节清单（25 章，供分类筛选使用） ---------------- */
  const CHAPTERS = [
""")
for name, lo, hi in chapters:
    buf.write(f"    {{ name: {js_str(name)}, from: {lo}, to: {hi} }},\n")
buf.write("""  ];

  /* ---------------- 1000 道题 ---------------- */
  const questions = [
""")
for it in items:
    buf.write('    ' + json.dumps(it, ensure_ascii=False, separators=(',', ':')) + ',\n')
buf.write("""  ];

  /* ============================================================
   * 查询接口（与 questionBank.js 保持一致的命名习惯）
   * ============================================================ */
  function getAll(type, chapter) {
    let list = questions;
    if (type) list = list.filter(q => q.type === type);
    if (chapter) list = list.filter(q => q.chapter === chapter);
    return list.slice();
  }

  function getById(id) {
    return questions.find(q => q.id === id) || null;
  }

  function count() { return questions.length; }

  /** 题型统计，供界面展示 */
  function statByType() {
    const m = {};
    questions.forEach(q => { m[q.type] = (m[q.type] || 0) + 1; });
    return m;
  }

  /** 按章节统计 */
  function statByChapter() {
    const m = {};
    questions.forEach(q => { m[q.chapter] = (m[q.chapter] || 0) + 1; });
    return m;
  }

  return { questions, CHAPTERS, getAll, getById, count, statByType, statByChapter };
})();

/* 兼容非模块脚本环境 */
if (typeof window !== 'undefined') window.QuestionBank1000 = QuestionBank1000;
""")

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(buf.getvalue())

print('已生成:', OUT)
print('题目数:', len(items))
from collections import Counter
print('题型:', dict(Counter(i['type'] for i in items)))
print('难度:', dict(Counter(i['diff'] for i in items)))
print('章节数:', len(chapters))
print('文件大小:', len(buf.getvalue()), '字符')
