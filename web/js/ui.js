// DOM 小工具：元素创建、图标、题目方格、提示框、对话框、偏好设置

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  left: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  right: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  shuffle: '<path d="M3.5 7.5h3c2 0 3.1.9 4.1 2.5l2.8 4.6c1 1.6 2.1 2.4 4.1 2.4h3"/><path d="M3.5 16.5h3c1.1 0 2-.3 2.7-.9M20.5 7.5h-3c-1.1 0-2 .3-2.7.9"/><path d="M17.8 4.8l2.7 2.7-2.7 2.7M17.8 13.8l2.7 2.7-2.7 2.7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
  review: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M17.8 3.6v3.6h-3.6M6.2 20.4v-3.6h3.6"/>',
  book: '<path d="M4.5 5.5c2.5-1 5-1 7.5.5 2.5-1.5 5-1.5 7.5-.5v13c-2.5-1-5-1-7.5.5-2.5-1.5-5-1.5-7.5-.5z"/><path d="M12 6v13"/>',
  warn: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.2M12 16.8v.2"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.2h-4.2"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  note: '<path d="M15.2 4.8l4 4L9 19H5v-4z"/><path d="M13.2 6.8l4 4"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ico ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;
  return span;
}

export function logo() {
  const span = document.createElement('span');
  span.className = 'logo';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 22 22"><rect x="1" y="1" width="6" height="6" rx="1.2" fill="#3FD6A3"/><rect x="8" y="1" width="6" height="6" rx="1.2" fill="#3FD6A3"/><rect x="15" y="1" width="6" height="6" rx="1.2" fill="#F3B857"/><rect x="1" y="8" width="6" height="6" rx="1.2" fill="#3FD6A3"/><rect x="8" y="8" width="6" height="6" rx="1.2" fill="#FF6F87"/><rect x="15" y="8" width="6" height="6" rx="1.2" fill="#2B3A55"/><rect x="1" y="15" width="6" height="6" rx="1.2" fill="#F3B857"/><rect x="8" y="15" width="6" height="6" rx="1.2" fill="#2B3A55"/><rect x="15" y="15" width="6" height="6" rx="1.2" fill="#2B3A55"/></svg>';
  return span;
}

export function kbd(text) {
  return h('span', { class: 'kbd' }, text);
}

// 题目方格：每道题一个，颜色代表状态
export function cell(state, tip, extra = {}) {
  return h('span', { class: `cell s-${state}`, 'data-tip': tip || null, ...extra });
}

// 状态比例条：掌握 / 一般 / 薄弱 / 未做
export function stateBar(counts) {
  const total = counts.weak + counts.new + counts.fair + counts.good;
  const bar = h('span', { class: 'mbar', 'aria-hidden': 'true' });
  if (!total) return bar;
  for (const s of ['good', 'fair', 'weak']) {
    if (counts[s]) bar.append(h('i', { class: `s-${s}`, style: { flexGrow: counts[s] } }));
  }
  if (counts.new) bar.append(h('i', { class: 's-new', style: { flexGrow: counts.new } }));
  return bar;
}

// 最近若干次作答：绿 = 对，红 = 错（含不会），最新的在右边
export function historyMarks(attempts, max = 8) {
  const box = h('span', { class: 'hist' });
  for (const a of attempts.slice(-max)) {
    const label = a.unknown === true ? '不会' : a.ok ? '回答正确' : '回答错误';
    box.append(h('i', { class: a.ok ? 'o' : 'x', role: 'img', 'aria-label': label, 'data-tip': label }));
  }
  return box;
}

export function relTime(t, now = Date.now()) {
  if (!t) return '';
  const s = (now - t) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function plainText(md, max = 80) {
  const s = String(md)
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
    .replace(/[`*_>#|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── 偏好设置（浏览器本地，仅保存界面选项；作答记录在服务端文件里） ──
export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`prep.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`prep.${key}`, JSON.stringify(value));
    } catch {
      /* 存储不可用时忽略 */
    }
  },
};

// ── 悬浮提示 ──
let tipEl = null;
let tipFor = null;

export function initTooltip() {
  tipEl = document.getElementById('tip');
  const show = (target) => {
    if (target === tipFor) return;
    tipFor = target;
    if (!target || !target.dataset.tip) return hideTip();
    tipEl.textContent = target.dataset.tip;
    tipEl.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
    let y = r.top - t.height - 8;
    if (y < 8) y = r.bottom + 8;
    tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  document.addEventListener('pointerover', (e) => show(e.target.closest?.('[data-tip]') || null));
  document.addEventListener('focusin', (e) => {
    if (e.target.matches?.(':focus-visible')) show(e.target.closest?.('[data-tip]') || null);
  });
  document.addEventListener('focusout', () => show(null));
  document.addEventListener('pointerdown', hideTip, true); // 点击后界面可能重绘，旧提示不再对应任何元素
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('hashchange', hideTip);
}

export function hideTip() {
  tipFor = null;
  if (tipEl) tipEl.hidden = true;
}

// ── 对话框 ──
export function modal({ title, body, actions = [], wide = false }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    const buttons = actions.map((a) =>
      h('button', { class: `btn ${a.kind || 'ghost'}`, type: 'button', onclick: () => close(a.value) }, a.label),
    );
    const overlay = h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === overlay && close(null) },
      h(
        'div',
        { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', null, title),
        typeof body === 'string' ? h('p', null, body) : body,
        buttons.length ? h('div', { class: 'dialog-actions' }, buttons) : null,
      ),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    (buttons[buttons.length - 1] || overlay.querySelector('.dialog')).focus?.();
  });
}

export async function confirmDialog({ title, body, confirm = '确定', danger = false }) {
  const v = await modal({
    title,
    body,
    actions: [
      { label: '取消', value: false },
      { label: confirm, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

export function toast(message, kind = 'info', ms = 2800) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  }, ms);
}
