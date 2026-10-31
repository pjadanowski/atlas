import { url } from './url.mjs';

/**
 * Build-time search index, consumed by the browser (⌘K palette), the MCP
 * server and the Laravel package. Each entry carries the fields the fuzzy
 * engine ranks — title, path, keywords, description — plus what the result
 * row needs to render. Hrefs are baked as ready-to-use URLs because results
 * are rendered straight into <a href>.
 *
 * Keys are short on purpose: the file is fetched on first search.
 *   t title · m method · p path · h href · g group (tag) · o operationId
 *   s short description (display) · d description (search, longer)
 *   k keywords: operationId words, path segments, parameter and body field
 *     names, response schema names, x-keywords from the spec
 */
export function buildSearchIndex(model) {
  return [
    ...model.endpoints.map((endpoint) => ({
      t: endpoint.title,
      m: endpoint.method,
      p: endpoint.path,
      h: url(endpoint.href),
      g: endpoint.tag,
      o: endpoint.id,
      s: truncate(endpoint.description, 120),
      d: truncate(endpoint.description, 400),
      k: keywords([
        endpoint.id,
        endpoint.path.replace(/[{}]/g, ' '),
        ...endpoint.keywords,
        ...['path', 'query', 'header', 'cookie'].flatMap((where) =>
          endpoint.params[where].map((param) => param.name),
        ),
        ...Object.keys(endpoint.requestBody?.schema?.properties ?? {}),
        endpoint.requestBody?.schemaName,
        ...endpoint.responses.map((response) => response.schemaName),
      ]),
    })),
    ...(model.models ?? []).map((entry) => ({
      t: entry.name,
      m: 'SCHEMA',
      p: '',
      h: url(entry.href),
      g: 'Models',
      o: entry.name,
      s: truncate(entry.description, 120),
      d: truncate(entry.description, 400),
      k: keywords(Object.keys(entry.schema?.properties ?? {})),
    })),
  ];
}

function keywords(values) {
  const seen = new Set();
  for (const value of values) {
    for (const word of String(value ?? '').split(/[\s/,;|]+/)) {
      if (word) seen.add(word);
    }
  }
  return [...seen].join(' ');
}

function truncate(text, max) {
  const clean = String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
