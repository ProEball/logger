---
name: logger-design
description: Use this skill to generate well-branded interfaces and assets for Logger, a self-hosted log aggregation web app for developer teams. Contains essential design guidelines, colors, type, tokens, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Key design principles

- **Dark-first**: all decisions made on `--bg-base: #0d0d0f`. Light theme parity via `[data-theme="light"]`.
- **Density over whitespace**: default body 13px, table rows 34px, no decorative padding.
- **Sober, technical**: no gradients, no illustrations, no emoji.
- **Monospace for data**: all log messages, stack traces, IDs, timestamps use `--font-mono`.
- **Log level colors are semantic**: debug (muted blue-gray), info (blue), warn (amber), error (red), fatal (deep red). Never invent new level colors.
- **Accent is indigo-violet** (`#6366f1`): use for interactive elements, focus rings, active states only.
- **Radii are sharp**: 4px for inputs/buttons/badges, 6px for cards, 8px for modals.
- **No big blurry shadows on dark**: use `border + small shadow` pattern instead.
- **Icons**: Lucide, 14–16px, 1.5px stroke, `currentColor`.
- **Fonts**: Geist Sans (UI), Geist Mono (data). Fall back to Inter / JetBrains Mono.

## File reference

- `colors_and_type.css` — all CSS custom properties (copy into any project)
- `ui_kits/logger/index.html` — interactive prototype (Events, Dashboard, Alerts, Settings, Auth)
- `ui_kits/logger/Components.jsx` — shared React primitives
- `ui_kits/logger/AppShell.jsx` — sidebar + topbar layout
- `ui_kits/logger/EventsPage.jsx` — event table + filter bar
- `ui_kits/logger/EventDrawer.jsx` — event detail drawer
- `ui_kits/logger/DashboardPage.jsx` — dashboard, alerts, settings, auth pages
- `preview/` — design system card specimens (registered in Design System tab)
