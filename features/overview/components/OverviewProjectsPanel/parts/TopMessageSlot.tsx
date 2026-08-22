import type { ProjectTopMessage } from "@/features/overview/services/overview.service";
import styles from "./TopMessageSlot.module.scss";

/**
 * The per-project top error message, rendered on its own.
 *
 * **Why it is a separate component rather than a field on `ProjectRow`.** The
 * query behind it costs ~954 ms on staging, against ~30 ms for every other
 * number in the row. As one promise, the whole projects panel — and the KPI row
 * that shares it — waited for this column. Split out and wrapped in `Suspense`
 * by `OverviewProjectsPanel`, the table paints its numbers immediately and this
 * cell fills in when the query lands.
 *
 * It is created by the panel and handed to `ProjectCards` / `ProjectStatsTable`
 * as a `ReactNode`. Those are client components (the Cards/Table toggle is
 * `useState`), and a Server Component cannot be rendered *inside* one — but it
 * can be passed *into* one as a prop, which is the documented slot pattern and
 * is what keeps the streaming boundary on the server where the promise lives.
 *
 * Truncation is CSS, not `slice()`. Both call sites already clip with
 * `text-overflow: ellipsis` / `-webkit-line-clamp`, so cutting at 64 and 58
 * characters as well did nothing the CSS was not already doing — while cutting
 * by *character count* on a proportional font, which throws away text that
 * would have fit and keeps text that does not.
 *
 * (An earlier version of this comment claimed the two produced a doubled
 * ellipsis. They cannot: `text-overflow` replaces the overflowing tail rather
 * than appending to it, so the JS ellipsis is what gets clipped away. The
 * removal was right and the reason given for it was invented.)
 */
interface TopMessageSlotProps {
    projectId: string;
    /** Table cells show a dash when there is nothing; cards show nothing. */
    variant: "table" | "card";
    topMessagesPromise: Promise<Map<string, ProjectTopMessage>>;
}

export async function TopMessageSlot({
    projectId,
    variant,
    topMessagesPromise,
}: TopMessageSlotProps) {
    const top = (await topMessagesPromise).get(projectId);

    if (!top) {
        return variant === "table" ? <span className={styles.noData}>—</span> : null;
    }

    return (
        <span className={`${styles.wrap} ${styles[variant]}`}>
            <span className={styles.dot} style={{ background: `var(--lvl-${top.level})` }} />
            <span className={styles.text} title={top.message}>
                {top.message}
            </span>
        </span>
    );
}

/**
 * Placeholder while the message query is in flight. Deliberately the same
 * height as the resolved cell so the table does not jump when it lands.
 */
export function TopMessageSkeleton({ variant }: { variant: "table" | "card" }) {
    return <span className={`${styles.skeleton} ${styles[variant]}`} aria-hidden="true" />;
}
