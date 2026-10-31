# Atlas — Design System

## Design Philosophy

The interface should disappear.

Developers should focus on understanding the API, not on understanding the interface.

Every design decision should reduce cognitive load.

Visual beauty is a consequence of consistency, not decoration.

Whitespace is preferred over borders.

Typography is preferred over colors.

Hierarchy is preferred over decoration.

Information density is preferred over oversized components.

---

# Design Principles

The design system follows these principles.

1. Minimal visual noise.
2. Strong typography hierarchy.
3. Consistent spacing.
4. Very limited color palette.
5. Every component has one purpose.
6. Every pixel should improve readability.
7. Progressive disclosure over overwhelming screens.
8. Interfaces should feel calm.
9. Motion should explain, never decorate.
10. Content is always more important than UI.

---

# Visual Inspiration

Positive references

- Stripe Documentation
- Stripe Dashboard
- Linear
- Vercel
- GitHub
- Apple Developer Documentation
- Raycast
- Notion

Avoid visual inspiration from

- Swagger UI
- Material Design Dashboards
- Bootstrap
- Ant Design
- Admin templates
- Glassmorphism
- Dribbble concepts

---

# Typography

Primary Font

Instrument Sans Variable

Monospace

JetBrains Mono

Never use more than two font families.

Typography Scale

H1

30px

700

1.15 line-height

H2

22px

700

H3

18px

700

Section Title

16px

650

Body

14px

450

1.65 line-height

Small

13px

Sidebar Labels

11px

uppercase

0.08em letter spacing

Method Badges

10px

700

Parameter Names

13.5px

600

Code

12.5px

JetBrains Mono

---

# Color System

Colors must never be used directly inside components.

Always use design tokens.

Surface

--surface-0

--surface-1

--surface-2

Borders

--border

Text

--text-primary

--text-secondary

--text-muted

Accent

--accent

--accent-soft

Status

--success

--warning

--danger

Code

--code-bg

--code-border

--code-string

--code-key

--code-number

--code-keyword

--code-comment

---

# Light Theme

Background

#ffffff

Panels

#fafafb

Borders

#e7e8ec

Primary Text

#17181c

Secondary Text

#5c6070

Muted Text

#9296a5

Accent

#5b5bd6

---

# Dark Theme

Background

#0e0f13

Panels

#111318

Borders

#23252e

Primary Text

#f0f1f5

Secondary Text

#a2a7b6

Muted Text

#707585

Accent

#7778ff

---

# Code Theme

Code blocks remain dark in both themes.

Background

#0e1017

Surface

#151827

Border

#232841

Syntax

Keys

#79b8ff

Strings

#93d3a2

Numbers

#f2b46d

Keywords

#c792ea

Comments

#586080

---

# HTTP Colors

GET

#1a9c6b

POST

#3d7bfa

PUT

#d98a13

PATCH

#d98a13

DELETE

#e5484d

Use identical colors for HTTP status groups.

2xx

Success

3xx

Info

4xx

Warning

5xx

Danger

---

# Layout

Desktop

Header

57px

Sidebar

264px

Content

max-width 680px

Playground

480px

Minimum viewport

1280px

Each column scrolls independently.

---

# Spacing

Use an 8px spacing system.

4

8

12

16

24

32

40

48

64

Never invent arbitrary spacing values.

---

# Vertical Rhythm

Sections

40px

Cards

24px

Rows

16px

Paragraphs

20px

Lists

12px

---

# Radius

Navigation

8px

Inputs

10px

Buttons

10px

Cards

12px

Code

14px

Badges

999px

---

# Borders

Use only 1px borders.

Never use thick borders.

Never rely on shadows for hierarchy.

Hierarchy should be built using:

background

spacing

typography

---

# Shadows

Avoid shadows completely.

If needed

very subtle

only elevation level 1.

---

# Motion

Animations must feel invisible.

Duration

150ms

Easing

ease-out

Animate only

opacity

transform

height

Never animate

width

box-shadow

border-radius

filter

blur

---

# Icons

Use Lucide icons.

Icons should support understanding.

Never use icons as decoration.

Maximum size

16px

Section icons

18px

---

# Buttons

Only three variants.

Primary

Secondary

Ghost

Avoid tertiary button styles.

---

# Inputs

Minimal appearance.

Strong focus state.

No heavy borders.

No inset shadows.

---

# Focus

Visible on every interactive element.

2px outline.

Accent color.

2px offset.

Accessibility always wins over aesthetics.

---

# Navigation

The sidebar should resemble the VSCode Explorer.

Resources behave like folders.

Endpoints behave like files.

Expand/collapse animation

150ms.

Only one section expanded by default.

---

# Parameters

Parameters are rows.

Not tables.

Not cards.

Rows should feel lightweight.

Expanded state reveals

description

validation

default

examples

related schemas

---

# Code Blocks

Maximum visible height

18 lines.

Long blocks collapse automatically.

Users may expand.

Every code block has

Copy

Wrap

Language

---

# White Space

Never add empty space without purpose.

Whitespace should improve reading speed.

It should never feel decorative.

---

# Accessibility

WCAG AA

Keyboard navigation

Visible focus

Reduced motion support

Minimum contrast ratio

4.5:1

Everything should be usable without a mouse.

---

# Visual Anti-Patterns

Never use

- giant cards
- dashboards
- neumorphism
- glassmorphism
- oversized buttons
- floating action buttons
- thick shadows
- multiple accent colors
- rainbow badges
- marketing illustrations
- excessive animations

If removing a visual element improves readability,

remove it.

# Component Philosophy

Every component should communicate one thing.

Examples

Method Badge

Communicates HTTP method.

Nothing else.

Parameter Row

Communicates one parameter.

Nothing else.

Endpoint Header

Communicates endpoint identity.

Nothing else.

Response Card

Communicates one response.

Nothing else.

Search

Communicates navigation.

Nothing else.

Avoid components trying to solve multiple problems simultaneously.