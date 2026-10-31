// SOAP support: WSDL/XSD conversion, generated envelopes and SOAP snippets,
// checked against the Orbit Legacy demo service (examples/demo/soap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXml } from '../../build/xml.mjs';
import { loadWsdl, mergeSoap } from '../../build/wsdl.mjs';
import { buildModel } from '../../build/model.mjs';
import { buildSoapSnippets } from '../../build/soap-snippets.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WSDL = join(ROOT, 'examples/demo/soap/orbit-legacy.wsdl');
const SOAP11 = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP12 = 'http://www.w3.org/2003/05/soap-envelope';

const fragment = await loadWsdl(WSDL);
const operation = (name) => fragment.paths[`/soap/LegacyBooking/${name}`].post;
const allExamples = () =>
  Object.values(fragment.paths).flatMap((item) => {
    const op = item.post;
    const media = [...Object.values(op.requestBody.content), ...Object.values(op.responses).flatMap((response) => Object.values(response.content ?? {}))];
    return media.flatMap((entry) => [entry.example, ...Object.values(entry.examples ?? {}).map((example) => example.value)]).filter(Boolean);
  });

test('xml parser resolves namespaces and reports errors with a line', () => {
  const root = parseXml('<a:root xmlns:a="urn:a" xmlns="urn:d"><child x="1 &amp; 2"><![CDATA[<raw>]]></child></a:root>');
  assert.equal(root.ns, 'urn:a');
  assert.equal(root.children[0].ns, 'urn:d');
  assert.equal(root.children[0].attrs.x, '1 & 2');
  assert.equal(root.children[0].text, '<raw>');
  assert.throws(() => parseXml('<a>\n<b></a>', { filename: 'bad.xml' }), /bad\.xml:2: unexpected <\/a>/);
  assert.throws(() => parseXml('<p:a/>'), /undeclared namespace prefix "p"/);
});

test('one operation per portType operation, SOAP 1.2 port folded in as an alternative', () => {
  assert.deepEqual(Object.keys(fragment.paths).sort(), [
    '/soap/LegacyBooking/CancelReservation',
    '/soap/LegacyBooking/GetReservation',
    '/soap/LegacyBooking/ReserveSeats',
  ]);
  const soap = operation('ReserveSeats')['x-soap'];
  assert.equal(soap.version, '1.1');
  assert.equal(soap.action, 'urn:orbit:legacy:ReserveSeats');
  assert.equal(soap.address, 'https://legacy.orbit.example/soap/booking');
  assert.deepEqual(soap.alternatives.map((alternative) => alternative.version), ['1.2']);
  assert.equal(operation('ReserveSeats').parameters[0].name, 'SOAPAction');
});

test('XSD constructs map onto schemas', () => {
  const { schemas } = fragment;
  assert.equal(schemas.Traveller['x-xsd-abstract'], true);
  assert.deepEqual(schemas.Traveller['x-xsd-derived'].sort(), ['Adult', 'Child']);
  assert.equal(schemas.Adult['x-xsd-abstract'], false, 'derived types must not inherit abstract');
  assert.equal(schemas.Contact.oneOf.length, 2, 'choice → oneOf');
  assert.equal(schemas.Money.properties.currency.xml.attribute, true, 'simpleContent attribute');
  assert.equal(schemas.Money.properties.value.xml['x-text'], true, 'simpleContent text');
  assert.deepEqual(schemas.CabinClass.enum, ['economy', 'business', 'suite']);
  assert.equal(schemas.SeatList.type, 'array', 'xsd:list');
  const travellers = schemas.Reservation.properties.Traveller;
  assert.equal(travellers.type, 'array');
  assert.equal(travellers.maxItems, 9);
  assert.ok(schemas.Reservation.required.includes('status'), 'required attribute');
});

test('every generated envelope and fault is well-formed SOAP', () => {
  const examples = allExamples();
  assert.ok(examples.length >= 9);
  for (const xml of examples) {
    const envelope = parseXml(xml);
    assert.equal(envelope.local, 'Envelope');
    assert.ok([SOAP11, SOAP12].includes(envelope.ns));
    assert.ok(envelope.children.some((child) => child.local === 'Body'));
  }
  const request = operation('ReserveSeats').requestBody.content['text/xml'].example;
  assert.match(request, /<ob:Traveller xsi:type="ob:Adult"/, 'abstract type sent as a qualified xsi:type');
  assert.match(request, /<ob:From>[A-Z]{3}<\/ob:From>/, 'value satisfies the XSD pattern');
  const fault = operation('ReserveSeats').responses[500].content['text/xml'].examples.BookingFault.value;
  assert.match(fault, /<detail>\s*<ob:BookingFault>/);
});

test('merges into an OpenAPI document without clobbering its schemas', () => {
  const rest = { openapi: '3.1.0', info: { title: 'REST', version: '1' }, paths: {}, components: { schemas: { Money: { type: 'number' } } } };
  const merged = mergeSoap(rest, [structuredClone(fragment)]);
  assert.equal(merged.components.schemas.Money.type, 'number');
  assert.ok(merged.components.schemas.Money_soap);
  const reservation = JSON.stringify(merged.components.schemas.Reservation);
  assert.ok(reservation.includes('#/components/schemas/Money_soap'), 'references follow the rename');

  const model = buildModel(merged);
  assert.deepEqual(model.nav.map((section) => section.name), ['SOAP services']);
  const endpoint = model.endpoints.find((candidate) => candidate.soap);
  assert.equal(endpoint.badge, 'SOAP');
  assert.equal(endpoint.servers[0].resolved, 'https://legacy.orbit.example/soap/booking');
});

test('SOAP snippets are syntactically valid where toolchains exist', (t) => {
  const model = buildModel(mergeSoap(null, [structuredClone(fragment)]));
  const dir = mkdtempSync(join(tmpdir(), 'atlas-soap-'));
  const has = (binary) => {
    try {
      execFileSync('which', [binary], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  try {
    for (const endpoint of model.endpoints) {
      const snippets = buildSoapSnippets(endpoint);
      assert.match(snippets.curl, /SOAPAction: "urn:orbit:legacy:/);
      assert.match(snippets.soapclient, new RegExp(`__soapCall\\('${endpoint.soap.operation}'`));
      assert.match(snippets.zeep, new RegExp(`client\\.service\\.${endpoint.soap.operation}\\(`));
      const write = (name, code) => {
        const file = join(dir, `${endpoint.slug}-${name}`);
        writeFileSync(file, code);
        return file;
      };
      execFileSync('bash', ['-n', write('curl.sh', snippets.curl)]);
      execFileSync(process.execPath, ['--check', write('fetch.mjs', snippets.javascript)]);
      if (has('php')) {
        execFileSync('php', ['-l', write('client.php', snippets.soapclient)], { stdio: 'ignore' });
        execFileSync('php', ['-l', write('laravel.php', `<?php\n${snippets.laravel}`)], { stdio: 'ignore' });
      } else t.diagnostic('php not installed: PHP snippets not syntax-checked');
      if (has('python3')) execFileSync('python3', ['-m', 'py_compile', write('zeep.py', snippets.zeep)]);
      else t.diagnostic('python3 not installed: zeep snippet not syntax-checked');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects what it does not support, clearly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-wsdl-'));
  try {
    const wsdl20 = join(dir, 'v2.wsdl');
    writeFileSync(wsdl20, '<description xmlns="http://www.w3.org/ns/wsdl"/>');
    await assert.rejects(loadWsdl(wsdl20), /WSDL 2\.0 is not supported/);
    const notWsdl = join(dir, 'x.xml');
    writeFileSync(notWsdl, '<root/>');
    await assert.rejects(loadWsdl(notWsdl), /not a WSDL 1\.1 document/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
