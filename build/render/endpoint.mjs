import { descriptionHtml, esc, mdBlock, mdInline, slugify } from '../text.mjs';
import { url } from '../url.mjs';
import { highlight } from '../highlight.mjs';
import { constraintList, schemaBody, typeLabel } from './schema.mjs';
import { codePanel, requestPanel, responsePanel } from './codecol.mjs';
import { wsseSummary } from './tryit.mjs';
import { copyButton, enumPills, expandButton, methodBadge, statusBadge } from './ui.mjs';

/** Main-column article for one endpoint: header + tabbed documentation. */
export function endpointContent(spec, model, endpoint) {
  const tabs = docTabs(endpoint.slug, [
    { id: 'params', label: 'Parameters', content: parametersPane(endpoint) },
    { id: 'body', label: 'Request Body', content: requestBodyPane(spec, endpoint.requestBody) },
    { id: 'responses', label: 'Responses', content: responsesPane(spec, endpoint.responses) },
    { id: 'callbacks', label: 'Callbacks', content: callbacksPane(spec, endpoint.callbacks) },
    { id: 'examples', label: 'Examples', content: endpoint.kind === 'webhook' ? '' : examplesPane(model, endpoint) },
  ]);
  return `<article class="endpoint">
${endpointHeader(endpoint, model)}
${tabs}
${pagerSection(model, endpoint)}
</article>`;
}

function endpointHeader(endpoint, model) {
  const tag = model.tags.find((candidate) => candidate.name === endpoint.tagName);
  const tagCrumb = tag?.description ? `<a href="${esc(url(tag.href))}">${esc(endpoint.tag)}</a>` : `<span>${esc(endpoint.tag)}</span>`;
  const route = endpoint.soap
    ? `<div class="endpoint-route">
    ${methodBadge('SOAP')}
    <code class="endpoint-path">${esc(endpoint.soap.address || endpoint.soap.operation)}</code>
    ${endpoint.soap.address ? copyButton(endpoint.soap.address, 'Copy endpoint address') : ''}
  </div>`
    : endpoint.kind === 'webhook'
    ? `<div class="endpoint-route">
    ${methodBadge(endpoint.badge ?? endpoint.method)}
    <span class="endpoint-path endpoint-path--webhook">Webhook · sent by the API to your endpoint</span>
  </div>`
    : `<div class="endpoint-route">
    ${methodBadge(endpoint.badge ?? endpoint.method)}
    <code class="endpoint-path">${esc(endpoint.path)}</code>
    ${copyButton(endpoint.path, 'Copy path')}
  </div>`;
  return `<header class="endpoint-header">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="${esc(url('/'))}">API</a>
    <span class="crumbs-sep" aria-hidden="true">›</span>
    ${tagCrumb}
    <span class="crumbs-sep" aria-hidden="true">›</span>
    <span aria-current="page">${esc(endpoint.title)}</span>
  </nav>
  <h1${endpoint.deprecated ? ' class="is-deprecated"' : ''}>${esc(endpoint.title)}</h1>
  ${route}
  ${endpoint.description ? `<div class="endpoint-desc">${mdBlock(endpoint.description)}</div>` : ''}
  ${metaStrip(endpoint)}
  ${endpoint.soap?.security ? wsseNotes(endpoint.soap.security) : ''}
  ${endpoint.externalDocs?.url ? `<p class="endpoint-extdocs"><a href="${esc(endpoint.externalDocs.url)}" rel="noopener" target="_blank">${esc(endpoint.externalDocs.description ?? 'External documentation')} ↗</a></p>` : ''}
</header>`;
}

function metaStrip(endpoint) {
  const items = [];
  if (endpoint.soap) return soapMeta(endpoint);
  if (endpoint.kind !== 'webhook') items.push(securityItem(endpoint));
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

/**
 * Which credentials the endpoint takes: alternatives joined by "or", schemes
 * that must be sent together by "+", with OAuth scopes listed under them.
 */
function securityItem(endpoint) {
  const alternatives = endpoint.security.filter((alternative) => alternative.length > 0);
  if (alternatives.length === 0) return metaItem(globeIcon(), 'Public', 'No authentication required');
  const label = alternatives
    .map((alternative) => alternative.map((entry) => esc(entry.scheme.label)).join(' + '))
    .join(' <span class="meta-or">or</span> ');
  const scopes = [...new Set(alternatives.flat().flatMap((entry) => entry.scopes))];
  const sub = endpoint.authOptional ? 'Authentication optional' : 'Authentication required';
  const scopeHtml = scopes.length
    ? `<span class="meta-scopes">${scopes.map((scope) => `<code class="scope-pill">${esc(scope)}</code>`).join('')}</span>`
    : '';
  return metaItem(lockIcon(), `${label}${scopeHtml}`, sub);
}

/** What the WS-Security policy means for a client, in plain words. */
function wsseNotes(security) {
  const notes = [];
  for (const token of security.tokens) {
    if (token.type === 'username') {
      notes.push(
        token.digest
          ? 'Send a <code>wsse:UsernameToken</code> with a <strong>PasswordDigest</strong>: Base64(SHA-1(nonce + created + password)), with a fresh nonce and creation time per request.'
          : 'Send a <code>wsse:UsernameToken</code> with the password as <strong>PasswordText</strong> — only ever over HTTPS.',
      );
    } else if (token.type === 'issued' || token.type === 'secure-conversation') {
      notes.push(`Include a token issued by the security token service${token.issuer ? ` at <code>${esc(token.issuer)}</code>` : ''} (WS-Trust) in <code>wsse:Security</code>.`);
    } else if (token.type === 'x509') {
      notes.push('Sign the message with an X.509 certificate (<code>wsse:BinarySecurityToken</code> + <code>ds:Signature</code>). Done by your SOAP toolkit — the try-it console cannot sign.');
    } else if (token.type === 'saml') {
      notes.push('Include a SAML assertion from your identity provider.');
    } else if (token.type === 'kerberos') {
      notes.push('Authenticate with a Kerberos ticket.');
    }
  }
  if (security.timestamp) notes.push('Add a <code>wsu:Timestamp</code> (Created / Expires).');
  if (security.https) notes.push(`Use HTTPS${security.clientCertificate ? ' with a client certificate' : ''}.`);
  if (security.signed && !security.tokens.some((token) => token.type === 'x509')) notes.push('Parts of the message must be signed.');
  if (security.encrypted) notes.push('Parts of the message must be encrypted.');
  if (notes.length === 0) return '';
  return `<div class="wsse-notes">
    <p class="variants-intro">WS-Security</p>
    <ul class="md-list">${notes.map((note) => `<li>${note}</li>`).join('')}</ul>
  </div>`;
}

/** SOAP operations: protocol, binding style, action and the other ports. */
function soapMeta(endpoint) {
  const soap = endpoint.soap;
  const versions = [soap.version, ...soap.alternatives.map((alternative) => alternative.version)];
  const items = [
    metaItem(fileIcon(), `SOAP ${[...new Set(versions)].join(' · ')}`, `${esc(soap.style)}/literal · ${esc(soap.port)}`),
    metaItem(
      globeIcon(),
      soap.action ? `<code>${esc(soap.action)}</code>` : '<span class="meta-or">none</span>',
      soap.version === '1.1' ? 'SOAPAction header' : '<code>action</code> in Content-Type',
    ),
  ];
  if (soap.security) {
    items.push(metaItem(lockIcon(), esc(wsseSummary(soap.security)), soap.security.declared ? 'WS-Security (configured)' : 'WS-Security policy'));
  }
  const faults = endpoint.responses.find((response) => response.status === '500');
  const named = faults?.contents?.[0]?.examples?.filter((example) => example.key !== 'Server') ?? [];
  if (named.length) {
    items.push(metaItem(warnIcon(), named.map((example) => esc(example.summary)).join(', '), named.length === 1 ? 'Declared fault' : 'Declared faults'));
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
    parameterSection('Cookie parameters', endpoint.params.cookie, 'cookie'),
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
  const anchorId = `${kind}-${slugify(param.name)}`;
  const itemSchema = param.schema.type === 'array' ? param.schema.items ?? null : null;
  const serialization =
    kind === 'query' && param.schema.type === 'array' && (param.style || param.explode !== null)
      ? `<span class="attr-constraint">Serialized: <code>${esc(serializationHint(param))}</code></span>`
      : '';
  const examples = param.examples.length > 1
    ? `<div class="attr-constraints">${param.examples
        .map((example) => `<span class="attr-constraint">${esc(example.summary)}: <code>${esc(JSON.stringify(example.value))}</code></span>`)
        .join('\n        ')}</div>`
    : '';
  const constraints = constraintList(
    param.examples.length > 1
      ? { ...param.schema, example: undefined }
      : param.schema.example === undefined && param.example !== undefined && typeof param.example !== 'object'
      ? { ...param.schema, example: param.example }
      : param.schema,
    itemSchema,
  );
  return `    <div class="attr-row" id="${anchorId}">
      <div class="attr-head">
        <a class="attr-anchor" href="#${anchorId}" aria-label="Link to ${esc(param.name)}" title="Copy link">#</a>
        <code class="attr-name">${esc(param.name)}</code>
        <span class="attr-type">${esc(typeLabel(param.schema, itemSchema))}</span>
        ${param.required ? '<span class="attr-required">required</span>' : ''}
        ${param.schema.nullable ? '<span class="attr-nullable">nullable</span>' : ''}
        ${param.deprecated ? '<span class="attr-deprecated">deprecated</span>' : ''}
      </div>
      ${descriptionHtml(param.description || param.schema.description, 'attr-desc')}
      ${constraints}
      ${serialization ? `<div class="attr-constraints">${serialization}</div>` : ''}
      ${examples}
      ${enumPills(param.schema.enum ? param.schema : itemSchema)}
    </div>`;
}

function serializationHint(param) {
  const explode = param.explode ?? (param.style ?? 'form') === 'form';
  const style = param.style ?? 'form';
  if (style === 'form') return explode ? `${param.name}=a&${param.name}=b` : `${param.name}=a,b`;
  if (style === 'spaceDelimited') return `${param.name}=a%20b`;
  if (style === 'pipeDelimited') return `${param.name}=a|b`;
  if (style === 'deepObject') return `${param.name}[key]=value`;
  return style;
}

function requestBodyPane(spec, requestBody) {
  if (!requestBody) return '';
  const variants = requestBody.contents.map((content) => ({
    label: content.contentType,
    html: `${content.schemaName ? `<p class="doc-section-meta">Schema ${modelLink(content.schemaName)}</p>` : ''}
  ${examplesPanel('Example request body', content, `body-${slugify(requestBody.contentType)}-${slugify(content.contentType)}`)}
  ${content.schema ? schemaBody(spec, content.schema, { mode: 'request' }) : ''}`,
  }));
  return `<section class="doc-section" id="body-parameters">
  <h2>Body parameters</h2>
  <p class="doc-section-meta"><code>${esc(requestBody.contentType)}</code>${
    requestBody.contents.length > 1 ? ` <span class="doc-section-more">+${requestBody.contents.length - 1} more</span>` : ''
  } · ${requestBody.required ? 'required' : 'optional'}</p>
  ${requestBody.description ? `<div class="endpoint-desc endpoint-desc--section">${mdBlock(requestBody.description)}</div>` : ''}
  ${contentTabs(variants)}
</section>`;
}

let contentGroupCounter = 0;

/** One media type renders as-is; several get CSS-only tabs, one per type. */
function contentTabs(variants) {
  if (variants.length === 0) return '';
  if (variants.length === 1) return variants[0].html;
  const group = `content-${(contentGroupCounter += 1)}`;
  const inputs = variants
    .map((variant, index) => `<input class="variant-radio" type="radio" name="${group}" id="${group}-${index}"${index === 0 ? ' checked' : ''}>`)
    .join('');
  const labels = variants
    .map((variant, index) => `<label class="variant-tab variant-tab--mono" for="${group}-${index}">${esc(variant.label)}</label>`)
    .join('\n    ');
  const panes = variants.map((variant) => `<div class="variant-pane">\n${variant.html}\n  </div>`).join('\n  ');
  return `<div class="variants variants--content">
  ${inputs}
  <div class="variant-tabbar" role="presentation">
    ${labels}
  </div>
  ${panes}
</div>`;
}

function modelLink(name) {
  return `<a class="model-link" href="${esc(url(`/models/${slugify(name)}/`))}">${esc(name)}</a>`;
}

function responsesPane(spec, responses) {
  if (responses.length === 0) return '';
  const success = responses.filter((response) => /^[123]/.test(response.status));
  const errors = responses.filter((response) => !/^[123]/.test(response.status));
  return `<section class="doc-section">
${success.map((response) => responseCard(spec, response, true)).join('\n')}
${errors.length ? `  <h3 class="response-errors-title">Errors</h3>\n${errors.map((response) => responseCard(spec, response, false)).join('\n')}` : ''}
</section>`;
}

function responseCard(spec, response, open) {
  const variants = response.contents.map((content) => ({
    label: content.contentType,
    html: `${content.schema ? schemaBody(spec, content.schema, { expanded: true, mode: 'response' }) : ''}
      ${examplesPanel('Example response', content, `res-${slugify(response.status)}-${slugify(content.contentType)}`)}`,
  }));
  const headers = responseHeaders(response.headers);
  const body = [headers, contentTabs(variants)].filter((part) => part && part.trim()).join('\n');
  const link = response.schemaName ? modelLink(response.schemaName) : '';
  const types = response.contents.length > 1 ? `<span class="response-types">${response.contents.length} formats</span>` : '';
  // Scramble describes responses by their schema ("`UserData`"); beside the
  // model link that would say the same thing twice.
  const redundant = response.schemaName && response.description.replace(/`/g, '').trim() === response.schemaName;
  const head = `${statusBadge(response.status)}
      <span class="response-desc">${redundant ? '' : mdInline(response.description)}</span>${types}${link}`;
  if (!body) {
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
      ${body}
    </div>
  </details>`;
}

function responseHeaders(headers) {
  if (!headers?.length) return '';
  const rows = headers
    .map(
      (header) => `      <div class="attr-row">
        <div class="attr-head">
          <code class="attr-name">${esc(header.name)}</code>
          <span class="attr-type">${esc(typeLabel(header.schema))}</span>
          ${header.required ? '<span class="attr-required">required</span>' : ''}
          ${header.deprecated ? '<span class="attr-deprecated">deprecated</span>' : ''}
        </div>
        ${descriptionHtml(header.description, 'attr-desc')}
        ${constraintList(header.example !== undefined ? { ...header.schema, example: header.example } : header.schema)}
      </div>`,
    )
    .join('\n');
  return `<div class="response-headers">
      <p class="variants-intro">Headers</p>
      <div class="attr-list">
${rows}
      </div>
    </div>`;
}

/** Requests the API makes back to the client while handling this operation. */
function callbacksPane(spec, callbacks) {
  if (!callbacks?.length) return '';
  const cards = callbacks
    .map(({ name, expression, operation }) => {
      const body = operation.requestBody?.contents?.[0];
      return `  <details class="response-card callback-card">
    <summary class="response-head">
      ${methodBadge(operation.method)}
      <span class="response-desc"><strong>${esc(name)}</strong> · ${esc(operation.title)}</span>
      <svg class="response-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </summary>
    <div class="response-body">
      <p class="doc-section-meta">Sent to <code>${esc(expression)}</code></p>
      ${operation.description ? `<div class="endpoint-desc endpoint-desc--section">${mdBlock(operation.description)}</div>` : ''}
      ${body ? examplesPanel('Callback payload', body, `cb-${slugify(name)}-${slugify(operation.id)}`) : ''}
      ${body?.schema ? schemaBody(spec, body.schema, { mode: 'request' }) : ''}
    </div>
  </details>`;
    })
    .join('\n');
  return `<section class="doc-section">
  <h2>Callbacks</h2>
  <p class="doc-section-meta">Requests the API sends to your server while processing this one.</p>
${cards}
</section>`;
}

/**
 * Example(s) of one media type: a single block, or an example switcher
 * (CSS-only tabs) when the spec names several. Non-JSON values (CSV, plain
 * text) are shown as-is rather than as a JSON string literal.
 */
function examplesPanel(label, content, groupId) {
  const examples = content.examples ?? [];
  if (examples.length === 0) return '';
  const isJson = /json/.test(content.contentType ?? '') || typeof examples[0].value === 'object';

  const isXml = /xml/.test(content.contentType ?? '');
  const render = (value) =>
    isJson || typeof value !== 'string'
      ? highlight(JSON.stringify(value, null, 2), 'json')
      : isXml ? highlight(value, 'xml') : esc(value);
  if (examples.length === 1) return jsonPanel(label, examples[0].value, render);
  const tabs = examples.map((example, index) => ({
    id: `${groupId}-ex-${index}`,
    label: example.summary,
    checked: index === 0,
    code: render(example.value),
  }));
  return codePanel({
    groupId: `${groupId}-ex`,
    title: `<span class="code-panel-label">${esc(label)}</span>`,
    tabs,
    ariaLabel: label,
    className: 'code-panel--inline',
  });
}

/** Dark single-pane JSON block used inline in the content column. */
function jsonPanel(label, value, render = (v) => highlight(JSON.stringify(v, null, 2), 'json')) {
  if (value === null || value === undefined) return '';
  const code = render(value);
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
  const siblings = endpoint.kind === 'webhook' ? model.webhooks : model.endpoints.filter((other) => other.tagName === endpoint.tagName);
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
