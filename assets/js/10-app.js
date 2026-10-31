// Progressive enhancement layer: theme toggle + copy buttons.
// Documentation itself works fully without this file.
(() => {
  'use strict';

  // ---- Theme ----
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  function currentTheme() {
    return root.dataset.theme || (prefersDark.matches ? 'dark' : 'light');
  }

  const themeToggle = document.querySelector('[data-theme-toggle]');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* Storage blockiert — Theme gilt nur für diese Seite. */
      }
    });
  }

  // ---- Expand toggles for capped code panels ----
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-expand]');
    if (toggle) toggle.closest('.code-panel').classList.toggle('is-expanded');
  });

  // ---- Expand / collapse every nested attribute card (model pages) ----
  document.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-attrs-toggle]');
    if (!tool) return;
    const open = tool.dataset.attrsToggle === 'expand';
    const section = tool.closest('.doc-section');
    for (const card of section?.querySelectorAll('details.child-attrs') ?? []) card.open = open;
  });

  // ---- Global authorization (one bearer token for every try-it request) ----
  const TOKEN_KEY = 'tryit:token';

  function storedToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function refreshAuthUI() {
    const isSet = storedToken() !== '';
    for (const state of document.querySelectorAll('[data-auth-state]')) {
      state.textContent = isSet ? 'Bearer ••••••••' : 'Not set';
      state.classList.toggle('is-set', isSet);
    }
    document.querySelector('[data-auth-dot]')?.classList.toggle('is-set', isSet);
  }

  refreshAuthUI();

  const authDialog = document.querySelector('[data-auth-dialog]');
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-auth-open]') && authDialog) {
      const input = authDialog.querySelector('[data-auth-token]');
      input.value = storedToken();
      authDialog.showModal();
      input.focus();
    }
    if (event.target.closest('[data-auth-close]')) authDialog?.close();
    const eye = event.target.closest('[data-auth-eye]');
    if (eye && authDialog) {
      const input = authDialog.querySelector('[data-auth-token]');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.classList.toggle('is-visible', show);
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
    }
    if (event.target.closest('[data-auth-clear]') && authDialog) {
      authDialog.querySelector('[data-auth-token]').value = '';
      persistToken('');
    }
  });

  authDialog?.addEventListener('input', (event) => {
    if (event.target.dataset?.authToken !== undefined) persistToken(event.target.value);
  });

  function persistToken(value) {
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* Storage blockiert — Token gilt nur für diese Seite. */
    }
    refreshAuthUI();
  }

  // ---- Try-it drawer: open + lazy-load runtime and styles on first open ----
  let tryitRequested = false;
  let tryitCssReady = null;

  function loadTryit() {
    if (tryitRequested) return tryitCssReady;
    tryitRequested = true;
    const script = document.createElement('script');
    script.src = document.body.dataset.tryitJs;
    script.defer = true;
    document.head.appendChild(script);
    tryitCssReady = new Promise((resolveCss) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = document.body.dataset.tryitCss;
      link.onload = link.onerror = () => resolveCss();
      document.head.appendChild(link);
    });
    return tryitCssReady;
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-tryit-open]')) {
      const drawer = document.querySelector('dialog[data-tryit]');
      if (!drawer) return;
      loadTryit().then(() => {
        drawer.showModal();
        drawer.querySelector('.tryit-input')?.focus();
      });
    }
    if (event.target.closest('[data-tryit-close]')) {
      event.target.closest('dialog[data-tryit]')?.close();
    }
  });

  // Until the runtime has registered its submit handler, an Enter key in the
  // drawer would trigger a native form submission and navigate away.
  document.addEventListener('submit', (event) => {
    if (event.target.closest('.tryit-form') && !window.__tryitReady) event.preventDefault();
  });

  // ---- MCP dialog: connection snippets for editor assistants ----
  // Snippets are rendered at build time against a placeholder host; the real
  // origin is only known here.
  const mcpDialog = document.querySelector('[data-mcp-dialog]');
  let mcpResolved = false;
  document.addEventListener('click', (event) => {
    if (!mcpDialog) return;
    if (event.target.closest('[data-mcp-open]')) {
      if (!mcpResolved) {
        mcpResolved = true;
        const placeholder = mcpDialog.dataset.mcpPlaceholder;
        const walker = document.createTreeWalker(mcpDialog, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.nodeValue.includes(placeholder)) node.nodeValue = node.nodeValue.replaceAll(placeholder, location.origin);
        }
        for (const button of mcpDialog.querySelectorAll('[data-copy]')) {
          button.dataset.copy = button.dataset.copy.replaceAll(placeholder, location.origin);
        }
      }
      mcpDialog.showModal();
    }
    if (event.target.closest('[data-mcp-close]')) mcpDialog.close();
  });

  // Click on the backdrop (the dialog element itself) closes drawer + auth + MCP.
  document.addEventListener('click', (event) => {
    const dialog = event.target;
    if (dialog instanceof HTMLDialogElement && dialog.matches('[data-tryit], [data-auth-dialog], [data-mcp-dialog]')) {
      const box = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) dialog.close();
    }
  });

  // ---- Snippet language memory (pick PHP once → PHP everywhere) ----
  const LANG_KEY = 'pref:lang';
  const LANG_IDS = ['curl', 'javascript', 'php', 'python'];

  try {
    const lang = localStorage.getItem(LANG_KEY);
    if (LANG_IDS.includes(lang)) {
      for (const radio of document.querySelectorAll('.code-tab-radio')) {
        if (radio.id.endsWith(`-${lang}`)) radio.checked = true;
      }
    }
  } catch {
    /* Storage blockiert. */
  }

  document.addEventListener('change', (event) => {
    if (!event.target.classList?.contains('code-tab-radio')) return;
    const lang = LANG_IDS.find((id) => event.target.id.endsWith(`-${id}`));
    if (!lang) return;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* Storage blockiert. */
    }
  });

  // ---- Resizable sidebar (drag the edge; double-click resets) ----
  const SIDEBAR_KEY = 'pref:sidebar';
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 440;
  const resizer = document.querySelector('[data-sidebar-resizer]');

  resizer?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing');

    const onMove = (move) => {
      const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(move.clientX)));
      root.style.setProperty('--sidebar-width', `${width}px`);
    };
    const onUp = () => {
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-resizing');
      try {
        localStorage.setItem(SIDEBAR_KEY, parseInt(root.style.getPropertyValue('--sidebar-width'), 10));
      } catch {
        /* Storage blockiert. */
      }
    };
    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onUp);
  });

  resizer?.addEventListener('dblclick', () => {
    root.style.removeProperty('--sidebar-width');
    try {
      localStorage.removeItem(SIDEBAR_KEY);
    } catch {
      /* Storage blockiert. */
    }
  });

  // ---- Sidebar quick filter ----
  const navFilter = document.querySelector('[data-nav-filter]');
  navFilter?.addEventListener('input', () => {
    const term = navFilter.value.trim().toLowerCase();
    for (const link of document.querySelectorAll('.nav-endpoint')) {
      link.hidden = Boolean(term) && !link.title.toLowerCase().includes(term);
    }
    for (const group of document.querySelectorAll('.nav-group')) {
      const anyVisible = [...group.querySelectorAll('.nav-endpoint')].some((link) => !link.hidden);
      group.hidden = Boolean(term) && !anyVisible;
      if (term && anyVisible) group.open = true;
    }
  });

  // ---- Deep links into hidden doc tabs ----
  // Anchors can point inside a CSS-only tab pane; activate that tab first.
  function revealHashTarget() {
    const id = location.hash.slice(1);
    const target = id && document.getElementById(id);
    if (!target) return;
    const pane = target.closest('.doc-tabpane');
    if (pane) {
      const tabs = pane.parentElement;
      const panes = [...tabs.querySelectorAll(':scope > .doc-tabpane')];
      const radios = [...tabs.querySelectorAll(':scope > .doc-tab-radio')];
      const index = panes.indexOf(pane);
      if (radios[index]) radios[index].checked = true;
    }
    target.scrollIntoView({ block: 'start' });
  }

  window.addEventListener('hashchange', revealHashTarget);
  revealHashTarget();

  // Anchor click also copies the absolute link, ready to paste.
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('.attr-anchor');
    if (!anchor || !navigator.clipboard) return;
    navigator.clipboard.writeText(anchor.href).catch(() => {});
  });

  // ---- Copy buttons (event delegation, one listener for the whole page) ----
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.copy-btn');
    if (!button) return;
    const text = button.dataset.copy || visiblePaneText(button);
    if (!text) return;
    if (!navigator.clipboard) {
      button.classList.add('is-copy-failed');
      setTimeout(() => button.classList.remove('is-copy-failed'), 1200);
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        button.classList.add('is-copied');
        setTimeout(() => button.classList.remove('is-copied'), 1200);
      })
      .catch(() => {
        button.classList.add('is-copy-failed');
        setTimeout(() => button.classList.remove('is-copy-failed'), 1200);
      });
  });

  function visiblePaneText(button) {
    const panel = button.closest('.code-panel');
    if (!panel) return '';
    for (const pane of panel.querySelectorAll('.code-pane')) {
      if (pane.offsetParent !== null) return pane.textContent.trim();
    }
    return '';
  }
})();
