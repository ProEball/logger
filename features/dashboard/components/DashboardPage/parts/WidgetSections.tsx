import dynamic from "next/dynamic";
import { WidgetSkeleton } from "@/shared/components";

import { activeLevels, levelPoints } from "@/shared/utils/chart-points";
/**
 * Recharts is heavy and neither dashboard needs it in the shell, so the chart is
 * loaded lazily — `PROJECT.md` §10. Each page does its own `dynamic()` rather
 * than a shared wrapper, because §2.2 allows one component per folder and a
 * second file next to `EventChart.tsx` for this would be a structure invented to
 * save two lines.
 */
const EventChart = dynamic(
    () => import("@/shared/components/EventChart/EventChart").then((m) => ({ default: m.EventChart })),
    { loading: () => <WidgetSkeleton /> },
);
import { KNOWN_LEVELS, levelColor } from "@/features/dashboard/utils/level-colors";
import { t } from "@/core/i18n/t";
import { LevelBreakdownWidget } from "@/features/dashboard/components/widgets/LevelBreakdownWidget/LevelBreakdownWidget";
import { RecentErrorsWidget } from "@/features/dashboard/components/widgets/RecentErrorsWidget/RecentErrorsWidget";
import { TopSourcesWidget } from "@/features/dashboard/components/widgets/TopSourcesWidget/TopSourcesWidget";
import { TopMessagesWidget } from "@/features/dashboard/components/widgets/TopMessagesWidget/TopMessagesWidget";
import type { LevelledBucket } from "@/shared/utils/event-buckets";
import type {
    SourceCount,
} from "@/shared/services/event-aggregations.service";
import type { LevelCount, TopMessage } from "@/shared/services/event-aggregations.service";
import type { Event } from "@/core/db/schema";
import type { TimeRange } from "@/shared/utils/event-filters.schema";

/**
 * One server section per widget: await this widget's promise, render it.
 *
 * They live together in one file because each is four lines and they differ
 * only in which promise and which widget — six files whose diff against each
 * other is a single identifier would obscure that rather than reveal it.
 *
 * Every widget below is a client component (charts, click handlers), so the
 * `Suspense` boundary cannot live inside one. These wrappers are the server
 * half: they hold the await, the boundary sits around them in `DashboardPage`,
 * and what crosses into the client is finished data.
 *
 * **Measured 2026-08-21** (`event-aggregations.service.bench.ts`): `topMessages`
 * 170 ms, `eventsPerMinute` 44.2 ms, `levelBreakdown` 11.6, `topSources` 11.2,
 * `recentErrors` 0.84. Only the first is far enough from the rest to be worth a
 * boundary of its own on today's numbers; the others get one each because it
 * costs nothing, matches the org overview's shape, and keeps working when the
 * ratios change on a slower host.
 */


/** Range plus slugs — every widget turns a click into a filtered events URL. */
export interface WidgetClickProps {
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

/**
 * The project's volume chart: one stacked area per level.
 *
 * Same `EventChart` the organization overview draws, in its other mode. Shaping
 * happens here because the chart is a client component and this is not — see
 * `chart-points.ts`.
 */
export async function EventsChartSection({ promise }: { promise: Promise<LevelledBucket[]> }) {
    const buckets = await promise;
    const levels = activeLevels(buckets, KNOWN_LEVELS);

    return (
        <EventChart
            title={t("dashboard.widgets.eventsPerMinute")}
            points={levelPoints(buckets, levels)}
            series={levels.map((level) => ({ key: level, label: level, color: levelColor(level) }))}
            mode="stacked-area"
            emptyLabel="No events in this range"
        />
    );
}

export async function LevelBreakdownSection({
    promise,
    ...clickProps
}: { promise: Promise<LevelCount[]> } & WidgetClickProps) {
    return <LevelBreakdownWidget data={await promise} {...clickProps} />;
}

export async function RecentErrorsSection({
    promise,
    ...clickProps
}: { promise: Promise<Event[]> } & WidgetClickProps) {
    return <RecentErrorsWidget data={await promise} {...clickProps} />;
}

export async function TopSourcesSection({
    promise,
    ...clickProps
}: { promise: Promise<SourceCount[]> } & WidgetClickProps) {
    return <TopSourcesWidget data={await promise} {...clickProps} />;
}

/**
 * The expensive one — 170 ms of a 170 ms page. Its boundary is the reason the
 * other five paint at ~44 ms instead of waiting for it.
 */
export async function TopMessagesSection({
    promise,
    ...clickProps
}: { promise: Promise<TopMessage[]> } & WidgetClickProps) {
    return <TopMessagesWidget data={await promise} {...clickProps} />;
}
