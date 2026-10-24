// 错题复习：全部题目按优先级排序，可筛选后成批练习，也可单独练某一题

import { h, icon, plainText, relTime, historyMarks, prefs } from '../ui.js';
import { md } from '../md.js';
import * as store from '../store.js';
import { RANK, STATES, STATE_LABEL } from '../rank.js';
import { getSession, newSession, dropSession, mountQuiz } from './quiz.js';

const enc = encodeURIComponent;
const SIZES = [10, 20, 50, 'all'];

const FORMULA = `$$P=\\frac{E+${RANK.K * RANK.P0}}{E+C+${RANK.K}}\\qquad w=0.5^{\\,\\Delta t/${RANK.HALF_LIFE_DAYS}}\\times ${RANK.ORDER_DECAY}^{\\,k}$$

- 每次作答的权重 $w$：$\\Delta t$ 是距今天数，$k$ 是这次之后又作答了几次。$E$、$C$ 分别是答错、答对的权重之和
- 列表按 $P$ 从高到低排列，显示为 0–100 的优先级
- 未做的题固定为 ${RANK.P0 * 100}，排在中间；高于 ${RANK.P0 * 100} 是薄弱（近期加权错误率超过 ${RANK.P0 * 100}%），排在未做之前
- 当天答错后马上答对，仍然算薄弱；隔一天以上再答对，才会降到 ${RANK.P0 * 100} 以下
- 一直答对的题排在最后；长期不练，所有题都会慢慢回到 ${RANK.P0 * 100}`;

export function renderReview(main, pos, params) {
  const key = `${pos.id}:review`;
  const base = `#/p/${enc(pos.id)}`;
  const root = h('div', { class: 'review' });
  main.append(root);

  let quiz = null;
  let stateFilter = prefs.get('review.filter', 'all');
  let pageFilter = 'all';
  let size = SIZES.includes(prefs.get('review.size', 20)) ? prefs.get('review.size', 20) : 20;
  let infoOpen = false;

  function showList() {
    quiz?.destroy();
    quiz = null;
    root.replaceChildren(listView());
  }

  function startSession(items, single = false) {
    showSession(newSession(key, items, { mode: 'review', single }));
  }

  function showSession(s) {
    quiz?.destroy();
    const holder = h('div', { class: 'rv-quiz' });
    root.replaceChildren(
      h(
        'header',
        { class: 'rv-session-head' },
        h('h1', null, s.single ? '单题练习' : '错题复习'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: endSession }, icon('x'), s.single ? '返回列表' : '结束本轮'),
      ),
      holder,
    );
    quiz = mountQuiz(holder, pos, s, { exit: { label: '返回列表', onClick: endSession }, onSingleDone: endSession });
    window.scrollTo(0, 0);
  }

  function endSession() {
    dropSession(key);
    showList();
    window.scrollTo(0, 0);
  }

  function listView() {
    const s = store.stats(pos);
    const all = store.ranked(pos);
    const scoped = pageFilter === 'all' ? all : all.filter((q) => q.pageId === pageFilter);
    const counts = { all: scoped.length, weak: 0, new: 0, fair: 0, good: 0 };
    for (const q of scoped) counts[s.get(q.gid).state]++;
    const visible = stateFilter === 'all' ? scoped : scoped.filter((q) => s.get(q.gid).state === stateFilter);
    const visibleSet = new Set(visible.map((q) => q.gid));
    const n = size === 'all' ? visible.length : Math.min(size, visible.length);

    const head = h(
      'header',
      { class: 'rv-head' },
      h('h1', null, '错题复习'),
      h(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-expanded': String(infoOpen),
          'aria-label': '排序规则',
          'data-tip': '排序规则',
          onclick: () => {
            infoOpen = !infoOpen;
            showList();
          },
        },
        icon('info'),
      ),
    );

    const info = infoOpen ? h('div', { class: 'panel formula' }, h('div', { class: 'md', html: md(FORMULA) })) : null;

    // 优先级频谱：每根柱子是一道题，从左到右优先级递减
    const H = 64;
    const spectrum = h(
      'div',
      { class: 'spectrum', role: 'img', 'aria-label': '题目按优先级从高到低排列' },
      h('div', { class: 'ref', style: { bottom: `${6 + RANK.P0 * H}px` } }, h('span', { class: 'num' }, RANK.P0 * 100)),
      scoped.map((q, i) => {
        const st = s.get(q.gid);
        return h('span', {
          class: `bar s-${st.state}${visibleSet.has(q.gid) ? '' : ' dim'}`,
          style: { height: `${6 + st.P * H}px` },
          'data-tip': `#${i + 1}　${STATE_LABEL[st.state]}　优先级 ${st.score}\n${plainText(q.stem, 60)}`,
        });
      }),
    );

    const chips = h(
      'div',
      { class: 'chips', role: 'group', 'aria-label': '按状态筛选' },
      [['all', '全部'], ...STATES.map((st) => [st, STATE_LABEL[st]])].map(([k, label]) =>
        h(
          'button',
          {
            class: `chip${stateFilter === k ? ' on' : ''}`,
            type: 'button',
            'aria-pressed': String(stateFilter === k),
            onclick: () => {
              stateFilter = k;
              prefs.set('review.filter', k);
              showList();
            },
          },
          k === 'all' ? null : h('i', { class: `dot s-${k}` }),
          label,
          h('b', { class: 'num' }, counts[k]),
        ),
      ),
    );

    const pageSelect = h(
      'select',
      {
        class: 'sel',
        'aria-label': '按页面筛选',
        onchange: (e) => {
          pageFilter = e.target.value;
          showList();
        },
      },
      h('option', { value: 'all' }, '全部页面'),
      pos.pages.map((p) => h('option', { value: p.id, selected: pageFilter === p.id }, `${p.no}  ${p.title}`)),
    );

    const sizeCtl = h(
      'div',
      { class: 'seg-ctl', role: 'group', 'aria-label': '每轮题量' },
      SIZES.map((v) =>
        h(
          'button',
          {
            type: 'button',
            class: size === v ? 'on' : '',
            'aria-pressed': String(size === v),
            onclick: () => {
              size = v;
              prefs.set('review.size', v);
              showList();
            },
          },
          v === 'all' ? '全部' : h('span', { class: 'num' }, v),
        ),
      ),
    );

    const controls = h(
      'div',
      { class: 'rv-controls' },
      chips,
      h(
        'div',
        { class: 'rv-run' },
        pageSelect,
        h('span', { class: 'rv-size' }, h('span', { class: 'rv-label' }, '每轮'), sizeCtl),
        h(
          'button',
          { class: 'btn primary', type: 'button', disabled: !n, onclick: () => startSession(visible.slice(0, n)) },
          icon('play'),
          '开始复习',
          h('span', { class: 'num' }, n),
          '题',
        ),
      ),
    );

    const rows = visible.map((q, i) => {
      const st = s.get(q.gid);
      const page = pos.pageById.get(q.pageId);
      return h(
        'button',
        { class: 'rrow', type: 'button', onclick: () => startSession([q], true), 'aria-label': `单独练习：${plainText(q.stem, 40)}` },
        h('span', { class: 'rank num' }, i + 1),
        meter(st),
        h('span', { class: 'stem' }, plainText(q.stem, 140)),
        h('span', { class: 'pg' }, h('span', { class: 'num' }, page.no), page.title),
        st.n ? historyMarks(store.attemptsOf(pos, q.gid), 8) : h('span', { class: 'hist-empty' }, '—'),
        h('span', { class: 'when' }, st.last ? relTime(st.last.t) : ''),
      );
    });

    const list = rows.length
      ? h(
          'div',
          { class: 'rlist' },
          h(
            'div',
            { class: 'rrow rhead', 'aria-hidden': 'true' },
            h('span', null, '#'),
            h('span', null, '优先级'),
            h('span', null, '题目'),
            h('span', null, '页面'),
            h('span', null, '最近作答'),
            h('span', { class: 'when' }, '上次'),
          ),
          rows,
        )
      : h('p', { class: 'muted rv-empty' }, scoped.length ? '这个筛选条件下没有题目。' : '还没有题目。');

    return h('div', { class: 'rv-list' }, head, info, h('section', { class: 'panel rv-panel' }, spectrum, controls), list);
  }

  const single = params.get('q');
  if (single && pos.qById.has(single)) {
    history.replaceState(null, '', `${base}/review`);
    startSession([pos.qById.get(single)], true);
  } else {
    const existing = getSession(key);
    if (existing) showSession(existing);
    else showList();
  }

  return {
    destroy() {
      quiz?.destroy();
    },
  };
}

function meter(st) {
  const tip = st.n
    ? `${STATE_LABEL[st.state]}　优先级 ${st.score}\n加权答错 E = ${st.E.toFixed(2)}，加权答对 C = ${st.C.toFixed(2)}\n共作答 ${st.n} 次，答对 ${st.correct} 次`
    : `未做　优先级 ${st.score}`;
  return h(
    'span',
    { class: 'meter', 'data-tip': tip },
    h(
      'span',
      { class: 'trk' },
      h('span', { class: `fill s-${st.state}`, style: { width: `${st.P * 100}%` } }),
      h('span', { class: 'tick', style: { left: `${RANK.P0 * 100}%` } }),
    ),
    h('span', { class: `val num s-${st.state}` }, st.score),
  );
}
