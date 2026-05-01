# Design System Prompt

> **How to use**: Copy everything between the `--- BEGIN PROMPT ---` and
> `--- END PROMPT ---` markers and paste it into Claude (or any other design
> tool). Adjust the brand color and inspiration list if you have stronger
> preferences before pasting.
>
> Output goal: a complete, implementation-ready design system that we will
> translate into SCSS variables, CSS custom properties, and a `shared/components/`
> UI kit. We are NOT asking for code — just visual specs and tokens.

---

--- BEGIN PROMPT ---

# Design a complete design system for "Logger" — a self-hosted log aggregation web app

## What the product is

Logger is an internal-use, self-hosted SaaS-style web application where multiple
software projects ship JSON events (logs, errors with stack traces, user-agent,
arbitrary attributes) to a central backend. Users — developers and operators —
browse events, filter them across many fields, view dashboards with charts and
counters, and configure threshold alerts that fire webhooks.

It is a **developer tool**, not a consumer product. Users spend long sessions
staring at dense data tables and stack traces. Aesthetic priorities:

- **Density over whitespace** — show a lot of structured data per screen.
- **Readability over decoration** — high contrast, no flourish.
- **Sober, technical tone** — no gradients, no illustrations, no marketing energy.
- **Dark theme is the default and primary surface.** Light theme is a fallback.

## Aesthetic targets (look at these for direction)

- **Linear** — clarity, type, dense lists, refined micro-interactions.
- **Sentry** — error display, severity coloring, stack trace presentation.
- **Vercel dashboard** — clean dark surfaces, dashboard composition.
- **Datadog** — information density, log explorers, filter chips.
- **Axiom / Logflare** — log-specific UI patterns.

Avoid: Stripe-style colorful gradients, Notion-style soft pastels, anything
"friendly consumer SaaS".

## What to deliver

A complete design system spec covering:

1. **Design tokens** — colors, typography, spacing, radii, shadows, motion, z-index.
2. **Themes** — dark (primary) and light. Both must use CSS custom properties.
3. **Iconography** — recommend an icon set (Lucide, Phosphor, Tabler, etc.) and
   stroke/size conventions.
4. **Component library** — visual specs for each component below, including
   states (default, hover, focus, active, disabled, loading, error).
5. **Layout primitives** — app shell, page layouts, common patterns.
6. **Specific custom patterns** — listed below in §"Specific patterns".
7. **Accessibility** — contrast targets (WCAG AA min, AAA preferred for body
   text), focus ring spec, keyboard nav notes.

For every choice, **include rationale**: why this color, why this spacing,
why this radius. We will be defending these decisions later.

## Design tokens — required scope

### Colors

- **Brand accent** — one primary brand color. Suggest something cool,
  technical, not red/orange (red is reserved for `error`/`fatal` log levels).
  Blue or violet are good defaults. Justify the pick.
- **Neutral scale** — 12 steps from background to highest-contrast text, for
  both dark and light themes. Include surface/elevation steps (base, raised,
  overlay).
- **Semantic colors for log levels** (these are central to the product):
  - `debug` — muted grey/blue, low salience
  - `info` — neutral blue
  - `warn` — amber/yellow
  - `error` — red
  - `fatal` — deeper / saturated red, distinguishable from `error` at a glance
  Each level needs: background, border, text foreground variants.
- **Status colors** — success, warning, danger, info (separate from log levels;
  used for toasts, alerts, form validation).
- **Syntax highlight palette** — for code blocks and stack traces (string,
  number, keyword, comment, function, error highlight). Both themes.

### Typography

- **Sans-serif for UI** — recommend a font (Inter, Geist, IBM Plex Sans, etc.)
  and justify.
- **Monospace** for: log messages, code blocks, stack traces, IDs (request_id,
  trace_id, api keys), JSON attributes. Recommend a font (JetBrains Mono,
  Geist Mono, IBM Plex Mono).
- **Scale**: at least `xs (12) / sm (13) / base (14) / md (15) / lg (16) /
  xl (18) / 2xl (22) / 3xl (28)`. Default body size should be 13–14 px — this
  is a dense tool.
- **Weights**: regular (400), medium (500), semibold (600). Avoid 700+.
- **Line heights**: tighter for headings, looser for body. Specify exact values.

### Spacing

- 4px-based scale: `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- Specify default gap, padding, and margin recommendations for common cases.

### Radii

- Small (4 px) — inputs, buttons, badges, chips.
- Medium (6–8 px) — cards.
- Large (10–12 px) — modals, popovers.
- None (0) where pixel-precise borders are needed (table cells).

### Shadows

- Subtle and used only for elevated surfaces (modals, popovers, dropdowns,
  toasts). Provide 3 elevations.
- On dark theme, prefer **darker shadow + lighter border** rather than huge
  blurry shadows. Specify exact rgba values.

### Motion

- Default duration 150 ms, easing `ease-out` (cubic-bezier values welcome).
- Slightly longer (200–250 ms) for entry of larger surfaces (drawers, modals).
- No springs, no bounces.
- Respect `prefers-reduced-motion`.

### z-index

- Specify a layered scale: base content, sticky headers, dropdowns, popovers,
  drawers, modals, toasts, tooltips.

## Components to spec

For each component: visual mockup or detailed annotated spec, listing all
states (default, hover, focus, active, disabled, loading, error, empty),
sizes (sm/md/lg where applicable), and any variants.

### Form controls
- Button — variants: primary, secondary, ghost, danger, link. Sizes: sm, md.
  Include icon-only and icon+text variants.
- IconButton
- Input (text, number, search with leading icon)
- Textarea
- Select (single)
- Multi-select / Combobox with chips inside
- Checkbox, Radio, Switch
- DateRangePicker (presets: 15m / 1h / 6h / 24h / 7d / custom)

### Display
- Badge — generic + **log-level badge** (5 distinct visual variants) + status badge
- Tag / Chip (used in filter bars; needs an "×" remove affordance)
- Tooltip
- Avatar (initials fallback; users have no upload in MVP)
- Stat / KPI card (label, value, optional delta)
- Code block — monospace, with line numbers, copy button, optional syntax highlight
- Inline code (`<code>`)
- Stack trace viewer — collapsible frames, file:line, function name,
  syntax-highlighted source preview when available
- KeyValue list — for displaying attributes/context (left column key, right
  column value, value can be a string, number, JSON tree)
- JSON tree viewer — collapsible nested JSON

### Overlays
- Popover
- Dropdown menu
- Modal / Dialog
- **Drawer** — right-side, used for event detail; design carefully, this is a
  primary surface
- Toast / Snackbar
- Confirmation dialog (variant of modal)

### Navigation
- Sidebar (primary nav, collapsible)
- Top bar / app shell header (org switcher, project switcher, user menu)
- Tabs (underline style, dense)
- Breadcrumbs
- Pagination (simple prev/next with page count, used in events list)

### Data display
- Table — **the most important component**:
  - Dense rows (32–36 px height target)
  - Sticky header
  - Row hover
  - Sortable columns with sort indicators
  - Resizable columns (visual only, behavior is engineering)
  - Sticky first/last column option
  - Selection (checkbox column) optional
  - Empty / loading / error rows
- Filter bar — combination of:
  - Free-text search input
  - Filter chips (active filters)
  - "Add filter" dropdown trigger
  - Time range picker
- Skeleton loaders for tables, cards, charts

### Feedback states
- Empty state — friendly but not silly. Includes title, supporting text,
  optional CTA. Specifically design: "no events yet", "no projects yet",
  "no alerts yet", "no members yet".
- Loading state — prefer skeleton over spinner; spinner only for buttons.
- Error state — clear, with retry CTA when applicable.

## Layout patterns

- **App shell** — left sidebar (~240 px, collapsible to icons-only ~56 px) +
  top bar (~48 px) + content. Sidebar nav has org switcher at top, project
  list/picker, settings link at bottom.
- **List + detail (drawer)** — events page: table fills content area; clicking
  a row opens a right drawer (~520 px wide) with full event detail. Drawer
  must be dismissible without navigation away.
- **Dashboard** — grid of widgets. Specify a 12-column grid; widgets span 3,
  4, 6, 8, or 12 columns.
- **Settings** — nested left nav (sub-sidebar) + content. Used for org
  settings, project settings, account.
- **Empty project state** — full-page CTA: "Send your first event", with copy
  showing curl example.

## Specific patterns to design (most important visuals)

These are the screens / components where good design makes the biggest impact.
Provide detailed mockups for each:

1. **Event row in table** — timestamp · level badge · message (monospace,
   single line, ellipsis) · source · environment · expand chevron.
2. **Event detail drawer** — header with level badge, message, timestamp;
   tabs for "Details / Attributes / Context / Stack trace"; copy-as-JSON button.
3. **Filter bar with chips** — `level: error, fatal × | environment: prod × |
   message contains "timeout" × | + Add filter | [time range picker]`.
4. **Time range picker** — preset list on left, custom inputs on right.
5. **Alert rule editor** — filter builder (reuses event filter UI) + condition
   row ("count ≥ N within M minutes") + channels list.
6. **Role permission matrix** — grouped checkboxes (Organization / Members /
   Projects / Events / Alerts / API keys), with select-all per group.
7. **API key creation modal** — name input → generated key shown ONCE with
   "Copy" button and "I've saved it" confirmation; afterwards the key is masked.
8. **Project dashboard** — events-per-minute line chart, level breakdown
   donut, environment bar chart, top messages table, recent errors list.
9. **Long stack trace** — collapsible by default, syntax-highlighted, frame
   chevrons, expand-all / collapse-all.
10. **Login & invite acceptance** — minimal centered card; invite shows org
    name and inviter.

## Constraints

- **No Tailwind, no CSS-in-JS.** Output tokens as CSS custom properties so we
  can wire them straight into SCSS modules.
- **Desktop-first.** Must look correct from 1280 to 1920 px wide. Mobile is
  not a primary target — design must remain usable on smaller screens but
  optimization is desktop.
- **Dark theme first.** Light theme parity required, but visual decisions
  should be made on dark.
- **Performance**: avoid effects that require heavy compositing (large
  blurs everywhere, multiple drop shadows on hot lists).

## Output format

Please structure the deliverable in this exact order so we can map sections
to implementation files:

1. **Design philosophy** — 1 page, the "why" behind the system.
2. **Color tokens** — table per palette (neutrals, brand, log levels, status,
   syntax) with hex values for both themes and a one-line semantic description.
3. **Typography tokens** — font choice + scale table + line-height table.
4. **Spacing, radii, shadows, motion, z-index** — concise tables.
5. **Iconography** — chosen library, sizes, stroke width.
6. **Components** — one section per component, with mockup, states, sizes,
   variants, and behavior notes.
7. **Layout patterns** — labeled diagrams for app shell, list/detail, dashboard,
   settings.
8. **Specific patterns** — detailed mockups for the 10 patterns listed above.
9. **Accessibility** — contrast audit, focus rings, keyboard interaction notes.
10. **Open questions** — flag any decisions you made without enough info, or
    suggest variations worth considering.

If anything in this brief is ambiguous or you would push back on a choice,
**say so before producing the system** and ask. We prefer a smaller number of
deliberate decisions over a larger pile of generic ones.

--- END PROMPT ---

---

## Notes for us (not part of the prompt)

- The prompt deliberately does **not** ask for code. We want spec + visuals;
  we'll do the SCSS conversion ourselves to keep tokens consistent with our
  module structure.
- After we receive the design system, we'll extract:
  - `app/styles/tokens.scss` — CSS custom properties for both themes
  - `app/styles/_typography.scss`, `_spacing.scss`, etc.
  - `shared/components/` — one folder per component, each with `.module.scss`
- Screens (per-feature mockups) will be requested feature by feature, after
  each feature is detailed in PLAN.md. Those prompts will live next to this
  one in `docs/prompts/`.
