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
    lines.push(`- [${endpoint.badge ?? endpoint.method} ${endpoint.title}](${url(endpoint.href)}index.md)${summary ? `: ${summary}` : ''}`);
  }
  if (model.models.length) {
    lines.push('', '## Models', '', `- ${model.models.length} schemas are browsable at ${url('/models/')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function endpointMarkdown(model, endpoint) {
  const lines = [`# ${endpoint.title}`, ''];
  if (endpoint.soap) {
    const soap = endpoint.soap;
    lines.push(
      `SOAP ${soap.version} operation \`${soap.operation}\` of service \`${soap.service}\` (${soap.style}/literal).`,
      '',
      `- Endpoint: \`POST ${soap.address}\``,
      soap.version === '1.1'
        ? `- Headers: \`Content-Type: text/xml; charset=utf-8\`, \`SOAPAction: "${soap.action}"\``
        : `- Header: \`Content-Type: application/soap+xml; charset=utf-8; action="${soap.action}"\``,
      ...soap.alternatives.map((alternative) => `- Also on SOAP ${alternative.version}: \`${alternative.address}\``),
    );
  } else {
    lines.push(`\`${endpoint.method} ${endpoint.path}\``, '', authenticationLine(endpoint));
  }
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
      lines.push(...fenced(endpoint.requestBody.example, endpoint.requestBody.contentType));
    }
  }

  if (endpoint.responses.length) {
    lines.push('', '## Responses');
    for (const response of endpoint.responses) {
      lines.push('', `### ${response.status}${response.description ? ` — ${plain(response.description)}` : ''}`);
      if (response.example !== null && response.example !== undefined) {
        lines.push('', ...fenced(response.example, response.contentType));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** JSON examples pretty-printed; XML and other text verbatim, with a matching fence. */
function fenced(value, contentType = '') {
  if (typeof value === 'string' && !/json/.test(contentType ?? '')) {
    return [`\`\`\`${/xml/.test(contentType ?? '') ? 'xml' : 'text'}`, value, '```'];
  }
  return ['```json', JSON.stringify(value, null, 2), '```'];
}

/** Which credentials the endpoint takes, from its security requirements. */
function authenticationLine(endpoint) {
  const alternatives = (endpoint.security ?? []).filter((alternative) => alternative.length > 0);
  if (alternatives.length === 0) return 'Authentication: none (public).';
  const options = alternatives.map((alternative) =>
    alternative.map((entry) => `${entry.scheme.label}${entry.scopes.length ? ` (scopes: ${entry.scopes.join(', ')})` : ''}`).join(' + '),
  );
  return `Authentication${endpoint.authOptional ? ' (optional)' : ''}: ${options.join(' or ')}.`;
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
