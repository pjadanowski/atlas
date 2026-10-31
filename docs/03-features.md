# Atlas — Features

## Overview

This document describes every feature available in Atlas.

Each feature has a single responsibility.

Features should remain independent whenever possible.

The UI should compose features rather than tightly coupling them.

---

# Endpoint Documentation

## Purpose

The endpoint page is the heart of Atlas.

It should allow developers to fully understand an endpoint without reading unrelated documentation.

---

## Functional Requirements

Every endpoint page must contain:

- HTTP method
- Path
- Human readable title
- Description
- Authentication requirements
- Endpoint status
- Tags
- Parameters
- Request body
- Responses
- Examples
- Code samples
- Related endpoints
- Changelog

---

## User Experience

A developer should understand:

- what this endpoint does
- when to use it
- what data it accepts
- what data it returns
- common errors

within a few seconds.

---

# Sidebar Navigation

## Purpose

Provide instant navigation through large APIs.

---

## Functional Requirements

Support:

- Resources
- Nested resources
- Endpoint grouping
- Expand / Collapse
- Active item
- Current section highlighting
- Keyboard navigation

---

## User Experience

The sidebar should behave similarly to the VSCode Explorer.

Resources feel like folders.

Endpoints feel like files.

---

# Search

## Purpose

Instantly find endpoints without manually browsing documentation.

---

## Functional Requirements

Search should index:

- endpoint names
- paths
- summaries
- descriptions
- parameters
- tags
- operationId

Support:

- fuzzy matching — Typesense-style: every word must match (exact, prefix, or
  within a typo budget: 1 typo from 4 characters, 2 from 8, transpositions
  count as one), diacritics folded, words that match nothing are dropped
- field weights: title > path > keywords (operationId, params, schema names,
  `x-keywords`) > tag > description; a whole query inside one field ranks as a phrase
- the ranking engine (`assets/search/10-engine.js`) is shared with the MCP
  server and mirrored in PHP (`src/Mcp/SearchEngine.php`) — change all three
- keyboard navigation
- recent searches

Shortcut:

Ctrl + K

or

⌘ + K

---

## User Experience

Search should feel like Raycast.

Users search by intent.

Not by remembering endpoint names.

---

# Parameters

## Purpose

Explain endpoint inputs with maximum clarity.

---

## Functional Requirements

Every parameter displays:

- name
- type
- required / optional
- description
- validation
- example
- default value
- enum values
- related schema

Nested objects should be collapsible.

---

## User Experience

Parameters should never be displayed as dense tables.

Rows should be easy to scan.

---

# Request Body

## Purpose

Present complex request bodies in a human friendly way.

---

## Functional Requirements

Support:

- Form View
- JSON View

Both stay synchronized.

---

## User Experience

Developers should not be forced to edit JSON.

Structured forms should be the default.

---

# Responses

## Purpose

Clearly explain every possible response.

---

## Functional Requirements

Display:

- HTTP status
- Description
- Headers
- Example
- Schema

Errors displayed separately.

---

# Code Examples

## Purpose

Allow developers to copy working code immediately.

---

## Functional Requirements

Support:

- curl
- JavaScript
- TypeScript
- PHP
- Laravel
- Python
- Go
- Java
- C#
- Rust

Examples generated automatically.

---

## User Experience

Changing example data updates generated code.

---

# Schema Explorer

## Purpose

Explain complex models visually.

---

## Functional Requirements

Support:

- nested objects
- arrays
- enums
- references
- recursive schemas

Expandable tree.

---

## User Experience

Schemas should feel like exploring folders.

Not JSON.

---

# Authentication

## Purpose

Clearly explain authentication.

---

## Functional Requirements

Support:

- Bearer
- API Key
- Basic Auth
- OAuth2
- Cookies

Display:

required scopes

headers

examples

---

# Playground

## Purpose

Execute requests without leaving documentation.

---

## Functional Requirements

Support:

- environments
- authentication
- headers
- query
- path
- body
- multipart uploads

Response viewer:

Pretty

Raw

Headers

Timeline

---

## Technical Notes

Lazy loaded.

Never increases initial bundle.

---

# AI Assistant

## Purpose

Allow developers to ask questions using natural language.

---

## Functional Requirements

Examples

"How do I create an order?"

"How do I upload an image?"

"What endpoint deletes a customer?"

AI only answers using generated API context.

Never invent endpoints.

---

# Relationships

## Purpose

Visualize connections between resources.

---

## Functional Requirements

Display relationships such as:

Customer

↓

Orders

↓

Invoice

↓

Payment

Users can navigate through relationships.

---

# Changelog

## Purpose

Explain endpoint evolution.

---

## Functional Requirements

Display:

- added fields
- removed fields
- deprecated fields
- breaking changes

Timeline format.

---

# Version Selector

## Purpose

Switch documentation versions.

---

## Functional Requirements

Support:

- v1
- v2
- v3

Changing version reloads documentation.

---

# Theme

## Purpose

Provide comfortable reading.

---

## Functional Requirements

Support:

Light

Dark

System

Preference stored locally.

---

# Copy Everywhere

## Purpose

Reduce friction.

---

## Functional Requirements

Users should be able to copy:

- endpoint
- path
- parameters
- code
- examples
- schema
- curl

with one click.

---

# Keyboard Shortcuts

## Functional Requirements

Ctrl + K

Search

/

Focus search

Esc

Close dialogs

Ctrl + Shift + C

Copy code

?

Open shortcuts

Navigation should be keyboard friendly.

---

# Accessibility

## Functional Requirements

Keyboard navigation.

Screen readers.

Reduced motion.

Visible focus.

WCAG AA.

---

# Performance

## Functional Requirements

Search

instant

Navigation

instant

Page changes

under 150ms

No unnecessary animations.

---

# Future Features

The architecture should support future extensions.

Examples

- AI generated tutorials
- Workflow diagrams
- SDK downloads
- Graph visualization
- Markdown export
- PDF export
- Plugin ecosystem
- Team annotations
- Saved requests
- API mocking
- Request history

## Playground

### Acceptance Criteria

- Playground is always visible on desktop.
- Supports GET, POST, PUT, PATCH and DELETE.
- Supports multipart uploads.
- Automatically uses authentication from current environment.
- JSON is validated before sending.
- Requests can be resent with one click.
- Responses display execution time.
- Responses display response size.
- Responses can be copied.
- Playground loads only when first opened.

## Search

### Acceptance Criteria

- Opens in under 100ms.
- Keyboard only navigation.
- Supports fuzzy matching.
- Supports endpoint path search.
- Supports operationId search.
- Supports parameter search.
- Works offline.
- Does not require network requests.