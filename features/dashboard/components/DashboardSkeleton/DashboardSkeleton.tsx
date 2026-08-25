import { WidgetSkeleton } from "@/shared/components";
/**
 * The page's own stylesheet, deliberately imported across the component folder
 * rather than restated here. This skeleton exists to occupy the dashboard's
 * grid exactly, and a copied `.span8` is a copy nobody updates: the next person
 * to change a widget's width would silently leave the loading state describing
 * a layout that no longer exists.
 */
import styles from "../DashboardPage/DashboardPage.module.scss";

/**
 * What the route shows while its prologue runs.
 *
 * Replaces the generic `PageSkeleton` (a heading and eight grey bars) as of
 * 2026-08-22. The point is not decoration. `DashboardPage` gives **every widget
 * its own `Suspense` boundary**, so once the page renders, each skeleton
 * disappears the moment its own query returns — and the one still sitting there
 * is, visibly and without a profiler, the expensive query. On staging that is
 * `topMessages`: at a 30-day range it holds its cell for roughly seventeen
 * seconds while the other five fill in under three hundred milliseconds.
 *
 * Matching the real grid here is what makes that continuous. The route's
 * fallback hands over to the page's own per-widget fallbacks without the layout
 * jumping, so what the viewer sees is cells filling in one by one from the first
 * frame — not a grey page that is replaced wholesale by a different shape.
 *
 * ⚠️ That diagnostic only survives while the boundaries stay per widget.
 * Grouping several under one `Suspense` — tempting whenever two widgets share a
 * row — makes them all wait for the slowest and throws the signal away.
 */
const CELLS = [
    // Row 1 — four KPI cards.
    "span3",
    "span3",
    "span3",
    "span3",
    // Row 2 — events chart, level breakdown.
    "span8",
    "span4",
    // Row 3 — recent errors, top sources.
    "span8",
    "span4",
    // Row 4 — top messages, full width. The slow one.
    "span12",
] as const;

export function DashboardSkeleton() {
    return (
        <div className={styles.page} role="status" aria-label="Loading dashboard">
            {/*
              * One bar-shaped block, not a title-and-subtitle pair. This stood
              * in for `DashboardHeader` until that component was deleted on
              * 2026-08-25; the page now opens with the shared filter bar, and a
              * placeholder that does not match what arrives shifts the grid
              * when it does.
              */}
            <div className={styles.filterBarFallback} />

            <div className={styles.grid}>
                {CELLS.map((span, i) => (
                    <div key={i} className={styles[span]}>
                        <WidgetSkeleton />
                    </div>
                ))}
            </div>
        </div>
    );
}
