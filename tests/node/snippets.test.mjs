import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSpec } from '../../build/spec.mjs';
import { buildModel } from '../../build/model.mjs';
import { buildSnippets, SNIPPET_LANGUAGES } from '../../build/snippets.mjs';
import { requestPanel } from '../../build/render/codecol.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const model = buildModel(await loadSpec(join(ROOT, 'examples/demo/openapi.json')));

const endpoint = (id) => {
  const found = model.endpoints.find((candidate) => candidate.id === id);
  assert.ok(found, `operation ${id} exists in the demo spec`);
  return found;
};
const snippetsFor = (id) => buildSnippets(endpoint(id), model.baseUrl);

/**
 * Synthetic operations covering the branches the demo spec doesn't reach:
 * form-urlencoded with repeated keys, raw text and binary bodies, apiKey in
 * query and cookie, and string escaping hazards in every language.
 */
const EDGE_SPEC = {
  openapi: '3.1.0',
  info: { title: 'Edge', version: '1' },
  servers: [{ url: 'https://edge.example/v1' }],
  components: {
    securitySchemes: {
      queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
      cookieKey: { type: 'apiKey', in: 'cookie', name: 'session' },
      oauth: { type: 'oauth2', flows: {} },
    },
  },
  paths: {
    '/form': {
      post: {
        operationId: 'formRepeated',
        security: [{ queryKey: [], cookieKey: [] }],
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              example: { grant_type: 'client_credentials', scope: ['read', 'write'], note: "it's \"$HOME\" #{x} `y` \\z" },
            },
          },
        },
        responses: { 200: { description: 'ok', content: { 'application/json': { example: {} } } } },
      },
    },
    '/text': {
      put: {
        operationId: 'rawText',
        security: [{ oauth: [] }],
        parameters: [
          { name: 'tags', in: 'query', required: true, explode: false, schema: { type: 'array', items: { type: 'string' } }, example: ['a', 'b'] },
          { name: 'ids', in: 'query', required: true, schema: { type: 'array', items: { type: 'integer' } }, example: [1, 2] },
          { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' }, example: 'a"b' },
          { name: 'locale', in: 'cookie', required: true, schema: { type: 'string' }, example: 'en' },
        ],
        requestBody: { content: { 'text/plain': { example: 'line one\nit\'s "quoted" $x #{y} """ `z`' } } },
        responses: { 204: { description: 'none' } },
      },
    },
    '/upload': {
      patch: {
        operationId: 'rawBinary',
        requestBody: { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
        responses: { 200: { description: 'ok', content: { 'text/csv': { example: 'a,b' } } } },
      },
    },
    '/json': {
      delete: {
        operationId: 'jsonEscapes',
        requestBody: {
          content: {
            'application/vnd.edge+json': {
              example: { text: 'it\'s "quoted" $x #{y} """ `z` \\ back\nnewline', empty: {}, list: [], nil: null, ok: true, n: 1.5 },
            },
          },
        },
        responses: { 200: { description: 'ok' } },
      },
    },
    '/multi': {
      post: {
        operationId: 'multipartNoFile',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties: { a: { type: 'string', example: '@not-a-file' }, b: { type: 'array', items: { type: 'string' } } } },
              example: { a: '@not-a-file', b: ['x', 'y'] },
            },
          },
        },
        responses: { 200: { description: 'ok', content: { 'application/json': { example: {} } } } },
      },
    },
  },
};
const edgeModel = buildModel(EDGE_SPEC);

// ---------------------------------------------------------------------------
// Behaviour on representative demo operations
// ---------------------------------------------------------------------------

test('generates every client in the documented tab order', () => {
  assert.deepEqual(
    SNIPPET_LANGUAGES.map((lang) => lang.id),
    ['curl', 'httpie', 'javascript', 'guzzle', 'laravel', 'php', 'python', 'httpx', 'go', 'ruby', 'java', 'csharp'],
  );
  const snippets = snippetsFor('getStation');
  for (const { id } of SNIPPET_LANGUAGES) assert.ok(snippets[id]?.length > 0, `${id} snippet is non-empty`);
});

test('language ids never end in "-<another id>" (tab memory matches by suffix)', () => {
  const ids = SNIPPET_LANGUAGES.map((lang) => lang.id);
  for (const a of ids) for (const b of ids) if (a !== b) assert.ok(!`x-${a}`.endsWith(`-${b}`), `${a} vs ${b}`);
});

test('createPayment sends bearer token AND X-API-Key (one alternative, both schemes)', () => {
  const s = snippetsFor('createPayment');
  assert.match(s.curl, /-H "Authorization: Bearer \$API_TOKEN"/);
  assert.match(s.curl, /-H "X-API-Key: \$API_KEY"/);
  assert.match(s.httpie, /"Authorization:Bearer \$API_TOKEN"/);
  assert.match(s.javascript, /Authorization: `Bearer \$\{process\.env\.API_TOKEN\}`/);
  assert.match(s.javascript, /"X-API-Key": process\.env\.API_KEY/);
  assert.match(s.laravel, /Http::withToken\(env\('API_TOKEN'\)\)/);
  assert.match(s.laravel, /'X-API-Key' => env\('API_KEY'\)/);
  assert.match(s.guzzle, /'X-API-Key' => getenv\('API_KEY'\)/);
  assert.match(s.python, /"X-API-Key": os\.environ\["API_KEY"\]/);
  assert.match(s.go, /req\.Header\.Set\("X-API-Key", os\.Getenv\("API_KEY"\)\)/);
  assert.match(s.ruby, /request\["X-API-Key"\] = ENV\["API_KEY"\]/);
  assert.match(s.java, /\.header\("X-API-Key", System\.getenv\("API_KEY"\)\)/);
  assert.match(s.csharp, /AuthenticationHeaderValue\("Bearer", Environment\.GetEnvironmentVariable\("API_TOKEN"\)\)/);
  // Required header parameter with its example value.
  assert.match(s.curl, /-H "Idempotency-Key: [0-9a-f-]+"/);
});

test('getRevenueReport uses basic auth (first alternative), not the query key', () => {
  const s = snippetsFor('getRevenueReport');
  assert.match(s.curl, /-u "\$API_USER:\$API_PASSWORD"/);
  assert.match(s.httpie, /-a "\$API_USER:\$API_PASSWORD"/);
  assert.match(s.guzzle, /'auth' => \[getenv\('API_USER'\), getenv\('API_PASSWORD'\)\]/);
  assert.match(s.laravel, /Http::withBasicAuth\(env\('API_USER'\), env\('API_PASSWORD'\)\)/);
  assert.match(s.php, /CURLOPT_USERPWD/);
  assert.match(s.python, /auth=\(os\.environ\["API_USER"\], os\.environ\["API_PASSWORD"\]\)/);
  assert.match(s.httpx, /auth=\(os\.environ\["API_USER"\], os\.environ\["API_PASSWORD"\]\)/);
  assert.match(s.go, /req\.SetBasicAuth\(os\.Getenv\("API_USER"\), os\.Getenv\("API_PASSWORD"\)\)/);
  assert.match(s.ruby, /request\.basic_auth\(ENV\["API_USER"\], ENV\["API_PASSWORD"\]\)/);
  assert.match(s.java, /Base64\.getEncoder\(\)/);
  assert.match(s.csharp, /AuthenticationHeaderValue\("Basic"/);
  assert.match(s.javascript, /"Basic " \+ btoa\(/);
  for (const [id, code] of Object.entries(s)) {
    assert.doesNotMatch(code, /api_key|API_KEY|Bearer/, `${id} must not include the second alternative`);
  }
  assert.match(s.curl, /\?month=2087-03"/, 'required query parameter is in the URL');
});

test('listStations is public: no credentials in any snippet', () => {
  for (const [id, code] of Object.entries(snippetsFor('listStations'))) {
    assert.doesNotMatch(code, /Authorization|API_TOKEN|ACCESS_TOKEN|API_KEY|API_USER|withToken|basic_auth|SetBasicAuth/i, id);
  }
});

test('oauth2 operations use $ACCESS_TOKEN', () => {
  const s = snippetsFor('exportBookings');
  assert.match(s.curl, /Authorization: Bearer \$ACCESS_TOKEN/);
  assert.match(s.laravel, /withToken\(env\('ACCESS_TOKEN'\)\)/);
});

test('createAccessToken sends the primary (JSON) content', () => {
  const s = snippetsFor('createAccessToken');
  assert.match(s.curl, /-H "Content-Type: application\/json"/);
  assert.match(s.curl, /-d '\{/);
  assert.match(s.javascript, /body: JSON\.stringify\(\{/);
  assert.match(s.guzzle, /'json' => \[/);
  assert.match(s.python, /json=\{/);
  assert.match(s.go, /strings\.NewReader\(`\{/);
  assert.match(s.ruby, /JSON\.generate\(\{/);
  assert.match(s.java, /BodyPublishers\.ofString\("""/);
  assert.match(s.csharp, /new StringContent\("""/);
  assert.doesNotMatch(s.curl, /--data-urlencode/);
});

test('uploadPassengerDocument sends multipart with a file upload', () => {
  const s = snippetsFor('uploadPassengerDocument');
  assert.match(s.curl, /-F 'file=@\.\/file\.pdf'/);
  assert.match(s.curl, /-F 'kind=passport'/);
  assert.doesNotMatch(s.curl, /Content-Type: multipart/, 'curl sets the boundary itself');
  assert.match(s.httpie, /--multipart POST/);
  assert.match(s.httpie, /'file@\.\/file\.pdf'/);
  assert.match(s.javascript, /form\.append\("file", await openAsBlob\("\.\/file\.pdf"\)/);
  assert.match(s.guzzle, /'multipart' => \[/);
  assert.match(s.guzzle, /fopen\('\.\/file\.pdf', 'r'\)/);
  assert.match(s.laravel, /->attach\('file', fopen\('\.\/file\.pdf', 'r'\), 'file\.pdf'\)/);
  assert.match(s.php, /new CURLFile\('\.\/file\.pdf'\)/);
  assert.match(s.python, /files=\{\n\s+"file": open\("\.\/file\.pdf", "rb"\)/);
  assert.match(s.go, /writer\.CreateFormFile\("file"/);
  assert.match(s.ruby, /\["file", File\.open\("\.\/file\.pdf"\)\]/);
  assert.match(s.java, /Files\.readAllBytes\(Path\.of\("\.\/file\.pdf"\)\)/);
  assert.match(s.csharp, /new StreamContent\(File\.OpenRead\("\.\/file\.pdf"\)\), "file", "file\.pdf"/);
});

test('createBooking: x-codeSamples come first, first tab checked, ids stable', () => {
  const html = requestPanel(model, endpoint('createBooking'));
  const labels = [...html.matchAll(/<label class="code-tab" for="([^"]+)">([^<]*)<\/label>/g)].map((m) => [m[1], m[2]]);
  assert.equal(labels.length, 14, 'capped at 14 tabs');
  assert.deepEqual(labels[0], ['req-createbooking-x-0', 'cURL']);
  assert.deepEqual(labels[1], ['req-createbooking-x-1', 'PHP (Guzzle)']);
  assert.equal(labels[2][0], 'req-createbooking-curl');
  assert.equal(labels.at(-1)[0], 'req-createbooking-csharp');
  const checked = [...html.matchAll(/id="([^"]+)" checked/g)].map((m) => m[1]);
  assert.deepEqual(checked, ['req-createbooking-x-0']);
  assert.match(html, /ORBIT_TOKEN/, 'custom sample source is rendered');
});

test('panels without x-codeSamples start with cURL', () => {
  const html = requestPanel(model, endpoint('getStation'));
  assert.match(html, /id="req-getstation-curl" checked/);
});

test('edge cases: form repeats, query styles, cookies, raw bodies', () => {
  const by = (id) => buildSnippets(edgeModel.endpoints.find((e) => e.id === id), edgeModel.baseUrl);
  const form = by('formRepeated');
  assert.match(form.curl, /"https:\/\/edge\.example\/v1\/form\?api_key=\$API_KEY"/);
  assert.match(form.curl, /-H "Cookie: session=\$SESSION"/, "second apiKey gets its own env var");
  assert.match(form.curl, /--data-urlencode 'scope=read' \\\n {2}--data-urlencode 'scope=write'/);
  assert.match(form.javascript, /new URLSearchParams\(\[/);
  const text = by('rawText');
  assert.match(text.curl, /\?tags=a,b&ids=1&ids=2"/, 'explode=false joins, default form explodes');
  assert.match(text.curl, /-H "Cookie: locale=en"/);
  assert.match(text.curl, /-H "Content-Type: text\/plain"/);
  assert.match(text.curl, /Authorization: Bearer \$ACCESS_TOKEN/);
  assert.match(by('rawBinary').curl, /--data-binary '@\.\/file\.bin'/);
  assert.match(by('multipartNoFile').curl, /--form-string 'a=@not-a-file'/);
});

// ---------------------------------------------------------------------------
// Syntax smoke tests across every operation (demo + edge cases)
// ---------------------------------------------------------------------------

const ALL = [
  ...[...model.endpoints, ...model.endpoints.flatMap((e) => e.callbacks.map((c) => c.operation))].map((e) => ({
    name: e.id,
    snippets: buildSnippets(e, model.baseUrl),
  })),
  ...edgeModel.endpoints.map((e) => ({ name: `edge:${e.id}`, snippets: buildSnippets(e, edgeModel.baseUrl) })),
];

function has(binary, args = ['--version']) {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  return !result.error;
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-snippets-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes one file per operation and runs `check(files)`; failures name the operation. */
function checkAll(lang, ext, transform, check) {
  withTempDir((dir) => {
    const files = ALL.map(({ name, snippets }, index) => {
      const file = join(dir, `${transform.fileName?.(index) ?? `s${index}`}.${ext}`);
      writeFileSync(file, transform.source(snippets[lang], index));
      return { name, file };
    });
    check(files);
  });
}

function assertEach(files, run) {
  const failures = [];
  for (const { name, file } of files) {
    const result = run(file);
    if (result.status !== 0) failures.push(`${name}:\n${result.stderr || result.stdout}`);
  }
  assert.deepEqual(failures, []);
}

test('JavaScript snippets parse (node --check, ES module with top-level await)', () => {
  checkAll('javascript', 'mjs', { source: (code) => code }, (files) =>
    assertEach(files, (file) => spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })),
  );
});

for (const lang of ['curl', 'httpie']) {
  test(`${lang} snippets parse (bash -n)`, { skip: !has('bash') && 'bash not installed' }, () => {
    checkAll(lang, 'sh', { source: (code) => code }, (files) =>
      assertEach(files, (file) => spawnSync('bash', ['-n', file], { encoding: 'utf8' })),
    );
  });
}

for (const lang of ['guzzle', 'laravel', 'php']) {
  test(`${lang} snippets parse (php -l)`, { skip: !has('php') && 'php not installed' }, () => {
    // The Laravel sample is meant to be pasted into a PHP file, so it has no open tag.
    const source = (code) => (code.startsWith('<?php') ? code : `<?php\n${code}`);
    checkAll(lang, 'php', { source }, (files) =>
      assertEach(files, (file) => spawnSync('php', ['-l', file], { encoding: 'utf8' })),
    );
  });
}

for (const lang of ['python', 'httpx']) {
  test(`${lang} snippets parse (python3 -m py_compile)`, { skip: !has('python3') && 'python3 not installed' }, () => {
    checkAll(lang, 'py', { source: (code) => code }, (files) =>
      assertEach(files, (file) => spawnSync('python3', ['-m', 'py_compile', file], { encoding: 'utf8' })),
    );
  });
}

test('Ruby snippets parse (ruby -c)', { skip: !has('ruby') && 'ruby not installed' }, () => {
  checkAll('ruby', 'rb', { source: (code) => code }, (files) =>
    assertEach(files, (file) => spawnSync('ruby', ['-c', file], { encoding: 'utf8' })),
  );
});

test('Go snippets parse (gofmt -e)', { skip: !has('gofmt', ['-h']) && 'gofmt not installed' }, () => {
  checkAll('go', 'go', { source: (code) => code }, (files) =>
    assertEach(files, (file) => spawnSync('gofmt', ['-e', file], { encoding: 'utf8' })),
  );
});

test('Java snippets compile (javac)', { skip: !has('javac') && 'javac not installed', timeout: 120_000 }, () => {
  // Imports stay at the top; the statements go into main().
  const source = (code, index) => {
    const lines = code.split('\n');
    const imports = lines.filter((line) => line.startsWith('import '));
    const body = lines.filter((line) => !line.startsWith('import '));
    return `${imports.join('\n')}\n\nclass S${index} {\n  public static void main(String[] args) throws Exception {\n${body.join('\n')}\n  }\n}\n`;
  };
  checkAll('java', 'java', { source, fileName: (index) => `S${index}` }, (files) => {
    const out = join(files[0].file, '..', 'out');
    const result = spawnSync('javac', ['-d', out, ...files.map((f) => f.file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
});

test('C# snippets compile (dotnet)', { skip: 'no lightweight C# syntax checker; dotnet build is too heavy for a unit test' }, () => {});
