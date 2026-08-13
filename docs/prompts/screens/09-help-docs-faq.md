# Screens for Feature 09 — Help / Docs / FAQ

## Context

- Design system reference: `docs/designs/system/logger-design-system/`
  - Tokens: `project/colors_and_type.css`
  - Component previews: `project/preview/`
  - UI kit: `project/ui_kits/logger/`
- **Logger** is a self-hosted, invite-only log aggregation tool for internal engineering teams — not a public product. This Help section is **behind login, inside the app shell** (not a public marketing site). Audience is existing org members: engineers, and occasionally less-technical teammates trying to self-serve an answer instead of pinging someone in chat.
- **Dark theme is primary.** All decisions made against `--bg-base` (`#0d0d0f`). Light theme (`[data-theme="light"]`) must also be specified per screen since the app supports both.
- **Tone:** sober, technical. No emoji. No "Awesome!". Sentence case everywhere. Same voice as the rest of the app.
- **Typography:** Geist Sans 13px base, Geist Mono for IDs/keys/slugs/**code blocks and inline code**.
- **Icons:** Lucide Icons, 16px default, 1.5px stroke.
- **Radii:** buttons/inputs 4px, cards/panels 6px, modals 8px.
- **Spacing:** 4px base unit.

## Content source — do not invent copy

The actual written content for this feature already exists as eight Markdown files in `docs/reference/` (`README.md`, `stack.md`, `architecture.md`, `api.md`, `users-roles.md`, `logging.md`, `security.md`, `misc.md`). These screens render that real content — the design tool should mock up realistic excerpts pulled from those files (headings, tables, code blocks all actually appear in the source), not placeholder lorem ipsum. This matters because the content includes long tables, fenced code blocks, and deeply nested headings (H2 → H3) that the layout must handle for real, not hypothetically.

Category → file mapping (8 categories, used throughout):

| Category label | Source file | Icon (Lucide) |
|---|---|---|
| Overview | `README.md` | `book-open` |
| Stack &amp; environment | `stack.md` | `layers` |
| Architecture | `architecture.md` | `network` |
| API | `api.md` | `terminal` |
| Users, roles &amp; orgs | `users-roles.md` | `users` |
| Logging, alerts &amp; dashboard | `logging.md` | `activity` |
| Security | `security.md` | `shield` |
| Testing &amp; deployment | `misc.md` | `settings-2` |

## App shell context

All screens below live inside the App Shell (established in Feature 01): left sidebar (org switcher, project switcher, nav links), top bar (breadcrumb, user menu), content area (`--bg-base`).

- Add a **"Help"** entry to the org-level sidebar nav (not project-scoped — help content applies regardless of which project is active), icon `help-circle`, positioned near the bottom of the nav list, above the user/account area, visually separated by a divider from Projects/Team/Settings.
- Route shape: `/[org]/help` (hub), `/[org]/help/[category]` (article), `/[org]/help/faq` (curated FAQ). No permission gating — every member, regardless of role, can access Help (unlike most other org routes, this is not behind `hasPermission`/`assertOwner`).
- Breadcrumb pattern: `{Org name} / Help` on the hub, `{Org name} / Help / {Category label}` on article pages.

---

## Screens to design

---

### 1. Help hub — `/[org]/help`

**Purpose:** Landing page for the whole Help section — search entry point + browse-by-category.

**Layout:** Content area, max-width ~880px, centered.

**Top block — search:**
- Large search input, full width, placeholder `"Search docs and FAQ…"`, `search` icon left-aligned inside the field, keyboard shortcut hint (`/` or `Ctrl K`) right-aligned inside the field in `--text-muted`.
- Typing triggers the **Search overlay** (Screen 4) — this input is the trigger, not an inline results list itself.

**Category grid:**
- 8 cards, 2 columns on wide viewport, 1 column narrow. Gap 16px. Cards use `--bg-raised`, `1px --border-subtle`, `border-radius: 6px`, padding 16px.
- Card anatomy: Lucide icon (20px, `--text-secondary`) top-left, category label (14px, 500, `--text-primary`) next to it, one-line description below (12px, `--text-secondary`, taken from the source file's opening sentence), small chevron-right icon at the far right.
- Hover: `--surface-hover` bg, border shifts to `--border-default`.
- Whole card is a link to `/[org]/help/[category]`.

**Bottom block — FAQ teaser:**
- Section header "Frequently asked questions" (14px, 500) + "View all" link (right-aligned, `--text-secondary`, links to `/[org]/help/faq`).
- 4–5 curated question rows (see Screen 3 for the full FAQ — this is a truncated preview), each row: question text (13px, `--text-primary`) + chevron-right, click expands inline (accordion) OR navigates to the FAQ page with that item pre-expanded — pick the inline-accordion approach for consistency with Screen 3.

**States:** default (populated), loading skeleton (shimmer cards + shimmer FAQ rows). No empty state needed — content is static/always present.

---

### 2. Article page — `/[org]/help/[category]`

**Purpose:** Render one of the 8 reference docs as a readable in-app article with in-page navigation.

**Layout:** Three-column reading layout within content area:
- **Left rail (200px, sticky):** category switcher — the same 8 categories as a compact vertical list (icon + label), current category highlighted with `--accent` left border + `--surface-active` bg. This lets a reader jump between categories without going back to the hub.
- **Center column (flex, max-width ~680px):** the rendered article.
- **Right rail (200px, sticky, hidden below ~1100px viewport):** "On this page" mini table of contents, auto-generated from the article's H2/H3 headings, current section highlighted via scroll-spy (the heading currently in viewport gets `--text-primary` + a left tick mark; others `--text-secondary`).

**Article typography (center column):**
- H1 (category label, 22px, 600, `--text-primary`) at the top, followed by a thin `--border-subtle` rule.
- H2 (16px, 600), H3 (14px, 600) — both `--text-primary`, generous top margin (24px) to make the TOC-jump targets feel distinct.
- Body text 13px, `--font-sans`, `--text-secondary`, line-height 1.6.
- **Tables**: full-width, `1px --border-subtle` between rows, header row `--bg-raised` background with 500-weight text, cell padding 8px 12px. **Must scroll horizontally within their own container** (`overflow-x: auto`) rather than overflowing the page — several source tables (e.g. the permission catalogue, the migration list) have 3–5 columns of moderate-length text and must not force the whole page to scroll sideways on narrow viewports.
- **Inline code** (\`like_this\`): `--font-mono`, 12px, `--bg-raised` background, 2px 5px padding, `border-radius: 3px`.
- **Fenced code blocks**: `--bg-surface` background, `1px --border-subtle`, `border-radius: 6px`, padding 12px 16px, `--font-mono` 12.5px, syntax-colored per `colors-syntax.html` tokens where applicable (JSON/bash examples appear frequently in `api.md`). A **"Copy" button** (small, top-right corner of the block, `copy` icon → `check` on click for 2s) must be present on every code block — several are non-trivial curl/JSON examples a reader will want to paste directly.
- **Blockquote-style callout notes** (the source docs use `> **Note:**` for doc-vs-code drift warnings and known gaps): render as a distinct callout block — left border `--warning` or `--accent` (pick one consistently), `--bg-raised` background, `border-radius: 4px`, padding 10px 14px, slightly smaller text (12px). These appear often enough (every category has at least one) that they need a clearly distinct visual treatment from regular body text, not just italics.
- **Internal cross-links** (e.g. "see security.md#rate-limiting") resolve to `/[org]/help/security#rate-limiting` — style as `--accent` colored text, underline on hover only.

**Top-of-article utility row** (above H1 or beside it): a **"Copy page as Markdown"** button (icon `file-text` or `clipboard-copy`, ghost button style) — copies the raw source Markdown to the clipboard. This is a deliberate feature: the content is meant to be easy to paste into an AI assistant, not just read on-screen.

**States:** default (populated), loading skeleton (shimmer heading + shimmer paragraph blocks), 404/not-found if `[category]` doesn't match a known slug (reuse the standard app not-found pattern).

**Edge cases to show in the mockup:**
- A table wide enough to require horizontal scroll (use the permission catalogue table from `users-roles.md` as the real example — 2 columns but long description text, or the migrations table from `architecture.md` — 2 columns, short content, use the **route sitemap** block from `architecture.md` instead, which is a wide preformatted block).
- A code block with a multi-line curl example (use the ingest curl example from `api.md`).
- A callout note (use one of the "Doc drift note" callouts from `logging.md`).
- Right-rail TOC with 3 heading levels active at once (H2 with nested H3s) — use `security.md`'s structure (H2 sections, no H3s — if no real 3-level example exists in the source, note this in the mockup rather than inventing one).

---

### 3. FAQ page — `/[org]/help/faq`

**Purpose:** A curated, question-phrased view over the same underlying content, for readers who have a specific question rather than wanting to browse a whole category.

**Breadcrumb:** `{Org name} / Help / FAQ`.

**Layout:** Single column, max-width ~680px.

**Filter row (top):** horizontal row of category filter chips (all 8 categories + "All"), same chip style as `components-filter-bar.html`. Clicking a chip filters the accordion list below to that category only; multiple chips can't be selected at once (single-select, "All" is the default/reset state).

**Accordion list:**
- Grouped by category with a small section label (12px, uppercase, `--text-muted`, letter-spacing) when "All" is selected; ungrouped flat list when a single category is filtered.
- Each row: question text (13px, 500, `--text-primary`) + chevron (rotates 90° when expanded) on the left or right (pick one, be consistent with other accordion/disclosure patterns already in the app if any exist — otherwise chevron on the right).
- Expanded state reveals the answer: 13px `--text-secondary`, may include inline code/short code blocks, and ends with a **"Read full article →"** link to the relevant `/[org]/help/[category]#anchor`.
- Only one item expanded at a time is *not* required — allow multiple open simultaneously (standard FAQ behavior, not a strict single-open accordion).

**Example FAQ entries to mock up** (phrase actual content from the reference docs as questions — do not invent facts, only rephrase existing statements into question form):
- "What happens if I send an event with a timestamp more than 30 days in the past?" → answer drawn from `api.md`'s timestamp policy.
- "Can I delete a role that's still assigned to someone?" → answer drawn from `users-roles.md`'s role-deletion business rule.
- "Is the ingest rate limit safe if we run multiple app replicas?" → answer drawn from `security.md`'s rate-limiting known-limitation note.
- "Why didn't I get a password reset email?" → answer drawn from `security.md`'s password-reset-is-only-logged gap.
- "How is dashboard chart bucket size chosen?" → answer drawn from `logging.md`'s bucket-sizing table.

**States:** default (populated), search-filtered-empty ("No questions match your filter" — reuse the standard `EmptyState` component, `search-x` icon), loading skeleton.

---

### 4. Search overlay (triggered from the hub search input or a global shortcut)

**Purpose:** Fast full-text jump to any heading/question across all 8 articles + the FAQ, without leaving the current page.

**Trigger:** Typing in the Screen 1 search input, or a global keyboard shortcut (reuse whatever pattern `CommandPalette` already establishes elsewhere in the app — this should visually and behaviorally match the existing command palette, not invent a new overlay pattern).

**Anatomy:**
- Modal-style overlay, centered, max-width 560px, `--bg-overlay`, `border-radius: 8px`, `--shadow-3`.
- Search input pinned at top of the overlay (auto-focused).
- Results list below, each result row: category icon (16px) + matched heading/question text (13px, `--text-primary`, matched substring highlighted with `--accent` or a subtle background) + one-line snippet of surrounding content (12px, `--text-secondary`, truncated) + category badge (right-aligned, small, `--text-muted`).
- Keyboard navigable (↑/↓ to move, Enter to open, Esc to close) — standard command-palette behavior.
- Selecting a result navigates to `/[org]/help/[category]#[anchor]` (or `/[org]/help/faq` with that item expanded, for FAQ matches) and closes the overlay.

**States:**
- **Empty query**: show a short list of "Popular" or "Recently viewed" entries (pick "Popular", it's simpler to justify without tracking) instead of an empty list.
- **No matches**: centered message "No results for '{query}'" (`search-x` icon, `--text-muted`), no CTA needed.
- **Populated**: as above, capped at ~8 visible results with a "N more results" hint if truncated (or scrollable list — pick scrollable, matches typical command-palette behavior).

---

## Component reuse checklist

Reference these from the design system (see `project/preview/`) — this feature should **not** need any net-new primitive components, only compositions of existing ones:

| Component | Used in |
|---|---|
| `components-navigation` — sidebar nav item, sub-nav/rail list | Sidebar "Help" entry, article left-rail category switcher |
| `components-inputs` — search input | Hub search bar, search overlay input |
| `components-overlays` — modal/overlay pattern (reuse `CommandPalette` specifically) | Search overlay |
| `components-data` — monospace/code block style | Article code blocks, inline code |
| `components-badges` — small label/badge | Search result category badge |
| `components-filter-bar` — filter chips | FAQ category filter row |
| `components-buttons` — ghost/icon button | "Copy" on code blocks, "Copy page as Markdown", "View all" link |
| `EmptyState` (shared component, already used elsewhere in the app) | FAQ no-results state |
| `Skeleton`/`Skeletons` (shared component) | All loading states |

---

## Output format

For each screen: annotated HTML mockup using the Logger design system tokens (`colors_and_type.css`), at 1280px viewport width inside the App Shell (except the search overlay, which should also be shown at its natural centered-modal size). Include:
1. Default/populated state with **real excerpted content** from `docs/reference/*.md` (not lorem ipsum) — pull actual table rows, actual code snippets, actual callout text.
2. Loading skeleton state (Screens 1–3).
3. The specific edge cases called out per screen (wide table, long code block, callout block, empty search).
4. Both dark (default) and light theme for the article page (Screen 2) specifically, since it has the most typography/token surface area — other screens can stay dark-only unless time permits.

Use inline styles or a `<style>` block referencing the CSS custom properties. Use Lucide icons via CDN script tag.
