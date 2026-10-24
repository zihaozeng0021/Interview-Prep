// 答题组件：页面练习与错题复习共用
// 键盘：A–H 或 1–8 选择选项，0 选择不会，Enter 提交 / 下一题，← → 切换题目

import { h, icon, kbd, prefs, plainText, historyMarks } from '../ui.js';
import { md, mdInline } from '../md.js';
import * as store from '../store.js';
import { STATE_LABEL } from '../rank.js';

const LETTERS = 'ABCDEFGH';
const sessions = new Map(); // 切换标签或页面后回来，进度还在

export function getSession(key) {
  return sessions.get(key);
}

export function dropSession(key) {
  sessions.delete(key);
}

export function newSession(key, items, { mode = 'page', base, single = false } = {}) {
  const s = {
    key,
    mode,
    single,
    items,
    base: base || items,
    idx: 0,
    answers: new Map(), // gid -> { picked:Set<原始选项下标>, unknown, submitted, ok, pick }
    perms: new Map(), // gid -> 显示顺序（原始下标数组）
    finished: false,
  };
  for (const q of items) s.perms.set(q.gid, makePerm(q));
  sessions.set(key, s);
  return s;
}

const shuffleOn = () => prefs.get('shuffle', true);

function makePerm(q) {
  const idx = q.options.map((_, i) => i);
  if (shuffleOn() && q.shuffle !== false) {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
  }
  return idx;
}

const enc = encodeURIComponent;

export function mountQuiz(container, pos, initial, opts = {}) {
  let session = initial;
  let fresh = false;
  let shownAt = performance.now();
  const root = h('div', { class: 'quiz', tabindex: '-1' });
  container.append(root);

  const cur = () => session.items[session.idx];
  const ansOf = (q) => session.answers.get(q.gid);
  const isLast = () => session.idx === session.items.length - 1;

  // 原始字母 -> 当前显示的字母
  function disp(q, letters) {
    const perm = session.perms.get(q.gid);
    return [...letters]
      .map((L) => LETTERS[perm.indexOf(LETTERS.indexOf(L))])
      .sort()
      .join('');
  }

  function render() {
    root.classList.toggle('fresh', fresh);
    root.replaceChildren(session.finished ? summary() : question());
    fresh = false;
    if (!document.activeElement || document.activeElement === document.body) root.focus({ preventScroll: true });
  }

  function scrollIntoViewIfNeeded() {
    const top = root.getBoundingClientRect().top;
    if (top < 0) window.scrollBy({ top: top - 16 });
  }

  // ── 题目 ──
  function track() {
    const dense = session.items.length > 60;
    return h(
      'div',
      { class: `track${dense ? ' dense' : ''}` },
      session.items.map((q, i) => {
        const a = ansOf(q);
        const cls = ['seg'];
        if (a?.submitted) cls.push(a.ok ? 'ok' : 'bad');
        if (i === session.idx && !session.finished) cls.push('cur');
        return h('button', {
          class: cls.join(' '),
          type: 'button',
          'aria-label': `第 ${i + 1} 题`,
          'data-tip': `第 ${i + 1} 题`,
          onclick: () => go(i),
        });
      }),
    );
  }

  function optionButton(q, a, oi, di) {
    const picked = !!a?.picked.has(oi);
    const isAns = q.answer.includes(LETTERS[oi]);
    let state = '';
    let mark = null;
    if (a?.submitted) {
      if (isAns && picked) [state, mark] = ['is-correct', icon('check')];
      else if (isAns) [state, mark] = ['is-missed', icon('check')];
      else if (picked) [state, mark] = ['is-wrong', icon('x')];
      else state = 'is-dim';
    } else if (picked) {
      state = 'is-picked';
    }
    return h(
      'button',
      {
        class: `opt ${state}`.trim(),
        type: 'button',
        role: q.type === 'multi' ? 'checkbox' : 'radio',
        'aria-checked': String(picked),
        'aria-disabled': a?.submitted ? 'true' : null,
        onclick: () => toggle(oi),
      },
      h('span', { class: 'key num' }, LETTERS[di]),
      h('span', { class: 'opt-text', html: mdInline(q.options[oi]) }),
      h('span', { class: 'opt-mark' }, mark),
    );
  }

  function unknownButton(q, a) {
    const picked = !!a?.unknown;
    const state = a?.submitted ? (picked ? 'is-wrong' : 'is-dim') : picked ? 'is-picked' : '';
    return h(
      'button',
      {
        class: `opt opt-unknown ${state}`.trim(),
        type: 'button',
        role: q.type === 'multi' ? 'checkbox' : 'radio',
        'aria-checked': String(picked),
        'aria-disabled': a?.submitted ? 'true' : null,
        'data-tip': '按答错记录，提交后查看答案与解析',
        onclick: toggleUnknown,
      },
      h('span', { class: 'key num' }, '0'),
      h('span', { class: 'opt-text' }, '不会'),
      h('span', { class: 'opt-mark' }, a?.submitted && picked ? icon('x') : null),
    );
  }

  function question() {
    const q = cur();
    const a = ansOf(q);
    const perm = session.perms.get(q.gid);
    const page = pos.pageById.get(q.pageId);
    const multi = q.type === 'multi';
    const submitted = !!a?.submitted;

    const top = h(
      'div',
      { class: 'quiz-top' },
      h('span', { class: 'quiz-count' }, h('b', { class: 'num' }, session.idx + 1), h('span', { class: 'num' }, ` / ${session.items.length}`)),
      track(),
      h(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-pressed': String(shuffleOn()),
          'aria-label': '选项乱序',
          'data-tip': shuffleOn() ? '选项乱序：开' : '选项乱序：关',
          onclick: toggleShuffle,
        },
        icon('shuffle'),
      ),
    );

    const card = h(
      'div',
      { class: 'qcard' },
      h(
        'div',
        { class: 'q-meta' },
        h('span', { class: `q-type ${q.type}` }, multi ? '多选' : '单选'),
        session.mode !== 'page'
          ? h('a', { class: 'q-page', href: `#/p/${enc(pos.id)}/page/${enc(page.id)}` }, h('span', { class: 'num' }, page.no), page.title)
          : null,
      ),
      h('div', { class: 'q-stem md', html: md(q.stem) }),
      h(
        'div',
        { class: `opts ${q.type}`, role: multi ? 'group' : 'radiogroup', 'aria-label': '选项' },
        perm.map((oi, di) => optionButton(q, a, oi, di)),
        unknownButton(q, a),
      ),
    );

    const actions = h(
      'div',
      { class: 'q-actions' },
      h('button', { class: 'btn ghost', type: 'button', disabled: session.idx === 0, onclick: prev }, icon('left'), '上一题'),
      submitted
        ? h('button', { class: 'btn primary', type: 'button', onclick: next }, isLast() ? '完成' : '下一题', kbd('Enter'))
        : h('button', { class: 'btn primary', type: 'button', disabled: !a?.picked.size && !a?.unknown, onclick: submit }, '提交', kbd('Enter')),
    );

    return h('div', { class: 'quiz-q' }, top, card, submitted ? feedback(q, a) : null, actions);
  }

  function feedback(q, a) {
    const st = store.stats(pos).get(q.gid);
    const attempts = store.attemptsOf(pos, q.gid);
    return h(
      'section',
      { class: `feedback ${a.ok ? 'ok' : 'bad'}`, 'aria-live': 'polite' },
      h(
        'header',
        { class: 'fb-head' },
        h('span', { class: 'fb-result' }, icon(a.ok ? 'check' : 'x'), a.unknown ? '不会，已按答错记录' : a.ok ? '回答正确' : '回答错误'),
        a.ok ? null : h('span', { class: 'fb-answer' }, '正确答案', h('b', { class: 'num' }, disp(q, q.answer))),
        h(
          'span',
          {
            class: 'fb-stat',
            'data-tip': `这道题共作答 ${st.n} 次，答对 ${st.correct} 次\n复习优先级 ${st.score}（${STATE_LABEL[st.state]}）`,
          },
          historyMarks(attempts, 10),
          h('span', { class: `state-chip s-${st.state}` }, STATE_LABEL[st.state], h('b', { class: 'num' }, st.score)),
        ),
      ),
      q.explanation ? h('div', { class: 'fb-expl md', html: md(q.explanation) }) : null,
      q.points.length ? h('div', { class: 'fb-points' }, q.points.map((pid) => pointPeek(q.pageId, pid))) : null,
    );
  }

  function pointPeek(pageId, pointId) {
    const pt = pos.pointByKey.get(`${pageId}/${pointId}`);
    if (!pt) return null;
    return h(
      'details',
      { class: 'kp-peek' },
      h('summary', null, icon('book'), h('span', null, pt.title), icon('down', 'chev')),
      h(
        'div',
        { class: 'kp-peek-body' },
        h('div', { class: 'md', html: md(pt.content) }),
        h('a', { class: 'link', href: `#/p/${enc(pos.id)}/page/${enc(pageId)}?kp=${enc(pointId)}` }, '在知识点页查看'),
      ),
    );
  }

  // ── 小结 ──
  function summary() {
    const items = session.items;
    const answered = items.filter((q) => ansOf(q)?.submitted);
    const right = answered.filter((q) => ansOf(q).ok);
    const wrong = answered.filter((q) => !ansOf(q).ok);
    const skipped = items.length - answered.length;
    const pct = answered.length ? Math.round((right.length * 100) / answered.length) : 0;
    const firstSkipped = items.findIndex((q) => !ansOf(q)?.submitted);

    return h(
      'div',
      { class: 'summary' },
      h(
        'div',
        { class: 'sum-top' },
        h('div', { class: 'sum-score' }, h('span', { class: 'big num' }, right.length), h('span', { class: 'of num' }, `/ ${answered.length}`)),
        h(
          'div',
          { class: 'sum-meta' },
          h('span', null, '正确率', h('b', { class: 'num' }, `${pct}%`)),
          skipped ? h('span', null, '未作答', h('b', { class: 'num' }, skipped)) : null,
        ),
      ),
      track(),
      wrong.length
        ? h(
            'div',
            { class: 'sum-wrong' },
            h('h3', null, '答错或不会的题'),
            h(
              'ol',
              null,
              wrong.map((q) =>
                h(
                  'li',
                  null,
                  h(
                    'button',
                    { class: 'sum-item', type: 'button', onclick: () => go(items.indexOf(q)) },
                    h('span', { class: 'stem' }, plainText(q.stem, 90)),
                    h(
                      'span',
                      { class: 'pick' },
                      ansOf(q).unknown
                        ? h('b', { class: 'tone-weak' }, '不会')
                        : ['选了', h('b', { class: 'num tone-weak' }, disp(q, ansOf(q).pick))],
                      '答案',
                      h('b', { class: 'num tone-good' }, disp(q, q.answer)),
                    ),
                  ),
                ),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'sum-actions' },
        wrong.length ? h('button', { class: 'btn primary', type: 'button', onclick: retryWrong }, `重练这 ${wrong.length} 题`) : null,
        skipped ? h('button', { class: `btn${wrong.length ? '' : ' primary'}`, type: 'button', onclick: () => go(firstSkipped) }, '继续作答') : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: restart }, '全部重做'),
        opts.exit
          ? opts.exit.href
            ? h('a', { class: 'btn ghost', href: opts.exit.href }, opts.exit.label)
            : h('button', { class: 'btn ghost', type: 'button', onclick: opts.exit.onClick }, opts.exit.label)
          : null,
      ),
    );
  }

  // ── 操作 ──
  function toggle(oi) {
    const q = cur();
    let a = ansOf(q);
    if (a?.submitted) return;
    if (!a) {
      a = { picked: new Set(), submitted: false };
      session.answers.set(q.gid, a);
    }
    a.unknown = false;
    if (q.type === 'multi') {
      if (a.picked.has(oi)) a.picked.delete(oi);
      else a.picked.add(oi);
    } else {
      a.picked.clear();
      a.picked.add(oi);
    }
    render();
  }

  function toggleUnknown() {
    const q = cur();
    let a = ansOf(q);
    if (a?.submitted) return;
    if (!a) {
      a = { picked: new Set(), submitted: false };
      session.answers.set(q.gid, a);
    }
    a.unknown = q.type === 'multi' ? !a.unknown : true;
    a.picked.clear();
    render();
  }

  function submit() {
    const q = cur();
    const a = ansOf(q);
    if (!a || a.submitted || (!a.picked.size && !a.unknown)) return;
    a.pick = a.unknown ? '' : [...a.picked].map((i) => LETTERS[i]).sort().join('');
    a.ok = !a.unknown && a.pick === q.answer;
    a.submitted = true;
    store.record(pos, q, { ok: a.ok, pick: a.pick, unknown: !!a.unknown, src: session.mode, dur: performance.now() - shownAt });
    fresh = true;
    render();
  }

  function go(i) {
    session.idx = Math.max(0, Math.min(i, session.items.length - 1));
    session.finished = false;
    shownAt = performance.now();
    render();
    scrollIntoViewIfNeeded();
  }

  function prev() {
    if (session.idx > 0) go(session.idx - 1);
  }

  function next() {
    if (!isLast()) return go(session.idx + 1);
    if (session.single && opts.onSingleDone) return opts.onSingleDone();
    session.finished = true;
    render();
    scrollIntoViewIfNeeded();
  }

  function swap(s) {
    session = s;
    shownAt = performance.now();
    render();
    scrollIntoViewIfNeeded();
  }

  function retryWrong() {
    const wrong = session.items.filter((q) => ansOf(q)?.submitted && !ansOf(q).ok);
    const s = newSession(session.key, wrong, { mode: session.mode, base: session.base });
    s.sig = session.sig;
    swap(s);
  }

  function restart() {
    const s = opts.restartAll ? opts.restartAll() : newSession(session.key, session.base, { mode: session.mode });
    if (!s.sig) s.sig = session.sig;
    swap(s);
  }

  function toggleShuffle() {
    prefs.set('shuffle', !shuffleOn());
    for (const q of session.items) if (!ansOf(q)?.submitted) session.perms.set(q.gid, makePerm(q));
    render();
  }

  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (!root.isConnected || session.finished || document.querySelector('.overlay')) return;
    const t = e.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    if (t?.closest?.('.notes')) return;

    const q = cur();
    const a = ansOf(q);
    const k = e.key;
    if (k === 'Enter') {
      const native = t && t !== root && t !== document.body && t.closest?.('button, a, summary') && !t.closest('.opt');
      if (native) return;
      e.preventDefault();
      if (a?.submitted) next();
      else submit();
      return;
    }
    if (k === 'ArrowRight' && !isLast()) {
      e.preventDefault();
      go(session.idx + 1);
      return;
    }
    if (k === 'ArrowLeft' && session.idx > 0) {
      e.preventDefault();
      go(session.idx - 1);
      return;
    }
    if (k === '0') {
      e.preventDefault();
      toggleUnknown();
      return;
    }
    let di = -1;
    if (/^[1-8]$/.test(k)) di = Number(k) - 1;
    else if (/^[a-h]$/i.test(k)) di = k.toUpperCase().charCodeAt(0) - 65;
    const perm = session.perms.get(q.gid);
    if (di >= 0 && di < perm.length) {
      e.preventDefault();
      toggle(perm[di]);
    }
  }

  document.addEventListener('keydown', onKey);
  render();
  // 侧栏链接等常驻元素可能还保留着焦点，那样 Enter 会触发它们；答题区挂载时接管焦点
  root.focus({ preventScroll: true });

  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
