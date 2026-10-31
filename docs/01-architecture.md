# Atlas — Architecture

## Overview

Atlas follows a **Static-First Architecture**.

The OpenAPI specification is transformed during build time into a normalized domain model, which is then used to generate static HTML documentation.

The browser is responsible only for progressive enhancement.

No OpenAPI parsing happens in the browser.

No documentation rendering happens in the browser.

No schema processing happens in the browser.

Everything expensive happens during build.

---

# High Level Architecture

```
                openapi.json
                      │
                      ▼
        Parse & Validate Specification
                      │
                      ▼
            Dereference ($ref)
                      │
                      ▼
           Normalize Domain Model
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
 HTML Generator   Search Index   AI Context
        │             │             │
        └─────────────┼─────────────┘
                      ▼
             Static Documentation
                      │
                      ▼
          Progressive Enhancement
```

The browser receives pre-generated HTML.

JavaScript enhances the page but never creates it.

---

# Source of Truth

The OpenAPI document is the only source of truth.

Everything else is generated.

Never duplicate information.

Never manually maintain endpoint documentation.

If something can be derived from the OpenAPI specification, it should be.

---

# Build Pipeline

The build pipeline consists of several independent steps.

## 1. Parse

Load the OpenAPI specification.

Validate the document.

Resolve references.

Normalize formats.

Output:

Internal OpenAPI model.

---

## 2. Normalize

Transform the parsed specification into a domain-oriented structure.

Instead of exposing raw OpenAPI objects, create higher level concepts:

- Resources
- Endpoints
- Parameters
- Schemas
- Examples
- Authentication
- Tags
- Relationships
- Responses

The UI should never consume raw OpenAPI objects.

It should consume normalized domain models.

---

## 3. Generate

The generator produces:

- static HTML pages
- navigation tree
- search index
- code examples
- schema documentation
- endpoint metadata
- relationship maps
- changelog metadata

Every output is deterministic.

---

## 4. Enhance

The browser enhances the generated HTML.

Examples:

- search
- copy buttons
- tabs
- accordions
- theme switching
- playground
- AI assistant

The HTML itself never depends on JavaScript.

---

# Core Modules

The system is divided into independent modules.

## Parser

Responsible for:

- loading OpenAPI
- validation
- dereferencing
- resolving references

No UI logic.

---

## Domain Model

Transforms raw OpenAPI into business objects.

Example:

Instead of:

OpenAPI PathItem

Expose:

Endpoint

Instead of:

Schema Object

Expose:

Schema

The UI should never know OpenAPI internals.

---

## Generator

Produces static assets.

Responsibilities:

- HTML
- navigation
- search index
- examples
- metadata
- JSON artifacts

---

## UI

Enhances generated pages.

Responsibilities:

- interactions
- search
- playground
- AI
- keyboard shortcuts
- accessibility

The UI never parses OpenAPI.

---

# Progressive Enhancement

The application should work in layers.

Layer 1

Static HTML

Always available.

Layer 2

CSS

Improves readability.

Layer 3

JavaScript

Adds interactions.

Layer 4

Optional services

AI

Try It

Analytics

The failure of any higher layer must never break lower layers.

---

# Rendering Strategy

Rendering happens only once.

During build.

The browser receives complete pages.

Avoid client-side rendering whenever possible.

Avoid hydration whenever possible.

Avoid runtime template generation.

---

# Search

Search index is generated during build.

Each indexed item contains:

- endpoint
- title
- summary
- tags
- parameters
- resource
- operationId

The browser performs lightweight in-memory search.

Search should never parse OpenAPI.

---

# Code Examples

Code snippets are generated during build.

Languages are generated from templates.

Examples include:

- curl
- JavaScript
- TypeScript
- PHP
- Laravel
- Go
- Python
- C#
- Java

Code generation should be deterministic.

---

# Try It

Try It is the only runtime feature communicating with external APIs.

It should:

- use native fetch()
- support authentication
- support environments
- support headers
- support request body
- support file uploads

This module is lazy-loaded.

---

# AI

The AI assistant never analyzes OpenAPI directly.

Instead, it consumes a generated context file.

The build process prepares optimized AI context containing:

- endpoint descriptions
- parameters
- authentication
- examples
- relationships

This keeps AI fast and deterministic.

---

# Versioning

Every API version is completely independent.

Example:

/v1/

/v2/

/v3/

No runtime switching logic.

Switching versions simply changes the documentation root.

---

# Plugin Architecture

Future functionality should be implemented as plugins.

Possible plugins:

- SDK Generator
- AI Assistant
- Graph View
- Sequence Diagrams
- Markdown Export
- PDF Export

Plugins must not affect the core architecture.

Core should remain lightweight.

---

# Failure Strategy

The application should fail gracefully.

If JavaScript fails:

Documentation still works.

If AI fails:

Documentation still works.

If Try It fails:

Documentation still works.

If Search fails:

Navigation still works.

Documentation is always the priority.

---

# Scalability

The architecture should support:

- small APIs (10 endpoints)
- enterprise APIs (5000+ endpoints)

Performance should remain predictable regardless of API size.

Generation time may increase.

Runtime performance should remain nearly constant.

---

# Design Principles

The architecture follows several principles.

- Build once, serve many.
- Parse once, render many.
- Never duplicate data.
- Static by default.
- Progressive enhancement.
- Native browser APIs first.
- Keep runtime as small as possible.
- Every dependency must justify itself.
- Simplicity beats abstraction.
- Readability beats cleverness.

# Architectural Decision Record

The following decisions are intentional and should not be changed without strong justification.

- OpenAPI is the single source of truth.
- Documentation is generated during build.
- Runtime JavaScript is optional.
- Progressive enhancement over client-side rendering.
- Native browser APIs over third-party libraries.
- HTML over JavaScript whenever possible.
- CSS over JavaScript whenever possible.
- Composition over inheritance.
- Simplicity over flexibility.
- Long-term maintainability over short-term convenience.