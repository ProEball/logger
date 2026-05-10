"use client";

import { Suspense } from "react";
import { t } from "@/core/i18n/t";
import { useEventFilters } from "@/features/events/hooks/use-event-filters";
import { EventsFilterBar } from "../filters/EventsFilterBar/EventsFilterBar";
import { EventsTable } from "../EventsTable/EventsTable";
import { PaginationControls } from "../pagination/PaginationControls/PaginationControls";
// EventDrawer is only needed after the user selects an event — keep it out of
// the initial bundle so it doesn't delay the table render.
import dynamic from "next/dynamic";

const EventDrawer = dynamic(
    () => import("../detail/EventDrawer/EventDrawer")
        .then((m) => ({ default: m.EventDrawer })),
);
import { AutoRefreshControl } from "../auto-refresh/AutoRefreshControl/AutoRefreshControl";
import { TableSkeleton } from "@/shared/components/Skeletons/TableSkeleton";
import type { Event } from "@/core/db/schema";
import type { EventFilters, Cursor } from "@/features/events/utils/event-filters.types";
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

export function EventsPage({
    events,
    hasMore,
    cursor,
    selectedEvent,
    activeTab,
}: EventsPageProps) {
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
                <h1 className={styles.title}>{t("events.title")}</h1>
                <AutoRefreshControl />
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
