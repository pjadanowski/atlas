/**
 * Plain-markdown mirrors of the documentation, for AI tooling and copy-paste:
 * llms.txt at the site root (https://llmstxt.org) plus one index.md next to
 * every endpoint page.
 */

import { url } from './url.mjs';

export function llmsIndex(model) {
  const lines = [
    `# ${model.title}`,
    '',
    `> API documentation for ${model.title} v${model.version}. Base URL: ${model.baseUrl}. OpenAPI spec: ${url('/openapi.json')}`,
    '',
    '## API Reference',
    '',
  ];
  for (const endpoint of model.endpoints) {
    const summary = plain(endpoint.description).slice(0, 140);
    lines.push(`- [${endpoint.method} ${endpoint.title}](${url(endpoint.href)}index.md)${summary ? `: ${summary}` : ''}`);
  }
  if (model.models.length) {
    lines.push('', '## Models', '', `- ${model.models.length} schemas are browsable at ${url('/models/')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function endpointMarkdown(model, endpoint) {
  const lines = [
    `# ${endpoint.title}`,
    '',
    `\`${endpoint.method} ${endpoint.path}\``,
    '',
    endpoint.requiresAuth ? 'Authentication: Bearer token required.' : 'Authentication: none (public).',
  ];
  const description = plain(endpoint.description);
  if (description) lines.push('', description);

  for (const [title, params] of [
    ['Path parameters', endpoint.params.path],
    ['Query parameters', endpoint.params.query],
    ['Header parameters', endpoint.params.header],
  ]) {
    if (params.length === 0) continue;
    lines.push('', `## ${title}`, '');
    for (const param of params) {
      const type = param.schema?.type ?? 'any';
      const flags = [type, param.required ? 'required' : 'optional'].join(', ');
      const desc = plain(param.description);
      lines.push(`- \`${param.name}\` (${flags})${desc ? ` — ${desc}` : ''}`);
    }
  }

  if (endpoint.requestBody) {
    lines.push('', `## Request body (${endpoint.requestBody.contentType})`, '');
    if (endpoint.requestBody.example !== null && endpoint.requestBody.example !== undefined) {
      lines.push('```json', JSON.stringify(endpoint.requestBody.example, null, 2), '```');
    }
  }

  if (endpoint.responses.length) {
    lines.push('', '## Responses');
    for (const response of endpoint.responses) {
      lines.push('', `### ${response.status}${response.description ? ` — ${plain(response.description)}` : ''}`);
      if (response.example !== null && response.example !== undefined) {
        lines.push('', '```json', JSON.stringify(response.example, null, 2), '```');
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Markdown twin of a model page: fields, types, example — what an AI assistant needs. */
export function modelMarkdown(entry) {
  const lines = [`# ${entry.name}`, '', 'Schema from `components.schemas`.'];
  const description = plain(entry.description);
  if (description) lines.push('', description);

  const properties = Object.entries(entry.schema?.properties ?? {});
  if (properties.length) {
    const required = new Set(entry.schema.required ?? []);
    lines.push('', '## Fields', '');
    for (const [name, schema] of properties) {
      const flags = [typeLabel(schema), required.has(name) ? 'required' : 'optional'];
      if (schema?.nullable) flags.push('nullable');
      const desc = plain(schema?.description);
      lines.push(`- \`${name}\` (${flags.join(', ')})${desc ? ` — ${desc}` : ''}`);
      if (Array.isArray(schema?.enum) && schema.enum.length <= 20) {
        lines.push(`  - one of: ${schema.enum.map((value) => `\`${value}\``).join(', ')}`);
      }
    }
  }

  if (entry.example !== null && entry.example !== undefined) {
    lines.push('', '## Example', '', '```json', JSON.stringify(entry.example, null, 2), '```');
  }
  return `${lines.join('\n')}\n`;
}

/** "string (date-time)", "array<Kunde>", "Adresse" — compact type for a field row. */
function typeLabel(schema) {
  if (!schema || typeof schema !== 'object') return 'any';
  if (schema.$ref) return String(schema.$ref).split('/').pop();
  if (schema.type === 'array') return `array<${typeLabel(schema.items)}>`;
  const type = Array.isArray(schema.type) ? schema.type.join('|') : schema.type ?? (schema.properties ? 'object' : 'any');
  return schema.format ? `${type} (${schema.format})` : type;
}

/** Strips the HTML/markdown mix found in spec descriptions down to plain text. */
function plain(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
