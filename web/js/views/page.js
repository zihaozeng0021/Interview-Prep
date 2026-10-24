// 单个页面：知识点 / 本页练习

import { h, icon, cell, plainText } from '../ui.js';
import { md } from '../md.js';
import * as store from '../store.js';
import { STATE_LABEL, aggregateState } from '../rank.js';
import { getSession, newSession, mountQuiz } from './quiz.js';

export function renderPage(main, pos, pageId, tab, params, shell) {
  const page = pos.pageById.get(pageId);
  const base = `#/p/${encodeURIComponent(pos.id)}`;
  if (!page) {
    main.append(
      h('div', { class: 'empty' }, h('h2', null, '找不到这个页面'), h('a', { class: 'btn', href: base }, '返回总览')),
    );
    return {};
  }
  const pageHref = `${base}/page/${encodeURIComponent(page.id)}`;

  // 笔记开关：面板本身由外框持有，切换标签时不会重建
  const panel = shell.notes;
  const notesBtn = h(
    'button',
    { class: 'notes-toggle', type: 'button', onclick: () => panel.toggle() },
    icon('note'),
    h('span', { class: 'lbl' }, '笔记'),
    h('i', { class: 'has-dot', 'aria-hidden': 'true' }),
  );
  const paintNotesBtn = () => {
    const has = page.noteSize > 0;
    notesBtn.setAttribute('aria-pressed', String(panel.visible));
    notesBtn.classList.toggle('has', has);
    notesBtn.setAttribute('aria-label', has ? '笔记（已有内容）' : '笔记');
  };
  paintNotesBtn();
  const offNotes = panel.onChange(paintNotesBtn);

  const head = h(
    'header',
    { class: 'pg-head' },
    h('span', { class: 'pg-no num', 'aria-hidden': 'true' }, page.no),
    h(
      'div',
      { class: 'pg-title' },
      h('h1', null, page.title),
      h(
        'p',
        { class: 'pg-meta' },
        h('span', null, h('b', { class: 'num' }, page.points.length), ' 个知识点'),
        h('span', null, h('b', { class: 'num' }, page.questions.length), ' 道题'),
      ),
    ),
    h(
      'div',
      { class: 'pg-bar' },
      h(
        'nav',
        { class: 'tabs', role: 'tablist' },
        h('a', { class: `tab${tab === 'learn' ? ' active' : ''}`, href: pageHref, role: 'tab', 'aria-selected': String(tab === 'learn') }, '知识点'),
        h(
          'a',
          { class: `tab${tab === 'quiz' ? ' active' : ''}`, href: `${pageHref}/quiz`, role: 'tab', 'aria-selected': String(tab === 'quiz') },
          '练习',
          h('span', { class: 'tab-count num' }, page.questions.length),
        ),
      ),
      notesBtn,
    ),
  );
  const body = h('div', { class: 'pg-body' });
  main.append(h('div', { class: 'page' }, head, body));

  const view = tab === 'quiz' ? quizTab(body, pos, page, pageHref) : learnTab(body, pos, page, pageHref, params.get('kp'));
  return {
    destroy() {
      view.destroy?.();
      offNotes();
    },
  };
}

function learnTab(body, pos, page, pageHref, focusPoint) {
  const byPoint = new Map(page.points.map((p) => [p.id, []]));
  for (const q of page.questions) for (const pid of q.points) byPoint.get(pid)?.push(q);

  const sections = [];
  const tocLinks = new Map();
  const cellBoxes = new Map();

  for (const pt of page.points) {
    const cells = h('span', { class: 'cells kp-cells' });
    cellBoxes.set(pt.id, cells);
    const sec = h(
      'section',
      { class: 'kp', id: `kp-${pt.id}`, 'data-kp': pt.id },
      h('header', { class: 'kp-head' }, h('h2', null, pt.title), cells),
      h('div', { class: 'md', html: md(pt.content) }),
    );
    sections.push(sec);
  }

  const toc = h(
    'nav',
    { class: 'toc', 'aria-label': '知识点目录' },
    page.points.map((pt) => {
      const a = h(
        'a',
        {
          href: `#kp-${pt.id}`,
          onclick: (e) => {
            e.preventDefault();
            document.getElementById(`kp-${pt.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        h('i', { class: 'dot' }),
        h('span', null, pt.title),
      );
      tocLinks.set(pt.id, a);
      return a;
    }),
  );

  function paintStates() {
    const s = store.stats(pos);
    for (const pt of page.points) {
      const qs = byPoint.get(pt.id) || [];
      cellBoxes.get(pt.id).replaceChildren(
        ...qs.map((q) => {
          const st = s.get(q.gid);
          return cell(st.state, `${STATE_LABEL[st.state]}　${plainText(q.stem, 50)}`);
        }),
      );
      const agg = aggregateState(qs.map((q) => s.get(q.gid).state));
      const dot = tocLinks.get(pt.id)?.querySelector('.dot');
      if (dot) dot.className = `dot s-${agg}`;
    }
  }

  const article = h(
    'article',
    { class: 'kn' },
    page.intro ? h('div', { class: 'md kn-intro', html: md(page.intro) }) : null,
    sections.length ? sections : h('p', { class: 'muted' }, `这个页面还没有知识点。编辑 ${page.dir}/knowledge.md，用「## 标题 {#id}」开始一个知识点。`),
    page.questions.length
      ? h(
          'div',
          { class: 'kn-end' },
          h('a', { class: 'btn primary', href: `${pageHref}/quiz` }, icon('play'), `做本页 ${page.questions.length} 道题`),
        )
      : null,
  );

  body.append(h('div', { class: 'kn-layout' }, article, page.points.length > 1 ? toc : null));
  paintStates();

  // 目录随滚动高亮：取顶部越过视口 30% 处的最后一个知识点；滚到底时取最后一个
  let raf = 0;
  const spy = () => {
    raf = 0;
    if (!sections.length) return;
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    let current = sections[0];
    if (atBottom) current = sections[sections.length - 1];
    else for (const s of sections) if (s.getBoundingClientRect().top <= window.innerHeight * 0.3) current = s;
    for (const [id, a] of tocLinks) a.classList.toggle('active', id === current.dataset.kp);
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(spy);
  };
  if (page.points.length > 1) {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }

  if (focusPoint) {
    requestAnimationFrame(() => {
      const el = document.getElementById(`kp-${focusPoint}`);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.classList.add('flash');
      }
    });
  }

  const off = store.on('records', (p) => p === pos && paintStates());
  return {
    destroy() {
      off();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

function quizTab(body, pos, page, pageHref) {
  if (!page.questions.length) {
    body.append(h('p', { class: 'muted' }, `本页还没有题目。在 ${page.dir}/questions.json 中添加。`));
    return {};
  }
  const key = `${pos.id}:page:${page.id}`;
  let session = getSession(key);
  const sig = page.questions.map((q) => q.gid).join('|');
  if (!session || session.sig !== sig) {
    session = newSession(key, page.questions, { mode: 'page' });
    session.sig = sig;
  }
  return mountQuiz(body, pos, session, {
    restartAll: () => {
      const s = newSession(key, page.questions, { mode: 'page' });
      s.sig = sig;
      return s;
    },
    exit: { label: '回到知识点', href: pageHref },
  });
}
