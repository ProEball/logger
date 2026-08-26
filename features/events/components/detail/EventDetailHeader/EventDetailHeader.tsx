"use client";

import { useState } from "react";
import { LevelBadge } from "@/shared/components/LevelBadge/LevelBadge";
import type { Event } from "@/shared/types/event.types";
import type { LogLevel } from "@/shared/components/LevelBadge/LevelBadge";
import styles from "./EventDetailHeader.module.scss";

interface EventDetailHeaderProps {
    event: Event;
    onClose: () => void;
}

function CopyIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

function MoreIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

export function EventDetailHeader({ event, onClose }: EventDetailHeaderProps) {
    const [copied, setCopied] = useState(false);

    const copyId = () => {
        navigator.clipboard.writeText(event.id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const ts = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);
    const timeStr = ts.toISOString().split("T")[1].replace("Z", "").slice(0, 12);

    return (
        <div className={styles.head}>
            {/* Level + id + copy + more + close */}
            <div className={styles.topRow}>
                <LevelBadge level={event.level as LogLevel} size="sm" />
                <span className={styles.eventId}>{event.id}</span>
                <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={copyId}
                    title={copied ? "Copied!" : "Copy event ID"}
                >
                    <CopyIcon />
                </button>
                <button type="button" className={styles.iconBtn} title="More">
                    <MoreIcon />
                </button>
                <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={onClose}
                    aria-label="Close"
                >
                    <CloseIcon />
                </button>
            </div>

            {/* Message — 2-line clamp, monospace */}
            <p className={styles.title}>{event.message}</p>

            {/* Meta: at · source · env · error type */}
            <div className={styles.meta}>
                <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>at</span>
                    {timeStr}
                </span>
                {event.source ? (
                    <span className={styles.metaItem}>
                        <span className={styles.metaLabel}>source</span>
                        <span className={styles.metaSource}>{event.source}</span>
                    </span>
                ) : null}
                {event.environment ? (
                    <span className={styles.metaItem}>
                        <span className={styles.metaLabel}>env</span>
                        <span className={styles.metaEnv}>{event.environment}</span>
                    </span>
                ) : null}
                {event.errorType ? (
                    <span className={styles.metaItem}>
                        <span className={styles.metaLabel}>type</span>
                        <span className={styles.metaType}>{event.errorType}</span>
                    </span>
                ) : null}
            </div>
        </div>
    );
}
