import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYaml } from '../../build/yaml.mjs';
import { deref, loadSpec, refName, resolveRef } from '../../build/spec.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = join(ROOT, 'tests/node/fixtures');
const y = (text) => parseYaml(text, { filename: 'test.yaml' });
const throwsAt = (text, pattern) => assert.throws(() => y(text), pattern);

test('block mappings and sequences, compact and indentless forms', () => {
  assert.deepEqual(y('a: 1\nb:\n  c: x\n  d: [1, 2]\n'), { a: 1, b: { c: 'x', d: [1, 2] } });
  assert.deepEqual(y('list:\n- a\n- b\nnext: 1\n'), { list: ['a', 'b'], next: 1 });
  assert.deepEqual(y('- name: a\n  value: 1\n- name: b\n'), [{ name: 'a', value: 1 }, { name: 'b' }]);
  assert.deepEqual(y('- - a\n  - b\n- - c\n'), [['a', 'b'], ['c']]);
  assert.deepEqual(y('-\n  late: x\n-\n- ~\n'), [{ late: 'x' }, null, null]);
  assert.deepEqual(y('a:\nb:\n'), { a: null, b: null });
  assert.deepEqual(y('outer:\n    deep:\n        - x\n'), { outer: { deep: ['x'] } });
});

test('comments, document markers and directives', () => {
  assert.deepEqual(y('%YAML 1.2\n--- # start\n# full line\na: b # trailing\nc: d#not-a-comment\n...\n'), { a: 'b', c: 'd#not-a-comment' });
  assert.deepEqual(y('url: http://x.test/a#b\nratio: a:b\n'), { url: 'http://x.test/a#b', ratio: 'a:b' });
  assert.equal(y(''), null);
  assert.equal(y('--- |\n  text\n'), 'text\n');
});

test('plain scalars fold across lines', () => {
  assert.deepEqual(y('d: first\n  second\n\n  third\nn: 1\n'), { d: 'first second\nthird', n: 1 });
  assert.deepEqual(y('- item\n  continued\n'), ['item continued']);
});

test('single-quoted scalars', () => {
  assert.deepEqual(y("a: 'it''s'\nb: 'one\n  two\n\n  three '\nc: '# not a comment'\n"), {
    a: "it's",
    b: 'one two\nthree ',
    c: '# not a comment',
  });
});

test('double-quoted scalars: escapes, folding, continuation', () => {
  assert.equal(y(String.raw`"\t\n\r\\\"\/\0\a\b\e\f\v"`), '\t\n\r\\"/\0\x07\b\x1b\f\v');
  assert.equal(y(String.raw`"\x41\u00e9\U0001F600\N\_\L\P\ "`), 'Aé😀\x85\xa0\u2028\u2029 ');
  assert.equal(y('"one  \n  two\n\n  three"'), 'one two\nthree');
  assert.equal(y('"joined\\\n  directly"'), 'joineddirectly');
  assert.equal(y('"keep \\t\n  next"'), 'keep \t next');
});

test('block scalars: literal, folded, chomping, indentation indicators', () => {
  assert.equal(y('a: |\n  one\n    two\n\n  three\n').a, 'one\n  two\n\nthree\n');
  assert.equal(y('a: |-\n  x\n\n').a, 'x');
  assert.equal(y('a: |+\n  x\n\n\nb: 1\n').a, 'x\n\n\n');
  assert.equal(y('a: >\n  a\n  b\n\n  c\n    more\n  d\n').a, 'a b\nc\n  more\nd\n');
  assert.equal(y('a: >-\n  folded\n  text\n').a, 'folded text');
  assert.equal(y('a: |2-\n    two extra\n   one extra\n').a, '  two extra\n one extra');
  assert.equal(y('a: | # comment\n  x\nb: |\nc: 1\n').a, 'x\n');
  assert.deepEqual(y('- |\n  in a list\n- >+\n  kept\n\n'), ['in a list\n', 'kept\n\n']);
  assert.equal(y('a: |\n  ends without newline').a, 'ends without newline');
});

test('flow collections, nested and spanning lines', () => {
  assert.deepEqual(y('{a: 1, b: [x, y], "c d": {e: "f, g"}}'), { a: 1, b: ['x', 'y'], 'c d': { e: 'f, g' } });
  assert.deepEqual(y('list: [\n  one,   # comment\n  "two",\n  three four,\n]\n'), { list: ['one', 'two', 'three four'] });
  assert.deepEqual(y('{"a":1,"b":[true,null],"c":{}}'), { a: 1, b: [true, null], c: {} });
  assert.deepEqual(y('{a, b: , c: ~}'), { a: null, b: null, c: null });
  assert.deepEqual(y('[a: 1, b, [], {}]'), [{ a: 1 }, 'b', [], {}]);
  assert.deepEqual(y("['it''s', \"q\\\"\", http://x.test/a]"), ["it's", 'q"', 'http://x.test/a']);
});

test('YAML 1.2 core schema typing', () => {
  const doc = y(`
nulls: [null, Null, NULL, ~, ]
bools: [true, True, TRUE, false, False, FALSE]
strings: [yes, no, on, off, y, n, 2024-01-15, '12', "true", 1_000, 0b101, 012e, 1:20]
ints: [0, -7, +3, 0o17, 0x1F, 012]
floats: [1.5, -.5, 1e3, 2.5E-3, 1.]
special: [.inf, -.Inf, .NAN]
`);
  assert.deepEqual(doc.nulls, [null, null, null, null]); // the trailing comma adds no entry
  assert.deepEqual(doc.bools, [true, true, true, false, false, false]);
  assert.deepEqual(doc.strings, ['yes', 'no', 'on', 'off', 'y', 'n', '2024-01-15', '12', 'true', '1_000', '0b101', '012e', '1:20']);
  assert.deepEqual(doc.ints, [0, -7, 3, 15, 31, 12]);
  assert.deepEqual(doc.floats, [1.5, -0.5, 1000, 0.0025, 1]);
  assert.deepEqual(doc.special.slice(0, 2), [Infinity, -Infinity]);
  assert.ok(Number.isNaN(doc.special[2]));
});

test('mapping keys are strings with their source spelling', () => {
  const doc = y("200: ok\n'404': missing\ntrue: t\nyes: y\non: o\n1.0: f\nnull: n\n");
  assert.deepEqual(Object.keys(doc), ['200', '404', 'true', 'yes', 'on', '1.0', 'null']);
  assert.equal(doc.on, 'o');
  assert.deepEqual(y('responses:\n  200:\n    description: OK\n').responses['200'], { description: 'OK' });
  assert.deepEqual(y('{200: a, 1e3: b}'), { 200: 'a', '1e3': 'b' });
  const proto = y('__proto__: {polluted: true}\n');
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  assert.deepEqual(proto.__proto__, { polluted: true });
});

test('anchors, aliases and merge keys', () => {
  const doc = y(`
base: &base {a: 1, b: 2}
extra: &extra
  c: 3
same: *base
merged:
  <<: *base
  b: 20
multi:
  <<: [*base, *extra]
  d: 4
flow: {<<: *base, a: 9}
`);
  assert.equal(doc.same, doc.base);
  assert.deepEqual(doc.merged, { a: 1, b: 20 });
  assert.deepEqual(doc.multi, { a: 1, b: 2, c: 3, d: 4 });
  assert.deepEqual(doc.flow, { a: 9, b: 2 });
  assert.deepEqual(y("'<<': literal\n"), { '<<': 'literal' });
});

test('explicit tags', () => {
  assert.deepEqual(y('[!!str 123, !!str true, !!int "42", !!float "1.5", !!bool "false", !!null "", !local text, !<tag:yaml.org,2002:str> 7]'), [
    '123', 'true', 42, 1.5, false, null, 'text', '7',
  ]);
  assert.deepEqual(y('a: !!str\nb: !!map\n  c: 1\n'), { a: '', b: { c: 1 } });
  assert.deepEqual(y('a: !!str |\n  12\n'), { a: '12\n' });
});

test('explicit "? " keys with scalar keys (how PyYAML writes long keys)', () => {
  assert.deepEqual(y('? a very long key\n: type: object\n  title: T\n? lonely\nnext: 1\n'), {
    'a very long key': { type: 'object', title: 'T' },
    lonely: null,
    next: 1,
  });
});

test('errors name the file and line', () => {
  throwsAt('a: 1\nb: "open\nc: 2\n', /^SyntaxError: test\.yaml:2: unterminated double-quoted string$/);
  throwsAt("a: 1\n\nb: 'open\n", /test\.yaml:3: unterminated single-quoted string/);
  throwsAt('a:\n\tb: 1\n', /test\.yaml:2: tab character used for indentation/);
  throwsAt('a: b: c\n', /test\.yaml:1: mapping values are not allowed here/);
  throwsAt('a:\n  b: 1\n c: 2\n', /test\.yaml:3: /);
  throwsAt('a: *missing\n', /test\.yaml:1: unknown alias \*missing/);
  throwsAt('a: 1\n---\nb: 2\n', /test\.yaml:2: multiple YAML documents are not supported/);
  throwsAt('a: [1, 2\n', /test\.yaml:1: unterminated flow sequence/);
  throwsAt('a: "\\q"\n', /test\.yaml:1: invalid escape \\q/);
  throwsAt('a: - b\n', /test\.yaml:1: a block sequence cannot start on the same line/);
  throwsAt('x: 1\n? [a, b]\n: c\n', /test\.yaml:2: collections as mapping keys are not supported/);
  throwsAt('a: 1\n- b\n', /test\.yaml:2: a sequence entry is not allowed here/);
  throwsAt('a: 1\njust text\n', /test\.yaml:2: expected a mapping entry/);
  throwsAt('a: !!int abc\n', /test\.yaml:1: invalid !!int value "abc"/);
});

test('CRLF line endings and a BOM are accepted', () => {
  assert.deepEqual(y('\uFEFFa: |\r\n  x\r\n  y\r\nb: 1\r\n'), { a: 'x\ny\n', b: 1 });
});

test('the demo spec dumped to YAML by PyYAML reads back identical to the JSON', () => {
  const json = JSON.parse(readFileSync(join(ROOT, 'examples/demo/openapi.json'), 'utf8'));
  const yaml = parseYaml(readFileSync(join(FIXTURES, 'demo.yaml'), 'utf8'), { filename: 'demo.yaml' });
  assert.deepEqual(yaml, json);
});

test('loadSpec reads YAML by extension and by content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-yaml-'));
  try {
    const doc = 'openapi: 3.0.3\ninfo: {title: T, version: "1"}\npaths: {}\n';
    writeFileSync(join(dir, 'spec.yml'), doc);
    writeFileSync(join(dir, 'spec.json'), doc); // YAML content under a .json name
    writeFileSync(join(dir, 'flow.yaml'), "{openapi: 3.0.3, paths: {}, info: {title: 'T', version: '1'}}");
    for (const name of ['spec.yml', 'spec.json', 'flow.yaml']) {
      assert.equal((await loadSpec(join(dir, name))).openapi, '3.0.3', name);
    }
    writeFileSync(join(dir, 'swagger.yaml'), 'swagger: "2.0"\ninfo: {title: T, version: "1"}\npaths: {}\n');
    await assert.rejects(loadSpec(join(dir, 'swagger.yaml')), /Swagger 2\.0 is not supported, convert it to OpenAPI 3/);
    writeFileSync(join(dir, 'broken.yaml'), 'openapi: 3.0.3\npaths:\n  /a:\n    get: "x\n');
    await assert.rejects(loadSpec(join(dir, 'broken.yaml')), /broken\.yaml:4: unterminated double-quoted string/);
    writeFileSync(join(dir, 'missing.yaml'), "openapi: 3.0.3\npaths:\n  /a:\n    $ref: 'nope.yaml'\n");
    await assert.rejects(loadSpec(join(dir, 'missing.yaml')), /missing\.yaml: \$ref "nope\.yaml" points to a missing file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('multi-file specs are bundled into internal pointers', async () => {
  const spec = await loadSpec(join(FIXTURES, 'multifile/root.yaml'));
  const items = spec.paths['/pets'].get.responses['200'].content['application/json'].schema.items;
  assert.equal(items.$ref, '#/x-atlas-external/components.yaml/components/components/schemas/Pet');
  assert.equal(refName(items.$ref), 'Pet');

  // components.yaml's Pet is a whole-file ref to schemas/Pet.yaml: shown as "Pet" too.
  const { node: pet, name } = deref(spec, items);
  assert.equal(name, 'Pet');
  assert.deepEqual(pet.required, ['name']);
  assert.equal(spec.components.schemas.Owner.properties.pets.items.$ref, '#/x-atlas-external/schemas~1Pet.yaml/Pet');

  // An internal `#/` ref inside components.yaml points into components.yaml.
  const error = spec.paths['/pets'].get.responses.default;
  const errorSchema = resolveRef(spec, error.$ref).content['application/json'].schema;
  assert.equal(errorSchema.$ref, '#/x-atlas-external/components.yaml/components/components/schemas/Error');
  assert.deepEqual(deref(spec, errorSchema).node.properties.code, { type: 'integer' });

  // Pet.yaml points back at the root (plain internal pointer), at itself, and at a JSON file.
  assert.equal(pet.properties.owner.$ref, '#/components/schemas/Owner');
  assert.equal(deref(spec, pet.properties.parent).node, pet);
  assert.equal(deref(spec, pet.properties.tag).name, 'Tag');
  assert.deepEqual(deref(spec, pet.properties.tag).node.properties.label, { type: 'string' });

  // Discriminator mappings are rewritten alongside the $refs they name.
  assert.equal(pet.properties.kind.discriminator.mapping.broken, pet.properties.kind.oneOf[0].$ref);

  // Each file is stored once, under its root-relative path.
  assert.deepEqual(Object.keys(spec['x-atlas-external']).sort(), ['components.yaml', 'schemas/Pet.yaml', 'schemas/Tag.json']);

  // Remote refs stay as written and are reported when used.
  assert.equal(spec.paths['/status'].$ref, 'https://example.com/shared.yaml#/status');
  assert.throws(() => resolveRef(spec, spec.paths['/status'].$ref), /Remote \$ref is not supported/);
});
