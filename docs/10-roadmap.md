# Atlas — Roadmap

## Overview

This roadmap describes the long-term development plan for Atlas.

Every milestone must produce a usable product.

Features should be implemented in order.

Avoid building advanced functionality before the core experience is complete.

The roadmap follows these principles:

- Deliver value early.
- Ship often.
- Keep the core stable.
- Add complexity gradually.
- Never compromise performance.

---

# Milestone 1 — Foundation

Goal

Create a minimal but production-quality documentation generator.

## Features

- OpenAPI parser
- OpenAPI validation
- Dereference `$ref`
- Domain model
- HTML generator
- Static routing
- Sidebar navigation
- Endpoint pages
- Parameter rendering
- Request body rendering
- Response rendering
- Code blocks
- Syntax highlighting
- Light theme
- Dark theme
- Responsive layout
- Keyboard navigation
- Copy buttons

## Performance Goals

HTML first.

No runtime parsing.

No client-side rendering.

Initial JavaScript below 15 KB.

Lighthouse

Performance

100

Accessibility

100

Best Practices

100

SEO

100

## Definition of Done

A developer can read an entire API without JavaScript.

The documentation is already more pleasant than Swagger.

---

# Milestone 2 — Developer Workspace

Goal

Transform documentation into an interactive workspace.

## Features

- Try It
- Environment selector
- Authentication manager
- Header editor
- Query editor
- Body editor
- Multipart upload
- Response viewer
- Pretty JSON
- Raw response
- Response headers
- Response timing
- Response size

## Performance Goals

Playground is lazy loaded.

Core documentation remains unaffected.

## Definition of Done

Developers can explore and test the API without leaving the documentation.

---

# Milestone 3 — Navigation

Goal

Make large APIs effortless to explore.

## Features

- Command Palette
- Instant Search
- Keyboard shortcuts
- Recent searches
- Search history
- Breadcrumbs
- Resource relationships
- Related endpoints
- Previous / Next endpoint
- Sticky navigation

## Performance Goals

Search opens instantly.

Search results below 50ms.

## Definition of Done

Finding endpoints is faster than manually browsing Swagger.

---

# Milestone 4 — Better Documentation

Goal

Explain APIs instead of merely listing endpoints.

## Features

- Schema Explorer
- Enum visualization
- Nested object explorer
- Relationship viewer
- Example switcher
- Generated examples
- Validation rules
- Human-readable constraints
- Endpoint status
- Changelog
- Version selector

## Definition of Done

Developers understand complex schemas without reading raw JSON.

---

# Milestone 5 — AI Assistant

Goal

Allow developers to navigate documentation using natural language.

## Features

- AI assistant
- AI search
- AI explanations
- Endpoint recommendations
- Relationship explanations
- Authentication explanations
- Request generation
- Response explanation

## Rules

AI never invents endpoints.

AI only answers using generated documentation context.

## Definition of Done

Developers can ask questions instead of searching manually.

---

# Milestone 6 — API Intelligence

Goal

Help developers understand APIs visually.

## Features

- Resource graph
- Dependency graph
- Workflow viewer
- Request flow
- Authentication flow
- Sequence diagrams
- Object relationships

## Definition of Done

Developers understand how the API works without reading every endpoint.

---

# Milestone 7 — SDK Support

Goal

Provide production-ready SDKs.

## Features

- PHP
- Laravel
- TypeScript
- JavaScript
- Python
- Go
- Java
- C#
- Rust

Generated automatically.

Never manually maintained.

---

# Milestone 8 — Documentation Platform

Goal

Support enterprise documentation.

## Features

- Multiple API versions
- Plugin system
- Themes
- Custom branding
- Markdown export
- PDF export
- Static search index
- Offline mode

---

# Milestone 9 — Enterprise

Goal

Support large organizations.

## Features

- Multiple specifications
- Team workspaces
- Private documentation
- Permissions
- Internal notes
- Environment management
- API lifecycle
- Audit logs

---

# Future Ideas

The following ideas are intentionally postponed.

- GraphQL
- AsyncAPI
- gRPC
- WebSocket explorer
- Mock servers
- Request history
- Saved requests
- Collections
- CLI
- Desktop application
- VSCode extension
- Browser extension
- Figma integration
- MCP integration
- Plugin Marketplace

---

# Definition of Success

The project succeeds when developers naturally prefer Atlas over Swagger.

Success is measured by:

- Faster understanding.
- Faster navigation.
- Less documentation searching.
- Better onboarding.
- Better accessibility.
- Better performance.
- Better developer experience.

Beauty alone is not success.

Developer productivity is.

---

# Performance Budget

Core HTML

Static.

Core JavaScript

<15 KB

Total JavaScript

<50 KB

CSS

<30 KB

Images

SVG only.

Fonts

Self-hosted.

Lazy Loaded

AI

Playground

Monaco

Heavy visualizations

---

# Technical Debt Policy

Technical debt is acceptable only when:

- It accelerates delivery.
- It is documented.
- It has a planned resolution.

Never accumulate undocumented technical debt.

---

# Release Strategy

Every release must improve one of the following:

- Performance
- Readability
- Accessibility
- Developer Experience
- Maintainability

Never release features that reduce quality.

---

# Long-Term Vision

Atlas should become the modern standard for OpenAPI documentation.

Not because it has the most features.

But because it provides the best developer experience.

Every future decision should support that vision.