import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { projectEnvironments } from "@/core/db/schema";
import { distinctEnvironments } from "../utils/distinct-environments";

/**
 * Records which environments a project sends events from, so the overview's
 * dropdown can be answered without scanning `events`.
 *
 * Called from the ingest path after the events themselves are written. A
 * failure here must never fail an ingest request: the registry is derived
 * data, and losing an update costs a dropdown entry until the next event from
 * that environment — whereas rejecting the write loses the event itself.
 */
export async function recordEnvironments(
    events: Array<{ environment?: string | null }>,
    projectId: string,
): Promise<void> {
    const environments = distinctEnvironments(events);
    if (environments.length === 0) return;

    await db
        .insert(projectEnvironments)
        .values(environments.map((environment) => ({ projectId, environment })))
        .onConflictDoUpdate({
            target: [projectEnvironments.projectId, projectEnvironments.environment],
            set: { lastSeenAt: sql`now()` },
            // Only actually write when the stored timestamp is meaningfully
            // stale. Without this, every ingest request updates every row it
            // touches — a dead tuple per batch on a table with a handful of
            // rows, for a column read against a 30-day window. One minute of
            // precision is far more than that window needs.
            setWhere: sql`${projectEnvironments.lastSeenAt} < now() - interval '1 minute'`,
        });
}
