import { db } from "@/core/db/client";
import { events } from "@/core/db/schema";
import { enrichEvent, type RequestContext } from "../utils/enrich-event";
import type { IngestEvent } from "../utils/event-schema";
import { AttributeTypeConflictError } from "../utils/attribute-types";
import { checkAttributeTypeConflicts } from "./attribute-type-registry.service";
import { recordEnvironments } from "./environment-registry.service";
import { recordTemplates } from "./template-registry.service";
import { markRollupDirty } from "./event-rollup.service";
import { logger } from "@/core/logger";

/**
 * Update the derived read-path tables without ever failing the ingest request.
 *
 * Both are derived data. A lost environment-registry update costs one entry in
 * the filter bar until the next event from that environment; a lost rollup
 * watermark means those events are missing from the dashboards until something
 * else moves the watermark back past them. Neither justifies returning a 500
 * and losing the event itself, which is already durable by this point — so
 * these are the only deliberately swallowed errors on the ingest path, done in
 * a named function and logged rather than hidden behind a bare `.catch()`.
 *
 * The watermark carries the batch's **oldest** timestamp, not the current time.
 * `events` records when an event happened, not when it arrived, so nothing in
 * that table can tell the rollup job that a three-day-old event turned up a
 * moment ago. This is the only place that knows.
 */
async function updateDerivedTablesSafely(
    rows: Array<{ environment?: string | null; timestamp: Date; message: string }>,
    projectId: string,
): Promise<void> {
    try {
        await recordEnvironments(rows, projectId);
    } catch (err) {
        logger.error({ err, projectId }, "failed to update the project environment registry");
    }

    try {
        await recordTemplates(rows, projectId);
    } catch (err) {
        logger.error({ err, projectId }, "failed to update the message template registry");
    }

    try {
        const oldest = rows.reduce(
            (min, row) => (row.timestamp < min ? row.timestamp : min),
            rows[0].timestamp,
        );
        await markRollupDirty(projectId, oldest);
    } catch (err) {
        logger.error({ err, projectId }, "failed to mark the event rollup dirty");
    }
}

export interface SingleIngestResult {
    id: string;
}

export interface BatchIngestResult {
    accepted: number;
    errors: Array<{ index: number; message: string }>;
}

export async function ingestSingle(
    rawEvent: IngestEvent,
    ctx: RequestContext,
): Promise<SingleIngestResult> {
    const conflicts = await checkAttributeTypeConflicts([rawEvent], ctx.projectId);
    if (conflicts.length > 0) {
        throw new AttributeTypeConflictError(conflicts);
    }

    const row = enrichEvent(rawEvent, ctx);
    await db.insert(events).values(row);
    await updateDerivedTablesSafely([row], ctx.projectId);
    return { id: row.id };
}

export async function ingestBatch(
    rawEvents: IngestEvent[],
    ctx: RequestContext,
): Promise<BatchIngestResult> {
    const conflicts = await checkAttributeTypeConflicts(rawEvents, ctx.projectId);
    const messagesByIndex = new Map<number, string[]>();
    for (const c of conflicts) {
        const messages = messagesByIndex.get(c.index) ?? [];
        messages.push(c.message);
        messagesByIndex.set(c.index, messages);
    }

    const acceptedEvents = rawEvents.filter((_, index) => !messagesByIndex.has(index));
    const validRows = acceptedEvents.map((e) => enrichEvent(e, ctx));
    if (validRows.length > 0) {
        await db.insert(events).values(validRows);
        await updateDerivedTablesSafely(validRows, ctx.projectId);
    }

    const errors = Array.from(messagesByIndex, ([index, messages]) => ({
        index,
        message: messages.join(" "),
    }));
    return { accepted: validRows.length, errors };
}
