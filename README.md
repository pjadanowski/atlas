# Atlas

Zero-runtime-dependency static documentation generator for OpenAPI 3 specs.
Renders `openapi.json` into a fully static site (`dist/`) — no framework, no
runtime OpenAPI parsing, works without JavaScript. Design contract lives in
`AGENTS.md` and `DESIGN_PRINCIPLES.md`.

## Usage

```bash
npm run build                 # openapi.json → dist/
npm run preview               # serve dist/ on http://localhost:4173
npm run watch                 # rebuild automatically when openapi.json, assets/ or build/ change
```

There is no `npm install` step: the generator has no dependencies, and the two
webfonts are vendored in `assets/fonts/` (SIL OFL, licenses beside them). Node
alone is enough.

The output is fully static — after editing `openapi.json` you must rebuild
(or keep `npm run watch` running next to `npm run preview`).

The build accepts flags, so any spec and output directory work:

```bash
node build/index.mjs --spec path/to/openapi.json --out public/docs --lang de
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--spec` | `openapi.json` | source specification |
| `--out` | `dist` | output directory |
| `--lang` | `en` | page `lang` attribute (`npm run build` passes `de`, this spec's content is German) |
| `--base` | *(none)* | sub-path the site is served from, e.g. `/docs/api` |
| `--allow-spec-html` | off | render HTML-authored spec descriptions verbatim instead of escaping them |
| `--css` | *(none)* | extra stylesheet, loaded last; repeatable |
| `--js` | *(none)* | extra script, loaded last; repeatable |

`--base` makes every link, asset and search result carry the prefix, so the
site can be mounted below the domain root (Laravel's `/docs/api`, GitHub Pages'
`/repo`). Preview a sub-path build with `BASE=/docs/api npm run preview` and
open <http://localhost:4173/docs/api/>.

Or programmatically:

```js
import { buildDocs } from './build/index.mjs';
await buildDocs({ spec: 'openapi.json', out: 'dist', base: '/docs/api' });
```

## Customizing the output

Descriptions in the specification normally go through a small markdown
allowlist (`<br>`, links, `<strong>`, `<code>`, lists, headings); everything
else is escaped. If your descriptions are authored as HTML — tables, sections,
images — they show up as visible tags, and `--allow-spec-html` renders them
verbatim instead, with typography applied through a `.spec-html` wrapper.

The switch is applied per description, not per site: only a description that
carries a tag the markdown allowlist does not already handle (`<section>`,
`<div>`, `<p>`, `<h2>`, `<ul>`, `<table>`, …) goes out verbatim. Specs mix both
styles, and forcing the markdown-authored ones through verbatim would print
their `**` and `###` as literal text.

> **This trades safety for expressiveness, so it is off by default.** Verbatim
> means no sanitizing at all: a description can run scripts on the docs' origin,
> and that origin holds the try-it bearer token in `localStorage`. Enable it
> only for a spec you trust like your own templates — one generated from your
> code qualifies, one fetched from a partner does not. There is deliberately no
> middle setting: the sanitizer this project used to have was removed for being
> bypassable, and a filter that looks safe without being safe is worse than a
> switch that states the trade-off.

`--css` and `--js` copy your own files into the site and load them after Atlas's
own bundles, so they can override anything. Both are repeatable and each set is
concatenated, content-hashed and served as `assets/custom.<hash>.css|js`:

```bash
node build/index.mjs --css brand.css --css overrides.css --js analytics.js
```

Because they load last, restyling is usually a matter of redefining the design
tokens from `assets/css/00-tokens.css`:

```css
:root { --accent: #e0245e; --font-ui: 'Inter', system-ui, sans-serif; }
```

## Features

- Three-column layout (nav / content / dark code column), Stripe-style
- Build-time code snippets (cURL, JavaScript, PHP, Python) + syntax highlighting
- Typo-tolerant search (⌘K) over a pre-built index: titles, paths,
  descriptions, parameter and schema names, operationIds and `x-keywords`;
  one typo from 4 characters, two from 8; diacritics folded ("gebaude" finds
  "Gebäude"); words that match nothing are dropped instead of returning an
  empty list. Ranking engine is lazy-loaded with the index on first open
- **MCP server** — the docs answer the Model Context Protocol at `/mcp`
  (topbar → MCP shows ready-made snippets for VS Code, Cursor, Claude Code);
  connected assistants search the API and read endpoint and model pages
- **Try it** — slide-over console per endpoint (native `<dialog>`), prefilled
  from spec examples, JSON tree response viewer
- **Global authorization** — one bearer token (topbar → Authorize), stored in
  `localStorage`, applied to every try-it request; server selection persists too
- Try-it QoL: entered values persist per endpoint, per-endpoint request
  history with one-click restore, "Fill example data" + Reset
- **Models** — every `components.schemas` entry as a browsable page
  (`/models/`), linked from request bodies and responses, searchable via ⌘K
- Snippet language choice remembered globally; deep links to parameters
  (hover anchors); sidebar quick filter
- Machine-readable mirrors: `/openapi.json` (topbar download → Postman/
  Insomnia import), `/llms.txt` + a markdown twin of every endpoint and
  model page (`…/index.md`)
- Light/dark theme, full keyboard navigation, works with JS disabled
  (try-it/search are progressive enhancements)

## MCP: using the docs from an editor assistant

The generated site is also a [Model Context Protocol](https://modelcontextprotocol.io)
server (Streamable HTTP, stateless). An assistant in VS Code, Cursor or Claude
Code connects to `https://<docs host>/mcp` and gets four tools:

| Tool | Purpose |
| --- | --- |
| `search_api` | typo-tolerant search over endpoints and models — the same engine as ⌘K |
| `list_endpoints` | every endpoint grouped by tag, optionally one tag |
| `get_endpoint` | one endpoint's markdown page: parameters, body, responses, examples |
| `get_model` | one schema's fields, types, required flags and example JSON |

The "MCP" button in the topbar opens a dialog with the server URL and copyable
configuration for each client, e.g. `.vscode/mcp.json`:

```json
{ "servers": { "my-api-docs": { "type": "http", "url": "https://docs.example.com/mcp" } } }
```

Two runtimes serve the endpoint from the same static output (search index,
markdown pages, `assets/mcp-manifest.json`): `build/mcp.mjs`, used by
`npm run preview`, and the Laravel package's `McpEndpoint` controller. A plain
static host (nginx, S3) serves the pages but not `/mcp` — run the preview
server or the Laravel package for that. Nothing in the MCP surface executes
API calls; it is documentation access only.

## Laravel / Scramble integration

This repository is also the Composer package `pjadanowski/atlas`, which
registers Atlas as a [Scramble](https://scramble.dedoc.co) renderer next to
its `elements` and `scalar` options. Requires Scramble ^0.13 (where the renderer
hook was introduced) and a `node` binary on the build machine — the generator
has no npm dependencies, so nothing needs installing beyond Node itself.

```bash
composer require pjadanowski/atlas
php artisan vendor:publish --tag=atlas-config   # optional
php artisan atlas:build
```

The build command asks Scramble's own generator for the specification, writes
the site to `storage/app/atlas` and points every URL at the path Scramble serves
its docs from. Scramble's UI route returns the generated entry page; the package
adds a catch-all route for everything below it, behind the same middleware
Scramble is configured with — so docs that were not public do not become public.
The output stays outside `public/` for the same reason. The MCP endpoint
(`<prefix>/mcp`, route `atlas.docs.mcp`) sits behind that middleware too: an
assistant can read what a browser on the same network could read, no more.
Editor clients do not carry a Laravel session, so with the default
`RestrictedDocsAccess` gate the endpoint is open only where the docs are.

| Option | Purpose |
| --- | --- |
| `--spec=` | build from an existing OpenAPI file instead of generating one |
| `--out=` | override the output directory |
| `--base=` | override the sub-path the docs are served from |
| `--lang=` | override the page language attribute |
| `--allow-spec-html` | render HTML-authored descriptions verbatim for this build |

Customization is configured in `config/atlas.php` rather than on the command
line, so every build agrees:

```php
'allow_spec_html' => true,                       // see the warning above
'css' => [resource_path('atlas/theme.css')],
'js'  => [resource_path('atlas/extra.js')],
```

### What to set in `config/scramble.php`

Exactly one value:

```php
'renderer' => 'atlas',
```

Nothing needs to be added to the `renderers` array — the package registers
`scramble.renderers.atlas` from its service provider's `register()`, early
enough for Scramble to see it. If you do add that key, your values are merged
over the package's defaults.

**Remove `ui.logo` if the published config still has it.** Scramble's
`GeneratorConfig::renderer()` keeps a legacy branch: the mere presence of
`ui.logo` makes it ignore `renderer` entirely and force `elements`, so Atlas
would build correctly and never be displayed. `atlas:build` warns when it sees
the key.

Atlas renders the OpenAPI document, so the Scramble options that shape that
document reach it, while the options belonging to the other two UIs do not:

| Key in `config/scramble.php` | Effect in Atlas |
| --- | --- |
| `renderer` | must be `'atlas'` |
| `ui.title` | the title in the top bar; falls back to `config('app.name')` |
| `info.version` | the version badge next to the title |
| `info.description` | the introduction text on the home page |
| `servers` | the server list in the try-it console |
| `middleware` | who may read the docs — Atlas reuses it for its own asset route |
| `ui.logo` | **must be absent**, see above |
| `renderers.elements.*`, `renderers.scalar.*` | ignored; they configure the other UIs |

If Scramble's UI route has been moved off `docs/api`, also set `route_prefix` in
`config/atlas.php`. The asset route is registered while providers boot, which is
too early to read the path off Scramble's routes, so it falls back to Scramble's
default. `atlas:build` compares the two and warns on a mismatch.

### Deployment

**`php artisan atlas:build` must run on every deploy.** Atlas is a static site
generated ahead of time: without this step the published documentation keeps
describing whatever the code looked like at the last build, silently and with no
error anywhere. Skipping it does not break the docs — it makes them wrong, which
is worse.

Add it after dependencies are installed and the environment is in place:

```bash
composer install --no-dev --optimize-autoloader
php artisan config:cache
php artisan atlas:build          # <— docs follow the code
php artisan migrate --force
```

The build needs a `node` binary on the machine that runs it (nothing else — the
generator has no npm dependencies). If Node lives somewhere unusual, point
`atlas.node` at it, e.g. `ATLAS_NODE=/usr/local/bin/node` in the environment.
The command boots the application, so it belongs after `.env` is available. Cost
is negligible — generating the specification dominates, the site itself takes
well under a second for a hundred pages — so there is no reason to make it
conditional.

On zero-downtime setups (Envoyer, Deployer, Forge with releases) `storage/` is
usually a shared directory symlinked into each release. That works: the docs
survive between releases and are overwritten in place by the build. It is also
exactly why a missing build step goes unnoticed — the previous release's site
is still there and still serves happily. For a strictly atomic swap the output
has to leave the shared directory — pointing `--out` inside `storage/` changes
nothing, since that path resolves through the symlink to the shared copy. Move
it into the release's own code directory instead:

```php
// config/atlas.php — base_path() is release-local, storage_path() is not
'output' => base_path('atlas-docs'),
```

Each release then builds and serves its own copy, and a rollback rolls the
documentation back with it.

In CI, the same call works as long as the job has PHP, the vendor directory and
Node available; run it in whatever job produces the deployable artifact.

The package is covered by an integration test suite that boots a real Laravel
application with Scramble installed (`composer test`).
