import { descriptionHtml, esc } from '../text.mjs';
import { url } from '../url.mjs';
import { highlight } from '../highlight.mjs';
import { schemaBody } from './schema.mjs';
import { copyButton, expandButton } from './ui.mjs';

/** Index page: every schema from components.schemas, grouped by first letter. */
export function modelsIndexContent(model) {
  const groups = new Map();
  for (const entry of model.models) {
    const letter = entry.name[0].toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(entry);
  }
  const sections = [...groups.entries()]
    .map(
      ([letter, entries]) => `  <section class="doc-section model-group">
    <h2>${esc(letter)}</h2>
    <div class="model-grid">
${entries.map(modelCard).join('\n')}
    </div>
  </section>`,
    )
    .join('\n');
  return `<article class="home">
<header class="home-header">
  <p class="endpoint-crumb">API Reference</p>
  <h1>Models</h1>
  <p class="home-lede">${model.models.length} schemas used by requests and responses — generated from <code>components.schemas</code>.</p>
</header>
${sections}
</article>`;
}

function modelCard(entry) {
  const count = Object.keys(entry.schema?.properties ?? {}).length;
  const variants = (entry.schema?.oneOf ?? entry.schema?.anyOf)?.length ?? 0;
  const summary = count || !variants ? `${count} ${count === 1 ? 'field' : 'fields'}` : `${variants} variants`;
  return `      <a class="model-card" href="${esc(url(entry.href))}">
        <span class="model-card-name">${esc(entry.name)}</span>
        <span class="model-card-count">${summary}</span>
      </a>`;
}

/** Detail page for one schema. */
export function modelContent(spec, entry) {
  // A model page is the whole shape of one schema — show it, don't make the
  // reader click through every level to see what they came for.
  const body = schemaBody(spec, entry.schema, { expanded: true, mode: 'model' });
  const nested = body.includes('<details class="child-attrs"');
  return `<article class="endpoint">
<header class="endpoint-header">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="${esc(url('/'))}">API</a>
    <span class="crumbs-sep" aria-hidden="true">›</span>
    <a href="${esc(url('/models/'))}">Models</a>
    <span class="crumbs-sep" aria-hidden="true">›</span>
    <span aria-current="page">${esc(entry.name)}</span>
  </nav>
  <h1><code class="model-title">${esc(entry.name)}</code></h1>
  ${entry.description ? descriptionHtml(entry.description, 'endpoint-desc') : ''}
</header>
<section class="doc-section">
  <div class="doc-section-head">
    <h2>Attributes</h2>
${nested ? attributeTools() : ''}  </div>
  ${body || '<p class="doc-section-meta">No documented attributes.</p>'}
</section>
</article>`;
}

/**
 * Expand/collapse all nested attribute cards. JS-only: without it the <details>
 * elements still work one by one, so nothing is lost when the buttons are gone.
 */
function attributeTools() {
  return `    <div class="attr-tools js-only">
      <button type="button" class="attr-tool" data-attrs-toggle="expand">Expand all</button>
      <button type="button" class="attr-tool" data-attrs-toggle="collapse">Collapse all</button>
    </div>
`;
}

/** Dark code column: the schema's generated example. */
export function modelCodeColumn(entry) {
  if (entry.example === null || entry.example === undefined) return '';
  return `<section class="code-panel" aria-label="Example">
  <header class="code-panel-head">
    <div class="code-panel-title"><span class="code-panel-label">Example · ${esc(entry.name)}</span></div>
    <div class="code-panel-actions">
      ${expandButton()}
      ${copyButton(null, 'Copy code')}
    </div>
  </header>
  <div class="code-tabs">
    <div class="code-pane">
      <pre tabindex="0"><code>${highlight(JSON.stringify(entry.example, null, 2), 'json')}</code></pre>
    </div>
  </div>
</section>`;
}
