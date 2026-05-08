"use client";

import { Tooltip } from "@/shared/components/Tooltip/Tooltip";
import styles from "./EventTimestamp.module.scss";

interface EventTimestampProps {
    timestamp: Date;
    className?: string;
}

function formatTable(ts: Date): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hour12: false,
    }).format(ts);
}

function formatFull(ts: Date): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
    }).format(ts);
}

function formatUTC(ts: Date): string {
    return ts.toISOString().replace("T", " ").replace("Z", " UTC");
}

function formatRelative(ts: Date): string {
    const diffMs = Date.now() - ts.getTime();
    const diffS = Math.floor(diffMs / 1000);
    if (diffS < 60) return `${diffS}s ago`;
    const diffM = Math.floor(diffS / 60);
    if (diffM < 60) return `${diffM}m ago`;
    const diffH = Math.floor(diffM / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
}

export function EventTimestamp({ timestamp, className }: EventTimestampProps) {
    const tooltipContent = (
        <div className={styles.tooltipContent}>
            <div>{formatFull(timestamp)}</div>
            <div className={styles.utc}>{formatUTC(timestamp)}</div>
            <div className={styles.relative}>{formatRelative(timestamp)}</div>
        </div>
    );

    return (
        <Tooltip content={tooltipContent}>
            <time
                dateTime={timestamp.toISOString()}
                className={className}
            >
                {formatTable(timestamp)}
            </time>
        </Tooltip>
    );
}
