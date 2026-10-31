import { esc, markdownHeadings, mdInline } from '../text.mjs';
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
<link rel="icon" href="${assets.favicon ? esc(assets.favicon) : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='7' fill='%235b5bd6'/%3E%3C/svg%3E"}">
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
<body data-auth-schemes="${esc(JSON.stringify(model.auth.map(({ id, type, scheme, location, parameterName }) => ({ id, type, scheme, location, name: parameterName }))))}" data-tryit-js="${esc(assets.tryitJs)}" data-tryit-css="${esc(assets.tryitCss)}" data-search-js="${esc(assets.searchJs)}" data-search-index="${esc(assets.searchIndex)}">
<a class="skip-link" href="#content">Skip to content</a>
<input class="nav-toggle-input" type="checkbox" id="nav-toggle" aria-hidden="true" tabindex="-1">
<header class="topbar">
  <label class="nav-toggle" for="nav-toggle" aria-label="Toggle navigation" title="Menu">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
  </label>
  <a class="topbar-brand" href="${esc(url('/'))}">
    ${assets.logo ? `<img class="topbar-logo-img" src="${esc(assets.logo)}" alt="" height="24">` : '<span class="topbar-logo" aria-hidden="true"></span>'}
    <span class="topbar-title">${esc(model.title)}</span>
    ${model.version ? `<span class="topbar-version">v${esc(model.version)}</span>` : ''}
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
  // Only the description's outermost heading level: a table of contents, not an outline.
  const allHeadings = markdownHeadings(model.descriptionHtml);
  const topLevel = Math.min(...allHeadings.map((heading) => heading.level));
  const headings = allHeadings.filter((heading) => heading.level === topLevel);
  const toc = headings.length
    ? `\n      <div class="nav-toc">\n${headings
        .map((heading) => `        <a class="nav-toc-link" href="${esc(url(`/#${heading.id}`))}">${esc(heading.text)}</a>`)
        .join('\n')}\n      </div>`
    : '';
  const intro = `    <div class="nav-static">
      <a class="nav-page${isHome ? ' is-active' : ''}" href="${esc(url('/'))}"${isHome ? ' aria-current="page"' : ''}>Introduction</a>${toc}
${model.auth.length ? `      <a class="nav-page" href="${esc(url('/#authentication'))}">Authentication</a>\n` : ''}${model.models?.length ? `      <a class="nav-page${isModels ? ' is-active' : ''}" href="${esc(url('/models/'))}"${isModels ? ' aria-current="page"' : ''}>Models</a>\n` : ''}    </div>
    <input class="nav-filter js-only" type="search" placeholder="Filter endpoints…" aria-label="Filter endpoints" data-nav-filter autocomplete="off" spellcheck="false">`;
  const sections = model.nav
    .map((section, index) => {
      const labelId = `nav-section-${index}`;
      const groups = section.nodes.map((node) => navGroup(node, activeHref)).join('\n');
      return `    <p class="nav-label" id="${labelId}">${esc(section.name)}</p>
    <div class="nav-tree" role="list" aria-labelledby="${labelId}">
${groups}
    </div>`;
    })
    .join('\n');
  const webhooks = model.webhooks?.length
    ? `
    <p class="nav-label" id="nav-webhooks-label">Webhooks</p>
    <div class="nav-tree" role="list" aria-labelledby="nav-webhooks-label">
${model.webhooks.map((hook) => navLink(hook, activeHref, true)).join('\n')}
    </div>`
    : '';
  return `${intro}\n${sections}${webhooks}`;
}

function navGroup(node, activeHref, nested = false) {
  const containsActive = groupContains(node, activeHref);
  const isTagPage = node.href !== null && node.href === activeHref;
  const links = node.endpoints.map((endpoint) => navLink(endpoint, activeHref)).join('\n');
  const children = node.children
    .map((child) => navGroup(child, activeHref, true))
    .join('\n');
  const overview = node.href
    ? `          <a class="nav-overview${isTagPage ? ' is-active' : ''}" href="${esc(url(node.href))}"${isTagPage ? ' aria-current="page"' : ''}>Overview</a>\n`
    : '';
  return `      <details class="nav-group${nested ? ' nav-group--nested' : ''}"${containsActive || isTagPage ? ' open' : ''}>
        <summary>
          <svg class="nav-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          <span>${esc(node.name)}</span>
        </summary>
        <div class="nav-group-body">
${node.description ? overview : ''}${links}${children ? `\n${children}` : ''}
        </div>
      </details>`;
}

function groupContains(node, activeHref) {
  return (
    node.endpoints.some((endpoint) => endpoint.href === activeHref) ||
    node.children.some((child) => groupContains(child, activeHref))
  );
}

function navLink(endpoint, activeHref, topLevel = false) {
  const isActive = endpoint.href === activeHref;
  const tooltip = `${endpoint.method} ${endpoint.path} — ${endpoint.title}${endpoint.deprecated ? ' (deprecated)' : ''}`;
  const classes = ['nav-endpoint', isActive ? 'is-active' : '', endpoint.deprecated ? 'is-deprecated' : '', topLevel ? 'nav-endpoint--top' : '']
    .filter(Boolean)
    .join(' ');
  return `          <a class="${classes}" href="${esc(url(endpoint.href))}" title="${esc(tooltip)}"${isActive ? ' aria-current="page"' : ''}>
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
 * Global authorization: one section per security scheme in the spec, values
 * stored in localStorage and applied by the try-it console to every request
 * whose security requirements they satisfy. Rendered on every page so it can
 * be configured before opening any endpoint.
 */
function authDialog(model) {
  const sections = model.auth
    .filter((scheme) => scheme.type !== 'mutualTLS')
    .map((scheme, index) => authSection(scheme, index === 0))
    .join('\n');
  return `<dialog class="auth-dialog" data-auth-dialog aria-label="API authorization">
  <form method="dialog" class="auth-box">
    <header class="auth-head">
      <h2 class="auth-title">Authorization</h2>
      <button type="button" class="tryit-close" data-auth-close aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>
    <p class="auth-hint">Credentials are applied to every try-it request whose endpoint accepts them. Stored only in this browser.</p>
${sections}
    <footer class="auth-foot">
      <button type="button" class="auth-clear" data-auth-clear>Clear all</button>
      <button type="submit" class="tryit-send">Done</button>
    </footer>
  </form>
</dialog>`;
}

function authSection(scheme, first) {
  const id = esc(scheme.id);
  const secret = (fieldName, label, placeholder) => `      <div class="tryit-field">
        <label class="tryit-label" for="auth-${id}-${fieldName}">${esc(label)}</label>
        <div class="auth-tokenwrap">
          <input class="tryit-input" type="password" id="auth-${id}-${fieldName}" data-auth-scheme="${id}" data-auth-field="${fieldName}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
          ${eyeButton()}
        </div>
      </div>`;
  const plain = (fieldName, label, placeholder) => `      <div class="tryit-field">
        <label class="tryit-label" for="auth-${id}-${fieldName}">${esc(label)}</label>
        <input class="tryit-input" type="text" id="auth-${id}-${fieldName}" data-auth-scheme="${id}" data-auth-field="${fieldName}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
      </div>`;

  let fields;
  let hint;
  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    hint = 'Sent as <code>Authorization: Basic …</code>';
    fields = [plain('user', 'Username', 'username'), secret('pass', 'Password', 'password')].join('\n');
  } else if (scheme.type === 'apiKey') {
    const where = { header: 'header', query: 'query parameter', cookie: 'cookie' }[scheme.location] ?? scheme.location;
    hint = `Sent as the <code>${esc(scheme.parameterName)}</code> ${esc(where)}`;
    if (scheme.location === 'cookie') hint += ' — browsers only send cookies set by the API itself, so this works when the docs share its domain';
    fields = secret('key', 'API key', scheme.parameterName ?? 'key');
  } else if (scheme.type === 'oauth2') {
    hint = 'Sent as <code>Authorization: Bearer …</code>';
    fields = [secret('token', 'Access token', 'paste a token or request one below'), oauthFlows(scheme)].filter(Boolean).join('\n');
  } else if (scheme.type === 'openIdConnect') {
    hint = `Sent as <code>Authorization: Bearer …</code>${scheme.openIdConnectUrl ? ` · <a href="${esc(scheme.openIdConnectUrl)}" target="_blank" rel="noopener">discovery document</a>` : ''}`;
    fields = secret('token', 'ID / access token', 'token');
  } else {
    hint = 'Sent as <code>Authorization: Bearer …</code>';
    fields = secret('token', scheme.label, 'API_TOKEN');
  }
  return `    <details class="auth-scheme" data-auth-section="${id}"${first ? ' open' : ''}>
      <summary class="auth-scheme-head">
        <span class="auth-scheme-name">${esc(scheme.label)}</span>
        <code class="auth-scheme-id">${id}</code>
        <span class="auth-scheme-state" data-auth-section-state></span>
      </summary>
      <div class="auth-scheme-body">
      <p class="auth-hint auth-hint--scheme">${hint}</p>
      ${scheme.description ? `<p class="auth-hint auth-hint--scheme">${mdInline(scheme.description)}</p>` : ''}
${fields}
      </div>
    </details>`;
}

/**
 * OAuth 2.0: the client-credentials and password grants can be completed
 * right here (a form POST to the token URL); interactive flows link out to
 * the authorization URL, and the token they produce is pasted above.
 */
function oauthFlows(scheme) {
  const flows = scheme.flows ?? {};
  const parts = [];
  for (const [name, flow] of Object.entries(flows)) {
    const scopes = Object.entries(flow.scopes ?? {});
    const scopeList = scopes.length
      ? `<div class="auth-scopes">${scopes
          .map(
            ([scope, description]) =>
              `<label class="auth-scope" title="${esc(description)}"><input type="checkbox" value="${esc(scope)}" data-oauth-scope checked> <code>${esc(scope)}</code></label>`,
          )
          .join('')}</div>`
      : '';
    if ((name === 'clientCredentials' || name === 'password') && flow.tokenUrl) {
      const extra = name === 'password'
        ? `<input class="tryit-input" type="text" data-oauth-field="username" placeholder="username" autocomplete="off">
          <input class="tryit-input" type="password" data-oauth-field="password" placeholder="password" autocomplete="off">`
        : '';
      parts.push(`      <details class="auth-flow" data-oauth-flow="${esc(name)}" data-token-url="${esc(flow.tokenUrl)}" data-auth-scheme-ref="${esc(scheme.id)}">
        <summary>${name === 'password' ? 'Password grant' : 'Client credentials'} · <code>${esc(flow.tokenUrl)}</code></summary>
        <div class="auth-flow-body">
          <input class="tryit-input" type="text" data-oauth-field="client_id" placeholder="client_id" autocomplete="off" spellcheck="false">
          <input class="tryit-input" type="password" data-oauth-field="client_secret" placeholder="client_secret" autocomplete="off">
          ${extra}
          ${scopeList}
          <div class="auth-flow-actions"><button type="button" class="tryit-tool" data-oauth-request>Get token</button><span class="auth-flow-status" data-oauth-status role="status"></span></div>
        </div>
      </details>`);
    } else if (flow.authorizationUrl) {
      parts.push(`      <p class="auth-hint auth-hint--scheme">${name === 'implicit' ? 'Implicit' : 'Authorization code'} flow: <a href="${esc(flow.authorizationUrl)}" target="_blank" rel="noopener">authorize</a>${flow.tokenUrl ? ` · token URL <code>${esc(flow.tokenUrl)}</code>` : ''}${scopes.length ? ` · scopes ${scopes.map(([scope]) => `<code>${esc(scope)}</code>`).join(' ')}` : ''}</p>`);
    }
  }
  return parts.join('\n');
}

function eyeButton() {
  return `<button type="button" class="auth-eye" data-auth-eye aria-label="Show value" aria-pressed="false">
            <svg class="auth-eye-show" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            <svg class="auth-eye-hide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 8 10 8a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
          </button>`;
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
