# Design System + UI Kit (side track)

> Cross-cutting work: tokens + shared primitives used by features 01-08.
> NOT a numbered feature — runs interleaved with Foundation 00.
> This is the **single source of truth** for "where are we on the UI kit". Update after every batch.

## Status
- Started: 2026-05-02
- Last touched: 2026-05-02
- Current phase: **UI kit complete** — ready to feed Foundation 00 / feature work
- Batches done: 0 (tokens), 0.5 (primitives tier 1), 1 (form primitives), 2 (overlays), 3 (data primitives), 4 (layout primitives), 5 (heavy)

## Source

Design dump from claude.ai/design lives in [`docs/designs/system/logger-design-system/`](../designs/system/logger-design-system/).
- `project/colors_and_type.css` — all token values (translated to SCSS partials).
- `project/ui_kits/logger/Components.jsx` — reference implementation of low-level primitives (inline-style React, prototype-only).
- `project/preview/components-*.html` — visual specs per component.
- `project/README.md` — design philosophy (dark-first, density, sober technical tone, no gradients/illustrations/emoji).

## Locked decisions (UI-kit-scoped)

- All color/shadow/focus-ring tokens emit under **`:root, [data-theme="dark"]`** (shared selector). Light theme is a full override under `[data-theme="light"]`. Reason: page renders correctly in dark even without the no-flash inline script (foundation step 37). Logged in PLAN.md §17.
- Non-themed tokens (fonts, type, spacing, radii, motion, z-index) live in `:root` only — they don't change between themes.
- `--font-sans` / `--font-mono` reference next/font's `--font-geist-sans` / `--font-geist-mono` exposed by `app/layout.tsx`. No `@import` from Google Fonts in SCSS.
- SCSS `@use` resolved via `sassOptions.loadPaths = [process.cwd()]` in `next.config.ts`. Bare imports like `@use 'app/styles/mixins' as *;` mirror the TS `@/` alias.
- Tokens/themes emit `:root` rules **once** (via `app/globals.scss`). Component `.module.scss` only `@use 'app/styles/mixins'` (no output, just mixin definitions) to avoid duplicating `:root` blocks across CSS bundles.
- Components that are **purely presentational** (Badge, LevelBadge, StatusBadge, Avatar, Divider) stay as **server components**. Components that need browser-only behavior would mark `'use client'` (none yet — Input uses `:focus-within` in CSS instead of `useState`).
- Native HTML elements as base whenever possible: `<button>`, `<input>` — no custom roving-tabindex etc. unless component requires it.
- `cx(...classes)` helper in `shared/utils/cx.ts` instead of adding `clsx` dep. Tiny, no JSON Schema parse cost.

## File map

```
app/
  globals.scss                — global reset, scrollbar, shimmer keyframe
  layout.tsx                  — wires globals.scss, data-theme="dark"
  page.tsx                    — UI kit preview page
  page.module.scss            — preview page layout
  styles/
    _tokens.scss              — fonts, type, spacing, radii, motion, z-index
    _themes.scss              — colors, shadows, focus ring (dark + light)
    _mixins.scss              — focus-ring, surface, level/status, truncate, sr-only

shared/
  utils/
    cx.ts                     — className join helper
  components/
    index.ts                  — barrel
    AppShell/                 — DONE  (sidebar + topbar + content layout)
    Avatar/                   — DONE
    Breadcrumbs/              — DONE  (next/link, last item current)
    Button/                   — DONE
    Checkbox/                 — DONE
    CodeBlock/                — DONE  (server wrapper + 'use client' CopyButton)
    Divider/                  — DONE
    Drawer/                   — DONE  (native <dialog>, side-anchored)
    FilterBar/                — DONE  (FilterBar shell + FilterChip)
    FormField/                — DONE
    IconButton/               — DONE
    Input/                    — DONE
    JsonTree/                 — DONE  (native <details>, server component)
    KeyValue/                 — DONE
    LevelBadge/               — DONE
    Modal/                    — DONE  (native <dialog>)
    Popover/                  — DONE  (floating-ui)
    Radio/                    — DONE
    Select/                   — DONE
    Sidebar/                  — DONE  (collapsible via [data-collapsed], parts: Section/Item/Divider)
    Skeleton/                 — DONE
    StatusBadge/              — DONE
    Switch/                   — DONE
    Table/                    — DONE  (column-config, sortable headers, row variants/selected, loading skeleton)
    Tabs/                     — DONE  (underline + count badges, next/link items)
    Textarea/                 — DONE
    Toast/                    — DONE  (Provider + useToast hook + portal)
    Tooltip/                  — DONE  (floating-ui)
    Topbar/                   — DONE  (left/center/right slots, 48px)
```

App-level wiring:
```
app/layout.tsx                — wraps children in <ToastProvider>
app/_demo/OverlayDemos.tsx    — client-side demo for Modal/Toast/Tooltip/Popover (used by page.tsx preview)
```

## Implementation Checklist

### Batch 0 — Tokens + globals (DONE)
- [x] Install `sass`
- [x] `app/styles/_tokens.scss`
- [x] `app/styles/_themes.scss`
- [x] `app/styles/_mixins.scss`
- [x] `app/globals.scss` (replaces `globals.css`)
- [x] `app/layout.tsx` updated (import `.scss`, `data-theme="dark"`, real metadata)
- [x] `next.config.ts` — `sassOptions.loadPaths`
- [x] `eslint.config.mjs` — ignore `docs/designs/**`

### Batch 0.5 — Primitives, tier 1 (DONE)
- [x] `Button` (primary/secondary/ghost/danger/link × sm/md, leftIcon/rightIcon)
- [x] `IconButton` (sm/md, active)
- [x] `LevelBadge` (debug/info/warn/error/fatal × sm/md)
- [x] `StatusBadge` (success/warning/danger/info)
- [x] `Input` (prefix/suffix, invalid, disabled, :focus-within ring)
- [x] `Divider` (horizontal/vertical)
- [x] `Avatar` (initials, configurable size)
- [x] `shared/components/index.ts` barrel
- [x] `shared/utils/cx.ts`
- [x] Live preview in `app/page.tsx`
- [x] `npm run lint` clean, `npm run build` green

### Batch 1 — Form primitives (DONE)
- [x] `Skeleton` — shimmer block, `width`/`height`/`radius` configurable; respects `prefers-reduced-motion`.
- [x] `Textarea` — vertical resize, `invalid`, `disabled`.
- [x] `Checkbox` — wraps native `<input type=checkbox>`, custom check icon, focus-visible ring.
- [x] `Switch` — wraps native `<input type=checkbox role=switch>`, track + thumb.
- [x] `Radio` — wraps native `<input type=radio>`, animated inner dot.
- [x] `Select` — native `<select>` with custom chevron, `appearance:none`.
- [x] `FormField` — label + control + helper/error wrapper; uses `useId` for `htmlFor` association.
- [x] Barrel + preview page updated.
- [x] `npm run lint` clean, `npm run build` green.

> Note on indeterminate checkbox: not implemented in Batch 1. Native `:indeterminate` requires JS to set the DOM property. Add when a real consumer needs it (e.g. "Select all" in a table).

### Batch 2 — Overlays (DONE)
- [x] `Modal` — native `<dialog>` + ref-driven `showModal()` / `close()`. `closeOnBackdropClick` (target equality on dialog itself). Sizes sm/md/lg. Title + footer slots. Built-in focus trap and escape-to-close from `<dialog>`.
- [x] `Toast` — `<ToastProvider>` mounted in `app/layout.tsx`; `useToast()` returns `{ push, dismiss, clear }`. Auto-dismiss timer per toast (default 5s; `duration: 0` to keep). Variants: default/success/warning/danger/info. Renders via `createPortal` into `document.body`. Region positioned top-right with `--z-toast`.
- [x] `Tooltip` — `@floating-ui/react`. Anchors to a single child element via `cloneElement` + `getReferenceProps`. Hover (configurable delay) + focus + dismiss. Arrow via `FloatingArrow`. `placement` defaults to `top`, flips on edge collision.
- [x] `Popover` — `@floating-ui/react`. Click-to-open with `useClick` + `useDismiss` (escape, click-outside). `FloatingFocusManager` (non-modal) for focus restoration. Title + footer slots. Controlled (`open`/`onOpenChange`) and uncontrolled modes.

### Batch 3 — Data primitives (DONE)
- [x] `KeyValue` — bordered list, monospace key (configurable width) + value with `default|string|number|url` variant tinting via `--syntax-*`/`--accent-text`. Server component, presentational only.
- [x] `CodeBlock` — header (lang label + Copy) + numbered lines + optional `highlightLines`. **No syntax highlighting in MVP** — body renders as plain monospace with `--syntax-text`. Wrapper is a server component; `parts/CopyButton.tsx` is `'use client'` (clipboard + transient "Copied" state). Ship without highlight; revisit when first real consumer (likely Events detail tab) demands it — `prism-react-renderer` (~6 KB) is the planned addition.
- [x] `JsonTree` — recursive node tree using **native `<details>` / `<summary>`**. No client state, server-component-friendly. Each object/array is one `<details>`; chevron rotates via `details[open] > summary > .chevron` selector. `expandDepth` prop controls initial open state. Primitives colored via `--syntax-string|number|keyword|comment|property`. Empty `{}`/`[]` render as inline non-collapsible.

### Batch 4 — Layout primitives (DONE)
- [x] `AppShell` — flex shell: `sidebar` slot (left) + `main` column (`topbar` slot + `content`). Min-height 100vh. Server component, pure composition.
- [x] `Sidebar` + parts (`SidebarSection`, `SidebarItem`, `SidebarDivider`) — width controlled via CSS vars (`--sidebar-w` / `--sidebar-w-collapsed`, defaults 240px / 56px). Collapsible via `data-collapsed` attribute (CSS-only — no JS state). Top + bottom slots, body in middle. `SidebarItem` uses `next/link` when `href` provided, plain `<span>` otherwise. Active state via `aria-current="page"` + accent right-border + `--accent-subtle` background.
- [x] `Topbar` — 48px (`--topbar-height`), `left`/`center`/`right` slots. `bg-surface` + bottom border. Right slot auto-pushes to end via `margin-left: auto`.
- [x] `Breadcrumbs` — `<nav aria-label>` + `<ol>` + `Fragment` separators. Configurable `separator` (defaults `›`). Last item gets `aria-current="page"` and renders as plain `<span>` (no link), even if `href` provided. Items with `href` use `next/link`.
- [x] `Tabs` — `role="tablist"` + tab roles, underline style with `--accent` border-bottom on active. Optional `count` badge (formatted `1.5k`/`12k` for large numbers). Items with `href` render as `next/link`; without become inert `<span>`. `disabled` flag dims and removes link. No `'use client'` — for routed tabs the active state is computed at render time by the consumer (typically via `usePathname()` in a wrapper).

### Batch 5 — Heavy (DONE)
- [x] `Table` — generic on `<T extends TableRowMeta>`. Column config: `key`, `header`, `width?`, `align?`, `sortable?`, `render`. Row meta: `id`, `variant?` (`default|error|fatal` — tinted bg via `--level-{error|fatal}-bg`), `selected?` (`--accent-subtle` bg). Sticky header (`position: sticky; z: var(--z-sticky)`) toggleable via `stickyHeader`. Sort: caller-controlled (`sortKey`, `sortDirection`, `onSort(key)`); column header becomes a `<button>` only when `sortable && onSort` provided. `onRowClick` adds cursor:pointer + hover. `loading` renders N skeleton rows (default 5) using the `Skeleton` primitive. **Client component** (event handlers required).
- [x] `FilterChip` — `'use client'` chip with `filterKey`/`operator`/`value`/`onRemove`. Remove is a real `<button>` only when `onRemove` provided. Used inside `FilterBar` slot.
- [x] `FilterBar` — server component, `<div role="toolbar">` with raised bg + flex/wrap layout. No internal state, pure container — consumer composes Search input, chips, action buttons, count label inside. Spec deliberately not opinionated about which children live where (consumer uses `margin-left: auto` for end-anchored items).
- [x] `Drawer` — native `<dialog>` (same pattern as `Modal`): `showModal()` / `close()` driven from a ref + `useEffect`. Side-anchored via `position: fixed; right/left: 0; top/bottom: 0`. Configurable `width` (default 520px per spec) inlined as CSS var. Reuses Modal's backdrop click + escape close. Title + footer slots.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-02 | Dark tokens emit under `:root, [data-theme="dark"]` (shared block) | Renders correctly without no-flash script; light is a clean override. |
| 2026-05-02 | `cx.ts` over `clsx` dep | One ~10-line helper covers our use; no extra dep. |
| 2026-05-02 | Bare SCSS imports via `sassOptions.loadPaths` | Mirrors TS `@/` alias semantics; avoids `../../../../` chains. |
| 2026-05-02 | Server components by default for primitives | Smaller client bundle; only mark `'use client'` when state/effect/event-handler logic forces it. Forwarded onClick props don't force client (consumer is client by virtue of using onClick). |
| 2026-05-02 | `Input` uses `:focus-within` (CSS), not `useState` | Stays server component, no JS for focus styling. |
| 2026-05-02 | Form controls (Checkbox/Switch/Radio) wrap native inputs in `<label>` with visually-hidden input + `:checked`-driven CSS for visual state | Native a11y, native form submission, keyboard works for free; no JS needed for state; works in server components. |
| 2026-05-02 | Native `<select>` (with custom chevron) instead of custom dropdown listbox | Native keyboard navigation, mobile picker, screen-reader semantics; custom Combobox can come later for filterable cases. |
| 2026-05-02 | `FormField` is presentational only — does NOT own state or validation | gform-react (project rule) handles form state; FormField is just label + helper + error visual wrapper composable with any control. |
| 2026-05-02 | Indeterminate checkbox deferred | Requires JS to set DOM `indeterminate` property; add when first consumer needs it (likely table "select all"). |
| 2026-05-02 | Modal uses native `<dialog>` instead of custom portal/focus-trap | Browser handles focus trap, escape, top-layer stacking, ::backdrop. `showModal()`/`close()` driven from a ref + `useEffect`. Custom portal/focus-trap libs avoided. |
| 2026-05-02 | Toast state via Context + useReducer (not Redux) | Toast queue is isolated UI state, not domain data; Context fits. Refactor to Redux is straightforward later if needed (Foundation 22-24 not done yet). |
| 2026-05-02 | `@floating-ui/react` for Tooltip + Popover (and future Combobox/Menu) | Industry standard for anchor-positioned overlays; flip + shift + arrow + focus management built in. ~10 KB gzip. Hand-rolled positioning would re-implement collision handling we'd need anyway. |
| 2026-05-02 | floating-ui callback refs destructured (`const { setReference, setFloating } = refs`) | React 19's `react-hooks/refs` rule fires false positive on `refs.setReference` JSX prop. Destructuring to a non-`refs.X` name silences the heuristic without disabling the rule. |
| 2026-05-02 | `useSyncExternalStore` for hydration-safe client-only rendering in `ToastProvider` | Avoid SSR/CSR mismatch when conditionally rendering `createPortal`. `useEffect+setState` works but trips React 19's `react-hooks/set-state-in-effect` rule. `useSyncExternalStore(subscribe, () => true, () => false)` returns false on server + first hydration pass, true on subsequent client renders — exactly the gating we need, no rule violations. Reuse the same pattern (`useIsClient()`) for any other hydration-deferred client-only rendering. |
| 2026-05-02 | `JsonTree` uses native `<details>` instead of `useState`-driven collapse | No JS state needed — browser handles open/close, keyboard activation, and accessibility. Component stays a server component, no hydration concerns. Trade-off: no programmatic expand-all from outside; acceptable for the event-detail use case. Chevron rotation via `details[open] > summary > .chevron` works inside CSS Modules (selector is just hashed across all class names in the same module). |
| 2026-05-02 | `CodeBlock` ships without syntax highlighting in MVP | Avoid pulling `prism-react-renderer` (~6 KB) before a real consumer needs it. Plain monospace body covers Events detail "raw payload" and SDK docs snippets — both prioritize readability over coloring. Add `prism-react-renderer` (or shiki, if SSR coloring becomes important) when Events page actually mounts highlighted code. Header + line gutter + Copy + `highlightLines` (single-line emphasis via `--syntax-error-hl`) are already in place. |
| 2026-05-02 | `CopyButton` extracted as `'use client'` part inside server-component `CodeBlock` | Keeps the wrapper renderable without `'use client'` at the top. Clipboard + transient "Copied" state are the only client-needed bits; isolating them keeps client bundle minimal and makes future consumers (KeyValue actions, header copy buttons) able to reuse the part directly. |
| 2026-05-02 | Sidebar collapse is CSS-only via `data-collapsed` attribute, no internal state | Component stays a server component; consumer (likely a client wrapper near the topbar toggle button) flips a class/attribute. Width transitions and label hiding live in CSS — `[data-collapsed]` selectors target labels/section-labels/badges/divider padding. `--sidebar-w`/`--sidebar-w-collapsed` are inline CSS vars for per-instance overrides. |
| 2026-05-02 | Layout components (Sidebar/Tabs/Breadcrumbs) use `next/link` directly | We're a Next App Router project. Coupling to `next/link` is fine and gives client-side routing for free. Items remain server-rendered; the consumer doesn't have to wire `<Link>` themselves. For non-link items consumer just omits `href`. |
| 2026-05-02 | `Tabs` is structural-only — no internal active state, no `onSelect` | Active flag is computed by the consumer (e.g. `usePathname() === item.href`) and passed in. Avoids client component, avoids prop coupling. If a future consumer wants imperative control without routing, wrap Tabs in a client component that flips `active` on click. |
| 2026-05-02 | Table is **caller-controlled** for sort + selection; no internal state | We need URL-synced filters/sort for the Events page (sharable links, browser back). Table just renders what it's told. Consumer (likely a `'use client'` page wrapper) holds `sortKey`/`sortDirection` and translates `onSort(key)` to a `router.replace()` with updated search params. Same for `selected` — caller decides. |
| 2026-05-02 | CSS Modules: bare element selectors disallowed — must nest under a local class | `td`, `th`, `thead tr` selectors caused "Selector is not pure" build errors in Next 16's CSS Modules pipeline. Fix: nest table-internal element rules inside `.table { ... }`. The compiled output `.Table_table__hash th { ... }` includes a local class so the selector qualifies. Apply this pattern (nest under a local root class) for any future component that needs to style child elements without exposing classes for each. |
| 2026-05-02 | Drawer reuses Modal's native `<dialog>` pattern instead of new portal/CSS-only solution | Same wins as Modal — browser handles focus trap, escape, top-layer stacking, ::backdrop. Side anchoring via `position: fixed; right: 0` + width override. No second focus-trap library needed. |

## How to resume cold

1. Read this file top-to-bottom — status block tells you which batch is in progress.
2. Open the in-progress batch's checklist; find the first unchecked item.
3. Visual specs: `docs/designs/system/logger-design-system/project/preview/components-*.html` (especially `components-inputs.html`, `components-overlays.html`, `components-table.html`).
4. Reference impl: `docs/designs/system/logger-design-system/project/ui_kits/logger/Components.jsx`.
5. Tokens: `app/styles/_tokens.scss` + `_themes.scss`. Mixins: `app/styles/_mixins.scss`.
6. After implementing a component:
   - Add to `shared/components/index.ts` barrel.
   - Add a row to the preview in `app/page.tsx`.
   - Run `npm run lint && npm run build`.
   - Tick the checkbox in this file.
7. After finishing a batch — update the **Status / Last touched / Current phase** block at the top.
