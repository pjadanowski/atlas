// Command palette (⌘K) runtime. Loaded lazily by the eager bundle the first
// time the palette opens (see assets/js/20-search.js), together with the
// index — a plain reader never pays for either.
(() => {
  'use strict';

  const dialog = document.querySelector('[data-search-dialog]');
  if (!dialog) return;
  const input = dialog.querySelector('[data-search-input]');
  const list = dialog.querySelector('[data-search-results]');
  const emptyNote = dialog.querySelector('[data-search-empty]');
  const engine = window.AtlasSearch;

  let prepared = null;
  let selected = 0;

  async function open() {
    if (dialog.open) return;
    dialog.showModal();
    input.value = '';
    render([]);
    if (!prepared) {
      try {
        const response = await fetch(document.body.dataset.searchIndex || '/assets/search-index.json');
        prepared = engine.prepare(await response.json());
      } catch {
        prepared = [];
      }
    }
    render(search(''));
    input.focus();
  }

  function search(query) {
    if (!prepared) return [];
    if (!query.trim()) {
      return prepared.slice(0, 8).map((item) => ({ entry: item.entry, hits: new Set(), viaSecondary: false }));
    }
    return engine.search(prepared, query, 20);
  }

  function render(results) {
    selected = 0;
    emptyNote.hidden = !(input.value && results.length === 0);
    list.innerHTML = results
      .map(({ entry, hits, viaSecondary }, position) => {
        const title = engine.highlight(entry.t, hits, mark, escapeHtml);
        const path = engine.highlight(entry.p, hits, mark, escapeHtml);
        const snippet =
          viaSecondary && entry.s
            ? `<span class="search-result-snippet">${engine.highlight(entry.s, hits, mark, escapeHtml)}</span>`
            : '';
        return `<li class="search-result${position === 0 ? ' is-selected' : ''}" id="search-option-${position}" role="option" aria-selected="${position === 0}">
        <a href="${escapeHtml(entry.h)}" tabindex="-1">
          <span class="method method--${escapeHtml(entry.m.toLowerCase())}">${escapeHtml(entry.m)}</span>
          <span class="search-result-main">
            <span class="search-result-title">${title}</span>
            ${entry.p ? `<span class="search-result-path">${path}</span>` : ''}
            ${snippet}
          </span>
          <span class="search-result-group">${escapeHtml(entry.g)}</span>
        </a>
      </li>`;
      })
      .join('');
    input.setAttribute('aria-activedescendant', results.length ? 'search-option-0' : '');
  }

  function mark(html) {
    return `<mark>${html}</mark>`;
  }

  function moveSelection(delta) {
    const items = list.querySelectorAll('.search-result');
    if (items.length === 0) return;
    items[selected]?.classList.remove('is-selected');
    items[selected]?.setAttribute('aria-selected', 'false');
    selected = (selected + delta + items.length) % items.length;
    items[selected].classList.add('is-selected');
    items[selected].setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', items[selected].id);
    items[selected].scrollIntoView({ block: 'nearest' });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  }

  input.addEventListener('input', () => render(search(input.value)));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Enter') {
      const link = list.querySelectorAll('.search-result')[selected]?.querySelector('a');
      if (link) {
        event.preventDefault();
        window.location.href = link.href;
      }
    }
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  window.__atlasSearchOpen = open;
})();
