"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import type { Event } from "@/shared/types/event.types";
import type { Cursor } from "@/features/events/utils/event-filters.types";
import { serializeCursor } from "@/features/events/utils/parse-cursor";
import styles from "./PaginationControls.module.scss";

interface PaginationControlsProps {
    events: Event[];
    hasMore: boolean;
    cursor: Cursor | undefined;
}

export function PaginationControls({ events, hasMore, cursor }: PaginationControlsProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const goNewer = () => {
        router.back();
    };

    const goOlder = () => {
        if (!events.length) return;
        const last = events[events.length - 1];
        const ts = last.timestamp instanceof Date ? last.timestamp : new Date(last.timestamp);
        const nextCursor: Cursor = { beforeTs: ts.toISOString(), beforeId: last.id };
        const params = new URLSearchParams(searchParams.toString());
        const cursorParams = serializeCursor(nextCursor);
        params.set("before_ts", cursorParams.before_ts);
        params.set("before_id", cursorParams.before_id);
        params.delete("event");
        params.delete("event_ts");
        params.delete("tab");
        router.push(`${pathname}?${params.toString()}`);
    };

    const refresh = () => {
        router.refresh();
    };

    const total = hasMore ? `${events.length}+` : String(events.length);

    return (
        <footer className={styles.footer}>
            <span className={styles.info}>
                Showing <b>{events.length}</b> of <b>{total}</b> events
            </span>
            <div className={styles.spacer} />
            <Button variant="ghost" size="sm" onClick={refresh}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                </svg>
                Refresh
            </Button>
            <Button
                variant="secondary"
                size="sm"
                onClick={goNewer}
                disabled={!cursor}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="m15 18-6-6 6-6" />
                </svg>
                {t("events.pagination.newer")}
            </Button>
            <Button
                variant="secondary"
                size="sm"
                onClick={goOlder}
                disabled={!hasMore}
            >
                {t("events.pagination.older")}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="m9 18 6-6-6-6" />
                </svg>
            </Button>
        </footer>
    );
}
