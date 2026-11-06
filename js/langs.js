// ABAP + ABAP CDS highlighting for highlight.js, and keyword sets for the editor's own code colouring.

export const ABAP_KEYWORDS = (
  'abap abstract add aliases all and append appending as ascending assign assigned at authority-check base begin between binary ' +
  'bound break-point by bypassing call case cast catch changing check class class-data class-methods class-events cleanup clear ' +
  'collect commit components concatenate condense cond constants continue conv corresponding create data default define definition ' +
  'delete descending describe do else elseif end endcase endclass enddo endform endfunction endif endinterface endloop endmethod ' +
  'endmodule endselect endtry endwhile entries eq event events exact exception exceptions exit exporting field-symbol field-symbols ' +
  'filter final find for form free friends from function ge group gt handler hashed having if implementation importing in include ' +
  'index inheriting initial inner insert instance interface interfaces into is join key left le let like line lines loop lt me message ' +
  'method methods mode modify module move ne new non-unique not object occurs of on optional or order others outer parameters perform ' +
  'private program protected public raise raising range read redefinition reduce ref refresh replace report reference respecting ' +
  'returning rollback rows search section select select-options separated set shift single skip sort sorted split standard ' +
  'start-of-selection static statics structure submit super switch table tables then times to transporting try type type-pool types ' +
  'unassign unique up update using value when where while with work write xsdbool ' +
  // ABAP CDS / RAP
  'define view entity root association composition projection provider contract transactional_query transactional_interface ' +
  'extend custom function abstract parameters union distinct redirected virtual parent child exposes behavior implementation ' +
  'managed unmanaged persistent draft lock master dependent authorization etag field fields determination determinations validation ' +
  'validations action actions mapping numbering early late readonly mandatory create update delete use strict save ' +
  'cardinality many one exact'
).split(/\s+/).filter(Boolean);

const ABAP_BUILTINS = (
  'lines strlen xstrlen to_upper to_lower concat substring substring_after substring_before line_exists line_index ' +
  'coalesce div mod abs ceil floor round sy sy-subrc sy-tabix sy-datum sy-uzeit sy-uname dats_days_between dats_add_days ' +
  'tstmp_current_utctimestamp currency_conversion unit_conversion boolc condense shift_left shift_right escape matches ' +
  'contains count find_end replace segment'
).split(/\s+/);

export function registerLanguages(hljs) {
  if (!hljs || hljs.getLanguage('abap')) return;
  hljs.registerLanguage('abap', (h) => ({
    name: 'ABAP',
    aliases: ['cds', 'abap-cds', 'abapcds', 'ddls', 'sap', 'rap', 'bdef'],
    case_insensitive: true,
    keywords: {
      $pattern: /[A-Za-z_][\w-]*/,
      keyword: ABAP_KEYWORDS,
      literal: ['abap_true', 'abap_false', 'abap_undefined', 'space', 'null', 'true', 'false'],
      built_in: ABAP_BUILTINS,
    },
    contains: [
      { scope: 'comment', begin: /^\*/, end: /$/ },
      { scope: 'comment', begin: /"/, end: /$/ },
      h.C_LINE_COMMENT_MODE,
      h.C_BLOCK_COMMENT_MODE,
      { scope: 'string', begin: /'/, end: /'/, contains: [{ begin: /''/ }] },
      { scope: 'string', begin: /`/, end: /`/ },
      { scope: 'string', begin: /\|/, end: /\|/, contains: [{ scope: 'subst', begin: /\{/, end: /\}/ }] },
      { scope: 'meta', begin: /@<?[A-Za-z_][\w.]*/ },
      { scope: 'variable', begin: /\$(?:projection|session|parameters|node|self)\b/ },
      { scope: 'type', begin: /\b[ZY][A-Z0-9]{0,4}_\w+/ },
      { scope: 'number', begin: /\b\d+(?:\.\d+)?\b/ },
    ],
  }));
}

// ---- Editor code colouring (fast, line based) ----
const JS_KW = 'await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async true false null undefined interface type enum implements public private protected readonly as'.split(' ');
const SQL_KW = 'select from where and or not in is null as join inner left right outer full on group by order having limit offset insert into values update set delete create table view index primary key foreign references distinct union all case when then else end exists between like count sum avg min max with'.split(' ');
const PY_KW = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self'.split(' ');
const GENERIC_KW = [...new Set([...JS_KW, ...PY_KW.map((k) => k.toLowerCase()), 'fn', 'func', 'package', 'struct', 'impl', 'pub', 'use', 'mod', 'match', 'void', 'int', 'string', 'bool', 'char', 'float', 'double', 'long', 'echo', 'then', 'fi', 'done', 'esac'])];

const LANG = {
  abap: { kw: new Set(ABAP_KEYWORDS), ci: true, line: [/"/, /\/\//], block: true, str: [`'`, '`', '|'], abap: true },
  js: { kw: new Set(JS_KW), line: [/\/\//], block: true, str: [`'`, '"', '`'] },
  sql: { kw: new Set(SQL_KW), ci: true, line: [/--/], block: true, str: [`'`, '"'] },
  py: { kw: new Set(PY_KW), line: [/#/], str: [`'`, '"'] },
  sh: { kw: new Set('if then else elif fi for in do done case esac while until function return export local echo exit'.split(' ')), line: [/#/], str: [`'`, '"'] },
  json: { kw: new Set(['true', 'false', 'null']), str: ['"'] },
  generic: { kw: new Set(GENERIC_KW), line: [/\/\//, /#(?!\w)/], block: true, str: [`'`, '"', '`'] },
};
const ALIASES = {
  abap: 'abap', cds: 'abap', 'abap-cds': 'abap', abapcds: 'abap', ddls: 'abap', sap: 'abap', rap: 'abap', bdef: 'abap',
  js: 'js', javascript: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js', java: 'js', c: 'js', cpp: 'js', 'c++': 'js', cs: 'js', csharp: 'js', go: 'js', kotlin: 'js', swift: 'js', rust: 'js', php: 'js',
  sql: 'sql', hana: 'sql', hanasql: 'sql', plsql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql',
  py: 'py', python: 'py', rb: 'py', ruby: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', powershell: 'sh', ps1: 'sh', yaml: 'sh', yml: 'sh', toml: 'sh',
  json: 'json',
};
export function editorLang(name) {
  const key = ALIASES[(name || '').toLowerCase()];
  return LANG[key] || (name ? LANG.generic : null);
}

/**
 * Colour one line of code. Returns segments [{s,e,c}] relative to the line, plus the new block-comment state.
 */
export function codeLine(line, lang, state) {
  const segs = [];
  let i = 0;
  const n = line.length;
  let inBlock = state.inBlock;
  const push = (s, e, c) => { if (e > s) segs.push({ s, e, c }); };
  if (lang.abap && line[0] === '*') { push(0, n, 't-com'); return { segs, inBlock }; }
  while (i < n) {
    if (inBlock) {
      const end = line.indexOf('*/', i);
      if (end < 0) { push(i, n, 't-com'); i = n; break; }
      push(i, end + 2, 't-com'); i = end + 2; inBlock = false; continue;
    }
    const ch = line[i];
    const rest = line.slice(i);
    if (lang.block && rest.startsWith('/*')) { inBlock = true; continue; }
    let isComment = false;
    if (lang.line) for (const re of lang.line) { const m = re.exec(rest); if (m && m.index === 0) { isComment = true; break; } }
    if (isComment) { push(i, n, 't-com'); break; }
    if (lang.str && lang.str.includes(ch)) {
      let j = i + 1;
      while (j < n) { if (line[j] === '\\' && ch !== '|') { j += 2; continue; } if (line[j] === ch) { j++; break; } j++; }
      push(i, Math.min(j, n), 't-str'); i = Math.min(j, n); continue;
    }
    if (ch === '@' && /[A-Za-z_<]/.test(line[i + 1] || '')) {
      const m = /^@<?[A-Za-z_][\w.]*/.exec(rest); push(i, i + m[0].length, 't-meta'); i += m[0].length; continue;
    }
    if (ch === '$' && /[A-Za-z_]/.test(line[i + 1] || '')) {
      const m = /^\$[A-Za-z_]\w*/.exec(rest); push(i, i + m[0].length, 't-var'); i += m[0].length; continue;
    }
    if (/[0-9]/.test(ch) && !/[\w]/.test(line[i - 1] || '')) {
      const m = /^\d+(?:\.\d+)?/.exec(rest); push(i, i + m[0].length, 't-num'); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = (lang.abap ? /^[A-Za-z_][\w-]*/ : /^[A-Za-z_]\w*/).exec(rest);
      let w = m[0];
      if (lang.abap && w.endsWith('-')) w = w.slice(0, -1);
      const key = lang.ci ? w.toLowerCase() : w;
      if (lang.kw.has(key)) push(i, i + w.length, 't-kw');
      else if (lang.abap && /^[ZY][A-Z0-9]{0,4}_\w+/i.test(w)) push(i, i + w.length, 't-id');
      else if (!lang.abap && line[i + w.length] === '(') push(i, i + w.length, 't-id');
      i += w.length; continue;
    }
    i++;
  }
  return { segs, inBlock };
}
