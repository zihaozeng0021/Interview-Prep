// 错题复习的排序算法
//
// 每道题的优先级 P = 平滑后的「近期加权错误率」
//
//   1) 每次作答的权重  w = 0.5^(距今天数 / HALF_LIFE) × ORDER_DECAY^(这次之后又作答的次数)
//        时间衰减：HALF_LIFE 天前的作答，权重减半（越近越重要）
//        次序衰减：同一天内反复练习时，以最新的几次为准
//   2) E = 答错的权重之和，C = 答对的权重之和
//   3) P = (E + K·P0) / (E + C + K)      贝叶斯平滑：相当于每题预置 K 次、错误率为 P0 的虚拟作答
//
// 性质：
//   · 没做过的题 P = P0（40），排在中间
//   · P > P0 ⇔ 近期加权错误率超过 40%，归为「薄弱」，排在未做题之前
//   · 当天答错后立刻答对一次，P 仍高于 P0；隔一天以上再答对，才会降到 P0 以下
//   · 长期不练，所有证据衰减，P 慢慢回到 P0：答错过的从上方回落，答对过的从下方回升
//   · 一直答对的题 P 最低，排在最后，但仍然包含在列表里

export const RANK = {
  HALF_LIFE_DAYS: 7,
  ORDER_DECAY: 0.75,
  P0: 0.4,
  K: 2,
  GOOD_BELOW: 0.25,
};

const DAY = 86_400_000;

export const STATES = ['weak', 'new', 'fair', 'good'];
export const STATE_LABEL = { weak: '薄弱', new: '未做', fair: '一般', good: '掌握' };

export function scoreAttempts(attempts, now = Date.now()) {
  const n = attempts.length;
  let E = 0;
  let C = 0;
  let correct = 0;
  let lastWrongT = 0;
  for (let i = 0; i < n; i++) {
    const a = attempts[i];
    const days = Math.max(0, now - a.t) / DAY;
    const w = Math.pow(0.5, days / RANK.HALF_LIFE_DAYS) * Math.pow(RANK.ORDER_DECAY, n - 1 - i);
    if (a.ok) {
      C += w;
      correct++;
    } else {
      E += w;
      lastWrongT = a.t;
    }
  }
  const P = (E + RANK.K * RANK.P0) / (E + C + RANK.K);
  let state;
  if (n === 0) state = 'new';
  else if (P > RANK.P0 + 1e-9) state = 'weak';
  else if (P < RANK.GOOD_BELOW) state = 'good';
  else state = 'fair';
  const last = n ? attempts[n - 1] : null;
  return { n, correct, E, C, P, score: Math.round(P * 100), state, last, lastWrongT };
}

// questions: 全部题目（带 gid、order）；attempts: Map<gid, 按时间升序的作答记录>
export function computeStats(questions, attempts, now = Date.now()) {
  const map = new Map();
  for (const q of questions) map.set(q.gid, scoreAttempts(attempts.get(q.gid) || [], now));
  return map;
}

// 按优先级从高到低排序；同分时：最近一次答错的在前 → 最近作答的在前 → 题库原始顺序
export function rankQuestions(questions, stats) {
  return [...questions].sort((a, b) => {
    const sa = stats.get(a.gid);
    const sb = stats.get(b.gid);
    return (
      sb.P - sa.P ||
      (sa.last && !sa.last.ok ? 0 : 1) - (sb.last && !sb.last.ok ? 0 : 1) ||
      (sb.last ? sb.last.t : 0) - (sa.last ? sa.last.t : 0) ||
      a.order - b.order
    );
  });
}

export function countStates(questions, stats) {
  const c = { weak: 0, new: 0, fair: 0, good: 0 };
  for (const q of questions) c[stats.get(q.gid).state]++;
  return c;
}

// 一个知识点的状态：关联题目里有薄弱即薄弱；全未做为未做；全掌握为掌握；其余一般
export function aggregateState(states) {
  if (!states.length) return 'new';
  if (states.includes('weak')) return 'weak';
  if (states.every((s) => s === 'new')) return 'new';
  if (states.every((s) => s === 'good')) return 'good';
  return 'fair';
}
