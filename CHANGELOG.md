# Changelog

## Unreleased

### Added
- WS-Security for SOAP services: requirements read from WS-SecurityPolicy
  (WS-Policy 1.2/1.5, SecurityPolicy 1.1–1.3, by reference or inline) or
  declared with `--soap-security` / `atlas.soap_security`; documented on each
  operation, in the example envelope and in the PHP SoapClient / zeep
  samples. Try-it builds the `wsse:Security` header per request —
  UsernameToken with PasswordDigest, Timestamp, issued tokens pasted or
  requested from an STS via WS-Trust 1.3 / 2005/02.

## 0.2.0 — 2026-10-31

### Added
- SOAP: WSDL 1.1 services (`--wsdl`, `atlas.wsdl`) documented next to the
  REST API or alone — envelopes generated from XSD, SOAP 1.1/1.2, faults,
  abstract types via `xsi:type`, SOAP samples (cURL, PHP SoapClient,
  Laravel, zeep, fetch, raw HTTP), try-it with XML responses pretty-printed.
- YAML specs and specs split across files (external `$ref`s bundled at
  build time), with a zero-dependency YAML 1.2 parser — checked against
  PyYAML on the GitHub, Stripe, OpenAI, Twilio and DigitalOcean specs.
- Webhook-only (3.1) documents.
- Zero-dependency XML parser and XML highlighting.
- Example values that satisfy simple `pattern`s.

### Changed
- Large APIs: nested named schemas are inlined two levels deep (then
  linked to their model page) within a per-section row budget; above 250
  operations the sidebar lists only the open group's endpoints; untagged
  operations of large specs are grouped by path segment. Stripe's spec now
  builds in ~20 s instead of 260 s, with pages of ~0.3 MB instead of 44 MB.

### Fixed
- Specs using Swagger 2's `required: true` on properties crashed the build;
  it is now honored as the parent's `required` list.
- Markdown pages (llms.txt, MCP) described every protected endpoint as
  needing a bearer token; they now list the actual schemes and scopes.
- Try-it asked SOAP services for JSON (`Accept`).

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
