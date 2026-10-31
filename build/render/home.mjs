import { esc, mdBlock, mdInline } from '../text.mjs';
import { url } from '../url.mjs';
import { methodBadge } from './ui.mjs';

/** Landing page: intro from the spec, authentication guide, resource index. */
export function homeContent(model) {
  return `<article class="home">
<header class="home-header">
  <p class="endpoint-crumb">API Reference</p>
  <h1>${esc(model.title)}</h1>
  <p class="home-lede">Version ${esc(model.version)} · Every endpoint, schema and example — generated from the OpenAPI specification.</p>
</header>
<section class="doc-section home-intro">
${mdBlock(model.descriptionHtml, { headingIds: true })}
</section>
${authSection(model)}
${resourceIndex(model)}
</article>`;
}

function authSection(model) {
  if (model.auth.length === 0) return '';
  const used = new Set(model.endpoints.flatMap((endpoint) => endpoint.security.flat().map((entry) => entry.id)));
  const schemes = model.auth.filter((scheme) => used.has(scheme.id) || model.auth.length <= 3);
  const publicCount = model.endpoints.filter((endpoint) => !endpoint.requiresAuth && !endpoint.authOptional).length;
  const cards = schemes.map((scheme) => authCard(scheme)).join('\n');
  return `<section class="doc-section" id="authentication">
  <h2>Authentication</h2>
  <p>${schemes.length === 1 ? 'Protected endpoints use one scheme:' : `The API accepts ${schemes.length} authentication schemes — each endpoint lists the ones it takes.`}</p>
  <div class="auth-cards">
${cards}
  </div>
  ${publicCount ? `<p>Endpoints that need no credentials are marked <span class="pill pill--success">Public</span> in the reference.</p>` : ''}
</section>`;
}

function authCard(scheme) {
  const example = authExample(scheme);
  const flows = Object.entries(scheme.flows ?? {})
    .map(([name, flow]) => {
      const scopes = Object.entries(flow.scopes ?? {});
      const urls = [
        flow.authorizationUrl ? `authorize <code>${esc(flow.authorizationUrl)}</code>` : '',
        flow.tokenUrl ? `token <code>${esc(flow.tokenUrl)}</code>` : '',
      ].filter(Boolean).join(' · ');
      return `<div class="auth-card-flow">
        <p><strong>${esc(FLOW_NAMES[name] ?? name)}</strong>${urls ? ` — ${urls}` : ''}</p>
        ${scopes.length ? `<ul class="auth-card-scopes">${scopes.map(([scope, description]) => `<li><code>${esc(scope)}</code> ${mdInline(description)}</li>`).join('')}</ul>` : ''}
      </div>`;
    })
    .join('\n');
  return `    <div class="auth-card" id="auth-${esc(scheme.id)}">
      <p class="auth-card-head"><strong>${esc(scheme.label)}</strong> <code class="auth-scheme-id">${esc(scheme.id)}</code></p>
      ${scheme.description ? `<p class="auth-card-desc">${mdInline(scheme.description)}</p>` : ''}
      ${example ? `<p class="auth-header-example"><code>${esc(example)}</code></p>` : ''}
      ${scheme.openIdConnectUrl ? `<p class="auth-card-desc">Discovery: <a href="${esc(scheme.openIdConnectUrl)}" rel="noopener" target="_blank">${esc(scheme.openIdConnectUrl)}</a></p>` : ''}
      ${flows}
    </div>`;
}

const FLOW_NAMES = {
  clientCredentials: 'Client credentials',
  authorizationCode: 'Authorization code',
  password: 'Password',
  implicit: 'Implicit',
};

function authExample(scheme) {
  if (scheme.type === 'http' && scheme.scheme === 'basic') return 'Authorization: Basic base64(username:password)';
  if (scheme.type === 'apiKey') {
    if (scheme.location === 'header') return `${scheme.parameterName}: <API_KEY>`;
    if (scheme.location === 'query') return `?${scheme.parameterName}=<API_KEY>`;
    if (scheme.location === 'cookie') return `Cookie: ${scheme.parameterName}=<API_KEY>`;
  }
  if (scheme.type === 'mutualTLS') return '';
  return 'Authorization: Bearer <TOKEN>';
}

function resourceIndex(model) {
  const groups = model.nav
    .flatMap((section) => section.nodes)
    .map((node) => {
      const total = countEndpoints(node);
      const first = firstEndpoint(node);
      if (!first) return '';
      const preview = node.endpoints
        .slice(0, 3)
        .map(
          (endpoint) =>
            `<a class="resource-endpoint" href="${esc(url(endpoint.href))}">${methodBadge(endpoint.method)}<span>${esc(endpoint.title)}</span></a>`,
        )
        .join('\n      ');
      return `    <div class="resource-card">
      <a class="resource-name" href="${esc(url(node.description && node.href ? node.href : first.href))}">${esc(node.name)}</a>
      <p class="resource-count">${total} ${total === 1 ? 'endpoint' : 'endpoints'}</p>
      ${preview}
    </div>`;
    })
    .filter(Boolean)
    .join('\n');
  return `<section class="doc-section">
  <h2>Resources</h2>
  <div class="resource-grid">
${groups}
  </div>
</section>`;
}

function countEndpoints(node) {
  return node.endpoints.length + node.children.reduce((sum, child) => sum + countEndpoints(child), 0);
}

function firstEndpoint(node) {
  return node.endpoints[0] ?? node.children.map(firstEndpoint).find(Boolean) ?? null;
}

/** One tag: its description and every operation in it, Scalar-style overview. */
export function tagContent(model, tag) {
  const endpoints = model.endpoints.filter((endpoint) => endpoint.tagName === tag.name);
  const rows = endpoints
    .map(
      (endpoint) => `    <a class="tag-endpoint${endpoint.deprecated ? ' is-deprecated' : ''}" href="${esc(url(endpoint.href))}">
      ${methodBadge(endpoint.method)}
      <code class="tag-endpoint-path">${esc(endpoint.path)}</code>
      <span class="tag-endpoint-title">${esc(endpoint.title)}</span>
    </a>`,
    )
    .join('\n');
  return `<article class="home">
<header class="endpoint-header">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="${esc(url('/'))}">API</a>
    <span class="crumbs-sep" aria-hidden="true">›</span>
    <span aria-current="page">${esc(tag.displayName)}</span>
  </nav>
  <h1>${esc(tag.displayName)}</h1>
  ${tag.description ? `<div class="endpoint-desc">${mdBlock(tag.description)}</div>` : ''}
  ${tag.externalDocs?.url ? `<p class="endpoint-extdocs"><a href="${esc(tag.externalDocs.url)}" rel="noopener" target="_blank">${esc(tag.externalDocs.description ?? 'External documentation')} ↗</a></p>` : ''}
</header>
<section class="doc-section">
  <h2>Endpoints</h2>
  <div class="tag-endpoints">
${rows}
  </div>
</section>
</article>`;
}
