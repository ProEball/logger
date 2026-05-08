"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Table } from "@/shared/components/Table/Table";
import { LevelBadge } from "@/shared/components/LevelBadge/LevelBadge";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import { EventTimestamp } from "../EventTimestamp/EventTimestamp";
import type { Event } from "@/core/db/schema";
import type { LogLevel } from "@/shared/components/LevelBadge/LevelBadge";
import type { TableColumn } from "@/shared/components/Table/Table";
import styles from "./EventsTable.module.scss";

interface EventRow extends Event {
    id: string;
}

interface EventsTableProps {
    events: Event[];
    selectedEventId?: string;
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

    const columns: TableColumn<EventRow>[] = [
        {
            key: "timestamp",
            header: t("events.table.timestamp"),
            width: 200,
            render: (row) => (
                <EventTimestamp
                    timestamp={row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp)}
                    className={styles.timestamp}
                />
            ),
        },
        {
            key: "level",
            header: t("events.table.level"),
            width: 80,
            render: (row) => <LevelBadge level={row.level as LogLevel} size="sm" />,
        },
        {
            key: "message",
            header: t("events.table.message"),
            render: (row) => <span className={styles.message}>{row.message}</span>,
        },
        {
            key: "source",
            header: t("events.table.source"),
            width: 120,
            render: (row) => <span className={styles.meta}>{row.source ?? "—"}</span>,
        },
        {
            key: "environment",
            header: t("events.table.environment"),
            width: 110,
            render: (row) => <span className={styles.meta}>{row.environment ?? "—"}</span>,
        },
    ];

    const rows: EventRow[] = events.map((e) => ({
        ...e,
        variant: e.level === "error" ? "error" : e.level === "fatal" ? "fatal" : "default",
        selected: e.id === selectedEventId,
    }));

    if (events.length === 0) {
        return (
            <div className={styles.empty}>
                <p className={styles.emptyText}>{t("events.empty")}</p>
            </div>
        );
    }

    return (
        <Table
            columns={columns}
            rows={rows}
            onRowClick={openDrawer}
            stickyHeader
            ariaLabel={t("events.title")}
            className={styles.table}
        />
    );
}
