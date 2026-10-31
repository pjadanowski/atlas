// Typo-tolerant ranking over the build-time search index — the same engine
// runs in the ⌘K palette (this bundle) and in the Node MCP server, which
// imports this file for its side effect and reads `globalThis.AtlasSearch`.
// Keep it dependency-free and free of `export`/`import`: it is concatenated
// into a browser IIFE bundle as-is.
//
// The model follows Typesense's defaults: a query is split into terms, every
// term must match some field (AND), a term matches a token exactly, as a
// prefix, or within a typo budget that grows with the term length (1 typo
// from 4 characters, 2 from 8 — Damerau-Levenshtein, so a swapped pair costs
// one). Fields carry weights, so a hit in the title outranks one in the
// description. Diacritics are folded ("ubersicht" finds "Übersicht").
(function (root) {
  'use strict';

  const FIELDS = [
    { key: 't', weight: 10 }, // title
    { key: 'p', weight: 8 }, // path
    { key: 'k', weight: 6 }, // keywords: operationId, params, schema names
    { key: 'g', weight: 4 }, // tag
    { key: 'd', weight: 2 }, // description
  ];

  function fold(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss')
      .toLowerCase();
  }

  // "listBankkonten" → list bankkonten; "/api/v1/users/{id}" → api v1 users id
  function tokenize(value) {
    return fold(String(value ?? '').replace(/([a-z\d])([A-Z])/g, '$1 $2'))
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function allowedTypos(term) {
    if (term.length >= 8) return 2;
    if (term.length >= 4) return 1;
    return 0;
  }

  // Optimal string alignment distance, capped: returns max + 1 as soon as the
  // budget is exceeded so the common no-match case stays cheap.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let previous2 = null;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        if (previous2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          value = Math.min(value, previous2[j - 2] + 1);
        }
        current.push(value);
        if (value < rowMin) rowMin = value;
      }
      if (rowMin > max) return max + 1;
      previous2 = previous;
      previous = current;
    }
    return previous[b.length];
  }

  /** How well one query term matches one token: 0 (no), up to 1 (exact). */
  function termQuality(term, token) {
    if (token === term) return 1;
    // A prefix is worth more the larger the share of the token it covers:
    // "kund" on "kunden" beats "app" on "application".
    if (token.startsWith(term)) return term.length >= 2 ? 0.5 + (0.4 * term.length) / token.length : 0.3;
    const typos = allowedTypos(term);
    if (typos === 0) return 0;
    const whole = distance(term, token, typos);
    if (whole <= typos) return 0.7 - 0.2 * (whole - 1);
    // Typo inside a prefix: "bankonto" should still reach "bankkonten".
    if (token.length > term.length) {
      const head = distance(term, token.slice(0, term.length), typos);
      if (head <= typos) return 0.5 - 0.2 * (head - 1);
    }
    return 0;
  }

  function prepare(index) {
    return index.map((entry) => ({
      entry,
      fields: FIELDS.map((field) => ({
        key: field.key,
        weight: field.weight,
        tokens: [...new Set(tokenize(entry[field.key]))],
      })),
      path: fold(entry.p),
    }));
  }

  /**
   * Returns the best `limit` entries as {entry, score, hits, viaSecondary}:
   * `hits` are the folded tokens that matched (for highlighting), and
   * `viaSecondary` says a term was found only in keywords/description, which
   * the UI uses to explain the match with a snippet.
   */
  function search(prepared, query, limit) {
    return rank(prepared, [...new Set(tokenize(query))], limit);
  }

  function rank(prepared, terms, limit) {
    if (terms.length === 0) return [];
    const scored = [];
    for (const item of prepared) {
      let score = 0;
      let viaSecondary = false;
      const hits = new Set();
      const keys = new Set();
      let missing = false;
      for (const term of terms) {
        let best = 0;
        let bestKey = null;
        let bestToken = null;
        for (const field of item.fields) {
          for (const token of field.tokens) {
            const quality = termQuality(term, token);
            if (quality === 0) continue;
            const value = quality * field.weight;
            if (value > best) {
              best = value;
              bestKey = field.key;
              bestToken = token;
            }
          }
        }
        // A literal path fragment ("users/{id}", "/v1/") is not a token.
        if (term.length >= 2 && item.path && item.path.includes(term)) {
          const value = 0.95 * 8;
          if (value > best) {
            best = value;
            bestKey = 'p';
            bestToken = null;
          }
        }
        if (best === 0) {
          missing = true;
          break;
        }
        score += best;
        keys.add(bestKey);
        if (bestToken) hits.add(bestToken);
        if (bestKey === 'k' || bestKey === 'd') viaSecondary = true;
      }
      if (missing) continue;
      // All terms in one field reads as a phrase ("app me" → the app/me path).
      if (terms.length > 1 && keys.size === 1) {
        score += 0.5 * FIELDS.find((field) => field.key === [...keys][0]).weight;
      }
      // Titles that begin with the query read as the intended result.
      if (item.fields[0].tokens[0] && item.fields[0].tokens[0].startsWith(terms[0])) score += 3;
      scored.push({ entry: item.entry, score, hits, viaSecondary });
    }
    // Nothing matched every word: drop the last one and try again, rather
    // than answering with an empty list (Typesense's drop_tokens_threshold).
    if (scored.length === 0 && terms.length > 1) return rank(prepared, terms.slice(0, -1), limit);
    scored.sort((a, b) => b.score - a.score || a.entry.t.length - b.entry.t.length);
    return scored.slice(0, limit);
  }

  /** Wraps the words of `text` that the engine matched. `mark(word)` renders one hit. */
  function highlight(text, hits, mark, escape) {
    const parts = String(text ?? '').split(/([\p{L}\p{N}]+)/u);
    return parts
      .map((part, position) => {
        if (position % 2 === 0 || !part) return escape(part);
        const folded = fold(part);
        for (const hit of hits) {
          // Equal, or containing it — "listBankkonten" carries the token "bankkonten".
          if (hit.length >= 2 && (folded === hit || folded.includes(hit))) return mark(escape(part));
        }
        return escape(part);
      })
      .join('');
  }

  root.AtlasSearch = { fold, tokenize, distance, termQuality, prepare, search, highlight };
})(typeof globalThis !== 'undefined' ? globalThis : window);
