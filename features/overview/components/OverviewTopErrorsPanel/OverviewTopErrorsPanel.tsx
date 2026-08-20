import { OrgTopErrors } from "@/features/overview/components/OrgTopErrors/OrgTopErrors";
import type { OrgTopError } from "@/features/overview/services/overview.service";
import type { OverviewProject } from "@/features/overview/utils/build-project-rows";
import type { TopErrorsWindow } from "@/features/overview/utils/top-errors-window";

interface OverviewTopErrorsPanelProps {
    projects: OverviewProject[];
    topErrorsPromise: Promise<OrgTopError[]>;
    window: TopErrorsWindow;
}

export async function OverviewTopErrorsPanel({
    projects,
    topErrorsPromise,
    window,
}: OverviewTopErrorsPanelProps) {
    return (
        <OrgTopErrors
            errors={await topErrorsPromise}
            projects={projects}
            windowLabel={window.preset}
            isWindowClamped={window.isClamped}
        />
    );
}
