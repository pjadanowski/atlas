# Atlas — Vision

## Overview

Atlas is a modern, static-first OpenAPI documentation platform designed to replace traditional API documentation tools such as Swagger UI and Redoc.

The goal is not to build another documentation renderer.

The goal is to build the best possible developer experience for understanding, exploring and working with an API.

Documentation is only one part of the experience.

Atlas should become the place where developers:

- discover endpoints
- understand relationships
- learn authentication
- test requests
- inspect responses
- copy production-ready examples
- navigate large APIs effortlessly

The documentation should feel closer to a professional IDE than a static website.

---

# Mission

Build the fastest, cleanest and most enjoyable OpenAPI documentation available.

Every design and technical decision should optimize for one thing:

> Helping developers understand an API as quickly as possible.

---

# Philosophy

Atlas follows several core principles.

## Static First

Everything that can be generated during build time should be generated during build time.

The browser should never perform expensive work that can be done earlier.

Documentation pages should be delivered as ready-to-render HTML.

JavaScript should only enhance the experience.

---

## Progressive Enhancement

The documentation must remain fully usable even when JavaScript is disabled.

Core functionality must always work:

- navigation
- reading documentation
- viewing schemas
- viewing examples
- authentication instructions

JavaScript enhances the experience with:

- search
- tabs
- accordions
- copy buttons
- theme switching
- Try It playground
- AI assistant

Documentation should never depend on JavaScript.

---

## Performance First

Performance is treated as a feature.

Every dependency, animation and interaction should be evaluated through the lens of performance.

Fast software creates a better developer experience.

---

## Simplicity

The interface should disappear.

Developers should focus on the API rather than on learning the documentation.

If an interface element attracts more attention than the content itself, it is probably unnecessary.

Whitespace is preferred over decoration.

Typography is preferred over colors.

Hierarchy is preferred over borders.

---

## Information Density

The application should present as much useful information as possible without feeling crowded.

Avoid:

- large empty cards
- oversized buttons
- unnecessary icons
- repeated information
- decorative UI

Prefer:

- compact layouts
- consistent spacing
- strong typography
- progressive disclosure

Users should see only the information they need at the current moment.

More details should appear naturally as they explore.

---

# Product Goals

The project should achieve the following goals.

## Replace Swagger

Swagger UI is functional but visually outdated.

Its information architecture makes large APIs difficult to navigate.

Atlas should provide a dramatically better reading experience.

---

## Improve Scalar

Scalar introduced a cleaner design but still follows the traditional documentation model.

Atlas should move beyond documentation and become a developer workspace.

---

## Large APIs Should Feel Small

An API containing hundreds of endpoints should still feel approachable.

Developers should always know:

- where they are
- what this endpoint does
- what depends on it
- what to call next

Navigation should reduce cognitive load.

---

## Zero Learning Curve

A developer opening Atlas for the first time should immediately understand how to use it.

The interface should rely on familiar interaction patterns inspired by modern developer tools.

---

## Build Once

Documentation is generated from OpenAPI.

The OpenAPI specification is the single source of truth.

No duplicated metadata.

No manually maintained endpoint pages.

Everything is generated automatically.

---

# Non Goals

The project is NOT intended to become:

- another Postman
- an API Gateway
- an API Management Platform
- a monitoring tool
- a CI/CD tool
- a backend framework

Atlas focuses on one thing only:

Delivering the best API documentation and exploration experience possible.

---

# Inspiration

Positive inspirations:

- Stripe Documentation
- Vercel Dashboard
- Linear
- GitHub
- Apple Developer Documentation
- Raycast
- Notion

Negative inspirations:

- Swagger UI
- Bootstrap Admin Templates
- Material Design Dashboards
- Overdesigned SaaS Templates
- Heavy Enterprise UI

---

# Success Criteria

The project is successful if developers can:

- understand an endpoint within seconds
- navigate large APIs effortlessly
- find endpoints without searching documentation manually
- copy examples immediately
- understand schemas intuitively
- switch between resources without losing context
- test endpoints with minimal friction

The UI should feel almost invisible.

The API should become the primary focus.

---

# Long-Term Vision

Atlas should evolve into a complete API experience platform.

Future capabilities may include:

- AI-assisted endpoint discovery
- API relationship visualization
- Workflow documentation
- Interactive sequence diagrams
- SDK generation
- Changelog visualization
- Multi-version documentation
- Design system integration
- Plugin ecosystem

These features must never compromise the project's core values:

- simplicity
- speed
- clarity
- maintainability