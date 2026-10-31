Atlas
Mission

Build the fastest, cleanest and most pleasant OpenAPI documentation platform available.

This is NOT another Swagger UI.

This is NOT another Scalar clone.

The goal is to build an API documentation experience that feels closer to:

Stripe
Linear
Vercel
GitHub
Cursor

than to Swagger.

The interface should disappear.

Developers should focus on understanding the API, not on learning the documentation.

Everything should optimize for:

readability
information hierarchy
speed
accessibility
keyboard navigation
developer productivity
Product Philosophy

Documentation is only one part.

Atlas is a workspace.

Reading documentation.

Trying endpoints.

Understanding relationships.

Copying code.

Exploring schemas.

Everything should happen inside one interface.

Architecture

The project is static-first.

Everything that can be generated during build must be generated during build.

Never parse OpenAPI inside the browser.

Never render schemas inside the browser.

Never syntax-highlight code inside the browser.

The browser should only enhance already generated HTML.

Progressive Enhancement

The entire documentation must work without JavaScript.

JavaScript only enhances:

search
copy buttons
tabs
accordions
theme
try-it
AI

Reading documentation should never require JavaScript.

Performance

Target

First Paint

under 500ms

Initial JS

under 15KB

Total JS

under 50KB

CSS

under 30KB

Lighthouse

100 Performance

100 Accessibility

100 Best Practices

Dependencies

Dependencies are maintenance cost.

Before installing one ask:

Can this be implemented in under 300 maintainable lines?

If yes

implement it.

Do not install another dependency.

Never Use

Redux

MobX

Material UI

Ant Design

Bootstrap

Axios

Moment.js

jQuery

Runtime syntax highlighting

Runtime markdown rendering

Runtime schema parsing

Preferred Technologies

Static generator

Node or Bun

TypeScript

Vanilla JS

Web Components

or

Preact Islands

CSS Variables

Native fetch

Shiki

Swagger Parser

No framework unless justified.

Visual Philosophy

Whitespace is more important than borders.

Typography is more important than colors.

Hierarchy is more important than decoration.

Every pixel should improve readability.

Inspiration

Positive

Stripe Docs

Vercel

Linear

GitHub

Raycast

Apple Developer

Negative

Swagger

Material UI dashboards

Bootstrap admin panels

Overdesigned SaaS templates

Development Rules

Never optimize prematurely.

Never over-engineer.

Prefer HTML.

Prefer CSS.

Prefer browser APIs.

JavaScript is the last resort.