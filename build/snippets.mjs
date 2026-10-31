/**
 * Build-time code sample generation. Plain template strings — deterministic,
 * no runtime work in the browser.
 *
 * One language-neutral request description (`describeRequest`) feeds a
 * generator per client. Values that come from the environment (credentials)
 * travel as templates: arrays of literal strings and `{ env: 'NAME' }` parts,
 * which every language renders with its own string and env syntax.
 */

// Ids double as tab-id suffixes the browser uses to remember the reader's
// language (`…-${id}`), so none may end in "-<another id>".
export const SNIPPET_LANGUAGES = [
  { id: 'curl', label: 'cURL', language: 'bash' },
  { id: 'httpie', label: 'HTTPie', language: 'bash' },
  { id: 'javascript', label: 'JavaScript', language: 'javascript' },
  { id: 'guzzle', label: 'Guzzle', language: 'php' },
  { id: 'laravel', label: 'Laravel', language: 'php' },
  { id: 'php', label: 'PHP', language: 'php' },
  { id: 'python', label: 'Python', language: 'python' },
  { id: 'httpx', label: 'HTTPX', language: 'python' },
  { id: 'go', label: 'Go', language: 'go' },
  { id: 'ruby', label: 'Ruby', language: 'ruby' },
  { id: 'java', label: 'Java', language: 'java' },
  { id: 'csharp', label: 'C#', language: 'csharp' },
];

const GENERATORS = {
  curl: curlSnippet,
  httpie: httpieSnippet,
  javascript: javascriptSnippet,
  guzzle: guzzleSnippet,
  laravel: laravelSnippet,
  php: phpCurlSnippet,
  python: (request) => pythonSnippet(request, 'requests'),
  httpx: (request) => pythonSnippet(request, 'httpx'),
  go: goSnippet,
  ruby: rubySnippet,
  java: javaSnippet,
  csharp: csharpSnippet,
};

export function buildSnippets(endpoint, baseUrl) {
  const request = describeRequest(endpoint, baseUrl);
  return Object.fromEntries(SNIPPET_LANGUAGES.map(({ id }) => [id, GENERATORS[id](request)]));
}

// ---------------------------------------------------------------------------
// Request description
// ---------------------------------------------------------------------------

/**
 * {
 *   method, url: Tpl,
 *   headers: [{ name, value: Tpl, token?: envName }],   // token: "Bearer <env>"
 *   basic: { user, password } | null,                   // env var names
 *   mtls: boolean,
 *   body: null
 *     | { kind: 'json', contentType, value }
 *     | { kind: 'form', fields: [[name, string]] }
 *     | { kind: 'multipart', fields: [{ name, value } | { name, file }] }
 *     | { kind: 'raw', contentType, text } | { kind: 'raw', contentType, file },
 *   response: 'json' | 'text' | 'none',
 * }
 */
function describeRequest(endpoint, baseUrl) {
  let path = endpoint.path;
  for (const param of endpoint.params.path) {
    const value = paramValue(param);
    // Function replacement: values containing "$&"-style sequences must not
    // be interpreted as replacement patterns.
    path = path.replace(`{${param.name}}`, () =>
      value === undefined ? `{${param.name}}` : encodeURIComponent(scalarString(value)),
    );
  }
  const query = endpoint.params.query.filter((param) => param.required).flatMap(queryPairs);
  const auth = authParts(endpoint);
  const headers = [...auth.headers];

  const response = responseInfo(endpoint);
  if (response.contentType) headers.push({ name: 'Accept', value: [response.contentType] });
  for (const param of endpoint.params.header) {
    if (!param.required) continue;
    const value = paramValue(param);
    headers.push({ name: param.name, value: [value === undefined ? `<${param.name}>` : headerString(value)] });
  }
  const cookies = [...auth.cookies];
  for (const param of endpoint.params.cookie) {
    if (!param.required) continue;
    const value = paramValue(param);
    cookies.push([`${param.name}=`, value === undefined ? `<${param.name}>` : scalarString(value)]);
  }
  if (cookies.length) {
    headers.push({ name: 'Cookie', value: joinTpl(cookies.map((cookie) => cookie.flat()), '; ') });
  }

  const urlParts = [`${baseUrl}${path}`];
  const pairs = [...query.map(([k, v]) => [`${k}=${v}`]), ...auth.query];
  if (pairs.length) urlParts.push('?', ...joinTpl(pairs, '&'));

  const body = describeBody(endpoint.requestBody);
  if (body && (body.kind === 'json' || body.kind === 'raw')) {
    headers.push({ name: 'Content-Type', value: [body.contentType], contentType: true });
  }
  return {
    method: endpoint.method,
    url: mergeTpl(urlParts),
    headers: headers.map((header) => ({ ...header, value: mergeTpl(header.value) })),
    basic: auth.basic,
    mtls: auth.mtls,
    body,
    response: response.kind,
  };
}

function paramValue(param) {
  return param.example !== undefined ? param.example : param.sample ?? undefined;
}

/** "name=value" pairs (already encoded) honoring style/explode. */
function queryPairs(param) {
  const name = encodeURIComponent(param.name);
  const value = paramValue(param);
  if (value === undefined || value === null) return [[name, `<${param.name}>`]];
  const style = param.style ?? 'form';
  const explode = param.explode ?? style === 'form';
  const enc = (v) => encodeURIComponent(scalarString(v));
  if (Array.isArray(value)) {
    if (style === 'form' && explode) return value.map((item) => [name, enc(item)]);
    const sep = style === 'spaceDelimited' ? '%20' : style === 'pipeDelimited' ? '|' : ',';
    return [[name, value.map(enc).join(sep)]];
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (style === 'deepObject') return entries.map(([k, v]) => [`${name}%5B${encodeURIComponent(k)}%5D`, enc(v)]);
    if (explode) return entries.map(([k, v]) => [encodeURIComponent(k), enc(v)]);
    return [[name, entries.flatMap(([k, v]) => [encodeURIComponent(k), enc(v)]).join(',')]];
  }
  return [[name, enc(value)]];
}

function scalarString(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function headerString(value) {
  return Array.isArray(value) ? value.map(scalarString).join(',') : scalarString(value);
}

/**
 * Credentials for the first non-empty security alternative — every scheme of
 * it (AND), as env-var placeholders.
 */
function authParts(endpoint) {
  const result = { headers: [], query: [], cookies: [], basic: null, mtls: false };
  const alternative = (endpoint.security ?? []).find((alt) => alt.length > 0) ?? [];
  const used = new Set();
  const envName = (preferred, fallback) => {
    const name = used.has(preferred) ? fallback : preferred;
    used.add(name);
    return name;
  };
  for (const { scheme } of alternative) {
    if (!scheme) continue;
    if (scheme.type === 'http' && scheme.scheme === 'basic') {
      result.basic = { user: 'API_USER', password: 'API_PASSWORD' };
    } else if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      const env = envName('API_TOKEN', `${envSafe(scheme.id)}_TOKEN`);
      result.headers.push({ name: 'Authorization', value: ['Bearer ', { env }], token: env });
    } else if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      const env = envName('ACCESS_TOKEN', `${envSafe(scheme.id)}_TOKEN`);
      result.headers.push({ name: 'Authorization', value: ['Bearer ', { env }], token: env });
    } else if (scheme.type === 'http') {
      const label = scheme.scheme ? scheme.scheme[0].toUpperCase() + scheme.scheme.slice(1) : 'Token';
      const env = envName('API_TOKEN', `${envSafe(scheme.id)}_TOKEN`);
      result.headers.push({ name: 'Authorization', value: [`${label} `, { env }] });
    } else if (scheme.type === 'apiKey' && scheme.parameterName) {
      const env = envName('API_KEY', envSafe(scheme.parameterName));
      if (scheme.location === 'query') result.query.push([`${encodeURIComponent(scheme.parameterName)}=`, { env }]);
      else if (scheme.location === 'cookie') result.cookies.push([`${scheme.parameterName}=`, { env }]);
      else result.headers.push({ name: scheme.parameterName, value: [{ env }] });
    } else if (scheme.type === 'mutualTLS') {
      result.mtls = true;
    }
  }
  return result;
}

function envSafe(text) {
  return String(text).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'API';
}

function responseInfo(endpoint) {
  const success =
    endpoint.responses.find((response) => /^2/.test(response.status)) ??
    endpoint.responses.find((response) => response.status === 'default');
  const contentType = success?.contentType ?? null;
  if (!contentType) return { kind: 'none', contentType: null };
  return { kind: isJson(contentType) ? 'json' : 'text', contentType };
}

function isJson(contentType) {
  return /[/+]json\b/i.test(contentType);
}

function describeBody(requestBody) {
  if (!requestBody) return null;
  const { contentType, example, schema } = requestBody;
  if (isJson(contentType)) return { kind: 'json', contentType, value: example ?? {} };
  if (/^application\/x-www-form-urlencoded/i.test(contentType)) {
    return { kind: 'form', fields: formFields(example) };
  }
  if (/^multipart\//i.test(contentType)) {
    return { kind: 'multipart', fields: multipartFields(requestBody) };
  }
  const binary =
    schema?.format === 'binary' ||
    schema?.contentMediaType !== undefined ||
    /octet-stream|^image\/|^audio\/|^video\/|pdf|zip/i.test(contentType);
  if (binary) return { kind: 'raw', contentType, file: `./file.${extensionFor(contentType)}` };
  const text = typeof example === 'string' ? example : example === null || example === undefined ? '' : JSON.stringify(example, null, 2);
  return { kind: 'raw', contentType, text };
}

/** Example object → [name, string] pairs; arrays repeat the key. */
function formFields(example) {
  if (!example || typeof example !== 'object' || Array.isArray(example)) return [];
  return Object.entries(example).flatMap(([name, value]) => fieldValues(value).map((v) => [name, v]));
}

function fieldValues(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined).map(scalarString) : [scalarString(value)];
}

function multipartFields(requestBody) {
  const properties = requestBody.schema?.properties ?? {};
  const required = new Set(requestBody.schema?.required ?? []);
  const example = requestBody.example && typeof requestBody.example === 'object' ? requestBody.example : {};
  const fields = [];
  for (const [name, schema] of Object.entries(properties)) {
    if (isFileSchema(schema) || isFileSchema(schema?.items)) {
      const hint = requestBody.contents?.[0]?.encoding?.[name]?.contentType ?? schema?.contentMediaType ?? '';
      fields.push({ name, file: `./file.${extensionFor(hint)}` });
      continue;
    }
    let values = fieldValues(example[name]);
    if (values.length === 0 && required.has(name)) {
      const fallback = schema?.example ?? schema?.default ?? schema?.enum?.[0];
      values = fallback === undefined ? [`<${name}>`] : fieldValues(fallback);
    }
    for (const value of values) fields.push({ name, value });
  }
  return fields;
}

function isFileSchema(schema) {
  return Boolean(schema) && (schema.format === 'binary' || schema.contentMediaType !== undefined);
}

function extensionFor(contentType) {
  const first = String(contentType).split(',')[0].trim().toLowerCase();
  const known = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'text/csv': 'csv', 'text/plain': 'txt', 'application/zip': 'zip', 'application/json': 'json' };
  return known[first] ?? (first.includes('pdf') ? 'pdf' : 'bin');
}

// ---------------------------------------------------------------------------
// Templates: arrays of literal strings and { env } parts
// ---------------------------------------------------------------------------

function joinTpl(tpls, separator) {
  return tpls.flatMap((tpl, index) => (index === 0 ? tpl : [separator, ...tpl]));
}

/** Merges adjacent literal parts and drops empty ones. */
function mergeTpl(parts) {
  const out = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part === '') continue;
      if (typeof out[out.length - 1] === 'string') out[out.length - 1] += part;
      else out.push(part);
    } else {
      out.push(part);
    }
  }
  return out.length ? out : [''];
}

const hasEnv = (tpl) => tpl.some((part) => typeof part !== 'string');
const literalOf = (tpl) => tpl.join('');

/** Renders a template as `lit(a) op env(B) op lit(c)`. */
function concatTpl(tpl, lit, env, op) {
  return tpl.map((part) => (typeof part === 'string' ? lit(part) : env(part.env))).join(op);
}

/** Double-quoted shell word; env parts expand. */
function shTpl(tpl) {
  let out = '';
  tpl.forEach((part, index) => {
    if (typeof part === 'string') {
      out += part.replace(/[\\"$`]/g, (c) => `\\${c}`);
    } else {
      const next = tpl[index + 1];
      out += typeof next === 'string' && /^\w/.test(next) ? `\${${part.env}}` : `$${part.env}`;
    }
  });
  return `"${out}"`;
}

const shSingle = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/** JSON.stringify yields a valid double-quoted literal in JS, Python, Go, Java and C#. */
const dq = (text) => JSON.stringify(text);

/** Single-quoted (no interpolation); double-quoted with escapes when control characters need them. */
function phpStr(text) {
  if (!/[\x00-\x1f\x7f]/.test(text)) return `'${text.replace(/[\\']/g, (c) => `\\${c}`)}'`;
  const named = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v', '\f': '\\f', '\x1b': '\\e' };
  const escaped = text.replace(/[\\"$\x00-\x1f\x7f]/g, (c) =>
    named[c] ?? (c < ' ' || c === '\x7f' ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}` : `\\${c}`),
  );
  return `"${escaped}"`;
}

const rubyStr = (text) => JSON.stringify(text).replace(/#/g, '\\#');

const loneEnv = (tpl) => (tpl.length === 1 && typeof tpl[0] !== 'string' ? tpl[0].env : null);

function jsTpl(tpl) {
  if (!hasEnv(tpl)) return dq(literalOf(tpl));
  if (loneEnv(tpl)) return `process.env.${loneEnv(tpl)}`;
  const body = tpl
    .map((part) =>
      typeof part === 'string'
        ? part.replace(/[\\`]/g, (c) => `\\${c}`).replaceAll('${', '\\${')
        : `\${process.env.${part.env}}`,
    )
    .join('');
  return `\`${body}\``;
}

function pyTpl(tpl) {
  if (!hasEnv(tpl)) return dq(literalOf(tpl));
  if (loneEnv(tpl)) return `os.environ["${loneEnv(tpl)}"]`;
  const body = tpl
    .map((part) =>
      typeof part === 'string'
        ? dq(part).slice(1, -1).replaceAll('{', '{{').replaceAll('}', '}}')
        : `{os.environ['${part.env}']}`,
    )
    .join('');
  return `f"${body}"`;
}

function rubyTpl(tpl) {
  if (loneEnv(tpl)) return `ENV["${loneEnv(tpl)}"]`;
  return `"${tpl.map((part) => (typeof part === 'string' ? rubyStr(part).slice(1, -1) : `#{ENV["${part.env}"]}`)).join('')}"`;
}

const phpTpl = (tpl, envFn = 'getenv') => concatTpl(tpl, phpStr, (name) => `${envFn}('${name}')`, ' . ');
const goTpl = (tpl) => concatTpl(tpl, dq, (name) => `os.Getenv("${name}")`, '+');
const javaTpl = (tpl) => concatTpl(tpl, dq, (name) => `System.getenv("${name}")`, ' + ');
const csTpl = (tpl) => concatTpl(tpl, dq, (name) => `Environment.GetEnvironmentVariable("${name}")`, ' + ');

const usesEnv = (request) =>
  hasEnv(request.url) || request.headers.some((header) => hasEnv(header.value)) || request.basic !== null;

/** form fields → "a=1&b=2" */
function urlEncoded(fields) {
  return fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

const hasRepeats = (names) => new Set(names).size !== names.length;

// ---------------------------------------------------------------------------
// Shell clients
// ---------------------------------------------------------------------------

function curlSnippet({ method, url, headers, basic, mtls, body }) {
  const verb = method === 'GET' ? '' : method === 'HEAD' ? ' --head' : ` -X ${method}`;
  const lines = [`curl${verb} ${shTpl(url)}`];
  if (basic) lines.push(`  -u ${shTpl([{ env: basic.user }, ':', { env: basic.password }])}`);
  if (mtls) lines.push('  --cert ./client.pem --key ./client.key');
  for (const header of headers) lines.push(`  -H ${shTpl([`${header.name}: `, ...header.value])}`);
  if (body?.kind === 'json') lines.push(`  -d ${shSingle(JSON.stringify(body.value, null, 2))}`);
  if (body?.kind === 'form') {
    for (const [name, value] of body.fields) lines.push(`  --data-urlencode ${shSingle(`${name}=${value}`)}`);
  }
  if (body?.kind === 'multipart') {
    for (const field of body.fields) {
      if (field.file) lines.push(`  -F ${shSingle(`${field.name}=@${field.file}`)}`);
      // -F treats leading @/< and ";type=" specially; --form-string never does.
      else if (/^[@<]|;/.test(field.value)) lines.push(`  --form-string ${shSingle(`${field.name}=${field.value}`)}`);
      else lines.push(`  -F ${shSingle(`${field.name}=${field.value}`)}`);
    }
  }
  if (body?.kind === 'raw') {
    lines.push(`  --data-binary ${body.file ? shSingle(`@${body.file}`) : shSingle(body.text)}`);
  }
  return lines.join(' \\\n');
}

function httpieSnippet({ method, url, headers, basic, mtls, body }) {
  const flags = [];
  if (body?.kind === 'form') flags.push('--form');
  if (body?.kind === 'multipart') flags.push('--multipart');
  const lines = [`http ${[...flags, method].join(' ')} ${shTpl(url)}`];
  if (basic) lines.push(`  -a ${shTpl([{ env: basic.user }, ':', { env: basic.password }])}`);
  if (mtls) lines.push('  --cert ./client.pem --cert-key ./client.key');
  for (const header of headers) lines.push(`  ${shTpl([`${header.name}:`, ...header.value])}`);
  if (body?.kind === 'form') {
    for (const [name, value] of body.fields) lines.push(`  ${shSingle(`${httpieKey(name)}=${value}`)}`);
  }
  if (body?.kind === 'multipart') {
    for (const field of body.fields) {
      lines.push(`  ${shSingle(field.file ? `${httpieKey(field.name)}@${field.file}` : `${httpieKey(field.name)}=${field.value}`)}`);
    }
  }
  let prefix = '';
  if (body?.kind === 'json') prefix = `echo ${shSingle(JSON.stringify(body.value, null, 2))} | `;
  if (body?.kind === 'raw' && !body.file) prefix = `printf '%s' ${shSingle(body.text)} | `;
  const command = lines.join(' \\\n');
  if (body?.kind === 'raw' && body.file) return `${command} \\\n  < ${body.file}`;
  return prefix + command;
}

/** HTTPie request-item keys: separator characters must be backslash-escaped. */
function httpieKey(name) {
  return name.replace(/[\\:=@]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// JavaScript (fetch)
// ---------------------------------------------------------------------------

function jsKey(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : dq(name);
}

function javascriptSnippet({ method, url, headers, basic, body, response }) {
  const prelude = [];
  const headerLines = [];
  if (basic) {
    headerLines.push(
      `    Authorization: "Basic " + btoa(\`\${process.env.${basic.user}}:\${process.env.${basic.password}}\`),`,
    );
  }
  for (const header of headers) headerLines.push(`    ${jsKey(header.name)}: ${jsTpl(header.value)},`);

  const options = [`  method: ${dq(method)},`];
  if (headerLines.length) options.push('  headers: {', ...headerLines, '  },');

  if (body?.kind === 'json') {
    options.push(`  body: JSON.stringify(${indentTail(JSON.stringify(body.value, null, 2), 1, '  ')}),`);
  } else if (body?.kind === 'form') {
    const names = body.fields.map(([name]) => name);
    if (hasRepeats(names)) {
      options.push(`  body: new URLSearchParams([`, ...body.fields.map(([k, v]) => `    [${dq(k)}, ${dq(v)}],`), '  ]),');
    } else {
      options.push(`  body: new URLSearchParams({`, ...body.fields.map(([k, v]) => `    ${jsKey(k)}: ${dq(v)},`), '  }),');
    }
  } else if (body?.kind === 'multipart') {
    if (body.fields.some((field) => field.file)) prelude.push('import { openAsBlob } from "node:fs";', '');
    prelude.push('const form = new FormData();');
    for (const field of body.fields) {
      prelude.push(
        field.file
          ? `form.append(${dq(field.name)}, await openAsBlob(${dq(field.file)}), ${dq(field.file.replace(/^.*\//, ''))});`
          : `form.append(${dq(field.name)}, ${dq(field.value)});`,
      );
    }
    prelude.push('');
    options.push('  body: form,');
  } else if (body?.kind === 'raw') {
    if (body.file) {
      prelude.push('import { openAsBlob } from "node:fs";', '');
      options.push(`  body: await openAsBlob(${dq(body.file)}),`);
    } else {
      options.push(`  body: ${dq(body.text)},`);
    }
  }
  const read =
    response === 'json' ? 'const data = await response.json();' : response === 'text' ? 'const data = await response.text();' : 'console.log(response.status);';
  return [...prelude, `const response = await fetch(${jsTpl(url)}, {`, ...options, '});', '', read].join('\n');
}

// ---------------------------------------------------------------------------
// PHP: Guzzle, Laravel HTTP client, ext-curl
// ---------------------------------------------------------------------------

function phpArrayLines(entries, depth) {
  const pad = '    '.repeat(depth);
  return entries.map(([key, value]) => `${pad}${phpStr(key)} => ${value},`);
}

function guzzleSnippet({ method, url, headers, basic, mtls, body, response }) {
  const options = [];
  if (basic) options.push(`    'auth' => [getenv('${basic.user}'), getenv('${basic.password}')],`);
  if (mtls) options.push("    'cert' => './client.pem',", "    'ssl_key' => './client.key',");
  // The 'json' option sets Content-Type: application/json itself.
  const sendHeaders = headers.filter((header) => !(header.contentType && body?.contentType === 'application/json'));
  if (sendHeaders.length) {
    options.push("    'headers' => [", ...phpArrayLines(sendHeaders.map((h) => [h.name, phpTpl(h.value)]), 2), '    ],');
  }
  if (body?.kind === 'json') options.push(`    'json' => ${phpValue(body.value, 1)},`);
  if (body?.kind === 'form') {
    if (hasRepeats(body.fields.map(([name]) => name))) {
      // form_params would encode arrays PHP-style (key[0]=…); send the exact string.
      options.push(`    'body' => ${phpStr(urlEncoded(body.fields))},`);
      ensureHeader(options, 'Content-Type', 'application/x-www-form-urlencoded');
    } else {
      options.push("    'form_params' => [", ...phpArrayLines(body.fields.map(([k, v]) => [k, phpStr(v)]), 2), '    ],');
    }
  }
  if (body?.kind === 'multipart') {
    options.push("    'multipart' => [");
    for (const field of body.fields) {
      const contents = field.file ? `fopen(${phpStr(field.file)}, 'r')` : phpStr(field.value);
      options.push(`        ['name' => ${phpStr(field.name)}, 'contents' => ${contents}],`);
    }
    options.push('    ],');
  }
  if (body?.kind === 'raw') {
    options.push(`    'body' => ${body.file ? `fopen(${phpStr(body.file)}, 'r')` : phpStr(body.text)},`);
  }
  const call = options.length
    ? [`$response = $client->request(${phpStr(method)}, ${phpTpl(url)}, [`, ...options, ']);']
    : [`$response = $client->request(${phpStr(method)}, ${phpTpl(url)});`];
  const read =
    response === 'json'
      ? '$data = json_decode((string) $response->getBody(), true);'
      : response === 'text'
        ? '$data = (string) $response->getBody();'
        : 'echo $response->getStatusCode();';
  return ['<?php', '', "require 'vendor/autoload.php';", '', '$client = new \\GuzzleHttp\\Client();', '', ...call, '', read].join('\n');
}

/** Adds a header to an already emitted Guzzle 'headers' block, or creates one. */
function ensureHeader(options, name, value) {
  const start = options.indexOf("    'headers' => [");
  const line = `        ${phpStr(name)} => ${phpStr(value)},`;
  if (start === -1) options.unshift("    'headers' => [", line, '    ],');
  else options.splice(start + 1, 0, line);
}

function laravelSnippet({ method, url, headers, basic, body, response }) {
  const env = (tpl) => phpTpl(tpl, 'env');
  const chain = [];
  if (basic) chain.push(`withBasicAuth(env('${basic.user}'), env('${basic.password}'))`);
  const token = headers.find((header) => header.token);
  if (token) chain.push(`withToken(env('${token.token}'))`);
  const accept = headers.find((header) => header.name === 'Accept');
  const rest = headers.filter((header) => header !== token && header !== accept && !header.contentType);
  if (rest.length) {
    chain.push(['withHeaders([', ...phpArrayLines(rest.map((h) => [h.name, env(h.value)]), 2), '    ])'].join('\n'));
  }
  if (accept) chain.push(accept.value[0] === 'application/json' ? 'acceptJson()' : `accept(${phpStr(literalOf(accept.value))})`);

  const verb = method.toLowerCase();
  const simple = ['get', 'post', 'put', 'patch', 'delete', 'head'].includes(verb);
  let data = null;
  if (body?.kind === 'json') {
    const value = body.value;
    const structured = value !== null && typeof value === 'object' && (Array.isArray(value) || Object.keys(value).length > 0);
    if (!structured) {
      chain.push(`withBody(${phpStr(JSON.stringify(value))}, ${phpStr(body.contentType)})`);
    } else {
      if (body.contentType !== 'application/json') chain.push(`contentType(${phpStr(body.contentType)})`);
      data = phpValue(value, 0);
    }
  } else if (body?.kind === 'form') {
    if (hasRepeats(body.fields.map(([name]) => name))) {
      chain.push(`withBody(${phpStr(urlEncoded(body.fields))}, 'application/x-www-form-urlencoded')`);
    } else {
      chain.push('asForm()');
      data = phpBlock(body.fields.map(([k, v]) => [k, phpStr(v)]));
    }
  } else if (body?.kind === 'multipart') {
    const counts = countNames(body.fields.filter((field) => !field.file));
    for (const field of body.fields.filter((f) => f.file)) {
      chain.push(`attach(${phpStr(field.name)}, fopen(${phpStr(field.file)}, 'r'), ${phpStr(field.file.replace(/^.*\//, ''))})`);
    }
    const entries = body.fields
      .filter((field) => !field.file)
      .map((field) =>
        counts.get(field.name) > 1
          ? `    ['name' => ${phpStr(field.name)}, 'contents' => ${phpStr(field.value)}],`
          : `    ${phpStr(field.name)} => ${phpStr(field.value)},`,
      );
    if (!body.fields.some((field) => field.file)) chain.push('asMultipart()');
    if (entries.length) data = `[\n${entries.join('\n')}\n]`;
  } else if (body?.kind === 'raw') {
    const content = body.file ? `file_get_contents(${phpStr(body.file)})` : phpStr(body.text);
    chain.push(`withBody(${content}, ${phpStr(body.contentType)})`);
  }

  const urlExpr = env(url);
  const args = data ? `${urlExpr}, ${indentTail(data, 1)}` : urlExpr;
  const send = simple ? `${verb}(${args})` : `send(${phpStr(method)}, ${urlExpr}${data ? `, ['json' => ${indentTail(data, 1)}]` : ''})`;
  chain.push(send);
  const [first, ...more] = chain;
  const expression = [`Http::${first}`, ...more.map((call) => `    ->${call}`)].join('\n');
  const read =
    response === 'json' ? '$data = $response->json();' : response === 'text' ? '$data = $response->body();' : '$status = $response->status();';
  return ['use Illuminate\\Support\\Facades\\Http;', '', `$response = ${expression};`, '', read].join('\n');
}

function countNames(fields) {
  const counts = new Map();
  for (const field of fields) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
  return counts;
}

function phpBlock(entries) {
  return `[\n${phpArrayLines(entries, 1).join('\n')}\n]`;
}

function phpCurlSnippet({ method, url, headers, basic, mtls, body, response }) {
  const options = ['    CURLOPT_RETURNTRANSFER => true,'];
  if (method === 'HEAD') options.push('    CURLOPT_NOBODY => true,');
  else if (method !== 'GET') options.push(`    CURLOPT_CUSTOMREQUEST => ${phpStr(method)},`);
  if (basic) options.push(`    CURLOPT_USERPWD => getenv('${basic.user}') . ':' . getenv('${basic.password}'),`);
  if (mtls) options.push("    CURLOPT_SSLCERT => './client.pem',", "    CURLOPT_SSLKEY => './client.key',");
  const headerLines = headers.map((header) => `        ${phpTpl(mergeTpl([`${header.name}: `, ...header.value]))},`);
  if (body?.kind === 'form') headerLines.push(`        'Content-Type: application/x-www-form-urlencoded',`);
  if (headerLines.length) options.push('    CURLOPT_HTTPHEADER => [', ...headerLines, '    ],');
  if (body?.kind === 'json') {
    options.push(`    CURLOPT_POSTFIELDS => json_encode(${phpValue(body.value, 1)}),`);
  }
  if (body?.kind === 'form') options.push(`    CURLOPT_POSTFIELDS => ${phpStr(urlEncoded(body.fields))},`);
  if (body?.kind === 'multipart') {
    // ext-curl takes a flat array: repeated fields get indexed keys.
    const counts = countNames(body.fields);
    const seen = new Map();
    options.push('    CURLOPT_POSTFIELDS => [');
    for (const field of body.fields) {
      const index = seen.get(field.name) ?? 0;
      seen.set(field.name, index + 1);
      const key = counts.get(field.name) > 1 ? `${field.name}[${index}]` : field.name;
      options.push(`        ${phpStr(key)} => ${field.file ? `new CURLFile(${phpStr(field.file)})` : phpStr(field.value)},`);
    }
    options.push('    ],');
  }
  if (body?.kind === 'raw') {
    options.push(`    CURLOPT_POSTFIELDS => ${body.file ? `file_get_contents(${phpStr(body.file)})` : phpStr(body.text)},`);
  }
  const read =
    response === 'json'
      ? '$data = json_decode(curl_exec($ch), true);'
      : response === 'text'
        ? '$data = curl_exec($ch);'
        : ['curl_exec($ch);', '$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);'].join('\n');
  return ['<?php', '', `$ch = curl_init(${phpTpl(url)});`, 'curl_setopt_array($ch, [', ...options, ']);', '', read, 'curl_close($ch);'].join('\n');
}

/** Serializes a JSON value as a PHP array literal (single-quoted strings: no interpolation). */
function phpValue(value, depth) {
  const pad = '    '.repeat(depth + 1);
  const close = '    '.repeat(depth);
  if (value === null) return 'null';
  if (typeof value === 'string') return phpStr(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${pad}${phpValue(v, depth + 1)},`).join('\n')}\n${close}]`;
  }
  const entries = Object.entries(value);
  // An empty PHP array encodes as [] — json_encode needs an object for {}.
  if (entries.length === 0) return 'new \\stdClass()';
  return `[\n${entries.map(([k, v]) => `${pad}${phpStr(k)} => ${phpValue(v, depth + 1)},`).join('\n')}\n${close}]`;
}

// ---------------------------------------------------------------------------
// Python: requests and httpx
// ---------------------------------------------------------------------------

function pythonSnippet({ method, url, headers, basic, mtls, body, response }, library) {
  const args = [`    ${pyTpl(url)},`];
  if (basic) args.push(`    auth=(os.environ["${basic.user}"], os.environ["${basic.password}"]),`);
  if (mtls) args.push('    cert=("./client.pem", "./client.key"),');
  // json= sets Content-Type: application/json itself.
  const sendHeaders = headers.filter((h) => !(h.contentType && body?.contentType === 'application/json'));
  if (sendHeaders.length) {
    args.push('    headers={', ...sendHeaders.map((h) => `        ${dq(h.name)}: ${pyTpl(h.value)},`), '    },');
  }
  if (body?.kind === 'json') args.push(`    json=${pyValue(body.value, 1)},`);
  const files = body?.kind === 'multipart' ? body.fields.filter((f) => f.file) : [];
  if (body?.kind === 'multipart' && files.length === 0) {
    // Both libraries only switch to multipart when `files` is non-empty;
    // (None, value) tuples are plain form fields.
    args.push('    files=[', ...body.fields.map((f) => `        (${dq(f.name)}, (None, ${dq(f.value)})),`), '    ],');
  } else if (body?.kind === 'form' || body?.kind === 'multipart') {
    const fields = body.kind === 'form' ? body.fields : body.fields.filter((f) => !f.file).map((f) => [f.name, f.value]);
    const grouped = new Map();
    for (const [name, value] of fields) grouped.set(name, [...(grouped.get(name) ?? []), value]);
    if (grouped.size) {
      args.push(
        '    data={',
        ...[...grouped].map(([k, values]) => `        ${dq(k)}: ${values.length > 1 ? `[${values.map(dq).join(', ')}]` : dq(values[0])},`),
        '    },',
      );
    }
    if (files.length) {
      args.push('    files={', ...files.map((f) => `        ${dq(f.name)}: open(${dq(f.file)}, "rb"),`), '    },');
    }
  }
  if (body?.kind === 'raw') {
    const key = library === 'httpx' ? 'content' : 'data';
    args.push(`    ${key}=${body.file ? `open(${dq(body.file)}, "rb").read()` : dq(body.text)},`);
  }
  const verb = method.toLowerCase();
  // httpx's get/head/options/delete helpers take no request body.
  const bodyless = library === 'httpx' && body && ['get', 'head', 'options', 'delete'].includes(verb);
  const helper = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(verb) && !bodyless;
  const call = helper ? [`response = ${library}.${verb}(`] : [`response = ${library}.request(`, `    ${dq(method)},`];
  const read = response === 'json' ? 'data = response.json()' : response === 'text' ? 'data = response.text' : 'print(response.status_code)';
  const imports = usesEnv({ url, headers, basic }) ? ['import os', `import ${library}`] : [`import ${library}`];
  return [...imports, '', ...call, ...args, ')', '', read].join('\n');
}

/** Serializes a JSON value as a Python literal. */
function pyValue(value, depth) {
  const pad = '    '.repeat(depth + 1);
  const close = '    '.repeat(depth);
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${pad}${pyValue(v, depth + 1)},`).join('\n')}\n${close}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pyValue(v, depth + 1)},`).join('\n')}\n${close}}`;
}

// ---------------------------------------------------------------------------
// Go (net/http)
// ---------------------------------------------------------------------------

const GO_METHODS = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options', TRACE: 'Trace' };

/** Raw string literal when possible (idiomatic for JSON), quoted otherwise. */
function goString(text) {
  return text.includes('`') || text.includes('\r') ? dq(text) : `\`${text}\``;
}

function goSnippet({ method, url, headers, basic, body, response }) {
  const imports = new Set(['fmt', 'net/http']);
  const pre = [];
  let bodyExpr = 'nil';
  const extraHeaders = [];
  if (body?.kind === 'json' || (body?.kind === 'raw' && !body.file)) {
    imports.add('strings');
    const text = body.kind === 'json' ? JSON.stringify(body.value, null, 2) : body.text;
    pre.push(`\tbody := strings.NewReader(${indentTail(goString(text), 1, '\t')})`);
    bodyExpr = 'body';
  } else if (body?.kind === 'raw') {
    imports.add('os');
    pre.push(`\tbody, err := os.Open(${dq(body.file)})`, ...goCheck(), '\tdefer body.Close()', '');
    bodyExpr = 'body';
  } else if (body?.kind === 'form') {
    imports.add('net/url').add('strings');
    pre.push('\tform := url.Values{}');
    for (const [k, v] of body.fields) pre.push(`\tform.Add(${dq(k)}, ${dq(v)})`);
    pre.push('');
    bodyExpr = 'strings.NewReader(form.Encode())';
    extraHeaders.push('\treq.Header.Set("Content-Type", "application/x-www-form-urlencoded")');
  } else if (body?.kind === 'multipart') {
    imports.add('bytes').add('mime/multipart');
    pre.push('\tvar body bytes.Buffer', '\twriter := multipart.NewWriter(&body)');
    let fileIndex = 0;
    for (const field of body.fields) {
      if (field.file) {
        imports.add('io').add('os').add('path/filepath');
        const suffix = fileIndex === 0 ? '' : String(fileIndex + 1);
        fileIndex += 1;
        pre.push(
          '',
          `\tfile${suffix}, err := os.Open(${dq(field.file)})`,
          ...goCheck(),
          `\tdefer file${suffix}.Close()`,
          `\tpart${suffix}, err := writer.CreateFormFile(${dq(field.name)}, filepath.Base(file${suffix}.Name()))`,
          ...goCheck(),
          `\tif _, err := io.Copy(part${suffix}, file${suffix}); err != nil {`,
          '\t\tpanic(err)',
          '\t}',
        );
      } else {
        pre.push(`\twriter.WriteField(${dq(field.name)}, ${dq(field.value)})`);
      }
    }
    pre.push('\twriter.Close()', '');
    bodyExpr = '&body';
    extraHeaders.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
  }
  if (hasEnv(url) || basic || headers.some((h) => hasEnv(h.value))) imports.add('os');
  if (response !== 'none') imports.add('io');

  const methodExpr = GO_METHODS[method] ? `http.Method${GO_METHODS[method]}` : dq(method);
  const lines = [...pre];
  if (pre.length && pre[pre.length - 1] !== '') lines.push('');
  lines.push(`\treq, err := http.NewRequest(${methodExpr}, ${goTpl(url)}, ${bodyExpr})`, ...goCheck());
  if (basic) lines.push(`\treq.SetBasicAuth(os.Getenv("${basic.user}"), os.Getenv("${basic.password}"))`);
  for (const header of headers) lines.push(`\treq.Header.Set(${dq(header.name)}, ${goTpl(header.value)})`);
  lines.push(...extraHeaders, '', '\tres, err := http.DefaultClient.Do(req)', ...goCheck(), '\tdefer res.Body.Close()', '');
  if (response === 'none') {
    lines.push('\tfmt.Println(res.Status)');
  } else {
    lines.push('\tdata, err := io.ReadAll(res.Body)', ...goCheck(), '\tfmt.Println(res.Status, string(data))');
  }
  const importBlock = ['import (', ...[...imports].sort().map((name) => `\t${dq(name)}`), ')'];
  return ['package main', '', ...importBlock, '', 'func main() {', ...lines, '}'].join('\n');
}

function goCheck() {
  return ['\tif err != nil {', '\t\tpanic(err)', '\t}'];
}

// ---------------------------------------------------------------------------
// Ruby (net/http)
// ---------------------------------------------------------------------------

const RUBY_CLASSES = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options', TRACE: 'Trace' };

function rubySnippet({ method, url, headers, basic, mtls, body, response }) {
  const requires = ['require "net/http"', 'require "uri"'];
  if (body?.kind === 'json' || response === 'json') requires.push('require "json"');
  const klass = RUBY_CLASSES[method];
  const lines = [`uri = URI(${rubyTpl(url)})`];
  lines.push(
    klass
      ? `request = Net::HTTP::${klass}.new(uri)`
      : `request = Net::HTTPGenericRequest.new(${rubyStr(method)}, ${body ? 'true' : 'false'}, true, uri)`,
  );
  if (basic) lines.push(`request.basic_auth(ENV["${basic.user}"], ENV["${basic.password}"])`);
  for (const header of headers) lines.push(`request[${rubyStr(header.name)}] = ${rubyTpl(header.value)}`);
  if (body?.kind === 'json') lines.push(`request.body = JSON.generate(${rubyValue(body.value, 0)})`);
  if (body?.kind === 'form') {
    lines.push('request.set_form(', ...rubyPairs(body.fields), '  "application/x-www-form-urlencoded"', ')');
  }
  if (body?.kind === 'multipart') {
    const pairs = body.fields.map((field) =>
      field.file ? `    [${rubyStr(field.name)}, File.open(${rubyStr(field.file)})],` : `    [${rubyStr(field.name)}, ${rubyStr(field.value)}],`,
    );
    lines.push('request.set_form(', '  [', ...pairs, '  ],', '  "multipart/form-data"', ')');
  }
  if (body?.kind === 'raw') {
    lines.push(`request.body = ${body.file ? `File.binread(${rubyStr(body.file)})` : rubyStr(body.text)}`);
  }
  const startOptions = ['use_ssl: uri.scheme == "https"'];
  if (mtls) {
    requires.push('require "openssl"');
    startOptions.push('cert: OpenSSL::X509::Certificate.new(File.read("./client.pem"))', 'key: OpenSSL::PKey.read(File.read("./client.key"))');
  }
  lines.push(
    '',
    `response = Net::HTTP.start(uri.hostname, uri.port, ${startOptions.join(', ')}) do |http|`,
    '  http.request(request)',
    'end',
    '',
    response === 'json' ? 'data = JSON.parse(response.body)' : response === 'text' ? 'data = response.body' : 'puts response.code',
  );
  return [...requires, '', ...lines].join('\n');
}

function rubyPairs(fields) {
  return ['  [', ...fields.map(([k, v]) => `    [${rubyStr(k)}, ${rubyStr(v)}],`), '  ],'];
}

/** Serializes a JSON value as a Ruby literal (string-keyed hash). */
function rubyValue(value, depth) {
  const pad = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  if (value === null) return 'nil';
  if (typeof value === 'string') return rubyStr(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${pad}${rubyValue(v, depth + 1)},`).join('\n')}\n${close}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, v]) => `${pad}${rubyStr(k)} => ${rubyValue(v, depth + 1)},`).join('\n')}\n${close}}`;
}

// ---------------------------------------------------------------------------
// Java (java.net.http)
// ---------------------------------------------------------------------------

/** Java text block: backslashes and triple quotes must be escaped. */
function javaTextBlock(text, indent) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('"""', '\\"""');
  const body = escaped
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
  return `"""\n${body}\n${indent}"""`;
}

function javaSnippet({ method, url, headers, basic, body, response }) {
  const imports = new Set(['java.net.URI', 'java.net.http.HttpClient', 'java.net.http.HttpRequest', 'java.net.http.HttpResponse']);
  const pre = [];
  const builder = ['HttpRequest request = HttpRequest.newBuilder()', `    .uri(URI.create(${javaTpl(url)}))`];
  if (basic) {
    imports.add('java.util.Base64');
    pre.push(
      `String credentials = System.getenv("${basic.user}") + ":" + System.getenv("${basic.password}");`,
      '',
    );
    builder.push('    .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(credentials.getBytes()))');
  }
  for (const header of headers) builder.push(`    .header(${dq(header.name)}, ${javaTpl(header.value)})`);

  let publisher = null;
  if (body?.kind === 'json') {
    publisher = `HttpRequest.BodyPublishers.ofString(${javaTextBlock(JSON.stringify(body.value, null, 2), '        ')})`;
  } else if (body?.kind === 'raw') {
    if (body.file) {
      imports.add('java.nio.file.Path');
      publisher = `HttpRequest.BodyPublishers.ofFile(Path.of(${dq(body.file)}))`;
    } else {
      publisher = `HttpRequest.BodyPublishers.ofString(${dq(body.text)})`;
    }
  } else if (body?.kind === 'form') {
    builder.push('    .header("Content-Type", "application/x-www-form-urlencoded")');
    publisher = `HttpRequest.BodyPublishers.ofString(${dq(urlEncoded(body.fields))})`;
  } else if (body?.kind === 'multipart') {
    imports.add('java.util.ArrayList').add('java.util.List');
    pre.push('String boundary = "----AtlasBoundary" + System.nanoTime();', 'List<byte[]> parts = new ArrayList<>();');
    for (const field of body.fields) {
      const disposition = field.file
        ? `Content-Disposition: form-data; name=\\"${javaEsc(field.name)}\\"; filename=\\"${javaEsc(field.file.replace(/^.*\//, ''))}\\"\\r\\nContent-Type: application/octet-stream`
        : `Content-Disposition: form-data; name=\\"${javaEsc(field.name)}\\"`;
      pre.push(`parts.add(("--" + boundary + "\\r\\n${disposition}\\r\\n\\r\\n").getBytes());`);
      if (field.file) {
        imports.add('java.nio.file.Files').add('java.nio.file.Path');
        pre.push(`parts.add(Files.readAllBytes(Path.of(${dq(field.file)})));`, 'parts.add("\\r\\n".getBytes());');
      } else {
        pre.push(`parts.add(${dq(`${field.value}\r\n`)}.getBytes());`);
      }
    }
    pre.push('parts.add(("--" + boundary + "--\\r\\n").getBytes());', '');
    builder.push('    .header("Content-Type", "multipart/form-data; boundary=" + boundary)');
    publisher = 'HttpRequest.BodyPublishers.ofByteArrays(parts)';
  }
  if (method === 'GET' && !publisher) builder.push('    .GET()');
  else if (method === 'DELETE' && !publisher) builder.push('    .DELETE()');
  else if ((method === 'POST' || method === 'PUT') && publisher) builder.push(`    .${method}(${publisher})`);
  else builder.push(`    .method(${dq(method)}, ${publisher ?? 'HttpRequest.BodyPublishers.noBody()'})`);
  builder.push('    .build();');

  const handler = response === 'none' ? 'HttpResponse.BodyHandlers.discarding()' : 'HttpResponse.BodyHandlers.ofString()';
  const type = response === 'none' ? 'HttpResponse<Void>' : 'HttpResponse<String>';
  const tail = [
    '',
    `${type} response = HttpClient.newHttpClient()`,
    `    .send(request, ${handler});`,
    '',
    response === 'none' ? 'System.out.println(response.statusCode());' : 'System.out.println(response.body());',
  ];
  const importLines = [...imports].sort().map((name) => `import ${name};`);
  return [...importLines, '', ...pre, ...builder, ...tail].join('\n');
}

/** Escapes text for embedding inside an already-open Java/C# string literal. */
function javaEsc(text) {
  return dq(text).slice(1, -1);
}

// ---------------------------------------------------------------------------
// C# (HttpClient)
// ---------------------------------------------------------------------------

const CS_METHODS = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options', TRACE: 'Trace' };

/** C# 11 raw string literal, delimiter longer than any quote run inside. */
function csRawString(text, indent) {
  const longest = Math.max(0, ...(text.match(/"+/g) ?? []).map((run) => run.length));
  const quotes = '"'.repeat(Math.max(3, longest + 1));
  const body = text
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
  return `${quotes}\n${body}\n${indent}${quotes}`;
}

function csharpSnippet({ method, url, headers, basic, body, response }) {
  const usings = new Set();
  const cookie = headers.some((header) => header.name.toLowerCase() === 'cookie');
  const lines = [
    // A Cookie header is dropped unless the handler's cookie container is off.
    cookie ? 'using var client = new HttpClient(new HttpClientHandler { UseCookies = false });' : 'using var client = new HttpClient();',
    '',
    `var request = new HttpRequestMessage(${CS_METHODS[method] ? `HttpMethod.${CS_METHODS[method]}` : `new HttpMethod(${dq(method)})`}, ${csTpl(url)});`,
  ];
  if (basic) {
    usings.add('System.Net.Http.Headers').add('System.Text');
    lines.push(
      `var credentials = Environment.GetEnvironmentVariable("${basic.user}") + ":" + Environment.GetEnvironmentVariable("${basic.password}");`,
      'request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(credentials)));',
    );
  }
  for (const header of headers) {
    if (header.contentType) continue;
    if (header.token) {
      usings.add('System.Net.Http.Headers');
      lines.push(`request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Environment.GetEnvironmentVariable("${header.token}"));`);
    } else {
      lines.push(`request.Headers.TryAddWithoutValidation(${dq(header.name)}, ${csTpl(header.value)});`);
    }
  }
  if (body?.kind === 'json') {
    usings.add('System.Text');
    lines.push(`request.Content = new StringContent(${csRawString(JSON.stringify(body.value, null, 2), '    ')}, Encoding.UTF8, ${dq(body.contentType)});`);
  } else if (body?.kind === 'form') {
    lines.push('request.Content = new FormUrlEncodedContent(new[]', '{');
    for (const [k, v] of body.fields) lines.push(`    new KeyValuePair<string, string>(${dq(k)}, ${dq(v)}),`);
    lines.push('});');
  } else if (body?.kind === 'multipart') {
    lines.push('', 'var form = new MultipartFormDataContent();');
    for (const field of body.fields) {
      lines.push(
        field.file
          ? `form.Add(new StreamContent(File.OpenRead(${dq(field.file)})), ${dq(field.name)}, ${dq(field.file.replace(/^.*\//, ''))});`
          : `form.Add(new StringContent(${dq(field.value)}), ${dq(field.name)});`,
      );
    }
    lines.push('request.Content = form;');
  } else if (body?.kind === 'raw') {
    usings.add('System.Net.Http.Headers');
    if (body.file) {
      lines.push(`request.Content = new StreamContent(File.OpenRead(${dq(body.file)}));`);
    } else {
      lines.push(`request.Content = new StringContent(${dq(body.text)});`);
    }
    lines.push(`request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(${dq(body.contentType)});`);
  }
  lines.push('', 'var response = await client.SendAsync(request);');
  if (response === 'none') {
    lines.push('Console.WriteLine((int)response.StatusCode);');
  } else {
    lines.push('var data = await response.Content.ReadAsStringAsync();', 'Console.WriteLine(data);');
  }
  const usingLines = [...usings].sort().map((name) => `using ${name};`);
  return [...usingLines, ...(usingLines.length ? [''] : []), ...lines].join('\n');
}

// ---------------------------------------------------------------------------

/** Indents every line except the first, for embedding literals in code. */
function indentTail(text, depth, unit = '    ') {
  const pad = unit.repeat(depth);
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? line : pad + line))
    .join('\n');
}
