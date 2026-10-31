import { deref, mergeAllOf, schemaRefName } from '../spec.mjs';
import { descriptionHtml, esc, slugify } from '../text.mjs';
import { url } from '../url.mjs';
import { enumPills } from './ui.mjs';

const MAX_DEPTH = 8;

// Radio groups need page-unique ids; a build-wide counter is the simplest
// thing that is unique on every page.
let variantGroupCounter = 0;

/**
 * Renders a schema's documentation body: attribute rows for its properties,
 * then its oneOf/anyOf variants and its additionalProperties, whichever it
 * has. Every place that shows a schema goes through here, so a body that is
 * nothing but a `oneOf` renders its variants instead of an empty list.
 *
 * Options:
 * - `expanded` opens every nested card up front. Model pages and responses
 *   use it: there the shape is what the reader came for.
 * - `mode` is `'request'`, `'response'` or `'model'`. Requests hide
 *   `readOnly` properties (the server sets them), responses hide `writeOnly`
 *   ones (never sent back); model pages show both, badged.
 */
export function schemaBody(spec, schema, options = {}) {
  const opts = { expanded: false, depth: 0, seenRefs: new Set(), mode: 'model', ...options };
  const rows = attributeRows(spec, schema, opts);
  return [
    rows ? `<div class="attr-list">\n${rows}\n</div>` : '',
    variantsBlock(spec, schema, opts),
    mapBlock(spec, schema, opts),
  ]
    .filter(Boolean)
    .join('\n');
}

export function attributeRows(spec, schema, options = {}) {
  const opts = { expanded: false, depth: 0, seenRefs: new Set(), mode: 'model', ...options };
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {})
    .filter(([, raw]) => isVisible(spec, raw, opts.mode))
    .map(([name, raw]) => attributeRow(spec, name, raw, required.has(name), opts))
    .join('\n');
}

function isVisible(spec, raw, mode) {
  if (mode === 'model') return true;
  const { node } = deref(spec, raw ?? {});
  if (mode === 'request' && (raw?.readOnly || node.readOnly)) return false;
  if (mode === 'response' && (raw?.writeOnly || node.writeOnly)) return false;
  return true;
}

function attributeRow(spec, name, raw, isRequired, opts) {
  const refPath = raw?.$ref ?? raw?.items?.$ref ?? null;
  const recursive = refPath !== null && opts.seenRefs.has(refPath);
  const seenRefs = refPath ? new Set([...opts.seenRefs, refPath]) : opts.seenRefs;

  const { node, name: refName } = deref(spec, raw ?? {});
  // `$ref` siblings (3.1) describe this use of the schema: they win.
  const schema = { ...mergeAllOf(spec, node), ...siblingsOf(raw) };
  const itemInfo = schema.type === 'array' ? deref(spec, schema.items ?? {}) : null;
  const item = itemInfo ? mergeAllOf(spec, itemInfo.node) : null;
  const displayRef = schemaRefName(schema, refName) ?? (item ? schemaRefName(item, itemInfo.name) : null);

  const meta = [
    `<code class="attr-name">${esc(name)}</code>`,
    `<span class="attr-type">${esc(typeLabel(schema, item, displayRef))}</span>`,
    isRequired ? '<span class="attr-required">required</span>' : '',
    schema.nullable ? '<span class="attr-nullable">nullable</span>' : '',
    opts.mode === 'model' && schema.readOnly ? '<span class="attr-flag">read-only</span>' : '',
    opts.mode === 'model' && schema.writeOnly ? '<span class="attr-flag">write-only</span>' : '',
    schema.deprecated ? '<span class="attr-deprecated">deprecated</span>' : '',
  ]
    .filter(Boolean)
    .join('\n      ');

  const child = recursive
    ? `<p class="attr-recursive">Recursive structure — see ${modelRef(displayRef ?? 'Schema')}</p>`
    : childAttributes(spec, schema, item, { ...opts, seenRefs });

  const body = [
    descriptionHtml(schema.description, 'attr-desc'),
    constraintList(schema, item),
    enumPills(schema.enum ? schema : item),
    child,
  ]
    .filter(Boolean)
    .join('\n    ');

  return `<div class="attr-row">
    <div class="attr-head">
      ${meta}
    </div>
    ${body}
  </div>`;
}

/** Keys written next to a `$ref` — in 3.1 they refine the referenced schema. */
function siblingsOf(raw) {
  if (!raw?.$ref) return {};
  const { $ref: _ref, ...rest } = raw;
  return rest;
}

function childAttributes(spec, schema, item, opts) {
  if (opts.depth >= MAX_DEPTH) return '';
  const target = schema.type === 'array' ? item : schema;
  if (!target) return '';
  const inner = schemaBody(spec, target, { ...opts, depth: opts.depth + 1 });
  if (!inner) return '';
  const label = target.oneOf || target.anyOf ? 'variants' : 'child attributes';
  return `<details class="child-attrs"${opts.expanded ? ' open' : ''}>
      <summary><span class="child-attrs-show">Show ${label}</span><span class="child-attrs-hide">Hide ${label}</span></summary>
      <div class="child-attrs-body">
${inner}
      </div>
    </details>`;
}

/**
 * oneOf / anyOf as CSS-only tabs (radio group), one per variant, each
 * rendering that variant's own body. A discriminator is spelled out above
 * the tabs, with the value that selects each variant on its tab.
 */
function variantsBlock(spec, schema, opts) {
  const key = schema?.oneOf ? 'oneOf' : schema?.anyOf ? 'anyOf' : null;
  if (!key || opts.depth >= MAX_DEPTH) return '';
  const discriminator = schema.discriminator?.propertyName ?? null;
  const mapping = invertMapping(schema.discriminator?.mapping);

  const group = `variant-${(variantGroupCounter += 1)}`;
  const variants = schema[key].map((raw, index) => {
    const { node, name } = deref(spec, raw ?? {});
    const variant = mergeAllOf(spec, node);
    const refName = schemaRefName(variant, name);
    const label = variant.title ?? refName ?? typeLabel(variant) ?? `Option ${index + 1}`;
    const selector = discriminator ? mapping.get(raw?.$ref) ?? refName : null;
    const seenRefs = raw?.$ref ? new Set([...opts.seenRefs, raw.$ref]) : opts.seenRefs;
    const recursive = raw?.$ref && opts.seenRefs.has(raw.$ref);
    const body = recursive
      ? `<p class="attr-recursive">Recursive structure — see ${modelRef(refName)}</p>`
      : schemaBody(spec, variant, { ...opts, depth: opts.depth + 1, seenRefs });
    return { id: `${group}-${index}`, label, selector, refName, variant, body };
  });

  const inputs = variants
    .map((v, index) => `<input class="variant-radio" type="radio" name="${group}" id="${v.id}"${index === 0 ? ' checked' : ''}>`)
    .join('');
  const labels = variants
    .map((v) => `<label class="variant-tab" for="${v.id}">${esc(v.label)}</label>`)
    .join('\n      ');
  const panes = variants
    .map((v) => {
      const head = [
        v.selector ? `<span class="variant-when"><code>${esc(discriminator)}</code> = <code>${esc(JSON.stringify(v.selector))}</code></span>` : '',
        v.refName ? modelRef(v.refName) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<div class="variant-pane">
      ${head ? `<p class="variant-meta">${head}</p>` : ''}
      ${descriptionHtml(v.variant.description, 'attr-desc')}
      ${v.body || `<p class="variant-meta">${esc(typeLabel(v.variant))}</p>`}
    </div>`;
    })
    .join('\n    ');

  const intro = key === 'oneOf' ? 'Exactly one of' : 'Any of';
  return `<div class="variants">
    <p class="variants-intro">${intro}${discriminator ? `, selected by <code>${esc(discriminator)}</code>` : ''}</p>
    ${inputs}
    <div class="variant-tabbar">
      ${labels}
    </div>
    ${panes}
  </div>`;
}

function invertMapping(mapping) {
  const out = new Map();
  for (const [value, ref] of Object.entries(mapping ?? {})) {
    if (!out.has(ref)) out.set(ref, value);
  }
  return out;
}

/** `additionalProperties` with an object schema: document the value shape. */
function mapBlock(spec, schema, opts) {
  const extra = schema?.additionalProperties;
  if (!extra || typeof extra !== 'object' || opts.depth >= MAX_DEPTH) return '';
  const { node } = deref(spec, extra);
  const value = mergeAllOf(spec, node);
  const inner = schemaBody(spec, value, { ...opts, depth: opts.depth + 1 });
  if (!inner) return '';
  return `<div class="map-values">
    <p class="variants-intro">Each value</p>
    ${inner}
  </div>`;
}

function modelRef(name) {
  if (!name) return '';
  return `<a class="model-link" href="${esc(url(`/models/${slugify(name)}/`))}">${esc(name)}</a>`;
}

export function typeLabel(schema, item = null, refName = null) {
  if (!schema) return 'any';
  if (schema.type === 'array') {
    const inner = item ? typeLabel(item, null, refName) : 'any';
    return `array<${inner}>`;
  }
  if (schema.const !== undefined) return `const ${JSON.stringify(schema.const)}`;
  if (schema.enum?.length) return `enum<${schema.type ?? 'string'}>`;
  if (schema.oneOf || schema.anyOf) {
    return refName ?? (schema.oneOf ? 'oneOf' : 'anyOf');
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    if (refName) return refName;
    const extra = schema.additionalProperties;
    if (extra && typeof extra === 'object' && !schema.properties) {
      const valueRef = extra.$ref?.split('/').pop() ?? null;
      const value = extra.$ref ? {} : extra;
      const valueItem = value.type === 'array' && value.items && !value.items.$ref ? value.items : null;
      return `map<string, ${typeLabel(value, valueItem, valueRef ?? value.items?.$ref?.split('/').pop() ?? null)}>`;
    }
    return 'object';
  }
  if (schema.types) return schema.types.join(' | ');
  const format = schema.format ? `<${schema.format}>` : '';
  return `${schema.type ?? 'any'}${format}`;
}

const CONSTRAINTS = [
  ['minimum', 'Min'],
  ['exclusiveMin', 'Greater than'],
  ['maximum', 'Max'],
  ['exclusiveMax', 'Less than'],
  ['multipleOf', 'Multiple of'],
  ['minLength', 'Min length'],
  ['maxLength', 'Max length'],
  ['pattern', 'Pattern'],
  ['minItems', 'Min items'],
  ['maxItems', 'Max items'],
  ['minProperties', 'Min properties'],
  ['maxProperties', 'Max properties'],
];

export function constraintList(schema, item = null) {
  const parts = [];
  if (schema.default !== undefined) {
    parts.push(constraint('Default', JSON.stringify(schema.default)));
  }
  for (const [key, label] of CONSTRAINTS) {
    if (schema[key] !== undefined) parts.push(constraint(label, String(schema[key])));
  }
  if (schema.uniqueItems) parts.push('<span class="attr-constraint">Unique items</span>');
  // Array items carry their own bounds ("each 3–64 characters").
  if (item) {
    for (const [key, label] of CONSTRAINTS) {
      if (item[key] !== undefined) parts.push(constraint(`Each item ${label.toLowerCase()}`, String(item[key])));
    }
  }
  if (schema.example !== undefined && typeof schema.example !== 'object') {
    parts.push(constraint('Example', JSON.stringify(schema.example)));
  }
  return parts.length ? `<div class="attr-constraints">${parts.join('\n      ')}</div>` : '';
}

function constraint(label, value) {
  return `<span class="attr-constraint">${esc(label)}: <code>${esc(value)}</code></span>`;
}
