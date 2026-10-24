// 入口与路由
//   #/                          岗位列表
//   #/p/<岗位>                  岗位总览
//   #/p/<岗位>/page/<页面>      知识点（?kp=<知识点> 定位到该知识点）
//   #/p/<岗位>/page/<页面>/quiz 本页练习
//   #/p/<岗位>/review           错题复习

import { h, icon, initTooltip, hideTip } from './ui.js';
import * as store from './store.js';
import { Shell } from './views/shell.js';
import { renderHome } from './views/home.js';
import { renderOverview } from './views/overview.js';
import { renderPage } from './views/page.js';
import { renderReview } from './views/review.js';

const app = document.getElementById('app');
let view = null;
let shell = null;
let routeToken = 0;

function parseHash() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const seg = path.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  return { seg, params: new URLSearchParams(query || '') };
}

async function route() {
  const token = ++routeToken;
  const { seg, params } = parseHash();
  hideTip();
  view?.destroy?.();
  view = null;

  try {
    if (seg[0] !== 'p' || !seg[1]) {
      shell?.destroy();
      shell = null;
      view = await renderHome(app);
      return;
    }

    const pid = seg[1];
    if (!shell || shell.pid !== pid) {
      shell?.destroy();
      shell = null;
      app.replaceChildren(h('div', { class: 'boot' }));
    }
    const pos = await store.getPosition(pid);
    if (token !== routeToken) return;
    if (!shell) shell = new Shell(app, pos);

    let name = 'overview';
    let pageId = null;
    let tab = 'learn';
    if (seg[2] === 'page' && seg[3]) {
      name = 'page';
      pageId = seg[3];
      tab = seg[4] === 'quiz' ? 'quiz' : 'learn';
    } else if (seg[2] === 'review') {
      name = 'review';
    }

    shell.setActive(name, pageId);
    const main = shell.main;
    main.replaceChildren();
    if (!params.get('kp')) window.scrollTo(0, 0);

    if (name === 'overview') view = renderOverview(main, pos);
    else if (name === 'page') view = renderPage(main, pos, pageId, tab, params, shell);
    else view = renderReview(main, pos, params);
  } catch (err) {
    if (token !== routeToken) return;
    console.error(err);
    shell?.destroy();
    shell = null;
    app.replaceChildren(errorScreen(err));
  }
}

function errorScreen(err) {
  if (err.offline || location.protocol === 'file:') {
    return h(
      'div',
      { class: 'fullscreen-msg' },
      icon('warn', 'lg'),
      h('h1', null, '连接不到本地服务'),
      h('p', null, '双击项目文件夹里的 start.bat 启动服务，再刷新本页。'),
      h('button', { class: 'btn primary', onclick: () => route() }, icon('retry'), '重新连接'),
    );
  }
  if (err.status === 404) {
    return h(
      'div',
      { class: 'fullscreen-msg' },
      h('h1', null, '找不到这个岗位'),
      h('p', null, '它可能被重命名或删除了。'),
      h('a', { class: 'btn primary', href: '#/' }, '返回岗位列表'),
    );
  }
  return h(
    'div',
    { class: 'fullscreen-msg' },
    icon('warn', 'lg'),
    h('h1', null, '加载失败'),
    h('p', null, err.message || String(err)),
    h('button', { class: 'btn primary', onclick: () => route() }, icon('retry'), '重试'),
  );
}

initTooltip();
window.addEventListener('hashchange', route);
route();
