// 页面笔记：每个页面一个 Markdown 文件 data/notes/<岗位>/<页面>.md
//
// · 右侧面板里编辑，停止输入 0.8 秒后自动保存，Ctrl+S 立即保存
// · 文件也可以直接用编辑器改：网页里没有未保存内容时，回到页面会自动载入新内容；
//   两边同时改了会提示冲突，由你选择保留哪一份（服务端用内容指纹判断）
// · 服务端覆盖前会把旧版本留在 data/notes/<岗位>/_history/<页面>/

import { h, icon, prefs } from '../ui.js';
import { mdFresh } from '../md.js';
import { api } from '../api.js';

const SAVE_DELAY = 800;
const KEEPALIVE_LIMIT = 60000; // 关页面时用 keepalive 请求补存，浏览器对请求体有约 64KB 限制
const docs = new Map(); // 「岗位/页面」-> NoteDoc，切换页面、标签后状态还在

function docFor(pid, page) {
  const key = `${pid}/${page.id}`;
  let doc = docs.get(key);
  if (!doc) docs.set(key, (doc = new NoteDoc(pid, page)));
  doc.page = page;
  return doc;
}

class NoteDoc {
  constructor(pid, page) {
    this.pid = pid;
    this.page = page;
    this.path = `data/notes/${pid}/${page.id}.md`;
    this.content = '';
    this.base = null; // 上次与文件同步时的内容指纹
    this.loaded = false;
    this.loading = null;
    this.dirty = false;
    this.saving = false;
    this.status = 'idle'; // idle | dirty | saving | saved | error | conflict
    this.error = '';
    this.conflict = null; // { content, hash }：文件里的版本
    this.timer = 0;
    this.ui = { scroll: 0, selStart: 0, selEnd: 0, previewScroll: 0 };
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    for (const fn of [...this.listeners]) fn(reason);
  }

  get busy() {
    return this.dirty || this.saving || this.status === 'conflict';
  }

  // 从文件读取；本地有未保存的修改时不覆盖
  load() {
    if (this.busy) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = api
      .note(this.pid, this.page.id)
      .then((r) => {
        if (this.busy) return;
        const changed = !this.loaded || r.hash !== this.base;
        this.loaded = true;
        this.base = r.hash;
        this.path = r.path || this.path;
        this.page.noteSize = r.size;
        if (this.status === 'error') {
          this.status = 'idle';
          this.error = '';
        }
        if (changed) this.content = r.content;
        this.emit(changed ? 'load' : 'status');
      })
      .catch((e) => {
        if (this.loaded) return; // 已有内容时，后台核对失败不打扰
        this.status = 'error';
        this.error = e.offline ? '连接不到本地服务，暂时无法读取笔记' : `读取失败：${e.message}`;
        this.emit('status');
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  set(text) {
    if (!this.loaded || text === this.content) return;
    this.content = text;
    this.dirty = true;
    if (this.status !== 'conflict') this.status = 'dirty';
    this.emit('status');
    clearTimeout(this.timer);
    if (this.status !== 'conflict') this.timer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  async save({ keepalive = false } = {}) {
    clearTimeout(this.timer);
    if (!this.loaded || !this.dirty || this.saving || this.status === 'conflict') return;
    this.saving = true;
    this.status = 'saving';
    this.emit('status');
    const content = this.content;
    try {
      const r = await api.saveNote(this.pid, this.page.id, { content, base: this.base }, { keepalive });
      this.base = r.hash;
      this.page.noteSize = r.size;
      this.error = '';
      if (this.content === content) {
        this.dirty = false;
        this.status = 'saved';
      } else {
        this.status = 'dirty';
      }
    } catch (e) {
      if (e.status === 409 && e.data) {
        this.status = 'conflict';
        this.conflict = { content: e.data.content || '', hash: e.data.hash || '' };
      } else {
        this.status = 'error';
        this.error = e.offline ? '连接不到本地服务，内容还在页面里，恢复后会继续保存' : `保存失败：${e.message}`;
      }
    } finally {
      this.saving = false;
      this.emit('status');
      if (this.dirty && this.status === 'dirty') this.timer = setTimeout(() => this.save(), SAVE_DELAY);
    }
  }

  // 冲突时：放弃网页里的修改，换成文件里的版本
  useFile() {
    if (!this.conflict) return;
    this.content = this.conflict.content;
    this.base = this.conflict.hash;
    this.page.noteSize = this.content.trim() ? this.content.length : 0;
    this.conflict = null;
    this.dirty = false;
    this.status = 'idle';
    this.emit('load');
  }

  // 冲突时：用网页里的内容覆盖文件
  keepMine() {
    if (!this.conflict) return;
    this.base = this.conflict.hash;
    this.conflict = null;
    this.dirty = true;
    this.status = 'dirty';
    this.save();
  }
}

// 关闭或刷新页面时补存；补存不了（内容过大、有冲突、正在保存）就让浏览器确认
window.addEventListener('beforeunload', (e) => {
  let block = false;
  for (const doc of docs.values()) {
    if (!doc.dirty) continue;
    if (doc.saving || doc.status === 'conflict' || new Blob([doc.content]).size > KEEPALIVE_LIMIT) block = true;
    else doc.save({ keepalive: true });
  }
  if (block) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── 编辑器小功能：列表续写、Tab 缩进（都可以 Ctrl+Z 撤销） ──

const LIST_RE = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;
const QUOTE_RE = /^(\s*(?:>\s?)+)/;

function insertText(ta, text, start = ta.selectionStart, end = ta.selectionEnd) {
  ta.focus();
  ta.setSelectionRange(start, end);
  let ok = false;
  try {
    ok = text ? document.execCommand('insertText', false, text) : start === end || document.execCommand('delete');
  } catch {
    ok = false;
  }
  if (!ok) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function insideFence(text) {
  return (text.match(/^\s*(```|~~~)/gm) || []).length % 2 === 1;
}

function continueList(ta) {
  const { value, selectionStart: s, selectionEnd: t } = ta;
  if (s !== t) return false;
  const ls = value.lastIndexOf('\n', s - 1) + 1;
  if (insideFence(value.slice(0, ls))) return false;
  const before = value.slice(ls, s);
  const le = value.indexOf('\n', s);
  const after = value.slice(s, le < 0 ? value.length : le);

  let m = LIST_RE.exec(before);
  if (m) {
    if (!before.slice(m[0].length).trim() && !after.trim()) insertText(ta, '', ls, s); // 空列表项：结束列表
    else insertText(ta, `\n${m[1]}${m[2] || `${Number(m[3]) + 1}${m[4]}`}${m[5]}${m[6] ? '[ ] ' : ''}`);
    return true;
  }
  m = QUOTE_RE.exec(before);
  if (m) {
    if (!before.slice(m[0].length).trim() && !after.trim()) insertText(ta, '', ls, s);
    else insertText(ta, `\n${m[1]}`);
    return true;
  }
  return false;
}

function indent(ta, outdent) {
  const { value, selectionStart: s, selectionEnd: t } = ta;
  const ls = value.lastIndexOf('\n', s - 1) + 1;
  if (s === t && !outdent) {
    const end = value.indexOf('\n', s);
    if (!LIST_RE.test(value.slice(ls, end < 0 ? value.length : end))) return insertText(ta, '  ');
    insertText(ta, '  ', ls, ls); // 光标在列表项上：整项缩进一级（变成子列表）
    ta.setSelectionRange(s + 2, s + 2);
    return;
  }
  let le = value.indexOf('\n', t > s && value[t - 1] === '\n' ? t - 1 : t);
  if (le < 0) le = value.length;
  const block = value.slice(ls, le);
  const next = block
    .split('\n')
    .map((line) => (outdent ? line.replace(/^( {1,2}|\t)/, '') : `  ${line}`))
    .join('\n');
  if (next === block) return;
  insertText(ta, next, ls, le);
  if (s === t) ta.setSelectionRange(Math.max(ls, s - (block.length - next.length)), Math.max(ls, s - (block.length - next.length)));
  else ta.setSelectionRange(ls, ls + next.length);
}

// ── 面板 ──

export class NotesPanel {
  constructor(host, pos) {
    this.host = host;
    this.pos = pos;
    this.page = null;
    this.doc = null;
    this.offDoc = null;
    this.open = !!prefs.get('notes.open', false);
    this.mode = 'edit';
    this.rendered = null;
    this.listeners = new Set();

    this.ta = h('textarea', {
      class: 'notes-input',
      spellcheck: 'false',
      placeholder: '用 Markdown 记笔记，停止输入后自动保存',
      'aria-label': '笔记内容',
    });
    this.ta.addEventListener('input', () => this.doc?.set(this.ta.value));
    this.ta.addEventListener('keydown', (e) => this.editorKey(e));
    this.preview = h('div', { class: 'md notes-preview', tabindex: '0', 'aria-label': '笔记预览' });
    this.banner = h('div', { class: 'notes-banner', role: 'alert', hidden: true });
    this.statusEl = h('span', { class: 'notes-status', role: 'status', 'aria-live': 'polite' });
    this.btnEdit = h('button', { type: 'button', onclick: () => this.setMode('edit') }, '编辑');
    this.btnPreview = h('button', { type: 'button', onclick: () => this.setMode('preview') }, '预览');
    this.noEl = h('span', { class: 'notes-no num' });
    this.pathEl = h('span', { class: 'notes-path', 'data-tip': '笔记文件（相对项目根目录），可以直接用编辑器打开' });
    this.countEl = h('span', { class: 'notes-count' });

    this.el = h(
      'aside',
      { class: 'notes', 'aria-label': '页面笔记', tabindex: '-1', hidden: true },
      h(
        'header',
        { class: 'notes-head' },
        h('h2', null, this.noEl, '笔记'),
        this.statusEl,
        h('div', { class: 'seg-ctl', role: 'group', 'aria-label': '显示方式' }, this.btnEdit, this.btnPreview),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭笔记', 'data-tip': '关闭（Esc）', onclick: () => this.toggle(false) }, icon('x')),
      ),
      this.banner,
      h('div', { class: 'notes-body' }, this.ta, this.preview),
      h('footer', { class: 'notes-foot' }, this.pathEl, this.countEl),
    );
    host.append(this.el);

    this.onKey = (e) => this.globalKey(e);
    this.onFocus = () => {
      if (this.visible && this.doc && !this.doc.busy) this.doc.load();
    };
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('focus', this.onFocus);
  }

  get visible() {
    return this.open && !!this.page;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of [...this.listeners]) fn();
  }

  // 路由切换时调用：page 为空表示当前不在页面里（总览、复习）
  setPage(page) {
    page = page || null;
    if (this.doc && this.doc.page.id !== page?.id) {
      this.keepUi();
      this.doc.save();
      this.offDoc();
      this.doc = this.offDoc = null;
    }
    this.page = page;
    if (page && !this.doc) {
      this.doc = docFor(this.pos.id, page);
      this.offDoc = this.doc.on((reason) => this.sync(reason));
      this.rendered = null;
      this.ta.value = this.doc.content;
      this.pickMode();
      this.sync('load');
      this.restoreUi();
      if (this.open) this.doc.load(); // 每次进入页面都和文件核对一次，拿到在编辑器里做的修改
    }
    this.apply(false);
  }

  toggle(force) {
    const open = force === undefined ? !this.open : !!force;
    if (open === this.open) return;
    this.open = open;
    prefs.set('notes.open', open);
    if (open) {
      this.doc?.load();
      this.restoreUi();
    } else {
      this.keepUi();
      this.doc?.save();
    }
    this.apply(true);
    if (open && this.page) requestAnimationFrame(() => this.focusEditor());
  }

  apply(animate) {
    const show = this.visible;
    this.el.hidden = !show;
    this.host.classList.toggle('notes-open', show);
    if (animate && show) {
      this.el.classList.remove('enter');
      void this.el.offsetWidth;
      this.el.classList.add('enter');
    }
    if (this.page) this.noEl.textContent = this.page.no;
    this.changed();
  }

  pickMode() {
    // 有内容时按上次选择的方式打开；空笔记直接进入编辑
    const saved = prefs.get('notes.mode', 'edit') === 'preview' ? 'preview' : 'edit';
    this.mode = this.doc && this.doc.content.trim() ? saved : 'edit';
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.keepUi();
    this.mode = mode;
    prefs.set('notes.mode', mode);
    this.renderMode();
    this.restoreUi();
    this.focusEditor();
  }

  focusEditor() {
    (this.mode === 'edit' ? this.ta : this.preview).focus({ preventScroll: true });
  }

  renderMode() {
    const doc = this.doc;
    const empty = !doc || !doc.content.trim();
    if (empty && this.mode === 'preview') this.mode = 'edit';
    const edit = this.mode === 'edit';
    this.ta.hidden = !edit;
    this.preview.hidden = edit;
    this.btnEdit.classList.toggle('on', edit);
    this.btnPreview.classList.toggle('on', !edit);
    this.btnEdit.setAttribute('aria-pressed', String(edit));
    this.btnPreview.setAttribute('aria-pressed', String(!edit));
    this.btnPreview.disabled = empty;
    if (!edit && doc && this.rendered !== doc.content) {
      this.preview.innerHTML = mdFresh(doc.content);
      this.rendered = doc.content;
    }
  }

  sync(reason) {
    const doc = this.doc;
    if (!doc) return;
    if (reason === 'load') {
      if (this.ta.value !== doc.content) {
        const { selectionStart: s, selectionEnd: t, scrollTop } = this.ta;
        const n = doc.content.length;
        this.ta.value = doc.content;
        try {
          this.ta.setSelectionRange(Math.min(s, n), Math.min(t, n));
        } catch {
          /* 隐藏状态下部分浏览器不允许设置选区 */
        }
        this.ta.scrollTop = scrollTop;
      }
      if (!this.ta.matches(':focus')) this.pickMode();
    }
    this.ta.readOnly = !doc.loaded;

    const STATUS = {
      dirty: ['未保存', 'dirty'],
      saving: ['保存中…', ''],
      saved: ['已保存', ''],
      error: [doc.loaded ? '保存失败' : '读取失败', 'bad'],
      conflict: ['有冲突', 'bad'],
    };
    const [text, tone] = STATUS[doc.status] || ['', ''];
    this.statusEl.textContent = text;
    this.statusEl.className = `notes-status${tone ? ` ${tone}` : ''}`;

    if (doc.status === 'conflict') {
      this.banner.className = 'notes-banner warn';
      this.banner.replaceChildren(
        h('p', null, '笔记文件在别处被修改过，和这里的内容不一致。'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => this.resolve(() => doc.useFile()) }, '换成文件里的版本'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => this.resolve(() => doc.keepMine()) }, '保留这里的内容'),
      );
      this.banner.hidden = false;
    } else if (doc.status === 'error') {
      this.banner.className = 'notes-banner';
      this.banner.replaceChildren(
        h('p', null, doc.error),
        h('button', { class: 'btn sm', type: 'button', onclick: () => (doc.loaded ? doc.save() : doc.load()) }, icon('retry'), '重试'),
      );
      this.banner.hidden = false;
    } else {
      this.banner.hidden = true;
    }

    const chars = doc.content.replace(/\s/g, '').length;
    this.countEl.textContent = chars ? `${chars.toLocaleString('zh-CN')} 字` : '';
    this.pathEl.textContent = doc.path;
    this.renderMode();
    this.changed();
  }

  // 处理完冲突后，焦点回到编辑区（按钮随横幅一起消失）
  resolve(action) {
    action();
    this.mode = 'edit';
    this.renderMode();
    this.ta.focus({ preventScroll: true });
  }

  keepUi() {
    if (!this.doc || this.el.hidden) return;
    Object.assign(this.doc.ui, {
      scroll: this.ta.scrollTop,
      selStart: this.ta.selectionStart,
      selEnd: this.ta.selectionEnd,
      previewScroll: this.preview.scrollTop,
    });
  }

  restoreUi() {
    const doc = this.doc;
    if (!doc) return;
    requestAnimationFrame(() => {
      if (this.doc !== doc || this.el.hidden) return;
      const u = doc.ui;
      const n = this.ta.value.length;
      try {
        this.ta.setSelectionRange(Math.min(u.selStart, n), Math.min(u.selEnd, n));
      } catch {
        /* 同上 */
      }
      this.ta.scrollTop = u.scroll;
      this.preview.scrollTop = u.previewScroll;
    });
  }

  editorKey(e) {
    if (e.isComposing || e.keyCode === 229) return; // 输入法正在组字
    if (e.key === 'Escape') {
      e.preventDefault();
      this.el.focus({ preventScroll: true }); // 第一次 Esc 离开输入框，再按一次关闭面板
      return;
    }
    if (this.ta.readOnly || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      indent(this.ta, e.shiftKey);
    } else if (e.key === 'Enter' && !e.shiftKey && continueList(this.ta)) {
      e.preventDefault();
    }
  }

  globalKey(e) {
    if (!this.visible) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.doc?.save();
      return;
    }
    if (e.key === 'Escape' && !e.defaultPrevented && this.el.contains(document.activeElement) && !document.querySelector('.overlay')) {
      e.preventDefault();
      this.toggle(false);
    }
  }

  destroy() {
    this.keepUi();
    this.doc?.save();
    this.offDoc?.();
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('focus', this.onFocus);
    this.host.classList.remove('notes-open');
    this.el.remove();
  }
}
