import dynamic from "next/dynamic";
import { WidgetSkeleton } from "@/shared/components";
import { errorRatioPoints, projectSeries } from "@/shared/utils/chart-points";
import type { EventBucket } from "@/shared/utils/event-buckets";
import type { OverviewProject } from "@/features/overview/utils/build-project-rows";

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

interface OverviewVolumeSectionProps {
    projects: OverviewProject[];
    bucketsPromise: Promise<EventBucket[]>;
}

/**
 * The organization's error-ratio chart: one line per project.
 *
 * Suspends on the bucket query alone — the most expensive one on the page.
 *
 * The shaping happens here rather than inside the chart because `EventChart` is
 * a client component and this is a server one, so an accessor function cannot
 * cross between them. That turned out to be the better split anyway: the
 * arithmetic is now in `chart-points.ts` with tests, where it spent its whole
 * life inside a client component unreachable by any.
 */
export async function OverviewVolumeSection({
    projects,
    bucketsPromise,
}: OverviewVolumeSectionProps) {
    const buckets = await bucketsPromise;
    const series = projectSeries(projects);

    return (
        <EventChart
            title="Error ratio"
            meta="% errors + fatals"
            points={errorRatioPoints(buckets, projects)}
            series={series}
            mode="line"
            unit="%"
            emptyLabel="No events in this range"
            height={100}
        />
    );
}
