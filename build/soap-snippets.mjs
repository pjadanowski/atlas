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
  const security = soap.security;
  const username = security?.tokens.find((token) => token.type === 'username');
  const issued = security?.tokens.some((token) => ['issued', 'secure-conversation', 'saml'].includes(token.type));
  const header = security && (username || issued || security.timestamp) ? phpWsseHeader(username, issued, security.timestamp) : [];
  return [
    '<?php',
    '',
    `$client = new SoapClient('${phpEscape(wsdl)}', [`,
    `    'soap_version' => ${soap.version === '1.2' ? 'SOAP_1_2' : 'SOAP_1_1'},`,
    "    'exceptions' => true,",
    "    'trace' => true,",
    ']);',
    ...header,
    '',
    `$response = $client->__soapCall('${phpEscape(soap.operation)}', [${phpValue(args, 0)}]);`,
  ].join('\n');
}

/** WS-Security header for SoapClient, which has no built-in WSS support. */
function phpWsseHeader(username, issued, timestamp) {
  const lines = ['', '// WS-Security header, built per request'];
  if (username || timestamp) {
    lines.push('$created = gmdate(\'Y-m-d\\TH:i:s\\Z\');');
  }
  if (username?.digest) {
    lines.push(
      '$nonce = random_bytes(16);',
      "$digest = base64_encode(sha1($nonce . $created . getenv('SOAP_PASSWORD'), true));",
    );
  }
  lines.push("$security = '<wsse:Security xmlns:wsse=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd\"'");
  lines.push("    . ' xmlns:wsu=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd\">'");
  if (timestamp) {
    lines.push("    . '<wsu:Timestamp><wsu:Created>' . $created . '</wsu:Created>'", "    . '<wsu:Expires>' . gmdate('Y-m-d\\TH:i:s\\Z', time() + 300) . '</wsu:Expires></wsu:Timestamp>'");
  }
  if (username) {
    const profile = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0';
    lines.push("    . '<wsse:UsernameToken><wsse:Username>' . htmlspecialchars(getenv('SOAP_USERNAME')) . '</wsse:Username>'");
    lines.push(
      username.digest
        ? `    . '<wsse:Password Type="${profile}#PasswordDigest">' . $digest . '</wsse:Password>'\n    . '<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' . base64_encode($nonce) . '</wsse:Nonce>'\n    . '<wsu:Created>' . $created . '</wsu:Created></wsse:UsernameToken>'`
        : `    . '<wsse:Password Type="${profile}#PasswordText">' . htmlspecialchars(getenv('SOAP_PASSWORD')) . '</wsse:Password></wsse:UsernameToken>'`,
    );
  }
  if (issued) lines.push("    . $issuedTokenXml // token from your security token service (WS-Trust)");
  lines.push("    . '</wsse:Security>';");
  lines.push(
    '$client->__setSoapHeaders(new SoapHeader(',
    "    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',",
    "    'Security',",
    '    new SoapVar($security, XSD_ANYXML),',
    '    true,',
    '));',
  );
  return lines;
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
  const { imports, setup, argument } = zeepWsse(soap.security);
  return [
    ...imports,
    'from zeep import Client',
    '',
    ...setup,
    `client = Client(${JSON.stringify(wsdl)}${argument})`,
    `result = ${call}`,
  ].join('\n');
}

/** zeep's own WS-Security plugins: UsernameToken (digest/timestamp) and X.509 Signature. */
function zeepWsse(security) {
  if (!security) return { imports: [], setup: [], argument: '' };
  const username = security.tokens.find((token) => token.type === 'username');
  const x509 = security.tokens.some((token) => token.type === 'x509') || security.signed;
  const issued = security.tokens.some((token) => ['issued', 'secure-conversation', 'saml'].includes(token.type));
  const imports = ['import os'];
  const plugins = [];
  const setup = [];
  if (username) {
    imports.push('from zeep.wsse.username import UsernameToken');
    plugins.push(`UsernameToken(os.environ["SOAP_USERNAME"], os.environ["SOAP_PASSWORD"]${username.digest ? ', use_digest=True' : ''})`);
  }
  if (x509) {
    imports.push('from zeep.wsse.signature import Signature');
    plugins.push('Signature("client-key.pem", "client-cert.pem")');
  }
  if (issued) setup.push('# Issued token: request it from the STS (WS-Trust) and add it to the wsse:Security header.', '');
  if (plugins.length === 0) return { imports: imports.length > 1 ? imports : [], setup, argument: '' };
  return { imports, setup, argument: `, wsse=${plugins.length === 1 ? plugins[0] : `[${plugins.join(', ')}]`}` };
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
