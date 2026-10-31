import { esc } from '../text.mjs';
import { highlight } from '../highlight.mjs';
import { typeLabel } from './schema.mjs';
import { methodBadge } from './ui.mjs';

/**
 * Build-time "Try it" console for one endpoint, rendered as a slide-over
 * drawer (native <dialog>, top layer, right edge). The runtime layer
 * (assets/tryit) only reads the inputs, sends the request with fetch and
 * renders the response. The launcher button is hidden entirely without JS.
 */

/** Compact launcher shown at the top of the code column. */
export function tryItLauncher(endpoint) {
  return `<button type="button" class="tryit-launch js-only" data-tryit-open>
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>
  <span>Try it</span>
  <span class="tryit-launch-path">${endpoint.soap ? `SOAP ${esc(endpoint.soap.operation)}` : `${esc(endpoint.method)} ${esc(shortPath(endpoint.path))}`}</span>
</button>`;
}

function shortPath(path) {
  return path.replace(/^\/api\/v\d+/, '');
}

/** The drawer itself — appended once per endpoint page at body level. */
export function tryItDrawer(model, endpoint) {
  const isMultipart = endpoint.requestBody?.contentType.includes('multipart') ?? false;
  const sections = [
    serverField(model, endpoint),
    endpoint.soap ? wsseRow(endpoint) : endpoint.security.some((alternative) => alternative.length > 0) ? authRow(endpoint) : '',
    paramSection('Path', endpoint.params.path.map((param) => paramField(param, 'path'))),
    paramSection('Query', endpoint.params.query.map((param) => paramField(param, 'query'))),
    paramSection('Headers', endpoint.params.header.map((param) => paramField(param, 'header'))),
    bodySection(endpoint, isMultipart),
    copyRow(),
    historySection(),
  ].filter(Boolean);
  // Alternatives (OR) of scheme ids (AND) — the runtime picks the first one
  // whose credentials are all configured.
  const security = JSON.stringify(endpoint.security.map((alternative) => alternative.map((entry) => entry.id)));
  return `<dialog class="tryit-drawer" data-tryit data-method="${esc(endpoint.method)}" data-path="${esc(endpoint.soap ? '' : endpoint.path)}" data-accept="${endpoint.soap ? 'text/xml, application/soap+xml' : 'application/json'}"${endpoint.soap ? ` data-soap-version="${esc(endpoint.soap.version)}" data-wsse="${esc(JSON.stringify(endpoint.soap.security ?? null))}"` : ''} data-security="${esc(security)}" aria-label="Try it – ${esc(endpoint.method)} ${esc(endpoint.path)}">
  <form class="tryit-form">
    <header class="tryit-head">
      <div class="tryit-head-title">${methodBadge(endpoint.badge ?? endpoint.method)}<code class="tryit-head-path">${esc(endpoint.soap ? endpoint.soap.operation : endpoint.path)}</code></div>
      <button type="button" class="tryit-close" data-tryit-close aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>
    <div class="tryit-scroll">
${sections.join('\n')}
      <div class="tryit-response" data-tryit-response></div>
    </div>
    <footer class="tryit-foot">
      <button type="button" class="tryit-fill" data-tryit-fill title="Fill empty fields with schema examples">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4V2m0 20v-2m5-15 1.5-1.5M3.5 20.5 5 19m10-9 6 6M2 6l4-4 14 14-4 4z"/></svg>
        Fill example data
      </button>
      <button type="button" class="tryit-fill" data-tryit-reset title="Reset all fields to their defaults">Reset</button>
      <span class="tryit-kbd" title="Send with keyboard"><kbd>⌘</kbd><kbd>↵</kbd></span>
      <button type="submit" class="tryit-send">Send request</button>
    </footer>
  </form>
</dialog>`;
}

/**
 * Server picker: the spec's servers (with their descriptions) as a select,
 * plus a "Custom URL…" entry that reveals a free-text input — any base URL
 * works (localhost, staging, …). URLs actually used are remembered by the
 * runtime and reappear in the list. The hidden input is the single source
 * of truth the request is built from.
 */
function serverField(model, endpoint) {
  // Operation-level servers win (a SOAP operation's port address).
  const servers = endpoint.servers?.length
    ? endpoint.servers
    : model.servers.length ? model.servers : [{ url: model.baseUrl, resolved: model.baseUrl, variables: [] }];
  const options = servers
    .map((server) => {
      const label = server.description ? `${server.description} — ${server.url}` : server.url;
      const template = server.variables?.length ? ` data-template="${esc(server.url)}"` : '';
      return `<option value="${esc(server.resolved ?? server.url)}"${template}>${esc(label)}</option>`;
    })
    .join('');
  // Server variables ({region}, {basePath}): one control each, shown while
  // a templated server is selected; the runtime substitutes them.
  const variables = servers
    .map((server, index) => {
      if (!server.variables?.length) return '';
      const controls = server.variables
        .map((variable) => {
          const control = variable.enum.length
            ? `<select class="tryit-input" data-server-var="${esc(variable.name)}">${variable.enum
                .map((value) => `<option${value === variable.default ? ' selected' : ''}>${esc(value)}</option>`)
                .join('')}</select>`
            : `<input class="tryit-input" type="text" data-server-var="${esc(variable.name)}" value="${esc(variable.default)}" spellcheck="false">`;
          return `<label class="tryit-servervar" title="${esc(variable.description)}"><span>{${esc(variable.name)}}</span>${control}</label>`;
        })
        .join('');
      return `<div class="tryit-servervars" data-server-vars="${esc(server.url)}" hidden>${controls}</div>`;
    })
    .join('');
  const first = servers[0].resolved ?? servers[0].url;
  const control = `<div class="tryit-server">
          <select class="tryit-input" data-server-select>${options}<option value="__custom">Custom URL…</option></select>
          <input class="tryit-input" type="text" data-t="server" value="${esc(first)}" placeholder="http://localhost:8000" spellcheck="false" autocomplete="off" hidden>
        </div>${variables}`;
  // A <div>, not field()'s <label>: the variable controls carry their own labels.
  return `        <div class="tryit-field">
          <span class="tryit-label">Server</span>
          ${control}
        </div>`;
}

/**
 * Authorization is configured once, globally (topbar → Authorize). The drawer
 * only shows the current state and a shortcut to change it.
 */
function authRow(endpoint) {
  return `      <div class="tryit-authrow">
        <span class="tryit-label">Authorization${endpoint.authOptional ? '' : '<em class="tryit-req">required</em>'}</span>
        <span class="tryit-authstate" data-auth-state>Not set</span>
        <button type="button" class="tryit-authedit" data-auth-open>Change</button>
      </div>`;
}

/** SOAP: which WS-Security the operation's policy asks for, and whether it is configured. */
function wsseRow(endpoint) {
  const security = endpoint.soap.security;
  const parts = security ? wsseSummary(security) : 'not declared in the WSDL';
  return `      <div class="tryit-authrow">
        <span class="tryit-label">WS-Security${security?.tokens?.length ? '<em class="tryit-req">required</em>' : ''}</span>
        <span class="tryit-authstate" data-wsse-row title="${esc(parts)}">${esc(parts)}</span>
        <button type="button" class="tryit-authedit" data-auth-open>Change</button>
      </div>`;
}

export function wsseSummary(security) {
  const names = { username: 'UsernameToken', issued: 'Issued token', 'secure-conversation': 'Security context token', x509: 'X.509', saml: 'SAML', kerberos: 'Kerberos' };
  const parts = security.tokens.map((token) => (token.type === 'username' ? `UsernameToken (${token.digest ? 'digest' : 'text'})` : names[token.type] ?? token.type));
  if (security.timestamp) parts.push('Timestamp');
  if (security.signed) parts.push('signed');
  return parts.join(' + ') || 'none';
}

/** Copies the request — with the currently filled values — as code. */
function copyRow() {
  const buttons = [
    ['curl', 'cURL'],
    ['fetch', 'fetch'],
    ['php', 'PHP'],
    ['python', 'Python'],
  ]
    .map(([kind, label]) => `<button type="button" class="tryit-tool" data-copy-as="${kind}">${label}</button>`)
    .join('');
  return `      <div class="tryit-copyrow">
        <span class="tryit-copylabel">Copy as</span>
        ${buttons}
      </div>`;
}

/** Recent requests for this endpoint — populated and unhidden by the runtime. */
function historySection() {
  return `      <details class="tryit-history" data-tryit-history hidden>
        <summary>Recent requests</summary>
        <div class="tryit-history-list" data-tryit-history-list></div>
      </details>`;
}

function paramSection(title, fields) {
  if (fields.length === 0) return '';
  return `      <fieldset class="tryit-group">
        <legend class="tryit-subhead">${esc(title)}</legend>
${fields.join('\n')}
      </fieldset>`;
}

/** A form-input string for any sample value (arrays → comma-separated). */
function inputValue(sample) {
  if (sample === undefined || sample === null) return '';
  if (Array.isArray(sample)) return sample.map(inputValue).join(',');
  if (typeof sample === 'object') return JSON.stringify(sample);
  return String(sample);
}

/**
 * One typed input per parameter: enum → select, number → number, else text.
 * Prefilled Swagger-style: path params always get a value (explicit example
 * or schema-generated), other params only when the spec provides one — junk
 * values in optional filters would silently change what the API returns.
 */
function paramField(param, kind) {
  const schema = param.schema ?? {};
  const type = schema.type;
  const sample = inputValue(param.sample);
  // data-sample feeds the runtime filler: schema-typed example values
  // (integer → 1, string<Y-m-d> → a real date, …) for empty fields.
  const attrs = `data-t="${kind}" data-name="${esc(param.name)}"${sample ? ` data-sample="${esc(sample)}"` : ''}${
    param.required ? ' data-req="1"' : ''
  }`;
  const value = kind === 'path' || param.required ? sample : inputValue(param.example);
  let control;
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 30) {
    const blank = param.required && value ? '' : '<option value="">—</option>';
    const options = schema.enum
      .map((entry) => `<option value="${esc(String(entry))}"${String(entry) === value ? ' selected' : ''}>${esc(String(entry))}</option>`)
      .join('');
    control = `<select class="tryit-input" ${attrs}>${blank}${options}</select>`;
  } else if (type === 'boolean') {
    control = `<select class="tryit-input" ${attrs}><option value="">—</option><option value="true"${value === 'true' ? ' selected' : ''}>true</option><option value="false"${value === 'false' ? ' selected' : ''}>false</option></select>`;
  } else {
    const inputType = type === 'integer' || type === 'number' ? 'number' : 'text';
    const placeholder = type === 'array' ? `${typeLabel(schema)} · comma-separated` : typeLabel(schema);
    control = `<input class="tryit-input" type="${inputType}" ${attrs}${
      type === 'array' ? ' data-array="1"' : ''
    } value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false">`;
  }
  return field(param.name, control, param.required);
}

function bodySection(endpoint, isMultipart) {
  const body = endpoint.requestBody;
  if (!body) return '';
  if (isMultipart) {
    const properties = Object.entries(body.schema?.properties ?? {});
    const required = body.schema?.required ?? [];
    const fields = properties.map(([name, schema]) => {
      const isRequired = required.includes(name);
      const sample = inputValue(body.example?.[name]);
      const attrs = `data-t="mp" data-name="${esc(name)}"${sample ? ` data-sample="${esc(sample)}"` : ''}${
        isRequired ? ' data-req="1"' : ''
      }`;
      return field(
        name,
        schema?.format === 'binary'
          ? `<input class="tryit-input tryit-input--file" type="file" data-t="mp" data-name="${esc(name)}">`
          : `<input class="tryit-input" type="text" ${attrs} placeholder="${esc(typeLabel(schema ?? {}))}" spellcheck="false">`,
        isRequired,
      );
    });
    return paramSection('Body · form-data', fields);
  }
  const isJson = /json/.test(body.contentType);
  const isForm = /x-www-form-urlencoded/.test(body.contentType);
  const example =
    body.example === null || body.example === undefined
      ? isJson || isForm ? '{}' : ''
      : typeof body.example === 'string' && !isJson
        ? body.example
        : JSON.stringify(body.example, null, 2);
  const rows = Math.max(6, Math.min(example.split('\n').length + 1, 20));
  const title = isJson ? 'Body · JSON' : isForm ? 'Body · form (edited as JSON)' : `Body · ${body.contentType}`;
  if (!isJson && !isForm) {
    // XML and other text bodies: a plain editor. The overlay highlighter
    // below speaks JSON only and would drift out of sync with markup.
    // SOAP 1.2 carries the action in the media type itself.
    const action = endpoint.soap?.version === '1.2' && endpoint.soap.action ? `; action="${endpoint.soap.action}"` : '';
    const contentType = `${body.contentType}${/xml/.test(body.contentType) ? '; charset=utf-8' : ''}${action}`;
    return paramSection(title, [
      `        <textarea class="tryit-input tryit-textbody" data-t="json" data-content-type="${esc(contentType)}" rows="${rows}" spellcheck="false" autocomplete="off">${esc(example)}</textarea>`,
    ]);
  }
  // Syntax-highlighted editor: a highlighted <pre> sits behind a transparent
  // textarea; the runtime re-highlights on input and keeps scroll in sync.
  return paramSection(title, [
    `        <div class="tryit-jsonwrap">
          <pre class="tryit-json-hl" aria-hidden="true"><code>${isJson || isForm ? highlight(example, 'json') : esc(example)}\n</code></pre>
          <textarea class="tryit-input tryit-json" data-t="json" data-content-type="${esc(body.contentType)}" rows="${rows}" spellcheck="false" autocomplete="off">${esc(example)}</textarea>
        </div>`,
  ]);
}

function field(label, control, required = false) {
  return `        <label class="tryit-field">
          <span class="tryit-label">${esc(label)}${required ? '<em class="tryit-req">required</em>' : ''}</span>
          ${control}
        </label>`;
}
