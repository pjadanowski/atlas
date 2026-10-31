/**
 * Docs MCP server (Model Context Protocol, Streamable HTTP, stateless).
 *
 * The generated site doubles as an MCP server: an editor assistant (VS Code,
 * Cursor, Claude Code, …) connects to <docs>/mcp and can search the API and
 * read endpoint and model pages while writing code. Nothing here executes
 * API calls — this is documentation access, not a proxy.
 *
 * Everything the server answers with is already in the build output: the
 * search index, the markdown twin of every page, and a small manifest. So the
 * runtime is a thin JSON-RPC layer over static files, which is why the
 * Laravel package can offer the identical endpoint from PHP.
 *
 * `mcpManifest()` runs at build time; `createDocsMcp()` serves at runtime
 * (build/serve.mjs uses it for the local preview).
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { slugify } from './text.mjs';
import { url } from './url.mjs';
// Side-effect import: the browser bundle and this server share one engine,
// exposed as a global because the file is also concatenated into an IIFE.
import '../assets/search/10-engine.js';

// Index entries that are pages but not operations (see build/search.mjs).
const NON_OPERATIONS = new Set(['SCHEMA', 'TAG']);

const engine = globalThis.AtlasSearch;

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_NAME = 'atlas-docs';
const SERVER_VERSION = '1.0.0';
const PLACEHOLDER_ORIGIN = 'https://docs.example.com';

/** Written to assets/mcp-manifest.json; what `initialize` describes the API with. */
export function mcpManifest(model) {
  return {
    name: `${slugify(model.title)}-docs`,
    title: model.title,
    version: model.version,
    baseUrl: model.baseUrl,
    spec: url('/openapi.json'),
    llms: url('/llms.txt'),
    endpoints: model.endpoints.length,
    models: model.models.length,
    tags: [...new Set(model.endpoints.map((endpoint) => endpoint.tag))],
  };
}

/** Client configuration snippets shown in the "Connect an AI assistant" dialog. */
export function mcpClientSnippets(model) {
  const name = `${slugify(model.title)}-docs`;
  const endpoint = `${PLACEHOLDER_ORIGIN}${url('/mcp')}`;
  return {
    origin: PLACEHOLDER_ORIGIN,
    endpoint,
    name,
    vscode: JSON.stringify({ servers: { [name]: { type: 'http', url: endpoint } } }, null, 2),
    cursor: JSON.stringify({ mcpServers: { [name]: { url: endpoint } } }, null, 2),
    claudeCode: `claude mcp add --transport http ${name} ${endpoint}`,
    generic: JSON.stringify({ mcpServers: { [name]: { type: 'http', url: endpoint } } }, null, 2),
  };
}

/**
 * @param {object} options
 * @param {string} options.dist   directory holding the generated site
 * @param {string} [options.base] sub-path the site is served from ("/docs/api")
 * @param {string} [options.siteUrl] absolute origin to prefix page links with
 */
export function createDocsMcp({ dist, base = '', siteUrl = '' }) {
  const DIST = resolve(dist);
  let cache = { stamp: null, index: null, prepared: null, manifest: null };

  async function data() {
    const indexFile = join(DIST, 'assets', 'search-index.json');
    const stamp = (await stat(indexFile)).mtimeMs;
    if (cache.stamp !== stamp) {
      const index = JSON.parse(await readFile(indexFile, 'utf8'));
      const manifest = JSON.parse(await readFile(join(DIST, 'assets', 'mcp-manifest.json'), 'utf8'));
      cache = { stamp, index, prepared: engine.prepare(index), manifest };
    }
    return cache;
  }

  function absolute(href) {
    return `${siteUrl}${href}`;
  }

  /** Markdown file behind a page href; the href carries the base prefix. */
  async function markdown(href) {
    let path = href;
    if (base && path.startsWith(base)) path = path.slice(base.length);
    const file = resolve(DIST, `.${path}`, 'index.md');
    if (!file.startsWith(DIST + sep)) return null;
    return readFile(file, 'utf8').catch(() => null);
  }

  const tools = [
    {
      name: 'search_api',
      description:
        'Search the API documentation: endpoints and data models, by name, path, description, parameter names and operationId. Typo tolerant. Returns the best matches with links to their documentation.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free text, e.g. "list bank accounts" or "kunden adresse"' },
          limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'list_endpoints',
      description: 'List every endpoint (method, path, title, operationId), grouped by tag. Optionally only one tag.',
      inputSchema: {
        type: 'object',
        properties: { tag: { type: 'string', description: 'Exact tag name to filter by' } },
      },
    },
    {
      name: 'get_endpoint',
      description:
        'Full documentation of one endpoint as markdown: parameters, request body, responses with examples. Identify it by operationId, or by method and path.',
      inputSchema: {
        type: 'object',
        properties: {
          operationId: { type: 'string' },
          method: { type: 'string', description: 'GET, POST, …' },
          path: { type: 'string', description: 'Path as documented, e.g. /api/v1/kunden/{id}' },
        },
      },
    },
    {
      name: 'get_model',
      description: 'Documentation of one data model (schema): fields, types, required flags, example JSON.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Schema name, e.g. Kunde' } },
        required: ['name'],
      },
    },
  ];

  async function callTool(name, args = {}) {
    const { index, prepared, manifest } = await data();
    switch (name) {
      case 'search_api': {
        const query = String(args.query ?? '').trim();
        if (!query) throw invalidParams('query is required');
        const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
        const results = engine.search(prepared, query, limit);
        if (results.length === 0) return text(`No results for "${query}".`);
        return text(
          results
            .map(({ entry }) =>
              [
                `${entry.m} ${entry.p || entry.t} — ${entry.t} [${entry.g}]`,
                `  id: ${entry.o} · docs: ${absolute(entry.h)}index.md`,
                entry.s ? `  ${entry.s}` : null,
              ]
                .filter(Boolean)
                .join('\n'),
            )
            .join('\n\n'),
        );
      }
      case 'list_endpoints': {
        const tag = args.tag ? String(args.tag) : null;
        const endpoints = index.filter((entry) => !NON_OPERATIONS.has(entry.m) && (!tag || entry.g === tag));
        if (endpoints.length === 0) {
          return text(`No endpoints${tag ? ` tagged "${tag}"` : ''}. Tags: ${manifest.tags.join(', ')}`);
        }
        const groups = new Map();
        for (const entry of endpoints) {
          if (!groups.has(entry.g)) groups.set(entry.g, []);
          groups.get(entry.g).push(`${entry.m} ${entry.p} — ${entry.t} (${entry.o})`);
        }
        return text([...groups].map(([group, lines]) => `## ${group}\n${lines.join('\n')}`).join('\n\n'));
      }
      case 'get_endpoint': {
        const id = args.operationId ? String(args.operationId).toLowerCase() : null;
        const method = args.method ? String(args.method).toUpperCase() : null;
        const path = args.path ? String(args.path).replace(/\/$/, '') : null;
        if (!id && !(method && path)) throw invalidParams('Pass operationId, or method and path');
        const entry = index.find(
          (candidate) =>
            !NON_OPERATIONS.has(candidate.m) &&
            (id
              ? candidate.o.toLowerCase() === id
              : candidate.m === method && candidate.p.replace(/\/$/, '') === path),
        );
        if (!entry) {
          const hint = engine
            .search(prepared, [args.operationId, args.method, args.path].filter(Boolean).join(' '), 5)
            .map(({ entry: near }) => `${near.m} ${near.p} (${near.o})`);
          return text(`Endpoint not found.${hint.length ? ` Did you mean:\n${hint.join('\n')}` : ''}`, true);
        }
        const body = await markdown(entry.h);
        return text(`${body ?? `# ${entry.t}\n\n${entry.m} ${entry.p}`}\nPage: ${absolute(entry.h)}\n`);
      }
      case 'get_model': {
        const wanted = String(args.name ?? '').trim().toLowerCase();
        if (!wanted) throw invalidParams('name is required');
        const entry = index.find((candidate) => candidate.m === 'SCHEMA' && candidate.o.toLowerCase() === wanted);
        if (!entry) {
          const hint = engine
            .search(prepared, String(args.name), 25)
            .filter(({ entry: near }) => near.m === 'SCHEMA')
            .slice(0, 5)
            .map(({ entry: near }) => near.o);
          return text(`Model not found.${hint.length ? ` Did you mean: ${hint.join(', ')}` : ''}`, true);
        }
        const body = await markdown(entry.h);
        return text(`${body ?? `# ${entry.t}`}\nPage: ${absolute(entry.h)}\n`);
      }
      default:
        throw rpcError(-32602, `Unknown tool: ${name}`);
    }
  }

  /** One JSON-RPC message in, one response out (null for notifications). */
  async function handle(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return response(message?.id ?? null, null, rpcError(-32600, 'Invalid request'));
    }
    const { id, method, params = {} } = message;
    const isNotification = id === undefined;
    try {
      let result;
      switch (method) {
        case 'initialize': {
          const { manifest } = await data();
          const requested = String(params.protocolVersion ?? '');
          result = {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, title: `${manifest.title} documentation`, version: SERVER_VERSION },
            instructions:
              `Documentation for ${manifest.title} v${manifest.version} (base URL ${manifest.baseUrl}): ` +
              `${manifest.endpoints} endpoints, ${manifest.models} models. ` +
              'Use search_api to find endpoints, get_endpoint for parameters and examples, get_model for data shapes. ' +
              `The full OpenAPI document is at ${absolute(manifest.spec)}.`,
          };
          break;
        }
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          result = { tools };
          break;
        case 'tools/call':
          result = await callTool(params.name, params.arguments ?? {});
          break;
        default:
          if (method.startsWith('notifications/')) return null;
          throw rpcError(-32601, `Method not found: ${method}`);
      }
      return isNotification ? null : response(id, result);
    } catch (error) {
      if (isNotification) return null;
      const known = error && typeof error.code === 'number';
      return response(id, null, known ? error : rpcError(-32603, error?.message ?? 'Internal error'));
    }
  }

  /**
   * Streamable HTTP transport, stateless variant: every POST carries one
   * message (or a batch) and gets a plain JSON answer; no sessions, no SSE.
   * Returns {status, headers, body} so any HTTP server can adapt it.
   */
  async function http(method, bodyText) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
    };
    if (method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
    if (method !== 'POST') {
      return { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' }, body: 'MCP endpoint: POST JSON-RPC messages here.' };
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return json(400, response(null, null, rpcError(-32700, 'Parse error')), cors);
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const answers = (await Promise.all(messages.map(handle))).filter(Boolean);
    if (answers.length === 0) return { status: 202, headers: cors, body: '' };
    return json(200, Array.isArray(parsed) ? answers : answers[0], cors);
  }

  return { tools, callTool, handle, http };
}

function text(value, isError = false) {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function response(id, result, error) {
  return error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result };
}

function rpcError(code, message) {
  return { code, message };
}

function invalidParams(message) {
  return rpcError(-32602, message);
}

function json(status, payload, headers) {
  return {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}
