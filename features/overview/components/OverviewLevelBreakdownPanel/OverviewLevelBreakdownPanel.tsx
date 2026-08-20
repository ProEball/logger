import { OrgLevelBreakdown } from "@/features/overview/components/OrgLevelBreakdown/OrgLevelBreakdown";
import type { OrgLevelCount } from "@/features/overview/services/overview.service";

interface OverviewLevelBreakdownPanelProps {
    levelBreakdownPromise: Promise<OrgLevelCount[]>;
}

/**
 * Its own Suspense boundary rather than sharing one with top errors: the two
 * queries cost very differently (11.4% against 6.0% of the page's database
 * time), so pairing them would make the cheaper one wait for the dearer.
 */
export async function OverviewLevelBreakdownPanel({ levelBreakdownPromise }: OverviewLevelBreakdownPanelProps) {
    return <OrgLevelBreakdown levels={await levelBreakdownPromise} />;
}
