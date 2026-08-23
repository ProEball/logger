import { db } from "@/core/db/client";
import { messageTemplates } from "@/core/db/schema";
import { distinctTemplates } from "../utils/distinct-templates";
import { NORMALIZER_VERSION } from "../utils/normalize-message";

/**
 * Records the message templates a project has sent, so the template rollup can
 * store a fingerprint and still have something to display.
 *
 * Called from the ingest path after the events are written, and a failure here
 * must never fail the request — same reasoning as the environment registry.
 * Losing a row here costs a template that shows as its hash until the next
 * event of that shape arrives; rejecting the write would lose the event.
 *
 * `DO NOTHING` rather than an upsert with a `last_seen` touch. A template's
 * recency is already in `event_template_rollup`, minute by minute, so a
 * `last_seen` column here would be a second copy of that answer paid for with a
 * dead tuple on every ingest — on the hottest path in the application, for a
 * value nothing reads.
 */
export async function recordTemplates(
    events: Array<{ message: string }>,
    projectId: string,
): Promise<void> {
    const templates = distinctTemplates(events);
    if (templates.length === 0) return;

    await db
        .insert(messageTemplates)
        .values(
            templates.map(({ templateHash, template }) => ({
                projectId,
                templateHash,
                template,
                normalizerVersion: NORMALIZER_VERSION,
            })),
        )
        .onConflictDoNothing({
            target: [messageTemplates.projectId, messageTemplates.templateHash],
        });
}
