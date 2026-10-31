import { descriptionHtml, esc, mdBlock, mdInline, slugify } from '../text.mjs';
import { url } from '../url.mjs';
import { highlight } from '../highlight.mjs';
import { attributeRows, typeLabel } from './schema.mjs';
import { requestPanel, responsePanel } from './codecol.mjs';
import { copyButton, enumPills, expandButton, methodBadge, statusBadge } from './ui.mjs';

/** Main-column article for one endpoint: header + tabbed documentation. */
export function endpointContent(spec, model, endpoint) {
  const tabs = docTabs(endpoint.slug, [
    { id: 'params', label: 'Parameters', content: parametersPane(endpoint) },
    { id: 'body', label: 'Request Body', content: requestBodyPane(spec, endpoint.requestBody) },
    { id: 'responses', label: 'Responses', content: responsesPane(spec, endpoint.responses) },
    { id: 'examples', label: 'Examples', content: examplesPane(model, endpoint) },
  ]);
  return `<article class="endpoint">
${endpointHeader(endpoint)}
${tabs}
${pagerSection(model, endpoint)}
</article>`;
}

function endpointHeader(endpoint) {
  return `<header class="endpoint-header">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="${esc(url('/'))}">API</a>
    <span class="crumbs-sep" aria-hidden="true">›</span>
    <span>${esc(endpoint.tag)}</span>
    <span class="crumbs-sep" aria-hidden="true">›</span>
    <span aria-current="page">${esc(endpoint.title)}</span>
  </nav>
  <h1>${esc(endpoint.title)}</h1>
  <div class="endpoint-route">
    ${methodBadge(endpoint.method)}
    <code class="endpoint-path">${esc(endpoint.path)}</code>
    ${copyButton(endpoint.path, 'Copy path')}
  </div>
  ${endpoint.description ? `<div class="endpoint-desc">${mdBlock(endpoint.description)}</div>` : ''}
  ${metaStrip(endpoint)}
</header>`;
}

function metaStrip(endpoint) {
  const items = [];
  items.push(
    endpoint.requiresAuth
      ? metaItem(lockIcon(), 'Bearer token', 'Authentication required')
      : metaItem(globeIcon(), 'Public', 'No token required'),
  );
  if (endpoint.requestBody) {
    items.push(
      metaItem(
        fileIcon(),
        esc(endpoint.requestBody.contentType),
        endpoint.requestBody.required ? 'Request body required' : 'Request body optional',
      ),
    );
  }
  if (endpoint.deprecated) {
    items.push(metaItem(warnIcon(), 'Deprecated', 'Avoid using this endpoint', 'meta-item--danger'));
  }
  return `<div class="endpoint-meta">
    ${items.join('\n    ')}
  </div>`;
}

function metaItem(icon, main, sub, extraClass = '') {
  return `<div class="meta-item${extraClass ? ` ${extraClass}` : ''}">
      ${icon}
      <span class="meta-text"><span class="meta-main">${main}</span><span class="meta-sub">${sub}</span></span>
    </div>`;
}

/**
 * CSS-only tabs (radio group), same pattern as the code panels: works
 * without JavaScript. Empty panes are omitted; the first pane is active.
 */
function docTabs(slug, panes) {
  const available = panes.filter((pane) => pane.content);
  if (available.length === 0) return '';
  const group = `tab-${slug}`;
  const inputs = available
    .map(
      (pane, index) =>
        `  <input class="doc-tab-radio" type="radio" name="${group}" id="${group}-${pane.id}"${index === 0 ? ' checked' : ''}>`,
    )
    .join('\n');
  const labels = available
    .map((pane) => `    <label class="doc-tab" for="${group}-${pane.id}">${esc(pane.label)}</label>`)
    .join('\n');
  const panesHtml = available
    .map((pane) => `  <div class="doc-tabpane">\n${pane.content}\n  </div>`)
    .join('\n');
  return `<div class="doc-tabs">
${inputs}
  <div class="doc-tabbar">
${labels}
  </div>
${panesHtml}
</div>`;
}

function parametersPane(endpoint) {
  const groups = [
    parameterSection('Path parameters', endpoint.params.path, 'path'),
    parameterSection('Query parameters', endpoint.params.query, 'query'),
    parameterSection('Header parameters', endpoint.params.header, 'header'),
  ].filter(Boolean);
  return groups.join('\n');
}

function parameterSection(title, params, kind) {
  if (params.length === 0) return '';
  const sectionId = slugify(title);
  const rows = params.map((param) => parameterRow(param, kind)).join('\n');
  return `<section class="doc-section" id="${sectionId}">
  <h2>${esc(title)}</h2>
  <div class="attr-list">
${rows}
  </div>
</section>`;
}

function parameterRow(param, kind) {
  const constraints = [];
  if (param.schema.default !== undefined) {
    constraints.push(`<span class="attr-constraint">Default: <code>${esc(JSON.stringify(param.schema.default))}</code></span>`);
  }
  for (const [key, label] of [
    ['minimum', 'Min'],
    ['maximum', 'Max'],
    ['minLength', 'Min length'],
    ['maxLength', 'Max length'],
  ]) {
    if (param.schema[key] !== undefined) {
      constraints.push(`<span class="attr-constraint">${label}: <code>${esc(String(param.schema[key]))}</code></span>`);
    }
  }
  const anchorId = `${kind}-${slugify(param.name)}`;
  return `    <div class="attr-row" id="${anchorId}">
      <div class="attr-head">
        <a class="attr-anchor" href="#${anchorId}" aria-label="Link to ${esc(param.name)}" title="Copy link">#</a>
        <code class="attr-name">${esc(param.name)}</code>
        <span class="attr-type">${esc(typeLabel(param.schema))}</span>
        ${param.required ? '<span class="attr-required">required</span>' : ''}
        ${param.deprecated ? '<span class="attr-deprecated">deprecated</span>' : ''}
      </div>
      ${descriptionHtml(param.description, 'attr-desc')}
      ${constraints.length ? `<div class="attr-constraints">${constraints.join('\n        ')}</div>` : ''}
      ${enumPills(param.schema)}
    </div>`;
}

function requestBodyPane(spec, requestBody) {
  if (!requestBody) return '';
  const rows = attributeRows(spec, requestBody.schema);
  const modelLink = requestBody.schemaName
    ? ` · <a class="model-link" href="${esc(url(`/models/${slugify(requestBody.schemaName)}/`))}">${esc(requestBody.schemaName)}</a>`
    : '';
  return `<section class="doc-section" id="body-parameters">
  <h2>Body parameters</h2>
  <p class="doc-section-meta"><code>${esc(requestBody.contentType)}</code>${
    requestBody.required ? ' · required' : ' · optional'
  }${modelLink}</p>
  ${requestBody.description ? `<div class="endpoint-desc endpoint-desc--section">${mdBlock(requestBody.description)}</div>` : ''}
  ${jsonPanel('Example request body', requestBody.example)}
  ${rows ? `<div class="attr-list">\n${rows}\n  </div>` : ''}
</section>`;
}

function responsesPane(spec, responses) {
  if (responses.length === 0) return '';
  const success = responses.filter((response) => response.status.startsWith('2'));
  const errors = responses.filter((response) => !response.status.startsWith('2'));
  return `<section class="doc-section">
${success.map((response) => responseCard(spec, response, true)).join('\n')}
${errors.length ? `  <h3 class="response-errors-title">Errors</h3>\n${errors.map((response) => responseCard(spec, response, false)).join('\n')}` : ''}
</section>`;
}

function responseCard(spec, response, open) {
  // Expanded like model pages: the response shape is what the reader is here
  // for, and the card itself already collapses when they want it out of sight.
  const rows = response.schema ? attributeRows(spec, response.schema, { expanded: true }) : '';
  const example = jsonPanel('Example response', response.example);
  const modelLink = response.schemaName
    ? `<a class="model-link" href="${esc(url(`/models/${slugify(response.schemaName)}/`))}">${esc(response.schemaName)}</a>`
    : '';
  const head = `${statusBadge(response.status)}
      <span class="response-desc">${mdInline(response.description)}</span>${modelLink}`;
  if (!rows && !example) {
    return `  <div class="response-card response-card--flat">
    <div class="response-head">
      ${head}
    </div>
  </div>`;
  }
  return `  <details class="response-card"${open ? ' open' : ''}>
    <summary class="response-head">
      ${head}
      <svg class="response-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </summary>
    <div class="response-body">
      ${rows ? `<div class="attr-list">\n${rows}\n      </div>` : ''}
      ${example}
    </div>
  </details>`;
}

/** Dark single-pane JSON block used inline in the content column. */
function jsonPanel(label, value) {
  if (value === null || value === undefined) return '';
  const code = highlight(JSON.stringify(value, null, 2), 'json');
  return `<section class="code-panel code-panel--inline" aria-label="${esc(label)}">
  <header class="code-panel-head">
    <div class="code-panel-title"><span class="code-panel-label">${esc(label)}</span></div>
    <div class="code-panel-actions">
      ${expandButton()}
      ${copyButton(null, 'Copy code')}
    </div>
  </header>
  <div class="code-tabs">
    <div class="code-pane">
      <pre tabindex="0"><code>${code}</code></pre>
    </div>
  </div>
</section>`;
}

/** In-content code samples: same panels as the code column, distinct ids. */
function examplesPane(model, endpoint) {
  const panels = [requestPanel(model, endpoint, 'ex-req'), responsePanel(endpoint, 'ex-res')]
    .filter(Boolean)
    .join('\n');
  return `<section class="doc-section examples-section">
${panels}
</section>`;
}

function pagerSection(model, endpoint) {
  const siblings = model.endpoints.filter((other) => other.tag === endpoint.tag);
  const index = siblings.findIndex((other) => other.id === endpoint.id);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  if (!previous && !next) return '';
  return `<footer class="endpoint-pager">
  ${previous ? `<a class="pager-link pager-link--prev" href="${esc(url(previous.href))}"><span class="pager-label">Previous</span><span class="pager-title">${esc(previous.title)}</span></a>` : '<span></span>'}
  ${next ? `<a class="pager-link pager-link--next" href="${esc(url(next.href))}"><span class="pager-label">Next</span><span class="pager-title">${esc(next.title)}</span></a>` : '<span></span>'}
</footer>`;
}

function lockIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
}

function globeIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
}

function fileIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
}

function warnIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4M12 17h.01"/></svg>';
}
