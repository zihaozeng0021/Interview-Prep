// Markdown 渲染：GFM 表格、代码高亮、$公式$（KaTeX）

import { Marked } from '../vendor/marked.esm.js';
import katex from '../vendor/katex/katex.mjs';
import hljs from '../vendor/highlight.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function tex(src, displayMode) {
  try {
    return katex.renderToString(src, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return `<code>${esc(src)}</code>`;
  }
}

const marked = new Marked({ gfm: true, breaks: false });

marked.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start(src) {
        const i = src.indexOf('$$');
        return i < 0 ? undefined : i;
      },
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
        return undefined;
      },
      renderer(token) {
        return `<div class="math-block">${tex(token.text, true)}</div>\n`;
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) {
        const i = src.indexOf('$');
        return i < 0 ? undefined : i;
      },
      tokenizer(src) {
        let m = /^\$\$([^$]+?)\$\$/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
        m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
        return undefined;
      },
      renderer(token) {
        return tex(token.text, token.display);
      },
    },
  ],
  renderer: {
    code({ text, lang }) {
      const name = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
      const body =
        name && hljs.getLanguage(name)
          ? hljs.highlight(text, { language: name, ignoreIllegals: true }).value
          : esc(text);
      return `<pre class="code"><code class="hljs">${body}</code></pre>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const external = /^https?:/i.test(href || '');
      return `<a href="${esc(href || '')}"${title ? ` title="${esc(title)}"` : ''}${
        external ? ' target="_blank" rel="noopener"' : ''
      }>${text}</a>`;
    },
  },
});

const blockCache = new Map();
const inlineCache = new Map();

function render(src) {
  return marked
    .parse(src)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

// 题库内容不变，渲染结果缓存
export function md(src) {
  if (!src) return '';
  let html = blockCache.get(src);
  if (html === undefined) {
    html = render(src);
    blockCache.set(src, html);
  }
  return html;
}

// 笔记内容会一直变，不缓存
export function mdFresh(src) {
  return src ? render(src) : '';
}

export function mdInline(src) {
  if (!src) return '';
  let html = inlineCache.get(src);
  if (html === undefined) {
    html = marked.parseInline(src);
    inlineCache.set(src, html);
  }
  return html;
}
