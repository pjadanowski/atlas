# Atlas — Development Rules

## Purpose

This document defines the engineering standards for the project.

Every implementation must follow these rules.

If there is a conflict between implementation convenience and these rules, the rules always win.

---

# General Principles

The project values:

- simplicity
- readability
- maintainability
- performance
- accessibility
- consistency

Avoid clever solutions.

Prefer obvious code.

Code is read much more often than it is written.

---

# Simplicity First

Prefer the simplest solution that correctly solves the problem.

Never introduce abstractions before they are needed.

Never solve future problems.

Only solve today's problem.

---

# Static First

Everything that can be generated during build must be generated during build.

Never move work to the browser unless absolutely necessary.

The browser should only enhance static HTML.

---

# Progressive Enhancement

Documentation must remain usable without JavaScript.

JavaScript should only improve the experience.

Never require JavaScript to read documentation.

---

# Dependencies

Dependencies are long-term maintenance costs.

Before installing a dependency ask:

- Can this be implemented with native browser APIs?
- Can this be implemented in under 300 maintainable lines?
- Does the dependency significantly improve accessibility?
- Does it improve performance?

If the answer is no, do not install it.

---

# Prefer Native APIs

Prefer:

fetch()

URL

URLSearchParams

IntersectionObserver

ResizeObserver

Clipboard API

Popover API

Dialog

details / summary

CSS Variables

View Transitions API (when supported)

Avoid libraries that only wrap browser APIs.

---

# HTML First

Prefer semantic HTML.

Use:

header

main

section

article

aside

nav

details

summary

button

label

fieldset

Never build everything with divs.

---

# CSS Before JavaScript

If CSS can solve a problem,

do not use JavaScript.

Examples:

animations

responsive layouts

theme

hover

focus

sticky elements

transitions

---

# JavaScript Last

JavaScript should only exist when HTML or CSS cannot solve the problem.

Avoid unnecessary state.

Avoid unnecessary effects.

Avoid unnecessary event listeners.

---

# Code Style

Prefer explicit code.

Avoid clever one-liners.

Avoid deeply nested logic.

Prefer early returns.

Prefer small functions.

---

# Functions

Functions should:

- do one thing
- have descriptive names
- avoid side effects
- be easy to test

Target size:

20–40 lines.

Maximum:

60 lines.

---

# Components

Components should have one responsibility.

Examples:

Good

MethodBadge

EndpointHeader

ParameterRow

ResponseCard

SearchInput

Bad

ApiDocumentation

EverythingPage

UniversalCard

---

# Component Size

Target

100–150 lines.

Maximum

250 lines.

Split components instead of creating giant files.

---

# File Size

Target

200 lines.

Maximum

350 lines.

Split large files.

---

# Folder Structure

Group by feature.

Good

features/

    search/

    endpoint/

    playground/

Bad

components/

helpers/

utils/

misc/

Avoid dumping unrelated files into shared folders.

---

# State Management

Keep state local whenever possible.

Lift state only when necessary.

Avoid global state.

Never introduce a state library without strong justification.

---

# Data Flow

Data should always flow downward.

Avoid hidden mutations.

Avoid shared mutable state.

Prefer immutable data.

---

# Error Handling

Every expected failure should be handled gracefully.

Never silently ignore errors.

Error messages should help users recover.

---

# Accessibility

Accessibility is not optional.

Every feature must support:

keyboard navigation

visible focus

screen readers

reduced motion

high contrast

Semantic HTML first.

ARIA only when necessary.

---

# Performance

Performance is a feature.

Every implementation should minimize:

JavaScript

DOM nodes

layout shifts

repaints

memory usage

network requests

---

# Lazy Loading

Lazy load only expensive features.

Examples:

AI

Try It

Monaco

Never lazy load core navigation.

---

# Search

Search must always feel instant.

Never block the UI.

Never perform unnecessary work.

---

# API Calls

Use native fetch().

Never install Axios.

Use AbortController when appropriate.

Support request cancellation.

---

# Styling

Use design tokens.

Never hardcode colors.

Never hardcode spacing.

Never hardcode typography.

Everything comes from the design system.

---

# Naming

Names should describe intent.

Good

EndpointSchema

ResponseViewer

MethodBadge

Bad

Item

Card2

Utils

Manager

Handler

Processor

---

# Comments

Write self-explanatory code.

Comments explain "why".

Code explains "how".

Avoid redundant comments.

---

# Logging

Do not leave debug logs.

No console.log() in production.

Use structured logging when necessary.

---

# Testing

Business logic should be testable.

Avoid coupling logic to the UI.

Pure functions are preferred.

---

# Git

Every commit should represent one logical change.

Avoid unrelated modifications.

Keep commits small.

---

# Refactoring

If a better design becomes obvious during implementation,

refactor immediately.

Do not accumulate technical debt intentionally.

---

# Security

Never trust external input.

Escape user content.

Validate all data.

Avoid unsafe HTML injection.

One sanctioned exception: `--allow-spec-html` renders HTML-authored
specification descriptions verbatim (markdown-authored ones still go through the
allowlist). It is opt-in, off by default, and documented as trading safety for
expressiveness — the spec is then treated as trusted input, at the same level as
the project's own templates. Do not "fix" it by adding a sanitizer: the previous
one was removed for being bypassable, and a partial filter misleads more than an
explicit switch.

---

# Documentation

Public functions should be understandable from their names.

Document complex algorithms.

Keep documentation synchronized with the code.

---

# Decision Making

When multiple solutions exist:

Choose the one that is:

- simpler
- smaller
- faster
- easier to understand
- easier to maintain

Never choose the most clever solution.

---

# Definition of Done

A feature is complete only when:

- it works
- it is accessible
- it is responsive
- it follows the design system
- it follows architecture rules
- it contains no unnecessary dependencies
- it introduces no regressions
- it keeps performance within budget
- the implementation is understandable by another developer

Working code is not enough.

Good code is the goal.