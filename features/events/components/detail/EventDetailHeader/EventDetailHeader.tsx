"use client";

import { useState } from "react";
import { LevelBadge } from "@/shared/components/LevelBadge/LevelBadge";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import type { Event } from "@/core/db/schema";
import type { LogLevel } from "@/shared/components/LevelBadge/LevelBadge";
import styles from "./EventDetailHeader.module.scss";

interface EventDetailHeaderProps {
    event: Event;
}

export function EventDetailHeader({ event }: EventDetailHeaderProps) {
    const [copied, setCopied] = useState(false);

    const copyAsJson = () => {
        const json = JSON.stringify(event, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const ts = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);

    return (
        <div className={styles.header}>
            <div className={styles.top}>
                <LevelBadge level={event.level as LogLevel} size="md" />
                <Button variant="ghost" size="sm" onClick={copyAsJson}>
                    {copied ? "✓ Copied" : t("events.detail.copyAsJson")}
                </Button>
            </div>
            <p className={styles.message}>{event.message}</p>
            <div className={styles.meta}>
                <time dateTime={ts.toISOString()} className={styles.ts}>
                    {ts.toLocaleString()}
                </time>
                {event.environment ? (
                    <span className={styles.env}>{event.environment}</span>
                ) : null}
            </div>
        </div>
    );
}
