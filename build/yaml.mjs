/**
 * A YAML 1.2 parser for the subset real OpenAPI documents use.
 *
 * Supported: block mappings and sequences (compact `- key: v`, indentless
 * `key:\n- a`), flow collections, plain / single- / double-quoted scalars
 * with line folding, literal and folded block scalars (chomping and
 * indentation indicators), comments, anchors, aliases, merge keys (`<<`),
 * the standard `!!str|int|float|bool|null` tags and a single document with
 * optional `%YAML` directive and `---` / `...` markers.
 *
 * Values are typed by the YAML 1.2 core schema: only `true|false` (three
 * spellings) are booleans, `yes`/`on` stay strings, dates stay strings.
 * Mapping keys are always strings and keep their source spelling, so a
 * response code `200:` is the key "200".
 *
 * Not supported (clear error): collections as mapping keys, multiple
 * documents. Errors read `file:line: reason`.
 *
 * The parser is a single recursive-descent pass over the text. `pos` is the
 * cursor; block structure is decided by the column of the first character
 * of a node, and every block node knows the indentation `parent` of the
 * collection it lives in: its lines must be indented deeper than that.
 */

const ESCAPES = {
  0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029',
};
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };
const FLOW_INDICATORS = ',[]{}';
const INT = /^[-+]?[0-9]+$/;
const FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;

/** YAML 1.2 core schema resolution of an untagged plain scalar. */
function resolvePlain(text) {
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (text === 'true' || text === 'True' || text === 'TRUE') return true;
  if (text === 'false' || text === 'False' || text === 'FALSE') return false;
  const c = text.charCodeAt(text[0] === '-' || text[0] === '+' ? 1 : 0);
  if (c >= 48 && c <= 57) { // digit: maybe a number
    if (INT.test(text)) return Number(text);
    if (/^0o[0-7]+$/.test(text)) return parseInt(text.slice(2), 8);
    if (/^0x[0-9a-fA-F]+$/.test(text)) return parseInt(text.slice(2), 16);
  }
  if (FLOAT.test(text)) return Number(text);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return text[0] === '-' ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return NaN;
  return text;
}

/** Applies an explicit tag to a scalar; non-specific and unknown tags keep the text. */
function applyTag(tag, text, plain, fail) {
  switch (tag) {
    case null: return plain ? resolvePlain(text) : text;
    case '!!str': return text;
    case '!!null': return null;
    case '!!bool':
      if (/^(true|True|TRUE|false|False|FALSE)$/.test(text)) return text[0] === 't' || text[0] === 'T';
      return fail(`invalid !!bool value "${text}"`);
    case '!!int': case '!!float': {
      const value = resolvePlain(text);
      return typeof value === 'number' ? value : fail(`invalid ${tag} value "${text}"`);
    }
    default: return text;
  }
}

/** Own-property assignment that is safe for a key named `__proto__`. */
function setKey(object, key, value) {
  if (key === '__proto__') Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
  else object[key] = value;
}

export function parseYaml(text, { filename = '<yaml>' } = {}) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const len = src.length;
  const anchors = new Map();
  let pos = 0;
  let flowDepth = 0;

  const fail = (reason, at = pos) => {
    let line = 1;
    for (let i = src.indexOf('\n'); i !== -1 && i < at; i = src.indexOf('\n', i + 1)) line++;
    throw new SyntaxError(`${filename}:${line}: ${reason}`);
  };
  const isBlank = (c) => c === ' ' || c === '\t';
  const isEnd = (c) => c === undefined || c === ' ' || c === '\t' || c === '\n';
  const columnAt = (at) => at - (src.lastIndexOf('\n', at - 1) + 1);
  const docMarkerAt = (at) => columnAt(at) === 0 && (src.startsWith('---', at) || src.startsWith('...', at)) && isEnd(src[at + 3]);
  const atBlockEnd = () => pos >= len || docMarkerAt(pos);

  /**
   * Skips spaces, comments and line breaks up to the next content character.
   * Returns whether a line break was crossed. Tabs are fine as separators but
   * not as block indentation.
   */
  function skipBlank() {
    let crossed = false;
    let tabAt = -1;
    for (;;) {
      const c = src[pos];
      if (c === ' ') pos++;
      else if (c === '\t') { if (crossed && tabAt < 0) tabAt = pos; pos++; }
      else if (c === '\n') { pos++; crossed = true; tabAt = -1; }
      else if (c === '#') { const eol = src.indexOf('\n', pos); pos = eol < 0 ? len : eol; }
      else break;
    }
    if (tabAt >= 0 && flowDepth === 0 && pos < len) fail('tab character used for indentation (use spaces)', tabAt);
    return crossed;
  }

  /** After an inline value only blanks and a comment may follow on the line. */
  function expectLineEnd() {
    while (isBlank(src[pos])) pos++;
    if (src[pos] === '#' && isBlank(src[pos - 1])) { const eol = src.indexOf('\n', pos); pos = eol < 0 ? len : eol; }
    if (pos < len && src[pos] !== '\n') {
      fail(src[pos] === ':' ? 'mapping values are not allowed here (missing quotes or bad indentation?)' : `unexpected "${src[pos]}" after value`);
    }
  }

  /** Name of an anchor, alias or tag: everything up to whitespace (or a flow indicator). */
  function scanName() {
    const start = pos;
    while (!isEnd(src[pos]) && !FLOW_INDICATORS.includes(src[pos])) pos++;
    if (pos === start) fail('missing anchor or alias name');
    return src.slice(start, pos);
  }

  /** `&anchor` and `!tag` in either order before a node. */
  function scanProperties() {
    let anchor = null;
    let tag = null;
    for (;;) {
      if (src[pos] === '&' && anchor === null) { pos++; anchor = scanName(); }
      else if (src[pos] === '!' && tag === null) {
        if (src[pos + 1] === '<') { // verbatim !<tag:yaml.org,2002:str>
          const end = src.indexOf('>', pos);
          if (end < 0) fail('unterminated verbatim tag');
          tag = src.slice(pos, (pos = end + 1)).replace(/^!<tag:yaml\.org,2002:(\w+)>$/, '!!$1');
        } else tag = scanName();
      } else return { anchor, tag };
      while (isBlank(src[pos])) pos++;
    }
  }

  function alias() {
    pos++;
    const name = scanName();
    if (!anchors.has(name)) fail(`unknown alias *${name}`);
    return anchors.get(name);
  }

  /** One line of a plain scalar, up to `: `, ` #`, the line end (or a flow indicator). Trailing blanks are dropped. */
  function plainSegment() {
    const start = pos;
    let end = pos;
    for (;;) {
      const c = src[pos];
      if (c === undefined || c === '\n') break;
      if (c === ':' && (isEnd(src[pos + 1]) || (flowDepth > 0 && FLOW_INDICATORS.includes(src[pos + 1])))) break;
      if (c === '#' && pos > start && isBlank(src[pos - 1])) break;
      if (flowDepth > 0 && FLOW_INDICATORS.includes(c)) break;
      pos++;
      if (!isBlank(c)) end = pos;
    }
    return src.slice(start, end);
  }

  /**
   * A plain scalar, possibly spanning lines. Continuation lines must be
   * indented deeper than `parent` (block context); one line break folds to a
   * space, n+1 breaks keep n newlines.
   */
  function plainScalar(parent) {
    let text = plainSegment();
    for (;;) {
      if (src[pos] !== '\n') break;
      let p = pos;
      let breaks = 0;
      while (isBlank(src[p])) p++;
      while (src[p] === '\n') {
        p++;
        breaks++;
        while (isBlank(src[p])) p++;
      }
      if (breaks === 0 || p >= len || src[p] === '#' || docMarkerAt(p)) break;
      if (flowDepth === 0 && columnAt(p) <= parent) break;
      if (flowDepth > 0 && (FLOW_INDICATORS.includes(src[p]) || (src[p] === ':' && isEnd(src[p + 1])))) break;
      const save = pos;
      pos = p;
      const more = plainSegment();
      if (more === '') { pos = save; break; }
      text += (breaks === 1 ? ' ' : '\n'.repeat(breaks - 1)) + more;
    }
    return text;
  }

  /** Line folding inside quoted scalars: at a line break, consume it and the following empty lines. */
  function foldQuotedBreaks() {
    let breaks = 0;
    while (src[pos] === '\n') {
      pos++;
      breaks++;
      while (isBlank(src[pos])) pos++;
      if (docMarkerAt(pos)) fail('document marker inside a quoted string');
    }
    return breaks;
  }

  /** Single- or double-quoted scalar; the cursor is on the opening quote. */
  function quotedScalar() {
    const start = pos;
    const quote = src[pos++];
    const double = quote === '"';
    let text = '';
    let kept = 0; // text before this index came from escapes and is never trimmed
    for (;;) {
      let i = pos;
      while (i < len && src[i] !== quote && src[i] !== '\n' && !(double && src[i] === '\\')) i++;
      if (i >= len) fail(`unterminated ${double ? 'double' : 'single'}-quoted string`, start);
      text += src.slice(pos, i);
      pos = i;
      const c = src[pos];
      if (c === quote) {
        if (!double && src[pos + 1] === "'") { text += "'"; pos += 2; kept = text.length; continue; }
        pos++;
        return text;
      }
      if (c === '\n') {
        text = text.slice(0, kept) + text.slice(kept).replace(/[ \t]+$/, '');
        const breaks = foldQuotedBreaks();
        text += breaks === 1 ? ' ' : '\n'.repeat(breaks - 1);
      } else { // backslash escape
        const e = src[pos + 1];
        if (e === '\n') { // escaped line break: joins lines without a space
          pos++;
          text += '\n'.repeat(foldQuotedBreaks() - 1);
        } else if (e in ESCAPES) {
          text += ESCAPES[e];
          pos += 2;
        } else if (e in HEX_ESCAPES) {
          const hex = src.slice(pos + 2, pos + 2 + HEX_ESCAPES[e]);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== HEX_ESCAPES[e]) fail(`invalid escape \\${e}${hex}`);
          text += String.fromCodePoint(parseInt(hex, 16));
          pos += 2 + hex.length;
        } else fail(`invalid escape \\${e ?? ''} in double-quoted string`);
      }
      kept = text.length;
    }
  }

  /** `|` or `>` block scalar; `parent` is the indentation of the enclosing collection. */
  function blockScalar(parent) {
    const folded = src[pos++] === '>';
    let chomp = 'clip';
    let explicit = 0;
    for (let k = 0; k < 2; k++) {
      if (src[pos] === '-' || src[pos] === '+') chomp = src[pos++] === '-' ? 'strip' : 'keep';
      else if (src[pos] >= '1' && src[pos] <= '9') explicit = Number(src[pos++]);
    }
    if (!isEnd(src[pos]) && src[pos] !== '#') fail('invalid block scalar header');
    expectLineEnd();
    pos = Math.min(pos + 1, len);

    const minIndent = Math.max(parent + 1, 1);
    let indent = explicit ? minIndent + explicit - 1 : minIndent;
    if (!explicit) { // auto-detect: indentation of the first non-empty line
      for (let p = pos; p < len;) {
        let k = 0;
        while (src[p + k] === ' ') k++;
        indent = Math.max(indent, k);
        if (src[p + k] !== '\n') break;
        p += k + 1;
      }
    }

    const lines = []; // content text without indentation, or null for an empty line
    let endsAtEof = false;
    while (pos < len) {
      let k = 0;
      while (k < indent && src[pos + k] === ' ') k++;
      let eol = src.indexOf('\n', pos);
      if (eol < 0) eol = len;
      if (pos + k === eol) lines.push(null);
      else if (k < indent || docMarkerAt(pos)) break;
      else lines.push(src.slice(pos + k, eol));
      endsAtEof = eol === len;
      pos = Math.min(eol + 1, len);
    }

    let end = lines.length;
    while (end > 0 && lines[end - 1] === null) end--;
    if (end === 0) return chomp === 'keep' ? '\n'.repeat(lines.length) : '';
    const moreIndented = (line) => line[0] === ' ' || line[0] === '\t';
    let text = '';
    let previous = null;
    let empty = 0;
    for (let i = 0; i < end; i++) {
      const line = lines[i];
      if (line === null) { empty++; continue; }
      if (previous === null) text += '\n'.repeat(empty);
      else if (folded && !moreIndented(previous) && !moreIndented(line)) text += empty ? '\n'.repeat(empty) : ' ';
      else text += '\n'.repeat(empty + 1);
      text += line;
      previous = line;
      empty = 0;
    }
    if (chomp !== 'strip' && !(endsAtEof && end === lines.length)) text += '\n';
    if (chomp === 'keep') text += '\n'.repeat(lines.length - end);
    return text;
  }

  /**
   * Tries to read an implicit mapping key (`key:`, `"key":`) at the cursor.
   * Returns { key, merge } with the cursor after the colon, or null with the
   * cursor untouched. Keys must fit on one line.
   */
  function tryKey() {
    const start = pos;
    const c = src[pos];
    let key;
    let merge = false;
    if (c === '"' || c === "'") {
      key = quotedScalar();
      if (src.slice(start, pos).includes('\n')) { pos = start; return null; }
    } else if (c === '[' || c === '{' || c === '*' || c === '&' || c === '!' || c === '#') {
      return null;
    } else {
      key = plainSegment();
      merge = key === '<<';
    }
    while (isBlank(src[pos])) pos++;
    if (src[pos] === ':' && isEnd(src[pos + 1])) {
      pos++;
      return { key, merge };
    }
    pos = start;
    return null;
  }

  /**
   * A block node after an indicator (`key:`, `- `, `---`) or at the start.
   * `afterKey`: the node follows `key:` — on that same line only scalars,
   * flow collections and aliases are allowed; on later lines a sequence may
   * sit at the key's own column (indentless sequence).
   */
  function blockNode(parent, afterKey) {
    let crossed = skipBlank();
    if (atBlockEnd()) return null;
    if (afterKey && crossed && columnAt(pos) === parent && src[pos] === '-' && isEnd(src[pos + 1])) {
      return blockSequence(parent);
    }
    if (crossed && columnAt(pos) <= parent) return null;

    const { anchor, tag } = scanProperties();
    if (anchor !== null || tag !== null) {
      if (src[pos] === '\n' || src[pos] === '#' || pos >= len) { // properties alone on the line: node below
        crossed = skipBlank() || crossed;
        const column = columnAt(pos);
        const indentless = afterKey && column === parent && src[pos] === '-' && isEnd(src[pos + 1]);
        if (atBlockEnd() || (column <= parent && !indentless)) return remember(anchor, applyTag(tag, '', true, fail));
      }
    }
    const inline = afterKey && !crossed;
    const c = src[pos];
    const column = columnAt(pos);
    let value;
    if (c === '-' && isEnd(src[pos + 1])) {
      if (inline) fail('a block sequence cannot start on the same line as its key');
      value = blockSequence(column);
    } else if (c === '?' && isEnd(src[pos + 1])) {
      value = blockMapping(column, explicitKey(column));
    } else if (c === '|' || c === '>') {
      value = tag ? applyTag(tag, blockScalar(parent), false, fail) : blockScalar(parent);
    } else if (c === '[' || c === '{') {
      value = flowCollection();
      expectLineEnd();
    } else if (c === '*') {
      value = alias();
      expectLineEnd();
    } else {
      const entry = inline ? null : tryKey();
      if (entry) value = blockMapping(column, entry);
      else {
        const plain = c !== '"' && c !== "'";
        if (plain && c === ':' && isEnd(src[pos + 1])) fail('missing mapping key before ":"');
        if (plain && /[@`%]/.test(c)) fail(`a plain scalar cannot start with "${c}" (quote it)`);
        const text = plain ? plainScalar(parent) : quotedScalar();
        value = applyTag(tag, text, plain, fail);
        expectLineEnd();
      }
    }
    return remember(anchor, value);
  }

  function remember(anchor, value) {
    if (anchor !== null) anchors.set(anchor, value);
    return value;
  }

  /** Block sequence whose `- ` indicators sit at `indent`. */
  function blockSequence(indent) {
    const items = [];
    for (;;) {
      pos++; // past '-'
      items.push(blockNode(indent, false));
      skipBlank();
      if (atBlockEnd() || columnAt(pos) < indent) return items;
      if (columnAt(pos) > indent) fail('bad indentation of a sequence entry');
      if (src[pos] !== '-' || !isEnd(src[pos + 1])) return items;
    }
  }

  /** Block mapping whose keys sit at `indent`; `entry` is the already-read first key. */
  function blockMapping(indent, entry) {
    const map = {};
    const merges = [];
    for (;;) {
      let value = null;
      if (!entry.explicit) value = blockNode(indent, true);
      else if (skipBlank(), columnAt(pos) === indent && src[pos] === ':' && isEnd(src[pos + 1])) {
        pos++;
        value = blockNode(indent, false);
      }
      if (entry.merge) merges.push(...(Array.isArray(value) ? value : [value]));
      else setKey(map, entry.key, value);
      skipBlank();
      if (atBlockEnd() || columnAt(pos) < indent) break;
      if (columnAt(pos) > indent) fail('bad indentation of a mapping entry');
      entry = src[pos] === '?' && isEnd(src[pos + 1]) ? explicitKey(indent) : tryKey();
      if (!entry) fail(src[pos] === '-' ? 'a sequence entry is not allowed here (bad indentation?)' : 'expected a mapping entry ("key: value")');
    }
    return merges.length ? applyMerges(map, merges) : map;
  }

  /**
   * Explicit `? key` entry (PyYAML writes keys over 128 characters this
   * way). Only scalar keys are supported; the `: value` line is optional.
   */
  function explicitKey(indent) {
    const start = pos++;
    const key = blockNode(indent, false);
    if (key !== null && typeof key === 'object') fail('collections as mapping keys are not supported', start);
    return { key: key === null ? '' : String(key), merge: false, explicit: true };
  }

  /** `<<` merge: explicit keys win, then earlier merge sources over later ones. */
  function applyMerges(map, sources) {
    const out = {};
    for (const source of sources.reverse()) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) fail('merge key "<<" expects a mapping or a list of mappings');
      for (const key of Object.keys(source)) setKey(out, key, source[key]);
    }
    for (const key of Object.keys(map)) setKey(out, key, map[key]);
    return out;
  }

  /**
   * A node inside a flow collection: { value, text } where `text` is the
   * scalar's string form (used when the node turns out to be a key).
   */
  function flowNode() {
    skipBlank();
    const { anchor, tag } = scanProperties();
    skipBlank();
    const c = src[pos];
    if (c === '[' || c === '{') return { value: remember(anchor, flowCollection()), text: null };
    if (c === '*') return { value: alias(), text: null };
    const plain = c !== '"' && c !== "'";
    if (plain && (c === undefined || FLOW_INDICATORS.includes(c) || c === '#')) {
      if (anchor === null && tag === null) fail(c === undefined ? 'unterminated flow collection' : `unexpected "${c}" in flow collection`);
      return { value: remember(anchor, applyTag(tag, '', true, fail)), text: '' };
    }
    const text = plain ? plainScalar(-1) : quotedScalar();
    return { value: remember(anchor, applyTag(tag, text, plain, fail)), text };
  }

  /** `[a, b]` or `{a: 1}`; may span lines. A `[k: v]` entry is a one-pair mapping. */
  function flowCollection() {
    const start = pos;
    const isMap = src[pos++] === '{';
    const close = isMap ? '}' : ']';
    const out = isMap ? {} : [];
    const merges = [];
    flowDepth++;
    for (;;) {
      skipBlank();
      if (pos >= len) fail(`unterminated flow ${isMap ? 'mapping' : 'sequence'}`, start);
      if (src[pos] === close) break;
      const keyStart = pos;
      const node = flowNode();
      skipBlank();
      // After a quoted key the colon needs no space ("a":1, JSON style).
      const quoted = src[keyStart] === '"' || src[keyStart] === "'";
      let value = node.value;
      if (src[pos] === ':' && (quoted || isEnd(src[pos + 1]) || FLOW_INDICATORS.includes(src[pos + 1]))) {
        if (node.text === null) fail('collections and aliases as mapping keys are not supported', keyStart);
        pos++;
        skipBlank();
        const entry = src[pos] === ',' || src[pos] === close ? null : flowNode().value;
        if (isMap && node.text === '<<' && !quoted) merges.push(...[entry].flat());
        else if (isMap) setKey(out, node.text, entry);
        else setKey((value = {}), node.text, entry);
        skipBlank();
      } else if (isMap) {
        if (node.text === null) fail('collections and aliases as mapping keys are not supported', keyStart);
        setKey(out, node.text, null);
      }
      if (!isMap) out.push(value);
      if (src[pos] === ',') pos++;
      else if (pos >= len) fail(`unterminated flow ${isMap ? 'mapping' : 'sequence'}`, start);
      else if (src[pos] !== close) fail(`expected "," or "${close}" in flow ${isMap ? 'mapping' : 'sequence'}`);
    }
    pos++;
    flowDepth--;
    return merges.length ? applyMerges(out, merges) : out;
  }

  // Stream: directives, optional `---`, one node, optional `...`.
  skipBlank();
  while (src[pos] === '%' && columnAt(pos) === 0) {
    const eol = src.indexOf('\n', pos);
    pos = eol < 0 ? len : eol;
    skipBlank();
  }
  if (docMarkerAt(pos) && src.startsWith('---', pos)) pos += 3;
  const root = blockNode(-1, false);
  skipBlank();
  if (docMarkerAt(pos) && src.startsWith('...', pos)) { pos += 3; skipBlank(); }
  if (pos < len) {
    fail(docMarkerAt(pos) ? 'multiple YAML documents are not supported' : 'unexpected content (bad indentation?)');
  }
  return root;
}
