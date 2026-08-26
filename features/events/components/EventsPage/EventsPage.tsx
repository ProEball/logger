"use client";

import { Suspense } from "react";
import { t } from "@/core/i18n/t";
import { useSelector } from "react-redux";
import { useIsHydrated } from "@/shared/hooks/use-is-hydrated";
import { selectAutoRefresh } from "@/core/store/slices/user";
import { useEventFilters } from "@/features/events/hooks/use-event-filters";
import { EventsFilterBar } from "../filters/EventsFilterBar/EventsFilterBar";
import { EventsTable } from "../EventsTable/EventsTable";
import { PaginationControls } from "../pagination/PaginationControls/PaginationControls";
import dynamic from "next/dynamic";

const EventDrawer = dynamic(
    () => import("../detail/EventDrawer/EventDrawer")
        .then((m) => ({ default: m.EventDrawer })),
);
import { AutoRefreshControl } from "@/shared/components/AutoRefreshControl/AutoRefreshControl";
import { TableSkeleton } from "@/shared/components/Skeletons/TableSkeleton";
import type { Event } from "@/shared/types/event.types";
import type { EventFilters, Cursor } from "@/features/events/utils/event-filters.types";
import type { AutoRefreshValue } from "@/shared/types/user-preferences.types";
import styles from "./EventsPage.module.scss";

interface EventsPageProps {
    events: Event[];
    hasMore: boolean;
    cursor: Cursor | undefined;
    filters: EventFilters;
    selectedEvent: Event | null;
    activeTab: string;
    orgSlug: string;
    projectSlug: string;
}

function getSubtitle(refresh: AutoRefreshValue): string {
    if (refresh === "off") return "Streaming · manual refresh";
    return `Streaming · auto-refresh every ${refresh}`;
}

export function EventsPage({
    events,
    hasMore,
    cursor,
    selectedEvent,
    activeTab,
    orgSlug,
    projectSlug,
}: EventsPageProps) {
    const refresh = useSelector(selectAutoRefresh);
    // `refresh` is seeded from Redux's default state and only corrected after
    // OrgHydrator's mount effect dispatches the real preference (see the same note in
    // AutoRefreshControl.tsx), so SSR and the first client paint disagree. Render the
    // SSR-safe default until mounted so hydration always agrees.
    const mounted = useIsHydrated();

    const {
        filters,
        applyFilters,
        setTimeRange,
        removeAttribute,
        removeFilter,
        clearAll,
    } = useEventFilters();

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.titleGroup}>
                    <h1 className={styles.title}>{t("events.title")}</h1>
                    <div className={styles.subtitle}>
                        <span className={styles.liveDot} aria-hidden />
                        {getSubtitle(mounted ? refresh : "off")}
                    </div>
                </div>
                <div className={styles.headSpacer} />
                <div className={styles.headActions}>
                    <AutoRefreshControl />
                </div>
            </header>

            <Suspense>
                <EventsFilterBar
                    filters={filters}
                    orgSlug={orgSlug}
                    projectSlug={projectSlug}
                    onApplyFilters={applyFilters}
                    onSetTimeRange={setTimeRange}
                    onRemoveAttribute={removeAttribute}
                    onRemoveFilter={removeFilter}
                    onClearAll={clearAll}
                    eventCount={events.length}
                    hasMore={hasMore}
                />
            </Suspense>

            <Suspense fallback={<TableSkeleton />}>
                <div className={styles.tableWrap}>
                    <EventsTable
                        events={events}
                        selectedEventId={selectedEvent?.id}
                    />
                </div>
            </Suspense>

            <Suspense>
                <PaginationControls
                    events={events}
                    hasMore={hasMore}
                    cursor={cursor}
                />
            </Suspense>

            <Suspense>
                <EventDrawer
                    event={selectedEvent}
                    activeTab={activeTab}
                />
            </Suspense>
        </div>
    );
}
