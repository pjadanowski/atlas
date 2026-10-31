# Atlas — UI Components

## Overview

This document defines every reusable UI component in Atlas.

Each component has a single responsibility.

Components should be composable, predictable and independent.

No component should know more than necessary.

The UI should be assembled from these building blocks.

---

# Component Principles

Every component should:

- solve one problem
- have one clear responsibility
- remain reusable
- be accessible
- be keyboard friendly
- avoid unnecessary state
- follow the design system

Components should compose larger interfaces rather than becoming large themselves.

---

# Endpoint Header

## Purpose

Display endpoint identity.

---

## Contains

- HTTP Method
- Endpoint Path
- Human Title
- Summary
- Status Badges
- Authentication Badge

---

## Rules

Always visible.

Should never scroll independently.

Path uses monospace font.

HTTP method badge always aligned left.

---

## Accessibility

Screen reader announces:

"POST /orders — Create Order"

---

# Method Badge

## Purpose

Display HTTP method.

---

## Rules

Fixed width.

Never resize.

Uppercase.

Color determined by method.

GET

POST

PUT

PATCH

DELETE

---

# Status Badge

## Purpose

Communicate endpoint status.

---

## Types

Stable

Deprecated

Experimental

Internal

Beta

Required

Optional

---

## Rules

Pill shape.

Small.

No icons.

Never use more than two badges together.

---

# Sidebar

## Purpose

Primary navigation.

---

## Structure

Groups

↓

Resources

↓

Endpoints

---

## Behaviour

Collapsible.

Keyboard accessible.

Current endpoint highlighted.

Only one group expanded by default.

---

## Interaction

Arrow keys navigate.

Enter opens endpoint.

Left collapses.

Right expands.

---

# Search Dialog

## Purpose

Navigate documentation.

---

## Trigger

Ctrl + K

⌘ + K

---

## Contains

Input

Recent searches

Matching endpoints

Matching resources

---

## Behaviour

Instant filtering.

Keyboard navigation.

ESC closes.

---

# Parameter Row

## Purpose

Display one parameter.

---

## Collapsed State

Name

Required badge

Type

Short description

---

## Expanded State

Description

Validation

Default

Example

Enum

Related schema

---

## Rules

Accordion.

Never tables.

Lightweight rows.

---

# Request Body

## Purpose

Display request payload.

---

## Modes

Form

JSON

---

## Behaviour

Both stay synchronized.

Form is default.

JSON updates automatically.

---

# Schema Tree

## Purpose

Display object hierarchy.

---

## Supports

Objects

Arrays

Enums

Nullable

References

Recursive objects

---

## Behaviour

Expandable.

Collapsible.

File explorer feeling.

---

# Response Card

## Purpose

Display one response.

---

## Header

HTTP Status

Description

---

## Expanded

Headers

Schema

Example

Response body

---

# Code Block

## Purpose

Display copyable code.

---

## Features

Copy

Language

Wrap

Collapse

Expand

---

## Rules

Dark theme.

Maximum 18 visible lines.

---

# Playground

## Purpose

Execute requests.

---

## Sections

Environment

Authentication

Headers

Query

Body

Execute

Response

---

## Behaviour

Sticky.

Desktop only.

Lazy loaded.

---

# Response Viewer

## Purpose

Display API responses.

---

## Modes

Pretty

Raw

Headers

Timeline

---

## Header

HTTP Status

Response Time

Size

---

# Authentication Panel

## Purpose

Explain authentication.

---

## Contains

Authentication type

Header

Scopes

Examples

---

# Example Switcher

## Purpose

Switch between examples.

---

## Types

Minimal

Typical

Production

Enterprise

---

## Behaviour

Changing example updates:

JSON

Code snippets

Playground

---

# Code Sample Tabs

## Languages

curl

JavaScript

TypeScript

PHP

Laravel

Python

Go

Rust

Java

C#

---

## Rules

Generated automatically.

Never manually maintained.

---

# Relationship Graph

## Purpose

Visualize resource relationships.

---

## Example

Customer

↓

Orders

↓

Invoice

↓

Payment

---

## Behaviour

Interactive.

Nodes clickable.

---

# Changelog Timeline

## Purpose

Show endpoint evolution.

---

## Entries

Added

Changed

Deprecated

Removed

Breaking

---

# Empty State

Every empty state should explain:

Why nothing is shown.

What the user can do next.

Never display blank panels.

---

# Loading State

Avoid spinners.

Prefer skeletons.

Only show loading indicators when necessary.

---

# Error State

Errors should explain:

What happened.

Why.

How to recover.

Avoid technical jargon.

---

# Toast

Purpose

Short feedback.

---

## Types

Success

Warning

Error

Info

---

## Rules

Auto dismiss.

No stacking more than three.

---

# Dialog

Use for:

Confirmation

Settings

Keyboard shortcuts

---

## Behaviour

Focus trapped.

ESC closes.

Backdrop click configurable.

---

# Tooltip

Tooltips explain.

They never contain required information.

Everything inside a tooltip should be optional.

---

# Keyboard Navigation

Every interactive component must support keyboard navigation.

Focus order must be predictable.

Visible focus is mandatory.

---

# Responsive Behaviour

Desktop

Three columns.

Tablet

Two columns.

Playground below.

Mobile

Single column.

Sidebar becomes drawer.

Search becomes fullscreen.

---

# Component Composition

Large pages should be assembled from small components.

Example

EndpointPage

├── EndpointHeader

├── MethodBadge

├── StatusBadge

├── ParameterList

│ └── ParameterRow

├── RequestBody

├── ResponseList

│ └── ResponseCard

├── Playground

└── Changelog

No component should become a "God Component".

---

# Future Components

Reserved

AI Assistant

Workflow Viewer

Sequence Diagram

SDK Generator

Plugin Marketplace

API Graph Explorer