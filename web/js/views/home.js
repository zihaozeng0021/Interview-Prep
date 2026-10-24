// 岗位列表

import { h, icon, logo, cell, plainText } from '../ui.js';
import * as store from '../store.js';
import { STATE_LABEL } from '../rank.js';

export async function renderHome(app) {
  const positions = await store.getPositions(true);
  const list = h('div', { class: 'pos-list' });
  const root = h(
    'div',
    { class: 'home' },
    h('header', { class: 'home-head' }, logo(), h('h1', null, '面试准备')),
    list,
  );

  if (!positions.length) {
    list.append(
      h(
        'div',
        { class: 'empty' },
        h('h2', null, '还没有岗位'),
        h('p', null, '在 data/positions/ 下新建一个岗位文件夹，结构见 README.md。'),
      ),
    );
  }

  for (const p of positions) {
    const href = `#/p/${encodeURIComponent(p.id)}`;
    const stats = h('div', { class: 'pos-stats' });
    const cells = h('div', { class: 'cells pos-cells' });
    list.append(
      h(
        'a',
        { class: 'pos-row', href },
        h(
          'div',
          { class: 'pos-info' },
          h('h2', null, p.name),
          p.company || p.description
            ? h(
                'p',
                { class: 'pos-sub' },
                p.company ? h('span', null, p.company) : null,
                p.description ? h('span', null, p.description) : null,
              )
            : null,
          stats,
        ),
        cells,
      ),
    );
    store
      .getPosition(p.id)
      .then((pos) => {
        const s = store.stats(pos);
        const c = store.counts(pos);
        stats.replaceChildren(
          ...[
            readout(pos.pages.length, '页'),
            readout(pos.questions.length, '题'),
            readout(store.answeredCount(pos), '已做'),
            readout(c.weak, '薄弱', c.weak ? 'weak' : ''),
            pos.issues.length
              ? h('span', { class: 'pos-issues', 'data-tip': '进入岗位总览，在页面底部查看详情' }, icon('warn'), `题库有 ${pos.issues.length} 项需要处理`)
              : null,
          ].filter(Boolean),
        );
        cells.replaceChildren(
          ...pos.questions.map((q) => {
            const st = s.get(q.gid);
            return cell(st.state, `${STATE_LABEL[st.state]}　${plainText(q.stem, 40)}`);
          }),
        );
      })
      .catch(() => {
        stats.replaceChildren(h('span', { class: 'muted' }, '题库读取失败'));
      });
  }

  app.replaceChildren(root);
  return {};
}

function readout(value, label, tone = '') {
  return h('span', { class: `readout ${tone}` }, h('b', { class: 'num' }, value), h('span', null, label));
}
