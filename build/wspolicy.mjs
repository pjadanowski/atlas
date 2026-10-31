/**
 * WS-Policy / WS-SecurityPolicy → what a client must put in (or around) a
 * SOAP message. Reads policies attached to a binding, its operations and
 * their input messages — by reference (`wsp:PolicyReference URI="#id"`,
 * `wsp:PolicyURIs`) or inline — in WS-Policy 1.2 and 1.5, and
 * WS-SecurityPolicy 1.1 (2005/07) and 1.2/1.3 (200702).
 *
 * The result is a summary, not an enforcement model: the first policy
 * alternative is taken, and assertions are recognized wherever they nest.
 *
 *   { tokens: [{ type: 'username', digest, noPassword }
 *              | { type: 'issued', issuer, tokenType }
 *              | { type: 'secure-conversation', issuer }
 *              | { type: 'x509' } | { type: 'saml' } | { type: 'kerberos' }],
 *     timestamp, https, clientCertificate, signed, encrypted }
 */

const WSP = ['http://schemas.xmlsoap.org/ws/2004/09/policy', 'http://www.w3.org/ns/ws-policy'];
const SP = [
  'http://schemas.xmlsoap.org/ws/2005/07/securitypolicy',
  'http://docs.oasis-open.org/ws-sx/ws-securitypolicy/200512',
  'http://docs.oasis-open.org/ws-sx/ws-securitypolicy/200702',
];
const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
const WSA = ['http://www.w3.org/2005/08/addressing', 'http://schemas.xmlsoap.org/ws/2004/08/addressing'];

const isWsp = (element) => WSP.includes(element.ns);
const isSp = (element) => SP.includes(element.ns);

/** Every top-level wsp:Policy of a WSDL document, by wsu:Id / Id / Name. */
export function collectPolicies(definitions, into) {
  for (const child of definitions.children) {
    if (!isWsp(child) || child.local !== 'Policy') continue;
    const id = attribute(child, WSU, 'Id') ?? child.attrs.Id ?? child.attrs.Name ?? child.attrs.wsuId;
    if (id) into.set(id.replace(/^#/, ''), child);
  }
}

/**
 * Security required for one operation: policies on the binding, the
 * binding operation and its input, merged (binding-level transport
 * bindings and per-operation supporting tokens combine).
 */
export function operationSecurity(policies, ...attachmentPoints) {
  const summary = { tokens: [], timestamp: false, https: false, clientCertificate: false, signed: false, encrypted: false };
  let found = false;
  for (const point of attachmentPoints.filter(Boolean)) {
    for (const policy of attachedPolicies(policies, point)) {
      found = true;
      readAssertions(firstAlternative(policy), summary);
    }
  }
  if (!found) return null;
  // The same token can be named by several policies (binding + operation).
  const seen = new Set();
  summary.tokens = summary.tokens.filter((token) => {
    const key = JSON.stringify(token);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return summary;
}

function attachedPolicies(policies, element) {
  const out = [];
  for (const child of element.children) {
    if (!isWsp(child)) continue;
    if (child.local === 'Policy') out.push(child);
    if (child.local === 'PolicyReference' && child.attrs.URI) {
      const target = policies.get(child.attrs.URI.replace(/^#/, ''));
      if (target) out.push(target);
    }
  }
  // wsp:PolicyURIs="#a #b" as an attribute (WS-Policy attachment).
  for (const [name, value] of Object.entries(element.attrs)) {
    if (name.endsWith(':PolicyURIs') || name === 'PolicyURIs') {
      for (const uri of value.split(/\s+/).filter(Boolean)) {
        const target = policies.get(uri.replace(/^#/, ''));
        if (target) out.push(target);
      }
    }
  }
  return out;
}

/**
 * wsp:ExactlyOne picks one alternative; documentation shows the first (the
 * one most clients use). wsp:All and nested wsp:Policy are transparent.
 */
function firstAlternative(element) {
  return {
    ...element,
    children: element.children.flatMap((child) => {
      if (isWsp(child) && child.local === 'ExactlyOne') {
        const first = child.children.find((alternative) => alternative.local !== 'documentation');
        return first ? [firstAlternative(first)] : [];
      }
      return [isWsp(child) ? firstAlternative(child) : child];
    }),
  };
}

function readAssertions(element, summary) {
  for (const child of element.children) {
    if (isSp(child)) {
      switch (child.local) {
        case 'TransportBinding':
          summary.https = true;
          if (findDeep(child, (node) => isSp(node) && node.local === 'HttpsToken' && /true/i.test(node.attrs.RequireClientCertificate ?? ''))) {
            summary.clientCertificate = true;
          }
          if (findDeep(child, (node) => isSp(node) && node.local === 'RequireClientCertificate')) summary.clientCertificate = true;
          break;
        case 'AsymmetricBinding':
        case 'SymmetricBinding':
          summary.signed = true;
          if (findDeep(child, (node) => isSp(node) && /X509Token/.test(node.local))) summary.tokens.push({ type: 'x509' });
          break;
        case 'SignedParts':
        case 'SignedElements':
          summary.signed = true;
          break;
        case 'EncryptedParts':
        case 'EncryptedElements':
          summary.encrypted = true;
          break;
        case 'IncludeTimestamp':
          summary.timestamp = true;
          break;
        case 'UsernameToken':
          summary.tokens.push({
            type: 'username',
            digest: Boolean(findDeep(child, (node) => isSp(node) && node.local === 'HashPassword')),
            noPassword: Boolean(findDeep(child, (node) => isSp(node) && node.local === 'NoPassword')),
          });
          continue; // its nested policy holds only token options
        case 'IssuedToken':
          summary.tokens.push({
            type: 'issued',
            issuer: issuerAddress(child),
            tokenType: findDeep(child, (node) => node.local === 'TokenType')?.text.trim() || null,
          });
          continue;
        case 'SecureConversationToken':
          summary.tokens.push({ type: 'secure-conversation', issuer: issuerAddress(child) });
          continue;
        case 'X509Token':
          summary.tokens.push({ type: 'x509' });
          continue;
        case 'SamlToken':
          summary.tokens.push({ type: 'saml' });
          continue;
        case 'KerberosToken':
        case 'SpnegoContextToken':
          summary.tokens.push({ type: 'kerberos' });
          continue;
        default:
          break;
      }
    }
    readAssertions(child, summary);
  }
}

function issuerAddress(element) {
  const issuer = findDeep(element, (node) => isSp(node) && node.local === 'Issuer');
  const address = issuer && findDeep(issuer, (node) => WSA.includes(node.ns) && node.local === 'Address');
  return address?.text.trim() || null;
}

function findDeep(element, test) {
  for (const child of element.children ?? []) {
    if (test(child)) return child;
    const nested = findDeep(child, test);
    if (nested) return nested;
  }
  return null;
}

function attribute(element, ns, local) {
  for (const [name, value] of Object.entries(element.attrs)) {
    const colon = name.indexOf(':');
    if (colon !== -1 && name.slice(colon + 1) === local && element.scope.get(name.slice(0, colon)) === ns) return value;
  }
  return undefined;
}

/**
 * The security a declared kind stands for — for WSDLs that require
 * WS-Security without saying so in a policy (`--soap-security`):
 * "username", "username-digest", "issued", "x509", each optionally
 * "+timestamp", e.g. "username-digest+timestamp".
 */
export function declaredSecurity(kind, { sts = null } = {}) {
  if (!kind || kind === 'none') return null;
  const parts = String(kind).split('+').map((part) => part.trim().toLowerCase());
  const summary = { tokens: [], timestamp: parts.includes('timestamp'), https: false, clientCertificate: false, signed: false, encrypted: false, declared: true };
  for (const part of parts) {
    if (part === 'username') summary.tokens.push({ type: 'username', digest: false, noPassword: false });
    else if (part === 'username-digest') summary.tokens.push({ type: 'username', digest: true, noPassword: false });
    else if (part === 'issued' || part === 'sts') summary.tokens.push({ type: 'issued', issuer: sts, tokenType: null });
    else if (part === 'x509') {
      summary.tokens.push({ type: 'x509' });
      summary.signed = true;
    } else if (part !== 'timestamp') {
      throw new Error(`Unknown --soap-security part "${part}" (use username, username-digest, issued, x509, timestamp)`);
    }
  }
  return summary;
}

