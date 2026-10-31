import { esc } from '../text.mjs';
import { url } from '../url.mjs';
import { highlight } from '../highlight.mjs';
import { mcpClientSnippets } from '../mcp.mjs';
import { codePanel } from './codecol.mjs';
import { copyButton, methodBadge } from './ui.mjs';

/**
 * Page shell: 57px header + three independently scrolling columns
 * (sidebar 264px | content | code 480px). Sidebar is rendered per page so the
 * active endpoint's group is the only one expanded — no JS required.
 */
export function pageShell({ model, assets, title, activeHref, content, codeColumn, drawer = '' }) {
  const hasCode = Boolean(codeColumn);
  return `<!doctype html>
<html lang="${esc(model.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(model.title)}</title>
<meta name="description" content="${esc(model.title)} – API documentation">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='7' fill='%235b5bd6'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${esc(assets.css)}">${assets.customCss ? `\n<link rel="stylesheet" href="${esc(assets.customCss)}">` : ''}
<link rel="preload" href="${esc(url('/assets/fonts/instrument-sans.woff2'))}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${esc(url('/assets/fonts/jetbrains-mono.woff2'))}" as="font" type="font/woff2" crossorigin>
<script>
(function () {
  document.documentElement.classList.add('js');
  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    var sidebar = parseInt(localStorage.getItem('pref:sidebar'), 10);
    if (sidebar >= 220 && sidebar <= 440) document.documentElement.style.setProperty('--sidebar-width', sidebar + 'px');
  } catch (e) {}
})();
</script>
</head>
<body data-tryit-js="${esc(assets.tryitJs)}" data-tryit-css="${esc(assets.tryitCss)}" data-search-js="${esc(assets.searchJs)}" data-search-index="${esc(assets.searchIndex)}">
<a class="skip-link" href="#content">Skip to content</a>
<header class="topbar">
  <a class="topbar-brand" href="${esc(url('/'))}">
    <span class="topbar-logo" aria-hidden="true"></span>
    <span class="topbar-title">${esc(model.title)}</span>
    <span class="topbar-version">v${esc(model.version)}</span>
  </a>
  <div class="topbar-search">
    <button type="button" class="search-trigger js-only" data-search-open>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <span>Search endpoints, parameters…</span>
      <kbd>⌘K</kbd>
    </button>
  </div>
  <div class="topbar-actions">
    <a class="spec-download" href="${esc(url('/openapi.json'))}" download title="Download the OpenAPI specification (import into Postman, Insomnia, …)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      <span>OpenAPI</span>
    </a>
    <button type="button" class="mcp-trigger js-only" data-mcp-open aria-haspopup="dialog" title="Connect an AI assistant (MCP)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5M9 8V2M15 8V2M6 8h12v5a6 6 0 0 1-12 0V8Z"/></svg>
      <span>MCP</span>
    </button>
${model.auth.length > 0 ? authButton() : ''}    <button type="button" class="theme-toggle js-only" data-theme-toggle aria-label="Toggle color scheme">
      <svg class="icon-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></svg>
      <svg class="icon-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
    </button>
  </div>
</header>
<div class="shell${hasCode ? '' : ' shell--no-code'}">
  <nav class="sidebar" aria-label="API navigation">
${sidebar(model, activeHref)}
  </nav>
  <div class="sidebar-resizer js-only" data-sidebar-resizer title="Drag to resize · double-click to reset" aria-hidden="true"></div>
  <main class="content" id="content">
${content}
  </main>
${hasCode ? `  <aside class="code-col" aria-label="Code examples">\n${codeColumn}\n  </aside>` : ''}
</div>
${drawer ? `${drawer}\n` : ''}${model.auth.length > 0 ? `${authDialog(model)}\n` : ''}${mcpDialog(model)}
${searchDialog()}
<script src="${esc(assets.js)}" defer></script>
${assets.customJs ? `<script src="${esc(assets.customJs)}" defer></script>\n` : ''}</body>
</html>
`;
}

function sidebar(model, activeHref) {
  const isHome = activeHref === '/';
  const isModels = activeHref.startsWith('/models/');
  const intro = `    <div class="nav-static">
      <a class="nav-page${isHome ? ' is-active' : ''}" href="${esc(url('/'))}"${isHome ? ' aria-current="page"' : ''}>Introduction</a>
      <a class="nav-page" href="${esc(url('/#authentication'))}">Authentication</a>
${model.models?.length ? `      <a class="nav-page${isModels ? ' is-active' : ''}" href="${esc(url('/models/'))}"${isModels ? ' aria-current="page"' : ''}>Models</a>\n` : ''}    </div>
    <input class="nav-filter js-only" type="search" placeholder="Filter endpoints…" aria-label="Filter endpoints" data-nav-filter autocomplete="off" spellcheck="false">
    <p class="nav-label" id="nav-ref-label">API Reference</p>`;
  const groups = model.nav.map((node) => navGroup(node, activeHref)).join('\n');
  return `${intro}\n    <div class="nav-tree" role="list" aria-labelledby="nav-ref-label">\n${groups}\n    </div>`;
}

function navGroup(node, activeHref, nested = false) {
  const containsActive = groupContains(node, activeHref);
  const links = node.endpoints.map((endpoint) => navLink(endpoint, activeHref)).join('\n');
  const children = node.children
    .map((child) => navGroup(child, activeHref, true))
    .join('\n');
  return `      <details class="nav-group${nested ? ' nav-group--nested' : ''}"${containsActive ? ' open' : ''}>
        <summary>
          <svg class="nav-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          <span>${esc(node.name)}</span>
        </summary>
        <div class="nav-group-body">
${links}${children ? `\n${children}` : ''}
        </div>
      </details>`;
}

function groupContains(node, activeHref) {
  return (
    node.endpoints.some((endpoint) => endpoint.href === activeHref) ||
    node.children.some((child) => groupContains(child, activeHref))
  );
}

function navLink(endpoint, activeHref) {
  const isActive = endpoint.href === activeHref;
  const tooltip = `${endpoint.method} ${endpoint.path} — ${endpoint.title}`;
  return `          <a class="nav-endpoint${isActive ? ' is-active' : ''}" href="${esc(url(endpoint.href))}" title="${esc(tooltip)}"${isActive ? ' aria-current="page"' : ''}>
            ${methodBadge(endpoint.method)}
            <span class="nav-endpoint-title">${esc(endpoint.title)}</span>
          </a>`;
}

/** Topbar entry point for the global authorization dialog. */
function authButton() {
  return `    <button type="button" class="auth-trigger js-only" data-auth-open aria-haspopup="dialog">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <span>Authorize</span>
      <span class="auth-dot" data-auth-dot aria-hidden="true"></span>
    </button>
`;
}

/**
 * Global authorization: one bearer token, stored in localStorage, applied to
 * every try-it request. Rendered on every page so it can be configured before
 * opening any endpoint.
 */
function authDialog(model) {
  const scheme = model.auth[0];
  const label = scheme?.bearerFormat ? `Bearer token (${scheme.bearerFormat})` : 'Bearer token';
  return `<dialog class="auth-dialog" data-auth-dialog aria-label="API authorization">
  <form method="dialog" class="auth-box">
    <header class="auth-head">
      <h2 class="auth-title">Authorization</h2>
      <button type="button" class="tryit-close" data-auth-close aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>
    <p class="auth-hint">Sent as <code>Authorization: Bearer …</code> with every try-it request. Stored only in this browser.</p>
    <div class="tryit-field">
      <label class="tryit-label" for="auth-token">${esc(label)}</label>
      <div class="auth-tokenwrap">
        <input class="tryit-input" type="password" id="auth-token" data-auth-token placeholder="API_TOKEN" autocomplete="off" spellcheck="false">
        <button type="button" class="auth-eye" data-auth-eye aria-label="Show token" aria-pressed="false">
          <svg class="auth-eye-show" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg class="auth-eye-hide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 8 10 8a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
        </button>
      </div>
    </div>
    <footer class="auth-foot">
      <button type="button" class="auth-clear" data-auth-clear>Clear</button>
      <button type="submit" class="tryit-send">Done</button>
    </footer>
  </form>
</dialog>`;
}

/**
 * "Connect an AI assistant": the docs are also an MCP server (see
 * build/mcp.mjs). Snippets are rendered against a placeholder host, which
 * 10-app.js swaps for the real origin when the dialog opens.
 */
function mcpDialog(model) {
  const snippets = mcpClientSnippets(model);
  const tabs = [
    { id: 'mcp-vscode', label: 'VS Code', code: highlight(snippets.vscode, 'json'), checked: true, hint: '.vscode/mcp.json' },
    { id: 'mcp-cursor', label: 'Cursor', code: highlight(snippets.cursor, 'json'), hint: '.cursor/mcp.json' },
    { id: 'mcp-claude', label: 'Claude Code', code: highlight(snippets.claudeCode, 'bash'), hint: 'terminal' },
    { id: 'mcp-json', label: 'Other', code: highlight(snippets.generic, 'json'), hint: 'mcpServers JSON' },
  ];
  return `<dialog class="auth-dialog mcp-dialog" data-mcp-dialog data-mcp-placeholder="${esc(snippets.origin)}" aria-label="Connect an AI assistant">
  <form method="dialog" class="auth-box">
    <header class="auth-head">
      <h2 class="auth-title">Connect an AI assistant</h2>
      <button type="button" class="tryit-close" data-mcp-close aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>
    <p class="auth-hint">This documentation is also a <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener">Model Context Protocol</a> server. Connected editors can search the endpoints and read their parameters, models and examples while they write code.</p>
    <div class="tryit-field">
      <span class="tryit-label">Server URL</span>
      <div class="mcp-url">
        <code>${esc(snippets.endpoint)}</code>
        ${copyButton(snippets.endpoint, 'Copy server URL')}
      </div>
    </div>
    ${codePanel({ groupId: 'mcp-client', title: '<span class="code-panel-label">Client configuration</span>', tabs, ariaLabel: 'MCP client configuration' })}
    <footer class="auth-foot">
      <button type="submit" class="tryit-send">Done</button>
    </footer>
  </form>
</dialog>`;
}

function searchDialog() {
  return `<dialog class="search-dialog" data-search-dialog>
  <div class="search-box">
    <input type="search" placeholder="Search endpoints…" aria-label="Search endpoints" data-search-input autocomplete="off" role="combobox" aria-expanded="true" aria-controls="search-listbox" aria-autocomplete="list">
    <ul class="search-results" data-search-results id="search-listbox" role="listbox" aria-label="Search results"></ul>
    <p class="search-empty" data-search-empty hidden role="status">No results. Try a different term — path, name, or parameter.</p>
    <footer class="search-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
      <span><kbd>↵</kbd> Open</span>
      <span><kbd>Esc</kbd> Close</span>
    </footer>
  </div>
</dialog>`;
}
