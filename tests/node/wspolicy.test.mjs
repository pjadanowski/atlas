// WS-SecurityPolicy detection across policy dialects and attachment styles,
// on small WSDLs written per case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadWsdl } from '../../build/wsdl.mjs';
import { declaredSecurity } from '../../build/wspolicy.mjs';

const WSP12 = 'http://schemas.xmlsoap.org/ws/2004/09/policy';
const WSP15 = 'http://www.w3.org/ns/ws-policy';
const SP11 = 'http://schemas.xmlsoap.org/ws/2005/07/securitypolicy';
const SP13 = 'http://docs.oasis-open.org/ws-sx/ws-securitypolicy/200702';

/** A one-operation WSDL; `policies` go at the top level, `bindingPolicy` / `operationPolicy` inside. */
function wsdl({ wsp = WSP15, sp = SP13, policies = '', bindingPolicy = '', operationPolicy = '', bindingAttributes = '' }) {
  return `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:t" xmlns:wsp="${wsp}" xmlns:sp="${sp}"
  xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
  xmlns:wsa="http://www.w3.org/2005/08/addressing" targetNamespace="urn:t">
  ${policies}
  <types><xsd:schema targetNamespace="urn:t" elementFormDefault="qualified">
    <xsd:element name="Ping"><xsd:complexType><xsd:sequence><xsd:element name="Text" type="xsd:string"/></xsd:sequence></xsd:complexType></xsd:element>
  </xsd:schema></types>
  <message name="PingIn"><part name="p" element="tns:Ping"/></message>
  <portType name="PT"><operation name="Ping"><input message="tns:PingIn"/></operation></portType>
  <binding name="B" type="tns:PT" ${bindingAttributes}>
    ${bindingPolicy}
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="Ping">${operationPolicy}<soap:operation soapAction="urn:ping"/><input><soap:body use="literal"/></input></operation>
  </binding>
  <service name="S"><port name="P" binding="tns:B"><soap:address location="https://example.test/s"/></port></service>
</definitions>`;
}

async function securityOf(source, options) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-wsp-'));
  try {
    const file = join(dir, 'service.wsdl');
    writeFileSync(file, source);
    const fragment = await loadWsdl(file, options);
    return fragment.paths['/soap/S/Ping'].post['x-soap'].security;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('no policy, nothing declared → no WS-Security', async () => {
  assert.equal(await securityOf(wsdl({})), null);
});

test('WS-Policy 1.5 + SecurityPolicy 1.3 by PolicyReference: digest UsernameToken over HTTPS', async () => {
  const security = await securityOf(
    wsdl({
      policies: `<wsp:Policy wsu:Id="P1"><wsp:ExactlyOne><wsp:All>
        <sp:TransportBinding><wsp:Policy><sp:TransportToken><wsp:Policy><sp:HttpsToken/></wsp:Policy></sp:TransportToken><sp:IncludeTimestamp/></wsp:Policy></sp:TransportBinding>
        <sp:SignedSupportingTokens><wsp:Policy><sp:UsernameToken><wsp:Policy><sp:HashPassword/></wsp:Policy></sp:UsernameToken></wsp:Policy></sp:SignedSupportingTokens>
      </wsp:All></wsp:ExactlyOne></wsp:Policy>`,
      bindingPolicy: '<wsp:PolicyReference URI="#P1"/>',
    }),
  );
  assert.deepEqual(security.tokens, [{ type: 'username', digest: true, noPassword: false }]);
  assert.equal(security.timestamp, true);
  assert.equal(security.https, true);
});

test('WS-Policy 1.2 + SecurityPolicy 1.1 via wsp:PolicyURIs: text password', async () => {
  const security = await securityOf(
    wsdl({
      wsp: WSP12,
      sp: SP11,
      policies: '<wsp:Policy wsu:Id="UT"><sp:SupportingTokens><wsp:Policy><sp:UsernameToken/></wsp:Policy></sp:SupportingTokens></wsp:Policy>',
      bindingAttributes: 'wsp:PolicyURIs="#UT"',
    }),
  );
  assert.deepEqual(security.tokens, [{ type: 'username', digest: false, noPassword: false }]);
});

test('inline operation policy: issued token with its STS, merged with the binding policy', async () => {
  const security = await securityOf(
    wsdl({
      bindingPolicy: '<wsp:Policy><sp:TransportBinding><wsp:Policy><sp:TransportToken><wsp:Policy><sp:HttpsToken RequireClientCertificate="true"/></wsp:Policy></sp:TransportToken></wsp:Policy></sp:TransportBinding></wsp:Policy>',
      operationPolicy: `<wsp:Policy><sp:SupportingTokens><wsp:Policy><sp:IssuedToken>
        <sp:Issuer><wsa:Address>https://sts.example.test/trust</wsa:Address></sp:Issuer>
        <sp:RequestSecurityTokenTemplate><wst:TokenType xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512">urn:saml2</wst:TokenType></sp:RequestSecurityTokenTemplate>
      </sp:IssuedToken></wsp:Policy></sp:SupportingTokens></wsp:Policy>`,
    }),
  );
  assert.deepEqual(security.tokens, [{ type: 'issued', issuer: 'https://sts.example.test/trust', tokenType: 'urn:saml2' }]);
  assert.equal(security.https, true);
  assert.equal(security.clientCertificate, true);
});

test('asymmetric binding: X.509 signing is recognized (documented, not done in try-it)', async () => {
  const security = await securityOf(
    wsdl({
      bindingPolicy: `<wsp:Policy><sp:AsymmetricBinding><wsp:Policy>
        <sp:InitiatorToken><wsp:Policy><sp:X509Token/></wsp:Policy></sp:InitiatorToken>
        <sp:IncludeTimestamp/></wsp:Policy></sp:AsymmetricBinding>
        <sp:SignedParts><sp:Body/></sp:SignedParts><sp:EncryptedParts><sp:Body/></sp:EncryptedParts></wsp:Policy>`,
    }),
  );
  assert.equal(security.signed, true);
  assert.equal(security.encrypted, true);
  assert.equal(security.timestamp, true);
  assert.deepEqual(security.tokens, [{ type: 'x509' }]);
});

test('ExactlyOne: the first alternative documents the operation', async () => {
  const security = await securityOf(
    wsdl({
      bindingPolicy: `<wsp:Policy><wsp:ExactlyOne>
        <wsp:All><sp:SupportingTokens><wsp:Policy><sp:UsernameToken/></wsp:Policy></sp:SupportingTokens></wsp:All>
        <wsp:All><sp:SupportingTokens><wsp:Policy><sp:SamlToken/></wsp:Policy></sp:SupportingTokens></wsp:All>
      </wsp:ExactlyOne></wsp:Policy>`,
    }),
  );
  assert.deepEqual(security.tokens.map((token) => token.type), ['username']);
});

test('declared security fills in for WSDLs without a policy, and a policy wins over it', async () => {
  const declared = await securityOf(wsdl({}), { security: 'issued+timestamp', sts: 'https://sts.example.test' });
  assert.equal(declared.declared, true);
  assert.equal(declared.timestamp, true);
  assert.equal(declared.tokens[0].issuer, 'https://sts.example.test');

  const fromPolicy = await securityOf(
    wsdl({ bindingPolicy: '<wsp:Policy><sp:SupportingTokens><wsp:Policy><sp:UsernameToken/></wsp:Policy></sp:SupportingTokens></wsp:Policy>' }),
    { security: 'x509' },
  );
  assert.deepEqual(fromPolicy.tokens.map((token) => token.type), ['username']);
});

test('declaredSecurity validates its input', () => {
  assert.equal(declaredSecurity(null), null);
  assert.equal(declaredSecurity('none'), null);
  assert.deepEqual(declaredSecurity('username-digest').tokens, [{ type: 'username', digest: true, noPassword: false }]);
  assert.throws(() => declaredSecurity('ldap'), /Unknown --soap-security part "ldap"/);
});
