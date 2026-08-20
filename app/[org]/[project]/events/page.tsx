import { notFound, redirect } from "next/navigation";
import type { SearchParams } from "next/dist/server/request/search-params";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getMembership } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { listEvents, getEventById } from "@/features/events/services/events-query.service";
import { parseFilters } from "@/features/events/utils/parse-filters";
import { parseCursor } from "@/features/events/utils/parse-cursor";
import { EventsPage } from "@/features/events/components/EventsPage/EventsPage";

interface EventsPageProps {
    params: Promise<{ org: string; project: string }>;
    searchParams: Promise<SearchParams>;
}

export const dynamic = "force-dynamic";

export default async function EventsRoute({ params, searchParams }: EventsPageProps) {
    const { org: orgSlug, project: projectSlug } = await params;
    const sp = await searchParams;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) notFound();

    const urlParams = buildURLSearchParams(sp);
    const filters = parseFilters(urlParams);
    const cursor = parseCursor(urlParams);

    // One query. Facet counts used to run here too — five aggregations on every
    // load, including the great majority where nobody opens the filter panel.
    // They now load on demand; see `features/events/actions/get-facet-counts.action.ts`.
    const { events, hasMore } = await listEvents(project.id, filters, cursor);

    // If a specific event is requested for the drawer, fetch it
    const eventId = typeof sp.event === "string" ? sp.event : undefined;
    const eventTs = typeof sp.event_ts === "string" ? sp.event_ts : undefined;
    let selectedEvent = null;
    if (eventId && eventTs) {
        const ts = new Date(eventTs);
        if (!isNaN(ts.getTime())) {
            selectedEvent = await getEventById(project.id, eventId, ts);
        }
    }

    const activeTab = typeof sp.tab === "string" ? sp.tab : "details";

    return (
        <EventsPage
            events={events}
            hasMore={hasMore}
            cursor={cursor}
            filters={filters}
            selectedEvent={selectedEvent}
            activeTab={activeTab}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
        />
    );
}

function buildURLSearchParams(sp: SearchParams): URLSearchParams {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
        if (typeof value === "string") {
            params.set(key, value);
        } else if (Array.isArray(value)) {
            // Take the first value for multi-value params
            const first = value[0];
            if (typeof first === "string") params.set(key, first);
        }
    }
    return params;
}
