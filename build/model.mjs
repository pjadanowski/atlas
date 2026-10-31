import { deref, mergeAllOf } from './spec.mjs';
import { exampleFromSchema } from './example.mjs';
import { slugify } from './text.mjs';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

/**
 * Transforms the raw OpenAPI document into the domain model consumed by the
 * generator. Rendering code never touches raw OpenAPI objects.
 */
export function buildModel(spec) {
  const endpoints = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const shared = pathItem.parameters ?? [];
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation) endpoints.push(normalizeEndpoint(spec, method, path, operation, shared));
    }
  }
  assertUniqueHrefs(endpoints);
  return {
    title: spec.info?.title ?? 'API',
    version: spec.info?.version ?? '',
    descriptionHtml: spec.info?.description ?? '',
    baseUrl: spec.servers?.[0]?.url ?? '',
    servers: spec.servers ?? [],
    auth: normalizeAuth(spec),
    endpoints,
    nav: buildNav(spec, endpoints),
    models: normalizeModels(spec),
  };
}

/** components.schemas as browsable pages, alphabetical, slug-deduplicated. */
function normalizeModels(spec) {
  const seen = new Set();
  return Object.keys(spec.components?.schemas ?? {})
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const schema = mergeAllOf(spec, deref(spec, { $ref: `#/components/schemas/${name}` }).node);
      let slug = slugify(name);
      while (seen.has(slug)) slug += '-2';
      seen.add(slug);
      return {
        name,
        slug,
        href: `/models/${slug}/`,
        description: schema.description ?? '',
        schema,
        example: exampleFromSchema(spec, { $ref: `#/components/schemas/${name}` }),
      };
    });
}

function normalizeEndpoint(spec, method, path, operation, sharedParams) {
  const id = operation.operationId ?? slugify(`${method}-${path}`);
  const tag = operation.tags?.[0] ?? 'Other';
  const params = { path: [], query: [], header: [], cookie: [] };
  for (const raw of [...sharedParams, ...(operation.parameters ?? [])]) {
    const param = normalizeParameter(spec, raw);
    params[param.location]?.push(param);
  }
  return {
    id,
    slug: slugify(id),
    tag,
    href: `/${slugify(tag)}/${slugify(id)}/`,
    method: method.toUpperCase(),
    path,
    title: operation.summary?.replace(/\.$/, '') ?? `${method.toUpperCase()} ${path}`,
    description: operation.description ?? '',
    deprecated: operation.deprecated === true,
    requiresAuth: (operation.security ?? spec.security ?? []).length > 0,
    // Extra search terms an author can attach to an operation (`x-keywords`,
    // string or array) — synonyms, legacy names, business vocabulary.
    keywords: [operation['x-keywords'] ?? []].flat().map(String).filter(Boolean),
    params,
    requestBody: normalizeRequestBody(spec, operation.requestBody),
    responses: normalizeResponses(spec, operation.responses),
  };
}

/** Two endpoints slugging to the same href would silently overwrite each other's page. */
function assertUniqueHrefs(endpoints) {
  const seen = new Map();
  for (const endpoint of endpoints) {
    const other = seen.get(endpoint.href);
    if (other) {
      throw new Error(
        `Duplicate page href ${endpoint.href}: "${other.method} ${other.path}" and "${endpoint.method} ${endpoint.path}"`,
      );
    }
    seen.set(endpoint.href, endpoint);
  }
}

function normalizeParameter(spec, raw) {
  const { node } = deref(spec, raw);
  const schema = mergeAllOf(spec, deref(spec, node.schema ?? {}).node);
  return {
    name: node.name,
    location: node.in,
    required: node.required === true,
    deprecated: node.deprecated === true,
    description: node.description ?? '',
    schema,
    example: node.example ?? schema.example ?? schema.default ?? schema.enum?.[0],
    // Always-available value for the try-it console: explicit example first,
    // otherwise generated from the schema (Swagger-style type placeholders).
    sample: node.example ?? exampleFromSchema(spec, node.schema ?? {}),
  };
}

function normalizeRequestBody(spec, rawBody) {
  if (!rawBody) return null;
  const { node } = deref(spec, rawBody);
  const [contentType, media] = pickContent(node.content);
  if (!contentType) return null;
  const schemaRef = media.schema ?? {};
  const schema = mergeAllOf(spec, deref(spec, schemaRef).node);
  return {
    contentType,
    required: node.required === true,
    description: node.description ?? '',
    schema,
    schemaName: deref(spec, schemaRef).name,
    example: pickExample(spec, media, schemaRef),
  };
}

function normalizeResponses(spec, rawResponses) {
  const responses = [];
  for (const [status, rawResponse] of Object.entries(rawResponses ?? {})) {
    const { node } = deref(spec, rawResponse);
    const [contentType, media] = pickContent(node.content);
    const schemaRef = media?.schema;
    responses.push({
      status,
      description: node.description ?? '',
      contentType,
      schema: schemaRef ? mergeAllOf(spec, deref(spec, schemaRef).node) : null,
      schemaName: schemaRef ? deref(spec, schemaRef).name : null,
      example: media ? pickExample(spec, media, schemaRef) : null,
    });
  }
  // Numeric statuses ascending; non-numeric ("default") last, locale-independent.
  responses.sort((a, b) => {
    const an = Number(a.status);
    const bn = Number(b.status);
    if (Number.isNaN(an) || Number.isNaN(bn)) return Number.isNaN(an) - Number.isNaN(bn);
    return an - bn;
  });
  return responses;
}

function pickContent(content) {
  if (!content) return [null, null];
  const types = Object.keys(content);
  const preferred =
    types.find((type) => type.includes('json')) ??
    types.find((type) => type.includes('multipart')) ??
    types[0];
  return [preferred, content[preferred]];
}

function pickExample(spec, media, schemaRef) {
  if (media.example !== undefined) return media.example;
  const namedExamples = Object.values(media.examples ?? {});
  if (namedExamples.length > 0) {
    const { node } = deref(spec, namedExamples[0]);
    if (node.value !== undefined) return node.value;
  }
  return schemaRef ? exampleFromSchema(spec, schemaRef) : null;
}

function normalizeAuth(spec) {
  return Object.entries(spec.components?.securitySchemes ?? {}).map(([id, scheme]) => ({
    id,
    type: scheme.type,
    scheme: scheme.scheme ?? null,
    bearerFormat: scheme.bearerFormat ?? null,
    location: scheme.in ?? null,
    parameterName: scheme.name ?? null,
    description: scheme.description ?? '',
  }));
}

/**
 * Sidebar tree. Tags named "Parent - Child" nest below "Parent"; an implicit
 * parent node is created when the parent is not itself a tag.
 */
function buildNav(spec, endpoints) {
  const byTag = new Map();
  for (const endpoint of endpoints) {
    if (!byTag.has(endpoint.tag)) byTag.set(endpoint.tag, []);
    byTag.get(endpoint.tag).push(endpoint);
  }

  const declaredTags = (spec.tags ?? []).map((tag) => tag.name);
  const orderedTags = [...declaredTags, ...[...byTag.keys()].filter((t) => !declaredTags.includes(t))];

  const roots = [];
  const rootByName = new Map();
  const ensureRoot = (name) => {
    if (!rootByName.has(name)) {
      const node = { name, slug: slugify(name), endpoints: byTag.get(name) ?? [], children: [] };
      rootByName.set(name, node);
      roots.push(node);
    }
    return rootByName.get(name);
  };

  for (const tag of orderedTags) {
    const separator = ' - ';
    if (tag.includes(separator)) {
      const [parentName, childName] = [
        tag.slice(0, tag.indexOf(separator)),
        tag.slice(tag.indexOf(separator) + separator.length),
      ];
      ensureRoot(parentName).children.push({
        name: childName,
        tag,
        slug: slugify(tag),
        endpoints: byTag.get(tag) ?? [],
        children: [],
      });
    } else {
      ensureRoot(tag);
    }
  }
  return roots.filter((node) => node.endpoints.length > 0 || node.children.length > 0);
}
