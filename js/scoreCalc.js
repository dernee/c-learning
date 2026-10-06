/* ============================================================
 * scoreCalc.js —— 计分 & 修仙进阶等级模块
 * ------------------------------------------------------------
 * 【职责】
 *   1) 管理积分累计（答对得分、连对加成）
 *   2) 根据积分计算当前修仙境界
 *   3) 计算距离下一境界还差多少分
 *   4) 用 localStorage 持久化：积分、答题记录、统计数据
 *
 * 【★ 如何修改修仙等级积分？★
 *   只需要修改下面 LEVELS 数组里的 min 字段（每个境界的起始分）。
 *   规则：从低到高排列，min 为该境界的起始积分，-1 表示无上限。
 *   例：把「筑基期」的 min 从 100 改成 150，就是筑基期从 150 分开始。
 *       想加一个新境界，就在数组中间插一项即可，顺序保持从低到高。
 * ============================================================ */

const ScoreCalc = (function () {
  'use strict';

  /* ============================================================
   * ★★★ 修仙等级表：改这里就能改整个游戏的进阶节奏 ★★★
   * ============================================================ */
  const LEVELS = [
    { name: '炼气期', en: 'Qi Refining',   min: 0,    color: '#94a3b8', glow: 'rgba(148,163,184,.35)' },
    { name: '筑基期', en: 'Foundation',    min: 100,  color: '#34d399', glow: 'rgba(52,211,153,.35)' },
    { name: '结丹期', en: 'Core Formation',min: 125,  color: '#22d3ee', glow: 'rgba(34,211,238,.35)' },
    { name: '元婴期', en: 'Nascent Soul',  min: 150,  color: '#60a5fa', glow: 'rgba(96,165,250,.35)' },
    { name: '化神期', en: 'Spirit Transform', min: 200, color: '#a78bfa', glow: 'rgba(167,139,250,.35)' },
    { name: '炼虚期', en: 'Void Refining', min: 300,  color: '#f472b6', glow: 'rgba(244,114,182,.35)' },
    { name: '合体期', en: 'Body Integration', min: 400, color: '#fb923c', glow: 'rgba(251,146,60,.35)' },
    { name: '大乘期', en: 'Mahayana',      min: 500,  color: '#fbbf24', glow: 'rgba(251,191,36,.4)' },
    { name: '真仙',   en: 'True Immortal', min: 600,  color: '#fde047', glow: 'rgba(253,224,71,.45)' },
    { name: '金仙',   en: 'Golden Immortal', min: 700, color: '#facc15', glow: 'rgba(250,204,21,.5)' },
    { name: '太乙',   en: 'Taiyi',         min: 800,  color: '#fbbf24', glow: 'rgba(251,191,36,.55)' },
    { name: '大罗',   en: 'Daluo',         min: 900,  color: '#fde68a', glow: 'rgba(253,230,138,.6)' },
    { name: '道祖',   en: 'Dao Ancestor',  min: 1000, color: '#ffffff', glow: 'rgba(255,255,255,.65)' }
  ];

  /* ---------------- localStorage 键名 ---------------- */
  const STORAGE_KEY = 'c_practice_score_v1';
  const MAX_RECORDS = 30;      // 最多保存的答题记录条数

  /* ============================================================
   * 数据持久化
   * ============================================================ */

  /** 默认存档 */
  function defaultState() {
    return {
      score: 0,            // 总积分
      answered: 0,         // 累计答题数
      correct: 0,          // 答对题数
      streak: 0,           // 当前连续答对
      bestStreak: 0,       // 历史最佳连对
      records: [],         // 答题记录（倒序）
      cleared: {}          // 已答对过的题 id → 记录首答得分，用于「重复刷题不重复加分」
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      const base = defaultState();
      // 合并，兼容旧版本缺字段的情况
      return {
        score: Number(data.score) || 0,
        answered: Number(data.answered) || 0,
        correct: Number(data.correct) || 0,
        streak: Number(data.streak) || 0,
        bestStreak: Number(data.bestStreak) || 0,
        records: Array.isArray(data.records) ? data.records.slice(0, MAX_RECORDS) : [],
        cleared: (data.cleared && typeof data.cleared === 'object') ? data.cleared : {}
      };
    } catch (e) {
      console.warn('[scoreCalc] 读取本地存档失败，已重置：', e);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // 隐私模式 / 存储已满：功能降级为「内存计分」，不阻断使用
      console.warn('[scoreCalc] 保存失败（可能是隐私模式或存储已满）：', e);
    }
  }

  /* ============================================================
   * 等级计算
   * ============================================================ */

  /**
   * 根据积分计算所处境界信息
   * @param {number} score
   * @returns {{
   *   level:object, levelIndex:number, levelName:string,
   *   next:object|null, nextMin:number|null,
   *   need:number,            // 距离下一境界还差多少分（已满级为 0）
   *   progress:number,        // 当前境界内进度 0~100
   *   span:number             // 当前境界的分数跨度
   * }}
   */
  function calcLevel(score) {
    const s = Math.max(0, Number(score) || 0);

    // 找到最后一个 min <= s 的等级
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (s >= LEVELS[i].min) idx = i; else break;
    }

    const level = LEVELS[idx];
    const next = idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;

    // 本境界区间上限 = 下一境界的起始分 - 1；满级则用当前分
    const span = next ? (next.min - level.min) : Math.max(1, s - level.min + 1);
    const inLevel = s - level.min;
    const need = next ? Math.max(0, next.min - s) : 0;
    const progress = next ? Math.min(100, Math.round((inLevel / span) * 100)) : 100;

    return {
      level,
      levelIndex: idx,
      levelName: level.name,
      next,
      nextMin: next ? next.min : null,
      nextName: next ? next.name : null,
      need,
      progress,
      span,
      inLevel
    };
  }

  /** 取当前境界（快捷方法） */
  function currentLevel(score) {
    return calcLevel(typeof score === 'undefined' ? state.score : score);
  }

  /** 全部等级列表（渲染阶梯用） */
  function allLevels() {
    return LEVELS.map((lv, i) => ({
      ...lv,
      index: i,
      isLast: i === LEVELS.length - 1
    }));
  }

  /* ============================================================
   * 计分
   * ============================================================ */

  /**
   * 记录一次答题
   * @param {object} opts
   *   opts.qid       题目 id
   *   opts.title     题干摘要（用于记录列表）
   *   opts.point     该题满分
   *   opts.correct   是否答对
   *   opts.isRepeat  是否是重复刷已答对的题（重复题只给少量积分）
   * @returns {{gain:number, levelUp:boolean, from:string, to:string, levelInfo:object}}
   */
  function submit(opts) {
    const { qid, title, point, correct, isRepeat } = opts || {};
    const before = calcLevel(state.score);

    state.answered++;
    let gain = 0;

    if (correct) {
      state.correct++;
      state.streak++;

      if (isRepeat) {
        // 重复刷题：只给 1 分，避免反复点提交刷分
        gain = 1;
      } else {
        // 连对加成：连续答对越多，额外奖励越高
        const bonusTable = [0, 0, 2, 3, 5, 8, 12];
        const idx = Math.min(state.streak, bonusTable.length - 1);
        const streakBonus = bonusTable[idx];
        gain = (Number(point) || 0) + streakBonus;
      }

      state.score += gain;
      if (!state.cleared[qid]) state.cleared[qid] = { firstTry: true, at: Date.now() };
    } else {
      state.streak = 0;
    }

    state.bestStreak = Math.max(state.bestStreak, state.streak);

    // 写记录
    state.records.unshift({
      qid,
      title: String(title || '').replace(/<[^>]+>/g, '').slice(0, 40),
      correct: !!correct,
      gain,
      point: Number(point) || 0,
      at: Date.now()
    });
    if (state.records.length > MAX_RECORDS) state.records.length = MAX_RECORDS;

    save();

    const after = calcLevel(state.score);
    return {
      gain,
      streak: state.streak,
      levelUp: after.levelIndex > before.levelIndex,
      from: before.levelName,
      to: after.levelName,
      levelInfo: after
    };
  }

  /** 该题是否已答对过（用于判断重复刷题） */
  function isCleared(qid) {
    return !!(state.cleared && state.cleared[qid]);
  }

  /* ============================================================
   * 读取 / 重置
   * ============================================================ */

  function getScore() { return state.score; }
  function getStats() {
    return {
      score: state.score,
      answered: state.answered,
      correct: state.correct,
      streak: state.streak,
      bestStreak: state.bestStreak,
      accuracy: state.answered ? Math.round((state.correct / state.answered) * 100) : 0,
      records: state.records.slice()
    };
  }

  /** 重置全部进度（不可撤销） */
  function reset() {
    state = defaultState();
    save();
    return getStats();
  }

  /** 只清空答题记录，保留积分 */
  function clearRecords() {
    state.records = [];
    save();
  }

  return {
    LEVELS,                     // 导出等级表，方便外部渲染规则表
    calcLevel,
    currentLevel,
    allLevels,
    submit,
    isCleared,
    getScore,
    getStats,
    reset,
    clearRecords
  };
})();

if (typeof window !== 'undefined') window.ScoreCalc = ScoreCalc;
