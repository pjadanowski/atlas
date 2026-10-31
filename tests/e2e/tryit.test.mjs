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
import { createHash } from 'node:crypto';
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
const skip = !CHROME || typeof WebSocket === 'undefined' || !existsSync(join(ROOT, 'dist', 'index.html'))
  ? 'needs Chrome, Node 22+ (global WebSocket) and a built dist/'
  : false;

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
      if (request.url === '/sts') {
        // A WS-Trust STS: issues a security context token to a valid user.
        const ok = /<wsse:Username>ada<\/wsse:Username>/.test(body) && /PasswordText">secret</.test(body) && /RequestSecurityToken/.test(body);
        response.setHeader('Content-Type', 'text/xml');
        return response.end(ok
          ? '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><wst:RequestSecurityTokenResponse xmlns:wst="http://docs.oasis-open.org/ws-sx/ws-trust/200512"><wst:RequestedSecurityToken><wsc:SecurityContextToken xmlns:wsc="http://docs.oasis-open.org/ws-sx/ws-secureconversation/200512"><wsc:Identifier>urn:uuid:sct-42</wsc:Identifier></wsc:SecurityContextToken></wst:RequestedSecurityToken></wst:RequestSecurityTokenResponse></s:Body></s:Envelope>'
          : '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>bad credentials</faultstring></s:Fault></s:Body></s:Envelope>');
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body, wsse: verifyWsse(body) }));
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
  // Chrome's helpers may still be flushing the profile for a moment; a
  // leftover temp dir must not fail the suite.
  try {
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* ignore */
  }
});

/**
 * Server-side check of a UsernameToken PasswordDigest, as a WS-Security
 * service would do it: Base64(SHA-1(nonce + created + password)).
 */
function verifyWsse(body) {
  const digest = /PasswordDigest">([^<]+)</.exec(body)?.[1];
  const nonce = /<wsse:Nonce[^>]*>([^<]+)</.exec(body)?.[1];
  const created = /<wsse:UsernameToken[\s\S]*?<wsu:Created>([^<]+)</.exec(body)?.[1];
  if (!digest || !nonce || !created) return 'no-digest';
  const expected = createHash('sha1').update(Buffer.concat([Buffer.from(nonce, 'base64'), Buffer.from(created), Buffer.from('secret')])).digest('base64');
  return expected === digest ? 'digest-valid' : 'digest-INVALID';
}

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
async function sendTryIt(path, { auth, server, wsse = {} }) {
  await open(path);
  await evaluate(`localStorage.clear();
    localStorage.setItem('atlas:wsse', ${JSON.stringify(JSON.stringify(wsse))});
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
    // The runtime is lazy-loaded on first open; submitting before it is in
    // place would fall through to a native form submit.
    await wait(() => window.__tryitReady === true);
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
    await new Promise((resolve) => {
      const tick = () => (window.__tryitReady === true ? resolve() : setTimeout(tick, 50));
      tick();
    });
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

test('SOAP operations send the envelope with SOAPAction and an XML content type', { skip }, async () => {
  const text = await sendTryIt('/soap-legacybooking/legacybooking-reserveseats/', { auth: {} });
  const response = echoed(text);
  // The viewer shows the echoed JSON with escaped quotes: \"…\".
  assert.match(text, /soapaction: "\\"urn:orbit:legacy:ReserveSeats\\""/, 'quoted SOAPAction header');
  assert.match(text, /content-type: "text\/xml; charset=utf-8"/, 'SOAP 1.1 content type');
  assert.match(text, /accept: "text\/xml/, 'asks for XML back');
  assert.ok(response.has('<ob:ReserveSeats>'), 'envelope body');
  assert.match(text, /method: "POST"/);
});

test('WS-Security UsernameToken: the server can verify the password digest', { skip }, async () => {
  const text = await sendTryIt('/soap-legacybooking/legacybooking-reserveseats/', { auth: {}, wsse: { user: 'ada', pass: 'secret' } });
  assert.match(text, /wsse: "digest-valid"/, 'digest recomputed by the server matches');
  assert.match(text, /wsu:Timestamp/, 'policy asks for a Timestamp');
  assert.doesNotMatch(text, /Base64\(SHA-1/, 'the documentation placeholder header is replaced');
});

test('WS-Security without credentials sends no example header', { skip }, async () => {
  const text = await sendTryIt('/soap-legacybooking/legacybooking-getreservation/', { auth: {} });
  assert.doesNotMatch(text, /wsse:Security/);
});

test('WS-Trust: a token from the STS is placed into the next request', { skip }, async () => {
  const stsUrl = `http://localhost:${ports.api}/sts`;
  await open('/soap-legacybooking/legacybooking-cancelreservation/');
  await evaluate(`localStorage.clear(); localStorage.setItem('atlas:wsse', ${JSON.stringify(JSON.stringify({ user: 'ada', pass: 'secret', stsUrl }))});`);
  await open('/soap-legacybooking/legacybooking-cancelreservation/');
  const status = await evaluate(`(async () => {
    document.querySelector('[data-auth-open]').click();
    document.querySelector('[data-sts-request]').click();
    for (let i = 0; i < 100 && !/received|Failed|error/.test(document.querySelector('[data-sts-status]').textContent); i++) await new Promise((r) => setTimeout(r, 50));
    return document.querySelector('[data-sts-status]').textContent;
  })()`);
  assert.match(status, /Token received \(SecurityContextToken\)/);
  const stored = JSON.parse(await evaluate(`localStorage.getItem('atlas:wsse')`));
  const text = await sendTryIt('/soap-legacybooking/legacybooking-cancelreservation/', { auth: {}, wsse: stored });
  assert.match(text, /urn:uuid:sct-42/, 'issued token in wsse:Security');
  assert.match(text, /wsse: "digest-valid"/, 'plus the UsernameToken the policy also requires');
});
