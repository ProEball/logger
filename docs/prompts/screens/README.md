# Screen Prompts

One prompt per feature, used to generate screen designs in Claude (or another design tool).

## Structure

```
prompts/screens/
  01-auth.md                   — login, setup wizard, invite acceptance, account, sessions
  02-projects.md               — projects list, create, settings, API keys
  03-ingest.md                 — likely empty (server-side only) or merged into 02
  04-events.md                 — events list with filters, drawer detail, time range picker
  05-dashboard.md              — widgets, layout
  06-alerts.md                 — rule editor, alert list, history
  07-polish.md                 — empty/error/loading state variants across features
```

## Workflow

1. Detail the feature plan in `docs/features/NN-<feature>.md`.
2. Create `prompts/screens/NN-<feature>.md` here, listing all screens in that feature with: data fields, actions, states (default/loading/error/empty), edge cases, references to the design system.
3. Paste into Claude → save the result in `docs/designs/screens/NN-<feature>/`.
4. Update the feature doc's `Designs` section with status.

## Prompt template (use for each screen prompt)

```markdown
# Screens for Feature NN — <Feature Name>

## Context
- Refer to the design system in docs/designs/system/
- This product is Logger, a self-hosted log aggregation tool. See docs/PLAN.md §1.
- Dark theme is primary. Density over whitespace. Developer tool aesthetic.

## Screens to design

### 1. <Screen name and route>
- **Purpose**: …
- **Data shown**: …
- **Actions**: …
- **States**: default, loading (skeleton), empty, error
- **Edge cases**: very long values, no data, permission-denied state
- **Reuses**: <components from design system>

### 2. …

## Output format
For each screen: annotated mockup (or detailed spec), state variants, behavior notes.
```

The key to good screen prompts is **specifying data and actions explicitly**, not asking the design tool to invent the product.
