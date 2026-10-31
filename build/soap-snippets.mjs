/**
 * Request samples for SOAP operations. Raw-envelope clients (cURL, fetch,
 * Laravel Http, raw HTTP) send the generated envelope; SOAP toolkits (PHP
 * SoapClient, Python zeep) take the operation's arguments instead and build
 * the envelope from the WSDL themselves.
 */

export const SOAP_SNIPPET_LANGUAGES = [
  { id: 'curl', label: 'cURL', language: 'bash' },
  { id: 'soapclient', label: 'PHP SoapClient', language: 'php' },
  { id: 'laravel', label: 'Laravel', language: 'php' },
  { id: 'zeep', label: 'Python zeep', language: 'python' },
  { id: 'javascript', label: 'JavaScript', language: 'javascript' },
  { id: 'http', label: 'HTTP', language: 'text' },
];

export function buildSoapSnippets(endpoint) {
  const soap = endpoint.soap;
  const content = endpoint.requestBody?.contents?.[0];
  const envelope = String(content?.examples?.[0]?.value ?? '');
  const url = soap.address || 'https://example.com/service';
  const wsdl = `${url}?wsdl`;
  const contentType =
    soap.version === '1.2'
      ? `application/soap+xml; charset=utf-8${soap.action ? `; action="${soap.action}"` : ''}`
      : 'text/xml; charset=utf-8';
  const headers = soap.version === '1.1' ? [['Content-Type', contentType], ['SOAPAction', `"${soap.action}"`]] : [['Content-Type', contentType]];
  const args = endpoint.soapArguments ?? {};
  return {
    curl: curl(url, headers, envelope),
    soapclient: soapClient(wsdl, soap, args),
    laravel: laravel(url, headers, envelope),
    zeep: zeep(wsdl, soap, args),
    javascript: javascript(url, headers, envelope),
    http: rawHttp(url, headers, envelope),
  };
}

function curl(url, headers, envelope) {
  return [
    `curl -X POST "${url}" \\`,
    ...headers.map(([name, value]) => `  -H '${name}: ${value.replaceAll("'", "'\\''")}' \\`),
    "  --data-binary @- <<'XML'",
    envelope,
    'XML',
  ].join('\n');
}

function soapClient(wsdl, soap, args) {
  return [
    '<?php',
    '',
    `$client = new SoapClient('${phpEscape(wsdl)}', [`,
    `    'soap_version' => ${soap.version === '1.2' ? 'SOAP_1_2' : 'SOAP_1_1'},`,
    "    'exceptions' => true,",
    "    'trace' => true,",
    ']);',
    '',
    `$response = $client->__soapCall('${phpEscape(soap.operation)}', [${phpValue(args, 0)}]);`,
  ].join('\n');
}

function laravel(url, headers, envelope) {
  const contentType = headers.find(([name]) => name === 'Content-Type')[1];
  const extra = headers.filter(([name]) => name !== 'Content-Type');
  const chain = extra.length
    ? [
        '$response = Http::withHeaders([',
        ...extra.map(([name, value]) => `        '${phpEscape(name)}' => '${phpEscape(value)}',`),
        '    ])',
        `    ->withBody($envelope, '${phpEscape(contentType)}')`,
      ]
    : [`$response = Http::withBody($envelope, '${phpEscape(contentType)}')`];
  return [
    'use Illuminate\\Support\\Facades\\Http;',
    '',
    "$envelope = <<<'XML'",
    envelope,
    'XML;',
    '',
    ...chain,
    `    ->post('${phpEscape(url)}');`,
    '',
    '$xml = simplexml_load_string($response->body());',
  ].join('\n');
}

function zeep(wsdl, soap, args) {
  const entries = Object.entries(args ?? {});
  // Keyword arguments when every XML name is a Python identifier, else a dict.
  const identifiers = entries.every(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
  const call = entries.length === 0
    ? `client.service.${soap.operation}()`
    : identifiers
      ? `client.service.${soap.operation}(\n${entries.map(([name, value]) => `    ${name}=${pyValue(value, 1)},`).join('\n')}\n)`
      : `client.service.${soap.operation}(**${pyValue(args, 0)})`;
  return ['from zeep import Client', '', `client = Client(${JSON.stringify(wsdl)})`, `result = ${call}`].join('\n');
}

function javascript(url, headers, envelope) {
  return [
    `const envelope = \`${envelope.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\`;`,
    '',
    `const response = await fetch(${JSON.stringify(url)}, {`,
    '  method: "POST",',
    '  headers: {',
    ...headers.map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`),
    '  },',
    '  body: envelope,',
    '});',
    '',
    'const xml = new DOMParser().parseFromString(await response.text(), "text/xml");',
  ].join('\n');
}

function rawHttp(url, headers, envelope) {
  const parsed = new URL(url);
  return [
    `POST ${parsed.pathname}${parsed.search} HTTP/1.1`,
    `Host: ${parsed.host}`,
    ...headers.map(([name, value]) => `${name}: ${value}`),
    `Content-Length: ${Buffer.byteLength(envelope)}`,
    '',
    envelope,
  ].join('\n');
}

function phpEscape(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function phpValue(value, depth) {
  const pad = '    '.repeat(depth + 1);
  const close = '    '.repeat(depth);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${phpEscape(value)}'`;
  if (typeof value !== 'object') return String(value);
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  if (entries.length === 0) return '[]';
  return `[\n${entries
    .map(([key, item]) => `${pad}${Array.isArray(value) ? '' : `'${phpEscape(key)}' => `}${phpValue(item, depth + 1)},`)
    .join('\n')}\n${close}]`;
}

function pyValue(value, depth) {
  const pad = '    '.repeat(depth + 1);
  const close = '    '.repeat(depth);
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map((item) => `${pad}${pyValue(item, depth + 1)},`).join('\n')}\n${close}]` : '[]';
  }
  const entries = Object.entries(value);
  return entries.length
    ? `{\n${entries.map(([key, item]) => `${pad}${JSON.stringify(key)}: ${pyValue(item, depth + 1)},`).join('\n')}\n${close}}`
    : '{}';
}
