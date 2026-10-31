import { deref, mergeAllOf } from './spec.mjs';
import { exampleFromSchema } from './example.mjs';
import { esc } from './text.mjs';

/**
 * Example XML from a schema carrying OpenAPI `xml` metadata (what
 * build/wsdl.mjs produces from XSD): element names and namespaces,
 * attributes, text content, repeated elements. Used for SOAP envelopes;
 * works for any XML-described schema.
 */

const ENVELOPE = {
  '1.1': { prefix: 'soapenv', ns: 'http://schemas.xmlsoap.org/soap/envelope/' },
  '1.2': { prefix: 'soap', ns: 'http://www.w3.org/2003/05/soap-envelope' },
};
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

// Deep XSD trees (BiPRO nests ten levels and more) would turn examples into
// pages. Below this depth only required elements are written.
const OPTIONAL_DEPTH = 4;
const MAX_DEPTH = 12;

export function xmlEnvelope(spec, body, version, prefixOf, mode = 'request', header = '') {
  const writer = createWriter(spec, prefixOf, mode);
  const content = body ? writer.element(body, 2) : '';
  return wrap(writer, version, content, header);
}

export const WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
export const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
const TOKEN_PROFILE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0';
const MESSAGE_SECURITY = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0';

/**
 * Example `wsse:Security` header (indented for the envelope's Header) for a
 * WS-Security summary from build/wspolicy.mjs. Values are illustrative —
 * a digest, nonce and timestamps are computed per request by real clients
 * (and by the try-it console).
 */
export function wsseHeader(security, version) {
  const { prefix } = ENVELOPE[version];
  const mustUnderstand = version === '1.2' ? 'true' : '1';
  const lines = [`    <wsse:Security xmlns:wsse="${WSSE}" xmlns:wsu="${WSU}" ${prefix}:mustUnderstand="${mustUnderstand}">`];
  if (security.timestamp) {
    lines.push(
      '      <wsu:Timestamp wsu:Id="TS-1">',
      '        <wsu:Created>2026-01-15T09:30:00.000Z</wsu:Created>',
      '        <wsu:Expires>2026-01-15T09:35:00.000Z</wsu:Expires>',
      '      </wsu:Timestamp>',
    );
  }
  for (const token of security.tokens) {
    if (token.type === 'username') {
      lines.push('      <wsse:UsernameToken wsu:Id="UT-1">', '        <wsse:Username>username</wsse:Username>');
      if (!token.noPassword) {
        lines.push(
          token.digest
            ? `        <wsse:Password Type="${TOKEN_PROFILE}#PasswordDigest">Base64(SHA-1(nonce + created + password))</wsse:Password>`
            : `        <wsse:Password Type="${TOKEN_PROFILE}#PasswordText">password</wsse:Password>`,
        );
      }
      if (token.digest) {
        lines.push(
          `        <wsse:Nonce EncodingType="${MESSAGE_SECURITY}#Base64Binary">MTIzNDU2Nzg5MDEyMzQ1Ng==</wsse:Nonce>`,
          '        <wsu:Created>2026-01-15T09:30:00.000Z</wsu:Created>',
        );
      }
      lines.push('      </wsse:UsernameToken>');
    } else if (token.type === 'issued' || token.type === 'secure-conversation') {
      lines.push(`      <!-- token issued by the security token service${token.issuer ? ` (${token.issuer})` : ''}, e.g. a SAML assertion or wsc:SecurityContextToken -->`);
    } else if (token.type === 'saml') {
      lines.push('      <!-- SAML assertion obtained from your identity provider -->');
    } else if (token.type === 'kerberos') {
      lines.push('      <!-- Kerberos ticket (wsse:BinarySecurityToken, ValueType GSS_Kerberosv5_AP_REQ) -->');
    } else if (token.type === 'x509') {
      lines.push(
        `      <wsse:BinarySecurityToken wsu:Id="X509-1" EncodingType="${MESSAGE_SECURITY}#Base64Binary" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3">MIIC…base64 certificate…</wsse:BinarySecurityToken>`,
      );
    }
  }
  if (security.signed) lines.push('      <!-- ds:Signature over the Body and Timestamp, computed with the client\'s private key -->');
  lines.push('    </wsse:Security>');
  return lines.join('\n');
}

export function xmlFaultEnvelope(spec, detail, version, prefixOf) {
  const writer = createWriter(spec, prefixOf, 'response');
  const { prefix } = ENVELOPE[version];
  const detailXml = detail ? writer.element(detail, version === '1.1' ? 4 : 4) : '';
  const fault =
    version === '1.1'
      ? [
          `    <${prefix}:Fault>`,
          `      <faultcode>${prefix}:Server</faultcode>`,
          '      <faultstring>Description of the error</faultstring>',
          detailXml ? `      <detail>\n${detailXml}\n      </detail>` : '',
          `    </${prefix}:Fault>`,
        ]
      : [
          `    <${prefix}:Fault>`,
          `      <${prefix}:Code><${prefix}:Value>${prefix}:Receiver</${prefix}:Value></${prefix}:Code>`,
          `      <${prefix}:Reason><${prefix}:Text xml:lang="en">Description of the error</${prefix}:Text></${prefix}:Reason>`,
          detailXml ? `      <${prefix}:Detail>\n${detailXml}\n      </${prefix}:Detail>` : '',
          `    </${prefix}:Fault>`,
        ];
  return wrap(writer, version, fault.filter(Boolean).join('\n'));
}

function wrap(writer, version, content, header = '') {
  const { prefix, ns } = ENVELOPE[version];
  const declarations = [`xmlns:${prefix}="${ns}"`, ...writer.declarations()].join(' ');
  return [
    `<${prefix}:Envelope ${declarations}>`,
    header ? `  <${prefix}:Header>\n${header}\n  </${prefix}:Header>` : `  <${prefix}:Header/>`,
    `  <${prefix}:Body>`,
    content,
    `  </${prefix}:Body>`,
    `</${prefix}:Envelope>`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function createWriter(spec, prefixOf, mode) {
  const used = new Map(); // namespace → prefix

  function prefixFor(namespace) {
    if (!namespace) return '';
    if (!used.has(namespace)) {
      const taken = new Set(used.values());
      let prefix = namespace === XSI ? 'xsi' : prefixOf?.(namespace) || 'ns';
      const reserved = prefix === 'soapenv' || prefix === 'soap' || (prefix === 'xsi' && namespace !== XSI);
      if (taken.has(prefix) || reserved) {
        let counter = 1;
        while (taken.has(`${prefix}${counter}`)) counter += 1;
        prefix = `${prefix}${counter}`;
      }
      used.set(namespace, prefix);
    }
    return used.get(namespace);
  }

  function qualified(xml, fallbackName) {
    const name = xml?.name ?? fallbackName;
    const prefix = prefixFor(xml?.namespace);
    return prefix ? `${prefix}:${name}` : name;
  }

  /** One element (with its own xml metadata) at the given indent level. */
  function element(raw, level, depth = 0, seen = new Set(), fallbackName = 'item') {
    const pad = '  '.repeat(level);
    const xml = raw?.xml ?? {};
    const refPath = raw?.$ref ?? null;
    if (refPath && seen.has(refPath)) return `${pad}<!-- recursive ${refPath.split('/').pop()} -->`;
    const nextSeen = refPath ? new Set([...seen, refPath]) : seen;
    let schema = mergeAllOf(spec, deref(spec, raw ?? {}).node) ?? {};
    const tag = qualified(xml, fallbackName);

    // Abstract type: instances are sent as one of the derived types, named by xsi:type.
    let typeAttribute = '';
    if (schema['x-xsd-abstract'] && schema['x-xsd-derived']?.length) {
      const concrete = schema['x-xsd-derived'][0];
      const target = spec.components?.schemas?.[concrete];
      if (target) {
        schema = mergeAllOf(spec, target);
        const qname = target['x-xsd-qname'];
        const typePrefix = qname?.ns ? prefixFor(qname.ns) : '';
        typeAttribute = ` ${prefixFor(XSI)}:type="${esc(typePrefix ? `${typePrefix}:${qname.local}` : qname?.local ?? concrete)}"`;
      }
    }

    if (schema.type === 'array' && schema.items) {
      return element({ ...schema.items, xml: { ...(schema.items.xml ?? {}), ...xml } }, level, depth, nextSeen, fallbackName);
    }

    const properties = Object.entries(schema.properties ?? {});
    const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
    if (variant) {
      const merged = mergeAllOf(spec, deref(spec, variant).node);
      properties.push(...Object.entries(merged.properties ?? {}));
    }
    if (properties.length === 0 && schema.type !== 'object') {
      return `${pad}<${tag}${typeAttribute}>${esc(leafValue(schema, xml.name ?? fallbackName))}</${tag}>`;
    }

    const required = new Set(schema.required ?? []);
    const attributes = [];
    let text = null;
    const children = [];
    for (const [name, property] of properties) {
      const propertyXml = property?.xml ?? {};
      if (propertyXml.attribute) {
        if (!required.has(name) && depth >= OPTIONAL_DEPTH) continue;
        const resolved = mergeAllOf(spec, deref(spec, property).node);
        attributes.push(` ${qualified(propertyXml, name)}="${esc(leafValue(resolved, name))}"`);
      } else if (propertyXml['x-text']) {
        const resolved = mergeAllOf(spec, deref(spec, property).node);
        text = leafValue(resolved, xml.name ?? name);
      } else {
        if (!required.has(name) && depth >= OPTIONAL_DEPTH) continue;
        if (depth >= MAX_DEPTH) continue;
        children.push(element({ ...property, xml: { name, ...propertyXml } }, level + 1, depth + 1, nextSeen, name));
      }
    }
    const open = `${pad}<${tag}${typeAttribute}${attributes.join('')}`;
    if (text !== null) return `${open}>${esc(text)}</${tag}>`;
    if (children.length === 0) return `${open}/>`;
    return `${open}>\n${children.join('\n')}\n${pad}</${tag}>`;
  }

  function leafValue(schema, name) {
    if (schema.const !== undefined) return String(schema.const);
    const value = exampleFromSchema(spec, schema, 0, new Set(), mode, name);
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(' ');
    if (typeof value === 'object') return '';
    return String(value);
  }

  return {
    element,
    declarations: () => [...used].map(([namespace, prefix]) => `xmlns:${prefix}="${namespace}"`),
  };
}
