// 岗位总览：题目状态矩阵、错题预览、岗位 JD、数据管理

import { h, icon, cell, plainText, modal, confirmDialog, toast } from '../ui.js';
import { md } from '../md.js';
import * as store from '../store.js';
import { STATES, STATE_LABEL } from '../rank.js';

let animated = false; // 矩阵点亮动画每次打开应用只播放一次

export function renderOverview(main, pos) {
  const base = `#/p/${encodeURIComponent(pos.id)}`;
  const root = h('div', { class: 'overview' });
  main.append(root);

  function render() {
    const s = store.stats(pos);
    const c = store.counts(pos);
    const total = pos.questions.length;
    const answered = store.answeredCount(pos);

    // ── 头部 ──
    const head = h(
      'header',
      { class: 'ov-head' },
      h('h1', null, pos.name),
      pos.company || pos.description
        ? h(
            'p',
            { class: 'ov-sub' },
            pos.company ? h('span', null, pos.company) : null,
            pos.description ? h('span', null, pos.description) : null,
          )
        : null,
    );

    // ── 状态矩阵 ──
    let i = 0;
    const rows = pos.pages.map((page) => {
      const done = store.answeredCount(pos, page.questions);
      return h(
        'a',
        { class: 'mx-row', href: `${base}/page/${encodeURIComponent(page.id)}` },
        h('span', { class: 'no num' }, page.no),
        h(
          'span',
          { class: 't' },
          h('span', { class: 'tt' }, page.title),
          page.noteSize > 0 ? h('span', { class: 'note-mark', 'data-tip': '这一页有笔记' }, icon('note')) : null,
        ),
        h(
          'span',
          { class: 'cells' },
          page.questions.length
            ? page.questions.map((q) => {
                const st = s.get(q.gid);
                const el = cell(st.state, `${STATE_LABEL[st.state]}　优先级 ${st.score}\n${plainText(q.stem, 60)}`);
                el.style.setProperty('--d', `${Math.min(i++ * 7, 700)}ms`);
                return el;
              })
            : h('span', { class: 'muted small' }, '还没有题目'),
        ),
        h('span', { class: 'done num', 'data-tip': '已做 / 题目数' }, `${done}/${page.questions.length}`),
      );
    });

    const matrix = h(
      'section',
      { class: `panel matrix${animated ? "" : " intro"}`, 'aria-label': '题目状态' },
      h(
        'div',
        { class: 'mx-top' },
        h(
          'div',
          { class: 'legend' },
          STATES.map((st) =>
            h('span', { class: 'lg' }, h('i', { class: `cell s-${st}` }), STATE_LABEL[st], h('b', { class: 'num' }, c[st])),
          ),
        ),
        h('span', { class: 'mx-progress' }, '已做 ', h('b', { class: 'num' }, answered), h('span', { class: 'num' }, ` / ${total}`)),
      ),
      rows.length ? h('div', { class: 'mx-rows' }, rows) : h('p', { class: 'muted' }, `还没有页面。在 ${pos.path}/pages/ 下新建 01-xxx 文件夹。`),
    );
    animated = true;

    // ── 错题预览 ──
    const top = store.ranked(pos).slice(0, 6);
    const peek = h(
      'section',
      { class: 'panel peek' },
      h('div', { class: 'panel-head' }, h('h2', null, '优先复习'), h('a', { class: 'btn primary sm', href: `${base}/review` }, '去复习')),
      top.length
        ? h(
            'ol',
            { class: 'peek-list' },
            top.map((q) => {
              const st = s.get(q.gid);
              const page = pos.pageById.get(q.pageId);
              return h(
                'li',
                null,
                h(
                  'a',
                  { href: `${base}/review?q=${encodeURIComponent(q.gid)}`, 'data-tip': '单独练这道题' },
                  h('span', { class: `score num s-${st.state}` }, st.score),
                  h('span', { class: 'stem' }, plainText(q.stem, 70)),
                  h('span', { class: 'pg num' }, page.no),
                ),
              );
            }),
          )
        : h('p', { class: 'muted' }, '还没有题目。'),
    );

    // ── 岗位 JD ──
    const jd = pos.jd
      ? h(
          'section',
          { class: 'panel jd' },
          h('div', { class: 'panel-head' }, h('h2', null, '岗位要求')),
          h('div', { class: 'md jd-body', html: md(pos.jd) }),
        )
      : null;

    // ── 数据管理 ──
    const errors = pos.issues.filter((x) => x.level === 'error').length;
    const foot = h(
      'footer',
      { class: 'ov-foot' },
      h('span', { class: 'path', 'data-tip': '题库文件夹（相对项目根目录）' }, icon('folder'), pos.path),
      pos.issues.length
        ? h(
            'button',
            { class: `link-btn ${errors ? 'tone-weak' : 'tone-fair'}`, onclick: showIssues },
            icon('warn'),
            `题库检查：${pos.issues.length} 项需要处理`,
          )
        : null,
      pos.skippedRecords ? h('span', { class: 'tone-fair' }, `${pos.skippedRecords} 行作答记录格式无效，已跳过`) : null,
      h('button', { class: 'link-btn', onclick: reset }, icon('retry'), '重置作答记录'),
    );

    root.replaceChildren(head, matrix, h('div', { class: 'ov-grid' }, peek, jd), foot);
  }

  function showIssues() {
    const list = h(
      'ul',
      { class: 'issues' },
      pos.issues.map((it) =>
        h(
          'li',
          { class: it.level },
          h('span', { class: 'lvl' }, it.level === 'error' ? '错误' : '提示'),
          h('code', null, it.where),
          h('span', null, it.msg),
        ),
      ),
    );
    modal({
      title: '题库检查',
      wide: true,
      body: h('div', null, h('p', { class: 'muted' }, '修改文件后刷新页面即可重新检查；也可以运行 python server.py --check。'), list),
      actions: [{ label: '关闭', value: true }],
    });
  }

  async function reset() {
    const n = [...pos.attempts.values()].reduce((a, l) => a + l.length, 0);
    const ok = await confirmDialog({
      title: '重置作答记录？',
      body: `当前共有 ${n} 条作答记录。重置后所有题目回到“未做”，原记录文件会移到 data/records/archive/ 保存，不会删除。`,
      confirm: '重置',
      danger: true,
    });
    if (!ok) return;
    try {
      const archived = await store.resetRecords(pos);
      toast(archived ? `已重置，旧记录保存在 ${archived}` : '已重置', 'ok', 4000);
      render();
    } catch (e) {
      toast(`重置失败：${e.message}`, 'bad');
    }
  }

  render();
  const off = store.on('records', (p) => p === pos && render());
  return { destroy: off };
}
