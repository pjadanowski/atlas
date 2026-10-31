import { highlight } from '../highlight.mjs';
import { buildSnippets, SNIPPET_LANGUAGES } from '../snippets.mjs';
import { buildSoapSnippets, SOAP_SNIPPET_LANGUAGES } from '../soap-snippets.mjs';
import { esc, slugify } from '../text.mjs';
import { tryItLauncher } from './tryit.mjs';
import { copyButton, expandButton, methodBadge, statusClass } from './ui.mjs';

/**
 * Right column (always dark): try-it launcher + request samples + response
 * examples. Tabs are CSS-only radio groups, so they work without JavaScript.
 * The try-it form itself lives in a slide-over drawer at body level.
 */
export function endpointCodeColumn(model, endpoint) {
  return [tryItLauncher(endpoint), requestPanel(model, endpoint), responsePanel(endpoint)]
    .filter(Boolean)
    .join('\n');
}

// The CSS-only tab system styles at most this many tabs per panel.
const MAX_TABS = 14;

export function requestPanel(model, endpoint, prefix = 'req') {
  const groupId = `${prefix}-${endpoint.slug}`;
  if (endpoint.soap) return soapRequestPanel(endpoint, groupId);
  const snippets = buildSnippets(endpoint, model.baseUrl);
  // Hand-written x-codeSamples first. Their "-x-<n>" ids never end in a
  // generated language id, so the remembered-language lookup ignores them.
  const custom = (endpoint.codeSamples ?? []).map((sample, index) => ({
    id: `${groupId}-x-${index}`,
    label: sample.label,
    code: highlight(sample.source, sampleLanguage(sample.lang)),
  }));
  const generated = SNIPPET_LANGUAGES.map((lang) => ({
    id: `${groupId}-${lang.id}`,
    label: lang.label,
    code: highlight(snippets[lang.id], lang.language),
  }));
  const tabs = [...custom, ...generated]
    .slice(0, MAX_TABS)
    .map((tab, index) => ({ ...tab, checked: index === 0 }));
  const title = `${methodBadge(endpoint.badge ?? endpoint.method)} <span class="code-panel-path">${esc(shortPath(endpoint.path))}</span>`;
  return codePanel({ groupId, title, tabs, ariaLabel: 'Request example' });
}

function soapRequestPanel(endpoint, groupId) {
  const snippets = buildSoapSnippets(endpoint);
  const tabs = SOAP_SNIPPET_LANGUAGES.map((lang, index) => ({
    id: `${groupId}-soap-${lang.id}`,
    label: lang.label,
    checked: index === 0,
    code: lang.id === 'http' ? highlightRawHttp(snippets.http) : highlight(snippets[lang.id], lang.language),
  }));
  const title = `${methodBadge('SOAP')} <span class="code-panel-path">${esc(endpoint.soap.operation)}</span>`;
  return codePanel({ groupId, title, tabs, ariaLabel: 'Request example' });
}

/** Raw HTTP: plain request line and headers, the XML body highlighted. */
function highlightRawHttp(text) {
  const split = text.indexOf('\n\n');
  return `${esc(text.slice(0, split))}\n\n${highlight(text.slice(split + 2), 'xml')}`;
}

/** x-codeSamples `lang` → highlighter language; unknown ones render as plain text. */
const SAMPLE_LANGUAGES = {
  shell: 'bash', bash: 'bash', sh: 'bash', curl: 'bash', httpie: 'bash',
  js: 'javascript', javascript: 'javascript', node: 'javascript', nodejs: 'javascript', typescript: 'javascript', ts: 'javascript',
  php: 'php', laravel: 'php',
  python: 'python', py: 'python',
  go: 'go', golang: 'go',
  ruby: 'ruby', rb: 'ruby',
  java: 'java',
  csharp: 'csharp', 'c#': 'csharp', cs: 'csharp',
};

function sampleLanguage(lang) {
  return SAMPLE_LANGUAGES[String(lang).toLowerCase().replace(/[\s_]+/g, '')] ?? 'text';
}

export function responsePanel(endpoint, prefix = 'res') {
  // One tab per status, or per named example when a status has several
  // ("200 · held", "200 · confirmed"). Primary media type only.
  const groupId = `${prefix}-${endpoint.slug}`;
  const tabs = [];
  for (const response of endpoint.responses) {
    const content = response.contents?.[0];
    const examples = content?.examples ?? [];
    examples.forEach((example, index) => {
      const value = example.value;
      if (value === null || value === undefined) return;
      const isJson = /json/.test(content.contentType ?? '') || typeof value === 'object';
      tabs.push({
        id: `${groupId}-${slugify(response.status)}${examples.length > 1 ? `-${index}` : ''}`,
        label: examples.length > 1 ? `${response.status} · ${example.summary}` : response.status,
        labelClass: `tab-status tab-status--${statusClass(response.status)}`,
        code:
          isJson || typeof value !== 'string'
            ? highlight(JSON.stringify(value, null, 2), 'json')
            : highlight(value, /xml/.test(content.contentType ?? '') ? 'xml' : 'text'),
      });
    });
  }
  if (tabs.length === 0) return '';
  const shown = tabs.slice(0, 14);
  shown[0].checked = true;
  return codePanel({ groupId, title: '<span class="code-panel-label">Response</span>', tabs: shown, ariaLabel: 'Response example' });
}

export function codePanel({ groupId, title, tabs, ariaLabel, className = '' }) {
  const inputs = tabs
    .map(
      (tab) =>
        `    <input class="code-tab-radio" type="radio" name="${groupId}" id="${tab.id}"${tab.checked ? ' checked' : ''}>`,
    )
    .join('\n');
  const labels = tabs
    .map((tab) => `      <label class="code-tab${tab.labelClass ? ` ${tab.labelClass}` : ''}" for="${tab.id}">${esc(tab.label)}</label>`)
    .join('\n');
  const panes = tabs
    .map(
      (tab) => `    <div class="code-pane">
      <pre tabindex="0"><code>${tab.code}</code></pre>
    </div>`,
    )
    .join('\n');
  return `<section class="code-panel${className ? ` ${className}` : ''}" aria-label="${esc(ariaLabel)}">
  <header class="code-panel-head">
    <div class="code-panel-title">${title}</div>
    <div class="code-panel-actions">
      ${expandButton()}
      ${copyButton(null, 'Copy code')}
    </div>
  </header>
  <div class="code-tabs">
${inputs}
    <div class="code-tabbar">
${labels}
    </div>
${panes}
  </div>
</section>`;
}

function shortPath(path) {
  return path.replace(/^\/api\/v\d+/, '');
}

/** Code column for the home page: auth example derived from a real endpoint. */
export function homeCodeColumn(model) {
  const sample =
    model.endpoints.find((endpoint) => endpoint.requiresAuth && endpoint.method === 'GET') ??
    model.endpoints[0];
  const example = sample
    ? `<section class="code-panel" aria-label="Example request">
  <header class="code-panel-head">
    <div class="code-panel-title"><span class="code-panel-label">${sample.requiresAuth ? 'Authenticated request' : 'Example request'}</span></div>
    ${copyButton(null, 'Copy code')}
  </header>
  <div class="code-tabs">
    <div class="code-pane">
      <pre tabindex="0"><code>${highlight(buildSnippets(sample, model.baseUrl).curl, 'bash')}</code></pre>
    </div>
  </div>
</section>
`
    : '';
  return `${example}
<section class="code-panel" aria-label="Base URL">
  <header class="code-panel-head">
    <div class="code-panel-title"><span class="code-panel-label">Base URL</span></div>
    ${copyButton(model.baseUrl, 'Copy base URL')}
  </header>
  <div class="code-tabs">
    <div class="code-pane">
      <pre tabindex="0"><code>${esc(model.baseUrl)}</code></pre>
    </div>
  </div>
</section>`;
}

/** Webhook pages: the payload your server receives, no request snippets. */
export function webhookCodeColumn(hook) {
  const content = hook.requestBody?.contents?.[0];
  const example = content?.examples?.[0]?.value;
  if (example === undefined || example === null) return '';
  return `<section class="code-panel" aria-label="Webhook payload">
  <header class="code-panel-head">
    <div class="code-panel-title">${methodBadge(hook.method)} <span class="code-panel-path">${esc(hook.webhookName)}</span></div>
    <div class="code-panel-actions">
      ${expandButton()}
      ${copyButton(null, 'Copy code')}
    </div>
  </header>
  <div class="code-tabs">
    <div class="code-pane">
      <pre tabindex="0"><code>${highlight(JSON.stringify(example, null, 2), 'json')}</code></pre>
    </div>
  </div>
</section>`;
}
