const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

const TRANSLITERATIONS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

export function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[äöüß]/g, (ch) => TRANSLITERATIONS[ch])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return slug;
  // Non-Latin input (e.g. CJK) reduces to nothing — fall back to a stable
  // hash so hrefs never collapse to "/tag//".
  let hash = 0;
  for (const ch of String(value)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `x${hash.toString(36)}`;
}

let linkBaseUrl = '';
let allowSpecHtml = false;

/**
 * `baseUrl` absolutizes relative hrefs found in spec descriptions.
 *
 * `allowHtml` lets a description that is authored as real HTML through
 * verbatim instead of the allowlist below. It exists because escaping such a
 * description renders tag soup. It is off by default and must stay that way
 * unless the spec is as trusted as the site's own templates: verbatim means a
 * description can run scripts in this origin, and this origin holds the try-it
 * bearer token. Nothing here sanitizes — the previous attempt at a sanitizer
 * was removed for being bypassable, and a half-safe filter is worse than an
 * honest switch.
 *
 * The switch is per description, not per site: specs mix authored HTML with
 * markdown, and forcing the markdown ones verbatim would print their `**` and
 * `###` as literal text. `isAuthoredHtml` decides which is which.
 */
export function configureText({ baseUrl, allowHtml = false }) {
  linkBaseUrl = baseUrl ?? '';
  allowSpecHtml = allowHtml === true;
}

// Tags the markdown path renders itself; a description carrying only these is
// still markdown, not authored HTML.
const INLINE_TAGS = /^(a|br|strong|b|i|em|code|span)$/i;

/**
 * True when a description is written as HTML rather than markdown: it carries
 * a tag the inline allowlist does not already handle (<section>, <div>, <p>,
 * <h2>, <ul>, <table>, …). Not a security check — `allowSpecHtml` is what
 * grants trust; this only picks the renderer.
 */
function isAuthoredHtml(value) {
  const text = String(value ?? '');
  for (const match of text.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    if (!INLINE_TAGS.test(match[1])) return true;
  }
  return false;
}

/** Verbatim output applies only to trusted specs, and only to authored HTML. */
function verbatim(value) {
  return allowSpecHtml && isAuthoredHtml(value);
}

/**
 * Inline formatting for spec descriptions. Everything is escaped; only a
 * whitelist survives: <br>, <a href>, <strong>/<b>/<i>/<code>, plus the
 * markdown subset (inline code, bold, links).
 */
export function mdInline(value) {
  if (verbatim(value)) return String(value ?? '');
  const links = [];
  // NUL doubles as the link-placeholder sentinel below — strip it from input.
  let text = String(value ?? '').replaceAll('\x00', '').replace(
    /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (match, href, inner) => {
      links.push({ href, label: inner.replace(/<[^>]+>/g, '') });
      return `\x00${links.length - 1}\x00`;
    },
  );
  text = text.replace(/<\/?p>/gi, '\n').replace(/<\/?br\s*\/?>/gi, '\n');
  const html = esc(text)
    .replaceAll('\n', '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" rel="noopener" target="_blank">$1</a>',
    )
    .replace(/&lt;(\/?)(strong|b|i|code)&gt;/gi, '<$1$2>');
  return html.replace(/\x00(\d+)\x00/g, (match, index) => {
    const { href, label } = links[Number(index)];
    const url = safeUrl(href);
    if (!url) return esc(label);
    return `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)}</a>`;
  });
}

/**
 * Allowlisted URL or null. Control characters and spaces are stripped first
 * because browsers remove them before scheme resolution ("java\nscript:"
 * fires) — then only known-safe shapes survive. Denylisting schemes is not
 * enough.
 */
function safeUrl(href) {
  const cleaned = String(href).replace(/[\u0000-\u0020]/g, '');
  if (/^https?:/i.test(cleaned) || /^mailto:/i.test(cleaned)) return cleaned;
  if (cleaned.startsWith('/')) return `${linkBaseUrl}${cleaned}`;
  if (cleaned.startsWith('#')) return cleaned;
  return null;
}

/**
 * Block markdown subset: headings (#–####), unordered/ordered lists and
 * paragraphs — the constructs actually present in spec descriptions.
 */
export function mdBlock(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (verbatim(text)) return `<div class="spec-html">${text}</div>`;
  // Specs write headings mid-paragraph ("## Wichtig !\n ### Details …");
  // give every heading line its own block before splitting on blank lines.
  const normalized = text
    .split('\n')
    .map((line) => (/^\s*#{1,6}\s/.test(line) ? `\n${line.trim()}\n` : line))
    .join('\n');
  return normalized.split(/\n{2,}/).map(renderBlock).filter(Boolean).join('\n');
}

function renderBlock(block) {
  const trimmed = block.trim();
  if (!trimmed) return '';

  const heading = trimmed.match(/^(#{1,6})\s+([\s\S]+)$/);
  if (heading) {
    // "#" maps to h2 (the page h1 is taken), deeper levels shift accordingly.
    const level = Math.min(heading[1].length + 1, 5);
    return `<h${level} class="md-heading">${mdInline(heading[2].replace(/\n/g, ' '))}</h${level}>`;
  }

  const lines = trimmed.split('\n');
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    const items = lines.map((line) => `<li>${mdInline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    return `<ul class="md-list">${items.join('')}</ul>`;
  }
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    const items = lines.map((line) => `<li>${mdInline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
    return `<ol class="md-list">${items.join('')}</ol>`;
  }

  // Long <br>-separated legends collapse just like plain descriptions.
  const legend = splitLines(trimmed);
  if (legend.length > COLLAPSE_AFTER_LINES) return collapsibleLines(legend);

  return `<p>${mdInline(trimmed)}</p>`;
}

/** True when a description needs block-level markdown rendering. */
export function hasBlockMarkdown(value) {
  return /^\s*#{1,6}\s|^\s*[-*]\s+|^\s*\d+[.)]\s+|\n{2,}/m.test(String(value ?? ''));
}

const COLLAPSE_AFTER_LINES = 18;
const COLLAPSE_VISIBLE_LINES = 15;

/**
 * Renders a description with the right markdown mode and wrapper class.
 * Descriptions with many lines (long enum legends split on \n or <br>)
 * collapse into a <details> so they don't dominate the page.
 */
export function descriptionHtml(value, className) {
  if (!value) return '';
  // Verbatim mode skips the line-collapsing below too: splitting authored HTML
  // on <br> to fold it into a <details> would cut it mid-element.
  if (verbatim(value)) return `<div class="${className} spec-html">${value}</div>`;
  if (hasBlockMarkdown(value)) return `<div class="${className}">${mdBlock(value)}</div>`;

  const lines = splitLines(value);
  if (lines.length <= COLLAPSE_AFTER_LINES) {
    return `<p class="${className}">${mdInline(value)}</p>`;
  }
  return `<div class="${className}">${collapsibleLines(lines)}</div>`;
}

/** Splits a description into trimmed lines; <p>/<br> variants count as breaks. */
function splitLines(value) {
  return String(value)
    .replace(/<\/?p>/gi, '\n')
    .replace(/<\/?br\s*\/?>/gi, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function collapsibleLines(lines) {
  const visible = lines.slice(0, COLLAPSE_VISIBLE_LINES).map((line) => mdInline(line)).join('<br>');
  const hidden = lines.slice(COLLAPSE_VISIBLE_LINES).map((line) => mdInline(line)).join('<br>');
  return `<p>${visible}</p>
        <details class="desc-collapse">
          <summary><span class="desc-collapse-show">Show ${lines.length - COLLAPSE_VISIBLE_LINES} more</span><span class="desc-collapse-hide">Show less</span></summary>
          <p>${hidden}</p>
        </details>`;
}

