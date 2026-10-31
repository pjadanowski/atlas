import { deref, mergeAllOf } from '../spec.mjs';
import { descriptionHtml, esc } from '../text.mjs';
import { enumPills } from './ui.mjs';

const MAX_DEPTH = 8;

/**
 * Renders a schema as Stripe-style attribute rows. Nested objects collapse
 * into <details> cards ("child attributes") — no JavaScript required.
 *
 * `expanded` opens every nested card up front. Model pages use it: a schema
 * page exists to show the whole shape, so hiding it behind a click per level
 * makes the reader work for what they came for. Endpoint pages keep the
 * collapsed default, where attributes are one section among many.
 */
export function attributeRows(spec, schema, { expanded = false, depth = 0, seenRefs = new Set() } = {}) {
  const properties = Object.entries(schema?.properties ?? {});
  if (properties.length === 0) return '';
  const required = new Set(schema.required ?? []);
  return properties
    .map(([name, raw]) => attributeRow(spec, name, raw, required.has(name), { expanded, depth, seenRefs }))
    .join('\n');
}

function attributeRow(spec, name, raw, isRequired, { expanded, depth, seenRefs }) {
  const refPath = raw?.$ref ?? raw?.items?.$ref ?? null;
  const recursive = refPath !== null && seenRefs.has(refPath);
  const seen = refPath ? new Set([...seenRefs, refPath]) : seenRefs;

  const { node, name: refName } = deref(spec, raw ?? {});
  const schema = mergeAllOf(spec, node);
  const itemInfo = schema.type === 'array' ? deref(spec, schema.items ?? {}) : null;
  const item = itemInfo ? mergeAllOf(spec, itemInfo.node) : null;

  const meta = [
    `<code class="attr-name">${esc(name)}</code>`,
    `<span class="attr-type">${esc(typeLabel(schema, item, refName ?? itemInfo?.name))}</span>`,
    isRequired ? '<span class="attr-required">required</span>' : '',
    schema.nullable ? '<span class="attr-nullable">nullable</span>' : '',
    schema.deprecated ? '<span class="attr-deprecated">deprecated</span>' : '',
  ]
    .filter(Boolean)
    .join('\n      ');

  const body = [
    descriptionHtml(schema.description, 'attr-desc'),
    constraintList(schema),
    enumPills(schema.enum ? schema : item),
    recursive
      ? `<p class="attr-recursive">Recursive structure — see <code>${esc(refName ?? 'Schema')}</code></p>`
      : childAttributes(spec, schema, item, { expanded, depth, seenRefs: seen }),
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

function childAttributes(spec, schema, item, { expanded, depth, seenRefs }) {
  if (depth >= MAX_DEPTH) return '';
  const target = schema.type === 'array' ? item : schema;
  if (!target?.properties || Object.keys(target.properties).length === 0) return '';
  const rows = attributeRows(spec, target, { expanded, depth: depth + 1, seenRefs });
  return `<details class="child-attrs"${expanded ? ' open' : ''}>
      <summary><span class="child-attrs-show">Show child attributes</span><span class="child-attrs-hide">Hide child attributes</span></summary>
      <div class="child-attrs-body">
${rows}
      </div>
    </details>`;
}

export function typeLabel(schema, item = null, refName = null) {
  if (schema.type === 'array') {
    const inner = item ? typeLabel(item, null, refName) : 'any';
    return `array<${inner}>`;
  }
  if (schema.enum?.length) return `enum<${schema.type ?? 'string'}>`;
  if (schema.type === 'object' || schema.properties) {
    return refName ? `object (${refName})` : 'object';
  }
  if (schema.oneOf || schema.anyOf) return 'oneOf';
  const format = schema.format ? `<${schema.format}>` : '';
  return `${schema.type ?? 'any'}${format}`;
}

function constraintList(schema) {
  const parts = [];
  if (schema.default !== undefined) {
    parts.push(`<span class="attr-constraint">Default: <code>${esc(JSON.stringify(schema.default))}</code></span>`);
  }
  for (const [key, label] of [
    ['minimum', 'Min'],
    ['maximum', 'Max'],
    ['minLength', 'Min length'],
    ['maxLength', 'Max length'],
    ['pattern', 'Pattern'],
  ]) {
    if (schema[key] !== undefined) {
      parts.push(`<span class="attr-constraint">${label}: <code>${esc(String(schema[key]))}</code></span>`);
    }
  }
  if (schema.example !== undefined && typeof schema.example !== 'object') {
    parts.push(`<span class="attr-constraint">Example: <code>${esc(JSON.stringify(schema.example))}</code></span>`);
  }
  return parts.length ? `<div class="attr-constraints">${parts.join('\n      ')}</div>` : '';
}
