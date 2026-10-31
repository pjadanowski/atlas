// End-to-end check of the try-it console in a real browser: credentials from
// the Authorize store reach the API in the shape each security scheme
// declares, and server variables build the base URL. Drives headless Chrome
// over the DevTools protocol with Node's built-in WebSocket — no dependencies.
// Skips when no Chrome binary is found. Run after `npm run build`:
//
//   node --test tests/e2e/*.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((bin) => {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
const skip = !CHROME || !existsSync(join(ROOT, 'dist', 'index.html')) ? 'needs Chrome and a built dist/' : false;

let docs;
let api;
let chrome;
let profile;
let cdp;
const ports = {};

before(async () => {
  if (skip) return;
  docs = spawn(process.execPath, [join(ROOT, 'build/serve.mjs')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  ports.docs = await new Promise((resolve) => docs.stdout.on('data', (chunk) => {
    const match = /localhost:(\d+)/.exec(String(chunk));
    if (match) resolve(Number(match[1]));
  }));

  // Echo API: returns what it received, CORS wide open (with credentials).
  api = createServer((request, response) => {
    const origin = request.headers.origin ?? '*';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] ?? '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
    if (request.method === 'OPTIONS') return response.end();
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body }));
    });
  });
  await new Promise((resolve) => api.listen(0, resolve));
  ports.api = api.address().port;

  profile = mkdtempSync(join(tmpdir(), 'atlas-e2e-'));
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const wsUrl = await new Promise((resolve) => chrome.stderr.on('data', (chunk) => {
    const match = /ws:\/\/[^\s]+/.exec(String(chunk));
    if (match) resolve(match[0]);
  }));
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  cdp = await connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
});

after(async () => {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
  }
  docs?.kill();
  api?.close();
  // Chrome's helpers may still be flushing the profile for a moment.
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  return new Promise((resolve) => socket.addEventListener('open', () => resolve({
    send(method, params = {}) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((done, fail) => pending.set(id, { resolve: done, reject: fail }));
    },
    once(method) {
      return new Promise((done) => {
        const listener = (message) => {
          if (message.method === method) {
            listeners.delete(listener);
            done(message.params);
          }
        };
        listeners.add(listener);
      });
    },
    close: () => socket.close(),
  })));
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function open(path) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `http://localhost:${ports.docs}${path}` });
  await loaded;
}

/** Opens the page's try-it drawer, sends it, returns the echoed request. */
async function sendTryIt(path, { auth, server }) {
  await open(path);
  await evaluate(`localStorage.clear();
    localStorage.setItem('atlas:auth', ${JSON.stringify(JSON.stringify(auth))});
    localStorage.setItem('tryit:server', ${JSON.stringify(server ?? `http://localhost:${ports.api}`)});`);
  await open(path);
  return evaluate(`(async () => {
    document.querySelector('[data-tryit-open]').click();
    const wait = (test) => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => test() ? resolve() : Date.now() - started > 5000 ? reject(new Error('timeout')) : setTimeout(tick, 50);
      tick();
    });
    await wait(() => window.atlasTryitReady || document.querySelector('[data-tryit] .tryit-form'));
    await new Promise((r) => setTimeout(r, 300));
    const panel = document.querySelector('[data-tryit]');
    panel.querySelector('[data-tryit-fill]')?.click();
    panel.querySelector('.tryit-form').requestSubmit();
    try {
      await wait(() => panel.querySelector('[data-tryit-response]').textContent.includes('method'));
    } catch {
      throw new Error('no echo; server=' + panel.querySelector('[data-t="server"]').value + ' response=' + panel.querySelector('[data-tryit-response]').textContent.slice(0, 300));
    }
    const text = panel.querySelector('[data-tryit-response]').textContent;
    return text;
  })()`);
}

function echoed(text) {
  // The response viewer renders a JSON tree; pull the values back out.
  return {
    has: (needle) => text.includes(needle),
    text,
  };
}

test('bearer + API key header are both sent when an operation requires both', { skip }, async () => {
  const text = await sendTryIt('/payments/createpayment/', {
    auth: { bearerAuth: { token: 'tok-123' }, apiKeyHeader: { key: 'key-456' } },
  });
  const response = echoed(text);
  assert.ok(response.has('Bearer tok-123'), 'Authorization bearer header');
  assert.ok(response.has('key-456'), 'X-API-Key header');
});

test('falls back to the next alternative that is configured (API key in query)', { skip }, async () => {
  const text = await sendTryIt('/reports/getrevenuereport/', { auth: { apiKeyQuery: { key: 'q-789' } } });
  assert.ok(echoed(text).has('api_key=q-789'), 'api_key query parameter');
});

test('basic auth is base64-encoded', { skip }, async () => {
  const text = await sendTryIt('/reports/getrevenuereport/', { auth: { basicAuth: { user: 'ada', pass: 'secret' } } });
  assert.ok(echoed(text).has(`Basic ${Buffer.from('ada:secret').toString('base64')}`));
});

test('public endpoints send no credentials even when some are stored', { skip }, async () => {
  const text = await sendTryIt('/stations/liststations/', { auth: { bearerAuth: { token: 'tok-123' } } });
  assert.ok(!echoed(text).has('tok-123'));
});

test('server variables are substituted into the base URL', { skip }, async () => {
  await open('/stations/liststations/');
  await evaluate('localStorage.clear()');
  await open('/stations/liststations/');
  const url = await evaluate(`(async () => {
    document.querySelector('[data-tryit-open]').click();
    await new Promise((r) => setTimeout(r, 600));
    const panel = document.querySelector('[data-tryit]');
    const select = panel.querySelector('[data-server-select]');
    const templated = [...select.options].find((option) => option.dataset.template);
    select.value = templated.value;
    select.dispatchEvent(new Event('change'));
    const region = panel.querySelector('[data-server-var="region"]');
    region.value = 'mars';
    region.dispatchEvent(new Event('change'));
    return panel.querySelector('[data-t="server"]').value;
  })()`);
  assert.equal(url, 'https://mars.api.orbit.example/v2');
});
