// Try-it console runtime. Loaded lazily by the app shell the first time a
// try-it panel is opened. Reads the build-generated form, sends the request
// with fetch and renders the response — all DOM is built with createElement,
// nothing from the network is ever parsed as HTML.
(() => {
  'use strict';

  const STORE_SERVER = 'tryit:server';
  const STORE_CUSTOM_SERVERS = 'tryit:servers';
  const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

  function stored(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function persist(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Storage blockiert — Wert gilt nur für diese Seite. */
    }
  }

  // ---- Server picker (token is global, see app.js) ----
  // Select lists the spec's servers plus previously used custom URLs;
  // "Custom URL…" reveals a free-text input. The hidden input [data-t=server]
  // always holds the active base URL.

  function customServers() {
    try {
      return JSON.parse(stored(STORE_CUSTOM_SERVERS) || '[]');
    } catch {
      return [];
    }
  }

  for (const panel of document.querySelectorAll('[data-tryit]')) {
    const select = panel.querySelector('[data-server-select]');
    const input = panel.querySelector('[data-t="server"]');
    if (!select || !input) continue;

    const customEntry = select.querySelector('option[value="__custom"]');
    for (const url of customServers()) {
      if ([...select.options].some((option) => option.value === url)) continue;
      const option = document.createElement('option');
      option.value = url;
      option.textContent = url;
      select.insertBefore(option, customEntry);
    }

    const saved = stored(STORE_SERVER);
    if (saved) {
      input.value = saved;
      if ([...select.options].some((option) => option.value === saved)) {
        select.value = saved;
      } else {
        select.value = '__custom';
        input.hidden = false;
      }
    }

    // Templated servers: substitute {variables} from their controls.
    const varsFor = (template) => [...panel.querySelectorAll('[data-server-vars]')].find((box) => box.dataset.serverVars === template);
    const applyTemplate = () => {
      const option = select.selectedOptions[0];
      for (const box of panel.querySelectorAll('[data-server-vars]')) box.hidden = true;
      const template = option?.dataset.template;
      if (!template) return false;
      const box = varsFor(template);
      if (box) box.hidden = false;
      let url = template;
      for (const control of box?.querySelectorAll('[data-server-var]') ?? []) {
        url = url.replaceAll(`{${control.dataset.serverVar}}`, control.value);
      }
      input.value = url.replace(/\/$/, '');
      return true;
    };
    for (const control of panel.querySelectorAll('[data-server-var]')) {
      control.addEventListener('input', applyTemplate);
      control.addEventListener('change', applyTemplate);
    }
    if (!saved) applyTemplate();

    select.addEventListener('change', () => {
      if (applyTemplate()) {
        input.hidden = true;
        persist(STORE_SERVER, select.value);
        return;
      }
      if (select.value === '__custom') {
        input.hidden = false;
        input.value = '';
        input.focus();
      } else {
        input.hidden = true;
        input.value = select.value;
        persist(STORE_SERVER, select.value);
      }
    });
  }

  document.addEventListener('input', (event) => {
    if (event.target.dataset?.t === 'server') persist(STORE_SERVER, event.target.value);
  });

  // ---- Per-endpoint value persistence + history ----
  // Entered values survive closing the drawer and page reloads; every sent
  // request lands in a small per-endpoint history with one-click restore.

  const FIELD_KINDS = ['path', 'query', 'header', 'mp', 'json'];

  function endpointKey(panel, prefix) {
    return `tryit:${prefix}:${panel.dataset.method} ${panel.dataset.path}`;
  }

  function snapshotValues(panel) {
    const values = {};
    for (const input of fieldInputs(panel)) {
      values[`${input.dataset.t}:${input.dataset.name ?? ''}`] = input.value;
    }
    return values;
  }

  function applyValues(panel, values) {
    for (const input of fieldInputs(panel)) {
      const saved = values[`${input.dataset.t}:${input.dataset.name ?? ''}`];
      if (saved === undefined) continue;
      if (input instanceof HTMLSelectElement && ![...input.options].some((option) => option.value === saved)) continue;
      input.value = saved;
    }
  }

  function fieldInputs(panel) {
    return [...panel.querySelectorAll('[data-t]')].filter(
      (input) => FIELD_KINDS.includes(input.dataset.t) && input.type !== 'file',
    );
  }

  function readJson(key) {
    try {
      return JSON.parse(stored(key) || 'null');
    } catch {
      return null;
    }
  }

  // Capture build-time defaults before restoring, so Reset can return to them.
  const defaults = new WeakMap();
  for (const panel of document.querySelectorAll('[data-tryit]')) {
    defaults.set(panel, snapshotValues(panel));
    const saved = readJson(endpointKey(panel, 'vals'));
    if (saved) applyValues(panel, saved);
    renderHistory(panel);
    syncJsonEditor(panel);
  }

  document.addEventListener('input', (event) => {
    const panel = event.target.closest?.('[data-tryit]');
    if (!panel || !FIELD_KINDS.includes(event.target.dataset?.t ?? '')) return;
    persist(endpointKey(panel, 'vals'), JSON.stringify(snapshotValues(panel)));
  });

  document.addEventListener('click', (event) => {
    const reset = event.target.closest('[data-tryit-reset]');
    if (reset) {
      const panel = reset.closest('[data-tryit]');
      applyValues(panel, defaults.get(panel) ?? {});
      syncJsonEditor(panel);
      try {
        localStorage.removeItem(endpointKey(panel, 'vals'));
      } catch {
        /* Storage blockiert. */
      }
    }
    const restore = event.target.closest('[data-history-restore]');
    if (restore) {
      const panel = restore.closest('[data-tryit]');
      const entry = readJson(endpointKey(panel, 'hist'))?.[Number(restore.dataset.historyRestore)];
      if (entry) {
        applyValues(panel, entry.values);
        persist(endpointKey(panel, 'vals'), JSON.stringify(entry.values));
        syncJsonEditor(panel);
      }
    }
  });

  // ---- Live JSON highlighting for the body editor ----
  // The textarea's text is transparent; this paints the same content, colored,
  // into the <pre> layer behind it.

  function highlightJson(codeElement, text) {
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(JSON_TOKEN)) {
      if (match.index > last) fragment.append(text.slice(last, match.index));
      if (match[1] !== undefined) {
        fragment.append(el('span', match[2] ? 'tok-key' : 'tok-str', match[1]));
        if (match[2]) fragment.append(match[2]);
      } else if (match[3]) {
        fragment.append(el('span', 'tok-kw', match[3]));
      } else {
        fragment.append(el('span', 'tok-num', match[0]));
      }
      last = match.index + match[0].length;
    }
    // Trailing newline keeps the layer's height in step with the textarea.
    fragment.append(text.slice(last), '\n');
    codeElement.replaceChildren(fragment);
  }

  function syncJsonEditor(panel) {
    const textarea = panel.querySelector('.tryit-json');
    const code = panel.querySelector('.tryit-json-hl code');
    if (textarea && code) highlightJson(code, textarea.value);
  }

  document.addEventListener('input', (event) => {
    if (event.target.classList?.contains('tryit-json')) {
      syncJsonEditor(event.target.closest('[data-tryit]'));
    }
  });

  document.addEventListener(
    'scroll',
    (event) => {
      if (!event.target.classList?.contains('tryit-json')) return;
      const layer = event.target.closest('.tryit-jsonwrap')?.querySelector('.tryit-json-hl');
      if (layer) {
        layer.scrollTop = event.target.scrollTop;
        layer.scrollLeft = event.target.scrollLeft;
      }
    },
    true,
  );

  function recordHistory(panel, status, ms, url) {
    const entries = readJson(endpointKey(panel, 'hist')) ?? [];
    entries.unshift({ ts: Date.now(), status, ms, url, values: snapshotValues(panel) });
    persist(endpointKey(panel, 'hist'), JSON.stringify(entries.slice(0, 5)));
    renderHistory(panel);
  }

  function renderHistory(panel) {
    const box = panel.querySelector('[data-tryit-history]');
    const list = panel.querySelector('[data-tryit-history-list]');
    if (!box || !list) return;
    const entries = readJson(endpointKey(panel, 'hist')) ?? [];
    box.hidden = entries.length === 0;
    list.replaceChildren(
      ...entries.map((entry, index) => {
        const row = el('div', 'tryit-hist-row');
        const code = el('span', 'tryit-code', entry.status === 0 ? '—' : String(entry.status));
        code.dataset.class = entry.status === 0 ? '5' : String(Math.floor(entry.status / 100));
        const path = el('span', 'tryit-hist-url', entry.url.replace(/^https?:\/\/[^/]+/, ''));
        path.title = entry.url;
        const meta = el('span', 'tryit-hist-meta', `${timeAgo(entry.ts)} · ${entry.ms} ms`);
        const restore = el('button', 'tryit-tool', 'Restore');
        restore.type = 'button';
        restore.dataset.historyRestore = String(index);
        row.append(code, path, meta, restore);
        return row;
      }),
    );
  }

  function timeAgo(ts) {
    const seconds = Math.round((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }

  /** A custom URL that was actually sent to earns a slot in the list. */
  function rememberServer(panel, url) {
    const select = panel.querySelector('[data-server-select]');
    if (!url || !select) return;
    if ([...select.options].some((option) => option.value === url)) return;
    const customs = customServers().filter((entry) => entry !== url);
    customs.unshift(url);
    persist(STORE_CUSTOM_SERVERS, JSON.stringify(customs.slice(0, 5)));
    const option = document.createElement('option');
    option.value = url;
    option.textContent = url;
    select.insertBefore(option, select.querySelector('option[value="__custom"]'));
    select.value = url;
    panel.querySelector('[data-t="server"]').hidden = true;
  }

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('.tryit-form');
    if (!form) return;
    event.preventDefault();
    send(form.closest('[data-tryit]'));
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tryit-fill]');
    if (button) fillSamples(button.closest('[data-tryit]'), false);

    const copyAs = event.target.closest('[data-copy-as]');
    if (copyAs) {
      const panel = copyAs.closest('[data-tryit]');
      fillSamples(panel, true);
      copyFeedback(copyAs, requestSnippet(copyAs.dataset.copyAs, panel));
    }
  });

  function copyFeedback(button, text) {
    const label = button.textContent;
    const done = (message) => {
      button.textContent = message;
      setTimeout(() => {
        button.textContent = label;
      }, 1200);
    };
    if (!navigator.clipboard) return done('Failed');
    navigator.clipboard.writeText(text).then(() => done('Copied'), () => done('Failed'));
  }

  // ---- "Copy as" code generation from the live form state ----

  function requestSnippet(kind, panel) {
    const request = collectRequest(panel);
    const headers = Object.entries(request.headers);
    let json = null;
    const form = [];
    if (request.body instanceof FormData) {
      for (const [key, value] of request.body.entries()) {
        form.push([key, value instanceof File ? { file: value.name || 'file' } : String(value)]);
      }
    } else if (typeof request.body === 'string') {
      try {
        json = JSON.stringify(JSON.parse(request.body), null, 2);
      } catch {
        json = request.body;
      }
    }
    return SNIPPETS[kind]({ method: request.method, url: request.url, headers, json, form });
  }

  /** Indents every line except the first, for embedding literals in code. */
  function indentTail(text, pad) {
    return text.split('\n').join(`\n${pad}`);
  }

  const SNIPPETS = {
    curl({ method, url, headers, json, form }) {
      const lines = [`curl${method === 'GET' ? '' : ` -X ${method}`} "${url}"`];
      for (const [key, value] of headers) lines.push(`  -H "${key}: ${value}"`);
      if (json !== null) lines.push(`  -d '${json.replaceAll("'", "'\\''")}'`);
      for (const [key, value] of form) lines.push(`  -F "${key}=${value.file ? `@./${value.file}` : value}"`);
      return lines.join(' \\\n');
    },

    fetch({ method, url, headers, json, form }) {
      const parts = [];
      if (form.length) {
        parts.push('const form = new FormData();');
        for (const [key, value] of form) {
          parts.push(value.file ? `form.append(${JSON.stringify(key)}, fileInput.files[0]);` : `form.append(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
        }
        parts.push('');
      }
      parts.push(`const response = await fetch(${JSON.stringify(url)}, {`, `  method: "${method}",`, '  headers: {');
      for (const [key, value] of headers) parts.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
      parts.push('  },');
      if (json !== null) parts.push(`  body: JSON.stringify(${indentTail(json, '  ')}),`);
      if (form.length) parts.push('  body: form,');
      parts.push('});', '', 'const data = await response.json();');
      return parts.join('\n');
    },

    php({ method, url, headers, json, form }) {
      const options = [
        '    CURLOPT_RETURNTRANSFER => true,',
        ...(method === 'GET' ? [] : [`    CURLOPT_CUSTOMREQUEST => "${method}",`]),
        '    CURLOPT_HTTPHEADER => [',
        ...headers.map(([key, value]) => `        ${phpString(`${key}: ${value}`)},`),
        '    ],',
      ];
      if (json !== null) {
        options.push(`    CURLOPT_POSTFIELDS => <<<'JSON'\n${json}\nJSON,`);
      }
      if (form.length) {
        options.push(
          '    CURLOPT_POSTFIELDS => [',
          ...form.map(([key, value]) =>
            value.file
              ? `        ${phpString(key)} => new CURLFile("./${value.file}"),`
              : `        ${phpString(key)} => ${phpString(value)},`,
          ),
          '    ],',
        );
      }
      return [
        '<?php',
        '',
        `$ch = curl_init(${phpString(url)});`,
        'curl_setopt_array($ch, [',
        ...options,
        ']);',
        '',
        '$response = json_decode(curl_exec($ch), true);',
        'curl_close($ch);',
      ].join('\n');
    },

    python({ method, url, headers, json, form }) {
      const args = [`    ${pyString(url)},`, '    headers={'];
      for (const [key, value] of headers) args.push(`        ${pyString(key)}: ${pyString(value)},`);
      args.push('    },');
      if (json !== null) args.push(`    data='''${json.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}''',`);
      if (form.length) {
        const files = form.filter(([, value]) => value.file);
        const fields = form.filter(([, value]) => !value.file);
        if (files.length) {
          args.push(`    files={${files.map(([key, value]) => `${pyString(key)}: open("./${value.file}", "rb")`).join(', ')}},`);
        }
        if (fields.length) {
          args.push(`    data={${fields.map(([key, value]) => `${pyString(key)}: ${pyString(value)}`).join(', ')}},`);
        }
      }
      return ['import requests', '', `response = requests.${method.toLowerCase()}(`, ...args, ')', '', 'data = response.json()'].join('\n');
    },
  };

  function phpString(value) {
    return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')}"`;
  }

  function pyString(value) {
    return JSON.stringify(String(value));
  }

  /**
   * Fills empty inputs with the schema examples baked in at build time
   * (data-sample). With requiredOnly, only fields the API insists on are
   * touched — junk in optional filters would change what the API returns.
   */
  function fillSamples(panel, requiredOnly) {
    for (const input of panel.querySelectorAll('[data-t="path"], [data-t="query"], [data-t="header"], [data-t="mp"]')) {
      if (input.type === 'file' || input.value !== '') continue;
      if (requiredOnly && !input.dataset.req) continue;
      const sample = input.dataset.sample;
      if (!sample) continue;
      if (input instanceof HTMLSelectElement) {
        if ([...input.options].some((option) => option.value === sample)) input.value = sample;
      } else {
        input.value = sample;
      }
    }
  }

  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
    const panel = document.querySelector('dialog[data-tryit][open]');
    if (panel) {
      event.preventDefault();
      send(panel);
    }
  });

  // ---- Request assembly ----

  function collectRequest(panel) {
    const form = panel.querySelector('.tryit-form');
    const value = (selector) => form.querySelector(selector)?.value ?? '';

    let path = panel.dataset.path;
    for (const input of form.querySelectorAll('[data-t="path"]')) {
      const raw = input.value || `{${input.dataset.name}}`;
      path = path.replace(`{${input.dataset.name}}`, encodeURIComponent(raw));
    }

    const query = new URLSearchParams();
    for (const input of form.querySelectorAll('[data-t="query"]')) {
      if (input.value === '') continue;
      if (input.dataset.array) {
        // Specs often name array params "ids[]" already — don't double up.
        const key = input.dataset.name.endsWith('[]') ? input.dataset.name : `${input.dataset.name}[]`;
        for (const part of input.value.split(',').map((s) => s.trim()).filter(Boolean)) {
          query.append(key, part);
        }
      } else {
        query.append(input.dataset.name, input.value);
      }
    }

    const headers = { Accept: 'application/json' };
    for (const input of form.querySelectorAll('[data-t="header"]')) {
      if (input.value !== '') headers[input.dataset.name] = input.value;
    }
    // Credentials from the Authorize dialog, for the first security
    // alternative of this endpoint that is fully configured (see app.js).
    const authorized = { headers, query, credentials: undefined };
    let security = [];
    try {
      security = JSON.parse(panel.dataset.security || '[]');
    } catch {
      security = [];
    }
    window.atlasAuth?.apply(security, authorized);

    let body = null;
    const json = form.querySelector('[data-t="json"]');
    const multipart = form.querySelectorAll('[data-t="mp"]');
    const contentType = json?.dataset.contentType || 'application/json';
    if (json && json.value.trim() && panel.dataset.method !== 'GET' && /x-www-form-urlencoded/.test(contentType)) {
      // Edited as JSON for convenience, sent as a form.
      headers['Content-Type'] = contentType;
      try {
        const fields = JSON.parse(json.value);
        body = new URLSearchParams();
        for (const [key, value] of Object.entries(fields)) {
          for (const item of [value].flat()) body.append(key, typeof item === 'object' ? JSON.stringify(item) : String(item));
        }
        body = body.toString();
      } catch {
        body = json.value;
      }
    } else if (json && json.value.trim() && panel.dataset.method !== 'GET' && !/json/.test(contentType)) {
      headers['Content-Type'] = contentType;
      body = json.value;
    } else if (json && json.value.trim() && panel.dataset.method !== 'GET') {
      headers['Content-Type'] = contentType;
      body = json.value;
      try {
        body = JSON.stringify(JSON.parse(json.value));
      } catch {
        /* Send as-is; the API answers with its own validation error. */
      }
    } else if (multipart.length) {
      const data = new FormData();
      for (const input of multipart) {
        if (input.type === 'file') {
          for (const file of input.files ?? []) data.append(input.dataset.name, file);
        } else if (input.value !== '') {
          data.append(input.dataset.name, input.value);
        }
      }
      body = data; // fetch sets the multipart boundary itself
    }

    const base = value('[data-t="server"]').replace(/\/$/, '');
    const qs = query.toString();
    return { method: panel.dataset.method, url: `${base}${path}${qs ? `?${qs}` : ''}`, headers, body, credentials: authorized.credentials };
  }

  // ---- Send + response rendering ----

  function send(panel) {
    // Required fields the user left empty get their schema example — the
    // request would otherwise fail on trivially missing values.
    fillSamples(panel, true);
    rememberServer(panel, panel.querySelector('[data-t="server"]').value.replace(/\/$/, ''));
    const request = collectRequest(panel);
    const mount = panel.querySelector('[data-tryit-response]');
    const button = panel.querySelector('.tryit-send');
    button.disabled = true;
    mount.replaceChildren(el('div', 'tryit-pending', `Waiting for ${request.method}…`));

    const started = performance.now();
    fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      ...(request.credentials ? { credentials: request.credentials } : {}),
    })
      .then((response) =>
        response.text().then((text) => {
          const ms = Math.round(performance.now() - started);
          renderResponse(mount, response, text, ms);
          recordHistory(panel, response.status, ms, request.url);
        }),
      )
      .catch((error) => {
        renderFailure(mount, request.url, error);
        recordHistory(panel, 0, Math.round(performance.now() - started), request.url);
      })
      .finally(() => {
        button.disabled = false;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        mount.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      });
  }

  function el(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatBytes(count) {
    if (count < 1024) return `${count} B`;
    if (count < 1048576) return `${(count / 1024).toFixed(1)} KB`;
    return `${(count / 1048576).toFixed(2)} MB`;
  }

  function renderResponse(mount, response, text, ms) {
    let parsed;
    let isJson = false;
    try {
      parsed = JSON.parse(text);
      isJson = true;
    } catch {
      /* keep raw text */
    }

    const box = el('div', 'tryit-result');
    // Only the status line is announced — a large JSON tree in a live region
    // would be read out in full by screen readers.
    const status = el('div', 'tryit-status');
    status.setAttribute('role', 'status');
    const code = el('span', 'tryit-code', String(response.status));
    code.dataset.class = String(Math.floor(response.status / 100));
    status.append(
      code,
      el('span', 'tryit-statustext', response.statusText || ''),
      el('span', 'tryit-meta', `${ms} ms · ${formatBytes(new Blob([text]).size)}`),
    );
    box.append(status);

    if (text === '') {
      box.append(el('div', 'tryit-empty', 'No content'));
    } else if (isJson) {
      const tools = el('div', 'tryit-tools');
      tools.append(
        treeAction(box, 'Expand all', true),
        treeAction(box, 'Collapse all', false),
        copyAction(JSON.stringify(parsed, null, 2)),
      );
      box.append(tools, jsonNode(parsed, null, 0));
    } else {
      const tools = el('div', 'tryit-tools');
      tools.append(copyAction(text));
      box.append(tools, el('pre', 'tryit-raw', text));
    }

    const headerList = document.createElement('details');
    headerList.className = 'tryit-headers';
    const entries = [...response.headers.entries()];
    const summary = el('summary', null, `Headers (${entries.length})`);
    headerList.append(summary);
    for (const [key, value] of entries) {
      const row = el('div', 'tryit-hrow');
      row.append(el('span', 'tryit-hkey', key), el('span', 'tryit-hval', value));
      headerList.append(row);
    }
    box.append(headerList);
    mount.replaceChildren(box);
  }

  function renderFailure(mount, url, error) {
    const box = el('div', 'tryit-result');
    const status = el('div', 'tryit-status');
    const code = el('span', 'tryit-code', '—');
    code.dataset.class = '5';
    status.append(code, el('span', 'tryit-statustext', 'Request failed'));
    const hint = el(
      'div',
      'tryit-hint',
      `Couldn't reach ${url}. Usually CORS — the API must allow this origin (${location.origin}) — or the server URL is wrong. Browser: ${error?.message ?? ''}`,
    );
    box.append(status, hint);
    mount.replaceChildren(box);
  }

  function treeAction(box, label, open) {
    const button = el('button', 'tryit-tool', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      for (const node of box.querySelectorAll('details.tryit-node')) node.open = open;
    });
    return button;
  }

  function copyAction(text) {
    const button = el('button', 'tryit-tool', 'Copy');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (!navigator.clipboard) {
        button.textContent = 'Copy failed';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 1200);
        return;
      }
      navigator.clipboard
        .writeText(text)
        .then(() => {
          button.textContent = 'Copied';
        })
        .catch(() => {
          button.textContent = 'Copy failed';
        })
        .finally(() => {
          setTimeout(() => {
            button.textContent = 'Copy';
          }, 1200);
        });
    });
    return button;
  }

  // Collapsible JSON tree; scalars reuse the highlighter's token colors.
  function jsonNode(value, key, depth) {
    const isArray = Array.isArray(value);
    if (value === null || typeof value !== 'object') {
      const row = el('div', 'tryit-leaf');
      if (key !== null) row.append(el('span', 'tok-key', jsonKey(key)), el('span', 'tryit-colon', ': '));
      row.append(scalar(value));
      return row;
    }

    const entries = isArray ? value.map((entry, index) => [index, entry]) : Object.entries(value);
    const details = document.createElement('details');
    details.className = 'tryit-node';
    if (depth < 2 && entries.length > 0) details.open = true;
    const summary = document.createElement('summary');
    if (key !== null) summary.append(el('span', 'tok-key', jsonKey(key)), el('span', 'tryit-colon', ': '));
    summary.append(
      el('span', 'tryit-brace', isArray ? '[' : '{'),
      el('span', 'tryit-count', ` ${entries.length} ${isArray ? 'items' : 'fields'} `),
      el('span', 'tryit-brace', isArray ? ']' : '}'),
    );
    details.append(summary);
    const children = el('div', 'tryit-children');
    appendChildren(children, entries, 0, depth);
    details.append(children);
    return details;
  }

  // Large responses are rendered in chunks: 200 nodes up front, the rest
  // behind a button — an unbounded tree would freeze the tab on 10k rows.
  const TREE_CHUNK = 200;

  function appendChildren(container, entries, start, depth) {
    const end = Math.min(start + TREE_CHUNK, entries.length);
    for (let index = start; index < end; index += 1) {
      const [childKey, childValue] = entries[index];
      container.append(jsonNode(childValue, childKey, depth + 1));
    }
    if (end < entries.length) {
      const more = el('button', 'tryit-more', `Show ${entries.length - end} more…`);
      more.type = 'button';
      more.addEventListener('click', () => {
        more.remove();
        appendChildren(container, entries, end, depth);
      });
      container.append(more);
    }
  }

  function jsonKey(key) {
    return typeof key === 'number' ? `[${key}]` : key;
  }

  function scalar(value) {
    if (typeof value === 'string') return el('span', 'tok-str', JSON.stringify(value));
    if (typeof value === 'number') return el('span', 'tok-num', String(value));
    if (typeof value === 'boolean') return el('span', 'tok-kw', String(value));
    return el('span', 'tok-com', 'null');
  }

  // Signals the app shell that submits are now handled here (see 10-app.js).
  window.__tryitReady = true;
})();
