import { CardSkeleton, WidgetSkeleton } from "@/shared/components";
// The page's own stylesheet, for the reason given in DashboardSkeleton: the
// skeleton has to occupy this page's layout, and restating `.content` or
// `.bottomRow` here would let the two drift apart silently.
import styles from "../OverviewPage/OverviewPage.module.scss";

/**
 * What the org overview shows while its prologue runs.
 *
 * **This route had no `loading.tsx` at all until 2026-08-22.** Without one the
 * App Router has no boundary to commit to, so a navigation into the overview
 * held the *previous* page on screen, untouched, until the entire RSC payload
 * was ready. On staging that was four to five seconds of a page that looked
 * like nothing had been clicked — the streaming work of §16.1 was invisible on
 * the way in, because it only ever applied to a document load.
 *
 * Mirrors `OverviewPage`'s sections one for one, for the same reason the
 * dashboard's does: the handover to the page's own per-section fallbacks is
 * then seamless, and a section still showing a skeleton is a section whose
 * query is still running. See `DashboardSkeleton` for why the boundaries must
 * stay one per read surface.
 */
export function OverviewSkeleton() {
    return (
        <div className={styles.page} role="status" aria-label="Loading overview">
            <div className={styles.filterBarFallback} />

            <div className={styles.content}>
                {/* KPI row */}
                <CardSkeleton />

                {/* Volume chart */}
                <WidgetSkeleton />

                {/* Projects panel */}
                <WidgetSkeleton />

                <div className={styles.bottomRow}>
                    {/* Top errors */}
                    <WidgetSkeleton />
                    {/* Level breakdown */}
                    <WidgetSkeleton />
                </div>
            </div>
        </div>
    );
}
