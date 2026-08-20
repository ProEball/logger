import { OrgVolumeChart } from "@/features/overview/components/OrgVolumeChart/OrgVolumeChart";
import type { OrgEventBucket } from "@/features/overview/services/overview.service";
import type { OverviewProject } from "@/features/overview/utils/build-project-rows";

interface OverviewVolumeSectionProps {
    projects: OverviewProject[];
    bucketsPromise: Promise<OrgEventBucket[]>;
}

/** Suspends on the bucket query alone — the most expensive one on the page. */
export async function OverviewVolumeSection({ projects, bucketsPromise }: OverviewVolumeSectionProps) {
    const buckets = await bucketsPromise;
    return <OrgVolumeChart buckets={buckets} projects={projects} />;
}
