# Screens for Feature 01 — Auth, Organizations & Roles

> Scope note: this file currently covers only the **Roles management** screens
> (`/settings/roles`, `/settings/roles/new`, `/settings/roles/[id]`). The rest
> of Feature 01 (login, setup wizard, invite acceptance, account/sessions) is
> not yet written up here — append sections for those screens before running
> a full-feature design pass. Output destination per the feature doc
> (`docs/features/01-auth-organizations-roles.md` → Designs): `docs/designs/screens/01-auth/`.

## Context

- Design system reference: `docs/designs/system/logger-design-system/`
  - Tokens: `project/colors_and_type.css`
  - Component previews: `project/preview/`
  - UI kit: `project/ui_kits/logger/`
- **Logger** is a self-hosted log aggregation tool for software teams. Developer tool — not a consumer product. Users are engineers running long sessions in dense UIs.
- **Dark theme is primary.** All decisions made against `--bg-base`.
- **Tone:** sober, technical. No emoji. No "Awesome!". Sentence case everywhere.
- **Typography:** Geist Sans 13px base, Geist Mono for IDs/keys/slugs/code.
- **Icons:** Lucide Icons, 16px default, 1.5px stroke.
- **Radii:** buttons/inputs 4px, cards/panels 6px, modals 8px.
- **Spacing:** 4px base unit.

## App shell context

Both screens live inside the App Shell (Feature 00/01): left sidebar (org switcher at top, then org-level nav — Overview, Team, Settings). "Settings" is an expandable sidebar entry: clicking it reveals an indented sub-tree (General / Roles / Danger Zone) directly in the sidebar, matching the same expand pattern used for the active project's nav tree. "Roles" is only visible in that sub-tree to organization owners.

Top bar: breadcrumb, right-side user avatar menu.

## Redesign goal

These two screens currently work but were built with plain, utilitarian markup (bare HTML `<table>`, flat checkbox list) while the rest of the app has since received a visual pass. Bring them up to the same polish level as the Team page (`/[org]/team`) and API keys page — same table treatment, spacing, and micro-interactions — without changing the underlying data or actions listed below.

Specific current pain points to address:
- The permissions matrix is one long uniform list of checkboxes per group (see `PermissionMatrix.tsx`) — six stacked groups (Organization, Members & Roles, Projects, Events, Alerts, API Keys), each just an uppercase label over a vertical checkbox stack. It reads as a wall of checkboxes with no visual rhythm on roles with many permissions (e.g. Admin has 16). Wants stronger grouping (cards, columns, or a collapsible layout) so scanning is faster.
- Role name badges (System / Custom / Default) are plain flat pills — fine functionally, could use more consistent color/weight treatment against the design system's badge component.
- The roles table's actions column (Edit link + Delete button) feels cramped and inconsistently styled compared to Team's member row actions (which use an icon/kebab-menu pattern).

---

## Screens to design

---

### 1. Roles list — `/[org]/settings/roles`

**Purpose:** Entry point for organization owners to view and manage custom roles and see the built-in system roles.

**Access:** Owner-only — non-owners get a 404 (not a permission-denied screen; don't design one).

**Breadcrumb:** `{Org name} / Settings / Roles`

**Page header:** Title "Roles" (left). Primary "New role" button (right, accent, `+` icon) — links to `/[org]/settings/roles/new`.

**Data shown per row (table):**
- **Name** — role name, plus inline badges: `System` (gray, for the 3 seeded roles: Admin, Member, Viewer) or `Custom` (accent color, for org-created roles), and `Default` (success green — marks the role auto-assigned to new members; currently always "Member").
- **Description** — free text, or `—` if empty.
- **Permissions** — count summary, e.g. "16 permissions", "None" if zero.
- **Actions** — "Edit" (always, links to `/[org]/settings/roles/{id}`), "Delete" (only for non-system/custom roles — system roles cannot be deleted).

**Actions:**
- Delete a custom role → `ConfirmDialog`: "Delete the "{name}" role? This cannot be undone." Destructive confirm. Inline error in the dialog if the backend rejects (e.g. role still assigned to a member).

**States:** default (populated — always has ≥3 rows since system roles are seeded per org, so no true empty state), loading skeleton, inline error banner if the fetch fails.

**Edge cases:** long role name, long description (truncate with ellipsis + title tooltip), a role with 0 permissions, many custom roles requiring scroll.

**Reuses:** dense table pattern (`components-table`), badges (`components-badges`), ghost/primary buttons, `ConfirmDialog` overlay.

---

### 2. Create / edit role — `/[org]/settings/roles/new` and `/[org]/settings/roles/[id]`

**Purpose:** Single form component (`RoleEditor`) reused for both creating a new custom role and editing an existing one (system or custom). Two screen states below.

**Access:** Owner-only — non-owners get a 404.

**Layout:** Narrow-ish centered column (current max-width 560px), no card wrapper — form sits directly in the content area.

---

#### State A — Create (`/settings/roles/new`)

**Breadcrumb:** `{Org name} / Settings / Roles / New role`
**Title:** "New role"

**Form fields:**
1. **Name** (text input, required) — e.g. placeholder "QA Engineer".
2. **Description** (textarea, optional, 2 rows) — placeholder "Briefly describe what this role can do".
3. **Permissions** (the matrix described above) — six groups, each a label + checkbox list:
   - Organization (`org.read`, `org.update` — `org.delete` is owner-only and never shown here)
   - Members & Roles (`members.read`, `members.invite`, `members.remove`, `members.role.assign` — `roles.manage` is owner-only and never shown here)
   - Projects (`projects.create/read/update/delete`)
   - Events (`events.read`, `events.delete`)
   - Alerts (`alerts.read`, `alerts.manage`)
   - API Keys (`api_keys.read`, `api_keys.manage`)

**Footer:** "Cancel" (ghost, back to roles list) + "Create role" (primary, disabled/spinner while submitting).

**Error handling:** Inline error banner above the footer if submit fails (e.g. duplicate name).

---

#### State B — Edit (`/settings/roles/[id]`)

**Breadcrumb:** `{Org name} / Settings / Roles / {Role name}`
**Title:** "Edit role" (or the role name — designer's call, be consistent with other edit screens in the app)

Same form as Create, pre-filled with the role's current name, description, and permissions.

**System-role variant:** when editing one of the 3 seeded roles (Admin, Member, Viewer):
- The Name field is disabled, with a quiet inline note directly below it: "System roles cannot be renamed." (currently styled as a small left-accent note block — keep or improve this pattern, it's used elsewhere for similar inline constraints).
- Description and Permissions remain editable.
- Footer button reads "Save changes" instead of "Create role".

**Custom-role variant:** everything editable. Footer button "Save changes".

**Edge cases:** editing a role currently assigned to members (no special warning today — fine to leave as-is), toggling every permission on/off rapidly (matrix should feel snappy, no per-checkbox network round-trip — state is local until submit).

**Reuses:** `FormField` + `Input` + `Textarea` (`components-inputs`), checkbox group (`components-inputs` checkbox variant), primary/ghost buttons, inline note/callout pattern, inline error banner.

---

## Component reuse checklist

Reference these from the design system (see `project/preview/`):

| Component | Used in |
|---|---|
| `components-table` — dense table, row hover, badge column | Roles list |
| `components-badges` — System / Custom / Default badges | Roles list |
| `components-buttons` — primary, ghost, destructive-ghost | Both screens |
| `components-overlays` — confirm dialog | Delete role |
| `components-inputs` — text input, textarea, checkbox group | Create/edit form |
| `components-navigation` — expandable sidebar sub-tree (Settings → General/Roles/Danger Zone) | Both screens (sidebar context) |

---

## Output format

For each screen: annotated HTML mockup using the Logger design system tokens (`colors_and_type.css`). Include:
1. Default/happy-path state (list with a mix of system + custom roles; create form empty; edit form pre-filled).
2. The system-role "name disabled" variant on the edit form.
3. Key edge cases: long role name/description, a role with many permissions (16, like Admin) to show matrix density, delete confirm dialog open state.

Render all mockups at 1280px viewport width inside the App Shell (sidebar visible, with Settings expanded and Roles active). Use inline styles or a `<style>` block referencing the CSS custom properties. Use Lucide icons via CDN script tag.
