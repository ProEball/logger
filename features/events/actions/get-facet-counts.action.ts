"use server";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { getFacetCounts } from "@/features/events/services/events-query.service";
import { parseFilters } from "@/features/events/utils/parse-filters";
import { assertPermission } from "@/shared/permissions/guards";
import type { FacetCounts } from "@/features/events/utils/event-filters.types";

/**
 * Facet counts for the events filter panel, fetched when the panel opens.
 *
 * Until 2026-08-20 these five aggregations ran inside the events route's
 * `Promise.all` on **every** page load — including auto-refreshes, and
 * including the overwhelming majority of loads where nobody opens the panel
 * (`FiltersPopover` holds its open state in `useState(false)`, so the server
 * never knew). Moving them here leaves a normal events page with a single
 * query: one keyset page of 51 rows.
 *
 * A read through a Server Action is a deliberate departure from PROJECT.md §8
 * ("Server Actions for mutations; Server Components for reads"). The read has
 * to be triggered by a client interaction that the server cannot see, and the
 * alternative — a route handler under `app/api/` — would mean re-implementing
 * session auth and permission checks that an action gets for free.
 */

const schema = z.object({
    orgSlug: z.string().min(1).max(128),
    projectSlug: z.string().min(1).max(128),
    // The page's own query string. Passing it verbatim and re-parsing it with
    // `parseFilters` — the same function the route uses — keeps one definition
    // of what a filter is. A hand-written Zod schema for `EventFilters` would
    // be a second one, free to drift from the first.
    search: z.string().max(4096),
});

export type FacetCountsResult = { ok: true; facetCounts: FacetCounts } | { error: string };

export async function getFacetCountsAction(
    orgSlug: string,
    projectSlug: string,
    search: string,
): Promise<FacetCountsResult> {
    const parsed = schema.safeParse({ orgSlug, projectSlug, search });
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "events.read");
    } catch {
        return { error: "You don't have permission to read events." };
    }

    const project = await getProjectBySlug(org.id, parsed.data.projectSlug);
    if (!project) return { error: "Project not found." };

    try {
        const filters = parseFilters(new URLSearchParams(parsed.data.search));
        const facetCounts = await getFacetCounts(project.id, filters);
        return { ok: true, facetCounts };
    } catch {
        return { error: "Failed to load filter counts." };
    }
}
