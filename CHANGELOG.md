# Changelog

## 0.1.0 — 2026-10-31

First public release.

### Added
- OpenAPI 3.1 support: type unions and nullable `$ref`s (as emitted by
  Scramble), `const`, schema `examples`, numeric exclusive bounds, webhooks.
- `oneOf` / `anyOf` variant tabs with discriminator mapping;
  `additionalProperties` maps; `readOnly` / `writeOnly` per context.
- Multiple media types per body and response, named example switchers,
  response headers, cookie parameters, callbacks, server variables.
- Tag overview pages, `x-displayName`, `x-tagGroups`, `x-codeSamples`;
  table of contents from the introduction's headings.
- Code samples for 12 clients with credentials from each operation's
  security requirements.
- Authorize dialog for every security scheme type, including OAuth 2.0
  client-credentials / password grants; try-it applies the first satisfied
  security alternative.
- Markdown: fenced code, tables, blockquotes, rules, italics.
- Theme presets, logo, favicon and title options.
- Laravel `auto_build`: docs rebuild on request in development when the API
  or config changed.
- Name-aware example values for specs without examples.
- Mobile layout with a CSS-only navigation toggle.
- Orbit Travel demo spec; node, browser (CDP) and Laravel test suites; CI.

### Changed
- Requires Laravel 12 or 13: every Laravel 11 release is now flagged by
  security advisories and Composer refuses to install it.
- Security labels, snippets and the home page describe the spec's actual
  schemes instead of assuming a bearer token.
- Untagged operations are grouped under "Other".
