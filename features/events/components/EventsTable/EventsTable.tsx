"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { LevelBadge } from "@/shared/components/LevelBadge/LevelBadge";
import { t } from "@/core/i18n/t";
import type { Event } from "@/shared/types/event.types";
import type { LogLevel } from "@/shared/components/LevelBadge/LevelBadge";
import styles from "./EventsTable.module.scss";

interface EventsTableProps {
    events: Event[];
    selectedEventId?: string;
}

function splitTimestamp(ts: Date): { date: string; time: string; ms: string } {
    const iso = ts.toISOString();
    const [date, rest] = iso.split("T");
    const [hms, msPart] = rest.split(".");
    return { date, time: hms, ms: msPart?.replace("Z", "").slice(0, 3) ?? "000" };
}

function getRowClass(level: string): string {
    if (level === "error") return styles.rowError;
    if (level === "fatal") return styles.rowFatal;
    if (level === "warn")  return styles.rowWarn;
    return "";
}

function getEnvDotClass(env: string | null | undefined): string {
    if (!env) return "";
    if (env === "staging") return styles.envDotStaging;
    if (env === "development" || env === "dev") return styles.envDotDev;
    return "";
}

export function EventsTable({ events, selectedEventId }: EventsTableProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const openDrawer = (event: Event) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("event", event.id);
        params.set("event_ts", (event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp)).toISOString());
        params.delete("tab");
        router.replace(`${pathname}?${params.toString()}`);
    };

    if (events.length === 0) {
        return (
            <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
                    </svg>
                </div>
                <p className={styles.emptyTitle}>No events match your filters</p>
                <p className={styles.emptyText}>{t("events.empty")}</p>
            </div>
        );
    }

    return (
        <table className={styles.table} aria-label={t("events.title")}>
            <thead>
                <tr>
                    <th style={{ width: 200 }}>{t("events.table.timestamp")}</th>
                    <th style={{ width: 80 }}>{t("events.table.level")}</th>
                    <th>{t("events.table.message")}</th>
                    <th style={{ width: 120 }}>{t("events.table.source")}</th>
                    <th style={{ width: 110 }}>{t("events.table.environment")}</th>
                </tr>
            </thead>
            <tbody>
                {events.map((event) => {
                    const ts = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);
                    const { date, time, ms } = splitTimestamp(ts);
                    const isSelected = event.id === selectedEventId;
                    const rowClass = [
                        getRowClass(event.level),
                        isSelected ? styles.selected : "",
                    ].filter(Boolean).join(" ");

                    return (
                        <tr
                            key={event.id}
                            className={rowClass || undefined}
                            onClick={() => openDrawer(event)}
                            aria-selected={isSelected}
                        >
                            <td className={styles.colTime}>
                                {date}&nbsp;&nbsp;{time}<span className={styles.tsMs}>.{ms}</span>
                            </td>
                            <td className={styles.colLevel}>
                                <LevelBadge level={event.level as LogLevel} size="sm" />
                            </td>
                            <td className={styles.colMsg} title={event.message}>
                                {event.message}
                            </td>
                            <td className={styles.colSource}>
                                {event.source ?? "—"}
                            </td>
                            <td className={styles.colEnv}>
                                <div className={styles.envCell}>
                                    <span className={`${styles.envDot} ${getEnvDotClass(event.environment)}`} aria-hidden />
                                    {event.environment ?? "—"}
                                </div>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
