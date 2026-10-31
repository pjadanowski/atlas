import { highlight } from '../highlight.mjs';
import { buildSnippets, SNIPPET_LANGUAGES } from '../snippets.mjs';
import { esc } from '../text.mjs';
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

export function requestPanel(model, endpoint, prefix = 'req') {
  const snippets = buildSnippets(endpoint, model.baseUrl);
  const groupId = `${prefix}-${endpoint.slug}`;
  const tabs = SNIPPET_LANGUAGES.map((lang, index) => ({
    id: `${groupId}-${lang.id}`,
    label: lang.label,
    checked: index === 0,
    code: highlight(snippets[lang.id], lang.language),
  }));
  const title = `${methodBadge(endpoint.method)} <span class="code-panel-path">${esc(shortPath(endpoint.path))}</span>`;
  return codePanel({ groupId, title, tabs, ariaLabel: 'Request example' });
}

export function responsePanel(endpoint, prefix = 'res') {
  const withExamples = endpoint.responses.filter((response) => response.example !== null && response.example !== undefined);
  if (withExamples.length === 0) return '';
  const groupId = `${prefix}-${endpoint.slug}`;
  const tabs = withExamples.slice(0, 5).map((response, index) => ({
    id: `${groupId}-${response.status}`,
    label: response.status,
    labelClass: `tab-status tab-status--${statusClass(response.status)}`,
    checked: index === 0,
    code: highlight(JSON.stringify(response.example, null, 2), 'json'),
  }));
  return codePanel({ groupId, title: '<span class="code-panel-label">Response</span>', tabs, ariaLabel: 'Response example' });
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
