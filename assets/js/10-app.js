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

  // ---- Global authorization: credentials per security scheme ----
  // { [schemeId]: { token | user, pass | key } } in localStorage. The try-it
  // runtime reads it through window.atlasAuth to authorize each request.
  const AUTH_KEY = 'atlas:auth';
  const LEGACY_TOKEN_KEY = 'tryit:token';
  let schemes = [];
  try {
    schemes = JSON.parse(document.body.dataset.authSchemes || '[]');
  } catch {
    schemes = [];
  }

  function readAuth() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (saved && typeof saved === 'object') return saved;
      // One-time migration of the single bearer token earlier versions kept.
      const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
      const target = schemes.find((scheme) => usesToken(scheme));
      return legacy && target ? { [target.id]: { token: legacy } } : {};
    } catch {
      return {};
    }
  }

  let auth = readAuth();

  function usesToken(scheme) {
    return scheme.type === 'oauth2' || scheme.type === 'openIdConnect' || (scheme.type === 'http' && scheme.scheme !== 'basic');
  }

  function isConfigured(scheme) {
    const value = auth[scheme.id] ?? {};
    if (scheme.type === 'apiKey') return Boolean(value.key);
    if (scheme.type === 'http' && scheme.scheme === 'basic') return Boolean(value.user || value.pass);
    return Boolean(value.token);
  }

  function saveAuth() {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      /* Storage blocked — credentials last for this page only. */
    }
    refreshAuthUI();
  }

  /**
   * First security alternative whose schemes are all configured, applied to
   * a request under construction. `security` is [[schemeId, …], …];
   * an empty alternative means anonymous access is allowed.
   */
  function applyAuth(security, request) {
    const byId = new Map(schemes.map((scheme) => [scheme.id, scheme]));
    const usable = (security || []).find(
      (alternative) => alternative.length > 0 && alternative.every((id) => byId.has(id) && isConfigured(byId.get(id))),
    );
    if (!usable) return null;
    for (const id of usable) {
      const scheme = byId.get(id);
      const value = auth[id];
      if (scheme.type === 'apiKey') {
        if (scheme.location === 'header') request.headers[scheme.name] = value.key;
        else if (scheme.location === 'query') request.query.set(scheme.name, value.key);
        else if (scheme.location === 'cookie') request.credentials = 'include';
      } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
        const raw = `${value.user ?? ''}:${value.pass ?? ''}`;
        request.headers.Authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(raw)))}`;
      } else {
        request.headers.Authorization = `Bearer ${value.token}`;
      }
    }
    return usable;
  }

  function describe(security) {
    const byId = new Map(schemes.map((scheme) => [scheme.id, scheme]));
    const usable = (security || []).find(
      (alternative) => alternative.length > 0 && alternative.every((id) => byId.has(id) && isConfigured(byId.get(id))),
    );
    return usable ? usable.join(' + ') : '';
  }

  // ---- WS-Security for SOAP operations (header built by the try-it runtime) ----
  const WSSE_KEY = 'atlas:wsse';
  let wsse = {};
  try {
    wsse = JSON.parse(localStorage.getItem(WSSE_KEY) || '{}') || {};
  } catch {
    wsse = {};
  }

  function saveWsse() {
    try {
      localStorage.setItem(WSSE_KEY, JSON.stringify(wsse));
    } catch {
      /* Storage blocked — settings last for this page only. */
    }
    refreshWsseUI();
  }

  function wsseConfigured() {
    return Boolean(wsse.user || wsse.token);
  }

  function refreshWsseUI() {
    const state = document.querySelector('[data-wsse-state]');
    if (state) state.textContent = wsseConfigured() ? 'Set' : '';
    for (const row of document.querySelectorAll('[data-wsse-row]')) {
      const base = row.getAttribute('title') || row.textContent;
      row.textContent = wsseConfigured() ? `${base} ✓` : `${base} · not set`;
      row.classList.toggle('is-set', wsseConfigured());
    }
  }

  for (const input of document.querySelectorAll('[data-wsse-field]')) {
    const name = input.dataset.wsseField;
    if (input.type === 'checkbox') input.checked = Boolean(wsse[name]);
    else if (wsse[name] !== undefined) input.value = wsse[name];
    const update = () => {
      wsse[name] = input.type === 'checkbox' ? input.checked : input.value;
      saveWsse();
    };
    input.addEventListener('input', update);
    input.addEventListener('change', update);
  }
  refreshWsseUI();

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-sts-request]')) requestStsToken();
  });

  const escapeXml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /**
   * WS-Trust Issue against the STS, authenticated with a UsernameToken
   * (PasswordText — the usual bootstrap). The issued token (whatever sits in
   * RequestedSecurityToken: SAML assertion, SecurityContextToken, …) is
   * stored as XML and placed into wsse:Security of later SOAP requests.
   */
  async function requestStsToken() {
    const status = document.querySelector('[data-sts-status]');
    const url = wsse.stsUrl;
    if (!url) {
      status.textContent = 'Enter the STS address first';
      return;
    }
    const trust = wsse.stsVersion === '2005' ? 'http://schemas.xmlsoap.org/ws/2005/02/trust' : 'http://docs.oasis-open.org/ws-sx/ws-trust/200512';
    const soap12 = wsse.stsSoap === '1.2';
    const envNs = soap12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/';
    const action = `${trust}/RST/Issue`;
    const tokenType = wsse.stsTokenType || (wsse.stsVersion === '2005' ? 'http://schemas.xmlsoap.org/ws/2005/02/sc/sct' : '');
    const appliesTo = wsse.stsAppliesTo
      ? `<wsp:AppliesTo xmlns:wsp="http://schemas.xmlsoap.org/ws/2004/09/policy"><wsa:EndpointReference><wsa:Address>${escapeXml(wsse.stsAppliesTo)}</wsa:Address></wsa:EndpointReference></wsp:AppliesTo>`
      : '';
    const envelope = `<soap:Envelope xmlns:soap="${envNs}" xmlns:wsa="http://www.w3.org/2005/08/addressing" xmlns:wst="${trust}">
  <soap:Header>
    <wsa:Action>${action}</wsa:Action>
    <wsa:To>${escapeXml(url)}</wsa:To>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(wsse.user)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(wsse.pass)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    <wst:RequestSecurityToken>
      ${tokenType ? `<wst:TokenType>${escapeXml(tokenType)}</wst:TokenType>` : ''}
      <wst:RequestType>${trust}/Issue</wst:RequestType>
      ${appliesTo}
    </wst:RequestSecurityToken>
  </soap:Body>
</soap:Envelope>`;
    const headers = soap12
      ? { 'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"` }
      : { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${action}"` };
    status.textContent = 'Requesting…';
    try {
      const response = await fetch(url, { method: 'POST', headers, body: envelope });
      const doc = new DOMParser().parseFromString(await response.text(), 'application/xml');
      const holder = [...doc.getElementsByTagNameNS('*', 'RequestedSecurityToken')][0];
      const token = holder && [...holder.children][0];
      if (!token) {
        const fault = [...doc.getElementsByTagNameNS('*', 'faultstring'), ...doc.getElementsByTagNameNS('*', 'Text')][0];
        status.textContent = `Failed: ${fault?.textContent?.trim() || `HTTP ${response.status}, no token in the response`}`;
        return;
      }
      wsse.token = new XMLSerializer().serializeToString(token);
      saveWsse();
      const area = document.querySelector('[data-wsse-field="token"]');
      if (area) area.value = wsse.token;
      status.textContent = `Token received (${token.localName})`;
    } catch {
      status.textContent = 'Network or CORS error — the STS must allow requests from this origin';
    }
  }

  window.atlasAuth = { apply: applyAuth, describe, wsse: () => wsse };

  function refreshAuthUI() {
    const any = schemes.some(isConfigured);
    document.querySelector('[data-auth-dot]')?.classList.toggle('is-set', any);
    for (const state of document.querySelectorAll('[data-auth-state]')) {
      const panel = state.closest('[data-tryit]');
      let security = [];
      try {
        security = JSON.parse(panel?.dataset.security || '[]');
      } catch {
        security = [];
      }
      const used = describe(security);
      state.textContent = used ? `${used} ✓` : 'Not set';
      state.classList.toggle('is-set', Boolean(used));
    }
    for (const section of document.querySelectorAll('[data-auth-section]')) {
      const scheme = schemes.find((entry) => entry.id === section.dataset.authSection);
      const state = section.querySelector('[data-auth-section-state]');
      if (scheme && state) state.textContent = isConfigured(scheme) ? 'Set' : '';
    }
  }

  refreshAuthUI();

  const authDialog = document.querySelector('[data-auth-dialog]');
  function fillAuthInputs() {
    for (const input of authDialog.querySelectorAll('[data-auth-scheme]')) {
      input.value = auth[input.dataset.authScheme]?.[input.dataset.authField] ?? '';
    }
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-auth-open]') && authDialog) {
      fillAuthInputs();
      // Expand what matters here: the schemes this page's endpoint accepts,
      // plus any already configured; fold the rest.
      let accepted = [];
      try {
        accepted = JSON.parse(document.querySelector('[data-tryit]')?.dataset.security || '[]').flat();
      } catch {
        accepted = [];
      }
      const sections = [...authDialog.querySelectorAll('[data-auth-section]')];
      const relevant = (section) => {
        const scheme = schemes.find((entry) => entry.id === section.dataset.authSection);
        return accepted.includes(section.dataset.authSection) || (scheme && isConfigured(scheme));
      };
      // On a SOAP operation only WS-Security applies.
      const soapPage = document.querySelector('[data-tryit]')?.dataset.wsse !== undefined;
      const wsseSection = authDialog.querySelector('[data-wsse-section]');
      if (soapPage && wsseSection) {
        for (const section of sections) section.open = false;
        wsseSection.open = true;
      } else if (sections.some(relevant)) {
        for (const section of sections) section.open = relevant(section);
      }
      authDialog.showModal();
      authDialog.querySelector('[data-auth-section][open] [data-auth-scheme]')?.focus();
    }
    if (event.target.closest('[data-auth-close]')) authDialog?.close();
    const eye = event.target.closest('[data-auth-eye]');
    if (eye) {
      const input = eye.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.classList.toggle('is-visible', show);
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? 'Hide value' : 'Show value');
    }
    if (event.target.closest('[data-auth-clear]') && authDialog) {
      auth = {};
      fillAuthInputs();
      saveAuth();
    }
    const oauth = event.target.closest('[data-oauth-request]');
    if (oauth) requestOAuthToken(oauth.closest('[data-oauth-flow]'));
  });

  authDialog?.addEventListener('input', (event) => {
    const { authScheme, authField } = event.target.dataset ?? {};
    if (!authScheme) return;
    auth[authScheme] = { ...(auth[authScheme] ?? {}), [authField]: event.target.value };
    saveAuth();
  });

  /**
   * OAuth 2.0 client-credentials / password grant against the flow's token
   * URL. The token endpoint must allow CORS from the docs origin — most do
   * for exactly this purpose; when it does not, the error says so.
   */
  async function requestOAuthToken(flow) {
    const status = flow.querySelector('[data-oauth-status]');
    const field = (name) => flow.querySelector(`[data-oauth-field="${name}"]`)?.value ?? '';
    const scopes = [...flow.querySelectorAll('[data-oauth-scope]:checked')].map((box) => box.value);
    const body = new URLSearchParams({ grant_type: flow.dataset.oauthFlow === 'password' ? 'password' : 'client_credentials' });
    if (flow.dataset.oauthFlow === 'password') {
      body.set('username', field('username'));
      body.set('password', field('password'));
    }
    if (scopes.length) body.set('scope', scopes.join(' '));
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    const raw = `${field('client_id')}:${field('client_secret')}`;
    headers.Authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(raw)))}`;
    status.textContent = 'Requesting…';
    try {
      const response = await fetch(flow.dataset.tokenUrl, { method: 'POST', headers, body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        status.textContent = `Failed: ${data.error_description || data.error || response.status}`;
        return;
      }
      const schemeId = flow.dataset.authSchemeRef;
      auth[schemeId] = { ...(auth[schemeId] ?? {}), token: data.access_token };
      saveAuth();
      fillAuthInputs();
      status.textContent = data.expires_in ? `Token received · expires in ${data.expires_in}s` : 'Token received';
    } catch {
      status.textContent = 'Network or CORS error — the token URL must allow requests from this origin';
    }
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
  const LANG_IDS = ['curl', 'httpie', 'javascript', 'guzzle', 'laravel', 'php', 'python', 'httpx', 'go', 'ruby', 'java', 'csharp'];

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
