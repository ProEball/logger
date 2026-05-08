"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import type { Event } from "@/core/db/schema";
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
        // Remove event drawer on page change
        params.delete("event");
        params.delete("event_ts");
        params.delete("tab");
        router.push(`${pathname}?${params.toString()}`);
    };

    return (
        <div className={styles.controls}>
            <Button
                variant="ghost"
                size="sm"
                onClick={goNewer}
                disabled={!cursor}
            >
                ← {t("events.pagination.newer")}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={goOlder}
                disabled={!hasMore}
            >
                {t("events.pagination.older")} →
            </Button>
        </div>
    );
}
