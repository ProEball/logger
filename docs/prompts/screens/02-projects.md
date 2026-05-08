# Screens for Feature 02 — Projects + API Keys

## Context

- Design system reference: `docs/designs/system/logger-design-system/`
  - Tokens: `project/colors_and_type.css`
  - Component previews: `project/preview/`
  - UI kit: `project/ui_kits/logger/`
- **Logger** is a self-hosted log aggregation tool for software teams. Developer tool — not a consumer product. Users are engineers running long sessions in dense UIs.
- **Dark theme is primary.** All decisions made against `--bg-base` (`#0d0d0f`).
- **Tone:** sober, technical. No emoji. No "Awesome!". Sentence case everywhere.
- **Typography:** Geist Sans 13px base, Geist Mono for IDs/keys/slugs/code.
- **Icons:** Lucide Icons, 16px default, 1.5px stroke.
- **Radii:** buttons/inputs 4px, cards/panels 6px, modals 8px.
- **Spacing:** 4px base unit.

## App shell context

All screens below live inside the App Shell established in Feature 01:
- Left sidebar (collapsible, 220px): org switcher at top, project switcher below org, nav links below project.
- Top bar: breadcrumb, right-side user avatar menu.
- Content area: flex-column, full remaining height, `--bg-base` background.

The sidebar project switcher is relevant — when no project is selected the sidebar shows org-level nav. When a project is active it shows project-level nav (Dashboard, Events, Alerts, Settings).

---

## Screens to design

---

### 1. Projects list — `/[org]/projects`

**Purpose:** Entry point for managing all projects in an organization. Shows existing projects or prompts creation.

**Layout:** Content area within App Shell. Sidebar shows org-level nav with "Projects" active.

**Top bar breadcrumb:** `{Org name} / Projects`

**Page header:** Title "Projects" (left), primary "New project" button (right, accent, with `+` Lucide icon). Button hidden for users without `projects.create` permission.

---

#### State A — Empty (no projects yet)

Full-page centered empty state inside content area:
- Lucide `folder-open` icon, 32px, `--text-muted`.
- Heading (16px, 500): "No projects yet"
- Body (13px, `--text-secondary`): "Create a project to start ingesting events and generating API keys."
- Primary CTA button "New project" — links to `/[org]/projects/new`. Hidden if user lacks `projects.create`.

No decorative illustration. No background pattern. Just flat dark with the centered block.

---

#### State B — List with projects

Grid layout: 3 columns on wide viewport, 2 on medium, 1 on narrow. Gap: 16px. Cards use `--bg-raised`, 1px `--border-subtle`, `border-radius: 6px`, padding 16px.

**Project card anatomy:**
- Top row: project name (14px, 500, `--text-primary`) + status badge if applicable (only "deleted" would show, but in MVP those are 404'd, so badge is not needed).
- Second row: slug — displayed as monospace (`--font-mono`, 12px, `--text-muted`): `api-server`
- Third row: stat placeholders — three micro-stats in a horizontal row:
  - "0 events" (or "—" if not yet fetched) · icon `activity` 12px
  - "0 keys" · icon `key` 12px
  - "Created {relative time}" · icon `clock` 12px
  - All in `--text-secondary`, 12px. These are placeholders — real counts come in Feature 04/03.
- Hover state: `--surface-hover` background, border shifts to `--border-default`.
- The whole card is a link to `/[org]/[project]`.
- No action buttons on the card — management is inside the project settings page.

**States:** loading skeleton (3 shimmer cards), error inline (above grid), populated grid.

---

### 2. Create project — `/[org]/projects/new`

**Purpose:** Form to create a new project. Minimal — name + slug only.

**Layout:** Narrow centered column (max-width 480px) within content area. No card wrapper — just the form floating in the content area, top-aligned with some vertical padding.

**Breadcrumb:** `{Org name} / Projects / New project`

**Form fields:**

1. **Name** (text input, required)
   - Label: "Project name"
   - Placeholder: "My API Server"
   - Helper: "Used in the UI and as the default for the slug below."
   - Max 80 chars. Character counter appears when >60 chars used (e.g. `72 / 80` right-aligned, `--text-muted`).

2. **Slug** (special input — `SlugInput`)
   - Label: "Slug"
   - Auto-fills from name as user types (debounced, ~300ms). Converts to lowercase kebab-case.
   - Shows computed slug in monospace font inside the input.
   - Has an "Edit" button (pencil icon, `--text-muted`) on the right that unlocks manual editing. Once unlocked the input becomes editable, pencil becomes a lock/check.
   - URL preview below: `--text-muted` 12px mono: `/{org-slug}/` + `{slug}` (slug portion in `--text-primary` mono).
   - Validation: `/^[a-z0-9-]+$/`, min 2 chars, max 60 chars.
   - Error state: red border + error message below ("Only lowercase letters, numbers, and hyphens are allowed.").

**Form footer (sticky or inline, at bottom of form):**
- Left: "Cancel" link (no button style, `--text-secondary`, links back to `/[org]/projects`).
- Right: primary "Create project" button (accent). Shows spinner + disabled state while submitting.

**Redirect on success:** `/[org]/[project]` (the new project's placeholder dashboard).

**Error handling:** If slug collision occurs (from backend), show inline error below slug field: "A project with this slug already exists. Choose a different slug."

---

### 3. Project dashboard placeholder — `/[org]/[project]`

**Purpose:** Placeholder page that will become the real dashboard in Feature 05. Must not look broken now.

**Breadcrumb:** `{Org name} / {Project name}`

**Sidebar:** Project-level nav active: Dashboard, Events (disabled/coming soon), Alerts (disabled/coming soon), Settings.

**Content:** Centered placeholder block:
- Lucide `layout-dashboard` icon, 32px, `--text-muted`.
- Heading: "Dashboard"
- Body (`--text-secondary`): "Project overview, charts, and counters will appear here in a future update."
- Optional: a quiet "View events" or "Configure API keys" secondary link if any keys exist — not required.

Tone: neutral, not apologetic. Engineers understand placeholder states.

---

### 4. Project settings — `/[org]/[project]/settings`

**Purpose:** Edit project name and slug. Breadcrumb: `{Org name} / {Project name} / Settings`.

**Layout:** Vertical sections separated by horizontal rules (`--border-subtle`). Max-width ~600px, left-aligned inside content area.

**Section: General**

Form with same Name + Slug fields as create form (pre-filled). "Save changes" button (accent). Shows "No changes" state (button disabled) until a field is changed. On save: inline success toast "Project updated." (bottom-right).

**Section: Danger zone**

Contained in a card with a `--danger` left border or `1px --danger` border on the card. Slightly different background tone (`--bg-raised`).

- Section header: "Danger zone" in `--text-primary` 14px 500.
- One row: "Delete project" — description on left, action button on right.
  - Description: "Permanently soft-deletes this project. All API keys will be revoked immediately. Events are retained for 30 days."
  - Button: "Delete project" — outline-danger style (red border, red text, dark bg), not filled until hover.
  - Clicking opens `ProjectDeleteDialog` (see Screen 5).

---

### 5. Project delete dialog (modal)

**Purpose:** Typed-confirmation safety gate before soft-deleting a project.

**Trigger:** "Delete project" button on settings danger zone.

**Modal anatomy:**
- Modal: `--bg-overlay`, `border-radius: 8px`, `--shadow-3`, max-width 480px. Centered in viewport with dark backdrop.
- Header: icon `trash-2` (Lucide, 16px, `--danger`), title "Delete project" in `--text-primary`.
- Body:
  - First paragraph: "This will delete **{project name}** and revoke all its API keys immediately. Events already sent will be retained for 30 days."
  - Second paragraph: "This action cannot be undone."
  - Label: "Type **{project slug}** to confirm" — the slug is shown in bold monospace so the user knows exactly what to type.
  - Text input: full-width, monospace font, placeholder `{project slug}`.
- Footer:
  - Left: "Cancel" button (ghost/neutral).
  - Right: "Delete project" button — filled danger (`--danger` bg), disabled until input value exactly matches the project slug (case-sensitive). Enabled state: red fill, white text. Shows spinner + "Deleting…" while submitting.

**After success:** Redirect to `/[org]/projects`. Toast: "Project deleted."

**Error handling:** If delete fails, show error message inside dialog below the input.

---

### 6. API keys — `/[org]/[project]/settings/api-keys`

**Purpose:** List and manage API keys for the current project.

**Breadcrumb:** `{Org name} / {Project name} / Settings / API keys`

**Sidebar active:** Settings (with sub-nav: General, API keys, Danger zone).

**Page header:** "API keys" (left). "Create API key" button (right, accent, icon `plus`). Hidden if user lacks `api_keys.manage`.

---

#### State A — Empty

Inline empty state (not full-page — page has the header and breadcrumb):
- Lucide `key` icon, 24px, `--text-muted`.
- "No API keys" (14px, 500).
- "Create a key to start ingesting events into this project." (`--text-secondary`, 13px).
- "Create API key" CTA button (accent). Hidden if no permission.

---

#### State B — Keys table

Dense table (`components-table.html` pattern). No zebra stripes. 1px `--border-subtle` between rows.

**Columns:**
| Column | Width | Notes |
|---|---|---|
| Name | flex | 13px, `--text-primary` |
| Key | 180px | `lgr_aBcD…` — monospace, `--text-secondary`. Format: prefix + `...` (7 visible chars + ellipsis). Tooltip on hover shows "Full key cannot be retrieved." |
| Last used | 120px | Relative time ("2h ago") or "Never" in `--text-muted`. |
| Status | 80px | Badge: `active` (success green) or `revoked` (muted gray). |
| Actions | 80px | "Revoke" button (text-only, danger color). Hidden if revoked. Hidden if user lacks `api_keys.manage`. |

**Row hover:** `--surface-hover` bg.

**Revoked rows:** name and key rendered in `--text-muted`, status badge `revoked`.

---

### 7. Create API key dialog

**Trigger:** "Create API key" button on API keys page.

**Modal anatomy:**
- Title: "Create API key"
- Single field: "Key name" — text input, required. Placeholder: "Production server". Helper: "A label to identify this key. Shown in the key list."
- Footer: "Cancel" (ghost) + "Create" (accent, disabled until name filled, spinner on submit).

**On success:** This dialog closes and immediately `ApiKeyCreatedDialog` opens (Screen 8). The transition should feel like a natural continuation, not a jarring replacement. Fade-cross between the two modals or close one and open the other within 150ms.

---

### 8. API key created — one-time reveal (critical screen)

**Purpose:** Show the newly created key exactly once. This is the most security-critical screen in Feature 02 — must communicate irreversibility clearly without being alarmist.

**Trigger:** Immediately after successful key creation.

**Visual treatment:** This modal should feel visually distinct from standard dialogs — it signals "this moment matters."

**Modal anatomy:**
- Header: icon `key` (Lucide, 16px, accent color), title "Your new API key"
- **Key display block** — the focal element:
  - Full-width box with `--bg-base` background (darker than overlay), `1px --accent-border` border, `border-radius: 6px`, padding 12px 16px.
  - The key value (`lgr_...`) in `--font-mono`, 13px, `--text-primary`. Long value — single line with horizontal scroll or break-word.
  - "Copy" button (`copy` Lucide icon, 14px) on the right edge of the block. On click: icon switches to `check` for 2s, toast "Copied." (or just icon change — no toast needed).
  - Below the key block: a quiet warning line in `--text-secondary` 12px: "This key will not be shown again. Copy it now and store it securely." — this is factual, not alarming.
- **Checkbox confirmation:**
  - Checkbox + label: "I've saved this key in a secure location."
  - Unchecked by default. Until checked, the "Close" button is disabled.
  - Checking: enables "Close".
- Footer:
  - "Close" button (primary/accent). Disabled until checkbox is checked. No cancel option — the only exit is acknowledging the key was saved (or browser close).

**Backdrop:** Same as standard modal but the accent border on the key block provides sufficient visual distinction. Do not use a different backdrop color.

**After close:** Return to the API keys list. The new key appears in the table with `active` badge.

---

### 9. Revoke API key dialog

**Trigger:** "Revoke" button on an active key row.

**Modal anatomy:**
- Title: "Revoke API key"
- Body: "This will immediately revoke **{key name}** (`lgr_{prefix}…`). Any services using this key will lose access immediately."
- Footer: "Cancel" (ghost) + "Revoke key" (filled danger). Spinner on submit.

**After success:** Modal closes. Row updates to `revoked` status (optimistic update or revalidation). Toast: "Key revoked."

---

## Component reuse checklist

Reference these from the design system (see `project/preview/`):

| Component | Used in |
|---|---|
| `components-buttons` — primary, ghost, danger outline, danger filled, icon | All screens |
| `components-inputs` — text input, error state, character counter | Create/settings forms |
| `components-overlays` — modal, toast, backdrop | Dialogs, toasts |
| `components-table` — dense table, row hover, badge column | API keys list |
| `components-badges` — status badges (active=success, revoked=muted) | API keys table |
| `components-navigation` — sidebar subnav (General / API keys / Danger zone tabs) | Settings pages |
| `components-data` — monospace code block style | Key display in reveal modal |

---

## Output format

For each screen: annotated HTML mockup using the Logger design system tokens (`colors_and_type.css`). Include:
1. Default / happy-path state (fully populated or filled form).
2. Empty state where specified.
3. Key edge cases: very long project name (28+ chars), long slug, permission-denied state (hidden buttons).
4. For dialogs: open state only (the trigger page is covered by the parent screen).

Render all mockups at 1280px viewport width inside the App Shell. Use inline styles or a `<style>` block referencing the CSS custom properties. Use Lucide icons via CDN script tag.
