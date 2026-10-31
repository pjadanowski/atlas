/**
 * Build-time code sample generation. Plain template strings — deterministic,
 * no runtime work in the browser.
 */

export const SNIPPET_LANGUAGES = [
  { id: 'curl', label: 'cURL', language: 'bash' },
  { id: 'javascript', label: 'JavaScript', language: 'javascript' },
  { id: 'php', label: 'PHP', language: 'php' },
  { id: 'python', label: 'Python', language: 'python' },
];

export function buildSnippets(endpoint, baseUrl) {
  const request = describeRequest(endpoint, baseUrl);
  return {
    curl: curlSnippet(request),
    javascript: javascriptSnippet(request),
    php: phpSnippet(request),
    python: pythonSnippet(request),
  };
}

function describeRequest(endpoint, baseUrl) {
  let path = endpoint.path;
  for (const param of endpoint.params.path) {
    // Function replacement: example values containing "$&"-style sequences
    // must not be interpreted as replacement patterns.
    const value = param.example !== undefined ? String(param.example) : `{${param.name}}`;
    path = path.replace(`{${param.name}}`, () => value);
  }
  // Real example values are encoded; "<name>" placeholders stay literal.
  const query = endpoint.params.query
    .filter((param) => param.required)
    .map((param) =>
      param.example !== undefined
        ? `${param.name}=${encodeURIComponent(String(param.example))}`
        : `${param.name}=<${param.name}>`,
    );
  const queryString = query.length ? `?${query.join('&')}` : '';
  const isMultipart = endpoint.requestBody?.contentType.includes('multipart') ?? false;
  return {
    method: endpoint.method,
    url: `${baseUrl}${path}${queryString}`,
    auth: endpoint.requiresAuth,
    body: !isMultipart && endpoint.requestBody ? endpoint.requestBody.example : null,
    multipartFields: isMultipart ? multipartFields(endpoint.requestBody) : null,
  };
}

function multipartFields(requestBody) {
  const properties = requestBody.schema?.properties ?? {};
  return Object.entries(properties).map(([name, schema]) => ({
    name,
    isFile: schema?.format === 'binary',
  }));
}

function curlSnippet({ method, url, auth, body, multipartFields }) {
  const lines = [`curl${method === 'GET' ? '' : ` -X ${method}`} "${url}"`];
  if (auth) lines.push('  -H "Authorization: Bearer $API_TOKEN"');
  lines.push('  -H "Accept: application/json"');
  if (body !== null) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${JSON.stringify(body, null, 2).replaceAll("'", "'\\''")}'`);
  }
  for (const field of multipartFields ?? []) {
    lines.push(`  -F "${field.name}=${field.isFile ? '@./file.pdf' : '<value>'}"`);
  }
  return lines.join(' \\\n');
}

function javascriptSnippet({ method, url, auth, body, multipartFields }) {
  const headers = [];
  if (auth) headers.push('    Authorization: `Bearer ${API_TOKEN}`,');
  headers.push('    Accept: "application/json",');
  if (body !== null) headers.push('    "Content-Type": "application/json",');

  const parts = [
    ...(auth ? ['const API_TOKEN = process.env.API_TOKEN;', ''] : []),
    `const response = await fetch("${url}", {`,
    `  method: "${method}",`,
    '  headers: {',
    ...headers,
    '  },',
  ];
  if (body !== null) {
    parts.push(`  body: JSON.stringify(${indentTail(JSON.stringify(body, null, 2), 2)}),`);
  }
  if (multipartFields) {
    const form = ['const form = new FormData();'];
    for (const field of multipartFields) {
      form.push(
        field.isFile
          ? `form.append("${field.name}", fileInput.files[0]);`
          : `form.append("${field.name}", "<value>");`,
      );
    }
    return [...form, '', ...parts, '  body: form,', '});', '', 'const data = await response.json();'].join('\n');
  }
  parts.push('});', '', 'const data = await response.json();');
  return parts.join('\n');
}

function phpSnippet({ method, url, auth, body, multipartFields }) {
  const headers = [];
  if (auth) headers.push('        "Authorization: Bearer " . $apiToken,');
  headers.push('        "Accept: application/json",');
  if (body !== null) headers.push('        "Content-Type: application/json",');

  const options = [
    '    CURLOPT_RETURNTRANSFER => true,',
    ...(method === 'GET' ? [] : [`    CURLOPT_CUSTOMREQUEST => "${method}",`]),
    '    CURLOPT_HTTPHEADER => [',
    ...headers,
    '    ],',
  ];
  if (body !== null) {
    options.push(`    CURLOPT_POSTFIELDS => json_encode(${indentTail(phpValue(body, 1), 1)}),`);
  }
  if (multipartFields) {
    const fields = multipartFields
      .map((field) =>
        field.isFile
          ? `        "${field.name}" => new CURLFile("./file.pdf"),`
          : `        "${field.name}" => "<value>",`,
      )
      .join('\n');
    options.push('    CURLOPT_POSTFIELDS => [', fields, '    ],');
  }
  return [
    '<?php',
    '',
    ...(auth ? ['$apiToken = getenv("API_TOKEN");', ''] : []),
    `$ch = curl_init("${url}");`,
    'curl_setopt_array($ch, [',
    ...options,
    ']);',
    '',
    '$response = json_decode(curl_exec($ch), true);',
    'curl_close($ch);',
  ].join('\n');
}

function pythonSnippet({ method, url, auth, body, multipartFields }) {
  const headers = [];
  if (auth) headers.push('        "Authorization": f"Bearer {API_TOKEN}",');
  headers.push('        "Accept": "application/json",');

  const args = [`    "${url}",`, '    headers={', ...headers, '    },'];
  if (body !== null) args.push(`    json=${indentTail(pyValue(body, 1), 1)},`);
  if (multipartFields) {
    const files = multipartFields.filter((field) => field.isFile);
    const fields = multipartFields.filter((field) => !field.isFile);
    if (files.length) {
      args.push(
        `    files={${files.map((f) => `"${f.name}": open("./file.pdf", "rb")`).join(', ')}},`,
      );
    }
    if (fields.length) {
      args.push(`    data={${fields.map((f) => `"${f.name}": "<value>"`).join(', ')}},`);
    }
  }
  return [
    ...(auth ? ['import os'] : []),
    'import requests',
    '',
    ...(auth ? ['API_TOKEN = os.environ["API_TOKEN"]', ''] : []),
    `response = requests.${method.toLowerCase()}(`,
    ...args,
    ')',
    '',
    'data = response.json()',
  ].join('\n');
}

/** Serializes a JSON value as a PHP array literal. */
function phpValue(value, depth) {
  const pad = '    '.repeat(depth + 1);
  const close = '    '.repeat(depth);
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${pad}${phpValue(v, depth + 1)},`).join('\n')}\n${close}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '[]';
  return `[\n${entries
    .map(([k, v]) => `${pad}"${k}" => ${phpValue(v, depth + 1)},`)
    .join('\n')}\n${close}]`;
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
  return `{\n${entries
    .map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pyValue(v, depth + 1)},`)
    .join('\n')}\n${close}}`;
}

/** Indents every line except the first, for embedding literals in code. */
function indentTail(text, depth) {
  const pad = '    '.repeat(depth);
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? line : pad + line))
    .join('\n');
}
