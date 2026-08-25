import { Suspense } from "react";
import { logger } from "@/core/logger";
import { liveRate } from "@/shared/utils/live-rate";
import styles from "./ProjectPulse.module.scss";

/**
 * The project's name and live rate, in the application top bar.
 *
 * **Moved here from the dashboard's filter bar on 2026-08-25.** It sat in that
 * bar's leading slot, immediately left of the range pills, and at any real
 * project name the two ran into each other — the name is unbounded and the
 * pills are a fixed-width run that cannot yield. The top bar is the row that
 * already answers "where am I", it is empty on its left, and it is sticky, so
 * the rate stays visible while the page scrolls.
 *
 * ## Two deliberate consequences of living in the layout
 *
 * **It is no longer filtered by environment.** The filter bar's copy narrowed
 * with the `env` pills; a layout cannot read `searchParams` in the App Router,
 * so this one counts the whole project. That is the better reading anyway: it
 * is a heartbeat for the project, shown on every project page including the
 * ones that have no environment filter at all, not a statistic about the
 * current view. A per-environment rate remains available by filtering the
 * dashboard and reading its widgets.
 *
 * **It refreshes when the page does, not on a timer of its own.** A shared
 * layout is preserved across navigation between its children, so the reading is
 * from the last full render — `router.refresh()` (auto-refresh, on the
 * dashboard and the events page) or a reload. On the settings pages, which have
 * no refresh control, it is a snapshot from arrival. Giving it a timer would
 * mean a client component polling a Server Action on every project page, which
 * is a great deal of machinery for a decorative number.
 */
interface ProjectPulseProps {
    name: string;
    /**
     * Events in the last completed minute. Passed **unawaited**: the layout
     * wraps the whole application shell, and blocking it on an aggregation
     * would delay the sidebar and the page beneath it for a number in the
     * corner.
     */
    ratePromise: Promise<number>;
}

export function ProjectPulse({ name, ratePromise }: ProjectPulseProps) {
    return (
        <div className={styles.pulse}>
            <span className={styles.dot} aria-hidden />
            <span className={styles.name}>{name}</span>
            <Suspense fallback={null}>
                <RateSection promise={ratePromise} />
            </Suspense>
        </div>
    );
}

/**
 * The rate, behind its own boundary so the project name never waits on it.
 *
 * Renders nothing on failure rather than throwing. Everywhere else in this
 * codebase a failed aggregation reaches the route's `error.tsx` and that is
 * correct — the widget is the page. Here it is not: this sits in the layout, so
 * an unhandled rejection would replace *every* project page, settings included,
 * with an error screen because a decorative counter could not be computed.
 * `PROJECT.md` §9 forbids swallowing the error, not handling it — hence the log.
 */
async function RateSection({ promise }: { promise: Promise<number> }) {
    let eventsLastMinute: number;
    try {
        eventsLastMinute = await promise;
    } catch (err) {
        logger.error({ err }, "project pulse: last-minute rate query failed");
        return null;
    }

    return <span className={styles.rate}>{liveRate(eventsLastMinute)} events / min</span>;
}
