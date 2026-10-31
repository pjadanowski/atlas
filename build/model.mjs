import { deref, mergeAllOf } from './spec.mjs';
import { exampleFromSchema } from './example.mjs';
import { slugify } from './text.mjs';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

/**
 * Transforms the raw OpenAPI document into the domain model consumed by the
 * generator. Rendering code never touches raw OpenAPI objects.
 */
export function buildModel(spec) {
  const auth = normalizeAuth(spec);
  const tags = normalizeTags(spec);
  const endpoints = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    endpoints.push(...pathOperations(spec, path, pathItem, auth, tags));
  }
  assertUniqueHrefs(endpoints);
  const servers = normalizeServers(spec);
  return {
    title: spec.info?.title ?? 'API',
    version: spec.info?.version ?? '',
    summary: spec.info?.summary ?? '',
    descriptionHtml: spec.info?.description ?? '',
    contact: spec.info?.contact ?? null,
    license: spec.info?.license ?? null,
    baseUrl: servers[0]?.resolved ?? '',
    servers,
    auth,
    tags: [...tags.values()],
    endpoints,
    webhooks: normalizeWebhooks(spec, auth),
    nav: buildNav(spec, endpoints, tags),
    models: normalizeModels(spec),
  };
}

function pathOperations(spec, path, rawPathItem, auth, tags, extra = {}) {
  const { node: pathItem } = deref(spec, rawPathItem);
  const shared = pathItem.parameters ?? [];
  return HTTP_METHODS.filter((method) => pathItem[method]).map((method) =>
    normalizeEndpoint(spec, method, path, pathItem[method], shared, auth, tags, extra),
  );
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

function normalizeEndpoint(spec, method, path, operation, sharedParams, auth, tags, extra) {
  const id = operation.operationId ?? slugify(`${method}-${path}`);
  const tagName = operation.tags?.[0] ?? untaggedName(spec, path);
  const tag = tags.get(tagName) ?? { name: tagName, displayName: tagName, slug: slugify(tagName) };
  const params = { path: [], query: [], header: [], cookie: [] };
  // Operation parameters override path-level ones with the same name + location.
  const merged = new Map();
  for (const raw of [...sharedParams, ...(operation.parameters ?? [])]) {
    const param = normalizeParameter(spec, raw);
    merged.set(`${param.location}:${param.name}`, param);
  }
  for (const param of merged.values()) params[param.location]?.push(param);

  const security = normalizeSecurity(operation.security ?? spec.security ?? [], auth);
  const prefix = extra.hrefPrefix ?? `/${tag.slug}`;
  return {
    id,
    slug: slugify(id),
    kind: extra.kind ?? 'operation',
    tag: tag.displayName,
    tagName,
    href: `${prefix}/${slugify(id)}/`,
    method: method.toUpperCase(),
    path,
    title: operation.summary?.replace(/\.$/, '') ?? extra.title ?? `${method.toUpperCase()} ${path}`,
    description: operation.description ?? '',
    deprecated: operation.deprecated === true,
    security,
    // Some alternative must be satisfied, and none of them is "no auth" ({}).
    requiresAuth: security.length > 0 && security.every((alternative) => alternative.length > 0),
    authOptional: security.length > 0 && security.some((alternative) => alternative.length === 0),
    // Extra search terms an author can attach to an operation (`x-keywords`,
    // string or array) — synonyms, legacy names, business vocabulary.
    keywords: [operation['x-keywords'] ?? []].flat().map(String).filter(Boolean),
    // Redoc-style hand-written samples, shown before the generated ones.
    codeSamples: normalizeCodeSamples(operation['x-codeSamples'] ?? operation['x-code-samples']),
    params,
    requestBody: normalizeRequestBody(spec, operation.requestBody),
    responses: normalizeResponses(spec, operation.responses),
    callbacks: normalizeCallbacks(spec, operation.callbacks, auth, tags),
    externalDocs: operation.externalDocs ?? null,
    // Operation-level servers override the document's (OpenAPI allows it;
    // SOAP operations use it for their port's endpoint address).
    servers: operation.servers?.length ? normalizeServers({ servers: operation.servers }) : null,
    soap: operation['x-soap'] ?? null,
    // The operation's arguments as plain data, for SOAP toolkits that build
    // the envelope themselves (PHP SoapClient, zeep).
    soapArguments: operation['x-soap'] ? soapArguments(spec, operation) : null,
    // Label shown where the HTTP method would be: SOAP operations are all
    // POSTs on the wire, but "POST" says nothing useful about them.
    badge: operation['x-soap'] ? 'SOAP' : method.toUpperCase(),
  };
}

function soapArguments(spec, operation) {
  const media = Object.values(operation.requestBody?.content ?? {})[0];
  const value = media?.schema ? exampleFromSchema(spec, media.schema, 0, new Set(), 'request') : null;
  return value && typeof value === 'object' ? value : {};
}

function normalizeCodeSamples(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((sample) => sample && typeof sample.source === 'string')
    .map((sample) => ({
      lang: String(sample.lang ?? 'text'),
      label: String(sample.label ?? sample.lang ?? 'Sample'),
      source: sample.source,
    }));
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
  const examples = namedExamples(spec, node.examples);
  return {
    name: node.name,
    location: node.in,
    required: node.required === true || node.in === 'path',
    deprecated: node.deprecated === true,
    description: node.description ?? '',
    style: node.style ?? null,
    explode: node.explode ?? null,
    schema,
    examples,
    example: node.example ?? examples[0]?.value ?? schema.example ?? schema.default ?? schema.enum?.[0],
    // Always-available value for the try-it console: explicit example first,
    // otherwise generated from the schema (Swagger-style type placeholders).
    sample: node.example ?? examples[0]?.value ?? exampleFromSchema(spec, node.schema ?? {}, 0, new Set(), 'request', node.name),
  };
}

/** `examples: { name: Example | $ref }` → [{ key, summary, description, value }]. */
function namedExamples(spec, examples) {
  return Object.entries(examples ?? {})
    .map(([key, raw]) => {
      const { node } = deref(spec, raw);
      return {
        key,
        summary: node.summary ?? key,
        description: node.description ?? '',
        value: node.value,
        externalValue: node.externalValue ?? null,
      };
    })
    .filter((example) => example.value !== undefined);
}

/**
 * Every media type of a body or response, primary first, each with its
 * schema and examples. `mode` decides which of readOnly / writeOnly fields
 * the generated example leaves out.
 */
function normalizeContents(spec, content, mode) {
  const types = orderContentTypes(Object.keys(content ?? {}));
  return types.map((contentType) => {
    const media = content[contentType] ?? {};
    const schemaRef = media.schema ?? null;
    const resolved = schemaRef ? deref(spec, schemaRef) : null;
    const schema = resolved ? mergeAllOf(spec, resolved.node) : null;
    let examples = namedExamples(spec, media.examples);
    if (media.example !== undefined) examples = [{ key: 'example', summary: 'Example', description: '', value: media.example }, ...examples];
    if (examples.length === 0 && schemaRef) {
      const generated = exampleFromSchema(spec, schemaRef, 0, new Set(), mode);
      if (generated !== null && generated !== undefined) {
        examples = [{ key: 'generated', summary: 'Example', description: '', value: generated, generated: true }];
      }
    }
    return {
      contentType,
      schema,
      schemaName: resolved?.name ?? schema?.['x-ref-name'] ?? null,
      examples,
      encoding: media.encoding ?? null,
    };
  });
}

function orderContentTypes(types) {
  const rank = (type) => (type.includes('json') ? 0 : type.includes('multipart') ? 1 : type.includes('form') ? 2 : 3);
  return [...types].sort((a, b) => rank(a) - rank(b));
}

function normalizeRequestBody(spec, rawBody) {
  if (!rawBody) return null;
  const { node } = deref(spec, rawBody);
  const contents = normalizeContents(spec, node.content, 'request');
  if (contents.length === 0) return null;
  const primary = contents[0];
  return {
    required: node.required === true,
    description: node.description ?? '',
    contents,
    // Primary media type, flattened — what snippets, try-it and search use.
    contentType: primary.contentType,
    schema: primary.schema ?? {},
    schemaName: primary.schemaName,
    example: primary.examples[0]?.value ?? null,
  };
}

function normalizeResponses(spec, rawResponses) {
  const responses = [];
  for (const [status, rawResponse] of Object.entries(rawResponses ?? {})) {
    const { node } = deref(spec, rawResponse);
    const contents = normalizeContents(spec, node.content, 'response');
    const primary = contents[0] ?? null;
    responses.push({
      status,
      description: node.description ?? '',
      headers: normalizeHeaders(spec, node.headers),
      contents,
      contentType: primary?.contentType ?? null,
      schema: primary?.schema ?? null,
      schemaName: primary?.schemaName ?? null,
      example: primary?.examples[0]?.value ?? null,
    });
  }
  // Numeric statuses ascending, "2XX"-style ranges after their exact codes,
  // "default" last — locale-independent.
  const order = (status) => {
    const numeric = Number(status);
    if (!Number.isNaN(numeric)) return numeric;
    const range = /^([1-5])XX$/i.exec(status);
    return range ? Number(range[1]) * 100 + 99.5 : 1000;
  };
  responses.sort((a, b) => order(a.status) - order(b.status));
  return responses;
}

function normalizeHeaders(spec, headers) {
  return Object.entries(headers ?? {}).map(([name, raw]) => {
    const { node } = deref(spec, raw);
    const schema = mergeAllOf(spec, deref(spec, node.schema ?? {}).node) ?? {};
    return {
      name,
      description: node.description ?? '',
      required: node.required === true,
      deprecated: node.deprecated === true,
      schema,
      example: node.example ?? schema.example,
    };
  });
}

/** `callbacks: { name: { expression: PathItem } }` → flat list of requests the API makes. */
function normalizeCallbacks(spec, callbacks, auth, tags) {
  const out = [];
  for (const [name, rawCallback] of Object.entries(callbacks ?? {})) {
    const { node: callback } = deref(spec, rawCallback);
    for (const [expression, pathItem] of Object.entries(callback ?? {})) {
      for (const operation of pathOperations(spec, expression, pathItem, auth, tags, { kind: 'callback', hrefPrefix: '/callbacks' })) {
        out.push({ name, expression, operation });
      }
    }
  }
  return out;
}

/** OpenAPI 3.1 top-level `webhooks`: requests the API sends, one page each. */
function normalizeWebhooks(spec, auth) {
  const out = [];
  for (const [name, rawPathItem] of Object.entries(spec.webhooks ?? {})) {
    const { node: pathItem } = deref(spec, rawPathItem);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const endpoint = normalizeEndpoint(spec, method, name, operation, pathItem.parameters ?? [], auth, new Map(), {
        kind: 'webhook',
        hrefPrefix: '/webhooks',
        title: name,
      });
      endpoint.tag = 'Webhooks';
      endpoint.webhookName = name;
      out.push(endpoint);
    }
  }
  return out;
}

function normalizeAuth(spec) {
  return Object.entries(spec.components?.securitySchemes ?? {}).map(([id, raw]) => {
    const { node: scheme } = deref(spec, raw);
    return {
      id,
      type: scheme.type,
      scheme: scheme.scheme?.toLowerCase() ?? null,
      bearerFormat: scheme.bearerFormat ?? null,
      location: scheme.in ?? null,
      parameterName: scheme.name ?? null,
      description: scheme.description ?? '',
      flows: scheme.flows ?? null,
      openIdConnectUrl: scheme.openIdConnectUrl ?? null,
      label: authLabel(scheme),
    };
  });
}

/** Short human name of a security scheme: "Bearer token", "API key (X-API-Key header)". */
export function authLabel(scheme) {
  if (scheme.type === 'http') {
    const kind = scheme.scheme?.toLowerCase();
    if (kind === 'bearer') return scheme.bearerFormat ? `Bearer token (${scheme.bearerFormat})` : 'Bearer token';
    if (kind === 'basic') return 'Basic auth';
    return `HTTP ${scheme.scheme}`;
  }
  if (scheme.type === 'apiKey') return `API key (${scheme.name} ${scheme.in})`;
  if (scheme.type === 'oauth2') return 'OAuth 2.0';
  if (scheme.type === 'openIdConnect') return 'OpenID Connect';
  if (scheme.type === 'mutualTLS') return 'Mutual TLS';
  return scheme.type ?? 'Unknown';
}

/**
 * Security requirements → alternatives (OR) of scheme lists (AND), each
 * entry carrying the resolved scheme and its required scopes. `{}` becomes
 * an empty alternative: authentication is optional.
 */
function normalizeSecurity(requirements, auth) {
  const byId = new Map(auth.map((scheme) => [scheme.id, scheme]));
  return requirements.map((requirement) =>
    Object.entries(requirement ?? {})
      .filter(([id]) => byId.has(id))
      .map(([id, scopes]) => ({ id, scopes: scopes ?? [], scheme: byId.get(id) })),
  );
}

/**
 * Servers with their variables substituted by defaults (`resolved`) — the
 * URL snippets use — and the variables kept for the try-it console.
 */
function normalizeServers(spec) {
  const servers = spec.servers?.length ? spec.servers : [];
  return servers.map((server) => {
    const variables = Object.entries(server.variables ?? {}).map(([name, variable]) => ({
      name,
      default: String(variable.default ?? ''),
      enum: (variable.enum ?? []).map(String),
      description: variable.description ?? '',
    }));
    let resolved = server.url ?? '';
    for (const variable of variables) resolved = resolved.replaceAll(`{${variable.name}}`, variable.default);
    return {
      url: server.url ?? '',
      resolved: resolved.replace(/\/$/, ''),
      description: server.description ?? '',
      variables,
    };
  });
}

// Untagged operations go to "Other" — unless there are this many, in which
// case one bucket is no navigation at all (Stripe's spec has no tags; 600
// operations under "Other"). Then they are grouped by their first
// meaningful path segment: /v1/charges/{id} → "Charges".
const UNTAGGED_GROUPING_AFTER = 30;
const untaggedCounts = new WeakMap();

function untaggedName(spec, path) {
  if (!untaggedCounts.has(spec)) {
    let count = 0;
    for (const pathItem of Object.values(spec.paths ?? {})) {
      const item = deref(spec, pathItem).node ?? {};
      count += HTTP_METHODS.filter((method) => item[method] && !item[method].tags?.length).length;
    }
    untaggedCounts.set(spec, count);
  }
  if (untaggedCounts.get(spec) <= UNTAGGED_GROUPING_AFTER) return 'Other';
  const segment = path
    .split('/')
    .find((part) => part && !part.startsWith('{') && !/^(v\d+(\.\d+)*|api|rest)$/i.test(part));
  if (!segment) return 'Other';
  const words = segment.replace(/[-_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Declared tags (description, x-displayName) by name; undeclared ones are added on first use. */
function normalizeTags(spec) {
  const tags = new Map();
  for (const tag of spec.tags ?? []) {
    tags.set(tag.name, {
      name: tag.name,
      displayName: tag['x-displayName'] ?? tag.name,
      description: tag.description ?? '',
      externalDocs: tag.externalDocs ?? null,
      slug: slugify(tag.name),
    });
  }
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = deref(spec, pathItem).node?.[method];
      const name = operation ? operation.tags?.[0] ?? untaggedName(spec, path) : null;
      if (name && !tags.has(name)) {
        tags.set(name, { name, displayName: name, description: '', externalDocs: null, slug: slugify(name) });
      }
    }
  }
  // Tag pages live at /<slug>/, next to the generator's own top-level dirs.
  const reserved = new Set(['assets', 'models', 'webhooks', 'callbacks', 'mcp']);
  const taken = new Set();
  for (const tag of tags.values()) {
    while (reserved.has(tag.slug) || taken.has(tag.slug)) tag.slug += '-tag';
    taken.add(tag.slug);
    tag.href = `/${tag.slug}/`;
  }
  return tags;
}

/**
 * Sidebar tree as sections: one per `x-tagGroups` entry, or a single
 * "API Reference" section. Tags named "Parent - Child" nest below "Parent";
 * an implicit parent node is created when the parent is not itself a tag.
 */
function buildNav(spec, endpoints, tags) {
  const byTag = new Map();
  for (const endpoint of endpoints) {
    if (!byTag.has(endpoint.tagName)) byTag.set(endpoint.tagName, []);
    byTag.get(endpoint.tagName).push(endpoint);
  }
  const declared = (spec.tags ?? []).map((tag) => tag.name);
  const allTags = [...declared, ...[...byTag.keys()].filter((name) => !declared.includes(name))];

  const groups = Array.isArray(spec['x-tagGroups']) ? spec['x-tagGroups'] : [];
  const sections = groups.map((group) => ({ name: group.name, tags: (group.tags ?? []).filter((name) => byTag.has(name)) }));
  // SOAP services (build/wsdl.mjs) get a section of their own, last.
  const soapTags = (spec['x-atlas-soap-tags'] ?? []).filter((name) => byTag.has(name));
  const grouped = new Set([...sections.flatMap((section) => section.tags), ...soapTags]);
  const rest = allTags.filter((name) => !grouped.has(name));
  if (rest.length > 0) sections.push({ name: sections.length ? 'Other' : 'API Reference', tags: rest });
  if (soapTags.length > 0) sections.push({ name: 'SOAP services', tags: soapTags });

  return sections
    .map((section) => ({ name: section.name, nodes: tagTree(section.tags, byTag, tags) }))
    .filter((section) => section.nodes.length > 0);
}

function tagTree(tagNames, byTag, tags) {
  const roots = [];
  const rootByName = new Map();
  const tagNode = (name, display) => {
    const tag = tags.get(name);
    return {
      name: display ?? tag?.displayName ?? name,
      tag: name,
      slug: tag?.slug ?? slugify(name),
      href: tag?.href ?? null,
      description: tag?.description ?? '',
      endpoints: byTag.get(name) ?? [],
      children: [],
    };
  };
  const ensureRoot = (name) => {
    if (!rootByName.has(name)) {
      const node = tagNode(name);
      rootByName.set(name, node);
      roots.push(node);
    }
    return rootByName.get(name);
  };

  const separator = ' - ';
  for (const name of tagNames) {
    if (name.includes(separator)) {
      const parentName = name.slice(0, name.indexOf(separator));
      const childName = name.slice(name.indexOf(separator) + separator.length);
      const display = tags.get(name)?.displayName;
      ensureRoot(parentName).children.push(tagNode(name, display && display !== name ? display : childName));
    } else {
      ensureRoot(name);
    }
  }
  return roots.filter((node) => node.endpoints.length > 0 || node.children.length > 0);
}
