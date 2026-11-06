// Markdown rendering (read view) and source colouring (edit view).
import { registerLanguages, editorLang, codeLine } from './langs.js';

export const COLORS = ['yellow', 'green', 'pink', 'blue'];
const COLOR_RE = 'yellow|green|pink|blue';

const hljs = self.hljs;
registerLanguages(hljs);

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LANG_LABELS = {
  abap: 'ABAP', cds: 'ABAP CDS', 'abap-cds': 'ABAP CDS', abapcds: 'ABAP CDS', ddls: 'ABAP CDS', bdef: 'RAP BDEF', rap: 'RAP',
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', py: 'Python', python: 'Python',
  sh: 'Shell', bash: 'Bash', json: 'JSON', yaml: 'YAML', yml: 'YAML', sql: 'SQL', html: 'HTML', xml: 'XML', css: 'CSS',
  md: 'Markdown', markdown: 'Markdown', java: 'Java', cs: 'C#', csharp: 'C#', cpp: 'C++', go: 'Go', rust: 'Rust', php: 'PHP',
};

// ---------- marked setup ----------
let slugCounts = new Map();
function slugify(text) {
  const base = 'h-' + (String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'section');
  const n = slugCounts.get(base) || 0;
  slugCounts.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

const markExtension = {
  name: 'mark',
  level: 'inline',
  start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = new RegExp(`^==(?:(${COLOR_RE}):)?(?=\\S)([\\s\\S]*?\\S)==(?!=)`).exec(src);
    if (m) return { type: 'mark', raw: m[0], color: m[1] || 'yellow', tokens: this.lexer.inlineTokens(m[2]) };
  },
  renderer(token) {
    return `<mark class="hl-${token.color}">${this.parser.parseInline(token.tokens)}</mark>`;
  },
};

const md = new self.marked.Marked({
  gfm: true,
  breaks: false,
  extensions: [markExtension],
  renderer: {
    code(token) {
      const lang = (token.lang || '').trim().split(/\s+/)[0].toLowerCase();
      let body = null;
      if (lang && hljs && hljs.getLanguage(lang)) {
        try { body = hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value; } catch { body = null; }
      }
      if (body === null) body = escapeHtml(token.text);
      const label = LANG_LABELS[lang] || (lang ? lang : 'Text');
      return `<figure class="code"><figcaption><span class="lang">${escapeHtml(label)}</span><button type="button" class="copy-code">Copy</button></figcaption><pre><code class="hljs">${body}</code></pre></figure>\n`;
    },
    heading(token) {
      const inner = this.parser.parseInline(token.tokens);
      return `<h${token.depth} id="${slugify(inner)}">${inner}</h${token.depth}>\n`;
    },
  },
});

const purify = self.DOMPurify;
if (purify) {
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      const href = node.getAttribute('href') || '';
      if (!href.startsWith('#')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    }
  });
}

export function splitFrontMatter(text) {
  const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { fm: null, body: text, offset: 0 };
  return { fm: m[1], body: text.slice(m[0].length), offset: m[0].length };
}

const TASK_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](?=\s|$)/;
const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)/;

function fenceCloses(line, fence) {
  const re = fence.ch === '`' ? /^\s{0,3}(`{3,})\s*$/ : /^\s{0,3}(~{3,})\s*$/;
  const m = re.exec(line);
  return !!(m && m[1].length >= fence.len);
}

/** Walk lines outside fenced code. cb(line, lineStart) */
function eachProseLine(body, base, cb) {
  let pos = 0;
  let fence = null;
  for (const line of body.split('\n')) {
    if (fence) { if (fenceCloses(line, fence)) fence = null; }
    else {
      const f = FENCE_OPEN.exec(line);
      if (f && !(f[2][0] === '`' && line.slice(f[0].length).includes('`'))) fence = { ch: f[2][0], len: f[2].length };
      else cb(line, base + pos);
    }
    pos += line.length + 1;
  }
}

/**
 * Render Markdown to sanitized HTML.
 * Returns html, headings (top-level, with source offsets) and task checkbox offsets.
 */
export function render(text) {
  slugCounts = new Map();
  const { fm, body, offset } = splitFrontMatter(text);
  const tokens = md.lexer(body);
  const headings = [];
  let pos = offset;
  for (const t of tokens) {
    if (t.type === 'heading') headings.push({ level: t.depth, text: plainInline(t.text), offset: pos });
    pos += (t.raw || '').length;
  }
  let html = md.parser(tokens);
  if (fm !== null) html = `<details class="frontmatter"><summary>Front matter</summary><pre>${escapeHtml(fm)}</pre></details>` + html;
  const clean = purify ? purify.sanitize(html, { ADD_ATTR: ['target'], ADD_TAGS: ['mark'] }) : escapeHtml(text);
  const tasks = [];
  eachProseLine(body, offset, (line, start) => {
    const m = TASK_RE.exec(line);
    if (m) tasks.push({ offset: start + m[1].length + 1, checked: m[2] !== ' ' });
  });
  return { html: clean, headings, tasks };
}

export function plainInline(s) {
  return String(s)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(new RegExp(`==(?:(?:${COLOR_RE}):)?`, 'g'), '')
    .replace(/(\*\*|__|~~|`+)/g, '')
    .replace(/(^|\W)[*_](\S)/g, '$1$2').replace(/(\S)[*_](\W|$)/g, '$1$2')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Plain text for snippets, word counts and search. */
export function plainText(text) {
  const { body } = splitFrontMatter(text);
  return body
    .replace(/^\s{0,3}(```|~~~).*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
    .split('\n').map(plainInline).join('\n');
}

export function wordCount(text) {
  const t = plainText(text).trim();
  if (!t) return 0;
  return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** All ==highlights== in a note, outside code. */
export function scanHighlights(text) {
  const { body, offset } = splitFrontMatter(text);
  const out = [];
  const re = new RegExp(`==(?:(${COLOR_RE}):)?(?=\\S)(.*?\\S)==(?!=)`, 'g');
  eachProseLine(body, offset, (line, start) => {
    const masked = line.replace(/(`+)(.+?)\1(?!`)/g, (s) => ' '.repeat(s.length));
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(masked))) {
      out.push({ color: m[1] || 'yellow', text: plainInline(line.slice(m.index + m[0].length - m[2].length - 2, m.index + m[0].length - 2)), offset: start + m.index, length: m[0].length });
    }
  });
  return out;
}

export function findMatches(text, q, limit = 5000) {
  const out = [];
  if (!q) return out;
  const hay = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = hay.indexOf(needle);
  while (i >= 0 && out.length < limit) { out.push([i, i + needle.length]); i = hay.indexOf(needle, i + needle.length); }
  return out;
}

// ---------- Source colouring for the editor backdrop ----------
const INLINE_SRC = `(\`+)(.+?)\\1(?!\`)|==(?:(${COLOR_RE}):)?(?=\\S)(.*?\\S)==(?!=)|(\\*\\*|__)(?=\\S)(.+?\\S)\\5|~~(?=\\S)(.+?\\S)~~|(\\*|_)(?=[^\\s*_])(.+?[^\\s\\\\])\\8(?![*\\w])|(!?)\\[([^\\]\\n]*)\\]\\(([^)\\n]*)\\)|(https?:\\/\\/[^\\s<>)\\]]+)`;

function join(a, b) { return a ? (b ? a + ' ' + b : a) : b; }

function inline(line, from, to, base, segs, pipes) {
  const re = new RegExp(INLINE_SRC, 'g');
  const src = line.slice(0, to);
  let last = from;
  const gap = (a, b) => {
    if (b <= a) return;
    if (pipes) {
      let s = a;
      for (let k = a; k < b; k++) {
        if (line[k] === '|' && line[k - 1] !== '\\') { if (k > s && base) segs.push({ s, e: k, c: base }); segs.push({ s: k, e: k + 1, c: 't-mk' }); s = k + 1; }
      }
      if (b > s && base) segs.push({ s, e: b, c: base });
    } else if (base) segs.push({ s: a, e: b, c: base });
  };
  re.lastIndex = from;
  let m;
  while ((m = re.exec(src))) {
    const s = m.index;
    if (m[8] === '_' && /\w/.test(line[s - 1] || '')) { re.lastIndex = s + 1; continue; }
    gap(last, s);
    const e = s + m[0].length;
    if (m[1] !== undefined) {
      const t = m[1].length;
      segs.push({ s, e: s + t, c: join(base, 't-mk') }, { s: s + t, e: e - t, c: join(base, 't-code') }, { s: e - t, e, c: join(base, 't-mk') });
    } else if (m[4] !== undefined) {
      const c = `hl-${m[3] || 'yellow'}`;
      const open = 2 + (m[3] ? m[3].length + 1 : 0);
      segs.push({ s, e: s + open, c: join(base, `t-mk hm ${c}`) });
      inline(line, s + open, e - 2, join(base, c), segs, false);
      segs.push({ s: e - 2, e, c: join(base, `t-mk hm ${c}`) });
    } else if (m[6] !== undefined) {
      segs.push({ s, e: s + 2, c: join(base, 't-mk') });
      inline(line, s + 2, e - 2, join(base, 't-b'), segs, false);
      segs.push({ s: e - 2, e, c: join(base, 't-mk') });
    } else if (m[7] !== undefined) {
      segs.push({ s, e: s + 2, c: join(base, 't-mk') });
      inline(line, s + 2, e - 2, join(base, 't-s'), segs, false);
      segs.push({ s: e - 2, e, c: join(base, 't-mk') });
    } else if (m[9] !== undefined) {
      segs.push({ s, e: s + 1, c: join(base, 't-mk') });
      inline(line, s + 1, e - 1, join(base, 't-i'), segs, false);
      segs.push({ s: e - 1, e, c: join(base, 't-mk') });
    } else if (m[11] !== undefined) {
      const open = 1 + m[10].length;
      const textEnd = s + open + m[11].length;
      segs.push({ s, e: s + open, c: join(base, 't-mk') });
      inline(line, s + open, textEnd, join(base, 't-link'), segs, false);
      segs.push({ s: textEnd, e: textEnd + 2, c: join(base, 't-mk') }, { s: textEnd + 2, e: e - 1, c: join(base, 't-url') }, { s: e - 1, e, c: join(base, 't-mk') });
    } else if (m[13] !== undefined) {
      segs.push({ s, e, c: join(base, 't-link') });
    }
    last = e;
  }
  gap(last, to);
}

function blockLine(line) {
  const segs = [];
  let m;
  if ((m = /^(\s{0,3})(#{1,6})(?=\s|$)\s*/.exec(line))) {
    segs.push({ s: 0, e: m[0].length, c: 't-mk' });
    inline(line, m[0].length, line.length, 't-h', segs, false);
    return segs;
  }
  if (/^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line) || /^\s{0,3}=+\s*$/.test(line)) return [{ s: 0, e: line.length, c: 't-mk' }];
  let start = 0;
  let base = '';
  if ((m = /^(?:\s{0,3}>\s?)+/.exec(line))) { segs.push({ s: 0, e: m[0].length, c: 't-mk' }); start = m[0].length; base = 't-q'; }
  const rest = line.slice(start);
  if ((m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[([ xX])\](?=\s|$)\s*)?/.exec(rest))) {
    segs.push({ s: start + m[1].length, e: start + m[0].length, c: 't-mk' });
    if (m[5] && m[5] !== ' ') base = join(base, 't-done');
    start += m[0].length;
  }
  if (/^\s*\|/.test(line)) {
    if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)) { segs.push({ s: start, e: line.length, c: 't-mk' }); return segs; }
    inline(line, start, line.length, base, segs, true);
    return segs;
  }
  inline(line, start, line.length, base, segs, false);
  return segs;
}

function emit(line, segs, finds) {
  if (!line.length) return '';
  if (!segs.length && !finds.length) return escapeHtml(line);
  const cuts = new Set([0, line.length]);
  for (const g of segs) { cuts.add(g.s); cuts.add(g.e); }
  for (const f of finds) { cuts.add(f.s); cuts.add(f.e); }
  const pts = [...cuts].filter((x) => x >= 0 && x <= line.length).sort((a, b) => a - b);
  let out = '';
  let si = 0;
  const sorted = segs.slice().sort((a, b) => a.s - b.s || b.e - a.e);
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    if (b <= a) continue;
    let cls = '';
    // innermost (latest-starting) segment covering [a,b)
    for (let j = 0; j < sorted.length; j++) { const g = sorted[j]; if (g.s <= a && g.e >= b) cls = g.c; else if (g.s > a) break; }
    for (const f of finds) if (f.s <= a && f.e >= b) cls = join(cls, f.cur ? 'fc' : 'f');
    const txt = escapeHtml(line.slice(a, b));
    out += cls ? `<span class="${cls}">${txt}</span>` : txt;
  }
  void si;
  return out;
}

/**
 * Colour Markdown source for the editor backdrop.
 * finds: sorted [[start,end],...] absolute offsets; cur: index of the current match.
 */
export function colorSource(text, finds = [], cur = -1) {
  const lines = text.split('\n');
  const out = new Array(lines.length);
  let fmEnd = -1;
  if (/^---[ \t]*$/.test(lines[0] || '')) {
    for (let k = 1; k < lines.length; k++) if (/^(---|\.\.\.)[ \t]*$/.test(lines[k])) { fmEnd = k; break; }
  }
  let fence = null;
  let pos = 0;
  let fi = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let segs;
    if (fmEnd > 0 && li <= fmEnd) {
      segs = [{ s: 0, e: line.length, c: li === 0 || li === fmEnd ? 't-mk' : 't-fm' }];
    } else if (fence) {
      if (fenceCloses(line, fence)) { segs = [{ s: 0, e: line.length, c: 't-fence' }]; fence = null; }
      else if (fence.lang) { const r = codeLine(line, fence.lang, fence.state); fence.state = { inBlock: r.inBlock }; segs = r.segs; }
      else segs = [];
    } else {
      const f = FENCE_OPEN.exec(line);
      if (f && !(f[2][0] === '`' && line.slice(f[0].length).includes('`'))) {
        fence = { ch: f[2][0], len: f[2].length, lang: editorLang(f[3]), state: { inBlock: false } };
        segs = [{ s: 0, e: line.length, c: 't-fence' }];
      } else segs = blockLine(line);
    }
    const lineEnd = pos + line.length;
    const lf = [];
    if (finds.length) {
      while (fi < finds.length && finds[fi][1] <= pos) fi++;
      for (let k = fi; k < finds.length && finds[k][0] < lineEnd; k++) {
        lf.push({ s: Math.max(finds[k][0], pos) - pos, e: Math.min(finds[k][1], lineEnd) - pos, cur: k === cur });
      }
    }
    out[li] = emit(line, segs, lf);
    pos = lineEnd + 1;
  }
  return out.join('\n');
}
