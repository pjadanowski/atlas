# Decision log

Why things are the way they are — context the code alone does not carry.
Newest entries first. Project rules live in `AGENTS.md` and the other files
in `docs/`.

---

## 2026-10 — OpenAPI 3.1 is normalized once, at the model boundary

Scramble (the main producer of specs Atlas renders) emits OpenAPI **3.1**:
`type: ["string", "null"]`, nullable references as `anyOf: [{$ref}, {type: null}]`,
`const`, schema-level `examples`, numeric `exclusiveMinimum`. Rather than
teaching every renderer both dialects, `normalizeSchema()` in `build/spec.mjs`
folds them into the 3.0 shape (`nullable`, `enum`, `example`, `exclusiveMin`)
inside `mergeAllOf`, which every schema already passes through. A nullable
`$ref` keeps its name in `x-ref-name` so labels and model links survive.

## 2026-10 — Security is modelled as alternatives of scheme lists

`security: [{a: [], b: []}, {c: []}]` means "(a AND b) OR c", and `{}` means
"anonymous allowed". The model keeps exactly that shape
(`endpoint.security: [[{id, scopes, scheme}]]`). Snippets use the first
non-empty alternative; the try-it console uses the first alternative whose
credentials are all configured in the Authorize dialog. Hardcoding a bearer
token (as earlier versions did) was wrong for every API that is not
bearer-only.

## 2026-10 — Example values are guessed from property names

Scramble specs carry almost no examples, so generated bodies read
`{"email": "string", "lat": 1.5}`. `build/example.mjs` now guesses from the
property name (`email`, `slug`, `lat`, `price`, `*_at`, …), and only when the
schema provides nothing better and the guess satisfies its constraints.

## 2026-10 — Auto-build in development

A static site goes stale silently. With `atlas.auto_build` (default: local
environment only) each docs page request regenerates the spec and rebuilds
only when its fingerprint — spec, Atlas config, generator version — changed.
Checks are throttled to one per two seconds because page navigation comes in
bursts. Production keeps the explicit `php artisan atlas:build` on deploy.

## 2026-09 — `--allow-spec-html` applies per description

Some specs write descriptions as real HTML (`<section>`, `<div>`, `<p>`),
others as markdown — often both in one document. A site-wide verbatim switch
would print the markdown ones' `**` and `###` literally, so the flag only
lets through descriptions that contain a tag outside the inline markdown
allowlist (`isAuthoredHtml()` in `build/text.mjs`).

This is **not** a sanitizer. Trust comes from the flag alone; the per
description check only picks the renderer. The rule in
`docs/04-development-rules.md` stands: no sanitizer — the previous one was
removed for being bypassable, and a filter that looks safe without being safe
is worse than an honest switch. Disable the flag for any spec that does not
come from your own code.

## Custom CSS and JS

`--css` and `--js` (repeatable; `css` / `js` in `config/atlas.php`) are
concatenated, hashed and loaded **after** Atlas's own bundles — that ordering
is what lets them override anything. They are deliberately kept out of the
main bundles, so the main hashes stay stable and a broken custom file is
obvious in the network panel. Restyling usually means redefining the tokens
from `assets/css/00-tokens.css`.
