# Designs

Outputs from design generation (Claude Design or any other tool) live here.
This folder is the **destination** — prompts for generation live in `docs/prompts/`.

## Structure

```
designs/
  system/                      — design system output (tokens, components, patterns)
    tokens.md                  — colors, typography, spacing, radii, shadows, motion
    components.md              — visual specs for each component
    patterns.md                — app shell, list/detail, dashboard, settings layouts
    images/                    — any visual mockups exported from the design tool
  screens/
    01-auth/                   — feature 01 screen designs
    02-projects/
    03-ingest/
    04-events/
    05-dashboard/
    06-alerts/
    07-polish/
```

## Workflow

1. Generate design system once early (paste `docs/prompts/design-system.md` into Claude).
2. Save the output as Markdown in `system/`. Save any rendered images in `system/images/`.
3. Per feature: when its plan is detailed, create `docs/prompts/screens/NN-<feature>.md`, generate, save the result in `screens/NN-<feature>/`.
4. Implementation references the design folder from the feature doc's `Designs` section.

## What "design output" looks like

We are NOT asking Claude (or any tool) for code. We want:
- Token tables (with hex values for both themes)
- Component specs with states, sizes, variants
- Annotated mockups (text descriptions if no image)
- Layout diagrams
- Rationale for each major choice

Implementation translates these into:
- `app/styles/_tokens.scss` (CSS custom properties)
- `shared/components/<Component>/` folders (TSX + module.scss)
- Layout primitives in `shared/components/AppShell/` etc.
