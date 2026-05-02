# Logger Design System

## Product Context

**Logger** is a self-hosted log aggregation web application for software teams. Multiple software projects ship JSON events (logs, errors with stack traces, user-agent, arbitrary attributes) to a central backend. Users — developers and operators — browse events, filter them across many fields, view dashboards with charts and counters, and configure threshold alerts that fire webhooks.

This is a **developer tool**, not a consumer product. Users spend long sessions staring at dense data tables and stack traces.

### Core Products / Surfaces

1. **Event Explorer** — the primary surface; dense table of log events, filterable, sortable, with a right-side drawer for event detail.
2. **Project Dashboard** — charts and counters (events/min, level breakdown, top errors).
3. **Alert Rule Editor** — filter builder + threshold condition + webhook channels.
4. **Settings** — org settings, project settings, member management, API keys, role permissions.
5. **Auth** — login, invite acceptance.

### Sources

This design system was created from scratch based on the product specification document provided. No external Figma link or codebase was attached.

---

## CONTENT FUNDAMENTALS

### Tone
- **Sober and technical.** Logger speaks like a senior engineer, not a startup marketer.
- **Direct.** No fluff, no exclamation marks, no "Amazing! Your log was saved."
- **Precise.** Use exact terminology: "event", not "log entry"; "fatal" not "critical".
- Errors are stated plainly: "Failed to save alert rule." Not "Oops, something went wrong."

### Casing
- UI labels: **Sentence case** (not Title Case). "Add filter", not "Add Filter".
- Navigation items: Title Case only for proper nouns (project names, org names).
- Buttons: Sentence case imperative verbs. "Send event", "Delete project", "Copy key".
- Error messages: Sentence case, no trailing period for short labels.

### Pronouns
- Address the user as **"you"** in onboarding/empty states: "You haven't sent any events yet."
- Use **"we"** sparingly; prefer passive or direct for system messages.

### Numbers & Data
- Timestamps: ISO-adjacent, 24h, relative where helpful ("2m ago").
- Large numbers: comma-separated (1,234,567).
- Durations: "15m", "1h", "7d" — abbreviated, no spaces.

### Emoji
- **Never used.** This is a developer tool.

### Example copy
- Empty events: "No events match your filters. Try adjusting the time range or removing a filter."
- Empty project: "No events yet. Send your first event to get started."
- Alert created: "Alert rule created."
- Destructive confirm: "This will permanently delete the project and all its events. This cannot be undone."

---

## VISUAL FOUNDATIONS

### Color Philosophy
Dark-first. All visual decisions are made against a near-black background (~#0d0d0f). Colors are desaturated enough to not fatigue long sessions, but vibrant enough to communicate severity at a glance.

**Brand accent:** Indigo-violet (`#6366f1`) — cool, technical, not red/orange (reserved for errors). Sits between blue (too generic/info) and purple (too playful). Has good contrast on dark surfaces and distinguishes from the info blue used in log levels.

### Color System
See `colors_and_type.css` and `preview/` cards for full token reference.

- **Neutral scale:** 12 steps, `--gray-0` (bg) through `--gray-11` (high-contrast text).
- **Surface/elevation:** base → raised → overlay, expressed as subtle gray steps.
- **Log level semantics:** debug (muted blue-gray), info (blue), warn (amber), error (red), fatal (deep red).
- **Status:** success (green), warning (amber), danger (red), info (blue).
- **Syntax highlight:** dual-theme Dracula-adjacent for dark, GitHub-adjacent for light.

### Typography
- **UI sans:** Geist Sans (Google Fonts fallback: Inter) — clean, highly legible at 13–14px, designed for code-adjacent interfaces.
- **Mono:** Geist Mono (Google Fonts fallback: JetBrains Mono) — for log messages, stack traces, IDs, code blocks.
- **Default body:** 13px. Density tool — every pixel matters.
- **Scale:** xs(12) → sm(13) → base(14) → md(15) → lg(16) → xl(18) → 2xl(22) → 3xl(28).
- **Weights:** 400, 500, 600. No bold (700+) — feels too heavy in dense UIs.

### Spacing
4px base unit. Common values: 4, 8, 12, 16, 24, 32. Table row padding: 0 8px. Card padding: 16px.

### Backgrounds
- No gradients. No illustrations. No textures.
- Background is flat dark (`#0d0d0f`). Surfaces are 1–2 steps lighter.
- Full-bleed images: never.
- Cards: subtle border + slightly lighter bg. No drop shadows on lists (performance).

### Radii
- Buttons/inputs/badges: 4px (sharp, technical feel).
- Cards/panels: 6px.
- Modals/drawers: 8px on the corner facing canvas.
- Table cells: 0px.

### Shadows
- Used only for elevated surfaces (modals, popovers, toasts, drawers).
- Dark theme: dark shadow + lighter border, NOT big blurry shadows.
- `--shadow-1`: subtle card lift; `--shadow-2`: popover/dropdown; `--shadow-3`: modal.

### Animation
- 150ms ease-out for micro-interactions (hover, focus, state changes).
- 200ms ease-out for medium entries (dropdowns, popovers).
- 250ms ease-out for large surfaces (modals, drawers).
- No springs. No bounces. No decorative animations.
- Respects `prefers-reduced-motion`.

### Hover / Press States
- Hover: `--surface-hover` bg (1 step lighter), no color shift on text.
- Press/active: `--surface-active` bg (slightly darker than hover).
- Danger hover: `--danger-hover` bg.
- No opacity tricks — explicit color tokens only.

### Borders
- Most surfaces use a 1px border in `--border-subtle`.
- Active/focused elements: `--border-default` (slightly brighter).
- Focus rings: 2px offset, `--accent` color with 40% alpha outer glow.

### Cards
- `--surface-raised` bg, 1px `--border-subtle`, `border-radius: 6px`.
- No drop shadow on cards within content areas (performance on dense lists).
- Drop shadow only on floating/elevated elements.

### Iconography
See ICONOGRAPHY section below.

### Imagery
- No photography, no illustration.
- Data visualization only: line charts, donut charts, bar charts.
- Chart palette: accent + semantic log level colors.

---

## ICONOGRAPHY

**Chosen library:** [Lucide Icons](https://lucide.dev) — loaded from CDN.

**Rationale:** Lucide has the best coverage for developer-tool UI patterns (log, filter, terminal, chevrons, copy, key, bell, settings, user, etc.). Stroke-based, 24px grid, scales well to 14–20px at 1.5px stroke. Consistent with Linear, Vercel, and modern dev tools aesthetic.

**Usage conventions:**
- Size: 14px for inline/compact contexts, 16px default UI, 20px for empty states.
- Stroke width: 1.5px always.
- Color: inherits `currentColor` — always set color on the parent element.
- Never use emoji as icons.
- No PNG icons in MVP — SVG/icon font only.

**CDN:**
```html
<!-- Lucide icon font via CDN -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
```

Or use inline SVG copies from `assets/icons/`.

---

## VISUAL TOKEN FILES

- `colors_and_type.css` — all CSS custom properties for colors, type, spacing, radii, shadows, motion, z-index.
- `preview/` — HTML card files for the Design System tab.
- `ui_kits/logger/` — full interactive UI kit for the Logger web app.
- `assets/` — any static assets.

---

## FILE INDEX

```
README.md                        — this file
SKILL.md                         — agent skill definition
colors_and_type.css              — all design tokens as CSS vars
preview/
  colors-neutrals.html           — neutral scale swatches
  colors-brand.html              — brand accent + tints
  colors-log-levels.html         — debug/info/warn/error/fatal
  colors-status.html             — success/warning/danger/info
  colors-syntax.html             — syntax highlight palette
  type-scale.html                — font size + weight scale
  type-mono.html                 — monospace specimens
  spacing-tokens.html            — spacing + radii + shadow tokens
  components-buttons.html        — button variants + states
  components-badges.html         — badges + log level badges
  components-inputs.html         — inputs, textarea, select, checkbox, switch
  components-table.html          — dense table specimen
  components-filter-bar.html     — filter bar + chips
  components-drawer.html         — event detail drawer
  components-overlays.html       — modal, toast, tooltip, popover
  components-navigation.html     — sidebar, tabs, breadcrumbs
  components-data.html           — code block, key-value, JSON tree
  layout-app-shell.html          — app shell layout diagram
ui_kits/logger/
  index.html                     — interactive Logger prototype
  AppShell.jsx                   — sidebar + topbar layout
  EventsPage.jsx                 — event explorer (table + filter bar)
  EventDrawer.jsx                — event detail drawer
  DashboardPage.jsx              — project dashboard
  AlertEditor.jsx                — alert rule editor
  SettingsPage.jsx               — settings layout
  AuthPage.jsx                   — login + invite pages
  Components.jsx                 — shared low-level components
```
