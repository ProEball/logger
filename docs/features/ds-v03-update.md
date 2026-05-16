# Design System v0.3.0 Update (side track)

> Dracula (JetBrains) palette · JetBrains Mono · 3-column shell · new domain pieces
>
> Source: `C:\Users\birko\Downloads\Logger-handoff\logger-tmp\project\`
> — `design-system/tokens.css` — full token spec (dark + light)
> — `design-system/foundations.html` — color / type / spacing / radii / motion
> — `design-system/components.html` — button / input / badge / card / feedback matrix
> — `design-system/patterns.html` — sidebar / tabs / breadcrumbs / ⌘K / log rows / charts / domain
> — `Logger Dashboard.html` — full dashboard layout (3-col shell, org rail, KPI row, etc.)

## Status

- Started: 2026-05-11
- Last touched: 2026-05-11
- Current phase: **Complete**
- Progress: 7 / 7 phases done

## What changes vs the previous DS

| Category | Before | After |
|---|---|---|
| Palette | Near-black neutral gray (`#0d0d0f` base) | Dracula mid-dark (`#282a36` base) |
| Accent | Indigo-violet `#6366f1` | Purple `#bd93f9` |
| Info level | Blue `#3b82f6` | Cyan `#8be9fd` |
| Fatal level | Dark-red `#dc2626` | Pink `#ff79c6` |
| Token naming | `--text-primary`, `--accent`, `--border-default` | `--fg`, `--purple`, `--border-1` |
| Radii | 4 / 6 / 8 / 9999 px | 3 / 5 / 7 / 10 / 999 px |
| Motion | 100 / 150 / 200 / 250 ms, no spring | 120 / 180 / 280 / 420 ms + spring easing |
| App shell | 2-col (sidebar + content) | 3-col (org rail 56px + sidebar 240px + content) |
| Fonts | Geist + Geist Mono (next/font) | Geist + **JetBrains Mono** (next/font/google) |

## Locked decisions

- **Full token migration** — rename `--text-primary` → `--fg`, `--accent` → `--purple`, etc. No alias shim. Reason: two naming systems in one codebase create permanent confusion. All 39 components update alongside their visual changes.
- **JetBrains Mono replaces Geist Mono** — loaded via `next/font/google` (same mechanism). `--font-mono` var updated.
- **Dark-first** convention stays: `:root, [data-theme="dark"]` share the same block; `.light` / `[data-theme="light"]` is a full override.
- **OrgRail is a new shared component** (`shared/components/OrgRail/`) — not part of Sidebar. Reason: separate concern (org switching vs project navigation); separate background (`--bg-rail` vs `--bg-sidebar`).
- **Token file names kept** — `_tokens.scss` and `_themes.scss` stay; only content changes. Avoids a cascade of import-path fixes.
- **New spacing names in design system** (`--s-1` … `--s-16`) are aliases over existing `--space-*` tokens in SCSS vars — we keep `--space-*` in the token file (more idiomatic SCSS) but also expose the `--s-*` shorthand names the DS docs use, so component SCSS can use either.

## File map — what changes

```
app/
  globals.scss             — scrollbar, selection (--purple-soft), base font-size 13.5px
  layout.tsx               — swap Geist_Mono → JetBrains_Mono (next/font/google)
  styles/
    _tokens.scss           — radii values, motion values, add --t-spring, add --rail-width
    _themes.scss           — full palette rewrite (Dracula dark + light)
    _mixins.scss           — update focus-ring, level-colors, surface-* mixins

shared/components/
  AppShell/                — 3-col grid (rail + sidebar + content), overflow:hidden
  OrgRail/                 — NEW: 56px rail, logo, org pills, bottom icons
  Sidebar/                 — org section header, project tree inline expand, live dots
  Topbar/                  — height 52px, backdrop-filter blur, breadcrumbs + theme switcher
  Button/                  — purple accent, new hover values, spinner, focus outline
  IconButton/              — verify framed variant
  Input/                   — h30, purple focus ring + purple-soft shadow
  Textarea/                — same as Input
  Select/                  — CSS chevron update
  Checkbox/                — 14×14, purple checked state
  Radio/                   — 14×14 dot, purple border on checked
  Switch/                  — 30×17 track, 13×13 thumb, translateX(13px)
  LevelBadge/              — cyan info, orange warn, pink fatal, muted-blue debug
  StatusBadge/             — map to new palette (green/orange/red/cyan)
  FormField/               — label 12px/fg-2/500, hint+error 11.5px
  Tabs/                    — underline purple, segmented control, count badge variants
  Modal/                   — head/body/foot structure, radial gradient backdrop
  Toast/                   — border-left accent, 4 variants
  Tooltip/                 — dark bubble (#14151c), CSS arrow, kbd hint support
  Popover/                 — menu style: ph header, pi items, kbd hints, danger variant, hr
  FilterBar/               — chip colored variants (purple/cyan/green/orange/red)
  Breadcrumbs/             — env tag (green pill)
  Table/                   — eyebrow headers, --bg-sidebar thead, hover, mono numerics
  CodeBlock/               — Dracula syntax colors, gutter update
  JsonTree/                — key cyan, string yellow, number purple, bool pink, null fg-4
  CountPill/               — NEW: 18px pill, live pulse animation (green)
  EmptyState/              — NEW: 44×44 icon box + h4 + p + CTA
  Combobox/                — NEW: search input + grouped opts + checkmarks + rate meta
  CommandPalette/          — NEW: ⌘K modal, grouped results, keyboard hints footer
  Timeline/                — NEW: vertical line + level-colored dots + time/title/desc
  ConfirmDialog/           — update to new Modal structure
  Drawer/                  — update backdrop + header tokens
  Skeleton/                — update shimmer color to Dracula palette
  Skeletons/               — same
```

Feature-level new components (not shared — belong to their own feature):
```
features/dashboard/components/KpiCard/     — mono value, delta badge, sparkline, meta
features/alerts/components/AlertCard/      — left-border accent, state badge, cond code, sparkline
features/projects/components/ProjectCard/  — status dot+glow, stats grid 3-col, sparkline
```

## Implementation Checklist

### Phase 1 — Tokens + Fonts (BLOCKS EVERYTHING) [ ]

- [x] **1.1** `app/layout.tsx` — remove `Geist_Mono`, add `JetBrains_Mono` from `next/font/google`; expose as `--font-jetbrains-mono` CSS var; update `--font-mono` reference
- [x] **1.2** `app/styles/_tokens.scss` — update radii values (`--radius-sm: 3px`, `--radius-md: 5px`, `--radius-lg: 7px`, add `--radius-card: 10px`); update motion (`--duration-fast: 120ms`, `--duration-base: 180ms`, `--duration-slow: 280ms`); add `--t-spring: 420ms cubic-bezier(.34,1.56,.64,1)`; add `--rail-width: 56px`; add `--s-*` aliases (`--s-1` … `--s-16`) mapping to `--space-*`
- [x] **1.3** `app/styles/_themes.scss` — full rewrite: Dracula dark palette (surfaces, borders, fg ramp, 7 Dracula hues + soft variants, lvl-* colors, shadows, glow, focus ring); Dracula light palette (warm paper variant from `tokens.css .light`)
- [x] **1.4** `app/styles/_mixins.scss` — update `focus-ring` mixin to use `var(--purple-soft)` / `var(--border-focus)`; update `surface-*` mixins to new token names; update `level-colors` mixin to new `--lvl-*` tokens; update `status-colors` mixin
- [x] **1.5** `app/globals.scss` — scrollbar thumb → `var(--border-2)`, hover → `var(--fg-4)`; `::selection` → `background: var(--purple-soft); color: var(--fg)`; body `font-size: 13.5px; line-height: 1.55`
- [x] **1.6** `npm run lint && npm run build` — green (token layer only, components still on old names — will break visually but not compile)

---

### Phase 2 — Primitive components [ ]

- [x] **2.1** `Button` — primary: `var(--purple)`, hover `#c9a4fa`, color `var(--on-accent)`, weight 600; default: `var(--bg-raised)` / hover `var(--bg-hover)` / border `var(--border-1)`; ghost: transparent bg+border; destructive: `var(--red)` / hover `#ff7373`; sizes: `h: 30px / 24px / 36px`; padding: `0 12px / 0 8px / 0 16px`; font-size: `12.5px / 11.5px / 13.5px`; focus: `outline: 2px solid var(--border-focus); outline-offset: 1px`; loading spinner (CSS `.spin` 12×12, border-right transparent)
- [x] **2.2** `IconButton` — verify 30×30 ghost + framed variant (bg-raised + border-1), 24×24 `.sm`
- [x] **2.3** `Input` — height `30px`; border `var(--border-1)`; focus: `border-color: var(--purple); box-shadow: 0 0 0 3px var(--purple-soft)`; hover: `var(--border-2)`; invalid: `var(--red)` + red-soft shadow; placeholder `var(--fg-4)`
- [x] **2.4** `Textarea` — same token updates as Input; min-height `72px`; padding `8px 10px`
- [x] **2.5** `Select` — chevron: CSS `::after` 8×8, rotate 45deg, `var(--fg-3)`; same focus/hover as Input
- [x] **2.6** `Checkbox` — 14×14 box; `border-radius: var(--radius-sm)` (3px); unchecked: `var(--bg-input)` + `var(--border-2)` border; checked: bg `var(--purple)` + border `var(--purple)` + SVG checkmark `var(--on-accent)`; focus: `box-shadow: 0 0 0 3px var(--purple-soft)`
- [x] **2.7** `Radio` — 14×14; unchecked: `var(--bg-input)` + `var(--border-2)`; checked: `border-color: var(--purple)` + inner dot 6×6 `var(--purple)` scale(0→1); focus: `var(--purple-soft)` shadow
- [x] **2.8** `Switch` — track `30×17px` padding `2px`; thumb `13×13px`; unchecked: track `var(--bg-active)`, thumb `var(--fg)`; checked: track `var(--purple)`, thumb `var(--on-accent)` translateX(13px)
- [x] **2.9** `LevelBadge` — debug: `var(--lvl-debug)` + `rgba(98,114,164,.18)` bg; info: `var(--lvl-info)` + `var(--cyan-soft)`; warn: `var(--lvl-warn)` + `var(--orange-soft)`; error: `var(--lvl-error)` + `var(--red-soft)`; fatal: `var(--lvl-fatal)` + `var(--pink-soft)`; dot `::before` 5×5
- [x] **2.10** `StatusBadge` — remap to new palette tokens (success→green, warning→orange, danger→red, info→cyan)
- [x] **2.11** `Skeleton` — shimmer gradient update to Dracula mid-darks
- [x] **2.12** `npm run lint && npm run build` — green

---

### Phase 3 — Composite components [ ]

- [x] **3.1** `FormField` — label: `12px / var(--fg-2) / weight-500`; hint: `11.5px / var(--fg-3)`; error: `11.5px / var(--red)`
- [x] **3.2** `Tabs` — active: `border-bottom: 2px solid var(--purple); color: var(--fg); font-weight: 500`; inactive: `var(--fg-3)`, hover `var(--fg)`; count badge: inactive `var(--bg-active) / var(--fg-3)`, active `var(--purple-soft) / var(--purple)`; segmented control: bg `var(--bg-sidebar)` + border, active `var(--bg-active) / var(--fg)`; tab height: `padding: 9px 14px 11px`
- [x] **3.3** `Modal` — head: `padding: 16px 18px 4px`, icon block 32×32 (`border-radius: var(--radius-md)`, semantic bg/color per intent), h4 `15px`, p `12.5px / var(--fg-3)`; body: `padding: 0 18px 14px`; foot: `padding: 12px 18px`, bg `var(--bg-sidebar)`, border-top, buttons right; backdrop: `radial-gradient(ellipse at top, var(--purple-soft), transparent)`
- [x] **3.4** `Toast` — layout: `display: flex; gap: 10px; align-items: center`; `border-left: 3px solid <accent-color>`; `bg: var(--bg-raised)`; border `var(--border-1)`; shadow `var(--shadow-2)`; `font-size: 12.5px`; variants: default→purple, success→green, warn→orange, error→red; msg: `.msg b` for title + `.msg span` for sub; dismiss `×` button
- [x] **3.5** `Tooltip` — bubble: `background: #14151c; border: 1px solid #14151c; color: var(--fg); padding: 5px 10px; font-size: 11.5px`; arrow: CSS `::after` 8×8 rotate 45deg (same bg + border-right + border-bottom); support `kbd` hint slot
- [x] **3.6** `Popover` — menu structure: `.ph` header (10px uppercase `var(--fg-3)`), `.pi` item (flex + gap 10, hover `var(--bg-hover)`), `.kbd` shortcut (margin-left auto, mono 10px `var(--fg-4)`), `<hr>` divider (1px `var(--border-1)` margin `4px 0`), `.danger` item (`var(--red)`)
- [x] **3.7** `FilterBar` / `FilterChip` — chip: `height: 22px; padding: 0 8px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 11.5px`; variants: default `var(--bg-active) / var(--fg-2)`, purple, cyan, green, orange, red (each: `-soft` bg + hue text)
- [x] **3.8** `Breadcrumbs` — separator `var(--border-2)`; current item `var(--fg-3)`; add env tag prop: green pill `rgba(80,250,123,.1)` bg + border + `var(--green)` text
- [x] **3.9** `ConfirmDialog` — update to new Modal head/body/foot structure
- [x] **3.10** `Drawer` — update tokens; backdrop update; header structure
- [x] **3.11** `npm run lint && npm run build` — green

---

### Phase 4 — Layout shell [ ]

- [x] **4.1** `AppShell` — `display: grid; grid-template-columns: var(--rail-width) var(--sidebar-width) 1fr; height: 100vh; overflow: hidden`; remove old sidebar slot; add `rail`, `sidebar`, `content` slots
- [x] **4.2** `OrgRail` (NEW `shared/components/OrgRail/`) — `width: var(--rail-width); background: var(--bg-rail); border-right: 1px solid var(--border-1); display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 4px`; logo slot (34×34, `border-radius: 8px`, gradient `var(--purple) → var(--pink)`); `OrgPill` (36×36, `border-radius: 9px`): default `var(--bg-sidebar) / var(--fg-3)`, hover `var(--bg-hover) / var(--fg)`, active: `var(--purple-soft)` bg + `rgba(189,147,249,.4)` border + `var(--purple)` text + 3px left indicator bar; `rail-divider` 24×1px `var(--border-2)`; `rail-bottom` slot (margin-top auto, settings/profile icons)
- [x] **4.3** `Sidebar` — refactor: top section = org context row (org icon 28×28, org name b + plan span, chevron); `SidebarSection` + `SidebarLabel` (eyebrow 10px uppercase `var(--fg-4)`, + right add button); `SidebarItem`: add `.dot` variant (6×6 circle, live glow `box-shadow: 0 0 6px var(--green)`) and `.count` right-slot (mono 11px `var(--fg-3)`, active → `var(--purple)`); project tree inline-expand: indented block (margin-left `16px`, `border-left: 1px solid var(--border-1)`), sub-items `font-size: 12.5px`; active item: `var(--purple-soft)` bg + `var(--purple)` text + weight 500
- [x] **4.4** `Topbar` — height `52px` (was 48px); add `backdrop-filter: blur(10px)`; background `rgba(40,42,54,0.85)` dark / `rgba(246,243,238,0.85)` light; `position: sticky; top: 0; z-index: var(--z-sticky)`; border-bottom `var(--border-1)`; update theme switcher: segmented-control style (dark/light buttons) using `--bg-input` bg
- [x] **4.5** `npm run lint && npm run build` — green

---

### Phase 5 — Data display components [ ]

- [x] **5.1** `Table` — `thead th`: `font-size: 10px; color: var(--fg-4); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; background: var(--bg-sidebar); border-bottom: 1px solid var(--border-1)`; `td`: `padding: 9px 12px; color: var(--fg-2); border-bottom: 1px solid var(--border-1)`; `td.r` (numeric right): `color: var(--fg); text-align: right; font-family: var(--font-mono)`; `td.dim`: `var(--fg-3)`; row hover: `var(--bg-hover)` on all tds; last row no border-bottom
- [x] **5.2** `CodeBlock` — syntax colors: kw `var(--pink)`, at/prop `var(--green)`, str `var(--yellow)`, num `var(--purple)`, cm `var(--fg-4)` italic, tg `var(--cyan)`, vr `var(--orange)`; gutter: `36px` column, `border-right: 1px solid var(--border-1)`, `var(--fg-4)`, line-height `1.7`; body `padding: 10px 14px`; `font-size: 12px`
- [x] **5.3** `JsonTree` — key: `var(--cyan)`; string: `var(--yellow)`; number: `var(--purple)`; bool: `var(--pink)`; null: `var(--fg-4)` italic; punctuation: `var(--fg-3)`
- [x] **5.4** `LogRow` (NEW or update existing) — 3 variants:
  - **Classic**: `grid-template-columns: 88px 64px 1fr 96px; gap: 10px; padding: 8px 14px; font-family: var(--font-mono); font-size: 12px`; timestamp `var(--fg-4) 11px`, message `var(--fg)` truncated, source `var(--cyan) 11px`; expanded: `border-left: 2px solid var(--purple); background: var(--bg-hover)`; detail panel below row
  - **Stream**: `grid-template-columns: 4px 100px 1fr`; 4px colored bar (level hue); meta `var(--fg-4) 11px`; msg `var(--fg)` with source prefix `var(--cyan)`
  - **Card**: `border-left: 3px solid <level-color>`; fatal: `background: rgba(255,121,198,.04)`; head row (badge + time `var(--fg-4)` + source `var(--cyan)` margin-left auto); message `var(--fg) 12.5px`; meta-row `11px var(--fg-3)` with bold key labels
- [x] **5.5** `Skeletons` — update shimmer animation colors to Dracula palette
- [x] **5.6** `npm run lint && npm run build` — green

---

### Phase 6 — New domain components [ ]

- [x] **6.1** `CountPill` (NEW `shared/components/CountPill/`) — `display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 6px; border-radius: 999px; font-family: var(--font-mono); font-size: 11px; background: var(--bg-active); color: var(--fg-2); font-weight: 500`; `.live` variant: `background: var(--green); color: var(--on-accent)` + pulse `@keyframes` (`box-shadow: 0 0 0 0 rgba(80,250,123,.5)` → `0 0 0 6px transparent`)
- [x] **6.2** `EmptyState` (NEW `shared/components/EmptyState/`) — icon box `44×44`, `border-radius: var(--radius-lg)`, `background: var(--bg-hover)`, `color: var(--fg-3)`, `margin-bottom: 12px`; `h4`: `14px / var(--fg) / weight-600`; `p`: `12.5px / var(--fg-3) / max-width: 36ch / margin-inline: auto`; optional CTA button slot
- [x] **6.3** `Combobox` (NEW `shared/components/Combobox/`) — `width: 280px; background: var(--bg-raised); border: 1px solid var(--border-1); border-radius: var(--radius-lg); box-shadow: var(--shadow-2); overflow: hidden`; search row (icon + transparent input + kbd hint); group label `10px uppercase var(--fg-4)`; option row: `padding: 8px 12px; flex; gap: 10`; dot 8×8; label `var(--fg-2)`; checkmark `var(--purple)` when selected; meta right `mono 11px var(--fg-3)`; active option: `var(--bg-hover)`
- [x] **6.4** `CommandPalette` (NEW `shared/components/CommandPalette/`) — `width: 540px; background: var(--bg-raised); border: 1px solid var(--border-2); border-radius: var(--radius-card); box-shadow: var(--shadow-3); overflow: hidden`; head: search icon + `<input>` + ESC badge; group section: group label + cmdk rows; active row: `var(--purple-soft) / var(--purple)`; footer: `padding: 8px 14px; background: var(--bg-sidebar); border-top`; kbd hints `var(--bg-active) / var(--fg-3)`; keyboard shortcut: `⌘K`
- [x] **6.5** `Timeline` (NEW `shared/components/Timeline/`) — `position: relative; padding-left: 18px`; vertical line: `position: absolute; left: 5px; top 8px; bottom 8px; width: 2px; background: var(--border-1)`; item: dot `12×12` circle `absolute; left: -18px; top: 4px; background: var(--bg-base); border: 2px solid <level-color>`; time `mono 11px var(--fg-4)`; title `13px / var(--fg) / weight-500`; description `12px / var(--fg-3) / mono`
- [x] **6.6** `KpiCard` (NEW `features/dashboard/components/KpiCard/`) — label: `11px uppercase letter-spacing 0.06em var(--fg-3) weight-600`; value: `28px mono weight-600 var(--fg)`; delta badge: `.up` (`var(--red)` + `var(--red-soft)`), `.dn` (`var(--green)` + `var(--green-soft)`), `.flat` (`var(--fg-3)` + `var(--bg-hover)`); meta below: `11px mono var(--fg-3)`; critical variant: `background: var(--red-soft); border-color: rgba(255,85,85,.3)`
- [x] **6.7** `AlertCard` (update `features/alerts/components/AlertCard/`) — `border-left: 3px solid var(--red)`; warn variant orange; ok variant green; head: `h4` flex-1 + state badge (firing/pending/resolved); meta row `11.5px var(--fg-3)` + bold `var(--fg)` values; condition block: `font-family: mono; padding: 8px 10px; background: var(--bg-sidebar); border-radius: var(--radius-md); color: var(--fg-2)`; cyan keys, pink operator, purple numbers; sparkline 28px height
- [x] **6.8** `ProjectCard` (update `features/projects/components/ProjectCard/`) — head: status dot 8×8 (live: `box-shadow: 0 0 8px var(--green)`), h4, status badge (live=green-soft, degraded=orange-soft); mono-sm `11px` for project id; stats grid 3-col (value `mono 16px weight-600 var(--fg)`, label `10.5px uppercase var(--fg-3)`); mini sparkline 30px
- [x] **6.9** `npm run lint && npm run build` — green

---

### Phase 7 — Dashboard page [ ]

> Implement `app/[org]/[project]/page.tsx` (or dashboard route) using new components.
> Reference: `Logger Dashboard.html` — full pixel-accurate spec.

- [x] **7.1** Dashboard layout: page-level `display: grid; grid-template-rows: auto 1fr`; topbar + scrollable content
- [x] **7.2** KPI row: 3 × `KpiCard` (Events/min, Critical alerts, P95 latency)
- [x] **7.3** Main grid: `grid-template-columns: 1fr 340px`; left = events chart + recent events table; right = alerts list
- [x] **7.4** Bottom row: Top sources (HostRow list) + Top messages (table)
- [x] **7.5** Wire real data from existing dashboard services (Feature 05 aggregations)
- [x] **7.6** `npm run lint && npm run build` — green; visual check in browser

---

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-11 | Full token name migration (no alias shim) | Two naming systems = permanent confusion. Churn is one-time. |
| 2026-05-11 | JetBrains Mono via `next/font/google` | DS spec is explicit: JetBrains Mono for machine-generated text. Geist Mono removed entirely. |
| 2026-05-11 | OrgRail as separate component from Sidebar | Different background (`--bg-rail` vs `--bg-sidebar`), different concern (org switching vs project navigation). |
| 2026-05-11 | `--s-*` aliases added alongside `--space-*` | DS docs use `--s-1` … `--s-16`; keeping `--space-*` for SCSS consistency; both names work. |
| 2026-05-11 | KpiCard / AlertCard / ProjectCard stay feature-level | Not reusable across features; domain-specific enough to live next to their consumers. |

## How to resume cold

1. Read **Status** block — find current phase.
2. Find first unchecked item in that phase's checklist.
3. Token reference: `C:\Users\birko\Downloads\Logger-handoff\logger-tmp\project\design-system\tokens.css`
4. Component visual specs: `components.html` + `patterns.html` in the same folder.
5. Dashboard spec: `Logger Dashboard.html`.
6. After each phase: run `npm run lint && npm run build`, tick the phase checkbox.
7. Update **Status / Last touched / Progress** block at top of this file.
8. Update `PROGRESS.md` current phase row.
