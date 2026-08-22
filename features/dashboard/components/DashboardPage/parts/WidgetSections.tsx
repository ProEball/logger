import dynamic from "next/dynamic";
import { WidgetSkeleton } from "@/shared/components";
import { eventsPerMinuteRate } from "@/features/dashboard/utils/dashboard-kpis";
import { LevelBreakdownWidget } from "@/features/dashboard/components/widgets/LevelBreakdownWidget/LevelBreakdownWidget";
import { RecentErrorsWidget } from "@/features/dashboard/components/widgets/RecentErrorsWidget/RecentErrorsWidget";
import { TopSourcesWidget } from "@/features/dashboard/components/widgets/TopSourcesWidget/TopSourcesWidget";
import { TopMessagesWidget } from "@/features/dashboard/components/widgets/TopMessagesWidget/TopMessagesWidget";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";
import type {
    LevelCount,
    SourceCount,
    TopMessage,
} from "@/features/dashboard/services/aggregations.service";
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
 * **Measured 2026-08-21** (`aggregations.service.bench.ts`): `topMessages`
 * 170 ms, `eventsPerMinute` 44.2 ms, `levelBreakdown` 11.6, `topSources` 11.2,
 * `recentErrors` 0.84. Only the first is far enough from the rest to be worth a
 * boundary of its own on today's numbers; the others get one each because it
 * costs nothing, matches the org overview's shape, and keeps working when the
 * ratios change on a slower host.
 */

/** Client component, charts. Loaded lazily so Recharts stays out of the shell. */
const EventsPerMinuteWidget = dynamic(
    () =>
        import("@/features/dashboard/components/widgets/EventsPerMinuteWidget/EventsPerMinuteWidget").then(
            (m) => ({ default: m.EventsPerMinuteWidget }),
        ),
    { loading: () => <WidgetSkeleton /> },
);

/** Range plus slugs — every widget turns a click into a filtered events URL. */
export interface WidgetClickProps {
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

export async function EventsChartSection({ promise }: { promise: Promise<BucketRow[]> }) {
    return <EventsPerMinuteWidget data={await promise} />;
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

/** The header's subtitle, which reads off the bucket query like the KPI does. */
export async function HeaderRateSection({
    promise,
    range,
}: {
    promise: Promise<BucketRow[]>;
    range: TimeRange;
}) {
    return <>{eventsPerMinuteRate(await promise, range)} events / min</>;
}
