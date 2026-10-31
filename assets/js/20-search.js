// Command palette (⌘K) — eager part. Only the triggers live here; the ranking
// engine, the palette runtime and the index load on first open, so reading
// the docs costs nothing and the eager bundle stays small.
(() => {
  'use strict';

  const dialog = document.querySelector('[data-search-dialog]');
  if (!dialog) return;

  let loading = null;

  function open() {
    if (window.__atlasSearchOpen) {
      window.__atlasSearchOpen();
      return;
    }
    if (!loading) {
      loading = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = document.body.dataset.searchJs;
        script.onload = script.onerror = () => resolve();
        document.head.appendChild(script);
      });
    }
    loading.then(() => window.__atlasSearchOpen?.());
  }

  for (const trigger of document.querySelectorAll('[data-search-open]')) {
    trigger.addEventListener('click', open);
  }

  document.addEventListener('keydown', (event) => {
    const inField = /^(input|textarea|select)$/i.test(document.activeElement?.tagName ?? '');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open();
    } else if (event.key === '/' && !inField && !dialog.open) {
      event.preventDefault();
      open();
    }
  });
})();
