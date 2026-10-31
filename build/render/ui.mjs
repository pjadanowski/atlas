import { esc } from '../text.mjs';

export function methodBadge(method) {
  return `<span class="method method--${method.toLowerCase()}">${esc(method)}</span>`;
}

export function statusBadge(status) {
  return `<span class="status status--${statusClass(status)}">${esc(status)}</span>`;
}

export function statusClass(status) {
  const first = String(status)[0];
  if (first === '2') return 'success';
  if (first === '3') return 'info';
  if (first === '4') return 'warning';
  if (first === '5') return 'danger';
  return 'info';
}

/**
 * Enum values as pills; the default value is highlighted. Very large enums
 * are skipped — their values are explained by the (collapsible) description.
 */
export function enumPills(schema) {
  if (!schema?.enum?.length || schema.enum.length > 20) return '';
  const pills = schema.enum
    .map((value) => {
      const isDefault = schema.default !== undefined && value === schema.default;
      return `<span class="enum-pill${isDefault ? ' enum-pill--default' : ''}">${esc(String(value))}</span>`;
    })
    .join('');
  return `<div class="enum-pills">${pills}</div>`;
}

/** Toggles a code panel between capped and full height (JS enhancement). */
export function expandButton() {
  return `<button type="button" class="expand-btn js-only" data-expand aria-label="Toggle full height" title="Expand / collapse">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg>
</button>`;
}

/** Copy button; hidden until the JS layer activates (progressive enhancement). */
export function copyButton(value, label = 'Copy') {
  const attr = value ? ` data-copy="${esc(value)}"` : '';
  return `<button type="button" class="copy-btn" aria-label="${esc(label)}"${attr}>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
</button>`;
}
