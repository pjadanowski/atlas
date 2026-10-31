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
${mdBlock(model.descriptionHtml)}
</section>
${authSection(model)}
${resourceIndex(model)}
</article>`;
}

function authSection(model) {
  const bearer = model.auth.find((scheme) => scheme.scheme === 'bearer' || scheme.type === 'http');
  if (!bearer) return '';
  return `<section class="doc-section" id="authentication">
  <h2>Authentication</h2>
  <p>All protected endpoints expect a Bearer token in the <code>Authorization</code> header:</p>
  <p class="auth-header-example"><code>Authorization: Bearer &lt;TOKEN&gt;</code></p>
  ${bearer.description ? `<p>${mdInline(bearer.description)}</p>` : ''}
  <p>Endpoints that do not require a token are marked <span class="pill pill--success">Public</span> in the reference.</p>
</section>`;
}

function resourceIndex(model) {
  const groups = model.nav
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
      <a class="resource-name" href="${esc(url(first.href))}">${esc(node.name)}</a>
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
