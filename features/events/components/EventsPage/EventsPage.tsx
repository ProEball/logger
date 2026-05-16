"use client";

import { Suspense } from "react";
import { t } from "@/core/i18n/t";
import { useSelector } from "react-redux";
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
import { AutoRefreshControl } from "../auto-refresh/AutoRefreshControl/AutoRefreshControl";
import { TableSkeleton } from "@/shared/components/Skeletons/TableSkeleton";
import type { Event } from "@/core/db/schema";
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
}: EventsPageProps) {
    const refresh = useSelector(selectAutoRefresh);

    const {
        filters,
        setLevels,
        setEnvironments,
        setSources,
        setReleases,
        setErrorTypes,
        setMessage,
        setTimeRange,
        setCorrelation,
        addAttribute,
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
                        {getSubtitle(refresh)}
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
                    onSetLevels={setLevels}
                    onSetEnvironments={setEnvironments}
                    onSetSources={setSources}
                    onSetReleases={setReleases}
                    onSetErrorTypes={setErrorTypes}
                    onSetMessage={setMessage}
                    onSetTimeRange={setTimeRange}
                    onSetCorrelation={setCorrelation}
                    onAddAttribute={addAttribute}
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
