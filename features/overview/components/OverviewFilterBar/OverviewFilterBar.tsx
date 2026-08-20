"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./OverviewFilterBar.module.scss";

const PRESETS = ["15m", "1h", "6h", "24h", "7d", "30d"] as const;

const ALL_LEVELS = ["fatal", "error", "warn", "info", "debug"] as const;
type Level = (typeof ALL_LEVELS)[number];

const LEVEL_COLORS: Record<Level, string> = {
    fatal: "var(--lvl-fatal)",
    error: "var(--lvl-error)",
    warn:  "var(--lvl-warn)",
    info:  "var(--lvl-info)",
    debug: "var(--lvl-debug)",
};

interface OverviewFilterBarProps {
    range: string;
    levels: string[];
    environment: string;
    environments: string[];
    searchString: string;
}

export function OverviewFilterBar({
    range,
    levels,
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

    const toggleLevel = useCallback(
        (level: string) => {
            const next = levels.includes(level)
                ? levels.filter((l) => l !== level)
                : [...levels, level];
            update("levels", next.join(","));
        },
        [levels, update],
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

            <div className={styles.sep} />

            {/* Level chips */}
            <div className={styles.group} role="group" aria-label="Levels">
                {ALL_LEVELS.map((level) => {
                    const active = levels.includes(level);
                    return (
                        <button
                            key={level}
                            type="button"
                            className={`${styles.pill} ${active ? styles.pillLevelActive : ""}`}
                            style={active ? {
                                borderColor: LEVEL_COLORS[level],
                                color: LEVEL_COLORS[level],
                                background: `color-mix(in srgb, ${LEVEL_COLORS[level]} 12%, transparent)`,
                            } : undefined}
                            onClick={() => toggleLevel(level)}
                        >
                            <span
                                className={styles.levelDot}
                                style={{ background: LEVEL_COLORS[level] }}
                            />
                            {level}
                        </button>
                    );
                })}
                {levels.length > 0 && (
                    <button
                        type="button"
                        className={styles.clearBtn}
                        onClick={() => update("levels", "")}
                    >
                        ✕
                    </button>
                )}
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
        </div>
    );
}
