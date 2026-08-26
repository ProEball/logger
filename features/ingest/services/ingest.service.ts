import { enrichEvent, type RequestContext } from "../utils/enrich-event";
import { toClickhouseRow } from "../utils/to-clickhouse-row";
import type { NewEvent } from "@/shared/types/event.types";
import type { IngestEvent } from "../utils/event-schema";
import { AttributeTypeConflictError } from "../utils/attribute-types";
import { checkAttributeTypeConflicts } from "./attribute-type-registry.service";
import { insertEvents } from "./clickhouse-ingest.service";

/**
 * Writes one batch of enriched events.
 *
 * ## What Phase 4 removed, and why the removal is the point
 *
 * Until Phase 4 this wrote to **both** stores and then updated three derived
 * Postgres tables behind a `try`/`catch` each — an environment registry, a
 * message-template registry, and a rollup watermark carrying the batch's
 * *oldest* timestamp so a job could later rebuild the minutes it dirtied.
 * Those were the only deliberately swallowed errors on the ingest path, and
 * they existed for one reason: a Postgres rollup is a different table from
 * `events`, so somebody had to keep it in step.
 *
 * ClickHouse maintains the equivalents itself, so there is nothing to keep in
 * step and nothing left to swallow. Every error on this path now propagates.
 *
 * The dual write is gone with them. It was scaffolding with a scheduled end
 * (§12.2): writing both stores kept all 73 e2e specs green while the reads
 * moved over three phases, so a regression introduced in Phase 3 stayed
 * distinguishable from breakage put there on purpose. Both halves have now
 * moved, and the Postgres `events` table, its partitioning, its `pg_partman`
 * registration and the maintenance job that renewed it are deleted with them.
 *
 * With one store there is also one failure mode: `wait_for_async_insert = 1`
 * means the promise below is real by the time it returns, and a request either
 * stored its events or returned an error. The partial write §12.2 accepted as
 * the cost of the scaffold cannot happen any more.
 */
async function writeEvents(rows: NewEvent[], ctx: RequestContext): Promise<void> {
    await insertEvents(rows.map(toClickhouseRow), ctx.dedupToken);
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
    await writeEvents([row], ctx);
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
        await writeEvents(validRows, ctx);
    }

    const errors = Array.from(messagesByIndex, ([index, messages]) => ({
        index,
        message: messages.join(" "),
    }));
    return { accepted: validRows.length, errors };
}
