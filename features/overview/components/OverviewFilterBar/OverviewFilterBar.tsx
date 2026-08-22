"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { AutoRefreshControl } from "@/shared/components/AutoRefreshControl/AutoRefreshControl";
import styles from "./OverviewFilterBar.module.scss";

const PRESETS = ["15m", "1h", "6h", "24h", "7d", "30d"] as const;

/**
 * The org overview filters by **range and environment only**.
 *
 * Level chips were removed on 2026-08-20. They reached three of the page's
 * eight widgets — the KPI row, the per-project stats and org-wide top errors —
 * and left the other five visibly unchanged: the volume chart ignores level
 * filters by construction, the level breakdown is *about* levels so narrowing
 * to one would empty it, and the per-project top message never received the
 * filter at all (a defect with its own e2e test, deleted with the filter).
 *
 * A control that moves three things and leaves five alone does not read as a
 * filter with a documented scope; it reads as a broken filter. The drill-down
 * it offered still exists per project on the events page, where filtering
 * applies to everything on screen.
 *
 * Rejected: making it reach all eight instead. That means teaching the volume
 * chart to read `by_level` from the rollup and fixing the top-message defect —
 * real work, in service of a control nobody asked to keep.
 */
interface OverviewFilterBarProps {
    range: string;
    environment: string;
    environments: string[];
    searchString: string;
}

export function OverviewFilterBar({
    range,
    environment,
    environments,
    searchString,
}: OverviewFilterBarProps) {
    const router = useRouter();

    const update = useCallback(
        (key: string, value: string) => {
            const params = new URLSearchParams(searchString);
            if (value) {
                params.set(key, value);
            } else {
                params.delete(key);
            }
            router.push(`?${params.toString()}`);
        },
        [router, searchString],
    );

    return (
        <div className={styles.bar}>
            {/* Range presets */}
            <div className={styles.group} role="group" aria-label="Time range">
                {PRESETS.map((p) => (
                    <button
                        key={p}
                        type="button"
                        className={`${styles.pill} ${range === p ? styles.pillActive : ""}`}
                        onClick={() => update("range", p)}
                    >
                        {p}
                    </button>
                ))}
            </div>

            {environments.length > 0 && (
                <>
                    <div className={styles.sep} />
                    <div className={styles.group} role="group" aria-label="Environments">
                        <button
                            type="button"
                            className={`${styles.pill} ${environment === "" ? styles.pillActive : ""}`}
                            onClick={() => update("env", "")}
                        >
                            All envs
                        </button>
                        {environments.map((env) => (
                            <button
                                key={env}
                                type="button"
                                className={`${styles.pill} ${environment === env ? styles.pillActive : ""}`}
                                onClick={() => update("env", env)}
                            >
                                {env}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/*
              * Auto-refresh, added 2026-08-20 — the overview was the only
              * dashboard without it. Trailing edge and behind a spacer,
              * because it changes how often the page reloads rather than what
              * it shows, and sitting in the run of filter pills would read as
              * a third filter.
              *
              * Worth knowing: the shortest interval is 30 s and the read cache
              * TTL is also 30 s, so a refresh can land on a value up to 30 s
              * old — effective staleness reaches a minute. See
              * `overview-cache.service.ts`.
              */}
            <div className={styles.spacer}>
                <AutoRefreshControl />
            </div>
        </div>
    );
}
