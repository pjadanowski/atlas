import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { loadSpec } from './spec.mjs';
import { buildModel } from './model.mjs';
import { configureText } from './text.mjs';
import { configureBase, url } from './url.mjs';
import { buildSearchIndex } from './search.mjs';
import { pageShell } from './render/layout.mjs';
import { endpointContent } from './render/endpoint.mjs';
import { endpointCodeColumn, homeCodeColumn, webhookCodeColumn } from './render/codecol.mjs';
import { tryItDrawer } from './render/tryit.mjs';
import { homeContent, tagContent } from './render/home.mjs';
import { modelContent, modelCodeColumn, modelsIndexContent } from './render/models.mjs';
import { endpointMarkdown, llmsIndex, modelMarkdown } from './markdown.mjs';
import { mcpManifest } from './mcp.mjs';
import { themeCss } from './themes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Vendored (SIL OFL, licenses alongside the files) rather than pulled from
// node_modules: the generator ships inside a Composer package, where no npm
// install ever runs.
const FONT_FILES = ['instrument-sans.woff2', 'jetbrains-mono.woff2'];

/**
 * Generates the whole site. Parameterized so other hosts (CLI flags today,
 * a Laravel/Scramble package tomorrow) can point it at any spec and output
 * directory without touching this file.
 */
export async function buildDocs({
  spec: specPath = 'openapi.json',
  out = 'dist',
  lang = 'en',
  base = '',
  allowSpecHtml = false,
  css = [],
  js = [],
  theme = 'default',
  logo = '',
  favicon = '',
  title = '',
} = {}) {
  const started = performance.now();
  const DIST = absolute(out);
  const ASSETS = join(ROOT, 'assets');

  const spec = await loadSpec(absolute(specPath));
  const model = buildModel(spec);
  model.lang = lang;
  if (title) model.title = title;
  configureText({ baseUrl: model.baseUrl, allowHtml: allowSpecHtml });
  const mountedAt = configureBase(base);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 'assets', 'fonts'), { recursive: true });

  // Bundles first: their content hashes become the filenames referenced by
  // every page, so returning visitors never see stale assets after a deploy.
  const bundles = {
    css: minifyCss(`${await bundle(join(ASSETS, 'css'), '.css')}\n${themeCss(theme)}`),
    js: await bundle(join(ASSETS, 'js'), '.js'),
    searchJs: await bundle(join(ASSETS, 'search'), '.js'),
    tryitJs: await bundle(join(ASSETS, 'tryit'), '.js'),
    tryitCss: minifyCss(await bundle(join(ASSETS, 'tryit-css'), '.css')),
  };
  // Site-root paths double as the on-disk location; `assets` holds the same
  // files as URLs, which carry the mount prefix when one is configured.
  const files = {
    css: `/assets/app.${hash(bundles.css)}.css`,
    js: `/assets/app.${hash(bundles.js)}.js`,
    searchJs: `/assets/search.${hash(bundles.searchJs)}.js`,
    tryitJs: `/assets/tryit.${hash(bundles.tryitJs)}.js`,
    tryitCss: `/assets/tryit.${hash(bundles.tryitCss)}.css`,
  };
  for (const [name, file] of Object.entries(files)) {
    await writeFile(join(DIST, file.slice(1)), bundles[name]);
  }
  const assets = Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, url(file)]),
  );
  assets.searchIndex = url('/assets/search-index.json');

  // Branding: a logo replaces the accent square in the top bar, a favicon
  // the generated one. Local files are copied and content-hashed; URLs are
  // used as given.
  for (const [key, source] of [['logo', logo], ['favicon', favicon]]) {
    if (!source) continue;
    if (/^(https?:)?\/\//.test(source) || source.startsWith('data:')) {
      assets[key] = source;
      continue;
    }
    const content = await readFile(absolute(source));
    const file = `/assets/${key}.${hash(content)}${extname(source)}`;
    await writeFile(join(DIST, file.slice(1)), content);
    assets[key] = url(file);
  }

  // Operator-supplied overrides, kept out of the main bundles so their hashes
  // stay stable and a broken custom file is obvious in the network panel.
  // Loaded last, which is what lets them override anything above.
  const customCss = minifyCss(await concatFiles(css));
  const customJs = await concatFiles(js);
  if (customCss) {
    const file = `/assets/custom.${hash(customCss)}.css`;
    await writeFile(join(DIST, file.slice(1)), customCss);
    assets.customCss = url(file);
  }
  if (customJs) {
    const file = `/assets/custom.${hash(customJs)}.js`;
    await writeFile(join(DIST, file.slice(1)), customJs);
    assets.customJs = url(file);
  }

  await writePage(join(DIST, 'index.html'), {
    model,
    assets,
    title: 'Introduction',
    activeHref: '/',
    content: homeContent(model),
    codeColumn: homeCodeColumn(model),
  });

  for (const endpoint of model.endpoints) {
    const directory = join(DIST, endpoint.href.slice(1));
    await mkdir(directory, { recursive: true });
    await writePage(join(directory, 'index.html'), {
      model,
      assets,
      title: `${endpoint.title} – ${endpoint.tag}`,
      activeHref: endpoint.href,
      content: endpointContent(spec, model, endpoint),
      codeColumn: endpointCodeColumn(model, endpoint),
      drawer: tryItDrawer(model, endpoint),
    });
    await writeFile(join(directory, 'index.md'), endpointMarkdown(model, endpoint));
  }

  for (const tag of model.tags) {
    if (!model.endpoints.some((endpoint) => endpoint.tagName === tag.name)) continue;
    const directory = join(DIST, tag.href.slice(1));
    await mkdir(directory, { recursive: true });
    await writePage(join(directory, 'index.html'), {
      model,
      assets,
      title: tag.displayName,
      activeHref: tag.href,
      content: tagContent(model, tag),
    });
  }

  for (const hook of model.webhooks) {
    const directory = join(DIST, hook.href.slice(1));
    await mkdir(directory, { recursive: true });
    await writePage(join(directory, 'index.html'), {
      model,
      assets,
      title: `${hook.title} – Webhooks`,
      activeHref: hook.href,
      content: endpointContent(spec, model, hook),
      codeColumn: webhookCodeColumn(hook),
    });
    await writeFile(join(directory, 'index.md'), endpointMarkdown(model, hook));
  }

  if (model.models.length) {
    await mkdir(join(DIST, 'models'), { recursive: true });
    await writePage(join(DIST, 'models', 'index.html'), {
      model,
      assets,
      title: 'Models',
      activeHref: '/models/',
      content: modelsIndexContent(model),
    });
    for (const entry of model.models) {
      const directory = join(DIST, 'models', entry.slug);
      await mkdir(directory, { recursive: true });
      await writePage(join(directory, 'index.html'), {
        model,
        assets,
        title: `${entry.name} – Models`,
        activeHref: '/models/',
        content: modelContent(spec, entry),
        codeColumn: modelCodeColumn(entry),
      });
      await writeFile(join(directory, 'index.md'), modelMarkdown(entry));
    }
  }

  // Machine-readable mirrors: the raw spec (Postman/Insomnia import),
  // llms.txt pointing AI tools at the markdown pages, and the manifest the
  // MCP endpoint (build/mcp.mjs, the Laravel package) describes itself with.
  await copyFile(absolute(specPath), join(DIST, 'openapi.json'));
  await writeFile(join(DIST, 'llms.txt'), llmsIndex(model));
  await writeFile(join(DIST, 'assets', 'mcp-manifest.json'), JSON.stringify(mcpManifest(model)));

  await writeFile(
    join(DIST, 'assets', 'search-index.json'),
    JSON.stringify(buildSearchIndex(model)),
  );
  for (const font of FONT_FILES) {
    await copyFile(join(ASSETS, 'fonts', font), join(DIST, 'assets', 'fonts', font));
  }

  const elapsed = Math.round(performance.now() - started);
  const tagPages = model.tags.filter((tag) => model.endpoints.some((endpoint) => endpoint.tagName === tag.name)).length;
  const pages = model.endpoints.length + model.webhooks.length + tagPages + 1 + (model.models.length ? model.models.length + 1 : 0);
  const mount = mountedAt ? ` (served from ${mountedAt}/)` : '';
  console.log(`✓ ${pages} pages generated in ${elapsed}ms → ${out}/${mount}`);
}

function absolute(path) {
  return isAbsolute(path) ? path : resolve(ROOT, path);
}

async function writePage(path, page) {
  await writeFile(path, pageShell(page));
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

/** Concatenates explicitly listed files, in the order given. */
async function concatFiles(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  const parts = [];
  for (const path of list) {
    parts.push(await readFile(absolute(path), 'utf8'));
  }
  return parts.join('\n');
}

/** Concatenates the directory's files (matching extension) in name order. */
async function bundle(sourceDirectory, extension) {
  const files = (await readdir(sourceDirectory)).filter((file) => file.endsWith(extension)).sort();
  const parts = [];
  for (const file of files) {
    parts.push(await readFile(join(sourceDirectory, file), 'utf8'));
  }
  return parts.join('\n');
}

/**
 * Conservative CSS minifier: strips comments and collapses whitespace while
 * leaving quoted strings ('Instrument Sans Variable', content: '▸') intact.
 */
function minifyCss(css) {
  let out = '';
  let index = 0;
  while (index < css.length) {
    const ch = css[index];
    if (ch === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = css.indexOf(ch, index + 1);
      out += css.slice(index, end === -1 ? css.length : end + 1);
      index = end === -1 ? css.length : end + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      while (index < css.length && /\s/.test(css[index])) index += 1;
      const prev = out[out.length - 1];
      const next = css[index];
      // Whitespace is only syntax between two identifier-ish characters.
      if (prev && next && !'{}:;,>+~('.includes(prev) && !'{}:;,>+~)'.includes(next)) out += ' ';
      continue;
    }
    out += ch;
    index += 1;
  }
  return out.replaceAll(';}', '}');
}

// CLI: node build/index.mjs [--spec openapi.json] [--out dist] [--lang en]
//                           [--base /docs/api] [--allow-spec-html]
//                           [--css theme.css]... [--js extra.js]...
//                           [--theme ocean] [--logo logo.svg] [--favicon icon.png]
//                           [--title "My API"]
// Skipped when the module is imported programmatically.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      spec: { type: 'string', default: 'openapi.json' },
      out: { type: 'string', default: 'dist' },
      lang: { type: 'string', default: 'en' },
      base: { type: 'string', default: '' },
      'allow-spec-html': { type: 'boolean', default: false },
      css: { type: 'string', multiple: true, default: [] },
      js: { type: 'string', multiple: true, default: [] },
      theme: { type: 'string', default: 'default' },
      logo: { type: 'string', default: '' },
      favicon: { type: 'string', default: '' },
      title: { type: 'string', default: '' },
    },
  });
  values.allowSpecHtml = values['allow-spec-html'];

  buildDocs(values).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
