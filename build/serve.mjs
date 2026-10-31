import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeBase } from './url.mjs';
import { createDocsMcp } from './mcp.mjs';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
// Mirrors the build's --base so a sub-path build can be previewed as deployed.
const BASE = normalizeBase(process.env.BASE ?? '');
// The docs are an MCP server too (POST /mcp), exactly as the Laravel package
// serves it — so editor integrations can be tried against the preview.
const mcp = createDocsMcp({ dist: DIST, base: BASE, siteUrl: `http://localhost:${PORT}` });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (BASE) {
      if (path === BASE) path = '/';
      else if (path.startsWith(`${BASE}/`)) path = path.slice(BASE.length);
      else throw new Error('outside base');
    }
    if (path === '/mcp') {
      const answer = await mcp.http(request.method, await readBody(request));
      response.writeHead(answer.status, answer.headers);
      response.end(answer.body);
      return;
    }
    // Containment by construction: the resolved target must stay inside dist.
    let file = resolve(DIST, `.${path}`);
    if (file !== DIST && !file.startsWith(DIST + sep)) throw new Error('outside dist');
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      if (!path.endsWith('/')) {
        response.writeHead(301, { Location: `${BASE}${path}/` });
        response.end();
        return;
      }
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Preview: http://localhost:${PORT}${BASE}/`);
  console.log(`MCP:     http://localhost:${PORT}${BASE}/mcp`);
});

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
