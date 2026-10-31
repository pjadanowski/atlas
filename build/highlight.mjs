import { esc } from './text.mjs';

/**
 * Build-time syntax highlighting. Emits <span class="tok-*"> markup so the
 * browser ships zero highlighter JavaScript.
 *
 * Token classes: tok-key (object keys), tok-str, tok-num, tok-kw, tok-com.
 */
export function highlight(code, language) {
  if (language === 'json') return highlightJson(code);
  const rules = LANG_RULES[language];
  if (!rules) return esc(code);
  return highlightWithRules(code, rules);
}

export function highlightJson(code) {
  let html = '';
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"') {
      const end = findStringEnd(code, i);
      const raw = code.slice(i, end);
      const isKey = /^\s*:/.test(code.slice(end));
      html += span(isKey ? 'tok-key' : 'tok-str', raw);
      i = end;
    } else if (/[-\d]/.test(ch)) {
      const match = code.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        html += span('tok-num', match[0]);
        i += match[0].length;
      } else {
        html += esc(ch);
        i += 1;
      }
    } else if (/[a-z]/.test(ch)) {
      const match = code.slice(i).match(/^(true|false|null)\b/);
      if (match) {
        html += span('tok-kw', match[0]);
        i += match[0].length;
      } else {
        html += esc(ch);
        i += 1;
      }
    } else {
      html += esc(ch);
      i += 1;
    }
  }
  return html;
}

function findStringEnd(code, start) {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') i += 2;
    else if (code[i] === '"') return i + 1;
    else i += 1;
  }
  return code.length;
}

const LANG_RULES = {
  bash: {
    comment: /^#[^\n]*/,
    string: /^(?:"(?:[^"\\]|\\.)*"|'[^']*')/,
    keyword: /^(?:curl|echo|export)\b/,
    number: /^\d+(?:\.\d+)?\b/,
  },
  javascript: {
    comment: /^\/\/[^\n]*/,
    string: /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/,
    keyword:
      /^(?:const|let|var|async|await|function|return|if|else|throw|new|try|catch|import|from|export|of|for)\b/,
    number: /^\d+(?:\.\d+)?\b/,
  },
  php: {
    comment: /^(?:\/\/[^\n]*|#[^\n]*)/,
    string: /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,
    keyword:
      /^(?:<\?php|echo|true|false|null|new|return|if|else|foreach|as|function|use|array)\b/,
    number: /^\d+(?:\.\d+)?\b/,
  },
  python: {
    comment: /^#[^\n]*/,
    string: /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,
    keyword:
      /^(?:import|from|def|return|if|else|elif|for|in|True|False|None|with|as|print|raise)\b/,
    number: /^\d+(?:\.\d+)?\b/,
  },
};

const RULE_CLASSES = { comment: 'tok-com', string: 'tok-str', keyword: 'tok-kw', number: 'tok-num' };

function highlightWithRules(code, rules) {
  let html = '';
  let i = 0;
  while (i < code.length) {
    let matched = false;
    for (const [rule, pattern] of Object.entries(rules)) {
      const match = code.slice(i).match(pattern);
      if (match) {
        html += span(RULE_CLASSES[rule], match[0]);
        i += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const plain = code.slice(i).match(/^(?:[A-Za-z_]\w*|\s+|.)/)[0];
      html += esc(plain);
      i += plain.length;
    }
  }
  return html;
}

function span(cls, raw) {
  return `<span class="${cls}">${esc(raw)}</span>`;
}
