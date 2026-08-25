import type { ChartPoint, ChartSeries } from "@/shared/components/EventChart/EventChart";
import type { EventBucket, LevelledBucket } from "@/shared/utils/event-buckets";

/**
 * Turning buckets into what a chart draws.
 *
 * **Pure, and outside the chart, since 2026-08-25.** This arithmetic lived
 * inside `OrgVolumeChart` and `EventsPerMinuteWidget` — two client components,
 * so no test could reach it, and each had its own copy of the "collapse rows
 * into points" loop. Moving it here is what made a shared `EventChart` possible
 * at all: a client component cannot be handed an accessor function across the
 * server boundary, so the caller has to do the shaping.
 */

/** A project, as the error-ratio chart needs to know it. */
export interface ChartProject {
    id: string;
    name: string;
}

/**
 * One line per project, plotting **percentage of events that were errors**.
 *
 * A ratio rather than a count, because the organization chart's job is "which
 * project is in trouble", and a project with ten times the traffic would
 * otherwise dominate the axis while looking healthy.
 *
 * A bucket with no events plots **0**, not a gap: `0/0` is not a ratio, and a
 * gap in a line chart reads as missing data rather than as a quiet minute.
 */
export function errorRatioPoints(
    buckets: EventBucket[],
    projects: ChartProject[],
): ChartPoint[] {
    const byTs = new Map<number, Map<string, EventBucket>>();
    for (const b of buckets) {
        const key = b.ts.getTime();
        let slot = byTs.get(key);
        if (!slot) {
            slot = new Map();
            byTs.set(key, slot);
        }
        slot.set(b.projectId, b);
    }

    return [...byTs.keys()]
        .sort((a, b) => a - b)
        .map((ts) => {
            const slot = byTs.get(ts)!;
            const point: ChartPoint = { ts: new Date(ts).toISOString() };
            for (const project of projects) {
                const b = slot.get(project.id);
                const ratio = b && b.total > 0 ? (b.errors / b.total) * 100 : 0;
                point[project.id] = Number(ratio.toFixed(2));
            }
            return point;
        });
}

const LINE_COLORS = [
    "#bd93f9",
    "#8be9fd",
    "#50fa7b",
    "#ffb86c",
    "#ff79c6",
    "#f1fa8c",
    "#ff5555",
];

/** One series per project, coloured by position so the palette is stable. */
export function projectSeries(projects: ChartProject[]): ChartSeries[] {
    return projects.map((p, i) => ({
        key: p.id,
        label: p.name,
        color: LINE_COLORS[i % LINE_COLORS.length],
    }));
}

/**
 * One stacked area per level, plotting **event counts**.
 *
 * Only levels that actually occur get a series: a legend listing five levels
 * when the project logs two is noise, and an all-zero area still draws a line
 * along the axis.
 */
export function levelPoints(buckets: LevelledBucket[], levels: readonly string[]): ChartPoint[] {
    return [...buckets]
        .sort((a, b) => a.ts.getTime() - b.ts.getTime())
        .map((b) => {
            const point: ChartPoint = { ts: b.ts.toISOString() };
            for (const level of levels) point[level] = b.byLevel[level] ?? 0;
            return point;
        });
}

/** The levels present in a series, in the order given. */
export function activeLevels(
    buckets: LevelledBucket[],
    levels: readonly string[],
): string[] {
    return levels.filter((l) => buckets.some((b) => (b.byLevel[l] ?? 0) > 0));
}
