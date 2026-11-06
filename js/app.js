// Margin — app controller.
import * as store from './store.js';
import { render, colorSource, scanHighlights, findMatches, plainText, plainInline, wordCount, splitFrontMatter, escapeHtml, COLORS } from './md.js';
import { makeZip, readZip } from './zip.js';
import { WELCOME } from './welcome.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const app = $('app');
const noteEl = $('note');
const ta = $('editor');
const editorWrap = $('editorWrap');
const backdrop = $('backdrop');
const bdInner = $('bdInner');
const preview = $('preview');
const readPane = $('readPane');
const nameInput = $('nameInput');
const findInput = $('findInput');
const sheet = $('sheet');
const sheetBody = $('sheetBody');

const wideMQ = matchMedia('(min-width: 900px)');
const isWide = () => wideMQ.matches;
const canPickSave = 'showSaveFilePicker' in window;
const MD_RE = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext)$/i;
const SNAP_EVERY = 5 * 60 * 1000;
const BIG_DOC = 250000;

// ---------- State ----------
const S = {
  notes: [],
  cur: null,
  handles: new Map(),
  cache: new Map(),
  query: '',
  sort: lsGet('sort', 'updated'),
  tab: 'notes',
  hlFilter: 'all',
  mode: lsGet('mode', 'split'),
  view: 'edit',
  outlineOpen: lsGet('outline', '1') === '1',
  focus: false,
  hlColor: lsGet('hlColor', 'yellow'),
  find: { open: false, q: '', matches: [], pv: [], idx: 0, where: 'source' },
  snapAt: 0,
  lastSel: { s: 0, e: 0 },
  rendered: null,
  headings: [],
  conflictSeen: new Map(),
};
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });

// ---------- Utils ----------
function lsGet(k, d) { try { const v = localStorage.getItem('margin.' + k); return v === null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem('margin.' + k, v); } catch { /* storage blocked */ } }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + ':' + s.length; }
function normalizeText(t) { if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1); return t.replace(/\r\n?/g, '\n'); }
function sanitizeName(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120); }
function fileName(n) { return (n.name || 'Untitled') + (n.ext || '.md'); }
function toFileText(n) { return n.eol === '\r\n' ? n.content.replace(/\n/g, '\r\n') : n.content; }
function noteById(id) { return S.notes.find((n) => n.id === id) || null; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const yearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function fmtDate(ts) {
  const d = new Date(ts); const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : yearFmt.format(d);
}
function fmtSize(b) { return b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`; }
function plural(n, one, many) { return `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`; }

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
const ICONS = {
  pin: '<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>',
  save: '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  focus: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  text: '<path d="M4 7V5h11v2M9.5 5v14M7 19h5M14 13v-2h7v2M17.5 11v8M16 19h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  highlight: '<path d="M15 4l5 5-9 9H6v-5z"/><path d="M4 21h16"/>',
  eraser: '<path d="M7 21h10M5 15l9-9 5 5-7 7H8z"/>',
  outline: '<path d="M4 6h16M8 12h12M8 18h12"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }

// ---------- Toast ----------
let toastTimer = 0;
function toast(msg, action, ms = 3500) {
  $('toastMsg').textContent = msg;
  const act = $('toastAct');
  if (action) { act.textContent = action.label; act.hidden = false; act.onclick = () => { hideToast(); action.run(); }; }
  else act.hidden = true;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? Math.max(ms, 7000) : ms);
}
function hideToast() { $('toast').hidden = true; }

// ---------- Notes ----------
function makeNote({ name, content = '', ext = '.md', eol = '\n', autoName = false } = {}) {
  const now = Date.now();
  return { id: uid(), name: sanitizeName(name || '') || 'Untitled', ext, content, eol, created: now, updated: now, pinned: false, autoName, disk: null };
}

function titleFromContent(c) {
  const { body } = splitFrontMatter(c);
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(body);
  const raw = m ? m[1] : (body.split('\n').map((l) => l.trim()).find(Boolean) || '');
  return sanitizeName(plainInline(raw.replace(/^([-*+>]|\d+[.)])\s+/, ''))).slice(0, 70);
}

function info(n) {
  const key = n.updated + ':' + n.content.length;
  let c = S.cache.get(n.id);
  if (!c || c.key !== key) {
    const plain = plainText(n.content);
    c = { key, plain, lower: n.content.toLowerCase(), hl: scanHighlights(n.content), words: wordCount(n.content) };
    S.cache.set(n.id, c);
  }
  return c;
}

const pending = new Set();
let saveTimer = 0;
function markDirty(n) {
  n.updated = Date.now();
  pending.add(n.id);
  setStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 400);
}
async function flushSaves() {
  clearTimeout(saveTimer);
  const ids = [...pending];
  pending.clear();
  for (const id of ids) {
    const n = noteById(id);
    if (!n) continue;
    try { await store.putNote(n); }
    catch (e) { toast(`Couldn't save ${fileName(n)}: ${e.message || e}`); }
  }
  setStatus();
  scheduleLibrary();
}
async function snapshot(n, content, reason) {
  if (!content || !content.trim()) return;
  try { await store.addVersion({ noteId: n.id, name: n.name, content, reason }); } catch { /* best effort */ }
}
let persistAsked = false;
function requestPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* ignore */ }
}

// ---------- Viewport (keeps the toolbar above the phone keyboard) ----------
function fitViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  root.style.setProperty('--vvh', vv.height + 'px');
  root.style.setProperty('--vvt', vv.offsetTop + 'px');
  app.classList.toggle('kb', !isWide() && window.innerHeight - vv.height > 140);
  syncBackdrop();
}

// ---------- Library ----------
function sortedNotes() {
  const q = S.query.trim().toLowerCase();
  let list = S.notes.slice();
  if (q) list = list.filter((n) => n.name.toLowerCase().includes(q) || info(n).lower.includes(q));
  const by = S.sort;
  list.sort((a, b) => by === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : by === 'created' ? b.created - a.created : b.updated - a.updated);
  return list;
}

function markQuery(text, q) {
  if (!q) return escapeHtml(text);
  const lower = text.toLowerCase();
  let out = ''; let last = 0; let i = lower.indexOf(q);
  while (i >= 0) { out += escapeHtml(text.slice(last, i)) + `<mark class="q">${escapeHtml(text.slice(i, i + q.length))}</mark>`; last = i + q.length; i = lower.indexOf(q, last); }
  return out + escapeHtml(text.slice(last));
}

function snippet(n, q) {
  const c = info(n);
  const lines = c.plain.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines[0] === n.name) lines.shift();
  const flat = lines.join(' ');
  if (q) {
    const i = flat.toLowerCase().indexOf(q);
    if (i > 50) return '…' + flat.slice(i - 40, i + 140);
  }
  return flat.slice(0, 180) || 'Empty note';
}

function noteItem(n, q) {
  const c = info(n);
  const tags = [];
  if (c.hl.length) tags.push(`<span class="t-hl">${icon('highlight')}${plural(c.hl.length, 'highlight')}</span>`);
  if (n.disk) tags.push(`<span>${icon('link')}${escapeHtml(n.disk.fileName)}</span>`);
  return `<li><button type="button" class="note-item" data-id="${n.id}" aria-current="${!!(S.cur && S.cur.id === n.id)}">
    <span class="ni-top"><span class="ni-title">${markQuery(n.name, q)}</span><span class="ni-date">${fmtDate(n.updated)}</span></span>
    <span class="ni-snip">${markQuery(snippet(n, q), q)}</span>
    ${tags.length ? `<span class="ni-tags">${tags.join('')}</span>` : ''}
  </button></li>`;
}

function renderLibrary() {
  const q = S.query.trim().toLowerCase();
  const list = sortedNotes();
  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);
  let html = '';
  if (pinned.length) {
    html += `<li class="group-label">${icon('pin')}Pinned</li>` + pinned.map((n) => noteItem(n, q)).join('');
    if (rest.length) html += `<li class="group-label">All notes</li>`;
  }
  html += rest.map((n) => noteItem(n, q)).join('');
  $('noteList').innerHTML = html;
  const where = store.persistent ? 'saved on this device' : 'not saved: storage blocked';
  $('libMeta').textContent = q ? `${list.length} of ${plural(S.notes.length, 'note')} match` : `${plural(S.notes.length, 'note')} · ${where}`;
  const empty = $('libEmpty');
  if (!list.length) {
    empty.hidden = false;
    empty.innerHTML = q
      ? `<p><strong>No notes match “${escapeHtml(S.query.trim())}”.</strong></p><p>Try another word, or clear the search.</p>`
      : `<p><strong>No notes yet.</strong></p><p>Tap <b>New note</b> to start writing, or <b>Upload .md</b> to bring in Markdown files.</p>`;
  } else empty.hidden = true;
  const total = S.notes.reduce((s, n) => s + info(n).hl.length, 0);
  $('hlBadge').textContent = total ? String(total) : '';
  if (S.tab === 'highlights') renderHighlights();
}
const scheduleLibrary = debounce(renderLibrary, 250);

function setTab(tab) {
  S.tab = tab;
  const notes = tab === 'notes';
  $('tabNotes').setAttribute('aria-selected', String(notes));
  $('tabHighlights').setAttribute('aria-selected', String(!notes));
  $('tabNotes').tabIndex = notes ? 0 : -1;
  $('tabHighlights').tabIndex = notes ? -1 : 0;
  $('notesPanel').hidden = !notes;
  $('hlPanel').hidden = notes;
  if (!notes) renderHighlights();
}

function renderHighlights() {
  const groups = S.notes.map((n) => ({ n, items: info(n).hl.map((x, i) => ({ ...x, i })) }))
    .filter((g) => g.items.length).sort((a, b) => b.n.updated - a.n.updated);
  const counts = { all: 0, yellow: 0, green: 0, pink: 0, blue: 0 };
  for (const g of groups) for (const x of g.items) { counts.all++; counts[x.color]++; }
  const filters = $('hlFilters');
  filters.replaceChildren(...['all', ...COLORS].map((c) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(S.hlFilter === c), disabled: c !== 'all' && !counts[c] ? true : null,
    onclick: () => { S.hlFilter = c; renderHighlights(); },
  }, c === 'all' ? null : h('span', { class: `swatch sw-${c}`, 'aria-hidden': 'true' }), `${c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)} ${counts[c]}`)));
  const list = $('hlList');
  list.replaceChildren();
  let shown = 0;
  for (const g of groups) {
    const items = g.items.filter((x) => S.hlFilter === 'all' || x.color === S.hlFilter);
    if (!items.length) continue;
    shown += items.length;
    list.append(h('section', { class: 'hl-group' },
      h('h3', null, h('span', null, g.n.name), h('span', null, plural(items.length, 'highlight'))),
      items.map((x) => h('button', { type: 'button', class: 'hl-item', onclick: () => jumpToHighlight(g.n.id, x) },
        h('span', { class: `swatch sw-${x.color}`, 'aria-hidden': 'true' }),
        h('span', null, h('mark', { class: `hl-${x.color}` }, x.text))))));
  }
  $('hlEmpty').hidden = shown > 0;
}

async function jumpToHighlight(id, x) {
  const mode = isWide() ? (S.mode === 'edit' ? 'split' : S.mode) : 'read';
  await openNote(id, { mode });
  renderPreview();
  const marks = [...preview.querySelectorAll('mark')];
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const same = info(S.cur).hl.slice(0, x.i).filter((o) => norm(o.text) === norm(x.text)).length;
  const target = marks.filter((m) => norm(m.textContent) === norm(x.text))[same] || marks[x.i];
  if (target) {
    target.scrollIntoView({ block: 'center' });
    target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
  }
  if (S.view !== 'read') scrollEditorTo(x.offset, x.offset + x.length);
}

// ---------- Open / close ----------
function snapshotOnLeave() {
  const n = S.cur;
  if (n && S.snapAt && S.leaveHash !== hash(n.content)) { S.leaveHash = hash(n.content); snapshot(n, n.content, 'When you left the note'); }
}

async function openNote(id, opts = {}) {
  if (S.cur && S.cur.id !== id) { snapshotOnLeave(); await flushSaves(); }
  S.leaveHash = '';
  const n = noteById(id);
  if (!n) return;
  S.cur = n;
  S.snapAt = 0;
  closeMenus();
  $('wsEmpty').hidden = true;
  noteEl.hidden = false;
  nameInput.value = n.name;
  $('extLabel').textContent = n.ext || '.md';
  $('pinMark').hidden = !n.pinned;
  ta.value = n.content;
  S.lastSel = { s: 0, e: 0 };
  if (opts.mode) S.mode = opts.mode;
  else if (!isWide()) S.mode = n.content.trim() ? 'read' : 'edit';
  app.dataset.screen = 'note';
  applyMode();
  ta.scrollTop = 0;
  readPane.scrollTop = 0;
  renderBackdrop();
  renderPreview();
  updateStats();
  setStatus();
  updateFileButtons();
  if (S.find.open) recomputeFind(false);
  if (!isWide() && opts.push !== false && !(history.state && history.state.note)) history.pushState({ note: id }, '');
  renderLibrary();
  lsSet('last', id);
  if (opts.focus && S.view !== 'read') { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  checkDisk();
}

async function closeNote() {
  snapshotOnLeave();
  await flushSaves();
  if (S.focus) setFocus(false);
  if (history.state && history.state.note) { history.back(); return; }
  showLibrary();
}
function showLibrary() {
  app.dataset.screen = 'library';
  if (!isWide()) { ta.blur(); }
  renderLibrary();
}

async function newNote(content = '') {
  const n = makeNote({ content, autoName: true });
  S.notes.push(n);
  await store.putNote(n);
  requestPersist();
  await openNote(n.id, { mode: isWide() ? (S.mode === 'read' ? 'split' : S.mode) : 'edit', focus: true });
}

// ---------- Modes ----------
function effectiveView() {
  if (S.focus) return 'edit';
  if (!isWide() && S.mode === 'split') return 'edit';
  return S.mode;
}
function applyMode() {
  const v = effectiveView();
  S.view = v;
  noteEl.dataset.view = v;
  const shown = isWide() ? S.mode : v;
  for (const b of $('modeSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === shown));
  $('outline').hidden = !(isWide() && S.outlineOpen && !S.focus);
  $('outlineBtn').setAttribute('aria-pressed', String(isWide() && S.outlineOpen));
  if (v !== 'edit') renderPreview();
  if (v !== 'read') requestAnimationFrame(() => { renderBackdrop(); });
  if (S.find.open) recomputeFind(false);
}
function setMode(m) {
  S.mode = m;
  if (isWide()) lsSet('mode', m);
  applyMode();
}

// ---------- Editor ----------
let bdRaf = 0;
function scheduleBackdrop() { if (!bdRaf) bdRaf = requestAnimationFrame(() => { bdRaf = 0; renderBackdrop(); }); }
function renderBackdrop() {
  if (!S.cur) return;
  const text = ta.value;
  const big = text.length > BIG_DOC;
  editorWrap.classList.toggle('plain', big);
  if (big) { bdInner.textContent = ''; return; }
  const finds = S.find.open && S.find.where === 'source' ? S.find.matches : [];
  bdInner.innerHTML = colorSource(text, finds, S.find.idx) + '\n ';
  syncBackdrop();
}
function syncBackdrop() {
  const sb = ta.offsetWidth - ta.clientWidth;
  backdrop.style.right = (sb > 0 ? sb : 0) + 'px';
  bdInner.style.transform = `translate3d(${-ta.scrollLeft}px, ${-ta.scrollTop}px, 0)`;
}

function onEditorInput() {
  const n = S.cur;
  if (!n) return;
  const prev = n.content;
  const val = ta.value;
  if (val === prev) return;
  const now = Date.now();
  if (!S.snapAt || now - S.snapAt > SNAP_EVERY) {
    const first = !S.snapAt;
    S.snapAt = now;
    snapshot(n, prev, first ? 'Before editing' : 'While editing');
  }
  n.content = val;
  if (n.autoName) {
    const t = titleFromContent(val) || 'Untitled';
    if (t !== n.name) { n.name = t; if (document.activeElement !== nameInput) nameInput.value = t; }
  }
  markDirty(n);
  scheduleBackdrop();
  schedulePreview();
  scheduleStats();
  if (S.find.open) recomputeFindSoon();
}

function getSel() {
  if (document.activeElement === ta) return { s: ta.selectionStart, e: ta.selectionEnd };
  return { s: Math.min(S.lastSel.s, ta.value.length), e: Math.min(S.lastSel.e, ta.value.length) };
}
function replaceRange(s, e, text, selS, selE) {
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(s, e);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok || ta.value.slice(s, s + text.length) !== text) ta.setRangeText(text, s, e, 'end');
  if (selS != null) ta.setSelectionRange(selS, selE == null ? selS : selE);
  S.lastSel = { s: ta.selectionStart, e: ta.selectionEnd };
  onEditorInput();
}
function lineBounds(v, s, e = s) {
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
  if (le < 0) le = v.length;
  return { ls, le };
}
function wordAt(v, i) {
  let a = i, b = i;
  while (a > 0 && /[\p{L}\p{N}_'-]/u.test(v[a - 1])) a--;
  while (b < v.length && /[\p{L}\p{N}_'-]/u.test(v[b])) b++;
  return { s: a, e: b };
}

function wrapCmd(open, close = open, placeholder = 'text') {
  const v = ta.value;
  let { s, e } = getSel();
  if (s === e) { const w = wordAt(v, s); if (w.e > w.s) { s = w.s; e = w.e; } }
  const before = v.slice(Math.max(0, s - open.length), s);
  const after = v.slice(e, e + close.length);
  if (before === open && after === close) { // toggle off
    replaceRange(s - open.length, e + close.length, v.slice(s, e), s - open.length, e - open.length);
    return;
  }
  const inner = s === e ? placeholder : v.slice(s, e);
  replaceRange(s, e, open + inner + close, s + open.length, s + open.length + inner.length);
}

const HL_OPEN_RE = /==(?:(yellow|green|pink|blue):)?$/;
function highlightCmd(color = S.hlColor) {
  const v = ta.value;
  let { s, e } = getSel();
  // already inside a highlight? recolour or remove it
  const around = markAround(v, s, e);
  if (around) {
    if (around.color === color) { removeHighlightAt(around); return; }
    const open = color === 'yellow' ? '==' : `==${color}:`;
    replaceRange(around.s, around.innerS, open, around.s + open.length + (s - around.innerS), around.s + open.length + (e - around.innerS));
    return;
  }
  if (s === e) { const w = wordAt(v, s); if (w.e > w.s) { s = w.s; e = w.e; } }
  // trim whitespace from the selection edges
  while (s < e && /\s/.test(v[s])) s++;
  while (e > s && /\s/.test(v[e - 1])) e--;
  const open = color === 'yellow' ? '==' : `==${color}:`;
  if (s === e) { replaceRange(s, e, open + 'highlighted text==', s + open.length, s + open.length + 16); return; }
  const text = v.slice(s, e);
  if (text.includes('\n')) {
    // highlight each line separately so paragraphs stay valid Markdown
    let out = ''; let pos = s;
    for (const part of text.split('\n')) {
      const m = /^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*|#{1,6}\s+)?)(.*?)(\s*)$/.exec(part);
      out += (m[2] ? m[1] + open + m[2] + '==' + m[3] : part) + '\n';
      pos += part.length + 1;
    }
    out = out.slice(0, -1);
    replaceRange(s, e, out, s, s + out.length);
    return;
  }
  replaceRange(s, e, open + text + '==', s + open.length, e + open.length);
}
function markAround(v, s, e) {
  const { ls, le } = lineBounds(v, s, e);
  const line = v.slice(ls, le);
  const re = /==(?:(yellow|green|pink|blue):)?(?=\S)(.*?\S)==(?!=)/g;
  let m;
  while ((m = re.exec(line))) {
    const ms = ls + m.index; const me = ms + m[0].length;
    const innerS = ms + m[0].length - m[2].length - 2; const innerE = me - 2;
    if (s >= ms && e <= me && s <= innerE && e >= innerS) return { s: ms, e: me, innerS, innerE, color: m[1] || 'yellow' };
  }
  return null;
}
function removeHighlightAt(m) {
  const inner = ta.value.slice(m.innerS, m.innerE);
  replaceRange(m.s, m.e, inner, m.s, m.s + inner.length);
}
function removeHighlightCmd() {
  const { s, e } = getSel();
  const m = markAround(ta.value, s, e);
  if (m) removeHighlightAt(m); else toast('Put the cursor inside a highlight to remove it.');
}

const PREFIX = {
  ul: { re: /^(\s*)[-*+]\s+(?!\[[ xX]\]\s)/, make: () => '- ' },
  task: { re: /^(\s*)[-*+]\s+\[[ xX]\]\s+/, make: () => '- [ ] ' },
  ol: { re: /^(\s*)\d{1,9}[.)]\s+/, make: (i) => `${i + 1}. ` },
  quote: { re: /^(\s*)>\s?/, make: () => '> ' },
};
const ANY_LIST = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+|>\s?)/;
function prefixCmd(kind) {
  const v = ta.value;
  const { s, e } = getSel();
  const { ls, le } = lineBounds(v, s, e);
  const lines = v.slice(ls, le).split('\n');
  const p = PREFIX[kind];
  const all = lines.filter((l) => l.trim()).every((l) => p.re.test(l));
  let k = 0;
  const out = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    if (all) return l.replace(p.re, '$1');
    const m = ANY_LIST.exec(l);
    const indent = m ? m[1] : (/^\s*/.exec(l)[0]);
    const rest = m ? l.slice(m[0].length) : l.slice(indent.length);
    return indent + p.make(k++) + rest;
  }).join('\n');
  const caret = lines.length === 1 ? ls + out.length : null;
  replaceRange(ls, le, out, caret == null ? ls : caret, caret == null ? ls + out.length : caret);
}
function headingCmd() {
  const v = ta.value;
  const { s } = getSel();
  const { ls, le } = lineBounds(v, s);
  const line = v.slice(ls, le);
  const m = /^(#{1,6})\s+/.exec(line);
  const level = m ? m[1].length : 0;
  const next = level === 0 ? '# ' : level < 3 ? '#'.repeat(level + 1) + ' ' : '';
  const body = m ? line.slice(m[0].length) : line;
  const out = next + body;
  replaceRange(ls, le, out, ls + out.length);
}
function linkCmd() {
  const v = ta.value;
  const { s, e } = getSel();
  const text = v.slice(s, e);
  if (/^https?:\/\/\S+$/.test(text)) { replaceRange(s, e, `[](${text})`, s + 1); return; }
  const label = text || 'link text';
  const out = `[${label}](https://)`;
  replaceRange(s, e, out, s + label.length + 3, s + label.length + 11);
}
function codeCmd() {
  const v = ta.value;
  const { s, e } = getSel();
  const text = v.slice(s, e);
  const { ls, le } = lineBounds(v, s, e);
  const lineEmpty = !v.slice(ls, le).trim();
  if (text.includes('\n') || (s === e && lineEmpty)) {
    const pre = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
    const out = `${pre}\`\`\`\n${text || ''}\n\`\`\`\n`;
    const caret = s + pre.length + 3;
    replaceRange(s, e, out, caret, caret);
    return;
  }
  wrapCmd('`', '`', 'code');
}
function insertBlock(block) {
  const v = ta.value;
  const { e } = getSel();
  const { le } = lineBounds(v, e);
  const pre = le === 0 ? '' : (v.slice(0, le).endsWith('\n\n') ? '' : v.slice(0, le).endsWith('\n') ? '\n' : '\n\n');
  const out = pre + block + '\n';
  replaceRange(le, le, out, le + out.length);
}

function runCmd(cmd) {
  if (!S.cur) return;
  if (S.view === 'read') setMode(isWide() ? 'split' : 'edit');
  switch (cmd) {
    case 'bold': wrapCmd('**', '**', 'bold text'); break;
    case 'italic': wrapCmd('*', '*', 'italic text'); break;
    case 'strike': wrapCmd('~~', '~~', 'text'); break;
    case 'highlight': highlightCmd(); break;
    case 'heading': headingCmd(); break;
    case 'ul': case 'ol': case 'task': case 'quote': prefixCmd(cmd); break;
    case 'link': linkCmd(); break;
    case 'code': codeCmd(); break;
    case 'table': insertBlock('| Column | Column |\n| --- | --- |\n|  |  |'); break;
    case 'hr': insertBlock('---'); break;
    case 'undo': ta.focus(); try { document.execCommand('undo'); } catch { /* ignore */ } onEditorInput(); break;
    default: break;
  }
}

function onEditorKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'b' && !e.shiftKey) { e.preventDefault(); runCmd('bold'); return; }
    if (k === 'i' && !e.shiftKey) { e.preventDefault(); runCmd('italic'); return; }
    if (k === 'k' && !e.shiftKey) { e.preventDefault(); runCmd('link'); return; }
    if (k === 'h' && e.shiftKey) { e.preventDefault(); runCmd('highlight'); return; }
    if (k === 'x' && e.shiftKey) { e.preventDefault(); runCmd('strike'); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !mod && !e.isComposing && ta.selectionStart === ta.selectionEnd) {
    const v = ta.value; const s = ta.selectionStart;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', s); if (le < 0) le = v.length;
    const full = v.slice(ls, le);
    const toCaret = v.slice(ls, s);
    const m = /^(\s*)((?:>\s?)*)([-*+]|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(toCaret);
    if (m) {
      e.preventDefault();
      if (!full.slice(m[0].length).trim()) {
        // Enter on an empty item ends the list and leaves a blank line, so the next paragraph stands apart.
        const keep = m[2] ? m[1] + m[2].trimEnd() : '';
        const out = keep ? keep : '\n';
        replaceRange(ls, le, out, ls + out.length);
        return;
      }
      const marker = m[4] ? `${parseInt(m[4], 10) + 1}${m[5]}` : m[3];
      const ins = '\n' + m[1] + m[2] + marker + m[6] + (m[7] ? '[ ] ' : '');
      replaceRange(s, s, ins, s + ins.length);
      return;
    }
    const q = /^(\s*(?:>\s?)+)/.exec(toCaret);
    if (q) {
      e.preventDefault();
      if (!full.slice(q[0].length).trim()) { replaceRange(ls, le, '', ls); return; }
      const ins = '\n' + q[1];
      replaceRange(s, s, ins, s + ins.length);
      return;
    }
  }
  if (e.key === 'Tab' && !mod && !e.altKey) {
    const v = ta.value; const { s, e: end } = { s: ta.selectionStart, e: ta.selectionEnd };
    const { ls, le } = lineBounds(v, s, end);
    const block = v.slice(ls, le);
    if (!/^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(block)) return; // let Tab move focus outside lists
    e.preventDefault();
    const lines = block.split('\n');
    const out = lines.map((l) => e.shiftKey ? l.replace(/^ {1,2}|^\t/, '') : (l.trim() ? '  ' + l : l)).join('\n');
    replaceRange(ls, le, out, s === end ? Math.max(ls, s + (out.length - block.length)) : ls, s === end ? null : ls + out.length);
  }
}

// ---------- Preview ----------
let pvTimer = 0;
function schedulePreview() {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(renderPreview, S.cur && S.cur.content.length > 60000 ? 450 : 160);
}
function renderPreview() {
  clearTimeout(pvTimer);
  if (!S.cur) return;
  const r = render(S.cur.content);
  S.rendered = r;
  const keep = readPane.scrollTop;
  preview.innerHTML = r.html;
  const boxes = preview.querySelectorAll('input[type="checkbox"]');
  const map = boxes.length === r.tasks.length;
  boxes.forEach((b, i) => {
    const li = b.closest('li');
    if (map) { b.removeAttribute('disabled'); b.dataset.task = String(i); b.setAttribute('aria-label', 'Done'); }
    if (li && b.checked) li.classList.add('done');
  });
  readPane.scrollTop = keep;
  renderOutline(r.headings);
  if (S.find.open) applyPreviewFind();
}
function toggleTask(i) {
  const t = S.rendered && S.rendered.tasks[i];
  if (!t || !S.cur) return;
  const v = ta.value;
  const ch = v[t.offset];
  if (!/[ xX]/.test(ch)) { renderPreview(); return; }
  ta.setRangeText(ch === ' ' ? 'x' : ' ', t.offset, t.offset + 1, 'preserve');
  onEditorInput();
  renderPreview();
}

function renderOutline(heads) {
  S.headings = heads;
  const list = $('outlineList');
  list.innerHTML = heads.length
    ? heads.map((x, i) => `<li><button type="button" class="ol-item" data-i="${i}" data-level="${x.level}">${escapeHtml(x.text || 'Untitled heading')}</button></li>`).join('')
    : '<li class="outline-empty">Add headings with # to build an outline.</li>';
  trackActiveHeading();
}
function previewHeadings() { return preview.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6'); }
function jumpToHeading(i) {
  const x = S.headings[i];
  if (!x) return;
  if (S.view !== 'edit') { const hs = previewHeadings(); if (hs[i]) hs[i].scrollIntoView({ block: 'start' }); }
  if (S.view !== 'read') scrollEditorTo(x.offset, x.offset, S.view === 'edit');
}
let ahRaf = 0;
function trackActiveHeading() {
  if (ahRaf) return;
  ahRaf = requestAnimationFrame(() => {
    ahRaf = 0;
    const hs = previewHeadings();
    let active = -1;
    const top = readPane.getBoundingClientRect().top + 60;
    hs.forEach((el, i) => { if (el.getBoundingClientRect().top <= top) active = i; });
    $('outlineList').querySelectorAll('.ol-item').forEach((b, i) => b.classList.toggle('active', i === active));
  });
}

// Editor position helpers (measure through the backdrop, which mirrors the textarea)
function offsetY(off) {
  if (editorWrap.classList.contains('plain')) {
    const lines = ta.value.slice(0, off).split('\n').length - 1;
    return lines * parseFloat(getComputedStyle(ta).lineHeight || '24') + 18;
  }
  const walker = document.createTreeWalker(bdInner, NodeFilter.SHOW_TEXT);
  let node; let acc = 0; let last = null;
  const base = bdInner.getBoundingClientRect().top;
  const r = document.createRange();
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (acc + len > off) {
      const at = Math.max(0, off - acc);
      r.setStart(node, at); r.setEnd(node, Math.min(at + 1, len));
      const rect = r.getClientRects()[0] || r.getBoundingClientRect();
      return rect.top - base;
    }
    acc += len; last = node;
  }
  if (last) { r.selectNodeContents(last); const rects = r.getClientRects(); const rect = rects[rects.length - 1]; if (rect) return rect.top - base; }
  return 0;
}
function scrollEditorTo(s, e = s, focus = false) {
  const y = offsetY(s);
  ta.scrollTop = Math.max(0, y - ta.clientHeight * 0.3);
  syncBackdrop();
  if (focus && isWide()) { ta.focus({ preventScroll: true }); ta.setSelectionRange(s, e); ta.scrollTop = Math.max(0, y - ta.clientHeight * 0.3); syncBackdrop(); }
  S.lastSel = { s, e };
}

// Split view scroll sync
let syncing = '';
function onEditorScroll() {
  syncBackdrop();
  if (S.view !== 'split' || syncing === 'preview') return;
  syncing = 'editor';
  const r = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
  readPane.scrollTop = r * (readPane.scrollHeight - readPane.clientHeight);
  requestAnimationFrame(() => { requestAnimationFrame(() => { if (syncing === 'editor') syncing = ''; }); });
}
function onPreviewScroll() {
  trackActiveHeading();
  if (S.view !== 'split' || syncing === 'editor') return;
  syncing = 'preview';
  const r = readPane.scrollTop / Math.max(1, readPane.scrollHeight - readPane.clientHeight);
  ta.scrollTop = r * (ta.scrollHeight - ta.clientHeight);
  syncBackdrop();
  requestAnimationFrame(() => { requestAnimationFrame(() => { if (syncing === 'preview') syncing = ''; }); });
}

// Highlight straight from the Read view
const pvHl = h('button', { type: 'button', class: 'btn small primary', style: 'position:fixed;z-index:60', hidden: true }, h('span', { html: icon('highlight') }), 'Highlight');
document.body.append(pvHl);
function onSelectionChange() {
  if (document.activeElement === ta) { S.lastSel = { s: ta.selectionStart, e: ta.selectionEnd }; pvHl.hidden = true; return; }
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || S.view === 'edit' || !S.cur) { pvHl.hidden = true; return; }
  const range = sel.getRangeAt(0);
  if (!preview.contains(range.commonAncestorContainer)) { pvHl.hidden = true; return; }
  const text = sel.toString().trim();
  if (text.length < 2 || text.includes('\n')) { pvHl.hidden = true; return; }
  const rect = range.getBoundingClientRect();
  pvHl.hidden = false;
  const w = pvHl.offsetWidth || 120;
  pvHl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + 'px';
  const below = rect.bottom + 10;
  pvHl.style.top = (below + 40 < (window.visualViewport ? window.visualViewport.height : window.innerHeight) ? below : Math.max(8, rect.top - 50)) + 'px';
  pvHl.dataset.text = text;
  const all = preview.textContent;
  const startProbe = document.createRange();
  startProbe.setStart(preview, 0);
  startProbe.setEnd(range.startContainer, range.startOffset);
  pvHl.dataset.ratio = String(startProbe.toString().length / Math.max(1, all.length));
}
function highlightFromPreview() {
  const text = pvHl.dataset.text || '';
  const ratio = parseFloat(pvHl.dataset.ratio || '0');
  pvHl.hidden = true;
  const v = ta.value;
  const hits = findMatches(v, text, 200).filter(([s]) => !markAround(v, s, s + text.length));
  if (!hits.length) { toast('That selection crosses formatting. Switch to Edit to highlight it.'); return; }
  const target = ratio * v.length;
  hits.sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target));
  const [s, e] = hits[0];
  const open = S.hlColor === 'yellow' ? '==' : `==${S.hlColor}:`;
  const real = v.slice(s, e);
  ta.setRangeText(open + real + '==', s, e, 'preserve');
  onEditorInput();
  renderPreview();
  document.getSelection().removeAllRanges();
  toast('Highlighted', { label: 'Undo', run: () => { const cur = ta.value; if (cur.slice(s, s + open.length + real.length + 2) === open + real + '==') { ta.setRangeText(real, s, s + open.length + real.length + 2, 'preserve'); onEditorInput(); renderPreview(); } } });
}

// ---------- Find ----------
function openFind() {
  if (!S.cur) return;
  S.find.open = true;
  $('findBar').hidden = false;
  $('findBtn').setAttribute('aria-pressed', 'true');
  const { s, e } = getSel();
  const selText = ta.value.slice(s, e);
  if (selText && !selText.includes('\n') && selText.length < 80) findInput.value = selText;
  else if (!findInput.value) findInput.value = S.find.q;
  findInput.focus();
  findInput.select();
  recomputeFind(true);
}
function closeFind() {
  S.find.open = false;
  S.find.matches = [];
  $('findBar').hidden = true;
  $('findBtn').setAttribute('aria-pressed', 'false');
  clearPreviewFind();
  scheduleBackdrop();
}
function recomputeFind(scroll) {
  if (!S.cur) return;
  const q = findInput.value;
  S.find.q = q;
  S.find.where = S.view === 'read' ? 'preview' : 'source';
  S.find.matches = S.find.where === 'source' ? findMatches(ta.value, q) : [];
  applyPreviewFind();
  const count = findCount();
  if (S.find.idx >= count) S.find.idx = 0;
  if (scroll) goToMatch(); else { markCurrent(); scheduleBackdrop(); }
  updateFindCount();
}
const recomputeFindSoon = debounce(() => recomputeFind(false), 200);
function findCount() { return S.find.where === 'source' ? S.find.matches.length : S.find.pv.length; }
function updateFindCount() {
  const el = $('findCount');
  const n = findCount();
  el.classList.toggle('none', !!S.find.q && !n);
  el.textContent = !S.find.q ? '' : n ? `${S.find.idx + 1} of ${n.toLocaleString()}` : 'No matches';
}
function clearPreviewFind() {
  const spans = preview.querySelectorAll('span.f, span.fc');
  if (!spans.length) { S.find.pv = []; return; }
  spans.forEach((sp) => sp.replaceWith(document.createTextNode(sp.textContent)));
  preview.normalize();
  S.find.pv = [];
}
function applyPreviewFind() {
  clearPreviewFind();
  const q = (S.find.q || '').toLowerCase();
  if (!S.find.open || !q || S.view === 'edit') return;
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('figcaption, summary') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const t = node.nodeValue;
    const lower = t.toLowerCase();
    let i = lower.indexOf(q);
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (i >= 0) {
      frag.append(t.slice(last, i));
      const sp = document.createElement('span');
      sp.className = 'f';
      sp.textContent = t.slice(i, i + q.length);
      frag.append(sp);
      S.find.pv.push(sp);
      last = i + q.length;
      i = lower.indexOf(q, last);
    }
    frag.append(t.slice(last));
    node.replaceWith(frag);
  }
}
function markCurrent() {
  S.find.pv.forEach((sp, i) => { sp.className = i === S.find.idx && (S.find.where === 'preview' || S.find.pv.length === S.find.matches.length) ? 'fc' : 'f'; });
}
function goToMatch() {
  const n = findCount();
  markCurrent();
  scheduleBackdrop();
  updateFindCount();
  if (!n) return;
  if (S.find.where === 'source') {
    const [s, e] = S.find.matches[S.find.idx];
    requestAnimationFrame(() => {
      scrollEditorTo(s, e, false);
      if (S.view === 'split' && S.find.pv.length === S.find.matches.length) S.find.pv[S.find.idx].scrollIntoView({ block: 'center' });
    });
  } else {
    S.find.pv[S.find.idx].scrollIntoView({ block: 'center' });
  }
}
function stepFind(d) {
  const n = findCount();
  if (!n) return;
  S.find.idx = (S.find.idx + d + n) % n;
  goToMatch();
}

// ---------- Status & stats ----------
function setStatus() {
  const n = S.cur;
  const el = $('status');
  if (!n) { el.textContent = ''; return; }
  const ok = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.check}</svg>`;
  el.className = 'status';
  if (pending.has(n.id)) { el.textContent = 'Saving…'; return; }
  if (n.disk) {
    const dirty = hash(n.content) !== n.disk.hash;
    if (dirty) { el.classList.add('warn'); el.textContent = `Saved in Margin · changes not yet in ${n.disk.fileName}`; }
    else { el.classList.add('ok'); el.innerHTML = `${ok}Saved to ${escapeHtml(n.disk.fileName)}`; }
  } else { el.classList.add('ok'); el.innerHTML = `${ok}Saved`; }
  $('footRight').textContent = n.disk ? `Linked to ${n.disk.fileName}` : (store.persistent ? 'Markdown · works offline' : 'Storage blocked: download notes to keep them');
}
function updateStats() {
  const n = S.cur;
  if (!n) return;
  const words = wordCount(n.content);
  const mins = Math.max(1, Math.round(words / 230));
  $('stats').textContent = `${plural(words, 'word')} · ${plural(n.content.length, 'character')} · ${mins} min read`;
}
const scheduleStats = debounce(updateStats, 300);
function updateFileButtons() {
  const n = S.cur;
  const linked = n && S.handles.has(n.id);
  const canSave = canPickSave || linked;
  $('saveFileBtn').hidden = !canSave;
  $('downloadBtn').classList.toggle('primary', !canSave);
}

// ---------- Files: upload / import ----------
async function pickFiles() {
  if (window.showOpenFilePicker && isWide()) {
    try {
      const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Markdown files', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] } }] });
      const entries = await Promise.all(hs.map(async (hd) => ({ file: await hd.getFile(), handle: hd })));
      await importEntries(entries);
    } catch (e) { if (e && e.name !== 'AbortError') $('fileInput').click(); }
    return;
  }
  $('fileInput').click();
}

async function importEntries(entries, { fromBackup = false } = {}) {
  const results = [];
  for (const { file, handle } of entries) {
    const name = file.name;
    if (!MD_RE.test(name)) { results.push({ name, ok: false, why: 'Skipped: Margin only opens .md files', size: file.size }); continue; }
    if (file.size > 10 * 1024 * 1024) { results.push({ name, ok: false, why: 'Skipped: larger than 10 MB', size: file.size }); continue; }
    let raw;
    try { raw = await file.text(); } catch { results.push({ name, ok: false, why: 'Skipped: the file could not be read' }); continue; }
    const eol = /\r\n/.test(raw) ? '\r\n' : '\n';
    const text = normalizeText(raw);
    const m = MD_RE.exec(name);
    const base = sanitizeName(name.slice(0, m.index)) || 'Untitled';
    const ext = m[0].toLowerCase();

    let existing = null;
    if (handle) {
      for (const [id, hd] of S.handles) {
        try { if (hd && await hd.isSameEntry(handle)) { existing = noteById(id); break; } } catch { /* ignore */ }
      }
    }
    if (!existing) existing = S.notes.find((n) => n.name === base && n.content === text) || null;
    if (existing) {
      let state = 'Already in Margin';
      if (existing.content !== text) {
        const dirty = existing.disk && hash(existing.content) !== existing.disk.hash;
        if (!dirty) {
          await snapshot(existing, existing.content, 'Before reloading from file');
          existing.content = text; existing.updated = Date.now(); state = 'Updated from file';
          if (S.cur === existing) { ta.value = text; renderBackdrop(); renderPreview(); }
        } else state = 'Kept your unsaved edits';
      }
      if (handle) existing.disk = { fileName: name, lastModified: file.lastModified, hash: existing.content === text ? hash(text) : (existing.disk ? existing.disk.hash : hash(text)) };
      await store.putNote(existing);
      results.push({ name, ok: true, state, id: existing.id, size: file.size, words: wordCount(existing.content) });
      continue;
    }
    const n = makeNote({ name: base, ext, content: text, eol });
    if (fromBackup && file.lastModified) { n.updated = file.lastModified; n.created = file.lastModified; }
    if (handle) {
      n.disk = { fileName: name, lastModified: file.lastModified, hash: hash(text) };
      S.handles.set(n.id, handle);
      await store.setHandle(n.id, handle);
    }
    S.notes.push(n);
    await store.putNote(n);
    results.push({ name, ok: true, state: 'Added', id: n.id, size: file.size, words: wordCount(text) });
  }
  if (results.some((r) => r.ok)) requestPersist();
  renderLibrary();
  const good = results.filter((r) => r.ok);
  if (results.length === 1 && good.length === 1) {
    await openNote(good[0].id);
    toast(`${good[0].state === 'Added' ? 'Added' : good[0].state}: ${good[0].name}`);
  } else if (results.length) showUploadResults(results);
  return results;
}

function showUploadResults(results) {
  const good = results.filter((r) => r.ok);
  const okIcon = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.check}</svg>`;
  const list = h('ul', { class: 'file-list' }, results.map((r) => {
    const ext = (/\.([a-z0-9]+)$/i.exec(r.name) || [, 'file'])[1].slice(0, 4).toUpperCase();
    return h('li', { class: 'file-row' + (r.ok ? '' : ' bad') },
      h('span', { class: 'file-ico', 'aria-hidden': 'true' }, r.ok ? 'MD' : ext),
      h('span', { class: 'file-main' },
        h('span', { class: 'file-name' }, r.name),
        h('span', { class: 'file-sub' }, r.ok ? [r.size != null ? fmtSize(r.size) : null, r.words != null ? plural(r.words, 'word') : null].filter(Boolean).join(' · ') : r.why)),
      r.ok ? h('span', { class: 'file-state', html: okIcon + escapeHtml(r.state) }) : null);
  }));
  const actions = h('div', { class: 'sheet-actions' },
    h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Done'),
    good.length ? h('button', { type: 'button', class: 'btn primary', onclick: () => { closeSheet(); openNote(good[0].id); } }, good.length > 1 ? 'Open first file' : 'Open file') : null);
  const summary = h('p', null, good.length ? `${plural(good.length, 'file')} ready in your library.` : 'Nothing was added. Margin only opens Markdown (.md) files.');
  openSheet('Upload Markdown files', [summary, list, actions]);
}

// Drag & drop
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const items = [...e.dataTransfer.items].filter((i) => i.kind === 'file');
  const pairs = items.map((it) => ({ file: it.getAsFile(), hp: it.getAsFileSystemHandle ? it.getAsFileSystemHandle().catch(() => null) : null }));
  const entries = [];
  for (const p of pairs) {
    let handle = null;
    if (p.hp) { const hd = await p.hp; if (hd && hd.kind === 'file') handle = hd; }
    if (p.file) entries.push({ file: p.file, handle });
  }
  if (entries.length) importEntries(entries);
});

// Opened from the OS ("Open with Margin")
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    await ready;
    const entries = [];
    for (const hd of params.files) if (hd.kind === 'file') entries.push({ file: await hd.getFile(), handle: hd });
    importEntries(entries);
  });
}

// Shared into Margin (Android share sheet) — the service worker parks it in a cache.
async function handleInbox() {
  const url = new URL(location.href);
  if (!url.searchParams.has('inbox')) return;
  history.replaceState(null, '', url.pathname);
  if (!('caches' in window)) return;
  const cache = await caches.open('margin-inbox');
  const keys = await cache.keys();
  const entries = [];
  for (const k of keys) {
    try {
      const data = await (await cache.match(k)).json();
      for (const f of data.files || []) entries.push({ file: new File([f.text], f.name, { type: 'text/markdown', lastModified: f.lastModified || Date.now() }) });
      for (const f of data.skipped || []) entries.push({ file: new File([''], f, { type: 'application/octet-stream' }) });
      const shared = [data.title, data.text, data.url].filter(Boolean).join('\n\n').trim();
      if (!(data.files || []).length && shared) {
        const n = makeNote({ content: shared, autoName: true });
        n.name = titleFromContent(shared) || 'Shared note';
        S.notes.push(n);
        await store.putNote(n);
        entries.length || await openNote(n.id);
      }
    } catch { /* ignore broken entries */ }
    await cache.delete(k);
  }
  if (entries.length) await importEntries(entries);
}

// ---------- Save / download / share ----------
function download(n = S.cur) {
  if (!n) return;
  const blob = new Blob([toFileText(n)], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(n);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Downloaded ${fileName(n)}`);
}
async function share(n = S.cur) {
  if (!n) return;
  try {
    for (const type of ['text/markdown', 'text/plain']) {
      const file = new File([toFileText(n)], fileName(n), { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: fileName(n) }); return; }
    }
    if (navigator.share) { await navigator.share({ title: fileName(n), text: n.content }); return; }
    download(n);
  } catch (e) { if (e && e.name !== 'AbortError') toast('Sharing didn’t work here. Use Download .md instead.'); }
}
async function ensurePerm(hd) {
  const opts = { mode: 'readwrite' };
  try {
    if (hd.queryPermission && (await hd.queryPermission(opts)) === 'granted') return true;
    if (hd.requestPermission) return (await hd.requestPermission(opts)) === 'granted';
  } catch { return false; }
  return true;
}
async function saveToFile() {
  const n = S.cur;
  if (!n) return;
  await flushSaves();
  let hd = S.handles.get(n.id);
  try {
    if (hd) {
      if (!(await ensurePerm(hd))) { toast('Margin needs your permission to write to this file.'); return; }
      const f = await hd.getFile();
      if (n.disk && f.lastModified > n.disk.lastModified + 1000) {
        const diskText = normalizeText(await f.text());
        if (hash(diskText) !== n.disk.hash && diskText !== n.content) { conflictSheet(n, hd, f, diskText); return; }
      }
      await writeFile(n, hd);
      return;
    }
    if (canPickSave) {
      hd = await window.showSaveFilePicker({ suggestedName: fileName(n), types: [{ description: 'Markdown file', accept: { 'text/markdown': ['.md', '.markdown'] } }] });
      S.handles.set(n.id, hd);
      await store.setHandle(n.id, hd);
      await writeFile(n, hd);
      return;
    }
    download(n);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast(`Couldn’t save the file: ${(e && (e.message || e.name)) || 'unknown error'}`);
  }
}
async function writeFile(n, hd) {
  const w = await hd.createWritable();
  await w.write(toFileText(n));
  await w.close();
  const f = await hd.getFile();
  n.disk = { fileName: hd.name, lastModified: f.lastModified, hash: hash(n.content) };
  await store.putNote(n);
  setStatus();
  updateFileButtons();
  scheduleLibrary();
  toast(`Saved to ${hd.name}`);
}
function applyExternal(n, text, lastModified) {
  n.content = text;
  n.updated = Date.now();
  n.disk = { ...(n.disk || {}), lastModified, hash: hash(text) };
  if (S.cur === n) { ta.value = text; renderBackdrop(); renderPreview(); updateStats(); }
  store.putNote(n);
  setStatus();
  scheduleLibrary();
}
function conflictSheet(n, hd, f, diskText) {
  const when = fullFmt.format(f.lastModified);
  openSheet(`${hd.name} changed outside Margin`, [
    h('p', null, `The file on your computer was edited at ${when}, after Margin last saved it. Choose which version to keep. The other one stays in Version history.`),
    h('div', { class: 'sheet-actions' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        closeSheet();
        await snapshot(n, n.content, 'Before loading the file version');
        applyExternal(n, diskText, f.lastModified);
        toast(`Loaded the version from ${hd.name}`);
      } }, 'Use the file’s version'),
      h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        closeSheet();
        await snapshot(n, diskText, 'File version before overwrite');
        await writeFile(n, hd);
      } }, 'Overwrite with Margin’s version')),
  ]);
}
async function checkDisk() {
  const n = S.cur;
  if (!n || !n.disk) return;
  const hd = S.handles.get(n.id);
  if (!hd) return;
  try {
    if (hd.queryPermission && (await hd.queryPermission({ mode: 'read' })) !== 'granted') return;
    const f = await hd.getFile();
    if (f.lastModified <= n.disk.lastModified + 1000) return;
    if (S.conflictSeen.get(n.id) === f.lastModified) return;
    const text = normalizeText(await f.text());
    if (hash(text) === n.disk.hash || text === n.content) { n.disk.lastModified = f.lastModified; n.disk.hash = hash(text); store.putNote(n); setStatus(); return; }
    S.conflictSeen.set(n.id, f.lastModified);
    if (hash(n.content) === n.disk.hash) {
      await snapshot(n, n.content, 'Before reloading from file');
      applyExternal(n, text, f.lastModified);
      toast(`Reloaded ${hd.name}: it was changed outside Margin`, { label: 'Undo', run: () => openVersions() });
    } else {
      toast(`${hd.name} was changed outside Margin`, { label: 'Review', run: () => conflictSheet(n, hd, f, text) });
    }
  } catch { /* file moved or permission gone */ }
}

// ---------- Versions ----------
async function openVersions() {
  const n = S.cur;
  if (!n) return;
  await flushSaves();
  const list = await store.listVersions(n.id).catch(() => []);
  const nowWords = wordCount(n.content);
  const body = [h('p', null, 'Margin keeps the last 20 versions of each note on this device: a copy every few minutes while you edit, and one before any restore or reload.')];
  if (!list.length) body.push(h('p', null, h('strong', null, 'No earlier versions yet.'), ' Edit this note and a version will appear here.'));
  else body.push(h('ul', { class: 'ver-list' }, list.map((v) => {
    const words = wordCount(v.content);
    const diff = words - nowWords;
    const pre = h('pre', { hidden: true }, v.content.slice(0, 6000) + (v.content.length > 6000 ? '\n…' : ''));
    const prevBtn = h('button', { type: 'button', class: 'btn small', 'aria-expanded': 'false', onclick: () => { pre.hidden = !pre.hidden; prevBtn.setAttribute('aria-expanded', String(!pre.hidden)); prevBtn.textContent = pre.hidden ? 'Preview' : 'Hide'; } }, 'Preview');
    return h('li', { class: 'ver' },
      h('div', { class: 'ver-top' },
        h('span', { class: 'ver-when' }, fullFmt.format(v.at)),
        h('span', { class: 'row-tight' }, prevBtn, h('button', { type: 'button', class: 'btn small primary', onclick: () => restoreVersion(v) }, 'Restore'))),
      h('span', { class: 'ver-meta' }, `${v.reason} · ${plural(words, 'word')}${diff ? ` · ${Math.abs(diff).toLocaleString()} ${diff > 0 ? 'more' : 'fewer'} than now` : ' · same length as now'}`),
      pre);
  })));
  openSheet(`Version history: ${n.name}`, body);
}
async function restoreVersion(v) {
  const n = S.cur;
  if (!n) return;
  const before = n.content;
  await snapshot(n, before, 'Before restore');
  n.content = v.content;
  ta.value = v.content;
  markDirty(n);
  renderBackdrop(); renderPreview(); updateStats();
  closeSheet();
  toast(`Restored the version from ${fullFmt.format(v.at)}`, { label: 'Undo', run: () => { n.content = before; if (S.cur === n) { ta.value = before; renderBackdrop(); renderPreview(); updateStats(); } markDirty(n); } });
}

// ---------- Delete / duplicate / pin ----------
function confirmDelete() {
  const n = S.cur;
  if (!n) return;
  openSheet(`Delete ${fileName(n)}?`, [
    h('p', null, n.disk ? `It’s removed from Margin on this device. ${n.disk.fileName} on your computer isn’t touched.` : 'It’s removed from Margin on this device, with its version history. Download it first if you want a copy.'),
    h('div', { class: 'sheet-actions' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'button', class: 'btn danger solid', onclick: () => { closeSheet(); deleteNote(n); } }, 'Delete note')),
  ]);
}
async function deleteNote(n) {
  pending.delete(n.id);
  const versions = await store.listVersions(n.id).catch(() => []);
  const handle = S.handles.get(n.id);
  await store.deleteNote(n.id);
  S.notes = S.notes.filter((x) => x !== n);
  S.handles.delete(n.id);
  S.cache.delete(n.id);
  if (S.cur === n) {
    S.cur = null;
    noteEl.hidden = true;
    $('wsEmpty').hidden = false;
    if (S.focus) setFocus(false);
    if (isWide()) { const next = sortedNotes()[0]; if (next) openNote(next.id, { push: false }); }
    else { if (history.state && history.state.note) history.back(); else showLibrary(); }
  }
  renderLibrary();
  toast(`Deleted ${fileName(n)}`, { label: 'Undo', run: async () => {
    S.notes.push(n);
    await store.putNote(n);
    await store.restoreVersions(versions);
    if (handle) { S.handles.set(n.id, handle); await store.setHandle(n.id, handle); }
    renderLibrary();
    openNote(n.id);
  } });
}
async function duplicate() {
  const n = S.cur;
  if (!n) return;
  await flushSaves();
  const copy = makeNote({ name: `${n.name} copy`, content: n.content, ext: n.ext, eol: n.eol });
  S.notes.push(copy);
  await store.putNote(copy);
  openNote(copy.id);
  toast(`Made a copy: ${fileName(copy)}`);
}
async function togglePin() {
  const n = S.cur;
  if (!n) return;
  n.pinned = !n.pinned;
  $('pinMark').hidden = !n.pinned;
  await store.putNote(n);
  renderLibrary();
  toast(n.pinned ? 'Pinned to the top of the library' : 'Unpinned');
}
async function copyMarkdown() {
  try { await navigator.clipboard.writeText(S.cur.content); toast('Markdown copied'); }
  catch { toast('Copying isn’t allowed here. Select the text in Edit and copy it instead.'); }
}

// ---------- Menus ----------
let openMenuEl = null;
let menuAnchor = null;
function openMenu(menu, anchor, items) {
  closeMenus();
  menu.replaceChildren(...items);
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
  let top = r.bottom + 6;
  if (top + mh > vh - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  openMenuEl = menu; menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('[role^="menuitem"]');
  if (first) first.focus({ preventScroll: true });
}
function closeMenus() {
  if (!openMenuEl) return;
  openMenuEl.hidden = true;
  if (menuAnchor) menuAnchor.setAttribute('aria-expanded', 'false');
  openMenuEl = null; menuAnchor = null;
}
function mi(label, iconName, run, opts = {}) {
  return h('button', { type: 'button', role: 'menuitem', class: 'mi' + (opts.danger ? ' danger' : ''), onclick: () => { closeMenus(); run(); } },
    h('span', { html: icon(iconName) }), h('span', null, label), opts.k ? h('span', { class: 'k' }, opts.k) : null);
}
function openMoreMenu() {
  const n = S.cur;
  if (!n) return;
  const items = [
    mi(n.pinned ? 'Unpin note' : 'Pin to top', 'pin', togglePin),
    h('hr'),
    (canPickSave || S.handles.has(n.id)) ? mi(S.handles.has(n.id) ? 'Save to file' : 'Save to file…', 'save', saveToFile, { k: 'Ctrl S' }) : null,
    mi('Download .md', 'download', () => download()),
    navigator.share ? mi('Share…', 'share', () => share()) : null,
    mi('Copy Markdown', 'copy', copyMarkdown),
    h('hr'),
    mi('Version history', 'history', openVersions),
    mi('Duplicate', 'dup', duplicate),
    mi('Focus mode', 'focus', () => setFocus(true)),
    !isWide() ? mi('Outline', 'outline', openOutlineSheet) : null,
    mi('Text size and theme', 'text', openSettings),
    h('hr'),
    mi('Delete note', 'trash', confirmDelete, { danger: true }),
  ].filter(Boolean);
  openMenu($('moreMenu'), $('moreBtn'), items);
}
function openHlMenu() {
  const sw = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colours' }, COLORS.map((c) => h('button', {
    type: 'button', role: 'menuitemradio', class: 'sw-btn', 'aria-checked': String(c === S.hlColor), 'aria-label': c[0].toUpperCase() + c.slice(1),
    onclick: () => { closeMenus(); setHlColor(c); runCmd('highlight'); },
  }, h('span', { class: `sw-${c}` }))));
  openMenu($('hlMenu'), $('hlMoreBtn'), [sw, mi('Remove highlight', 'eraser', removeHighlightCmd)]);
}
function setHlColor(c) {
  S.hlColor = c;
  lsSet('hlColor', c);
  document.querySelector('.hl-split').style.background = `var(--hl-${c})`;
  $('hlBtn').setAttribute('aria-label', `Highlight ${c}`);
}

// ---------- Sheets ----------
function openSheet(title, content) {
  $('sheetTitle').textContent = title;
  sheetBody.replaceChildren(...[].concat(content).filter(Boolean));
  if (!sheet.open) { try { sheet.showModal(); } catch { sheet.setAttribute('open', ''); } }
}
function closeSheet() { if (sheet.open) sheet.close(); }

function seg(label, options, current, onPick) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    wrap.append(h('button', { type: 'button', 'aria-pressed': String(o.v === current), onclick: (e) => {
      wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      e.currentTarget.setAttribute('aria-pressed', 'true');
      onPick(o.v);
    } }, o.label));
  }
  return wrap;
}
function setTheme(t) {
  lsSet('theme', t);
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
function setTextSize(s) {
  lsSet('textSize', s);
  if (s === 'm') document.documentElement.removeAttribute('data-size');
  else document.documentElement.setAttribute('data-size', s);
  requestAnimationFrame(() => { syncBackdrop(); });
}
let deferredInstall = null;
function openSettings() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const installRow = h('div', { class: 'set-row' }, h('h3', null, 'Install Margin'),
    standalone ? h('p', null, 'Margin is installed on this device.')
      : deferredInstall ? h('button', { type: 'button', class: 'btn primary', onclick: promptInstall }, 'Install app')
        : h('p', null, isIOS() ? 'In Safari, tap Share, then Add to Home Screen.' : 'In Chrome or Edge, use the install icon at the right of the address bar. In Safari on a Mac, choose File, then Add to Dock.'));
  openSheet('Settings', [
    h('div', { class: 'set-row' }, h('h3', null, 'Theme'), seg('Theme', [{ v: 'auto', label: 'Auto' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }], lsGet('theme', 'auto'), setTheme)),
    h('div', { class: 'set-row' }, h('h3', null, 'Text size'), h('p', null, 'Changes the editor and the Read view.'),
      seg('Text size', [{ v: 's', label: 'S' }, { v: 'm', label: 'M' }, { v: 'l', label: 'L' }, { v: 'xl', label: 'XL' }], lsGet('textSize', 'm'), setTextSize)),
    h('div', { class: 'set-row' }, h('h3', null, 'Backup'), h('p', null, `Download all ${plural(S.notes.length, 'note')} as .md files in one .zip, or bring a backup back in.`),
      h('div', { class: 'sheet-actions' },
        h('button', { type: 'button', class: 'btn', onclick: downloadAll, disabled: !S.notes.length }, 'Download all (.zip)'),
        h('button', { type: 'button', class: 'btn', onclick: () => $('zipInput').click() }, 'Restore from .zip'))),
    installRow,
    h('div', { class: 'set-row' }, h('h3', null, 'About'),
      h('p', null, `Margin 1.0 · Markdown only · ${store.persistent ? 'Notes are stored on this device and work offline.' : 'This browser is blocking storage, so download your notes to keep them.'}`)),
  ]);
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
async function promptInstall() {
  if (!deferredInstall) return;
  closeSheet();
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch { /* ignore */ }
  deferredInstall = null;
  $('installBtn').hidden = true;
}
async function downloadAll() {
  await flushSaves();
  const used = new Map();
  const files = S.notes.map((n) => {
    let name = fileName(n);
    const k = name.toLowerCase();
    const c = used.get(k) || 0;
    used.set(k, c + 1);
    if (c) name = `${n.name} (${c + 1})${n.ext || '.md'}`;
    return { name, text: toFileText(n), date: n.updated };
  });
  const blob = makeZip(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `margin-notes-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Downloaded ${plural(files.length, 'note')} as a .zip`);
}
async function restoreZip(file) {
  try {
    const entries = await readZip(await file.arrayBuffer());
    const files = entries.filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.name)).map((e) => ({ file: new File([e.bytes], e.name.split('/').pop(), { lastModified: e.date }) }));
    if (!files.length) { toast('That .zip has no files in it.'); return; }
    closeSheet();
    await importEntries(files, { fromBackup: true });
  } catch (e) { toast(`Couldn’t read that .zip: ${e.message || e}`); }
}

function openOutlineSheet() {
  const heads = S.headings;
  openSheet('Outline', heads.length
    ? h('ol', { class: 'outline-list' }, heads.map((x, i) => h('li', null, h('button', { type: 'button', class: 'ol-item', 'data-level': String(x.level), onclick: () => { closeSheet(); jumpToHeading(i); } }, x.text || 'Untitled heading'))))
    : h('p', null, 'Add headings with # to build an outline.'));
}

// ---------- Focus mode ----------
function setFocus(on) {
  S.focus = on;
  app.classList.toggle('focus', on);
  $('focusExit').hidden = !on;
  if (on) closeFind();
  applyMode();
  if (on) { ta.focus({ preventScroll: true }); toast('Focus mode: press Esc or Exit focus to leave'); }
}

// ---------- Wire up ----------
function bind() {
  $('newBtn').addEventListener('click', () => newNote());
  $('uploadBtn').addEventListener('click', pickFiles);
  $('fileInput').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) importEntries(files.map((f) => ({ file: f }))); });
  $('zipInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreZip(f); });
  $('settingsBtn').addEventListener('click', openSettings);
  $('installBtn').addEventListener('click', promptInstall);
  $('iosTipClose').addEventListener('click', () => { $('iosTip').hidden = true; lsSet('iosTip', 'hide'); });

  $('noteList').addEventListener('click', (e) => { const b = e.target.closest('.note-item'); if (b) openNote(b.dataset.id); });
  const onSearch = debounce(() => { S.query = $('search').value; renderLibrary(); }, 120);
  $('search').addEventListener('input', onSearch);
  const sortSel = $('sortSel');
  sortSel.value = S.sort;
  sortSel.addEventListener('change', () => { S.sort = sortSel.value; lsSet('sort', S.sort); renderLibrary(); });
  $('tabNotes').addEventListener('click', () => setTab('notes'));
  $('tabHighlights').addEventListener('click', () => setTab('highlights'));
  for (const id of ['tabNotes', 'tabHighlights']) $(id).addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = S.tab === 'notes' ? 'highlights' : 'notes'; setTab(next); $(next === 'notes' ? 'tabNotes' : 'tabHighlights').focus(); }
  });

  $('backBtn').addEventListener('click', closeNote);
  $('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('findBtn').addEventListener('click', () => (S.find.open ? closeFind() : openFind()));
  $('outlineBtn').addEventListener('click', () => {
    if (!isWide()) { openOutlineSheet(); return; }
    S.outlineOpen = !S.outlineOpen; lsSet('outline', S.outlineOpen ? '1' : '0'); applyMode();
  });
  $('outlineClose').addEventListener('click', () => { S.outlineOpen = false; lsSet('outline', '0'); applyMode(); });
  $('outlineList').addEventListener('click', (e) => { const b = e.target.closest('.ol-item'); if (b) jumpToHeading(+b.dataset.i); });
  $('downloadBtn').addEventListener('click', () => download());
  $('saveFileBtn').addEventListener('click', saveToFile);
  $('moreBtn').addEventListener('click', (e) => { e.stopPropagation(); openMenuEl === $('moreMenu') ? closeMenus() : openMoreMenu(); });
  $('hlMoreBtn').addEventListener('click', (e) => { e.stopPropagation(); openMenuEl === $('hlMenu') ? closeMenus() : openHlMenu(); });
  $('focusExit').addEventListener('click', () => setFocus(false));

  nameInput.addEventListener('input', () => {
    const n = S.cur; if (!n) return;
    n.name = sanitizeName(nameInput.value) || 'Untitled';
    n.autoName = false;
    markDirty(n);
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
  nameInput.addEventListener('blur', () => { if (S.cur) nameInput.value = S.cur.name; });

  const tb = $('toolbar');
  tb.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  tb.addEventListener('click', (e) => { const b = e.target.closest('button[data-cmd]'); if (b) runCmd(b.dataset.cmd); });

  ta.addEventListener('input', onEditorInput);
  ta.addEventListener('keydown', onEditorKey);
  ta.addEventListener('scroll', onEditorScroll, { passive: true });
  readPane.addEventListener('scroll', onPreviewScroll, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(() => syncBackdrop()).observe(ta);
  document.addEventListener('selectionchange', onSelectionChange);
  pvHl.addEventListener('mousedown', (e) => e.preventDefault());
  pvHl.addEventListener('click', highlightFromPreview);

  preview.addEventListener('change', (e) => { const b = e.target; if (b.matches('input[type="checkbox"][data-task]')) toggleTask(+b.dataset.task); });
  preview.addEventListener('click', async (e) => {
    const copy = e.target.closest('.copy-code');
    if (copy) {
      const code = copy.closest('figure').querySelector('pre').innerText;
      try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }
      catch { toast('Copying isn’t allowed here.'); }
      return;
    }
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      e.preventDefault();
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const t = preview.querySelector(`#${CSS.escape('h-' + id)}`) || preview.querySelector(`#${CSS.escape(id)}`);
      if (t) t.scrollIntoView({ block: 'start' });
    }
  });

  findInput.addEventListener('input', () => { S.find.idx = 0; recomputeFind(true); });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); if (S.view !== 'read' && isWide()) ta.focus(); }
  });
  $('findNext').addEventListener('click', () => stepFind(1));
  $('findPrev').addEventListener('click', () => stepFind(-1));
  $('findClose').addEventListener('click', closeFind);

  $('sheetClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

  document.addEventListener('pointerdown', (e) => {
    if (openMenuEl && !openMenuEl.contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeMenus();
    if (!pvHl.hidden && e.target !== pvHl && !pvHl.contains(e.target) && !preview.contains(e.target)) pvHl.hidden = true;
  });
  for (const m of [$('moreMenu'), $('hlMenu')]) m.addEventListener('keydown', (e) => {
    const items = [...m.querySelectorAll('[role^="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { const a = menuAnchor; closeMenus(); if (a) a.focus(); }
  });

  document.addEventListener('keydown', (e) => {
    if (sheet.open) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && k === 's') { e.preventDefault(); if (S.cur) saveToFile(); return; }
    if (mod && !e.altKey && !e.shiftKey && k === 'f' && S.cur && app.dataset.screen === 'note') { e.preventDefault(); openFind(); return; }
    if (mod && !e.altKey && !e.shiftKey && k === 'e' && S.cur) { e.preventDefault(); setMode(S.view === 'read' ? (isWide() ? 'split' : 'edit') : 'read'); return; }
    if (e.key === 'Escape') {
      if (openMenuEl) { closeMenus(); return; }
      if (S.find.open && document.activeElement !== findInput) { closeFind(); return; }
      if (S.focus) { setFocus(false); }
    }
  });

  window.addEventListener('popstate', () => { if (!isWide() && app.dataset.screen === 'note') { flushSaves(); if (S.focus) setFocus(false); showLibrary(); } });
  wideMQ.addEventListener('change', () => {
    applyMode();
    fitViewport();
    if (isWide() && !S.cur) { const first = sortedNotes()[0]; if (first) openNote(first.id, { push: false }); }
  });
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitViewport); window.visualViewport.addEventListener('scroll', fitViewport); }
  window.addEventListener('resize', () => { closeMenus(); syncBackdrop(); });
  window.addEventListener('focus', checkDisk);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); else checkDisk(); });
  window.addEventListener('pagehide', flushSaves);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('installBtn').hidden = false; });
  window.addEventListener('appinstalled', () => { deferredInstall = null; $('installBtn').hidden = true; toast('Margin is installed'); });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of Margin is ready', { label: 'Reload', run: () => w.postMessage('skipWaiting') });
        }
      });
    });
  }).catch(() => { /* offline support unavailable */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    flushSaves().finally(() => location.reload());
  });
}

async function init() {
  fitViewport();
  setHlColor(S.hlColor);
  bind();
  await store.init();
  try { S.notes = await store.allNotes(); } catch { S.notes = []; }
  for (const n of S.notes) { n.ext = n.ext || '.md'; n.eol = n.eol || '\n'; }
  if (!S.notes.length && lsGet('welcomed', '') !== '1') {
    const w = makeNote({ name: 'Welcome to Margin', content: WELCOME });
    w.pinned = true;
    S.notes.push(w);
    await store.putNote(w).catch(() => {});
    lsSet('welcomed', '1');
  }
  S.handles = await store.allHandles();
  renderLibrary();
  if (!store.persistent) toast('This browser is blocking storage, so notes disappear when Margin closes. Download them to keep them.', null, 9000);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS() && !standalone && lsGet('iosTip', '') !== 'hide') $('iosTip').hidden = false;
  await handleInbox().catch(() => {});
  const params = new URLSearchParams(location.search);
  if (params.has('new')) { history.replaceState(null, '', location.pathname); await newNote(); }
  if (isWide() && !S.cur) {
    const last = noteById(lsGet('last', '')) || sortedNotes()[0];
    if (last) await openNote(last.id, { push: false });
  }
  readyResolve();
  registerSW();
}

init();
