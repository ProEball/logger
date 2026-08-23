"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { LevelBadge } from "@/shared/components";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import type { TopMessage } from "@/features/dashboard/services/aggregations.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import styles from "./TopMessagesWidget.module.scss";

interface TopMessagesWidgetProps {
    data: TopMessage[];
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

function formatRelative(date: Date): string {
    const diff = Date.now() - new Date(date).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// Syntax patterns: order matters — verbs first, then strings, then numbers
const PATTERNS: Array<{ re: RegExp; cls: string }> = [
    { re: /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g, cls: styles.synVerb },
    { re: /"[^"]*"|'[^']*'/g, cls: styles.synString },
    { re: /\b\d+(\.\d+)?\b/g, cls: styles.synNumber },
];

type Segment = { start: number; end: number; cls: string };

function highlightMessage(text: string): ReactNode {
    const segs: Segment[] = [];
    for (const { re, cls } of PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            segs.push({ start: m.index, end: m.index + m[0].length, cls });
        }
    }
    if (segs.length === 0) return text;

    segs.sort((a, b) => a.start - b.start);

    // Remove overlaps (first-match-wins)
    const clean: Segment[] = [];
    let lastEnd = 0;
    for (const seg of segs) {
        if (seg.start >= lastEnd) {
            clean.push(seg);
            lastEnd = seg.end;
        }
    }

    const out: ReactNode[] = [];
    let pos = 0;
    for (const { start, end, cls } of clean) {
        if (pos < start) out.push(text.slice(pos, start));
        out.push(<span key={start} className={cls}>{text.slice(start, end)}</span>);
        pos = end;
    }
    if (pos < text.length) out.push(text.slice(pos));

    return out;
}

function trendColor(level: string): string {
    if (level === "error" || level === "fatal") return styles.trendRed;
    if (level === "warn") return styles.trendOrange;
    return styles.trendPurple;
}

export function TopMessagesWidget({
    data,
    range,
    orgSlug,
    projectSlug,
}: TopMessagesWidgetProps) {
    const router = useRouter();
    const isEmpty = data.length === 0;
    const max = data[0]?.count ?? 1;

    const handleClick = (message: string) => {
        const params = serializeFilters({ range, message });
        router.push(`/${orgSlug}/${projectSlug}/events?${params.toString()}`);
    };

    return (
        <WidgetCard title="Top messages" isEmpty={isEmpty}>
            <div className={styles.grid}>
                {/* Header */}
                <div className={`${styles.th} ${styles.colCount}`}>Count</div>
                <div className={`${styles.th} ${styles.colMsg}`}>Message</div>
                <div className={`${styles.th} ${styles.colTrend}`}>Trend</div>
                <div className={`${styles.th} ${styles.colLevel}`}>Level</div>
                <div className={`${styles.th} ${styles.colTime}`}>Last seen</div>

                {/* Rows */}
                {data.map((row, i) => {
                    const barPct = Math.round((row.count / max) * 100);
                    const levelCls = trendColor(row.dominantLevel);
                    return (
                        <div
                            key={i}
                            className={styles.row}
                            onClick={() => handleClick(row.message)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && handleClick(row.message)}
                        >
                            <div className={`${styles.td} ${styles.colCount} ${styles.countCell}`}>
                                {row.count.toLocaleString()}
                            </div>
                            <div className={`${styles.td} ${styles.colMsg} ${styles.msgCell}`}>
                                {highlightMessage(row.message)}
                            </div>
                            <div className={`${styles.td} ${styles.colTrend}`}>
                                <div className={styles.trendWrap}>
                                    <div
                                        className={`${styles.trendBar} ${levelCls}`}
                                        style={{ width: `${barPct}%` }}
                                    />
                                </div>
                            </div>
                            <div className={`${styles.td} ${styles.colLevel}`}>
                                <LevelBadge
                                    level={row.dominantLevel}
                                    size="sm"
                                />
                            </div>
                            <div
                                className={`${styles.td} ${styles.colTime} ${styles.timeCell}`}
                                suppressHydrationWarning
                            >
                                {formatRelative(row.latestAt)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </WidgetCard>
    );
}
