"use client";

import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import type { LogLevel } from '@/shared/components/LevelBadge/LevelBadge';
import { LevelBadge } from '@/shared/components/LevelBadge/LevelBadge';
import styles from './LogRow.module.scss';

export type LogRowVariant = 'classic' | 'stream' | 'card';

export interface LogRowProps {
    variant?: LogRowVariant;
    level: LogLevel;
    timestamp: string;
    message: string;
    source?: string;
    meta?: Record<string, string>;
    expanded?: boolean;
    onToggle?: () => void;
    className?: string;
}

export function LogRow({
    variant = 'classic',
    level,
    timestamp,
    message,
    source,
    meta,
    expanded,
    onToggle,
    className,
}: LogRowProps) {
    if (variant === 'stream') {
        return <StreamRow level={level} timestamp={timestamp} message={message} source={source} className={className} />;
    }
    if (variant === 'card') {
        return <CardRow level={level} timestamp={timestamp} message={message} source={source} meta={meta} className={className} />;
    }
    return (
        <ClassicRow
            level={level}
            timestamp={timestamp}
            message={message}
            source={source}
            meta={meta}
            expanded={expanded}
            onToggle={onToggle}
            className={className}
        />
    );
}

// ── Classic ───────────────────────────────────────────────────────────

interface ClassicRowProps {
    level: LogLevel;
    timestamp: string;
    message: string;
    source?: string;
    meta?: Record<string, string>;
    expanded?: boolean;
    onToggle?: () => void;
    className?: string;
}

function ClassicRow({ level, timestamp, message, source, meta, expanded, onToggle, className }: ClassicRowProps) {
    return (
        <div className={cx(styles.classic, expanded && styles.classicExpanded, className)}>
            <div
                className={styles.classicRow}
                role={onToggle ? 'button' : undefined}
                tabIndex={onToggle ? 0 : undefined}
                onClick={onToggle}
                onKeyDown={onToggle ? (e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); } : undefined}
            >
                <span className={styles.ts}>{timestamp}</span>
                <LevelBadge level={level} />
                <span className={styles.msg}>{message}</span>
                {source ? <span className={styles.src}>{source}</span> : null}
            </div>
            {expanded && meta ? <MetaPanel meta={meta} /> : null}
        </div>
    );
}

// ── Stream ────────────────────────────────────────────────────────────

interface StreamRowProps {
    level: LogLevel;
    timestamp: string;
    message: string;
    source?: string;
    className?: string;
}

function StreamRow({ level, timestamp, message, source, className }: StreamRowProps) {
    return (
        <div className={cx(styles.stream, className)} style={{ '--stream-bar': `var(--lvl-${level})` } as React.CSSProperties}>
            <span className={styles.streamBar} aria-hidden="true" />
            <span className={styles.streamMeta}>{timestamp}</span>
            <span className={styles.streamMsg}>
                {source ? <span className={styles.streamSrc}>{source} </span> : null}
                {message}
            </span>
        </div>
    );
}

// ── Card ──────────────────────────────────────────────────────────────

interface CardRowProps {
    level: LogLevel;
    timestamp: string;
    message: string;
    source?: string;
    meta?: Record<string, string>;
    className?: string;
}

function CardRow({ level, timestamp, message, source, meta, className }: CardRowProps) {
    return (
        <div className={cx(styles.card, styles[`card_${level}`], className)}>
            <div className={styles.cardHead}>
                <LevelBadge level={level} />
                <span className={styles.cardTs}>{timestamp}</span>
                {source ? <span className={styles.cardSrc}>{source}</span> : null}
            </div>
            <p className={styles.cardMsg}>{message}</p>
            {meta && Object.keys(meta).length > 0 ? (
                <div className={styles.cardMeta}>
                    {Object.entries(meta).map(([k, v]) => (
                        <span key={k} className={styles.cardMetaItem}>
                            <b>{k}</b> {v}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// ── Shared meta panel ─────────────────────────────────────────────────

function MetaPanel({ meta }: { meta: Record<string, string> }): ReactNode {
    return (
        <dl className={styles.metaPanel}>
            {Object.entries(meta).map(([k, v]) => (
                <div key={k} className={styles.metaRow}>
                    <dt className={styles.metaKey}>{k}</dt>
                    <dd className={styles.metaVal}>{v}</dd>
                </div>
            ))}
        </dl>
    );
}
